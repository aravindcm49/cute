import { useMemo, useState } from "react";

type Screen = "folder" | "processing" | "results";

type ImageEntry = {
  name: string;
  path: string;
};

type LoadState = "idle" | "loading" | "success" | "error";
type ProcessingStatus = "pending" | "processing" | "completed" | "error" | "skipped";

type ProcessingEntry = {
  name: string;
  status: ProcessingStatus;
  detail?: string;
  error?: string;
};

export default function App() {
  const [screen, setScreen] = useState<Screen>("folder");
  const [folderPath, setFolderPath] = useState("");
  const [images, setImages] = useState<ImageEntry[]>([]);
  const [loadState, setLoadState] = useState<LoadState>("idle");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [processingEntries, setProcessingEntries] = useState<ProcessingEntry[]>([]);
  const [processingState, setProcessingState] = useState<"idle" | "running" | "done">("idle");
  const [activityLog, setActivityLog] = useState<string[]>([]);
  const [processingError, setProcessingError] = useState<string | null>(null);
  const [currentFile, setCurrentFile] = useState<string | null>(null);

  const canRun = images.length > 0 && loadState === "success";
  const hasCompleted = processingState === "done";

  const displayList = useMemo(() => {
    return images.map((image) => image.name);
  }, [images]);

  async function handleScan() {
    if (!folderPath.trim()) {
      setErrorMessage("Enter a folder path to scan.");
      setLoadState("error");
      setImages([]);
      return;
    }

    setLoadState("loading");
    setErrorMessage(null);

    try {
      const response = await fetch(`/api/images?folder=${encodeURIComponent(folderPath)}`);
      const payload = await response.json();

      if (!response.ok) {
        throw new Error(payload.error || "Unable to load images.");
      }

      setImages(payload.images ?? []);
      setLoadState("success");
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unable to load images.";
      setImages([]);
      setLoadState("error");
      setErrorMessage(message);
    }
  }

  function handleRun() {
    if (!canRun) {
      return;
    }
    setProcessingEntries(
      images.map((image) => ({
        name: image.name,
        status: "pending",
      }))
    );
    setActivityLog([]);
    setProcessingState("idle");
    setProcessingError(null);
    setCurrentFile(null);
    setScreen("processing");
    void startTranscription();
  }

  function handleReset() {
    setScreen("folder");
  }

  function handleViewResults() {
    setScreen("results");
  }

  function updateEntry(name: string, updates: Partial<ProcessingEntry>) {
    setProcessingEntries((prev) =>
      prev.map((entry) => (entry.name === name ? { ...entry, ...updates } : entry))
    );
  }

  function appendLog(message: string) {
    setActivityLog((prev) => {
      const next = [...prev, message];
      return next.length > 200 ? next.slice(-200) : next;
    });
  }

  function handleStreamMessage(message: string) {
    const trimmed = message.trim();
    if (!trimmed) {
      return;
    }

    if (trimmed.startsWith("[FILE_START]")) {
      const name = trimmed.replace("[FILE_START]", "").trim();
      setCurrentFile(name);
      updateEntry(name, { status: "processing", detail: "Starting transcription..." });
      appendLog(`Starting ${name}`);
      return;
    }

    if (trimmed.startsWith("[FILE_DONE]")) {
      const name = trimmed.replace("[FILE_DONE]", "").trim();
      updateEntry(name, { status: "completed", detail: "Completed" });
      appendLog(`Completed ${name}`);
      return;
    }

    if (trimmed.startsWith("[FILE_SKIP]")) {
      const name = trimmed.replace("[FILE_SKIP]", "").trim();
      updateEntry(name, { status: "skipped", detail: "Skipped (already completed)" });
      appendLog(`Skipped ${name}`);
      return;
    }

    if (trimmed.startsWith("[FILE_ERROR]")) {
      const payload = trimmed.replace("[FILE_ERROR]", "").trim();
      const [namePart, errorPart] = payload.split("|");
      const name = namePart?.trim() ?? "Unknown file";
      const error = errorPart?.trim() ?? "Unknown error";
      updateEntry(name, { status: "error", error, detail: error });
      appendLog(`Error ${name}: ${error}`);
      return;
    }

    appendLog(trimmed);
    if (currentFile) {
      updateEntry(currentFile, { detail: trimmed });
    }
  }

  async function startTranscription() {
    setProcessingState("running");
    setProcessingError(null);

    try {
      const response = await fetch("/api/transcribe", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "text/event-stream",
        },
        body: JSON.stringify({ folder: folderPath }),
      });

      if (!response.ok) {
        const payload = await response.json().catch(() => ({}));
        throw new Error(payload.error || "Unable to start transcription.");
      }

      if (!response.body) {
        throw new Error("Streaming response not available.");
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { value, done } = await reader.read();
        if (done) {
          break;
        }
        buffer += decoder.decode(value, { stream: true });
        const events = buffer.split("\n\n");
        buffer = events.pop() ?? "";

        for (const event of events) {
          const dataLines = event
            .split("\n")
            .filter((line) => line.startsWith("data:"))
            .map((line) => line.replace(/^data:\s?/, ""));
          if (dataLines.length === 0) {
            continue;
          }
          const data = dataLines.join("\n");
          if (data.trim() === "[DONE]") {
            setProcessingState("done");
            return;
          }
          handleStreamMessage(data);
        }
      }

      if (buffer.trim().length > 0) {
        handleStreamMessage(buffer.trim());
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unable to run transcription.";
      setProcessingError(message);
      appendLog(message);
    } finally {
      setProcessingState("done");
    }
  }

  return (
    <div className="app-shell">
      <header className="app-header">
        <p className="app-eyebrow">Transcription Review</p>
        <h1>Sandcastle Transcription UI</h1>
        <p className="app-subtitle">
          Point the app at a folder of slides, verify the images found, then run transcription.
        </p>
      </header>

      {screen === "folder" ? (
        <section className="panel">
          <label className="field">
            <span>Folder Path</span>
            <input
              type="text"
              placeholder="/Users/you/Pictures/Slides"
              value={folderPath}
              onChange={(event) => setFolderPath(event.target.value)}
            />
          </label>

          <div className="button-row">
            <button type="button" className="secondary" onClick={handleScan}>
              Scan Folder
            </button>
            <button type="button" className="primary" onClick={handleRun} disabled={!canRun}>
              Run
            </button>
          </div>

          <div className="status">
            {loadState === "loading" && <p>Scanning folder...</p>}
            {loadState === "error" && errorMessage && <p className="error">{errorMessage}</p>}
            {loadState === "success" && (
              <p>
                Found <strong>{images.length}</strong> image{images.length === 1 ? "" : "s"}.
              </p>
            )}
          </div>

          <ul className="image-list">
            {displayList.map((name) => (
              <li key={name}>{name}</li>
            ))}
            {loadState === "success" && images.length === 0 && (
              <li className="muted">No images found in this folder.</li>
            )}
          </ul>
        </section>
      ) : (
        <section className="panel">
          {screen === "processing" ? (
            <>
              <div className="processing-header">
                <div>
                  <h2>Processing</h2>
                  <p className="muted">Streaming live progress from the transcription engine.</p>
                </div>
                {hasCompleted && (
                  <button type="button" className="primary" onClick={handleViewResults}>
                    View Results
                  </button>
                )}
              </div>

              {processingError && <p className="error">{processingError}</p>}

              <div className="processing-grid">
                <div className="processing-list">
                  <h3>Files</h3>
                  <ul>
                    {processingEntries.map((entry) => (
                      <li key={entry.name} className={`status-${entry.status}`}>
                        <div>
                          <strong>{entry.name}</strong>
                          {entry.detail && <span className="detail">{entry.detail}</span>}
                        </div>
                        <span className="status-pill">{entry.status.replace("-", " ")}</span>
                      </li>
                    ))}
                  </ul>
                </div>

                <div className="log-panel">
                  <h3>Live Log</h3>
                  <div className="log-lines">
                    {activityLog.length === 0 && <p className="muted">Waiting for updates...</p>}
                    {activityLog.map((line, index) => (
                      <p key={`${line}-${index}`}>{line}</p>
                    ))}
                  </div>
                </div>
              </div>

              <div className="button-row">
                <button type="button" className="secondary" onClick={handleReset}>
                  Back to Folder
                </button>
              </div>
            </>
          ) : (
            <>
              <h2>Results</h2>
              <p className="muted">Results screen stub. Next slice will add verification.</p>
              <div className="button-row">
                <button type="button" className="secondary" onClick={handleReset}>
                  Back to Folder
                </button>
              </div>
            </>
          )}
        </section>
      )}
    </div>
  );
}
