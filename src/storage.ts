import * as fs from "fs";
import * as path from "path";
import { config } from "./config";

export type ProcessingStatus = "pending" | "in_progress" | "completed" | "error";
export type ReviewStatus = "not-verified" | "verified" | "needs-improvement";
export type StatusEntry = {
  processingStatus: ProcessingStatus;
  reviewStatus: ReviewStatus;
  currentVersion: number;
  error?: string;
  completedAt?: string;
  verifiedAt?: string;
  suggestedFilename?: string;
};
export type StatusFile = Record<string, StatusEntry>;

const processingStatuses: ProcessingStatus[] = ["pending", "in_progress", "completed", "error"];
const reviewStatuses: ReviewStatus[] = ["not-verified", "verified", "needs-improvement"];

function isProcessingStatus(value: unknown): value is ProcessingStatus {
  return typeof value === "string" && processingStatuses.includes(value as ProcessingStatus);
}

function isReviewStatus(value: unknown): value is ReviewStatus {
  return typeof value === "string" && reviewStatuses.includes(value as ReviewStatus);
}

export function createDefaultStatusEntry(): StatusEntry {
  return {
    processingStatus: "pending",
    reviewStatus: "not-verified",
    currentVersion: 1,
  };
}

export function normalizeStatusEntry(entry: unknown): StatusEntry {
  if (!entry || typeof entry !== "object") {
    return createDefaultStatusEntry();
  }

  const typedEntry = entry as Record<string, unknown>;
  const processingStatus = isProcessingStatus(typedEntry.processingStatus)
    ? typedEntry.processingStatus
    : isProcessingStatus(typedEntry.status)
      ? typedEntry.status
      : "pending";
  const reviewStatus = isReviewStatus(typedEntry.reviewStatus) ? typedEntry.reviewStatus : "not-verified";
  const currentVersion =
    typeof typedEntry.currentVersion === "number" && Number.isFinite(typedEntry.currentVersion)
      ? Math.max(1, Math.floor(typedEntry.currentVersion))
      : 1;

  const normalized: StatusEntry = {
    processingStatus,
    reviewStatus,
    currentVersion,
  };

  if (typeof typedEntry.error === "string" && typedEntry.error.length > 0) {
    normalized.error = typedEntry.error;
  }
  if (typeof typedEntry.completedAt === "string") {
    normalized.completedAt = typedEntry.completedAt;
  }
  if (typeof typedEntry.verifiedAt === "string") {
    normalized.verifiedAt = typedEntry.verifiedAt;
  }
  if (typeof typedEntry.suggestedFilename === "string" && typedEntry.suggestedFilename.length > 0) {
    normalized.suggestedFilename = typedEntry.suggestedFilename;
  }

  return normalized;
}

export function ensureStatusEntry(status: StatusFile, filePath: string): StatusEntry {
  const normalized = normalizeStatusEntry(status[filePath]);
  status[filePath] = normalized;
  return normalized;
}

export function loadStatusFile(statusFilePath: string = config.statusFile): StatusFile {
  if (!fs.existsSync(statusFilePath)) {
    return {};
  }
  const raw = JSON.parse(fs.readFileSync(statusFilePath, "utf-8")) as Record<string, unknown>;
  const normalized: StatusFile = {};
  for (const [filePath, entry] of Object.entries(raw ?? {})) {
    normalized[filePath] = normalizeStatusEntry(entry);
  }
  return normalized;
}

export function saveStatusFile(status: StatusFile, statusFilePath: string = config.statusFile): void {
  fs.writeFileSync(statusFilePath, JSON.stringify(status, null, 2));
}

export function updateFileStatus(
  status: StatusFile,
  filePath: string,
  newStatus: ProcessingStatus,
  error?: string,
  statusFilePath: string = config.statusFile
): void {
  const entry = ensureStatusEntry(status, filePath);
  entry.processingStatus = newStatus;
  if (error) {
    entry.error = error;
  } else if (newStatus !== "error") {
    delete entry.error;
  }
  if (newStatus === "completed") {
    entry.completedAt = new Date().toISOString();
  } else {
    delete entry.completedAt;
  }
  saveStatusFile(status, statusFilePath);
}

export function updateReviewStatus(
  status: StatusFile,
  filePath: string,
  newStatus: ReviewStatus,
  statusFilePath: string = config.statusFile
): void {
  const entry = ensureStatusEntry(status, filePath);
  entry.reviewStatus = newStatus;
  if (newStatus === "verified") {
    entry.verifiedAt = new Date().toISOString();
  } else {
    delete entry.verifiedAt;
  }
  saveStatusFile(status, statusFilePath);
}

export function saveTranscriptionAsMarkdown(
  imagePath: string,
  transcription: {
    description: string;
    textContent: string;
    keyInformation: string[];
  }
): string {
  if (!fs.existsSync(config.outputDir)) {
    fs.mkdirSync(config.outputDir, { recursive: true });
  }

  const imageName = path.basename(imagePath, path.extname(imagePath));
  const mdPath = path.join(config.outputDir, `${imageName}.md`);

  const content = formatTranscriptionMarkdown(imagePath, transcription);
  fs.writeFileSync(mdPath, content, "utf-8");
  return mdPath;
}

export function saveVersionedTranscription(
  folder: string,
  imagePath: string,
  version: number,
  transcription: {
    description: string;
    textContent: string;
    keyInformation: string[];
  }
): string {
  const baseName = path.basename(imagePath, path.extname(imagePath));
  const fileName = version > 1 ? `${baseName}_v${version}.md` : `${baseName}.md`;
  const mdPath = path.join(folder, fileName);

  const content = formatTranscriptionMarkdown(imagePath, transcription);
  fs.writeFileSync(mdPath, content, "utf-8");
  return mdPath;
}

function formatTranscriptionMarkdown(
  imagePath: string,
  transcription: {
    description: string;
    textContent: string;
    keyInformation: string[];
  }
): string {
  return `# ${path.basename(imagePath)}

## Description

${transcription.description}

## Text Content

${transcription.textContent}

## Key Information

${transcription.keyInformation.map((item) => `- ${item}`).join("\n")}
`;
}
