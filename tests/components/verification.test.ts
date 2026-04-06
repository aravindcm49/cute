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
});
