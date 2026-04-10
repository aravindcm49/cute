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
};

type StatusMap = Record<string, { reviewStatus?: ReviewStatus }>;

function findReviewStatus(statusMap: StatusMap, imageName: string): ReviewStatus | undefined {
  const match = Object.entries(statusMap).find(([filePath]) =>
    filePath.endsWith(`/${imageName}`)
  );
  return match?.[1].reviewStatus;
}

export function applyReviewStatuses(
  items: VerificationItem[],
  statusMap: StatusMap | undefined
): VerificationItem[] {
  if (!statusMap) {
    return items;
  }

  return items.map((item) => {
    const reviewStatus = findReviewStatus(statusMap, item.name);
    if (reviewStatus === undefined) {
      return item;
    }
    return { ...item, reviewStatus };
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
  }));

  return applyReviewStatuses(items, statusMap);
}

export function findFirstUnverifiedIndex(
  items: Array<{ reviewStatus: ReviewStatus }>
): number {
  const index = items.findIndex((item) => item.reviewStatus !== "verified");
  return index === -1 ? 0 : index;
}
