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
import { createTranscriptionClient, getImageFiles, transcribeImage } from "../src/transcription";

const supportedExtensions = new Set([".jpg", ".jpeg", ".png", ".webp"]);
const processingStatuses = new Set(["pending", "in_progress", "completed", "error"]);
const reviewStatuses = new Set(["not-verified", "verified", "needs-improvement"]);

export type TranscriptionDeps = {
  createTranscriptionClient: typeof createTranscriptionClient;
  transcribeImage: typeof transcribeImage;
  getImageFiles: typeof getImageFiles;
};

export type HealthDeps = {
  createClient: () => Promise<unknown>;
  listLoaded: (client: unknown) => Promise<Array<{ identifier: string }>>;
  listDownloaded: (client: unknown) => Promise<Array<{ modelKey: string }>>;
  loadModel: (modelKey: string, client: unknown) => Promise<unknown>;
  modelName: string;
};

export function createHealthHandler(deps: HealthDeps) {
  return async (_req: express.Request, res: express.Response) => {
    let client: unknown;
    try {
      client = await deps.createClient();
    } catch {
      return res.json({ status: "no_connection", loadedModel: null, availableModels: [] });
    }

    let loadedModels: Array<{ identifier: string }>;
    try {
      loadedModels = await deps.listLoaded(client);
    } catch {
      return res.json({ status: "no_connection", loadedModel: null, availableModels: [] });
    }

    const isLoaded = loadedModels.some((m) => m.identifier === deps.modelName);
    if (isLoaded) {
      return res.json({ status: "ready", loadedModel: deps.modelName, availableModels: [] });
    }

    let downloadedModels: Array<{ modelKey: string }>;
    try {
      downloadedModels = await deps.listDownloaded(client);
    } catch {
      return res.json({ status: "no_connection", loadedModel: null, availableModels: [] });
    }

    const isDownloaded = downloadedModels.some((m) => m.modelKey === deps.modelName);
    if (isDownloaded) {
      try {
        await deps.loadModel(deps.modelName, client);
        return res.json({ status: "ready", loadedModel: deps.modelName, availableModels: [] });
      } catch {
        return res.json({
          status: "no_model",
          loadedModel: null,
          availableModels: downloadedModels.map((m) => m.modelKey),
        });
      }
    }

    return res.json({
      status: "no_model",
      loadedModel: null,
      availableModels: downloadedModels.map((m) => m.modelKey),
    });
  };
}

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

function writeTrackingCsv(folder: string, status: StatusFile): void {
  const csvPath = path.join(folder, "transcription-tracking.csv");
  const csv = generateTrackingCsv(status);
  fs.writeFileSync(csvPath, csv, "utf-8");
}

export function createTranscribeHandler(deps: TranscriptionDeps) {
  return async (req: express.Request, res: express.Response) => {
    const { createTranscriptionClient: createClient, transcribeImage: runTranscription, getImageFiles: listImages } =
      deps;

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

    const wantsSse =
      typeof req.headers.accept === "string" && req.headers.accept.includes("text/event-stream");

    if (wantsSse) {
      res.status(200);
      res.setHeader("Content-Type", "text/event-stream");
      res.setHeader("Cache-Control", "no-cache, no-transform");
      res.setHeader("Connection", "keep-alive");
      if (typeof res.flushHeaders === "function") {
        try {
          res.flushHeaders();
        } catch (error) {
          // Ignore flush errors in mock/test responses.
        }
      }
    }

    const sendSse = (message: string) => {
      if (!wantsSse) {
        return;
      }
      const sanitized = message.replace(/\r/g, "");
      const lines = sanitized.split("\n");
      for (const line of lines) {
        res.write(`data: ${line}\n`);
      }
      res.write("\n");
    };

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
      sendSse("No images found to process.");
      if (wantsSse) {
        sendSse("[DONE]");
        res.end();
        return;
      }
      return res.json({ folder, total: 0, processed: 0, skipped: 0, errors: 0, results });
    }

    const { client, model } = await createClient();

    // Load custom instructions for this folder
    const customInstructionsPath = path.join(folder, "custom_instructions.txt");
    const customInstructions = fs.existsSync(customInstructionsPath)
      ? fs.readFileSync(customInstructionsPath, "utf-8").trim()
      : "";

    let isClosed = false;
    req.on("close", () => {
      isClosed = true;
    });

    for (const imagePath of imagePaths) {
      if (isClosed) {
        break;
      }

      const imageName = path.basename(imagePath);
      if (status[imagePath]?.processingStatus === "completed") {
        skipped++;
        results.push({ imageName, status: "skipped" });
        sendSse(`[FILE_SKIP] ${imageName}`);
        continue;
      }

      sendSse(`[FILE_START] ${imageName}`);
      try {
        updateFileStatus(status, imagePath, "in_progress", undefined, statusFilePath);
        const transcription = await runTranscription(client, model, imagePath, (message) => {
          sendSse(message);
        }, customInstructions || undefined);
        // Save to the image folder so verification can find it
        saveVersionedTranscription(folder, imagePath, 1, transcription);
        updateFileStatus(status, imagePath, "completed", undefined, statusFilePath);
        completed++;
        results.push({ imageName, status: "completed" });
        sendSse(`[FILE_DONE] ${imageName}`);
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        updateFileStatus(status, imagePath, "error", errorMessage, statusFilePath);
        errors++;
        results.push({ imageName, status: "error", error: errorMessage });
        sendSse(`[FILE_ERROR] ${imageName} | ${errorMessage}`);
      }
    }

    if (wantsSse) {
      sendSse("[DONE]");
      res.end();
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

export function createReprocessHandler(deps: TranscriptionDeps) {
  return async (req: express.Request, res: express.Response) => {
    const { createTranscriptionClient: createClient, transcribeImage: runTranscription } = deps;

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

    const statusFilePath = path.join(folder, config.statusFile);
    const status = loadStatusFile(statusFilePath);
    const entry = ensureStatusEntry(status, imagePath);
    const currentVersion = entry.currentVersion;
    const nextVersion = currentVersion + 1;

    const wantsSse =
      typeof req.headers.accept === "string" && req.headers.accept.includes("text/event-stream");

    if (wantsSse) {
      res.status(200);
      res.setHeader("Content-Type", "text/event-stream");
      res.setHeader("Cache-Control", "no-cache, no-transform");
      res.setHeader("Connection", "keep-alive");
      if (typeof res.flushHeaders === "function") {
        try {
          res.flushHeaders();
        } catch (error) {
          // Ignore flush errors in mock/test responses.
        }
      }
    }

    const sendSse = (message: string) => {
      if (!wantsSse) {
        return;
      }
      const sanitized = message.replace(/\r/g, "");
      const lines = sanitized.split("\n");
      for (const line of lines) {
        res.write(`data: ${line}\n`);
      }
      res.write("\n");
    };

    try {
      const { client, model } = await createClient();

      sendSse(`[FILE_START] ${imageName}`);

      const result = await runTranscription(client, model, imagePath, (message) => {
        sendSse(message);
      }, combinedInstructions);

      saveVersionedTranscription(folder, imagePath, nextVersion, result);

      entry.currentVersion = nextVersion;
      entry.reviewStatus = "not-verified";
      entry.processingStatus = "completed";
      entry.completedAt = new Date().toISOString();
      delete entry.error;
      delete entry.verifiedAt;
      saveStatusFile(status, statusFilePath);

      if (wantsSse) {
        sendSse(`[FILE_DONE] ${imageName}`);
        res.end();
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

      if (wantsSse) {
        sendSse(`[FILE_ERROR] ${imageName} | ${errorMessage}`);
        res.end();
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

export function createApp(overrides: Partial<TranscriptionDeps> & { healthDeps?: HealthDeps } = {}) {
  const createClient = overrides.createTranscriptionClient ?? createTranscriptionClient;
  const runTranscription = overrides.transcribeImage ?? transcribeImage;
  const listImages = overrides.getImageFiles ?? getImageFiles;
  const deps: TranscriptionDeps = {
    createTranscriptionClient: createClient,
    transcribeImage: runTranscription,
    getImageFiles: listImages,
  };

  const app = express();
  app.use(express.json());

  const healthDeps: HealthDeps = {
    createClient: async () => {
      const { LMStudioClient } = await import("@lmstudio/sdk");
      return new LMStudioClient({ baseUrl: config.lmStudioBaseUrl });
    },
    listLoaded: async (client: unknown) => {
      const c = client as { llm: { listLoaded: () => Promise<Array<{ identifier: string }>> } };
      return c.llm.listLoaded();
    },
    listDownloaded: async (client: unknown) => {
      const c = client as { system: { listDownloadedModels: (domain: string) => Promise<Array<{ modelKey: string }>> } };
      return c.system.listDownloadedModels("llm");
    },
    loadModel: async (modelKey: string, client: unknown) => {
      const c = client as { llm: { load: (key: string) => Promise<unknown> } };
      return c.llm.load(modelKey);
    },
    modelName: config.modelName,
  };

  app.get("/api/health", createHealthHandler(overrides.healthDeps ?? healthDeps));

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

    const imagePaths = listImages(folder).filter((filePath: string) => {
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

    const imagePaths = listImages(folder);
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
    writeTrackingCsv(folder, status);

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

    const imagePaths = listImages(folder);
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

  app.post("/api/transcribe", createTranscribeHandler(deps));
  app.post("/api/reprocess/:imageName", createReprocessHandler(deps));

  return app;
}
