import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import VerificationScreen from "./components/VerificationScreen";
import { ModelPicker, type ModelInfo } from "./components/ModelPicker";
import {
  applyReviewStatuses,
  buildVerificationItems,
  findFirstUnverifiedIndex,
  type ImageEntry,
  type ReviewStatus,
  type VerificationItem,
} from "./verification";
import { updateReprocessDisplay, INITIAL_DISPLAY_STATE } from "./components/reprocessChunks";

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
  suggestedFilename?: string;
};

export default function App() {
  const [screen, setScreen] = useState<Screen>("folder");
  const [folderPath, setFolderPath] = useState("");
  const [images, setImages] = useState<ImageEntry[]>([]);
  const [loadState, setLoadState] = useState<LoadState>("idle");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [customInstructions, setCustomInstructions] = useState("");
  const [processingEntries, setProcessingEntries] = useState<ProcessingEntry[]>([]);
  const [processingState, setProcessingState] = useState<"idle" | "running" | "done">("idle");
  const [processingError, setProcessingError] = useState<string | null>(null);
  const [currentFile, setCurrentFile] = useState<string | null>(null);
  const currentFileRef = useRef<string | null>(null);
  const recentChunksRef = useRef<string[]>([]);
  const [isFullscreenOpen, setIsFullscreenOpen] = useState(false);
  const [currentModel, setCurrentModel] = useState<ModelInfo | null>(null);

  // Verification state
  const [verificationItems, setVerificationItems] = useState<VerificationItem[]>([]);
  const [verificationIndex, setVerificationIndex] = useState(0);
  const transcriptionRequestedRef = useRef<Set<string>>(new Set());
  const suggestionRequestedRef = useRef<Set<string>>(new Set());
  const [isEditing, setIsEditing] = useState(false);
  const [editContent, setEditContent] = useState("");
  const [renameLoading, setRenameLoading] = useState(false);
  const [renameError, setRenameError] = useState<string | null>(null);

  // Summary state
  const [summaryStatusEntries, setSummaryStatusEntries] = useState<
    Array<{ name: string; entry: StatusEntryFromApi }>
  >([]);

  const justVerifiedRef = useRef(false);

  const canRun = images.length > 0 && loadState === "success" && currentModel !== null;
  const hasCompleted = processingState === "done" && processingEntries.length > 0 && processingEntries.every((entry) => entry.status === "completed" || entry.status === "skipped" || entry.status === "error");

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

      // Load custom instructions if they exist
      try {
        const instrRes = await fetch(`/api/custom-instructions?folder=${encodeURIComponent(folderPath)}`);
        if (instrRes.ok) {
          const instrPayload = await instrRes.json();
          setCustomInstructions(instrPayload.instructions ?? "");
        }
      } catch {
        // Best-effort
      }
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

  const loadSuggestion = useCallback(
    async (imageName: string) => {
      setVerificationItems((prev) =>
        prev.map((item) =>
          item.name === imageName
            ? { ...item, suggestLoading: true }
            : item
        )
      );

      try {
        const res = await fetch(
          `/api/suggest-name/${encodeURIComponent(imageName)}`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ folder: folderPath }),
          }
        );
        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          throw new Error(data.error || "Failed to get suggestion.");
        }
        const data = await res.json();
        setVerificationItems((prev) =>
          prev.map((item) =>
            item.name === imageName
              ? { ...item, suggestedFilename: data.suggestedFilename, suggestLoading: false }
              : item
          )
        );
      } catch {
        setVerificationItems((prev) =>
          prev.map((item) =>
            item.name === imageName
              ? { ...item, suggestLoading: false }
              : item
          )
        );
        // Don't add to ref so it can be retried
        suggestionRequestedRef.current.delete(imageName);
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

  // Auto-fetch suggested filename when navigating to a verification item
  useEffect(() => {
    if (screen !== "verification" || verificationItems.length === 0) return;
    const current = verificationItems[verificationIndex];
    if (
      current &&
      current.suggestedFilename === undefined &&
      !current.suggestLoading &&
      !suggestionRequestedRef.current.has(current.name)
    ) {
      suggestionRequestedRef.current.add(current.name);
      void loadSuggestion(current.name);
    }
  }, [screen, verificationIndex, verificationItems, loadSuggestion]);

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

  async function handleRename(oldName: string, newName: string): Promise<boolean> {
    setRenameLoading(true);
    setRenameError(null);
    try {
      const res = await fetch(`/api/rename/${encodeURIComponent(oldName)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ folder: folderPath, newName }),
      });
      if (res.status === 409) {
        setRenameError("A file with that name already exists.");
        return false;
      }
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setRenameError(data.error || "Rename failed.");
        return false;
      }
      const data = await res.json();
      const newImageName: string = data.newImageName;
      const newImagePath: string = data.newImagePath;
      // Update verificationItems in-place
      setVerificationItems((prev) =>
        prev.map((item) =>
          item.name === oldName
            ? { ...item, name: newImageName, suggestedFilename: undefined, suggestLoading: false }
            : item
        )
      );
      // Update images in-place
      setImages((prev) =>
        prev.map((img) =>
          img.name === oldName
            ? { ...img, name: newImageName, path: newImagePath }
            : img
        )
      );
      // Reset suggestion tracking for renamed item
      suggestionRequestedRef.current.delete(oldName);
      return true;
    } catch (error) {
      setRenameError(error instanceof Error ? error.message : "Rename failed.");
      return false;
    } finally {
      setRenameLoading(false);
    }
  }

  async function handleReprocess(imageName: string, extraInstructions?: string) {
    setVerificationItems((prev) =>
      prev.map((item) =>
        item.name === imageName
          ? { ...item, reprocessing: true, transcriptionError: null, streamingDisplay: INITIAL_DISPLAY_STATE, transcriptionContent: null }
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
        body: JSON.stringify({ folder: folderPath, extraInstructions }),
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
      let displayState = INITIAL_DISPLAY_STATE;
      let isDone = false;
      let errorMsg: string | null = null;

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const events = buffer.split("\n\n");
        buffer = events.pop() ?? "";

        for (const event of events) {
          let eventType = "";
          let dataPayload = "";
          for (const line of event.split("\n")) {
            if (line.startsWith("event:")) {
              eventType = line.replace(/^event:\s?/, "");
            } else if (line.startsWith("data:")) {
              dataPayload = line.replace(/^data:\s?/, "");
            }
          }
          if (!eventType) continue;

          try {
            const parsed = JSON.parse(dataPayload);

            if (eventType === "file_start") {
              displayState = INITIAL_DISPLAY_STATE;
              setVerificationItems((prev) =>
                prev.map((item) =>
                  item.name === imageName
                    ? { ...item, streamingDisplay: displayState }
                    : item
                )
              );
            } else if (eventType === "file_done") {
              isDone = true;
            } else if (eventType === "file_error") {
              errorMsg = parsed.error ?? "Unknown error";
            } else if (eventType === "delta") {
              displayState = updateReprocessDisplay(displayState, parsed.text ?? "");
              setVerificationItems((prev) =>
                prev.map((item) =>
                  item.name === imageName
                    ? { ...item, streamingDisplay: displayState }
                    : item
                )
              );
            }
          } catch {
            // Skip malformed events
          }
        }
      }

      if (errorMsg) {
        setVerificationItems((prev) =>
          prev.map((item) =>
            item.name === imageName
              ? { ...item, reprocessing: false, streamingDisplay: null, transcriptionError: errorMsg }
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
                streamingDisplay: null,
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
            ? { ...item, reprocessing: false, streamingDisplay: null, transcriptionError: message }
            : item
        )
      );
    }
  }

  function handleVerificationPrev() {
    setIsEditing(false);
    setVerificationIndex((prev) => Math.max(0, prev - 1));
  }

  function handleVerificationNext() {
    setIsEditing(false);
    setVerificationIndex((prev) => Math.min(verificationItems.length - 1, prev + 1));
  }

  function handleEditStart() {
    const current = verificationItems[verificationIndex];
    if (current?.transcriptionContent) {
      setEditContent(current.transcriptionContent);
      setIsEditing(true);
    }
  }

  function handleEditCancel() {
    setIsEditing(false);
    setEditContent("");
  }

  async function handleEditSave() {
    const current = verificationItems[verificationIndex];
    if (!current) return;

    try {
      const res = await fetch(
        `/api/transcription/${encodeURIComponent(current.name)}`,
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ folder: folderPath, content: editContent }),
        }
      );

      if (!res.ok) {
        const payload = await res.json().catch(() => ({}));
        throw new Error(payload.error || "Failed to save transcription.");
      }

      const payload = await res.json();
      setVerificationItems((prev) =>
        prev.map((item) =>
          item.name === current.name
            ? { ...item, transcriptionContent: payload.content }
            : item
        )
      );
      setIsEditing(false);
      setEditContent("");
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to save transcription.";
      setVerificationItems((prev) =>
        prev.map((item) =>
          item.name === current.name
            ? { ...item, transcriptionError: message }
            : item
        )
      );
    }
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
    setCustomInstructions("");
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
    setIsEditing(false);
    setEditContent("");
    setRenameLoading(false);
    setRenameError(null);
    setSummaryStatusEntries([]);
    setScreen("folder");
  }

  function updateEntry(name: string, updates: Partial<ProcessingEntry>) {
    setProcessingEntries((prev) =>
      prev.map((entry) => (entry.name === name ? { ...entry, ...updates } : entry))
    );
  }

  function handleStreamEvent(eventType: string, data: Record<string, unknown>) {
    console.log(`[client SSE] handleStreamEvent: ${eventType}`, data);

    if (eventType === "file_start") {
      const name = data.name as string;
      setCurrentFile(name);
      currentFileRef.current = name;
      recentChunksRef.current = [];
      updateEntry(name, { status: "processing", detail: "Starting transcription..." });
      return;
    }

    if (eventType === "file_done") {
      const name = data.name as string;
      currentFileRef.current = null;
      recentChunksRef.current = [];
      updateEntry(name, { status: "completed", detail: undefined });
      return;
    }

    if (eventType === "file_skip") {
      const name = data.name as string;
      currentFileRef.current = null;
      recentChunksRef.current = [];
      updateEntry(name, { status: "skipped", detail: undefined });
      return;
    }

    if (eventType === "file_error") {
      const name = (data.name as string) ?? "Unknown file";
      const error = (data.error as string) ?? "Unknown error";
      currentFileRef.current = null;
      recentChunksRef.current = [];
      updateEntry(name, { status: "error", error, detail: error });
      return;
    }

    if (eventType === "delta") {
      const activeFile = currentFileRef.current;
      if (activeFile) {
        const text = data.text as string;
        recentChunksRef.current = [...recentChunksRef.current.slice(-2), text];
        updateEntry(activeFile, { detail: recentChunksRef.current.join(" ") });
      }
      return;
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
      let chunkIdx = 0;
      let streamDone = false;

      console.log(`[client SSE] starting to read stream`);

      while (true) {
        const { value, done } = await reader.read();
        if (done) {
          console.log(`[client SSE] reader.read() returned done after ${chunkIdx} chunks`);
          break;
        }
        chunkIdx++;
        const rawLen = value?.length ?? 0;
        const rawPreview = value ? new TextDecoder().decode(value).replace(/\n/g, "\\n").slice(0, 150) : "";
        console.log(`[client SSE] chunk #${chunkIdx}: ${rawLen}b → ${rawPreview}`);
        buffer += decoder.decode(value, { stream: true });
        const events = buffer.split("\n\n");
        buffer = events.pop() ?? "";

        for (const event of events) {
          let eventType = "";
          let dataPayload = "";
          for (const line of event.split("\n")) {
            if (line.startsWith("event:" )) {
              eventType = line.replace(/^event:\s?/, "");
            } else if (line.startsWith("data:")) {
              dataPayload = line.replace(/^data:\s?/, "");
            }
          }
          if (!eventType) continue;

          if (eventType === "done") {
            streamDone = true;
            setProcessingState("done");
            return;
          }

          try {
            const parsed = JSON.parse(dataPayload);
            handleStreamEvent(eventType, parsed);
          } catch {
            // Skip malformed events
          }
        }
      }

      // If we got here, the stream ended WITHOUT a "done" event.
      // This means the server disconnected or crashed. Do NOT mark as done
      // unless every entry already reached a terminal state.
      if (!streamDone) {
        setProcessingEntries((prev) => {
          const allSettled = prev.every(
            (e) => e.status === "completed" || e.status === "skipped" || e.status === "error"
          );
          if (allSettled) {
            setProcessingState("done");
          }
          return prev;
        });
      }

    } catch (error) {
      const message = error instanceof Error ? error.message : "Unable to run transcription.";
      setProcessingError(message);
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

          <label className="field">
            <span>Custom Instructions <span className="muted">(optional — prepended to AI prompt)</span></span>
            <textarea
              placeholder="e.g. These are photos from a CAFI meetup about bartending"
              value={customInstructions}
              onChange={(event) => setCustomInstructions(event.target.value)}
              onBlur={async () => {
                if (folderPath.trim()) {
                  try {
                    await fetch("/api/custom-instructions", {
                      method: "POST",
                      headers: { "Content-Type": "application/json" },
                      body: JSON.stringify({ folder: folderPath, instructions: customInstructions }),
                    });
                  } catch {
                    // Best-effort save
                  }
                }
              }}
              rows={3}
            />
          </label>

          <div className="model-picker-area">
            <ModelPicker onModelChange={setCurrentModel} />
          </div>

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
              isEditing={isEditing}
              editContent={editContent}
              renameLoading={renameLoading}
              renameError={renameError}
              onPrev={handleVerificationPrev}
              onNext={handleVerificationNext}
              onUpdateStatus={handleUpdateReviewStatus}
              onReprocess={handleReprocess}
              onBackToProcessing={handleBackToProcessing}
              onOpenFullscreen={openFullscreen}
              onCloseFullscreen={closeFullscreen}
              onViewSummary={handleShowSummary}
              onEditStart={handleEditStart}
              onEditChange={setEditContent}
              onEditSave={handleEditSave}
              onEditCancel={handleEditCancel}
              onRename={handleRename}
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
