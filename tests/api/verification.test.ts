import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createMocks } from "node-mocks-http";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { createApp } from "../../server/app";

function createTempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "sandcastle-verification-"));
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

describe("GET /api/transcription/:imageName", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = createTempDir();
    fs.writeFileSync(path.join(tempDir, "slide_001.jpg"), "");
    fs.writeFileSync(path.join(tempDir, "slide_002.png"), "");
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it("returns markdown content for an image with a transcription file", async () => {
    const mdContent = "# Slide 001\n\n## Description\n\nA test slide.\n";
    fs.writeFileSync(path.join(tempDir, "slide_001.md"), mdContent);

    const app = createApp();
    const res = await invokeApp(app, {
      method: "GET",
      url: `/api/transcription/slide_001.jpg`,
      params: { imageName: "slide_001.jpg" },
      query: { folder: tempDir },
    });

    expect(res._getStatusCode()).toBe(200);
    const body = res._getJSONData();
    expect(body.imageName).toBe("slide_001.jpg");
    expect(body.content).toBe(mdContent);
  });

  it("returns 404 when no transcription file exists", async () => {
    const app = createApp();
    const res = await invokeApp(app, {
      method: "GET",
      url: `/api/transcription/slide_002.png`,
      params: { imageName: "slide_002.png" },
      query: { folder: tempDir },
    });

    expect(res._getStatusCode()).toBe(404);
    const body = res._getJSONData();
    expect(body.error).toContain("Transcription");
  });

  it("returns 400 when folder is missing", async () => {
    const app = createApp();
    const res = await invokeApp(app, {
      method: "GET",
      url: `/api/transcription/slide_001.jpg`,
      params: { imageName: "slide_001.jpg" },
      query: {},
    });

    expect(res._getStatusCode()).toBe(400);
  });

  it("returns versioned transcription when version > 1", async () => {
    const mdContent = "# Slide 001 v2\n\nRe-processed version.\n";
    fs.writeFileSync(path.join(tempDir, "slide_001_v2.md"), mdContent);

    // Set up status with currentVersion: 2
    const statusFile = path.join(tempDir, "transcription-status.json");
    const status: Record<string, any> = {};
    status[path.join(tempDir, "slide_001.jpg")] = {
      processingStatus: "completed",
      reviewStatus: "not-verified",
      currentVersion: 2,
    };
    fs.writeFileSync(statusFile, JSON.stringify(status, null, 2));

    const app = createApp();
    const res = await invokeApp(app, {
      method: "GET",
      url: `/api/transcription/slide_001.jpg`,
      params: { imageName: "slide_001.jpg" },
      query: { folder: tempDir },
    });

    expect(res._getStatusCode()).toBe(200);
    const body = res._getJSONData();
    expect(body.content).toBe(mdContent);
    expect(body.version).toBe(2);
  });
});

describe("PUT /api/transcription/:imageName", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = createTempDir();
    fs.writeFileSync(path.join(tempDir, "slide_001.jpg"), "");
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it("writes content to the transcription file and returns updated content", async () => {
    const originalContent = "# Slide 001\n\nOriginal.\n";
    fs.writeFileSync(path.join(tempDir, "slide_001.md"), originalContent);

    const newContent = "# Slide 001\n\n## Description\n\nEdited description.\n";
    const app = createApp();
    const res = await invokeApp(app, {
      method: "PUT",
      url: `/api/transcription/slide_001.jpg`,
      params: { imageName: "slide_001.jpg" },
      body: { folder: tempDir, content: newContent },
    });

    expect(res._getStatusCode()).toBe(200);
    const body = res._getJSONData();
    expect(body.imageName).toBe("slide_001.jpg");
    expect(body.content).toBe(newContent);

    // Verify file was actually written
    const onDisk = fs.readFileSync(path.join(tempDir, "slide_001.md"), "utf-8");
    expect(onDisk).toBe(newContent);
  });

  it("writes to the versioned file when version > 1", async () => {
    const v2Content = "# Slide 001 v2\n";
    fs.writeFileSync(path.join(tempDir, "slide_001_v2.md"), v2Content);

    const statusFile = path.join(tempDir, "transcription-status.json");
    const status: Record<string, any> = {};
    status[path.join(tempDir, "slide_001.jpg")] = {
      processingStatus: "completed",
      reviewStatus: "not-verified",
      currentVersion: 2,
    };
    fs.writeFileSync(statusFile, JSON.stringify(status, null, 2));

    const newContent = "# Slide 001 v2 edited\n";
    const app = createApp();
    const res = await invokeApp(app, {
      method: "PUT",
      url: `/api/transcription/slide_001.jpg`,
      params: { imageName: "slide_001.jpg" },
      body: { folder: tempDir, content: newContent },
    });

    expect(res._getStatusCode()).toBe(200);
    const body = res._getJSONData();
    expect(body.content).toBe(newContent);
    expect(body.version).toBe(2);

    const onDisk = fs.readFileSync(path.join(tempDir, "slide_001_v2.md"), "utf-8");
    expect(onDisk).toBe(newContent);
  });

  it("returns 404 when transcription file does not exist", async () => {
    const app = createApp();
    const res = await invokeApp(app, {
      method: "PUT",
      url: `/api/transcription/slide_001.jpg`,
      params: { imageName: "slide_001.jpg" },
      body: { folder: tempDir, content: "new content" },
    });

    expect(res._getStatusCode()).toBe(404);
    const body = res._getJSONData();
    expect(body.error).toContain("Transcription");
  });

  it("returns 400 when folder is missing", async () => {
    const app = createApp();
    const res = await invokeApp(app, {
      method: "PUT",
      url: `/api/transcription/slide_001.jpg`,
      params: { imageName: "slide_001.jpg" },
      body: { content: "new content" },
    });

    expect(res._getStatusCode()).toBe(400);
  });

  it("returns 400 when content is missing", async () => {
    const app = createApp();
    const res = await invokeApp(app, {
      method: "PUT",
      url: `/api/transcription/slide_001.jpg`,
      params: { imageName: "slide_001.jpg" },
      body: { folder: tempDir },
    });

    expect(res._getStatusCode()).toBe(400);
    const body = res._getJSONData();
    expect(body.error).toContain("content");
  });

  it("rejects image names with path separators", async () => {
    const app = createApp();
    const res = await invokeApp(app, {
      method: "PUT",
      url: `/api/transcription/..%2Fetc%2Fpasswd`,
      params: { imageName: "sub/file.jpg" },
      body: { folder: tempDir, content: "malicious" },
    });

    expect(res._getStatusCode()).toBe(400);
    const body = res._getJSONData();
    expect(body.error).toContain("Invalid");
  });
});

describe("GET /api/image/:imageName", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = createTempDir();
    // Write a tiny valid JPEG (just the magic bytes for test purposes)
    const jpegHeader = Buffer.from([0xff, 0xd8, 0xff, 0xe0]);
    fs.writeFileSync(path.join(tempDir, "slide_001.jpg"), jpegHeader);
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it("serves the image file", async () => {
    const app = createApp();
    const res = await invokeApp(app, {
      method: "GET",
      url: `/api/image/slide_001.jpg`,
      params: { imageName: "slide_001.jpg" },
      query: { folder: tempDir },
    });

    expect(res._getStatusCode()).toBe(200);
  });

  it("returns 404 for nonexistent image", async () => {
    const app = createApp();
    const res = await invokeApp(app, {
      method: "GET",
      url: `/api/image/missing.jpg`,
      params: { imageName: "missing.jpg" },
      query: { folder: tempDir },
    });

    expect(res._getStatusCode()).toBe(404);
  });

  it("rejects image names containing path separators", async () => {
    const app = createApp();
    const res = await invokeApp(app, {
      method: "GET",
      url: `/api/image/..%2Fetc%2Fpasswd`,
      params: { imageName: "../etc/passwd" },
      query: { folder: tempDir },
    });

    expect(res._getStatusCode()).toBe(400);
    const body = res._getJSONData();
    expect(body.error).toContain("Invalid");
  });
});
