import * as fs from "fs";
import * as path from "path";
import { config } from "./config";

export type TranscriptionStatus = "pending" | "completed" | "error";
export type StatusFile = Record<string, { status: TranscriptionStatus; error?: string; completedAt?: string }>;

export function loadStatusFile(): StatusFile {
  if (fs.existsSync(config.statusFile)) {
    return JSON.parse(fs.readFileSync(config.statusFile, "utf-8"));
  }
  return {};
}

export function saveStatusFile(status: StatusFile): void {
  fs.writeFileSync(config.statusFile, JSON.stringify(status, null, 2));
}

export function updateFileStatus(
  status: StatusFile,
  filePath: string,
  newStatus: TranscriptionStatus,
  error?: string
): void {
  status[filePath] = {
    status: newStatus,
    ...(error ? { error } : {}),
    ...(newStatus === "completed" ? { completedAt: new Date().toISOString() } : {}),
  };
  saveStatusFile(status);
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

  const content = `# ${path.basename(imagePath)}

## Description

${transcription.description}

## Text Content

${transcription.textContent}

## Key Information

${transcription.keyInformation.map((item) => `- ${item}`).join("\n")}
`;

  fs.writeFileSync(mdPath, content, "utf-8");
  return mdPath;
}
