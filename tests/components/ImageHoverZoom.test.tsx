import { afterEach, describe, it, expect, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import {
  getBackgroundPosition,
  getMagnifierPosition,
  default as ImageHoverZoom,
} from "../../web/src/components/ImageHoverZoom";

afterEach(() => {
  cleanup();
});

describe("ImageHoverZoom helpers", () => {
  it("positions magnifier to the right when there is space", () => {
    const result = getMagnifierPosition({
      cursorX: 100,
      cursorY: 100,
      imageWidth: 400,
      imageHeight: 300,
      magnifierSize: 150,
      offset: 16,
    });

    expect(result.flipped).toBe(false);
    expect(result.left).toBe(116);
    expect(result.top).toBe(25);
  });

  it("flips magnifier to the left near the right edge", () => {
    const result = getMagnifierPosition({
      cursorX: 380,
      cursorY: 100,
      imageWidth: 400,
      imageHeight: 300,
      magnifierSize: 150,
      offset: 16,
    });

    expect(result.flipped).toBe(true);
    expect(result.left).toBe(214);
  });

  it("clamps magnifier vertically inside the image", () => {
    const result = getMagnifierPosition({
      cursorX: 80,
      cursorY: 20,
      imageWidth: 400,
      imageHeight: 300,
      magnifierSize: 150,
      offset: 16,
    });

    expect(result.top).toBe(0);
  });

  it("calculates background position based on zoom", () => {
    const position = getBackgroundPosition({
      cursorX: 200,
      cursorY: 100,
      magnifierSize: 150,
      zoom: 2.5,
    });

    expect(position.x).toBeCloseTo(-425);
    expect(position.y).toBeCloseTo(-175);
  });
});

describe("ImageHoverZoom", () => {
  it("calls onExpand when clicking the expand button", () => {
    const onExpand = vi.fn();
    render(
      <ImageHoverZoom src="/test.jpg" alt="Preview" onExpand={onExpand} />
    );

    const expandButton = screen.getByRole("button", {
      name: "Open fullscreen preview",
    });
    fireEvent.click(expandButton);

    expect(onExpand).toHaveBeenCalledTimes(1);
  });

  it("calls onExpand when pressing the F key", () => {
    const onExpand = vi.fn();
    render(
      <ImageHoverZoom
        src="/test.jpg"
        alt="Preview"
        onExpand={onExpand}
        enableFullscreenShortcut={true}
      />
    );

    fireEvent.keyDown(document, { key: "f" });

    expect(onExpand).toHaveBeenCalledTimes(1);
  });
});
