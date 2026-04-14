import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import VerificationScreen from "../../web/src/components/VerificationScreen";
import type { VerificationItem } from "../../web/src/verification";

function makeItem(overrides: Partial<VerificationItem> = {}): VerificationItem {
  return {
    name: "test-image.png",
    reviewStatus: "not-verified",
    transcriptionContent: "# Hello\n\nSome transcription text",
    transcriptionLoading: false,
    transcriptionError: null,
    reprocessing: false,
    streamingContent: null,
    suggestLoading: false,
    ...overrides,
  };
}

const defaultProps = {
  items: [makeItem()],
  currentIndex: 0,
  folderPath: "/tmp/test",
  isFullscreenOpen: false,
  isEditing: false,
  editContent: "",
  renameLoading: false,
  renameError: null,
  onPrev: vi.fn(),
  onNext: vi.fn(),
  onUpdateStatus: vi.fn(),
  onReprocess: vi.fn(),
  onBackToProcessing: vi.fn(),
  onOpenFullscreen: vi.fn(),
  onCloseFullscreen: vi.fn(),
  onViewSummary: vi.fn(),
  onEditStart: vi.fn(),
  onEditChange: vi.fn(),
  onEditSave: vi.fn(),
  onEditCancel: vi.fn(),
  onRename: vi.fn(),
};

afterEach(() => {
  cleanup();
});

describe("VerificationScreen", () => {
  describe("Edit button placement", () => {
    it("renders Edit button below transcription content, not in the header", () => {
      const { container } = render(<VerificationScreen {...defaultProps} />);

      // The Edit button should NOT be inside verification-transcription-header
      const header = container.querySelector(".verification-transcription-header");
      expect(header).not.toBeNull();
      expect(header!.querySelector("button")).toBeNull();

      // The Edit button should exist in the document
      const editButton = screen.getByText("Edit");
      expect(editButton).toBeInTheDocument();

      // It should be a sibling after transcription-content, inside verification-transcription
      const transcription = container.querySelector(".verification-transcription");
      expect(transcription).not.toBeNull();

      // Verify the button is not inside the header
      expect(header!.contains(editButton)).toBe(false);

      // Verify the button is inside the transcription panel
      expect(transcription!.contains(editButton)).toBe(true);
    });

    it("renders Save and Cancel buttons below the textarea when editing", () => {
      const props = {
        ...defaultProps,
        isEditing: true,
        editContent: "# Hello\n\nSome transcription text",
      };

      const { container } = render(<VerificationScreen {...props} />);

      // Save and Cancel should NOT be in the header
      const header = container.querySelector(".verification-transcription-header");
      expect(header!.querySelector("button")).toBeNull();

      // Save and Cancel should exist below the textarea
      const saveButton = screen.getByText("Save");
      const cancelButton = screen.getByText("Cancel");
      expect(saveButton).toBeInTheDocument();
      expect(cancelButton).toBeInTheDocument();

      // Verify they are inside an edit-actions div that's a direct child of verification-transcription
      const editActions = container.querySelector(".edit-actions");
      expect(editActions).not.toBeNull();

      // Verify edit-actions is NOT inside the header
      expect(header!.contains(editActions!)).toBe(false);

      // Verify edit-actions is inside the transcription panel
      const transcription = container.querySelector(".verification-transcription");
      expect(transcription!.contains(editActions!)).toBe(true);
    });

    it("does not show Edit button when transcription is loading", () => {
      const props = {
        ...defaultProps,
        items: [makeItem({ transcriptionContent: null, transcriptionLoading: true })],
      };

      render(<VerificationScreen {...props} />);
      expect(screen.queryByText("Edit")).not.toBeInTheDocument();
    });

    it("does not show Edit button when reprocessing", () => {
      const props = {
        ...defaultProps,
        items: [makeItem({ reprocessing: true, streamingContent: "processing..." })],
      };

      render(<VerificationScreen {...props} />);
      expect(screen.queryByText("Edit")).not.toBeInTheDocument();
    });
  });

  describe("Edit button functionality", () => {
    it("calls onEditStart when Edit button is clicked", () => {
      const onEditStart = vi.fn();
      render(<VerificationScreen {...defaultProps} onEditStart={onEditStart} />);

      fireEvent.click(screen.getByText("Edit"));
      expect(onEditStart).toHaveBeenCalledOnce();
    });

    it("calls onEditSave when Save is clicked", () => {
      const onEditSave = vi.fn();
      const props = {
        ...defaultProps,
        isEditing: true,
        editContent: "# Hello\n\nSome text",
        onEditSave,
      };

      render(<VerificationScreen {...props} />);
      fireEvent.click(screen.getByText("Save"));
      expect(onEditSave).toHaveBeenCalledOnce();
    });

    it("calls onEditCancel when Cancel is clicked", () => {
      const onEditCancel = vi.fn();
      const props = {
        ...defaultProps,
        isEditing: true,
        editContent: "# Hello\n\nSome text",
        onEditCancel,
      };

      render(<VerificationScreen {...props} />);
      fireEvent.click(screen.getByText("Cancel"));
      expect(onEditCancel).toHaveBeenCalledOnce();
    });
  });
});