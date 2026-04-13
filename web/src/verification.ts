export type ReviewStatus = "not-verified" | "verified" | "needs-improvement";

export type ImageEntry = {
  name: string;
  path: string;
};

export type VerificationItem = {
  name: string;
  reviewStatus: ReviewStatus;
  transcriptionContent: string | null;
  transcriptionLoading: boolean;
  transcriptionError: string | null;
  reprocessing: boolean;
  streamingContent: string | null;
  suggestedFilename?: string;
  suggestLoading: boolean;
};

type StatusMap = Record<string, { reviewStatus?: ReviewStatus; suggestedFilename?: string }>;

function findStatusEntry(statusMap: StatusMap, imageName: string): { reviewStatus?: ReviewStatus; suggestedFilename?: string } | undefined {
  const match = Object.entries(statusMap).find(([filePath]) =>
    filePath.endsWith(`/${imageName}`)
  );
  return match?.[1];
}

export function applyReviewStatuses(
  items: VerificationItem[],
  statusMap: StatusMap | undefined
): VerificationItem[] {
  if (!statusMap) {
    return items;
  }

  return items.map((item) => {
    const entry = findStatusEntry(statusMap, item.name);
    if (!entry) {
      return item;
    }
    return {
      ...item,
      ...(entry.reviewStatus !== undefined ? { reviewStatus: entry.reviewStatus } : {}),
      ...(entry.suggestedFilename !== undefined ? { suggestedFilename: entry.suggestedFilename } : {}),
    };
  });
}

export function buildVerificationItems(
  images: ImageEntry[],
  statusMap?: StatusMap
): VerificationItem[] {
  const items = images.map((img) => ({
    name: img.name,
    reviewStatus: "not-verified" as ReviewStatus,
    transcriptionContent: null,
    transcriptionLoading: false,
    transcriptionError: null,
    reprocessing: false,
    streamingContent: null,
    suggestLoading: false,
  }))

  return applyReviewStatuses(items, statusMap);
}

export function findFirstUnverifiedIndex(
  items: Array<{ reviewStatus: ReviewStatus }>
): number {
  const index = items.findIndex((item) => item.reviewStatus !== "verified");
  return index === -1 ? 0 : index;
}
