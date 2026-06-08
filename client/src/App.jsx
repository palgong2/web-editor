import { useEffect, useRef, useState } from "react";

const API_BASE_URL =
  import.meta.env.VITE_API_BASE_URL || "http://localhost:4000";

function App() {
  const videoBoxRef = useRef(null);
  const editTextAreaRef = useRef(null);

  const [message, setMessage] = useState("영상을 업로드해 주세요.");
  const [selectedFile, setSelectedFile] = useState(null);
  const [videoUrl, setVideoUrl] = useState("");
  const [filename, setFilename] = useState("");

  const [externalMode, setExternalMode] = useState(false);
  const [sessionId, setSessionId] = useState("");
  const [jobId, setJobId] = useState("");

  const [rendering, setRendering] = useState(false);
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

      setMessage("외부 편집 세션을 불러왔습니다.");
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
      fontFamily: "Malgun Gothic",
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

    const boxRect = videoBoxRef.current.getBoundingClientRect();

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

  const showSubtitleData = () => {
    const renderSubtitles = getSubtitlesForRender();

    console.log({
      filename,
      sessionId,
      jobId,
      externalMode,
      subtitles: renderSubtitles
    });

    setMessage("현재 자막 데이터가 콘솔에 출력되었습니다.");
  };

  const renderVideo = async () => {
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
      setMessage(
        externalMode
          ? "영상 렌더링 후 원본 시스템으로 전송 중입니다."
          : "영상 렌더링 중입니다."
      );

      const response = await fetch(`${API_BASE_URL}/api/render`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          filename: externalMode ? undefined : filename,
          sessionId: externalMode ? sessionId : undefined,
          subtitles: renderSubtitles
        })
      });

      const data = await response.json();

      if (!response.ok) {
        console.error(data);
        setMessage(data.message || "렌더링 실패");
        return;
      }

      if (externalMode) {
        setMessage(data.message || "저장 완료");

        if (data.shouldClose) {
          setTimeout(() => {
            window.close();
          }, 800);
        }

        return;
      }

      setOutputUrl(data.outputUrl);
      setMessage(data.message);
    } catch (error) {
      console.error(error);
      setMessage("렌더링 요청 실패");
    } finally {
      setRendering(false);
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
        style={{
          width: "80px",
          padding: "6px"
        }}
      />
    );
  };

  return (
    <div style={{ padding: "40px", fontFamily: "Malgun Gothic" }}>
      <h1>웹 기반 자막 편집기</h1>

      <p>{message}</p>

      {externalMode && (
        <div
          style={{
            border: "1px solid #ddd",
            padding: "10px",
            marginBottom: "20px",
            backgroundColor: "#f7f7f7"
          }}
        >
          <strong>외부 편집 모드</strong>
          <div style={{ fontSize: "13px", marginTop: "6px" }}>
            sessionId: {sessionId}
          </div>
          <div style={{ fontSize: "13px" }}>jobId: {jobId}</div>
          <div style={{ fontSize: "13px", marginTop: "6px" }}>
            저장을 누르면 결과 영상이 원본 시스템으로 전송되고, 성공 시 창이
            닫힙니다.
          </div>
        </div>
      )}

      {!externalMode && (
        <>
          <input type="file" accept="video/mp4" onChange={handleFileChange} />

          <br />
          <br />

          <button onClick={uploadVideo}>영상 업로드</button>
        </>
      )}

      {videoUrl && (
        <div style={{ marginTop: "30px" }}>
          <h2>9:16 영상 미리보기</h2>

          <button onClick={addSubtitle}>+ 자막 추가</button>

          <button
            onClick={renderVideo}
            disabled={rendering}
            style={{ marginLeft: "10px" }}
          >
            {rendering
              ? externalMode
                ? "저장 및 전송 중..."
                : "렌더링 중..."
              : externalMode
              ? "저장 후 원본 시스템으로 전송"
              : "저장 / 자막 합성"}
          </button>

          <button onClick={showSubtitleData} style={{ marginLeft: "10px" }}>
            자막 데이터 확인
          </button>

          <p style={{ fontSize: "13px", color: "#555" }}>
            현재 시간: {currentTime.toFixed(1)}초
          </p>

          <p style={{ fontSize: "13px", color: "#555" }}>
            입력과 출력은 9:16 고정입니다. 편집 기준은 360×640, 출력 기준은
            720×1280입니다.
          </p>

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
            style={{
              position: "relative",
              width: `${EDITOR_WIDTH}px`,
              height: `${EDITOR_HEIGHT}px`,
              marginTop: "20px",
              border: "1px solid #ccc",
              userSelect: "none",
              overflow: "hidden",
              backgroundColor: "black"
            }}
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
              style={{
                display: "block",
                width: `${EDITOR_WIDTH}px`,
                height: `${EDITOR_HEIGHT}px`,
                objectFit: "cover"
              }}
            />

            {subtitles.map((subtitle) => {
              const isSelected = subtitle.id === selectedSubtitleId;
              const isEditing = subtitle.id === editingSubtitleId;
              const displayText = isEditing ? editingText : subtitle.text;

              const subtitleStartTime = Number(subtitle.startTime);
              const subtitleEndTime = Number(subtitle.endTime);

              const isInTimeRange =
                currentTime >= subtitleStartTime &&
                currentTime <= subtitleEndTime;

              const shouldShowSubtitle =
                isInTimeRange || (!isPlaying && isSelected) || isEditing;

              if (!shouldShowSubtitle) {
                return null;
              }

              return (
                <div
                  key={subtitle.id}
                  onMouseDown={(event) =>
                    handleSubtitleMouseDown(event, subtitle)
                  }
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
                    position: "absolute",
                    left: `${subtitle.x}px`,
                    top: `${subtitle.y}px`,
                    width: `${subtitle.width}px`,
                    height: `${subtitle.height}px`,
                    border: isSelected
                      ? "2px solid yellow"
                      : "1px dashed transparent",
                    backgroundColor: isSelected
                      ? "rgba(0, 0, 0, 0.22)"
                      : "transparent",
                    boxSizing: "border-box",
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
                      onKeyDown={(event) => {
                        if (event.key === "Escape") {
                          event.currentTarget.blur();

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

                          setSelectedSubtitleId(null);
                          clearPropertyPanel();
                        }
                      }}
                      spellCheck={false}
                      style={{
                        width: "100%",
                        height: "100%",
                        border: "none",
                        outline: "1px solid white",
                        resize: "none",
                        overflow: "hidden",
                        backgroundColor: "transparent",
                        color: subtitle.color || "#ffffff",
                        fontSize: `${subtitle.fontSize}px`,
                        fontWeight: subtitle.bold ? "bold" : "normal",
                        fontStyle: subtitle.italic ? "italic" : "normal",
                        textAlign: subtitle.textAlign,
                        textShadow: "none",
                        boxSizing: "border-box",
                        padding: "4px",
                        fontFamily: subtitle.fontFamily || "Malgun Gothic",
                        lineHeight: "1.2",
                        whiteSpace: "pre-wrap",
                        wordBreak: "break-word",
                        cursor: "text"
                      }}
                    />
                  ) : (
                    <div
                      style={{
                        width: "100%",
                        height: "100%",
                        color: subtitle.color || "#ffffff",
                        fontSize: `${subtitle.fontSize}px`,
                        fontWeight: subtitle.bold ? "bold" : "normal",
                        fontStyle: subtitle.italic ? "italic" : "normal",
                        textAlign: subtitle.textAlign,
                        textShadow: "none",
                        boxSizing: "border-box",
                        padding: "4px",
                        fontFamily: subtitle.fontFamily || "Malgun Gothic",
                        lineHeight: "1.2",
                        whiteSpace: "pre-wrap",
                        wordBreak: "break-word",
                        overflow: "hidden",
                        pointerEvents: "none"
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
                        style={{
                          position: "absolute",
                          right: "-5px",
                          top: "0",
                          width: "10px",
                          height: "100%",
                          cursor: "ew-resize",
                          backgroundColor: "rgba(255, 255, 0, 0.35)"
                        }}
                      />

                      <div
                        data-resize-handle="true"
                        onMouseDown={(event) =>
                          handleResizeMouseDown(event, subtitle, "bottom")
                        }
                        style={{
                          position: "absolute",
                          left: "0",
                          bottom: "-5px",
                          width: "100%",
                          height: "10px",
                          cursor: "ns-resize",
                          backgroundColor: "rgba(255, 255, 0, 0.35)"
                        }}
                      />

                      <div
                        data-resize-handle="true"
                        onMouseDown={(event) =>
                          handleResizeMouseDown(event, subtitle, "corner")
                        }
                        style={{
                          position: "absolute",
                          right: "-7px",
                          bottom: "-7px",
                          width: "14px",
                          height: "14px",
                          backgroundColor: "yellow",
                          border: "1px solid black",
                          cursor: "nwse-resize",
                          zIndex: 10
                        }}
                      />
                    </>
                  )}
                </div>
              );
            })}
          </div>

          {outputUrl && (
            <div style={{ marginTop: "30px" }}>
              <h3>결과 영상 720×1280</h3>

              <video src={outputUrl} controls width="360" height="640" />

              <div style={{ marginTop: "10px" }}>
                <a href={outputUrl} download>
                  결과 영상 다운로드
                </a>
              </div>
            </div>
          )}

          <div style={{ marginTop: "30px" }}>
            <h3>선택된 자막 속성</h3>

            {!selectedSubtitle && (
              <p>영상 위의 자막을 클릭하면 속성을 수정할 수 있습니다.</p>
            )}

            {selectedSubtitle && (
              <div
                style={{
                  border: "1px solid #ddd",
                  padding: "12px",
                  width: "600px"
                }}
              >
                <div>
                  <label>내용: </label>
                  <input
                    type="text"
                    value={propertyText}
                    onChange={(event) => setPropertyText(event.target.value)}
                    onBlur={commitPropertyText}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") {
                        commitPropertyText();
                        event.currentTarget.blur();
                      }
                    }}
                    style={{ width: "400px", padding: "6px" }}
                  />
                </div>

                <div style={{ marginTop: "10px" }}>
                  <label>비디오 기준 정렬: </label>

                  <button
                    onClick={() =>
                      alignSubtitleToVideo(selectedSubtitle.id, "left")
                    }
                    style={{ marginLeft: "8px" }}
                  >
                    왼쪽
                  </button>

                  <button
                    onClick={() =>
                      alignSubtitleToVideo(selectedSubtitle.id, "center")
                    }
                    style={{ marginLeft: "8px" }}
                  >
                    가운데
                  </button>

                  <button
                    onClick={() =>
                      alignSubtitleToVideo(selectedSubtitle.id, "right")
                    }
                    style={{ marginLeft: "8px" }}
                  >
                    오른쪽
                  </button>
                </div>

                <div style={{ marginTop: "10px" }}>
                  <label>박스 내부 텍스트 정렬: </label>

                  <button
                    onClick={() =>
                      updateSubtitle(
                        selectedSubtitle.id,
                        "textAlign",
                        "left"
                      )
                    }
                    style={{ marginLeft: "8px" }}
                  >
                    왼쪽
                  </button>

                  <button
                    onClick={() =>
                      updateSubtitle(
                        selectedSubtitle.id,
                        "textAlign",
                        "center"
                      )
                    }
                    style={{ marginLeft: "8px" }}
                  >
                    가운데
                  </button>

                  <button
                    onClick={() =>
                      updateSubtitle(
                        selectedSubtitle.id,
                        "textAlign",
                        "right"
                      )
                    }
                    style={{ marginLeft: "8px" }}
                  >
                    오른쪽
                  </button>
                </div>

                <div style={{ marginTop: "10px" }}>
                  <label>폰트: </label>

                  <select
                    value={selectedSubtitle.fontFamily || "Malgun Gothic"}
                    onChange={(event) =>
                      updateSubtitle(
                        selectedSubtitle.id,
                        "fontFamily",
                        event.target.value
                      )
                    }
                    style={{ marginLeft: "8px", padding: "6px" }}
                  >
                    <option value="Malgun Gothic">맑은 고딕</option>
                    <option value="Arial">Arial</option>
                    <option value="Times New Roman">Times New Roman</option>
                    <option value="Verdana">Verdana</option>
                    <option value="Georgia">Georgia</option>
                  </select>

                  <label style={{ marginLeft: "20px" }}>색상: </label>

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
                    style={{ marginLeft: "8px" }}
                  />
                </div>

                <div style={{ marginTop: "10px" }}>
                  <label>스타일: </label>

                  <button
                    onClick={() =>
                      updateSubtitle(
                        selectedSubtitle.id,
                        "bold",
                        !selectedSubtitle.bold
                      )
                    }
                    style={{
                      marginLeft: "8px",
                      fontWeight: selectedSubtitle.bold ? "bold" : "normal"
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
                      marginLeft: "8px",
                      fontStyle: selectedSubtitle.italic ? "italic" : "normal"
                    }}
                  >
                    기울임
                  </button>
                </div>

                <div style={{ marginTop: "10px" }}>
                  <label>X: </label>
                  {renderNumberInput("x")}

                  <label style={{ marginLeft: "20px" }}>Y: </label>
                  {renderNumberInput("y")}
                </div>

                <div style={{ marginTop: "10px" }}>
                  <label>너비: </label>
                  {renderNumberInput("width")}

                  <label style={{ marginLeft: "20px" }}>높이: </label>
                  {renderNumberInput("height")}
                </div>

                <div style={{ marginTop: "10px" }}>
                  <label>글자 크기: </label>

                  <button
                    onClick={() => changeFontSize(selectedSubtitle.id, -4)}
                    style={{ marginLeft: "8px" }}
                  >
                    작게
                  </button>

                  <span style={{ marginLeft: "8px" }}>
                    {renderNumberInput("fontSize")}
                  </span>

                  <button
                    onClick={() => changeFontSize(selectedSubtitle.id, 4)}
                    style={{ marginLeft: "8px" }}
                  >
                    크게
                  </button>
                </div>

                <div style={{ marginTop: "10px" }}>
                  <label>시작 시간(초): </label>
                  {renderNumberInput("startTime")}

                  <label style={{ marginLeft: "20px" }}>
                    종료 시간(초):{" "}
                  </label>
                  {renderNumberInput("endTime")}

                  <button
                    onClick={() => deleteSubtitle(selectedSubtitle.id)}
                    style={{ marginLeft: "20px" }}
                  >
                    선택 자막 삭제
                  </button>
                </div>
              </div>
            )}
          </div>

          <div style={{ marginTop: "30px" }}>
            <h3>전체 자막 목록</h3>

            {subtitles.length === 0 && (
              <p>아직 추가된 자막이 없습니다.</p>
            )}

            {subtitles.map((subtitle, index) => (
              <div
                key={subtitle.id}
                onClick={() => {
                  setSelectedSubtitleId(subtitle.id);
                  setEditingSubtitleId(null);
                  syncPropertyPanel(subtitle);
                }}
                style={{
                  border:
                    subtitle.id === selectedSubtitleId
                      ? "2px solid black"
                      : "1px solid #ddd",
                  padding: "10px",
                  marginBottom: "8px",
                  width: "600px",
                  cursor: "pointer"
                }}
              >
                <strong>자막 {index + 1}</strong>
                <span style={{ marginLeft: "10px", whiteSpace: "pre-wrap" }}>
                  {subtitle.text}
                </span>

                <div style={{ fontSize: "12px", marginTop: "6px" }}>
                  x={subtitle.x}, y={subtitle.y}, 너비={subtitle.width},
                  높이={subtitle.height}, 시작={subtitle.startTime}초,
                  종료={subtitle.endTime}초, 글자크기={subtitle.fontSize},
                  폰트={subtitle.fontFamily || "Malgun Gothic"}, 색상=
                  {subtitle.color || "#ffffff"}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

export default App;