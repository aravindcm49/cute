import { describe, it, expect } from "vitest";
import {
  applyReviewStatuses,
  buildVerificationItems,
  findFirstUnverifiedIndex,
} from "../../web/src/verification";

describe("verification helpers", () => {
  it("builds verification items with status map applied", () => {
    const images = [
      { name: "menu-1.png", path: "/tmp/menu-1.png" },
      { name: "menu-2.png", path: "/tmp/menu-2.png" },
    ];
    const statusMap = {
      "/tmp/menu-1.png": { reviewStatus: "verified" },
      "/tmp/other/menu-2.png": { reviewStatus: "needs-improvement" },
    } as const;

    const items = buildVerificationItems(images, statusMap);

    expect(items[0].reviewStatus).toBe("verified");
    expect(items[1].reviewStatus).toBe("needs-improvement");
  });

  it("applies updated review statuses without clearing other fields", () => {
    const items = buildVerificationItems([{ name: "menu-1.png", path: "/tmp/menu-1.png" }]);
    items[0].transcriptionContent = "Example";

    const updated = applyReviewStatuses(
      items,
      { "/tmp/menu-1.png": { reviewStatus: "verified" } } as const
    );

    expect(updated[0].reviewStatus).toBe("verified");
    expect(updated[0].transcriptionContent).toBe("Example");
  });

  it("finds the first unverified index", () => {
    const items = [
      { reviewStatus: "verified" as const },
      { reviewStatus: "needs-improvement" as const },
      { reviewStatus: "not-verified" as const },
    ];

    expect(findFirstUnverifiedIndex(items)).toBe(1);
  });

  it("returns zero when all items are verified", () => {
    const items = [
      { reviewStatus: "verified" as const },
      { reviewStatus: "verified" as const },
    ];

    expect(findFirstUnverifiedIndex(items)).toBe(0);
  });

  it("builds items with suggestLoading defaulting to false", () => {
    const images = [{ name: "slide.png", path: "/tmp/slide.png" }];
    const items = buildVerificationItems(images);

    expect(items[0].suggestLoading).toBe(false);
  });

  it("applies review statuses while preserving suggestLoading", () => {
    const images = [{ name: "slide.png", path: "/tmp/slide.png" }];
    const items = buildVerificationItems(images);
    items[0].suggestLoading = true;
    items[0].transcriptionContent = "content";

    const updated = applyReviewStatuses(
      items,
      { "/tmp/slide.png": { reviewStatus: "verified" } } as const
    );

    expect(updated[0].suggestLoading).toBe(true);
    expect(updated[0].transcriptionContent).toBe("content");
    expect(updated[0].reviewStatus).toBe("verified");
  });

  it("builds items without suggestedFilename by default", () => {
    const images = [{ name: "slide.png", path: "/tmp/slide.png" }];
    const items = buildVerificationItems(images);

    expect(items[0].suggestedFilename).toBeUndefined();
  });

  it("applies suggestedFilename from status map", () => {
    const images = [{ name: "slide.png", path: "/tmp/slide.png" }];
    const statusMap = {
      "/tmp/slide.png": { suggestedFilename: "cocktail-menu" },
    } as const;

    const items = buildVerificationItems(images, statusMap);

    expect(items[0].suggestedFilename).toBe("cocktail-menu");
    expect(items[0].suggestLoading).toBe(false);
  });

  it("preserves suggestLoading when applying review statuses", () => {
    const images = [{ name: "slide.png", path: "/tmp/slide.png" }];
    const items = buildVerificationItems(images);
    items[0].suggestLoading = true;
    items[0].suggestedFilename = "pending-name";

    const updated = applyReviewStatuses(
      items,
      { "/tmp/slide.png": { reviewStatus: "verified" } } as const
    );

    expect(updated[0].suggestLoading).toBe(true);
    expect(updated[0].suggestedFilename).toBe("pending-name");
    expect(updated[0].reviewStatus).toBe("verified");
  });
});
