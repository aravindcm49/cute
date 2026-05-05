import express from "express";
import * as fs from "fs";
import * as path from "path";
import { config } from "../src/config";
import {
  createDefaultStatusEntry,
  ensureStatusEntry,
  loadStatusFile,
  saveStatusFile,
  saveVersionedTranscription,
  updateFileStatus,
  updateReviewStatus,
  type StatusFile,
} from "../src/storage";
import { getImageFiles } from "../src/transcription";
import type { AiProvider } from "../src/ai-provider";
import { createSseStream } from "./sse";

const supportedExtensions = new Set([".jpg", ".jpeg", ".png", ".webp"]);
const processingStatuses = new Set(["pending", "in_progress", "completed", "error"]);
const reviewStatuses = new Set(["not-verified", "verified", "needs-improvement"]);

export type AiProviderDeps = {
  aiProvider: AiProvider;
  getImageFiles: typeof getImageFiles;
};

function isDirectory(folderPath: string): boolean {
  try {
    return fs.statSync(folderPath).isDirectory();
  } catch (error) {
    return false;
  }
}

function escapeCsvField(value: string): string {
  if (value.includes(",") || value.includes('"') || value.includes("\n")) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

function generateTrackingCsv(status: StatusFile): string {
  const header = "image_name,processing_status,review_status,version,verified_at,notes";
  const rows = Object.entries(status).map(([filePath, entry]) => {
    const imageName = path.basename(filePath);
    return [
      escapeCsvField(imageName),
      escapeCsvField(entry.processingStatus),
      escapeCsvField(entry.reviewStatus),
      String(entry.currentVersion),
      entry.verifiedAt ?? "",
      "",
    ].join(",");
  });
  return [header, ...rows].join("\n") + "\n";
}


export function createTranscribeHandler(deps: AiProviderDeps) {
  return async (req: express.Request, res: express.Response) => {
    const { aiProvider, getImageFiles: listImages } = deps;

    const folder = typeof req.body?.folder === "string" ? req.body.folder : "";
    if (folder.trim().length === 0) {
      return res.status(400).json({ error: "Folder path is required." });
    }

    if (!fs.existsSync(folder)) {
      return res.status(404).json({ error: "Folder not found." });
    }

    if (!isDirectory(folder)) {
      return res.status(400).json({ error: "Provided path is not a directory." });
    }

    const stream = createSseStream(req, res);
    console.log(`[transcribe] SSE stream created: ${stream ? "yes" : "no"} (accept: ${req.headers.accept})`);

    const imagePaths = listImages(folder);
    const statusFilePath = path.join(folder, config.statusFile);
    const status = loadStatusFile(statusFilePath);

    let didChange = false;
    for (const imagePath of imagePaths) {
      if (!status[imagePath]) {
        status[imagePath] = createDefaultStatusEntry();
        didChange = true;
      } else {
        status[imagePath] = ensureStatusEntry(status, imagePath);
      }
    }
    if (didChange) {
      saveStatusFile(status, statusFilePath);
    }

    let completed = 0;
    let errors = 0;
    let skipped = 0;
    const results: Array<{ imageName: string; status: string; error?: string }> = [];

    if (imagePaths.length === 0) {
      if (stream) {
        stream.emit("done");
        stream.close();
        return;
      }
      return res.json({ folder, total: 0, processed: 0, skipped: 0, errors: 0, results });
    }

    // Load custom instructions for this folder
    const customInstructionsPath = path.join(folder, "custom_instructions.txt");
    const customInstructions = fs.existsSync(customInstructionsPath)
      ? fs.readFileSync(customInstructionsPath, "utf-8").trim()
      : "";

    console.log(`[transcribe] starting loop over ${imagePaths.length} images`);
    for (let i = 0; i < imagePaths.length; i++) {
      const imagePath = imagePaths[i];
      console.log(`[transcribe] === LOOP i=${i}/${imagePaths.length} path=${imagePath} ===`);

      if (stream?.isClosed) {
        console.log(`[transcribe] stream closed, stopping at ${imagePath}`);
        break;
      }

      const imageName = path.basename(imagePath);
      if (status[imagePath]?.processingStatus === "completed") {
        skipped++;
        results.push({ imageName, status: "skipped" });
        console.log(`[transcribe] skipping already-completed: ${imageName}`);
        stream?.emit("file_skip", { name: imageName });
        continue;
      }

      console.log(`[transcribe] emitting file_start for ${imageName}`);
      stream?.emit("file_start", { name: imageName });
      console.log(`[transcribe] file_start emitted, entering try block`);

      try {
        updateFileStatus(status, imagePath, "in_progress", undefined, statusFilePath);
        const transcriptionOptions = customInstructions
          ? { extraInstructions: customInstructions }
          : undefined;
        console.log(`[transcribe] awaiting aiProvider.transcribe for ${imageName}...`);
        const transcription = await aiProvider.transcribe(imagePath, transcriptionOptions, (delta) => {
          console.log(`[transcribe] delta for ${imageName}: ${delta.length} chars`);
          stream?.emit("delta", { text: delta });
        });
        console.log(`[transcribe] aiProvider.transcribe RESOLVED for ${imageName}`);
        console.log(`[transcribe] saving transcription for ${imageName}`);
        saveVersionedTranscription(folder, imagePath, 1, transcription);
        console.log(`[transcribe] updating file status to completed for ${imageName}`);
        updateFileStatus(status, imagePath, "completed", undefined, statusFilePath);
        if (transcription.suggestedFilename) {
          status[imagePath].suggestedFilename = transcription.suggestedFilename;
          saveStatusFile(status, statusFilePath);
        }
        completed++;
        results.push({ imageName, status: "completed" });
        console.log(`[transcribe] emitting file_done for ${imageName}`);
        stream?.emit("file_done", { name: imageName });
        console.log(`[transcribe] file_done emitted for ${imageName}, loop will continue to i=${i + 1}`);
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        console.log(`[transcribe] error for ${imageName}: ${errorMessage}`);
        updateFileStatus(status, imagePath, "error", errorMessage, statusFilePath);
        errors++;
        results.push({ imageName, status: "error", error: errorMessage });
        stream?.emit("file_error", { name: imageName, error: errorMessage });
      }
    }

    if (stream) {
      console.log(`[transcribe] all done. completed=${completed} skipped=${skipped} errors=${errors}`);
      stream.emit("done");
      stream.close();
      return;
    }

    return res.json({
      folder,
      total: imagePaths.length,
      processed: completed,
      skipped,
      errors,
      results,
    });
  };
}

export function createReprocessHandler(deps: AiProviderDeps) {
  return async (req: express.Request, res: express.Response) => {
    const { aiProvider } = deps;

    const folder = typeof req.body?.folder === "string" ? req.body.folder : "";
    if (folder.trim().length === 0) {
      return res.status(400).json({ error: "Folder path is required." });
    }

    if (!fs.existsSync(folder)) {
      return res.status(404).json({ error: "Folder not found." });
    }

    if (!isDirectory(folder)) {
      return res.status(400).json({ error: "Provided path is not a directory." });
    }

    const imageName = req.params.imageName;
    if (typeof imageName !== "string" || imageName.trim().length === 0) {
      return res.status(400).json({ error: "Image name is required." });
    }

    if (imageName !== path.basename(imageName)) {
      return res.status(400).json({ error: "Invalid image name." });
    }

    const imagePath = path.join(folder, imageName);
    if (!fs.existsSync(imagePath)) {
      return res.status(404).json({ error: "Image not found." });
    }

    const extraInstructions = typeof req.body?.extraInstructions === "string" ? req.body.extraInstructions : undefined;

    // Load custom instructions for this folder
    const customInstructionsPath = path.join(folder, "custom_instructions.txt");
    const customInstructions = fs.existsSync(customInstructionsPath)
      ? fs.readFileSync(customInstructionsPath, "utf-8").trim()
      : "";

    // Combine custom folder instructions with per-request extra instructions
    const combinedInstructions = [customInstructions, extraInstructions].filter(Boolean).join("\n\n") || undefined;
    const reprocessOptions = combinedInstructions
      ? { extraInstructions: combinedInstructions }
      : undefined;

    const statusFilePath = path.join(folder, config.statusFile);
    const status = loadStatusFile(statusFilePath);
    const entry = ensureStatusEntry(status, imagePath);
    const currentVersion = entry.currentVersion;
    const nextVersion = currentVersion + 1;

    const stream = createSseStream(req, res);

    try {
      stream?.emit("file_start", { name: imageName });

      const result = await aiProvider.transcribe(imagePath, reprocessOptions, (delta) => {
        stream?.emit("delta", { text: delta });
      });

      saveVersionedTranscription(folder, imagePath, nextVersion, result);

      entry.currentVersion = nextVersion;
      entry.reviewStatus = "not-verified";
      entry.processingStatus = "completed";
      entry.completedAt = new Date().toISOString();
      delete entry.error;
      delete entry.verifiedAt;
      saveStatusFile(status, statusFilePath);

      if (stream) {
        stream.emit("file_done", { name: imageName });
        stream.close();
        return;
      }

      return res.json({
        imageName,
        version: nextVersion,
        status: entry,
      });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      entry.error = errorMessage;
      saveStatusFile(status, statusFilePath);

      if (stream) {
        stream.emit("file_error", { name: imageName, error: errorMessage });
        stream.close();
        return;
      }

      return res.status(500).json({
        error: errorMessage,
        imageName,
        version: currentVersion,
        status: entry,
      });
    }
  };
}

export function createSuggestNameHandler(deps: AiProviderDeps) {
  return async (req: express.Request, res: express.Response) => {
    const { aiProvider } = deps;

    const folder = typeof req.body?.folder === "string" ? req.body.folder : "";
    if (folder.trim().length === 0) {
      return res.status(400).json({ error: "Folder path is required." });
    }

    if (!fs.existsSync(folder)) {
      return res.status(404).json({ error: "Folder not found." });
    }

    if (!isDirectory(folder)) {
      return res.status(400).json({ error: "Provided path is not a directory." });
    }

    const imageName = req.params.imageName;
    if (typeof imageName !== "string" || imageName.trim().length === 0) {
      return res.status(400).json({ error: "Image name is required." });
    }

    if (imageName !== path.basename(imageName)) {
      return res.status(400).json({ error: "Invalid image name." });
    }

    const imagePath = path.join(folder, imageName);
    if (!fs.existsSync(imagePath)) {
      return res.status(404).json({ error: "Image not found." });
    }

    try {
      const result = await aiProvider.transcribe(imagePath);
      return res.json({ suggestedFilename: result.suggestedFilename ?? "" });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      return res.status(500).json({ error: errorMessage });
    }
  };
}

export function createApp(deps: AiProviderDeps) {
  const app = express();
  app.use(express.json());

  app.get("/api/images", (req, res) => {
    const folder = req.query.folder;
    if (typeof folder !== "string" || folder.trim().length === 0) {
      return res.status(400).json({ error: "Query parameter 'folder' is required." });
    }

    if (!fs.existsSync(folder)) {
      return res.status(404).json({ error: "Folder not found." });
    }

    if (!isDirectory(folder)) {
      return res.status(400).json({ error: "Provided path is not a directory." });
    }

    const imagePaths = deps.getImageFiles(folder).filter((filePath: string) => {
      return supportedExtensions.has(path.extname(filePath).toLowerCase());
    });

    const images = imagePaths.map((filePath: string) => ({
      name: path.basename(filePath),
      path: filePath,
    }));

    return res.json({ folder, count: images.length, images });
  });

  app.get("/api/status", (req, res) => {
    const folder = req.query.folder;
    if (typeof folder !== "string" || folder.trim().length === 0) {
      return res.status(400).json({ error: "Query parameter 'folder' is required." });
    }

    if (!fs.existsSync(folder)) {
      return res.status(404).json({ error: "Folder not found." });
    }

    if (!isDirectory(folder)) {
      return res.status(400).json({ error: "Provided path is not a directory." });
    }

    const imagePaths = deps.getImageFiles(folder);
    const statusFilePath = path.join(folder, config.statusFile);
    const status = loadStatusFile(statusFilePath);
    const scopedStatus: StatusFile = {};

    let didChange = false;
    for (const imagePath of imagePaths) {
      if (!status[imagePath]) {
        status[imagePath] = createDefaultStatusEntry();
        didChange = true;
      } else {
        status[imagePath] = ensureStatusEntry(status, imagePath);
      }
      scopedStatus[imagePath] = status[imagePath];
    }

    if (didChange) {
      saveStatusFile(status, statusFilePath);
    }

    return res.json({ folder, count: imagePaths.length, status: scopedStatus });
  });

  app.patch("/api/status/:imageName", (req, res) => {
    const folder =
      typeof req.query.folder === "string"
        ? req.query.folder
        : typeof req.body?.folder === "string"
          ? req.body.folder
          : "";
    if (folder.trim().length === 0) {
      return res.status(400).json({ error: "Folder path is required." });
    }

    if (!fs.existsSync(folder)) {
      return res.status(404).json({ error: "Folder not found." });
    }

    if (!isDirectory(folder)) {
      return res.status(400).json({ error: "Provided path is not a directory." });
    }

    const imageName = req.params.imageName;
    if (typeof imageName !== "string" || imageName.trim().length === 0) {
      return res.status(400).json({ error: "Image name is required." });
    }

    if (imageName !== path.basename(imageName)) {
      return res.status(400).json({ error: "Invalid image name." });
    }

    const imagePath = path.join(folder, imageName);
    if (!fs.existsSync(imagePath)) {
      return res.status(404).json({ error: "Image not found." });
    }

    const { processingStatus, reviewStatus, currentVersion, error } = req.body ?? {};
    const hasUpdates =
      processingStatus !== undefined ||
      reviewStatus !== undefined ||
      currentVersion !== undefined ||
      error !== undefined;
    if (!hasUpdates) {
      return res.status(400).json({ error: "No status updates provided." });
    }

    if (processingStatus !== undefined && !processingStatuses.has(processingStatus)) {
      return res.status(400).json({ error: "Invalid processingStatus value." });
    }

    if (reviewStatus !== undefined && !reviewStatuses.has(reviewStatus)) {
      return res.status(400).json({ error: "Invalid reviewStatus value." });
    }

    if (currentVersion !== undefined) {
      if (
        typeof currentVersion !== "number" ||
        !Number.isFinite(currentVersion) ||
        !Number.isInteger(currentVersion) ||
        currentVersion < 1
      ) {
        return res.status(400).json({ error: "Invalid currentVersion value." });
      }
    }

    if (error !== undefined && typeof error !== "string") {
      return res.status(400).json({ error: "Invalid error value." });
    }

    const statusFilePath = path.join(folder, config.statusFile);
    const status = loadStatusFile(statusFilePath);
    const entry = ensureStatusEntry(status, imagePath);

    if (processingStatus !== undefined) {
      entry.processingStatus = processingStatus;
      if (processingStatus === "completed") {
        entry.completedAt = new Date().toISOString();
      } else {
        delete entry.completedAt;
      }
      if (processingStatus !== "error" && error === undefined) {
        delete entry.error;
      }
    }

    if (reviewStatus !== undefined) {
      entry.reviewStatus = reviewStatus;
      if (reviewStatus === "verified") {
        entry.verifiedAt = new Date().toISOString();
      } else {
        delete entry.verifiedAt;
      }
    }

    if (currentVersion !== undefined) {
      entry.currentVersion = currentVersion;
    }

    if (error !== undefined) {
      if (error.trim().length > 0) {
        entry.error = error;
      } else {
        delete entry.error;
      }
    }

    saveStatusFile(status, statusFilePath);
    return res.json({ folder, imagePath, status: entry });
  });

  app.get("/api/transcription/:imageName", (req, res) => {
    const folder = typeof req.query.folder === "string" ? req.query.folder : "";
    if (folder.trim().length === 0) {
      return res.status(400).json({ error: "Query parameter 'folder' is required." });
    }

    if (!fs.existsSync(folder)) {
      return res.status(404).json({ error: "Folder not found." });
    }

    if (!isDirectory(folder)) {
      return res.status(400).json({ error: "Provided path is not a directory." });
    }

    const imageName = req.params.imageName;
    if (typeof imageName !== "string" || imageName.trim().length === 0) {
      return res.status(400).json({ error: "Image name is required." });
    }

    if (imageName !== path.basename(imageName)) {
      return res.status(400).json({ error: "Invalid image name." });
    }

    const baseName = path.basename(imageName, path.extname(imageName));

    // Check status file for version info
    const statusFilePath = path.join(folder, config.statusFile);
    const status = fs.existsSync(statusFilePath) ? loadStatusFile(statusFilePath) : {};
    const imagePath = path.join(folder, imageName);
    const entry = status[imagePath];
    const version = entry?.currentVersion ?? 1;

    // Try versioned file first (e.g., slide_001_v2.md), then base file (slide_001.md)
    let mdPath: string;
    if (version > 1) {
      mdPath = path.join(folder, `${baseName}_v${version}.md`);
      if (!fs.existsSync(mdPath)) {
        mdPath = path.join(folder, `${baseName}.md`);
      }
    } else {
      mdPath = path.join(folder, `${baseName}.md`);
    }

    if (!fs.existsSync(mdPath)) {
      return res.status(404).json({ error: "Transcription not found for this image." });
    }

    const content = fs.readFileSync(mdPath, "utf-8");
    return res.json({ imageName, content, version });
  });

  app.put("/api/transcription/:imageName", (req, res) => {
    const folder = typeof req.body?.folder === "string" ? req.body.folder : "";
    if (folder.trim().length === 0) {
      return res.status(400).json({ error: "Folder path is required." });
    }

    if (!fs.existsSync(folder)) {
      return res.status(404).json({ error: "Folder not found." });
    }

    if (!isDirectory(folder)) {
      return res.status(400).json({ error: "Provided path is not a directory." });
    }

    const imageName = req.params.imageName;
    if (typeof imageName !== "string" || imageName.trim().length === 0) {
      return res.status(400).json({ error: "Image name is required." });
    }

    if (imageName !== path.basename(imageName)) {
      return res.status(400).json({ error: "Invalid image name." });
    }

    const { content } = req.body ?? {};
    if (typeof content !== "string") {
      return res.status(400).json({ error: "content is required." });
    }

    const baseName = path.basename(imageName, path.extname(imageName));

    // Check status file for version info
    const statusFilePath = path.join(folder, config.statusFile);
    const status = fs.existsSync(statusFilePath) ? loadStatusFile(statusFilePath) : {};
    const imagePath = path.join(folder, imageName);
    const entry = status[imagePath];
    const version = entry?.currentVersion ?? 1;

    // Resolve the correct versioned file path
    let mdPath: string;
    if (version > 1) {
      mdPath = path.join(folder, `${baseName}_v${version}.md`);
      if (!fs.existsSync(mdPath)) {
        mdPath = path.join(folder, `${baseName}.md`);
      }
    } else {
      mdPath = path.join(folder, `${baseName}.md`);
    }

    if (!fs.existsSync(mdPath)) {
      return res.status(404).json({ error: "Transcription not found for this image." });
    }

    fs.writeFileSync(mdPath, content, "utf-8");
    return res.json({ imageName, content, version });
  });

  app.get("/api/image/:imageName", (req, res) => {
    const folder = typeof req.query.folder === "string" ? req.query.folder : "";
    if (folder.trim().length === 0) {
      return res.status(400).json({ error: "Query parameter 'folder' is required." });
    }

    if (!fs.existsSync(folder)) {
      return res.status(404).json({ error: "Folder not found." });
    }

    if (!isDirectory(folder)) {
      return res.status(400).json({ error: "Provided path is not a directory." });
    }

    const imageName = req.params.imageName;
    if (typeof imageName !== "string" || imageName.trim().length === 0) {
      return res.status(400).json({ error: "Image name is required." });
    }

    if (imageName !== path.basename(imageName)) {
      return res.status(400).json({ error: "Invalid image name." });
    }

    const imagePath = path.join(folder, imageName);
    if (!fs.existsSync(imagePath)) {
      return res.status(404).json({ error: "Image not found." });
    }

    const ext = path.extname(imageName).toLowerCase();
    const mimeTypes: Record<string, string> = {
      ".jpg": "image/jpeg",
      ".jpeg": "image/jpeg",
      ".png": "image/png",
      ".webp": "image/webp",
    };
    const contentType = mimeTypes[ext] ?? "application/octet-stream";

    res.setHeader("Content-Type", contentType);
    const fileBuffer = fs.readFileSync(imagePath);
    return res.send(fileBuffer);
  });

  app.patch("/api/review/:imageName", (req, res) => {
    const folder = typeof req.body?.folder === "string" ? req.body.folder : "";
    if (folder.trim().length === 0) {
      return res.status(400).json({ error: "Folder path is required." });
    }

    if (!fs.existsSync(folder)) {
      return res.status(404).json({ error: "Folder not found." });
    }

    if (!isDirectory(folder)) {
      return res.status(400).json({ error: "Provided path is not a directory." });
    }

    const imageName = req.params.imageName;
    if (typeof imageName !== "string" || imageName.trim().length === 0) {
      return res.status(400).json({ error: "Image name is required." });
    }

    if (imageName !== path.basename(imageName)) {
      return res.status(400).json({ error: "Invalid image name." });
    }

    const { reviewStatus } = req.body ?? {};
    if (reviewStatus === undefined) {
      return res.status(400).json({ error: "reviewStatus is required." });
    }

    if (!reviewStatuses.has(reviewStatus)) {
      return res.status(400).json({ error: "Invalid reviewStatus value." });
    }

    const imagePath = path.join(folder, imageName);
    const statusFilePath = path.join(folder, config.statusFile);
    const status = loadStatusFile(statusFilePath);
    ensureStatusEntry(status, imagePath);

    updateReviewStatus(status, imagePath, reviewStatus, statusFilePath);

    return res.json({ folder, imagePath, status: status[imagePath] });
  });

  app.get("/api/csv", (req, res) => {
    const folder = typeof req.query.folder === "string" ? req.query.folder : "";
    if (folder.trim().length === 0) {
      return res.status(400).json({ error: "Query parameter 'folder' is required." });
    }

    if (!fs.existsSync(folder)) {
      return res.status(404).json({ error: "Folder not found." });
    }

    if (!isDirectory(folder)) {
      return res.status(400).json({ error: "Provided path is not a directory." });
    }

    const imagePaths = deps.getImageFiles(folder);
    const statusFilePath = path.join(folder, config.statusFile);
    const status = loadStatusFile(statusFilePath);

    // Ensure all images have status entries
    for (const imagePath of imagePaths) {
      if (!status[imagePath]) {
        status[imagePath] = createDefaultStatusEntry();
      } else {
        status[imagePath] = ensureStatusEntry(status, imagePath);
      }
    }

    const csv = generateTrackingCsv(status);

    res.setHeader("Content-Type", "text/csv");
    res.setHeader("Content-Disposition", "attachment; filename=transcription-tracking.csv");
    return res.send(csv);
  });

  app.get("/api/custom-instructions", (req, res) => {
    const folder = typeof req.query.folder === "string" ? req.query.folder : "";
    if (folder.trim().length === 0) {
      return res.status(400).json({ error: "Query parameter 'folder' is required." });
    }

    if (!fs.existsSync(folder)) {
      return res.status(404).json({ error: "Folder not found." });
    }

    if (!isDirectory(folder)) {
      return res.status(400).json({ error: "Provided path is not a directory." });
    }

    const filePath = path.join(folder, "custom_instructions.txt");
    const instructions = fs.existsSync(filePath) ? fs.readFileSync(filePath, "utf-8") : "";
    return res.json({ instructions });
  });

  app.post("/api/custom-instructions", (req, res) => {
    const folder = typeof req.body?.folder === "string" ? req.body.folder : "";
    if (folder.trim().length === 0) {
      return res.status(400).json({ error: "Folder path is required." });
    }

    if (!fs.existsSync(folder)) {
      return res.status(404).json({ error: "Folder not found." });
    }

    if (!isDirectory(folder)) {
      return res.status(400).json({ error: "Provided path is not a directory." });
    }

    const instructions = typeof req.body?.instructions === "string" ? req.body.instructions : "";
    const filePath = path.join(folder, "custom_instructions.txt");
    fs.writeFileSync(filePath, instructions, "utf-8");
    return res.json({ instructions });
  });

  app.post("/api/suggest-name/:imageName", createSuggestNameHandler(deps));

  app.get("/api/models", async (_req, res) => {
    try {
      const models = await deps.aiProvider.getAvailableModels();
      const current = deps.aiProvider.getCurrentModel();
      return res.json({ models, current });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to get models.";
      return res.status(500).json({ error: message });
    }
  });

  app.post("/api/model", async (req, res) => {
    const { provider, modelId } = req.body ?? {};
    if (typeof provider !== "string" || typeof modelId !== "string") {
      return res.status(400).json({ error: "provider and modelId are required." });
    }

    try {
      await deps.aiProvider.setModel(provider, modelId);
      const current = deps.aiProvider.getCurrentModel();
      return res.json({ current });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to switch model.";
      return res.status(400).json({ error: message });
    }
  });

  app.post("/api/transcribe", createTranscribeHandler(deps));

  app.post("/api/rename/:imageName", (req, res) => {
    const folder = typeof req.body?.folder === "string" ? req.body.folder : "";
    if (folder.trim().length === 0) {
      return res.status(400).json({ error: "Folder path is required." });
    }

    if (!fs.existsSync(folder)) {
      return res.status(404).json({ error: "Folder not found." });
    }

    if (!isDirectory(folder)) {
      return res.status(400).json({ error: "Provided path is not a directory." });
    }

    const imageName = req.params.imageName;
    if (typeof imageName !== "string" || imageName.trim().length === 0) {
      return res.status(400).json({ error: "Image name is required." });
    }

    if (imageName !== path.basename(imageName)) {
      return res.status(400).json({ error: "Invalid image name." });
    }

    const newName = typeof req.body?.newName === "string" ? req.body.newName.trim() : "";
    if (newName.length === 0) {
      return res.status(400).json({ error: "newName is required." });
    }

    const imagePath = path.join(folder, imageName);
    if (!fs.existsSync(imagePath)) {
      return res.status(404).json({ error: "Image not found." });
    }

    const ext = path.extname(imageName);
    const newImageName = newName + ext;
    const newImagePath = path.join(folder, newImageName);

    if (fs.existsSync(newImagePath)) {
      return res.status(409).json({ error: "A file with that name already exists." });
    }

    // Rename image file
    fs.renameSync(imagePath, newImagePath);

    // Rename corresponding md file(s)
    const oldBaseName = path.basename(imageName, ext);
    const statusFilePath = path.join(folder, config.statusFile);
    const status = loadStatusFile(statusFilePath);
    const entry = status[imagePath];
    const version = entry?.currentVersion ?? 1;

    const oldMdName = version > 1 ? `${oldBaseName}_v${version}.md` : `${oldBaseName}.md`;
    const newMdName = version > 1 ? `${newName}_v${version}.md` : `${newName}.md`;
    const oldMdPath = path.join(folder, oldMdName);
    const newMdPath = path.join(folder, newMdName);

    if (fs.existsSync(oldMdPath)) {
      fs.renameSync(oldMdPath, newMdPath);
    }

    // Update status JSON key
    if (entry) {
      delete status[imagePath];
      status[newImagePath] = entry;
      saveStatusFile(status, statusFilePath);
    }

    return res.json({ newImageName, newImagePath, oldImageName: imageName });
  });

  app.post("/api/reprocess/:imageName", createReprocessHandler(deps));

  return app;
}