import { useCallback, useEffect, useMemo, useState } from "react";
import Markdown from "react-markdown";

type Screen = "folder" | "processing" | "results" | "verification" | "summary";

type ImageEntry = {
  name: string;
  path: string;
};

type LoadState = "idle" | "loading" | "success" | "error";
type ProcessingStatus = "pending" | "processing" | "completed" | "error" | "skipped";
type ReviewStatus = "not-verified" | "verified" | "needs-improvement";

type ProcessingEntry = {
  name: string;
  status: ProcessingStatus;
  detail?: string;
  error?: string;
};

type VerificationItem = {
  name: string;
  reviewStatus: ReviewStatus;
  transcriptionContent: string | null;
  transcriptionLoading: boolean;
  transcriptionError: string | null;
  reprocessing: boolean;
};

type StatusEntryFromApi = {
  processingStatus: string;
  reviewStatus: ReviewStatus;
  currentVersion: number;
  verifiedAt?: string;
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

  // Verification state
  const [verificationItems, setVerificationItems] = useState<VerificationItem[]>([]);
  const [verificationIndex, setVerificationIndex] = useState(0);

  // Summary state
  const [summaryStatusEntries, setSummaryStatusEntries] = useState<
    Array<{ name: string; entry: StatusEntryFromApi }>
  >([]);

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

  function handleStartVerification() {
    const items: VerificationItem[] = images.map((img) => ({
      name: img.name,
      reviewStatus: "not-verified",
      transcriptionContent: null,
      transcriptionLoading: false,
      transcriptionError: null,
      reprocessing: false,
    }));
    setVerificationItems(items);
    setVerificationIndex(0);
    setScreen("verification");
  }

  const loadTranscription = useCallback(
    async (imageName: string) => {
      setVerificationItems((prev) =>
        prev.map((item) =>
          item.name === imageName
            ? { ...item, transcriptionLoading: true, transcriptionError: null }
            : item
        )
      );

      try {
        const res = await fetch(
          `/api/transcription/${encodeURIComponent(imageName)}?folder=${encodeURIComponent(folderPath)}`
        );
        const payload = await res.json();

        if (!res.ok) {
          throw new Error(payload.error || "Failed to load transcription.");
        }

        setVerificationItems((prev) =>
          prev.map((item) =>
            item.name === imageName
              ? { ...item, transcriptionContent: payload.content, transcriptionLoading: false }
              : item
          )
        );
      } catch (error) {
        const message = error instanceof Error ? error.message : "Failed to load transcription.";
        setVerificationItems((prev) =>
          prev.map((item) =>
            item.name === imageName
              ? { ...item, transcriptionLoading: false, transcriptionError: message }
              : item
          )
        );
      }
    },
    [folderPath]
  );

  // Load transcription when verification index changes
  useEffect(() => {
    if (screen !== "verification" || verificationItems.length === 0) {
      return;
    }
    const current = verificationItems[verificationIndex];
    if (current && current.transcriptionContent === null && !current.transcriptionLoading) {
      void loadTranscription(current.name);
    }
  }, [screen, verificationIndex, verificationItems, loadTranscription]);

  // Fetch latest review statuses when entering verification
  useEffect(() => {
    if (screen !== "verification" || verificationItems.length === 0) {
      return;
    }

    let cancelled = false;

    async function fetchStatuses() {
      try {
        const res = await fetch(`/api/status?folder=${encodeURIComponent(folderPath)}`);
        if (!res.ok) return;
        const payload = await res.json();
        const statusMap = payload.status as Record<string, { reviewStatus?: ReviewStatus }>;

        if (cancelled) return;

        setVerificationItems((prev) =>
          prev.map((item) => {
            const key = Object.keys(statusMap).find((k) => k.endsWith(`/${item.name}`));
            if (key && statusMap[key]?.reviewStatus) {
              return { ...item, reviewStatus: statusMap[key].reviewStatus! };
            }
            return item;
          })
        );
      } catch {
        // Status fetch is best-effort
      }
    }

    void fetchStatuses();
    return () => {
      cancelled = true;
    };
  }, [screen, folderPath, verificationItems.length]);

  async function handleUpdateReviewStatus(imageName: string, newStatus: ReviewStatus) {
    try {
      const res = await fetch(
        `/api/review/${encodeURIComponent(imageName)}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ folder: folderPath, reviewStatus: newStatus }),
        }
      );

      if (!res.ok) {
        const payload = await res.json().catch(() => ({}));
        throw new Error(payload.error || "Failed to update review status.");
      }

      setVerificationItems((prev) =>
        prev.map((item) =>
          item.name === imageName ? { ...item, reviewStatus: newStatus } : item
        )
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to update review status.";
      setVerificationItems((prev) =>
        prev.map((item) =>
          item.name === imageName ? { ...item, transcriptionError: message } : item
        )
      );
    }
  }

  async function handleReprocess(imageName: string) {
    setVerificationItems((prev) =>
      prev.map((item) =>
        item.name === imageName ? { ...item, reprocessing: true, transcriptionError: null } : item
      )
    );

    try {
      const res = await fetch(`/api/reprocess/${encodeURIComponent(imageName)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ folder: folderPath }),
      });

      if (!res.ok) {
        const payload = await res.json().catch(() => ({}));
        throw new Error(payload.error || "Re-processing failed.");
      }

      // Reload transcription after re-process
      setVerificationItems((prev) =>
        prev.map((item) =>
          item.name === imageName
            ? {
                ...item,
                reprocessing: false,
                transcriptionContent: null,
                reviewStatus: "not-verified",
              }
            : item
        )
      );

      // Trigger reload
      void loadTranscription(imageName);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Re-processing failed.";
      setVerificationItems((prev) =>
        prev.map((item) =>
          item.name === imageName
            ? { ...item, reprocessing: false, transcriptionError: message }
            : item
        )
      );
    }
  }

  function handleVerificationPrev() {
    setVerificationIndex((prev) => Math.max(0, prev - 1));
  }

  function handleVerificationNext() {
    setVerificationIndex((prev) => Math.min(verificationItems.length - 1, prev + 1));
  }

  // Check if all items are verified and auto-show summary
  const allVerified = useMemo(() => {
    return (
      verificationItems.length > 0 &&
      verificationItems.every((item) => item.reviewStatus === "verified")
    );
  }, [verificationItems]);

  async function handleShowSummary() {
    try {
      const res = await fetch(`/api/status?folder=${encodeURIComponent(folderPath)}`);
      if (!res.ok) {
        setScreen("summary");
        return;
      }
      const payload = await res.json();
      const statusMap = payload.status as Record<string, StatusEntryFromApi>;

      const entries = Object.entries(statusMap).map(([filePath, entry]) => ({
        name: filePath.split("/").pop() ?? filePath,
        entry,
      }));

      setSummaryStatusEntries(entries);
    } catch {
      // Best-effort
    }
    setScreen("summary");
  }

  function handleNewSession() {
    setFolderPath("");
    setImages([]);
    setLoadState("idle");
    setErrorMessage(null);
    setProcessingEntries([]);
    setProcessingState("idle");
    setActivityLog([]);
    setProcessingError(null);
    setCurrentFile(null);
    setVerificationItems([]);
    setVerificationIndex(0);
    setSummaryStatusEntries([]);
    setScreen("folder");
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
          ) : screen === "results" ? (
            <>
              <h2>Results</h2>
              <p className="muted">
                Processing complete. Start verification to review each transcription side-by-side
                with its source image.
              </p>
              <div className="button-row">
                <button type="button" className="primary" onClick={handleStartVerification}>
                  Start Verification
                </button>
                <button type="button" className="secondary" onClick={handleReset}>
                  Back to Folder
                </button>
              </div>
            </>
          ) : screen === "verification" ? (
            (() => {
              const current = verificationItems[verificationIndex];
              if (!current) {
                return (
                  <>
                    <h2>Verification</h2>
                    <p className="muted">No items to verify.</p>
                    <div className="button-row">
                      <button type="button" className="secondary" onClick={handleReset}>
                        Back to Folder
                      </button>
                    </div>
                  </>
                );
              }

              const imageUrl = `/api/image/${encodeURIComponent(current.name)}?folder=${encodeURIComponent(folderPath)}`;

              return (
                <>
                  <div className="verification-header">
                    <h2>Verification</h2>
                    <span className="verification-position">
                      {verificationIndex + 1} of {verificationItems.length}
                    </span>
                  </div>

                  <div className="verification-nav">
                    <button
                      type="button"
                      className="secondary"
                      onClick={handleVerificationPrev}
                      disabled={verificationIndex === 0}
                    >
                      Prev
                    </button>
                    <span className="verification-filename">{current.name}</span>
                    <button
                      type="button"
                      className="secondary"
                      onClick={handleVerificationNext}
                      disabled={verificationIndex === verificationItems.length - 1}
                    >
                      Next
                    </button>
                  </div>

                  <div className="verification-split">
                    <div className="verification-image">
                      <h3>Source Image</h3>
                      <img src={imageUrl} alt={current.name} />
                    </div>

                    <div className="verification-transcription">
                      <h3>Transcription</h3>
                      <div className="transcription-content">
                        {current.transcriptionLoading && (
                          <p className="muted">Loading transcription...</p>
                        )}
                        {current.transcriptionError && (
                          <p className="error">{current.transcriptionError}</p>
                        )}
                        {current.transcriptionContent && (
                          <Markdown>{current.transcriptionContent}</Markdown>
                        )}
                        {!current.transcriptionLoading &&
                          !current.transcriptionError &&
                          !current.transcriptionContent && (
                            <p className="muted">No transcription available.</p>
                          )}
                      </div>
                    </div>
                  </div>

                  <div className="verification-actions">
                    <div className="verification-status">
                      <span
                        className={`review-pill review-${current.reviewStatus}`}
                      >
                        {current.reviewStatus.replace("-", " ")}
                      </span>
                    </div>
                    <div className="button-row">
                      <button
                        type="button"
                        className="primary"
                        onClick={() => handleUpdateReviewStatus(current.name, "verified")}
                        disabled={current.reviewStatus === "verified"}
                      >
                        Verified
                      </button>
                      <button
                        type="button"
                        className="secondary"
                        onClick={() =>
                          handleUpdateReviewStatus(current.name, "needs-improvement")
                        }
                        disabled={current.reviewStatus === "needs-improvement"}
                      >
                        Needs Improvement
                      </button>
                      {current.reviewStatus === "needs-improvement" && (
                        <button
                          type="button"
                          className="secondary"
                          onClick={() => handleReprocess(current.name)}
                          disabled={current.reprocessing}
                        >
                          {current.reprocessing ? "Re-processing..." : "Re-process"}
                        </button>
                      )}
                    </div>
                  </div>

                  <div className="button-row">
                    <button type="button" className="secondary" onClick={handleViewResults}>
                      Back to Results
                    </button>
                    <button type="button" className="secondary" onClick={handleReset}>
                      Back to Folder
                    </button>
                    {allVerified && (
                      <button
                        type="button"
                        className="primary"
                        onClick={() => void handleShowSummary()}
                      >
                        View Summary
                      </button>
                    )}
                  </div>
                </>
              );
            })()
          ) : screen === "summary" ? (
            (() => {
              const verifiedCount = summaryStatusEntries.filter(
                (e) => e.entry.reviewStatus === "verified"
              ).length;
              const needsImprovementCount = summaryStatusEntries.filter(
                (e) => e.entry.reviewStatus === "needs-improvement"
              ).length;
              const totalCount = summaryStatusEntries.length;
              const csvUrl = `/api/csv?folder=${encodeURIComponent(folderPath)}`;

              return (
                <>
                  <h2>Summary</h2>
                  <p className="muted">All items have been reviewed.</p>

                  <div className="summary-stats">
                    <div className="summary-stat">
                      <span className="summary-stat-value">{totalCount}</span>
                      <span className="summary-stat-label">Total Processed</span>
                    </div>
                    <div className="summary-stat">
                      <span className="summary-stat-value summary-verified">{verifiedCount}</span>
                      <span className="summary-stat-label">Verified</span>
                    </div>
                    <div className="summary-stat">
                      <span className="summary-stat-value summary-needs-improvement">
                        {needsImprovementCount}
                      </span>
                      <span className="summary-stat-label">Needs Improvement</span>
                    </div>
                  </div>

                  <div className="summary-files">
                    <h3>Transcription Files</h3>
                    <ul>
                      {summaryStatusEntries.map((item) => {
                        const baseName = item.name.replace(/\.[^.]+$/, "");
                        const version = item.entry.currentVersion;
                        const fileName =
                          version > 1 ? `${baseName}_v${version}.md` : `${baseName}.md`;
                        return (
                          <li key={item.name}>
                            <span>{fileName}</span>
                            <span
                              className={`review-pill review-${item.entry.reviewStatus}`}
                            >
                              {item.entry.reviewStatus.replace("-", " ")}
                            </span>
                          </li>
                        );
                      })}
                    </ul>
                  </div>

                  <div className="button-row">
                    <a href={csvUrl} className="csv-download-link" download>
                      Download CSV
                    </a>
                    <button
                      type="button"
                      className="secondary"
                      onClick={handleStartVerification}
                    >
                      Return to Verification
                    </button>
                    <button type="button" className="secondary" onClick={handleNewSession}>
                      New Session
                    </button>
                  </div>
                </>
              );
            })()
          ) : null}
        </section>
      )}
    </div>
  );
}
