import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createMocks } from "node-mocks-http";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { createApp } from "../../server/app";

function createTempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "sandcastle-rename-"));
}

function invokeApp(app: ReturnType<typeof createApp>, options: Parameters<typeof createMocks>[0]) {
  return new Promise<ReturnType<typeof createMocks>["res"]>((resolve) => {
    const { req, res } = createMocks(options);
    const handler = app as unknown as (req: any, res: any) => void;
    const done = () => resolve(res);
    res.on("end", done);
    res.on("finish", done);
    handler(req, res);
    if (res.writableEnded) {
      resolve(res);
    }
  });
}

describe("POST /api/rename/:imageName", () => {
  let tempDir: string;
  let app: ReturnType<typeof createApp>;

  beforeEach(() => {
    tempDir = createTempDir();
    app = createApp();
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it("renames image file, md file, and updates status JSON key", async () => {
    fs.writeFileSync(path.join(tempDir, "IMG_001.jpg"), "image-data");
    fs.writeFileSync(path.join(tempDir, "IMG_001.md"), "# Transcription");
    const statusPath = path.join(tempDir, "transcription-status.json");
    const status = {
      [path.join(tempDir, "IMG_001.jpg")]: {
        processingStatus: "completed",
        reviewStatus: "verified",
        currentVersion: 1,
        suggestedFilename: "cocktail-menu",
      },
    };
    fs.writeFileSync(statusPath, JSON.stringify(status, null, 2));

    const res = await invokeApp(app, {
      method: "POST",
      url: "/api/rename/IMG_001.jpg",
      params: { imageName: "IMG_001.jpg" },
      headers: { "content-type": "application/json" },
      body: { folder: tempDir, newName: "cocktail-menu" },
    });

    expect(res._getStatusCode()).toBe(200);
    const body = res._getJSONData();
    expect(body.newImageName).toBe("cocktail-menu.jpg");

    // Old files should not exist
    expect(fs.existsSync(path.join(tempDir, "IMG_001.jpg"))).toBe(false);
    expect(fs.existsSync(path.join(tempDir, "IMG_001.md"))).toBe(false);

    // New files should exist
    expect(fs.existsSync(path.join(tempDir, "cocktail-menu.jpg"))).toBe(true);
    expect(fs.existsSync(path.join(tempDir, "cocktail-menu.md"))).toBe(true);

    // Status JSON should have new key
    const updatedStatus = JSON.parse(fs.readFileSync(statusPath, "utf-8"));
    expect(updatedStatus[path.join(tempDir, "cocktail-menu.jpg")]).toBeDefined();
    expect(updatedStatus[path.join(tempDir, "IMG_001.jpg")]).toBeUndefined();
    expect(updatedStatus[path.join(tempDir, "cocktail-menu.jpg")].reviewStatus).toBe("verified");
  });

  it("returns 409 when target filename already exists", async () => {
    fs.writeFileSync(path.join(tempDir, "IMG_001.jpg"), "image-data");
    fs.writeFileSync(path.join(tempDir, "cocktail-menu.jpg"), "other-image");

    const res = await invokeApp(app, {
      method: "POST",
      url: "/api/rename/IMG_001.jpg",
      params: { imageName: "IMG_001.jpg" },
      headers: { "content-type": "application/json" },
      body: { folder: tempDir, newName: "cocktail-menu" },
    });

    expect(res._getStatusCode()).toBe(409);
  });

  it("returns 404 when source image does not exist", async () => {
    const res = await invokeApp(app, {
      method: "POST",
      url: "/api/rename/nonexistent.jpg",
      params: { imageName: "nonexistent.jpg" },
      headers: { "content-type": "application/json" },
      body: { folder: tempDir, newName: "new-name" },
    });

    expect(res._getStatusCode()).toBe(404);
  });

  it("handles missing md file gracefully", async () => {
    fs.writeFileSync(path.join(tempDir, "IMG_001.jpg"), "image-data");
    const statusPath = path.join(tempDir, "transcription-status.json");
    fs.writeFileSync(statusPath, JSON.stringify({
      [path.join(tempDir, "IMG_001.jpg")]: {
        processingStatus: "completed",
        reviewStatus: "not-verified",
        currentVersion: 1,
      },
    }, null, 2));

    const res = await invokeApp(app, {
      method: "POST",
      url: "/api/rename/IMG_001.jpg",
      params: { imageName: "IMG_001.jpg" },
      headers: { "content-type": "application/json" },
      body: { folder: tempDir, newName: "new-name" },
    });

    expect(res._getStatusCode()).toBe(200);
    expect(fs.existsSync(path.join(tempDir, "new-name.jpg"))).toBe(true);
    expect(fs.existsSync(path.join(tempDir, "IMG_001.jpg"))).toBe(false);
  });

  it("renames versioned md file when version > 1", async () => {
    fs.writeFileSync(path.join(tempDir, "IMG_001.jpg"), "image-data");
    fs.writeFileSync(path.join(tempDir, "IMG_001_v2.md"), "# V2 Transcription");
    const statusPath = path.join(tempDir, "transcription-status.json");
    fs.writeFileSync(statusPath, JSON.stringify({
      [path.join(tempDir, "IMG_001.jpg")]: {
        processingStatus: "completed",
        reviewStatus: "not-verified",
        currentVersion: 2,
      },
    }, null, 2));

    const res = await invokeApp(app, {
      method: "POST",
      url: "/api/rename/IMG_001.jpg",
      params: { imageName: "IMG_001.jpg" },
      headers: { "content-type": "application/json" },
      body: { folder: tempDir, newName: "renamed-slide" },
    });

    expect(res._getStatusCode()).toBe(200);
    expect(fs.existsSync(path.join(tempDir, "renamed-slide.jpg"))).toBe(true);
    expect(fs.existsSync(path.join(tempDir, "renamed-slide_v2.md"))).toBe(true);
    expect(fs.existsSync(path.join(tempDir, "IMG_001_v2.md"))).toBe(false);
  });

  it("returns 400 when newName is missing", async () => {
    fs.writeFileSync(path.join(tempDir, "IMG_001.jpg"), "image-data");

    const res = await invokeApp(app, {
      method: "POST",
      url: "/api/rename/IMG_001.jpg",
      params: { imageName: "IMG_001.jpg" },
      headers: { "content-type": "application/json" },
      body: { folder: tempDir },
    });

    expect(res._getStatusCode()).toBe(400);
  });

  it("returns 400 when folder is missing", async () => {
    const res = await invokeApp(app, {
      method: "POST",
      url: "/api/rename/IMG_001.jpg",
      params: { imageName: "IMG_001.jpg" },
      headers: { "content-type": "application/json" },
      body: { newName: "new-name" },
    });

    expect(res._getStatusCode()).toBe(400);
  });
});
