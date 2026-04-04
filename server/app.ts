import express from "express";
import * as fs from "fs";
import * as path from "path";
import { getImageFiles } from "../src/transcription";

const supportedExtensions = new Set([".jpg", ".jpeg", ".png", ".webp"]);

function isDirectory(folderPath: string): boolean {
  try {
    return fs.statSync(folderPath).isDirectory();
  } catch (error) {
    return false;
  }
}

export function createApp() {
  const app = express();
  app.use(express.json());

  app.get("/api/health", (_req, res) => {
    res.json({ ok: true });
  });

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

    const imagePaths = getImageFiles(folder).filter((filePath: string) => {
      return supportedExtensions.has(path.extname(filePath).toLowerCase());
    });

    const images = imagePaths.map((filePath: string) => ({
      name: path.basename(filePath),
      path: filePath,
    }));

    return res.json({ folder, count: images.length, images });
  });

  return app;
}
