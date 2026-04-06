import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import FullscreenImageModal from "../../web/src/components/FullscreenImageModal";

afterEach(() => {
  cleanup();
});

describe("FullscreenImageModal", () => {
  it("does not render when closed", () => {
    render(
      <FullscreenImageModal
        src="/test-image.jpg"
        alt="Preview"
        isOpen={false}
        onClose={vi.fn()}
      />
    );

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("renders image when open", () => {
    render(
      <FullscreenImageModal
        src="/test-image.jpg"
        alt="Preview"
        isOpen={true}
        onClose={vi.fn()}
      />
    );

    const dialog = screen.getByRole("dialog");
    expect(dialog).toBeInTheDocument();
    expect(screen.getByRole("img", { name: "Preview" })).toHaveAttribute(
      "src",
      "/test-image.jpg"
    );
  });

  it("closes on Escape", () => {
    const onClose = vi.fn();
    render(
      <FullscreenImageModal
        src="/test-image.jpg"
        alt="Preview"
        isOpen={true}
        onClose={onClose}
      />
    );

    fireEvent.keyDown(document, { key: "Escape" });

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("closes on backdrop click", () => {
    const onClose = vi.fn();
    render(
      <FullscreenImageModal
        src="/test-image.jpg"
        alt="Preview"
        isOpen={true}
        onClose={onClose}
      />
    );

    const backdrop = screen.getByTestId("fullscreen-backdrop");
    fireEvent.click(backdrop);

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("closes on close button click", () => {
    const onClose = vi.fn();
    render(
      <FullscreenImageModal
        src="/test-image.jpg"
        alt="Preview"
        isOpen={true}
        onClose={onClose}
      />
    );

    const closeButton = screen.getByRole("button", {
      name: "Close fullscreen preview",
    });
    fireEvent.click(closeButton);

    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
