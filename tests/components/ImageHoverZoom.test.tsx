import { describe, it, expect } from "vitest";
import {
  getBackgroundPosition,
  getMagnifierPosition,
} from "../../web/src/components/ImageHoverZoom";

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
