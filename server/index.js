require("dotenv").config();

const express = require("express");
const cors = require("cors");
const multer = require("multer");
const path = require("path");
const fs = require("fs");
const crypto = require("crypto");
const { execFile } = require("child_process");

const app = express();
const PORT = process.env.PORT || 4000;

app.set("trust proxy", true);

app.use(cors());
app.use(express.json({ limit: "50mb" }));

app.use("/uploads", express.static(path.join(__dirname, "uploads")));

const EDITOR_WIDTH = 360;
const EDITOR_HEIGHT = 640;

const OUTPUT_WIDTH = 720;
const OUTPUT_HEIGHT = 1280;

/*
  브라우저 CSS 글자 크기와 FFmpeg ASS 글자 크기가 달라서 보정합니다.
  값이 크면 결과 영상 글자가 커지고, 작으면 결과 영상 글자가 작아집니다.
*/
const FONT_SIZE_MULTIPLIER = 1.22;

/*
  App.jsx의 lineHeight: "1.2"와 맞춥니다.
*/
const LINE_HEIGHT_MULTIPLIER = 1.2;

const DIRECT_UPLOAD_DIR = path.join(__dirname, "uploads", "original");
const SUBTITLE_DIR = path.join(__dirname, "uploads", "subtitles");
const OUTPUT_DIR = path.join(__dirname, "uploads", "output");

const EXTERNAL_ROOT_DIR = path.join(__dirname, "uploads", "external");
const TMP_DIR = path.join(__dirname, "uploads", "tmp");

/*
  Hilite에서 import 완료 후 열어줄 프론트 주소입니다.
  개발 환경 예:
  EDITOR_PUBLIC_URL=http://localhost:5173

  Render 배포 환경 예:
  EDITOR_PUBLIC_URL=https://your-caption-editor.onrender.com
*/
const EDITOR_PUBLIC_URL = process.env.EDITOR_PUBLIC_URL || "";

const ensureFolders = () => {
  const folders = [
    path.join(__dirname, "uploads"),
    DIRECT_UPLOAD_DIR,
    SUBTITLE_DIR,
    OUTPUT_DIR,
    EXTERNAL_ROOT_DIR,
    TMP_DIR
  ];

  folders.forEach((folder) => {
    if (!fs.existsSync(folder)) {
      fs.mkdirSync(folder, { recursive: true });
    }
  });
};

ensureFolders();

const directUploadStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, DIRECT_UPLOAD_DIR);
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname);
    const uniqueName = `${Date.now()}${ext}`;
    cb(null, uniqueName);
  }
});

const directUpload = multer({
  storage: directUploadStorage,
  fileFilter: (req, file, cb) => {
    if (file.mimetype === "video/mp4") {
      cb(null, true);
    } else {
      cb(new Error("mp4 파일만 업로드할 수 있습니다."));
    }
  }
});

const externalTempStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, TMP_DIR);
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname || "");
    const uniqueName = `${Date.now()}-${crypto.randomUUID()}${ext}`;
    cb(null, uniqueName);
  }
});

const externalUpload = multer({
  storage: externalTempStorage,
  limits: {
    fileSize: 1024 * 1024 * 500
  }
});

const safeRemoveDir = (targetPath) => {
  if (!targetPath) return;

  const resolved = path.resolve(targetPath);
  const root = path.resolve(EXTERNAL_ROOT_DIR);

  if (!resolved.startsWith(root)) {
    throw new Error("삭제 대상 경로가 external root 밖에 있습니다.");
  }

  if (fs.existsSync(resolved)) {
    fs.rmSync(resolved, {
      recursive: true,
      force: true
    });
  }
};

const createSessionId = () => {
  return `session_${crypto.randomUUID().replace(/-/g, "")}`;
};

const getSessionDir = (sessionId) => {
  const clean = String(sessionId || "");

  if (!/^session_[a-zA-Z0-9]+$/.test(clean)) {
    throw new Error("잘못된 sessionId입니다.");
  }

  return path.join(EXTERNAL_ROOT_DIR, clean);
};

const getPublicBaseUrl = (req) => {
  return `${req.protocol}://${req.get("host")}`;
};

const getEditorBaseUrl = (req) => {
  return EDITOR_PUBLIC_URL || getPublicBaseUrl(req);
};

const moveUploadedFile = (file, targetPath) => {
  if (!file || !file.path) {
    throw new Error("업로드 파일이 없습니다.");
  }

  fs.renameSync(file.path, targetPath);
};

const cleanupTempFiles = (files) => {
  if (!files) return;

  Object.values(files).flat().forEach((file) => {
    if (file?.path && fs.existsSync(file.path)) {
      fs.unlinkSync(file.path);
    }
  });
};

const runFfmpeg = (args) => {
  return new Promise((resolve, reject) => {
    execFile("ffmpeg", args, (error, stdout, stderr) => {
      if (error) {
        reject({
          error,
          stderr
        });
        return;
      }

      resolve({
        stdout,
        stderr
      });
    });
  });
};

const escapeAssText = (text) => {
  return String(text ?? "")
    .replace(/\\/g, "\\\\")
    .replace(/\{/g, "\\{")
    .replace(/\}/g, "\\}")
    .replace(/\r\n/g, "\\N")
    .replace(/\n/g, "\\N");
};

const secondsToAssTime = (seconds) => {
  const value = Number(seconds);

  if (Number.isNaN(value) || value < 0) {
    return "0:00:00.00";
  }

  const totalCentiseconds = Math.floor(value * 100);
  const centiseconds = totalCentiseconds % 100;

  const totalSeconds = Math.floor(totalCentiseconds / 100);
  const sec = totalSeconds % 60;

  const totalMinutes = Math.floor(totalSeconds / 60);
  const min = totalMinutes % 60;

  const hour = Math.floor(totalMinutes / 60);

  return `${hour}:${String(min).padStart(2, "0")}:${String(sec).padStart(
    2,
    "0"
  )}.${String(centiseconds).padStart(2, "0")}`;
};

const srtTimeToSeconds = (timeText) => {
  const match = String(timeText || "")
    .trim()
    .match(/^(\d{2}):(\d{2}):(\d{2}),(\d{3})$/);

  if (!match) {
    return 0;
  }

  const [, hh, mm, ss, ms] = match;

  return (
    Number(hh) * 3600 +
    Number(mm) * 60 +
    Number(ss) +
    Number(ms) / 1000
  );
};

const parseSrtToSubtitles = (srtText) => {
  const normalized = String(srtText || "")
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .trim();

  if (!normalized) {
    return [];
  }

  const blocks = normalized.split(/\n\s*\n/);

  return blocks
    .map((block, index) => {
      const lines = block.split("\n").map((line) => line.trimEnd());

      const timeLineIndex = lines.findIndex((line) => line.includes("-->"));

      if (timeLineIndex === -1) {
        return null;
      }

      const timeLine = lines[timeLineIndex];
      const timeMatch = timeLine.match(
        /(\d{2}:\d{2}:\d{2},\d{3})\s*-->\s*(\d{2}:\d{2}:\d{2},\d{3})/
      );

      if (!timeMatch) {
        return null;
      }

      const [, startRaw, endRaw] = timeMatch;
      const textLines = lines.slice(timeLineIndex + 1);
      const text = textLines.join("\n").trim();

      if (!text) {
        return null;
      }

      return {
        id: Date.now() + index,
        text,
        x: 40,
        y: 500,
        width: 280,
        height: 90,
        startTime: Number(srtTimeToSeconds(startRaw).toFixed(3)),
        endTime: Number(srtTimeToSeconds(endRaw).toFixed(3)),
        fontSize: 32,
        textAlign: "center",
        fontFamily: "Malgun Gothic",
        color: "#ffffff",
        bold: true,
        italic: false
      };
    })
    .filter(Boolean);
};

const hexToAssColor = (hexColor) => {
  const fallback = "&H00FFFFFF";

  if (!hexColor || typeof hexColor !== "string") {
    return fallback;
  }

  const hex = hexColor.replace("#", "");

  if (hex.length !== 6) {
    return fallback;
  }

  const rr = hex.slice(0, 2);
  const gg = hex.slice(2, 4);
  const bb = hex.slice(4, 6);

  return `&H00${bb}${gg}${rr}`;
};

const hasKoreanText = (text) => {
  return /[ㄱ-ㅎㅏ-ㅣ가-힣]/.test(String(text || ""));
};

const getCssFontSize = (subtitle) => {
  return Number(subtitle.fontSize) || 32;
};

const getEffectiveFontSize = (subtitle) => {
  return Math.round(getCssFontSize(subtitle) * FONT_SIZE_MULTIPLIER);
};

const getLineHeight = (subtitle) => {
  return getCssFontSize(subtitle) * LINE_HEIGHT_MULTIPLIER;
};

const getAssAlignment = (textAlign) => {
  if (textAlign === "left") {
    return 7;
  }

  if (textAlign === "right") {
    return 9;
  }

  return 8;
};

const getAssPositionX = (subtitle) => {
  const x = Math.round(Number(subtitle.x) || 0);
  const width = Math.round(Number(subtitle.width) || 220);

  if (subtitle.textAlign === "left") {
    return x;
  }

  if (subtitle.textAlign === "right") {
    return x + width;
  }

  return x + width / 2;
};

const splitTextToLines = (text) => {
  return String(text || "")
    .replace(/\r\n/g, "\n")
    .split("\n");
};

const autoWrapLine = (line, maxCharsPerLine) => {
  const chars = Array.from(line);
  const lines = [];

  let current = "";

  chars.forEach((char) => {
    if (current.length >= maxCharsPerLine) {
      lines.push(current);
      current = "";
    }

    current += char;
  });

  if (current) {
    lines.push(current);
  }

  return lines;
};

const shouldRenderAsVerticalLike = (subtitle) => {
  const text = String(subtitle.text || "");
  const width = Number(subtitle.width) || 220;
  const cssFontSize = getCssFontSize(subtitle);

  if (subtitle.vertical) {
    return true;
  }

  if (!hasKoreanText(text)) {
    return false;
  }

  return width <= cssFontSize * 2.4;
};

const getMaxCharsPerLine = (subtitle) => {
  const text = String(subtitle.text || "");
  const width = Number(subtitle.width) || 220;
  const cssFontSize = getCssFontSize(subtitle);

  const hasKorean = hasKoreanText(text);

  const estimatedCharWidth = hasKorean
    ? cssFontSize * 1.05
    : cssFontSize * 0.62;

  const maxCharsPerLine = Math.floor((width - 8) / estimatedCharWidth);

  return Math.max(1, maxCharsPerLine);
};

const getMaxLinesByBoxHeight = (subtitle) => {
  const height = Number(subtitle.height) || 80;

  const verticalPadding = 8;
  const availableHeight = Math.max(1, height - verticalPadding);
  const lineHeight = getLineHeight(subtitle);

  return Math.max(1, Math.floor(availableHeight / lineHeight + 0.15));
};

const getSubtitleLinesForAss = (subtitle) => {
  const text = String(subtitle.text || "");
  const maxLines = getMaxLinesByBoxHeight(subtitle);

  if (shouldRenderAsVerticalLike(subtitle)) {
    return Array.from(text.replace(/\s+/g, ""))
      .slice(0, maxLines)
      .map((char) => escapeAssText(char));
  }

  const maxCharsPerLine = getMaxCharsPerLine(subtitle);
  const originalLines = splitTextToLines(text);
  const wrappedLines = [];

  originalLines.forEach((line) => {
    const wrapped = autoWrapLine(line, maxCharsPerLine);
    wrappedLines.push(...wrapped);
  });

  return wrappedLines
    .slice(0, maxLines)
    .map((line) => escapeAssText(line));
};

const createDialogueLine = (subtitle, lineText, lineIndex) => {
  const start = Number(subtitle.startTime) || 0;
  const rawEnd = Number(subtitle.endTime);
  const end = !Number.isNaN(rawEnd) && rawEnd > start ? rawEnd : start + 1;

  const x = Math.round(getAssPositionX(subtitle));
  const baseY = Math.round(Number(subtitle.y) || 0);
  const lineY = Math.round(baseY + lineIndex * getLineHeight(subtitle));

  const fontSize = getEffectiveFontSize(subtitle);
  const alignment = getAssAlignment(subtitle.textAlign);

  const fontFamily = subtitle.fontFamily || "Malgun Gothic";
  const color = hexToAssColor(subtitle.color || "#ffffff");
  const bold = subtitle.bold === false ? 0 : 1;
  const italic = subtitle.italic ? 1 : 0;

  return `Dialogue: 0,${secondsToAssTime(start)},${secondsToAssTime(
    end
  )},Default,,0,0,0,,{\\an${alignment}\\pos(${x},${lineY})\\fs${fontSize}\\fn${fontFamily}\\c${color}\\b${bold}\\i${italic}\\bord0\\shad0\\q2}${lineText}`;
};

const createAssSubtitle = (subtitles) => {
  const events = subtitles
    .flatMap((subtitle) => {
      const lines = getSubtitleLinesForAss(subtitle);

      return lines.map((lineText, lineIndex) =>
        createDialogueLine(subtitle, lineText, lineIndex)
      );
    })
    .join("\n");

  return `[Script Info]
Title: Generated Subtitle
ScriptType: v4.00+
WrapStyle: 0
ScaledBorderAndShadow: yes
PlayResX: ${EDITOR_WIDTH}
PlayResY: ${EDITOR_HEIGHT}

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Default,Malgun Gothic,32,&H00FFFFFF,&H000000FF,&H00000000,&H00000000,-1,0,0,0,100,100,0,0,1,0,0,8,0,0,0,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
${events}
`;
};

const escapeFfmpegFilterPath = (filePath) => {
  return filePath
    .replace(/\\/g, "/")
    .replace(/^([A-Za-z]):/, "$1\\:")
    .replace(/'/g, "\\'");
};

const muxVideoAndVoice = async (videoPath, voicePath, outputPath) => {
  const args = [
    "-y",
    "-i",
    videoPath,
    "-i",
    voicePath,
    "-map",
    "0:v:0",
    "-map",
    "1:a:0",
    "-c:v",
    "libx264",
    "-preset",
    "veryfast",
    "-crf",
    "18",
    "-pix_fmt",
    "yuv420p",
    "-c:a",
    "aac",
    "-b:a",
    "192k",
    "-shortest",
    "-movflags",
    "+faststart",
    outputPath
  ];

  await runFfmpeg(args);
};

const pushRenderedVideoToCallback = async ({
  callbackUrl,
  jobId,
  sessionId,
  outputPath
}) => {
  if (!callbackUrl) {
    return {
      skipped: true,
      message: "callbackUrl이 없어 push를 생략했습니다."
    };
  }

  if (!fs.existsSync(outputPath)) {
    throw new Error("callback으로 보낼 결과 mp4가 없습니다.");
  }

  if (typeof fetch !== "function" || typeof FormData !== "function") {
    throw new Error("현재 Node 버전에서 fetch/FormData를 사용할 수 없습니다. Node 18 이상을 사용하세요.");
  }

  const fileBuffer = fs.readFileSync(outputPath);
  const blob = new Blob([fileBuffer], {
    type: "video/mp4"
  });

  const formData = new FormData();
  formData.append("jobId", jobId || "");
  formData.append("sessionId", sessionId || "");
  formData.append("video", blob, "edited-video.mp4");

  const response = await fetch(callbackUrl, {
    method: "POST",
    body: formData
  });

  if (!response.ok) {
    const errorText = await response.text().catch(() => "");
    throw new Error(
      `callback push 실패: ${response.status} ${response.statusText} ${errorText}`
    );
  }

  return {
    skipped: false,
    message: "callback push 성공"
  };
};

const writeMeta = (sessionDir, meta) => {
  fs.writeFileSync(
    path.join(sessionDir, "meta.json"),
    JSON.stringify(meta, null, 2),
    "utf8"
  );
};

const readMeta = (sessionDir) => {
  const metaPath = path.join(sessionDir, "meta.json");

  if (!fs.existsSync(metaPath)) {
    throw new Error("세션 meta.json을 찾을 수 없습니다.");
  }

  return JSON.parse(fs.readFileSync(metaPath, "utf8"));
};

const cleanupOldExternalSessions = () => {
  const maxAgeMs = Number(process.env.EXTERNAL_SESSION_MAX_AGE_MS || 24 * 60 * 60 * 1000);

  if (!fs.existsSync(EXTERNAL_ROOT_DIR)) {
    return;
  }

  const now = Date.now();

  fs.readdirSync(EXTERNAL_ROOT_DIR, { withFileTypes: true }).forEach((dirent) => {
    if (!dirent.isDirectory()) {
      return;
    }

    const sessionDir = path.join(EXTERNAL_ROOT_DIR, dirent.name);
    const metaPath = path.join(sessionDir, "meta.json");

    try {
      if (!fs.existsSync(metaPath)) {
        const stat = fs.statSync(sessionDir);

        if (now - stat.mtimeMs > maxAgeMs) {
          safeRemoveDir(sessionDir);
        }

        return;
      }

      const meta = JSON.parse(fs.readFileSync(metaPath, "utf8"));
      const createdAtMs = new Date(meta.createdAt || 0).getTime();

      if (Number.isNaN(createdAtMs)) {
        return;
      }

      if (now - createdAtMs > maxAgeMs) {
        safeRemoveDir(sessionDir);
      }
    } catch (error) {
      console.error("오래된 external session 정리 실패:", error);
    }
  });
};

setInterval(cleanupOldExternalSessions, 60 * 60 * 1000);
cleanupOldExternalSessions();

app.get("/", (req, res) => {
  res.send("Node 서버가 정상 실행 중입니다.");
});

app.get("/api/health", (req, res) => {
  res.json({
    status: "ok",
    message: "React와 Node 서버 연결 성공"
  });
});

app.post("/api/upload", directUpload.single("video"), (req, res) => {
  const videoUrl = `${getPublicBaseUrl(req)}/uploads/original/${req.file.filename}`;

  res.json({
    message: "영상 업로드 성공",
    filename: req.file.filename,
    videoUrl
  });
});

/*
  Hilite가 편집 버튼을 눌렀을 때 호출하는 import API입니다.

  multipart/form-data:
  - jobId: Hilite 작업 ID
  - callbackUrl: 편집 완료 mp4를 받을 Hilite API 주소
  - video: 자막 없는 영상 mp4
  - voice: TTS 음성 mp3
  - srt: subtitles.srt
*/
app.post(
  "/api/external/import",
  externalUpload.fields([
    { name: "video", maxCount: 1 },
    { name: "voice", maxCount: 1 },
    { name: "srt", maxCount: 1 }
  ]),
  async (req, res) => {
    let sessionDir = null;

    try {
      const { jobId, callbackUrl } = req.body;

      const videoFile = req.files?.video?.[0];
      const voiceFile = req.files?.voice?.[0];
      const srtFile = req.files?.srt?.[0];

      if (!jobId) {
        cleanupTempFiles(req.files);
        return res.status(400).json({
          message: "jobId가 필요합니다."
        });
      }

      if (!videoFile) {
        cleanupTempFiles(req.files);
        return res.status(400).json({
          message: "video 파일이 필요합니다."
        });
      }

      if (!voiceFile) {
        cleanupTempFiles(req.files);
        return res.status(400).json({
          message: "voice 파일이 필요합니다."
        });
      }

      if (!srtFile) {
        cleanupTempFiles(req.files);
        return res.status(400).json({
          message: "srt 파일이 필요합니다."
        });
      }

      const sessionId = createSessionId();
      sessionDir = getSessionDir(sessionId);

      const inputDir = path.join(sessionDir, "input");
      const outputDir = path.join(sessionDir, "output");

      fs.mkdirSync(inputDir, { recursive: true });
      fs.mkdirSync(outputDir, { recursive: true });

      const videoPath = path.join(inputDir, "video.mp4");
      const voicePath = path.join(inputDir, "voice.mp3");
      const srtPath = path.join(inputDir, "subtitles.srt");
      const previewVideoPath = path.join(inputDir, "video-with-voice.mp4");

      moveUploadedFile(videoFile, videoPath);
      moveUploadedFile(voiceFile, voicePath);
      moveUploadedFile(srtFile, srtPath);

      await muxVideoAndVoice(videoPath, voicePath, previewVideoPath);

      const meta = {
        sessionId,
        jobId,
        callbackUrl: callbackUrl || "",
        createdAt: new Date().toISOString(),
        status: "imported"
      };

      writeMeta(sessionDir, meta);

      const editorUrl = `${getEditorBaseUrl(req)}?session_id=${encodeURIComponent(
        sessionId
      )}`;

      res.json({
        message: "외부 편집 세션 생성 완료",
        sessionId,
        jobId,
        editorUrl
      });
    } catch (error) {
      console.error("외부 import 실패:", error);

      cleanupTempFiles(req.files);

      if (sessionDir && fs.existsSync(sessionDir)) {
        try {
          safeRemoveDir(sessionDir);
        } catch (removeError) {
          console.error("실패 세션 폴더 삭제 실패:", removeError);
        }
      }

      res.status(500).json({
        message: "외부 편집 세션 생성 실패",
        error: error.stderr || String(error)
      });
    }
  }
);

app.get("/api/external/session/:sessionId", (req, res) => {
  try {
    const { sessionId } = req.params;
    const sessionDir = getSessionDir(sessionId);
    const inputDir = path.join(sessionDir, "input");

    if (!fs.existsSync(sessionDir)) {
      return res.status(404).json({
        message: "편집 세션을 찾을 수 없습니다."
      });
    }

    const meta = readMeta(sessionDir);
    const srtPath = path.join(inputDir, "subtitles.srt");
    const previewVideoPath = path.join(inputDir, "video-with-voice.mp4");

    if (!fs.existsSync(srtPath)) {
      return res.status(404).json({
        message: "SRT 파일을 찾을 수 없습니다."
      });
    }

    if (!fs.existsSync(previewVideoPath)) {
      return res.status(404).json({
        message: "미리보기 영상을 찾을 수 없습니다."
      });
    }

    const srtText = fs.readFileSync(srtPath, "utf8");
    const subtitles = parseSrtToSubtitles(srtText);

    const videoUrl = `${getPublicBaseUrl(req)}/uploads/external/${sessionId}/input/video-with-voice.mp4`;

    res.json({
      message: "외부 편집 세션 조회 성공",
      sessionId,
      jobId: meta.jobId,
      videoUrl,
      subtitles
    });
  } catch (error) {
    console.error("외부 편집 세션 조회 실패:", error);

    res.status(500).json({
      message: "외부 편집 세션 조회 실패",
      error: String(error)
    });
  }
});

app.post("/api/render", async (req, res) => {
  let sessionDirForCleanup = null;

  try {
    const { filename, sessionId, subtitles } = req.body;

    if (!Array.isArray(subtitles) || subtitles.length === 0) {
      return res.status(400).json({
        message: "자막 데이터가 없습니다."
      });
    }

    let inputPath;
    let outputPath;
    let subtitlePath;
    let outputUrl;
    let outputFilename;
    let externalMeta = null;
    let isExternalMode = false;

    if (sessionId) {
      isExternalMode = true;

      const sessionDir = getSessionDir(sessionId);
      sessionDirForCleanup = sessionDir;

      if (!fs.existsSync(sessionDir)) {
        return res.status(404).json({
          message: "편집 세션을 찾을 수 없습니다."
        });
      }

      externalMeta = readMeta(sessionDir);

      const inputDir = path.join(sessionDir, "input");
      const outputDir = path.join(sessionDir, "output");

      inputPath = path.join(inputDir, "video-with-voice.mp4");
      subtitlePath = path.join(outputDir, "subtitles.ass");
      outputFilename = "rendered.mp4";
      outputPath = path.join(outputDir, outputFilename);

      if (!fs.existsSync(inputPath)) {
        return res.status(404).json({
          message: "외부 편집 입력 영상을 찾을 수 없습니다."
        });
      }

      writeMeta(sessionDir, {
        ...externalMeta,
        status: "rendering",
        renderingStartedAt: new Date().toISOString()
      });
    } else {
      if (!filename) {
        return res.status(400).json({
          message: "filename 또는 sessionId가 필요합니다."
        });
      }

      inputPath = path.join(DIRECT_UPLOAD_DIR, filename);

      if (!fs.existsSync(inputPath)) {
        return res.status(404).json({
          message: "원본 영상 파일을 찾을 수 없습니다."
        });
      }

      const baseName = path.parse(filename).name;
      const subtitleFilename = `${baseName}.ass`;
      outputFilename = `rendered-${baseName}.mp4`;

      subtitlePath = path.join(SUBTITLE_DIR, subtitleFilename);
      outputPath = path.join(OUTPUT_DIR, outputFilename);
    }

    const assContent = createAssSubtitle(subtitles);
    fs.writeFileSync(subtitlePath, assContent, "utf8");

    const subtitleForFfmpeg = escapeFfmpegFilterPath(subtitlePath);

    /*
      좌표 안정성을 위해 360x640으로 먼저 맞춘 뒤 ASS를 입히고,
      마지막에 720x1280으로 확대합니다.
      이 구조가 프론트 360x640 편집 좌표와 가장 논리적으로 맞습니다.
    */
    const videoFilter = [
      `scale=${EDITOR_WIDTH}:${EDITOR_HEIGHT}:force_original_aspect_ratio=increase`,
      `crop=${EDITOR_WIDTH}:${EDITOR_HEIGHT}`,
      `ass='${subtitleForFfmpeg}'`,
      `scale=${OUTPUT_WIDTH}:${OUTPUT_HEIGHT}`
    ].join(",");

    const args = [
      "-y",
      "-i",
      inputPath,
      "-vf",
      videoFilter,
      "-c:v",
      "libx264",
      "-preset",
      "medium",
      "-crf",
      "18",
      "-pix_fmt",
      "yuv420p",
      "-c:a",
      "aac",
      "-b:a",
      "192k",
      "-movflags",
      "+faststart",
      outputPath
    ];

    await runFfmpeg(args);

    let callbackResult = null;

    if (isExternalMode) {
      callbackResult = await pushRenderedVideoToCallback({
        callbackUrl: externalMeta.callbackUrl,
        jobId: externalMeta.jobId,
        sessionId,
        outputPath
      });

      if (!callbackResult.skipped) {
        safeRemoveDir(sessionDirForCleanup);
      }

      return res.json({
        message: callbackResult.skipped
          ? "자막 합성 완료. callbackUrl이 없어 임시 파일은 유지되었습니다."
          : "자막 합성 완료. Hilite로 결과 전송 후 임시 파일을 삭제했습니다.",
        sessionId,
        jobId: externalMeta.jobId,
        externalMode: true,
        shouldClose: !callbackResult.skipped,
        callbackResult
      });
    }

    outputUrl = `${getPublicBaseUrl(req)}/uploads/output/${outputFilename}?t=${Date.now()}`;

    res.json({
      message: "자막 합성 완료",
      outputFilename,
      outputUrl,
      externalMode: false
    });
  } catch (error) {
    console.error("렌더링 실패:", error);

    if (sessionDirForCleanup && fs.existsSync(sessionDirForCleanup)) {
      try {
        const meta = readMeta(sessionDirForCleanup);

        writeMeta(sessionDirForCleanup, {
          ...meta,
          status: "render_or_callback_failed",
          failedAt: new Date().toISOString(),
          error: error.stderr || String(error)
        });
      } catch (metaError) {
        console.error("실패 meta 저장 실패:", metaError);
      }
    }

    res.status(500).json({
      message: "영상 렌더링 또는 callback 전송 실패",
      error: error.stderr || String(error)
    });
  }
});

app.listen(PORT, () => {
  console.log(`서버 실행 중: http://localhost:${PORT}`);
});