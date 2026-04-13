import React from "react";
import Markdown from "react-markdown";
import ImageHoverZoom from "./ImageHoverZoom";
import FullscreenImageModal from "./FullscreenImageModal";
import type { ReviewStatus, VerificationItem } from "../verification";

type VerificationScreenProps = {
  items: VerificationItem[];
  currentIndex: number;
  folderPath: string;
  isFullscreenOpen: boolean;
  isEditing: boolean;
  editContent: string;
  renameLoading: boolean;
  renameError: string | null;
  onPrev: () => void;
  onNext: () => void;
  onUpdateStatus: (imageName: string, status: ReviewStatus) => void;
  onReprocess: (imageName: string, extraInstructions?: string) => void;
  onBackToProcessing: () => void;
  onOpenFullscreen: () => void;
  onCloseFullscreen: () => void;
  onViewSummary: () => void;
  onEditStart: () => void;
  onEditChange: (content: string) => void;
  onEditSave: () => void;
  onEditCancel: () => void;
  onRename: (oldName: string, newName: string) => Promise<boolean>;
};

export default function VerificationScreen({
  items,
  currentIndex,
  folderPath,
  isFullscreenOpen,
  isEditing,
  editContent,
  renameLoading,
  renameError,
  onPrev,
  onNext,
  onUpdateStatus,
  onReprocess,
  onBackToProcessing,
  onOpenFullscreen,
  onCloseFullscreen,
  onViewSummary,
  onEditStart,
  onEditChange,
  onEditSave,
  onEditCancel,
  onRename,
}: VerificationScreenProps) {
  const current = items[currentIndex];
  const [extraInstructions, setExtraInstructions] = React.useState("");
  const [isEditingName, setIsEditingName] = React.useState(false);
  const [editNameValue, setEditNameValue] = React.useState("");

  React.useEffect(() => {
    setExtraInstructions("");
    setIsEditingName(false);
    setEditNameValue("");
  }, [currentIndex]);

  function handleStartNameEdit() {
    if (!current || current.suggestLoading) return;
    setEditNameValue(current.suggestedFilename ?? "");
    setIsEditingName(true);
  }

  async function handleRenameSubmit() {
    if (!current || !editNameValue.trim() || renameLoading) return;
    const ok = await onRename(current.name, editNameValue.trim());
    if (ok) setIsEditingName(false);
  }

  if (!current) {
    return (
      <>
        <h2>Verification</h2>
        <p className="muted">No items to verify.</p>
        <div className="button-row verification-nav-row">
          <button type="button" className="secondary" onClick={onBackToProcessing}>
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
        <span className="verification-filename">{current.name}</span>
        {current.suggestLoading && <span className="spinner" />}
        {!current.suggestLoading && current.suggestedFilename && !isEditingName && (
          <span
            className="suggested-filename"
            onClick={handleStartNameEdit}
            title="Click to edit and rename"
          >
            → {current.suggestedFilename}
          </span>
        )}
        {isEditingName && (
          <>
            <input
              type="text"
              className="rename-input"
              value={editNameValue}
              onChange={(e) => setEditNameValue(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") handleRenameSubmit();
                if (e.key === "Escape") setIsEditingName(false);
              }}
              disabled={renameLoading}
              autoFocus
            />
            <button
              type="button"
              className="primary"
              onClick={handleRenameSubmit}
              disabled={renameLoading || !editNameValue.trim()}
            >
              {renameLoading ? "Renaming..." : "Rename"}
            </button>
          </>
        )}
        <span className="verification-position">
          {currentIndex + 1} of {items.length}
        </span>
      </div>

      {renameError && <p className="error rename-error">{renameError}</p>}

      <div className="verification-split">
        <div className="verification-image">
          <div className="verification-image-header">
            <h3>Source Image</h3>
            <span className={`review-pill review-${current.reviewStatus}`}>
              {current.reviewStatus.replace("-", " ")}
            </span>
          </div>
          <ImageHoverZoom
            src={imageUrl}
            alt={current.name}
            onExpand={onOpenFullscreen}
            enableFullscreenShortcut={true}
          />
        </div>

        <div className="verification-transcription">
          <div className="verification-transcription-header">
            <h3>Transcription</h3>
            {!current.reprocessing && !current.transcriptionLoading && current.transcriptionContent && (
              isEditing ? (
                <div className="edit-actions">
                  <button type="button" className="secondary" onClick={onEditSave}>Save</button>
                  <button type="button" className="secondary" onClick={onEditCancel}>Cancel</button>
                </div>
              ) : (
                <button type="button" className="secondary" onClick={onEditStart}>Edit</button>
              )
            )}
          </div>
          <div className="transcription-content">
            {current.reprocessing && current.streamingContent !== null && (
              <div className="streaming-output">
                <p className="loading-indicator muted">
                  <span className="spinner" />
                  Re-processing...
                </p>
                <pre className="streaming-text">{current.streamingContent}</pre>
              </div>
            )}
            {current.transcriptionLoading && !current.reprocessing && (
              <p className="loading-indicator muted">
                <span className="spinner" />
                Loading transcription...
              </p>
            )}
            {!current.reprocessing && current.transcriptionError && (
              <p className="error">{current.transcriptionError}</p>
            )}
            {!current.reprocessing && !current.transcriptionLoading && current.transcriptionContent && (
              isEditing ? (
                <textarea
                  className="edit-textarea"
                  value={editContent}
                  onChange={(e) => onEditChange(e.target.value)}
                />
              ) : (
                <Markdown>{current.transcriptionContent}</Markdown>
              )
            )}
            {!current.reprocessing &&
              !current.transcriptionLoading &&
              !current.transcriptionError &&
              !current.transcriptionContent && (
                <p className="muted">No transcription available.</p>
              )}
          </div>
        </div>
      </div>

      <FullscreenImageModal
        src={imageUrl}
        alt={current.name}
        isOpen={isFullscreenOpen}
        onClose={onCloseFullscreen}
      />

      <div className="button-row verification-action-row">
        <button
          type="button"
          className="secondary"
          onClick={onPrev}
          disabled={currentIndex === 0}
        >
          Prev
        </button>
        <button
          type="button"
          className="primary"
          onClick={() => onUpdateStatus(current.name, "verified")}
          disabled={current.reviewStatus === "verified"}
        >
          Verified
        </button>
        {current.reviewStatus === "needs-improvement" ? (
          <>
            <textarea
              className="extra-instructions-textarea"
              placeholder="What should the model focus on? (optional)"
              value={extraInstructions}
              onChange={(e) => setExtraInstructions(e.target.value)}
              disabled={current.reprocessing}
            />
            <button
              type="button"
              className="secondary"
              onClick={() => {
                onReprocess(current.name, extraInstructions || undefined);
                setExtraInstructions("");
              }}
              disabled={current.reprocessing}
            >
              {current.reprocessing ? (
                <>
                  <span className="spinner" /> Re-processing...
                </>
              ) : (
                "Re-process"
              )}
            </button>
          </>
        ) : (
          <button
            type="button"
            className="secondary"
            onClick={() => onUpdateStatus(current.name, "needs-improvement")}
          >
            Needs Improvement
          </button>
        )}
        <button
          type="button"
          className="secondary"
          onClick={onNext}
          disabled={currentIndex === items.length - 1}
        >
          Next
        </button>
      </div>

      <div className="button-row verification-nav-row">
        <button type="button" className="secondary" onClick={onBackToProcessing}>
          Back to Processing
        </button>
        <button type="button" className="secondary" onClick={onViewSummary}>
          View Summary
        </button>
      </div>
    </>
  );
}
