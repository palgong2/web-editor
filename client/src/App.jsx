import { useEffect, useRef, useState } from "react";

const API_BASE_URL =
  import.meta.env.VITE_API_BASE_URL || "http://localhost:4000";

function App() {
  const videoBoxRef = useRef(null);
  const editTextAreaRef = useRef(null);

  const [message, setMessage] = useState("");
  const [selectedFile, setSelectedFile] = useState(null);
  const [videoUrl, setVideoUrl] = useState("");
  const [filename, setFilename] = useState("");

  const [externalMode, setExternalMode] = useState(false);
  const [sessionId, setSessionId] = useState("");
  const [jobId, setJobId] = useState("");

  const [rendering, setRendering] = useState(false);
  const [saving, setSaving] = useState(false);
  const [outputUrl, setOutputUrl] = useState("");

  const [currentTime, setCurrentTime] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);

  const [subtitles, setSubtitles] = useState([]);
  const [selectedSubtitleId, setSelectedSubtitleId] = useState(null);
  const [editingSubtitleId, setEditingSubtitleId] = useState(null);

  const [editingText, setEditingText] = useState("");
  const [propertyText, setPropertyText] = useState("");
  const [propertyInputs, setPropertyInputs] = useState({});

  const [draggingId, setDraggingId] = useState(null);
  const [resizing, setResizing] = useState({
    id: null,
    direction: null
  });

  const [dragOffset, setDragOffset] = useState({ x: 0, y: 0 });

  const [resizeStart, setResizeStart] = useState({
    mouseX: 0,
    mouseY: 0,
    width: 220,
    height: 80,
    fontSize: 32
  });

  const EDITOR_WIDTH = 360;
  const EDITOR_HEIGHT = 640;

  const selectedSubtitle = subtitles.find(
    (subtitle) => subtitle.id === selectedSubtitleId
  );

  const clearPropertyPanel = () => {
    setPropertyInputs({});
    setPropertyText("");
  };

  const hasKoreanText = (text) => {
    return /[ㄱ-ㅎㅏ-ㅣ가-힣]/.test(String(text || ""));
  };

  const getWrappedLineCount = (text, width, fontSize) => {
    const safeText = String(text || "");
    const safeWidth = Math.max(1, Number(width) || 1);
    const safeFontSize = Math.max(1, Number(fontSize) || 1);

    const hasKorean = hasKoreanText(safeText);

    const estimatedCharWidth = hasKorean
      ? safeFontSize * 1.05
      : safeFontSize * 0.62;

    const maxCharsPerLine = Math.max(
      1,
      Math.floor(safeWidth / estimatedCharWidth)
    );

    const originalLines = safeText.replace(/\r\n/g, "\n").split("\n");

    let lineCount = 0;

    originalLines.forEach((line) => {
      const chars = Array.from(line);

      if (chars.length === 0) {
        lineCount += 1;
        return;
      }

      lineCount += Math.ceil(chars.length / maxCharsPerLine);
    });

    return Math.max(1, lineCount);
  };

  const getAutoFitFontSize = (subtitle, nextWidth, nextHeight) => {
    const text = String(subtitle.text || "새 자막");
    const width = Math.max(20, Number(nextWidth) || subtitle.width);
    const height = Math.max(20, Number(nextHeight) || subtitle.height);

    const paddingY = 8;
    const lineHeightRatio = 1.2;

    let bestFontSize = 4;

    for (let fontSize = 4; fontSize <= 300; fontSize += 1) {
      const lineCount = getWrappedLineCount(text, width - 8, fontSize);
      const requiredHeight = lineCount * fontSize * lineHeightRatio + paddingY;

      if (requiredHeight <= height) {
        bestFontSize = fontSize;
      } else {
        break;
      }
    }

    return bestFontSize;
  };

  const syncPropertyPanel = (subtitle) => {
    if (!subtitle) {
      clearPropertyPanel();
      return;
    }

    setPropertyInputs({
      x: String(subtitle.x),
      y: String(subtitle.y),
      width: String(subtitle.width),
      height: String(subtitle.height),
      fontSize: String(subtitle.fontSize),
      startTime: String(subtitle.startTime),
      endTime: String(subtitle.endTime)
    });

    setPropertyText(subtitle.text);
  };

  const loadExternalSession = async (nextSessionId) => {
    try {
      setMessage("외부 편집 세션을 불러오는 중입니다.");

      const response = await fetch(
        `${API_BASE_URL}/api/external/session/${encodeURIComponent(
          nextSessionId
        )}`
      );

      const data = await response.json();

      if (!response.ok) {
        console.error(data);
        setMessage(data.message || "외부 편집 세션 조회 실패");
        return;
      }

      setExternalMode(true);
      setSessionId(data.sessionId);
      setJobId(data.jobId || "");
      setVideoUrl(data.videoUrl);
      setFilename("");
      setSelectedFile(null);
      setCurrentTime(0);
      setIsPlaying(false);
      setOutputUrl("");
      setSubtitles(data.subtitles || []);
      setSelectedSubtitleId(null);
      setEditingSubtitleId(null);
      setEditingText("");
      clearPropertyPanel();

      setMessage("");
    } catch (error) {
      console.error(error);
      setMessage("외부 편집 세션 요청 실패");
    }
  };

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const querySessionId = params.get("session_id");

    if (querySessionId) {
      const timerId = setTimeout(() => {
        loadExternalSession(querySessionId);
      }, 0);

      return () => {
        clearTimeout(timerId);
      };
    }
  }, []);

  useEffect(() => {
    const handleKeyDown = (event) => {
      if (event.key === "Escape") {
        setEditingSubtitleId(null);
        setSelectedSubtitleId(null);
        setDraggingId(null);
        setResizing({
          id: null,
          direction: null
        });
        clearPropertyPanel();
      }
    };

    window.addEventListener("keydown", handleKeyDown);

    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, []);

  useEffect(() => {
    if (editingSubtitleId && editTextAreaRef.current) {
      setTimeout(() => {
        editTextAreaRef.current?.focus();
      }, 0);
    }
  }, [editingSubtitleId]);

  const handleFileChange = (event) => {
    setSelectedFile(event.target.files[0]);
    setMessage("파일 선택 완료");
  };

  const uploadVideo = async () => {
    if (!selectedFile) {
      setMessage("먼저 mp4 파일을 선택해 주세요.");
      return;
    }

    const formData = new FormData();
    formData.append("video", selectedFile);

    try {
      const response = await fetch(`${API_BASE_URL}/api/upload`, {
        method: "POST",
        body: formData
      });

      const data = await response.json();

      setExternalMode(false);
      setSessionId("");
      setJobId("");
      setMessage(data.message);
      setVideoUrl(data.videoUrl);
      setFilename(data.filename);
      setCurrentTime(0);
      setIsPlaying(false);
      setOutputUrl("");
      setSubtitles([]);
      setSelectedSubtitleId(null);
      setEditingSubtitleId(null);
      clearPropertyPanel();
    } catch (error) {
      console.error(error);
      setMessage("영상 업로드 실패");
    }
  };

  const addSubtitle = () => {
    const newSubtitle = {
      id: Date.now(),
      text: "새 자막",
      x: 70,
      y: 280,
      width: 220,
      height: 80,
      startTime: Number(currentTime.toFixed(3)),
      endTime: Number((currentTime + 3).toFixed(3)),
      fontSize: 32,
      textAlign: "center",
      fontFamily: "Noto Sans KR",
      color: "#ffffff",
      bold: true,
      italic: false
    };

    setSubtitles((prev) => [...prev, newSubtitle]);
    setSelectedSubtitleId(newSubtitle.id);
    setEditingSubtitleId(null);
    setEditingText("");
    syncPropertyPanel(newSubtitle);
    setMessage("자막이 추가되었습니다.");
  };

  const updateSubtitle = (id, field, value) => {
    setSubtitles((prevSubtitles) =>
      prevSubtitles.map((subtitle) => {
        if (subtitle.id !== id) {
          return subtitle;
        }

        return {
          ...subtitle,
          [field]: value
        };
      })
    );
  };

  const updateSubtitleWithLimit = (id, nextValues) => {
    const targetSubtitle = subtitles.find((subtitle) => subtitle.id === id);

    if (!targetSubtitle) {
      return;
    }

    const merged = {
      ...targetSubtitle,
      ...nextValues
    };

    const safeWidth = Number.isNaN(Number(merged.width))
      ? targetSubtitle.width
      : Number(merged.width);

    const safeHeight = Number.isNaN(Number(merged.height))
      ? targetSubtitle.height
      : Number(merged.height);

    const safeX = Number.isNaN(Number(merged.x))
      ? targetSubtitle.x
      : Number(merged.x);

    const safeY = Number.isNaN(Number(merged.y))
      ? targetSubtitle.y
      : Number(merged.y);

    const safeFontSize = Number.isNaN(Number(merged.fontSize))
      ? targetSubtitle.fontSize
      : Number(merged.fontSize);

    const safeStartTime = Number.isNaN(Number(merged.startTime))
      ? targetSubtitle.startTime
      : Number(merged.startTime);

    const safeEndTime = Number.isNaN(Number(merged.endTime))
      ? targetSubtitle.endTime
      : Number(merged.endTime);

    const limitedWidth = Math.max(20, Math.min(safeWidth, EDITOR_WIDTH));
    const limitedHeight = Math.max(20, Math.min(safeHeight, EDITOR_HEIGHT));

    const limitedX = Math.max(
      0,
      Math.min(safeX, EDITOR_WIDTH - limitedWidth)
    );

    const limitedY = Math.max(
      0,
      Math.min(safeY, EDITOR_HEIGHT - limitedHeight)
    );

    const limitedFontSize = Math.max(4, Math.min(safeFontSize, 300));

    const limitedStartTime = Math.max(0, safeStartTime);
    const limitedEndTime = Math.max(limitedStartTime + 0.1, safeEndTime);

    const updated = {
      ...merged,
      x: Math.round(limitedX),
      y: Math.round(limitedY),
      width: Math.round(limitedWidth),
      height: Math.round(limitedHeight),
      fontSize: Math.round(limitedFontSize),
      startTime: Number(limitedStartTime.toFixed(3)),
      endTime: Number(limitedEndTime.toFixed(3))
    };

    setSubtitles((prevSubtitles) =>
      prevSubtitles.map((subtitle) => {
        if (subtitle.id !== id) {
          return subtitle;
        }

        return updated;
      })
    );

    if (id === selectedSubtitleId) {
      setPropertyInputs({
        x: String(updated.x),
        y: String(updated.y),
        width: String(updated.width),
        height: String(updated.height),
        fontSize: String(updated.fontSize),
        startTime: String(updated.startTime),
        endTime: String(updated.endTime)
      });

      setPropertyText(updated.text);
    }
  };

  const startTextEdit = (subtitle) => {
    setSelectedSubtitleId(subtitle.id);
    setEditingSubtitleId(subtitle.id);
    setEditingText(subtitle.text);
    syncPropertyPanel(subtitle);
  };

  const commitPropertyText = () => {
    if (!selectedSubtitle) {
      return;
    }

    const nextSubtitle = {
      ...selectedSubtitle,
      text: propertyText
    };

    const nextFontSize = getAutoFitFontSize(
      nextSubtitle,
      selectedSubtitle.width,
      selectedSubtitle.height
    );

    updateSubtitleWithLimit(selectedSubtitle.id, {
      text: propertyText,
      fontSize: nextFontSize
    });
  };

  const handlePropertyInputChange = (field, value) => {
    setPropertyInputs((prev) => ({
      ...prev,
      [field]: value
    }));

    if (field === "fontSize" && selectedSubtitle) {
      const numberValue = Number(value);

      if (!Number.isNaN(numberValue)) {
        updateSubtitleWithLimit(selectedSubtitle.id, {
          fontSize: numberValue
        });
      }
    }
  };

  const applyPropertyInput = (field) => {
    if (!selectedSubtitle) {
      return;
    }

    const rawValue = propertyInputs[field];

    if (rawValue === "" || rawValue === "-" || rawValue === ".") {
      setPropertyInputs((prev) => ({
        ...prev,
        [field]: String(selectedSubtitle[field])
      }));
      return;
    }

    const numberValue = Number(rawValue);

    if (Number.isNaN(numberValue)) {
      setPropertyInputs((prev) => ({
        ...prev,
        [field]: String(selectedSubtitle[field])
      }));
      return;
    }

    if (field === "width" || field === "height") {
      const nextWidth =
        field === "width" ? numberValue : selectedSubtitle.width;

      const nextHeight =
        field === "height" ? numberValue : selectedSubtitle.height;

      const nextFontSize = getAutoFitFontSize(
        selectedSubtitle,
        nextWidth,
        nextHeight
      );

      updateSubtitleWithLimit(selectedSubtitle.id, {
        [field]: numberValue,
        fontSize: nextFontSize
      });

      return;
    }

    if (
      field === "x" ||
      field === "y" ||
      field === "fontSize" ||
      field === "startTime" ||
      field === "endTime"
    ) {
      updateSubtitleWithLimit(selectedSubtitle.id, {
        [field]: numberValue
      });
    }
  };

  const alignSubtitleToVideo = (id, alignType) => {
    const targetSubtitle = subtitles.find((subtitle) => subtitle.id === id);

    if (!targetSubtitle) {
      return;
    }

    let nextX = targetSubtitle.x;

    if (alignType === "left") {
      nextX = 0;
    }

    if (alignType === "center") {
      nextX = (EDITOR_WIDTH - targetSubtitle.width) / 2;
    }

    if (alignType === "right") {
      nextX = EDITOR_WIDTH - targetSubtitle.width;
    }

    updateSubtitleWithLimit(id, {
      x: nextX
    });
  };

  const changeFontSize = (id, amount) => {
    const targetSubtitle = subtitles.find((subtitle) => subtitle.id === id);

    if (!targetSubtitle) {
      return;
    }

    const nextFontSize = Math.max(
      4,
      Math.min(targetSubtitle.fontSize + amount, 300)
    );

    updateSubtitleWithLimit(id, {
      fontSize: nextFontSize
    });
  };

  const deleteSubtitle = (id) => {
    setSubtitles((prevSubtitles) =>
      prevSubtitles.filter((subtitle) => subtitle.id !== id)
    );

    if (selectedSubtitleId === id) {
      setSelectedSubtitleId(null);
    }

    if (editingSubtitleId === id) {
      setEditingSubtitleId(null);
    }

    setEditingText("");
    clearPropertyPanel();
    setMessage("자막이 삭제되었습니다.");
  };

  const handleSubtitleMouseDown = (event, subtitle) => {
    if (editingSubtitleId === subtitle.id) {
      return;
    }

    if (event.target.dataset.resizeHandle === "true") {
      return;
    }

    event.stopPropagation();

    const boxRect = videoBoxRef.current?.getBoundingClientRect();

    if (!boxRect) {
      return;
    }

    const mouseX = event.clientX - boxRect.left;
    const mouseY = event.clientY - boxRect.top;

    setSelectedSubtitleId(subtitle.id);
    setEditingSubtitleId(null);
    setDraggingId(subtitle.id);
    syncPropertyPanel(subtitle);

    setDragOffset({
      x: mouseX - subtitle.x,
      y: mouseY - subtitle.y
    });
  };

  const handleResizeMouseDown = (event, subtitle, direction) => {
    event.stopPropagation();

    setEditingSubtitleId(null);
    setSelectedSubtitleId(subtitle.id);
    syncPropertyPanel(subtitle);

    setResizing({
      id: subtitle.id,
      direction
    });

    setResizeStart({
      mouseX: event.clientX,
      mouseY: event.clientY,
      width: subtitle.width,
      height: subtitle.height,
      fontSize: subtitle.fontSize
    });
  };

  const handleMouseMove = (event) => {
    if (draggingId !== null) {
      const boxRect = videoBoxRef.current?.getBoundingClientRect();

      if (!boxRect) {
        return;
      }

      const mouseX = event.clientX - boxRect.left;
      const mouseY = event.clientY - boxRect.top;

      const newX = mouseX - dragOffset.x;
      const newY = mouseY - dragOffset.y;

      updateSubtitleWithLimit(draggingId, {
        x: newX,
        y: newY
      });
    }

    if (resizing.id !== null) {
      const targetSubtitle = subtitles.find(
        (subtitle) => subtitle.id === resizing.id
      );

      if (!targetSubtitle) {
        return;
      }

      const diffX = event.clientX - resizeStart.mouseX;
      const diffY = event.clientY - resizeStart.mouseY;

      let nextWidth = resizeStart.width;
      let nextHeight = resizeStart.height;

      if (resizing.direction === "right") {
        nextWidth = resizeStart.width + diffX;
      }

      if (resizing.direction === "bottom") {
        nextHeight = resizeStart.height + diffY;
      }

      if (resizing.direction === "corner") {
        nextWidth = resizeStart.width + diffX;
        nextHeight = resizeStart.height + diffY;
      }

      const minWidth = 20;
      const minHeight = 20;

      const maxWidth = EDITOR_WIDTH - targetSubtitle.x;
      const maxHeight = EDITOR_HEIGHT - targetSubtitle.y;

      const limitedNextWidth = Math.max(
        minWidth,
        Math.min(nextWidth, maxWidth)
      );

      const limitedNextHeight = Math.max(
        minHeight,
        Math.min(nextHeight, maxHeight)
      );

      const nextSubtitle = {
        ...targetSubtitle,
        width: limitedNextWidth,
        height: limitedNextHeight
      };

      const nextFontSize = getAutoFitFontSize(
        nextSubtitle,
        limitedNextWidth,
        limitedNextHeight
      );

      updateSubtitleWithLimit(resizing.id, {
        width: limitedNextWidth,
        height: limitedNextHeight,
        fontSize: nextFontSize
      });
    }
  };

  const handleMouseUp = () => {
    setDraggingId(null);
    setResizing({
      id: null,
      direction: null
    });
  };

  const getSubtitlesForRender = () => {
    return subtitles.map((subtitle) => {
      if (subtitle.id === editingSubtitleId) {
        return {
          ...subtitle,
          text: editingText
        };
      }

      if (subtitle.id === selectedSubtitleId) {
        return {
          ...subtitle,
          text: propertyText || subtitle.text
        };
      }

      return subtitle;
    });
  };

  const previewVideo = async () => {
    const renderSubtitles = getSubtitlesForRender();

    if (!externalMode && !filename) {
      setMessage("먼저 영상을 업로드해 주세요.");
      return;
    }

    if (externalMode && !sessionId) {
      setMessage("외부 편집 세션이 없습니다.");
      return;
    }

    if (renderSubtitles.length === 0) {
      setMessage("자막을 하나 이상 추가해 주세요.");
      return;
    }

    try {
      setRendering(true);
      setOutputUrl("");
      setMessage("결과 미리보기를 생성하는 중입니다.");

      const response = await fetch(`${API_BASE_URL}/api/render`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          mode: "preview",
          filename: externalMode ? undefined : filename,
          sessionId: externalMode ? sessionId : undefined,
          subtitles: renderSubtitles
        })
      });

      const data = await response.json();

      if (!response.ok) {
        console.error(data);
        setMessage(data.message || "결과 미리보기 생성 실패");
        return;
      }

      setOutputUrl(data.outputUrl);
      setMessage("결과 미리보기가 생성되었습니다.");
    } catch (error) {
      console.error(error);
      setMessage("결과 미리보기 요청 실패");
    } finally {
      setRendering(false);
    }
  };

  const saveFinalVideo = async () => {
    const renderSubtitles = getSubtitlesForRender();

    if (!externalMode) {
      setMessage("직접 업로드 모드에서는 결과 영상을 다운로드해서 사용하세요.");
      return;
    }

    if (!sessionId) {
      setMessage("외부 편집 세션이 없습니다.");
      return;
    }

    if (!outputUrl) {
      setMessage("먼저 결과 미리보기를 생성해 주세요.");
      return;
    }

    try {
      setSaving(true);
      setMessage("원본 시스템으로 저장 중입니다.");

      const response = await fetch(`${API_BASE_URL}/api/render`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          mode: "save",
          useExistingOutput: true,
          sessionId,
          subtitles: renderSubtitles
        })
      });

      const data = await response.json();

      if (!response.ok) {
        console.error(data);
        setMessage(data.message || "저장 실패");
        return;
      }

      setMessage(data.message || "저장 완료");

      if (data.shouldClose) {
        setTimeout(() => {
          window.close();
        }, 800);
      }
    } catch (error) {
      console.error(error);
      setMessage("저장 요청 실패");
    } finally {
      setSaving(false);
    }
  };

  const renderNumberInput = (field) => {
    return (
      <input
        type="text"
        value={propertyInputs[field] ?? ""}
        onChange={(event) =>
          handlePropertyInputChange(field, event.target.value)
        }
        onBlur={() => applyPropertyInput(field)}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            applyPropertyInput(field);
            event.currentTarget.blur();
          }
        }}
        style={styles.input}
      />
    );
  };

  const renderBusyOverlay = () => {
    const visible = rendering || saving;

    if (!visible) {
      return null;
    }

    const title = rendering ? "미리보기 생성중입니다" : "저장중입니다";
    const description = rendering
      ? "잠시만 기다려주세요"
      : "원본 시스템으로 결과 영상을 전송하고 있습니다";

    return (
      <div style={styles.overlay}>
        <div style={styles.overlayCard}>
          <div style={styles.spinner} />
          <div style={styles.overlayTitle}>{title}</div>
          <div style={styles.overlayDescription}>{description}</div>
        </div>
      </div>
    );
  };

  const renderVideoCanvas = () => {
    if (!videoUrl) {
      return (
        <div style={styles.emptyCanvas}>
          {!externalMode && (
            <div style={styles.uploadBlock}>
              <div style={styles.emptyTitle}>MP4 영상을 업로드하세요</div>
              <div style={styles.uploadRow}>
                <input type="file" accept="video/mp4" onChange={handleFileChange} />
                <button style={styles.primaryButton} onClick={uploadVideo}>
                  영상 업로드
                </button>
              </div>
            </div>
          )}

          {externalMode && (
            <div style={styles.emptyTitle}>편집 세션을 불러오는 중입니다.</div>
          )}
        </div>
      );
    }

    return (
      <div
        ref={videoBoxRef}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
        onClick={() => {
          setEditingSubtitleId(null);
          setSelectedSubtitleId(null);
          clearPropertyPanel();
        }}
        style={styles.videoBox}
      >
        <video
          src={videoUrl}
          controls
          width={EDITOR_WIDTH}
          height={EDITOR_HEIGHT}
          onTimeUpdate={(event) => {
            setCurrentTime(event.currentTarget.currentTime);
          }}
          onPlay={() => {
            setIsPlaying(true);
          }}
          onPause={() => {
            setIsPlaying(false);
          }}
          onEnded={() => {
            setIsPlaying(false);
          }}
          style={styles.video}
        />

        {subtitles.map((subtitle) => {
          const isSelected = subtitle.id === selectedSubtitleId;
          const isEditing = subtitle.id === editingSubtitleId;
          const displayText = isEditing ? editingText : subtitle.text;

          const subtitleStartTime = Number(subtitle.startTime);
          const subtitleEndTime = Number(subtitle.endTime);

          const isInTimeRange =
            currentTime >= subtitleStartTime && currentTime <= subtitleEndTime;

          const shouldShowSubtitle =
            isInTimeRange || (!isPlaying && isSelected) || isEditing;

          if (!shouldShowSubtitle) {
            return null;
          }

          return (
            <div
              key={subtitle.id}
              onMouseDown={(event) => handleSubtitleMouseDown(event, subtitle)}
              onClick={(event) => {
                event.stopPropagation();
                setSelectedSubtitleId(subtitle.id);
                syncPropertyPanel(subtitle);
              }}
              onDoubleClick={(event) => {
                event.stopPropagation();
                startTextEdit(subtitle);
              }}
              style={{
                ...styles.subtitleBox,
                left: `${subtitle.x}px`,
                top: `${subtitle.y}px`,
                width: `${subtitle.width}px`,
                height: `${subtitle.height}px`,
                border: isSelected
                  ? "2px solid #38bdf8"
                  : "1px dashed transparent",
                backgroundColor: isSelected
                  ? "rgba(56, 189, 248, 0.12)"
                  : "transparent",
                cursor: isEditing ? "text" : "move"
              }}
            >
              {isEditing ? (
                <textarea
                  ref={editTextAreaRef}
                  value={editingText}
                  onChange={(event) => setEditingText(event.target.value)}
                  onClick={(event) => event.stopPropagation()}
                  onMouseDown={(event) => event.stopPropagation()}
                  onBlur={() => {
                    const nextSubtitle = {
                      ...subtitle,
                      text: editingText
                    };

                    const nextFontSize = getAutoFitFontSize(
                      nextSubtitle,
                      subtitle.width,
                      subtitle.height
                    );

                    updateSubtitleWithLimit(subtitle.id, {
                      text: editingText,
                      fontSize: nextFontSize
                    });

                    setPropertyText(editingText);
                    setEditingSubtitleId(null);
                  }}
                  spellCheck={false}
                  style={{
                    ...styles.subtitleTextArea,
                    color: subtitle.color || "#ffffff",
                    fontSize: `${subtitle.fontSize}px`,
                    fontWeight: subtitle.bold ? "bold" : "normal",
                    fontStyle: subtitle.italic ? "italic" : "normal",
                    textAlign: subtitle.textAlign,
                    fontFamily: subtitle.fontFamily || "Noto Sans KR"
                  }}
                />
              ) : (
                <div
                  style={{
                    ...styles.subtitleText,
                    color: subtitle.color || "#ffffff",
                    fontSize: `${subtitle.fontSize}px`,
                    fontWeight: subtitle.bold ? "bold" : "normal",
                    fontStyle: subtitle.italic ? "italic" : "normal",
                    textAlign: subtitle.textAlign,
                    fontFamily: subtitle.fontFamily || "Noto Sans KR"
                  }}
                >
                  {displayText}
                </div>
              )}

              {isSelected && !isEditing && (
                <>
                  <div
                    data-resize-handle="true"
                    onMouseDown={(event) =>
                      handleResizeMouseDown(event, subtitle, "right")
                    }
                    style={styles.resizeRight}
                  />
                  <div
                    data-resize-handle="true"
                    onMouseDown={(event) =>
                      handleResizeMouseDown(event, subtitle, "bottom")
                    }
                    style={styles.resizeBottom}
                  />
                  <div
                    data-resize-handle="true"
                    onMouseDown={(event) =>
                      handleResizeMouseDown(event, subtitle, "corner")
                    }
                    style={styles.resizeCorner}
                  />
                </>
              )}
            </div>
          );
        })}
      </div>
    );
  };

  return (
    <div style={styles.page}>
      <style>{`
        * { box-sizing: border-box; }
        @keyframes caption-editor-spin {
          0% { transform: rotate(0deg); }
          100% { transform: rotate(360deg); }
        }
      `}</style>

      {renderBusyOverlay()}

      <main style={styles.layout}>
        <section style={styles.leftPanel}>
          <div style={styles.topBar}>
            <div>
              <div style={styles.projectTitle}>Caption Editor</div>
              <div style={styles.projectMeta}>
                {externalMode ? `JOB ${jobId || "-"}` : "Direct Upload Mode"} ·{" "}
                {currentTime.toFixed(1)}s
              </div>
            </div>

            <div style={styles.topActions}>
              {!externalMode && !videoUrl && (
                <>
                  <input
                    type="file"
                    accept="video/mp4"
                    onChange={handleFileChange}
                    style={styles.fileInput}
                  />
                  <button style={styles.secondaryTopButton} onClick={uploadVideo}>
                    영상 업로드
                  </button>
                </>
              )}

              <button
                onClick={previewVideo}
                disabled={rendering || !videoUrl}
                style={{
                  ...styles.primaryButton,
                  opacity: rendering || !videoUrl ? 0.55 : 1
                }}
              >
                {rendering ? "미리보기 생성 중..." : "결과 미리보기"}
              </button>
            </div>
          </div>

          {message && <div style={styles.message}>{message}</div>}

          <div style={styles.workspaceCard}>
            <div style={styles.workspaceHeader}>
              <div style={styles.workspaceTitle}>편집 작업공간</div>
              <div style={styles.workspaceMeta}>
                왼쪽은 원본 편집, 오른쪽은 결과 미리보기입니다
              </div>
            </div>

            <div style={styles.workspaceGrid}>
              <div style={styles.videoStageCard}>
                <div style={styles.panelHeader}>
                  <span>원본 영상</span>
                  <span style={styles.panelSubText}>360×640 편집 기준</span>
                </div>

                <div style={styles.stageBody}>{renderVideoCanvas()}</div>
              </div>

              <div style={styles.previewStageCard}>
                <div style={styles.panelHeader}>
                  <span>결과 미리보기</span>
                  <span style={styles.panelSubText}>720×1280 출력 기준</span>
                </div>

                <div style={styles.previewStageBody}>
                  {!outputUrl && (
                    <div style={styles.previewEmpty}>
                      결과 미리보기를 생성하면 이 영역에 영상이 표시됩니다.
                    </div>
                  )}

                  {outputUrl && (
                    <>
                      <div style={styles.previewVideoFrame}>
                        <video
                          src={outputUrl}
                          controls
                          style={styles.previewVideo}
                        />
                      </div>

                      <div style={styles.previewActionBar}>
                        {externalMode ? (
                          <button
                            onClick={saveFinalVideo}
                            disabled={saving}
                            style={{
                              ...styles.saveButton,
                              opacity: saving ? 0.55 : 1
                            }}
                          >
                            {saving ? "저장 중..." : "저장"}
                          </button>
                        ) : (
                          <a href={outputUrl} download style={styles.downloadButton}>
                            결과 영상 다운로드
                          </a>
                        )}
                      </div>
                    </>
                  )}
                </div>
              </div>
            </div>
          </div>
        </section>

        <aside style={styles.rightPanel}>
          <section style={styles.subtitleListPanel}>
            <div style={styles.sideHeader}>
              <div>
                <div style={styles.sideTitle}>자막 목록</div>
                <div style={styles.sideSubTitle}>{subtitles.length}개</div>
              </div>

              <button
                onClick={addSubtitle}
                disabled={!videoUrl}
                style={styles.smallButton}
              >
                + 자막 추가
              </button>
            </div>

            <div style={styles.subtitleList}>
              {subtitles.length === 0 && (
                <div style={styles.emptySideText}>자막이 없습니다.</div>
              )}

              {subtitles.map((subtitle, index) => (
                <button
                  key={subtitle.id}
                  onClick={() => {
                    setSelectedSubtitleId(subtitle.id);
                    setEditingSubtitleId(null);
                    syncPropertyPanel(subtitle);
                  }}
                  style={{
                    ...styles.subtitleItem,
                    borderColor:
                      subtitle.id === selectedSubtitleId ? "#38bdf8" : "#1f2937",
                    backgroundColor:
                      subtitle.id === selectedSubtitleId ? "#0f2f44" : "#111827"
                  }}
                >
                  <div style={styles.subtitleItemTop}>
                    <span>#{index + 1}</span>
                    <span>
                      {subtitle.startTime}s - {subtitle.endTime}s
                    </span>
                  </div>
                  <div style={styles.subtitleItemText}>{subtitle.text}</div>
                </button>
              ))}
            </div>
          </section>

          <section style={styles.editorPanel}>
            <div style={styles.sideHeader}>
              <div>
                <div style={styles.sideTitle}>자막 편집</div>
                <div style={styles.sideSubTitle}>
                  {selectedSubtitle ? "선택된 자막 속성" : "자막을 선택하세요"}
                </div>
              </div>
            </div>

            {!selectedSubtitle && (
              <div style={styles.emptySideText}>
                오른쪽 위 자막 목록에서 항목을 선택하면 이 영역에서 편집할 수 있습니다.
              </div>
            )}

            {selectedSubtitle && (
              <div style={styles.form}>
                <label style={styles.label}>내용</label>
                <textarea
                  value={propertyText}
                  onChange={(event) => setPropertyText(event.target.value)}
                  onBlur={commitPropertyText}
                  style={styles.propertyTextarea}
                />

                <div style={styles.formGrid}>
                  <div>
                    <label style={styles.label}>X</label>
                    {renderNumberInput("x")}
                  </div>
                  <div>
                    <label style={styles.label}>Y</label>
                    {renderNumberInput("y")}
                  </div>
                  <div>
                    <label style={styles.label}>너비</label>
                    {renderNumberInput("width")}
                  </div>
                  <div>
                    <label style={styles.label}>높이</label>
                    {renderNumberInput("height")}
                  </div>
                  <div>
                    <label style={styles.label}>시작 시간</label>
                    {renderNumberInput("startTime")}
                  </div>
                  <div>
                    <label style={styles.label}>종료 시간</label>
                    {renderNumberInput("endTime")}
                  </div>
                </div>

                <label style={styles.label}>글자 크기</label>
                <div style={styles.inlineRow}>
                  <button
                    onClick={() => changeFontSize(selectedSubtitle.id, -4)}
                    style={styles.secondaryButton}
                  >
                    작게
                  </button>
                  {renderNumberInput("fontSize")}
                  <button
                    onClick={() => changeFontSize(selectedSubtitle.id, 4)}
                    style={styles.secondaryButton}
                  >
                    크게
                  </button>
                </div>

                <label style={styles.label}>비디오 기준 정렬</label>
                <div style={styles.inlineRow}>
                  <button
                    onClick={() =>
                      alignSubtitleToVideo(selectedSubtitle.id, "left")
                    }
                    style={styles.secondaryButton}
                  >
                    왼쪽
                  </button>
                  <button
                    onClick={() =>
                      alignSubtitleToVideo(selectedSubtitle.id, "center")
                    }
                    style={styles.secondaryButton}
                  >
                    가운데
                  </button>
                  <button
                    onClick={() =>
                      alignSubtitleToVideo(selectedSubtitle.id, "right")
                    }
                    style={styles.secondaryButton}
                  >
                    오른쪽
                  </button>
                </div>

                <label style={styles.label}>박스 내부 정렬</label>
                <div style={styles.inlineRow}>
                  <button
                    onClick={() =>
                      updateSubtitle(selectedSubtitle.id, "textAlign", "left")
                    }
                    style={styles.secondaryButton}
                  >
                    왼쪽
                  </button>
                  <button
                    onClick={() =>
                      updateSubtitle(selectedSubtitle.id, "textAlign", "center")
                    }
                    style={styles.secondaryButton}
                  >
                    가운데
                  </button>
                  <button
                    onClick={() =>
                      updateSubtitle(selectedSubtitle.id, "textAlign", "right")
                    }
                    style={styles.secondaryButton}
                  >
                    오른쪽
                  </button>
                </div>

                <div style={styles.inlineRow}>
                  <label style={styles.colorLabel}>
                    색상
                    <input
                      type="color"
                      value={selectedSubtitle.color || "#ffffff"}
                      onChange={(event) =>
                        updateSubtitle(
                          selectedSubtitle.id,
                          "color",
                          event.target.value
                        )
                      }
                      style={styles.colorInput}
                    />
                  </label>

                  <button
                    onClick={() =>
                      updateSubtitle(
                        selectedSubtitle.id,
                        "bold",
                        !selectedSubtitle.bold
                      )
                    }
                    style={{
                      ...styles.secondaryButton,
                      borderColor: selectedSubtitle.bold ? "#38bdf8" : "#334155"
                    }}
                  >
                    굵게
                  </button>

                  <button
                    onClick={() =>
                      updateSubtitle(
                        selectedSubtitle.id,
                        "italic",
                        !selectedSubtitle.italic
                      )
                    }
                    style={{
                      ...styles.secondaryButton,
                      borderColor: selectedSubtitle.italic ? "#38bdf8" : "#334155"
                    }}
                  >
                    기울임
                  </button>
                </div>

                <button
                  onClick={() => deleteSubtitle(selectedSubtitle.id)}
                  style={styles.dangerButton}
                >
                  선택 자막 삭제
                </button>
              </div>
            )}
          </section>
        </aside>
      </main>
    </div>
  );
}

const styles = {
  page: {
    minHeight: "100vh",
    backgroundColor: "#e5e7eb",
    color: "#e5e7eb",
    fontFamily:
      "Noto Sans KR, Malgun Gothic, system-ui, -apple-system, BlinkMacSystemFont, sans-serif"
  },
  layout: {
    display: "grid",
    gridTemplateColumns: "3fr 1fr",
    gap: "16px",
    minHeight: "100vh",
    padding: "16px",
    maxWidth: "1400px",
    margin: "0 auto"
  },
  leftPanel: {
    minWidth: 0,
    display: "grid",
    gridTemplateRows: "auto auto 1fr",
    gap: "12px"
  },
  rightPanel: {
    minWidth: "300px",
    display: "grid",
    gridTemplateRows: "1.1fr 0.9fr",
    gap: "12px",
    minHeight: 0
  },
  topBar: {
    minHeight: "72px",
    border: "1px solid #1f2937",
    borderRadius: "18px",
    backgroundColor: "#07122b",
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    padding: "14px 18px",
    gap: "16px"
  },
  topActions: {
    display: "flex",
    gap: "10px",
    alignItems: "center",
    flexWrap: "wrap",
    justifyContent: "flex-end"
  },
  fileInput: {
    color: "#cbd5e1",
    fontSize: "12px"
  },
  projectTitle: {
    fontSize: "22px",
    fontWeight: 800,
    color: "#f8fafc"
  },
  projectMeta: {
    marginTop: "4px",
    fontSize: "12px",
    color: "#94a3b8"
  },
  message: {
    border: "1px solid #1e3a8a",
    backgroundColor: "#08204a",
    color: "#dbeafe",
    borderRadius: "14px",
    padding: "12px 14px",
    fontSize: "13px",
    textAlign: "center",
    fontWeight: 600
  },
  workspaceCard: {
    border: "1px solid #1f2937",
    borderRadius: "18px",
    backgroundColor: "#07122b",
    padding: "16px",
    minHeight: 0,
    display: "grid",
    gridTemplateRows: "auto 1fr",
    gap: "14px"
  },
  workspaceHeader: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "flex-end",
    gap: "12px",
    paddingBottom: "4px"
  },
  workspaceTitle: {
    fontSize: "18px",
    fontWeight: 800,
    color: "#f8fafc"
  },
  workspaceMeta: {
    fontSize: "12px",
    color: "#94a3b8"
  },
  workspaceGrid: {
    display: "grid",
    gridTemplateColumns: "1.15fr 0.95fr",
    gap: "16px",
    alignItems: "stretch",
    minHeight: 0
  },
  videoStageCard: {
    border: "1px solid #1f2937",
    borderRadius: "16px",
    backgroundColor: "#081631",
    display: "grid",
    gridTemplateRows: "auto 1fr",
    overflow: "hidden",
    minHeight: 0
  },
  previewStageCard: {
    border: "1px solid #1f2937",
    borderRadius: "16px",
    backgroundColor: "#081631",
    display: "grid",
    gridTemplateRows: "auto 1fr",
    overflow: "hidden",
    minHeight: 0
  },
  panelHeader: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    padding: "14px 16px",
    borderBottom: "1px solid #1f2937",
    fontWeight: 700,
    color: "#f8fafc"
  },
  panelSubText: {
    fontSize: "12px",
    color: "#94a3b8",
    fontWeight: 500
  },
  stageBody: {
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    padding: "16px",
    minHeight: 0
  },
  previewStageBody: {
    display: "grid",
    gridTemplateRows: "1fr auto",
    gap: "14px",
    padding: "16px",
    minHeight: 0
  },
  emptyCanvas: {
    width: "100%",
    height: "100%",
    minHeight: "680px",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    color: "#94a3b8"
  },
  uploadBlock: {
    display: "grid",
    gap: "16px",
    justifyItems: "center"
  },
  emptyTitle: {
    fontSize: "18px",
    fontWeight: 700,
    textAlign: "center"
  },
  uploadRow: {
    display: "flex",
    gap: "10px",
    alignItems: "center",
    flexWrap: "wrap",
    justifyContent: "center"
  },
  videoBox: {
    position: "relative",
    width: "360px",
    height: "640px",
    border: "1px solid #334155",
    borderRadius: "10px",
    userSelect: "none",
    overflow: "hidden",
    backgroundColor: "black",
    boxShadow: "0 20px 48px rgba(0,0,0,0.35)"
  },
  video: {
    display: "block",
    width: "360px",
    height: "640px",
    objectFit: "cover"
  },
  subtitleBox: {
    position: "absolute",
    boxSizing: "border-box"
  },
  subtitleText: {
    width: "100%",
    height: "100%",
    textShadow: "none",
    boxSizing: "border-box",
    padding: "4px",
    lineHeight: "1.2",
    whiteSpace: "pre-wrap",
    wordBreak: "break-word",
    overflow: "hidden",
    pointerEvents: "none"
  },
  subtitleTextArea: {
    width: "100%",
    height: "100%",
    border: "none",
    outline: "1px solid white",
    resize: "none",
    overflow: "hidden",
    backgroundColor: "transparent",
    textShadow: "none",
    boxSizing: "border-box",
    padding: "4px",
    lineHeight: "1.2",
    whiteSpace: "pre-wrap",
    wordBreak: "break-word",
    cursor: "text"
  },
  resizeRight: {
    position: "absolute",
    right: "-5px",
    top: 0,
    width: "10px",
    height: "100%",
    cursor: "ew-resize",
    backgroundColor: "rgba(56, 189, 248, 0.45)"
  },
  resizeBottom: {
    position: "absolute",
    left: 0,
    bottom: "-5px",
    width: "100%",
    height: "10px",
    cursor: "ns-resize",
    backgroundColor: "rgba(56, 189, 248, 0.45)"
  },
  resizeCorner: {
    position: "absolute",
    right: "-7px",
    bottom: "-7px",
    width: "14px",
    height: "14px",
    backgroundColor: "#38bdf8",
    border: "1px solid #020617",
    cursor: "nwse-resize",
    zIndex: 10
  },
  previewEmpty: {
    width: "100%",
    height: "100%",
    minHeight: "560px",
    border: "1px dashed #334155",
    borderRadius: "14px",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    color: "#64748b",
    fontSize: "14px",
    textAlign: "center",
    padding: "20px"
  },
  previewVideoFrame: {
    width: "100%",
    minHeight: 0,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#030712",
    border: "1px solid #1f2937",
    borderRadius: "14px",
    padding: "18px"
  },
  previewVideo: {
    width: "100%",
    maxWidth: "420px",
    aspectRatio: "9 / 16",
    objectFit: "cover",
    borderRadius: "12px",
    backgroundColor: "black",
    boxShadow: "0 16px 40px rgba(0,0,0,0.35)"
  },
  previewActionBar: {
    display: "flex",
    justifyContent: "center",
    alignItems: "center",
    paddingTop: "6px"
  },
  subtitleListPanel: {
    border: "1px solid #1f2937",
    borderRadius: "16px",
    backgroundColor: "#07122b",
    overflow: "hidden",
    minHeight: 0,
    display: "flex",
    flexDirection: "column"
  },
  editorPanel: {
    border: "1px solid #1f2937",
    borderRadius: "16px",
    backgroundColor: "#07122b",
    overflow: "hidden",
    minHeight: 0,
    display: "flex",
    flexDirection: "column"
  },
  sideHeader: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    padding: "14px",
    borderBottom: "1px solid #1f2937"
  },
  sideTitle: {
    fontSize: "16px",
    fontWeight: 800,
    color: "#f8fafc"
  },
  sideSubTitle: {
    marginTop: "4px",
    color: "#94a3b8",
    fontSize: "12px"
  },
  subtitleList: {
    padding: "12px",
    overflowY: "auto",
    display: "flex",
    flexDirection: "column",
    gap: "8px"
  },
  subtitleItem: {
    textAlign: "left",
    color: "#e5e7eb",
    border: "1px solid #1f2937",
    borderRadius: "12px",
    padding: "10px",
    cursor: "pointer"
  },
  subtitleItemTop: {
    display: "flex",
    justifyContent: "space-between",
    color: "#94a3b8",
    fontSize: "11px",
    marginBottom: "6px"
  },
  subtitleItemText: {
    fontSize: "13px",
    lineHeight: "1.45",
    whiteSpace: "pre-wrap"
  },
  emptySideText: {
    padding: "18px",
    color: "#64748b",
    fontSize: "13px",
    lineHeight: "1.5",
    textAlign: "center"
  },
  form: {
    padding: "14px",
    overflowY: "auto",
    display: "flex",
    flexDirection: "column",
    gap: "10px"
  },
  formGrid: {
    display: "grid",
    gridTemplateColumns: "1fr 1fr",
    gap: "10px"
  },
  label: {
    display: "block",
    color: "#94a3b8",
    fontSize: "12px",
    marginBottom: "5px"
  },
  input: {
    width: "100%",
    backgroundColor: "#020617",
    color: "#e5e7eb",
    border: "1px solid #334155",
    borderRadius: "10px",
    padding: "9px 10px",
    outline: "none"
  },
  propertyTextarea: {
    width: "100%",
    minHeight: "88px",
    backgroundColor: "#020617",
    color: "#e5e7eb",
    border: "1px solid #334155",
    borderRadius: "10px",
    padding: "10px",
    resize: "vertical",
    outline: "none",
    fontFamily: "inherit"
  },
  inlineRow: {
    display: "flex",
    gap: "8px",
    alignItems: "center",
    flexWrap: "wrap"
  },
  primaryButton: {
    border: "none",
    borderRadius: "999px",
    padding: "12px 18px",
    backgroundColor: "#38bdf8",
    color: "#020617",
    fontWeight: 800,
    cursor: "pointer",
    minWidth: "130px"
  },
  secondaryTopButton: {
    border: "1px solid #334155",
    borderRadius: "999px",
    padding: "10px 14px",
    backgroundColor: "#111827",
    color: "#e5e7eb",
    fontWeight: 700,
    cursor: "pointer"
  },
  smallButton: {
    border: "1px solid #38bdf8",
    borderRadius: "999px",
    padding: "8px 12px",
    backgroundColor: "transparent",
    color: "#7dd3fc",
    fontWeight: 700,
    cursor: "pointer"
  },
  secondaryButton: {
    border: "1px solid #334155",
    borderRadius: "10px",
    padding: "8px 10px",
    backgroundColor: "#111827",
    color: "#e5e7eb",
    cursor: "pointer"
  },
  saveButton: {
    border: "none",
    borderRadius: "12px",
    padding: "14px 26px",
    backgroundColor: "#22c55e",
    color: "#052e16",
    fontWeight: 900,
    cursor: "pointer",
    minWidth: "180px",
    fontSize: "15px"
  },
  downloadButton: {
    display: "inline-block",
    textDecoration: "none",
    borderRadius: "12px",
    padding: "14px 26px",
    backgroundColor: "#22c55e",
    color: "#052e16",
    fontWeight: 900,
    minWidth: "220px",
    textAlign: "center"
  },
  dangerButton: {
    marginTop: "6px",
    border: "1px solid #7f1d1d",
    borderRadius: "10px",
    padding: "10px",
    backgroundColor: "#450a0a",
    color: "#fecaca",
    cursor: "pointer",
    fontWeight: 700
  },
  colorLabel: {
    display: "flex",
    alignItems: "center",
    gap: "8px",
    color: "#94a3b8",
    fontSize: "12px"
  },
  colorInput: {
    width: "34px",
    height: "34px",
    border: "none",
    backgroundColor: "transparent"
  },
  overlay: {
    position: "fixed",
    inset: 0,
    backgroundColor: "rgba(107, 114, 128, 0.55)",
    backdropFilter: "blur(3px)",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    zIndex: 9999
  },
  overlayCard: {
    minWidth: "320px",
    maxWidth: "420px",
    padding: "28px 26px",
    borderRadius: "18px",
    backgroundColor: "#ffffff",
    boxShadow: "0 20px 50px rgba(0, 0, 0, 0.2)",
    display: "grid",
    justifyItems: "center",
    gap: "14px",
    textAlign: "center"
  },
  spinner: {
    width: "56px",
    height: "56px",
    borderRadius: "50%",
    border: "6px solid #dbeafe",
    borderTopColor: "#2563eb",
    animation: "caption-editor-spin 0.9s linear infinite"
  },
  overlayTitle: {
    fontSize: "20px",
    fontWeight: 800,
    color: "#111827"
  },
  overlayDescription: {
    fontSize: "14px",
    color: "#4b5563",
    lineHeight: 1.6
  }
};

export default App;