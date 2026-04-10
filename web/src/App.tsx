import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import VerificationScreen from "./components/VerificationScreen";
import {
  applyReviewStatuses,
  buildVerificationItems,
  findFirstUnverifiedIndex,
  type ImageEntry,
  type ReviewStatus,
  type VerificationItem,
} from "./verification";

type Screen = "folder" | "processing" | "verification" | "summary";

type LoadState = "idle" | "loading" | "success" | "error";
type ProcessingStatus = "pending" | "processing" | "completed" | "error" | "skipped";
type ProcessingEntry = {
  name: string;
  status: ProcessingStatus;
  detail?: string;
  error?: string;
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
  const [processingError, setProcessingError] = useState<string | null>(null);
  const [currentFile, setCurrentFile] = useState<string | null>(null);
  const currentFileRef = useRef<string | null>(null);
  const recentChunksRef = useRef<string[]>([]);
  const [isFullscreenOpen, setIsFullscreenOpen] = useState(false);

  // Verification state
  const [verificationItems, setVerificationItems] = useState<VerificationItem[]>([]);
  const [verificationIndex, setVerificationIndex] = useState(0);
  const transcriptionRequestedRef = useRef<Set<string>>(new Set());

  // Summary state
  const [summaryStatusEntries, setSummaryStatusEntries] = useState<
    Array<{ name: string; entry: StatusEntryFromApi }>
  >([]);

  const justVerifiedRef = useRef(false);

  const canRun = images.length > 0 && loadState === "success";
  const hasCompleted = processingState === "done";

  const displayList = useMemo(() => {
    return images.map((image) => image.name);
  }, [images]);

  const openFullscreen = useCallback(() => {
    setIsFullscreenOpen(true);
  }, []);

  const closeFullscreen = useCallback(() => {
    setIsFullscreenOpen(false);
  }, []);

  useEffect(() => {
    if (screen !== "verification") {
      setIsFullscreenOpen(false);
    }
  }, [screen]);

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
    setProcessingState("idle");
    setProcessingError(null);
    setCurrentFile(null);
    currentFileRef.current = null;
    recentChunksRef.current = [];
    setScreen("processing");
    void startTranscription();
  }

  function handleReset() {
    setScreen("folder");
  }

  function handleBackToProcessing() {
    setScreen("processing");
  }

  async function handleStartVerification() {
    let statusMap: Record<string, { reviewStatus?: ReviewStatus }> | undefined;

    try {
      const res = await fetch(`/api/status?folder=${encodeURIComponent(folderPath)}`);
      if (res.ok) {
        const payload = await res.json();
        statusMap = payload.status as Record<string, { reviewStatus?: ReviewStatus }>;
      }
    } catch {
      // Best-effort status prefetch
    }

    const items = buildVerificationItems(images, statusMap);
    transcriptionRequestedRef.current.clear();
    setVerificationItems(items);
    setVerificationIndex(findFirstUnverifiedIndex(items));
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
    if (
      current &&
      current.transcriptionContent === null &&
      !current.transcriptionLoading &&
      !transcriptionRequestedRef.current.has(current.name)
    ) {
      transcriptionRequestedRef.current.add(current.name);
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

        setVerificationItems((prev) => applyReviewStatuses(prev, statusMap));
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

      // Auto-advance to next item when marking as verified
      if (newStatus === "verified") {
        justVerifiedRef.current = true;
        setVerificationIndex((prev) => Math.min(verificationItems.length - 1, prev + 1));
      }
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
        item.name === imageName
          ? { ...item, reprocessing: true, transcriptionError: null, streamingContent: "", transcriptionContent: null }
          : item
      )
    );

    try {
      const response = await fetch(`/api/reprocess/${encodeURIComponent(imageName)}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "text/event-stream",
        },
        body: JSON.stringify({ folder: folderPath }),
      });

      if (!response.ok) {
        const payload = await response.json().catch(() => ({}));
        throw new Error(payload.error || "Re-processing failed.");
      }

      if (!response.body) {
        throw new Error("Streaming response not available.");
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let accumulated = "";
      let isDone = false;
      let errorMsg: string | null = null;

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const events = buffer.split("\n\n");
        buffer = events.pop() ?? "";

        for (const event of events) {
          const dataLines = event
            .split("\n")
            .filter((line) => line.startsWith("data:"))
            .map((line) => line.replace(/^data:\s?/, ""));
          if (dataLines.length === 0) continue;
          const data = dataLines.join("\n").trim();
          if (!data) continue;

          if (data.startsWith("[FILE_START]")) {
            // Reset streaming content
            accumulated = "";
            continue;
          }

          if (data.startsWith("[FILE_DONE]")) {
            isDone = true;
            continue;
          }

          if (data.startsWith("[FILE_ERROR]")) {
            const payload = data.replace("[FILE_ERROR]", "").trim();
            const parts = payload.split("|");
            errorMsg = parts.length > 1 ? parts.slice(1).join("|").trim() : parts[0]?.trim() ?? "Unknown error";
            continue;
          }

          // Token chunk
          accumulated += data;
          setVerificationItems((prev) =>
            prev.map((item) =>
              item.name === imageName
                ? { ...item, streamingContent: accumulated }
                : item
            )
          );
        }
      }

      if (errorMsg) {
        setVerificationItems((prev) =>
          prev.map((item) =>
            item.name === imageName
              ? { ...item, reprocessing: false, streamingContent: null, transcriptionError: errorMsg }
              : item
          )
        );
        return;
      }

      // Re-processing complete — reload the transcription from server
      setVerificationItems((prev) =>
        prev.map((item) =>
          item.name === imageName
            ? {
                ...item,
                reprocessing: false,
                streamingContent: null,
                transcriptionContent: null,
                reviewStatus: "not-verified",
              }
            : item
        )
      );

      transcriptionRequestedRef.current.delete(imageName);
      void loadTranscription(imageName);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Re-processing failed.";
      setVerificationItems((prev) =>
        prev.map((item) =>
          item.name === imageName
            ? { ...item, reprocessing: false, streamingContent: null, transcriptionError: message }
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

  // Auto-navigate to summary only when user just marked the final item
  useEffect(() => {
    if (allVerified && screen === "verification" && justVerifiedRef.current) {
      justVerifiedRef.current = false;
      void handleShowSummary();
    }
  }, [allVerified, screen]);

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
    setProcessingError(null);
    setCurrentFile(null);
    currentFileRef.current = null;
    recentChunksRef.current = [];
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

  function handleStreamMessage(message: string) {
    const trimmed = message.trim();
    if (!trimmed) {
      return;
    }

    if (trimmed.startsWith("[FILE_START]")) {
      const name = trimmed.replace("[FILE_START]", "").trim();
      setCurrentFile(name);
      currentFileRef.current = name;
      recentChunksRef.current = [];
      updateEntry(name, { status: "processing", detail: "Starting transcription..." });
      return;
    }

    if (trimmed.startsWith("[FILE_DONE]")) {
      const name = trimmed.replace("[FILE_DONE]", "").trim();
      currentFileRef.current = null;
      recentChunksRef.current = [];
      updateEntry(name, { status: "completed", detail: undefined });
      return;
    }

    if (trimmed.startsWith("[FILE_SKIP]")) {
      const name = trimmed.replace("[FILE_SKIP]", "").trim();
      currentFileRef.current = null;
      recentChunksRef.current = [];
      updateEntry(name, { status: "skipped", detail: undefined });
      return;
    }

    if (trimmed.startsWith("[FILE_ERROR]")) {
      const payload = trimmed.replace("[FILE_ERROR]", "").trim();
      const [namePart, errorPart] = payload.split("|");
      const name = namePart?.trim() ?? "Unknown file";
      const error = errorPart?.trim() ?? "Unknown error";
      currentFileRef.current = null;
      recentChunksRef.current = [];
      updateEntry(name, { status: "error", error, detail: error });
      return;
    }

    const activeFile = currentFileRef.current;
    if (activeFile) {
      // Keep last 3 chunks for context
      recentChunksRef.current = [...recentChunksRef.current.slice(-2), trimmed];
      updateEntry(activeFile, { detail: recentChunksRef.current.join(" ") });
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
    } finally {
      setProcessingState("done");
    }
  }

  return (
    <div className="app-shell">
      <header className="app-header">
        <p className="app-eyebrow">Curate Transcription Experience</p>
        <h1>Cute</h1>
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
            {loadState === "loading" && (
              <p className="loading-indicator">
                <span className="spinner" />
                Scanning folder...
              </p>
            )}
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
          </ul>
          {loadState === "success" && images.length === 0 && (
            <div className="empty-state">No images found in this folder.</div>
          )}
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
              </div>

              {processingError && <p className="error">{processingError}</p>}

              {hasCompleted && (
                <div className="processing-cta">
                  <button type="button" className="primary" onClick={() => void handleStartVerification()}>
                    Start Verification
                  </button>
                </div>
              )}

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

              <div className="button-row">
                <button type="button" className="secondary" onClick={handleReset}>
                  Back to Folder
                </button>
              </div>
            </>
          ) : screen === "verification" ? (
            <VerificationScreen
              items={verificationItems}
              currentIndex={verificationIndex}
              folderPath={folderPath}
              isFullscreenOpen={isFullscreenOpen}
              onPrev={handleVerificationPrev}
              onNext={handleVerificationNext}
              onUpdateStatus={handleUpdateReviewStatus}
              onReprocess={handleReprocess}
              onBackToProcessing={handleBackToProcessing}
              onOpenFullscreen={openFullscreen}
              onCloseFullscreen={closeFullscreen}
              onViewSummary={handleShowSummary}
            />
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
                    {summaryStatusEntries.length === 0 ? (
                      <div className="empty-state">No status data available.</div>
                    ) : (
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
                    )}
                  </div>

                  <div className="button-row">
                    <a href={csvUrl} className="csv-download-link" download>
                      Download CSV
                    </a>
                    <button
                      type="button"
                      className="secondary"
                      onClick={() => void handleStartVerification()}
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
