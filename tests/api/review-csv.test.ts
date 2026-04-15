import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createMocks } from "node-mocks-http";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { createApp } from "../../server/app";
import { createTestDeps } from "../helpers";

function createTempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "sandcastle-review-csv-"));
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

describe("PATCH /api/review/:imageName", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = createTempDir();
    fs.writeFileSync(path.join(tempDir, "slide_001.jpg"), "");
    fs.writeFileSync(path.join(tempDir, "slide_002.png"), "");
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it("updates review status to verified and sets verifiedAt", async () => {
    // Initialize status
    const statusPath = path.join(tempDir, "transcription-status.json");
    const status = {
      [path.join(tempDir, "slide_001.jpg")]: {
        processingStatus: "completed",
        reviewStatus: "not-verified",
        currentVersion: 1,
      },
    };
    fs.writeFileSync(statusPath, JSON.stringify(status, null, 2));

    const app = createApp(createTestDeps());
    const res = await invokeApp(app, {
      method: "PATCH",
      url: `/api/review/slide_001.jpg`,
      params: { imageName: "slide_001.jpg" },
      headers: { "content-type": "application/json" },
      body: { folder: tempDir, reviewStatus: "verified" },
    });

    expect(res._getStatusCode()).toBe(200);
    const body = res._getJSONData();
    expect(body.status.reviewStatus).toBe("verified");
    expect(typeof body.status.verifiedAt).toBe("string");
  });

  it("updates review status to needs-improvement and clears verifiedAt", async () => {
    const statusPath = path.join(tempDir, "transcription-status.json");
    const status = {
      [path.join(tempDir, "slide_001.jpg")]: {
        processingStatus: "completed",
        reviewStatus: "verified",
        currentVersion: 1,
        verifiedAt: "2025-01-01T00:00:00.000Z",
      },
    };
    fs.writeFileSync(statusPath, JSON.stringify(status, null, 2));

    const app = createApp(createTestDeps());
    const res = await invokeApp(app, {
      method: "PATCH",
      url: `/api/review/slide_001.jpg`,
      params: { imageName: "slide_001.jpg" },
      headers: { "content-type": "application/json" },
      body: { folder: tempDir, reviewStatus: "needs-improvement" },
    });

    expect(res._getStatusCode()).toBe(200);
    const body = res._getJSONData();
    expect(body.status.reviewStatus).toBe("needs-improvement");
    expect(body.status.verifiedAt).toBeUndefined();
  });

  it("does not write CSV to disk on review status change", async () => {
    const statusPath = path.join(tempDir, "transcription-status.json");
    const status = {
      [path.join(tempDir, "slide_001.jpg")]: {
        processingStatus: "completed",
        reviewStatus: "not-verified",
        currentVersion: 1,
      },
      [path.join(tempDir, "slide_002.png")]: {
        processingStatus: "completed",
        reviewStatus: "not-verified",
        currentVersion: 1,
      },
    };
    fs.writeFileSync(statusPath, JSON.stringify(status, null, 2));

    const app = createApp(createTestDeps());
    await invokeApp(app, {
      method: "PATCH",
      url: `/api/review/slide_001.jpg`,
      params: { imageName: "slide_001.jpg" },
      headers: { "content-type": "application/json" },
      body: { folder: tempDir, reviewStatus: "verified" },
    });

    const csvPath = path.join(tempDir, "transcription-tracking.csv");
    expect(fs.existsSync(csvPath)).toBe(false);
  });

  it("returns 400 for invalid reviewStatus", async () => {
    const app = createApp(createTestDeps());
    const res = await invokeApp(app, {
      method: "PATCH",
      url: `/api/review/slide_001.jpg`,
      params: { imageName: "slide_001.jpg" },
      headers: { "content-type": "application/json" },
      body: { folder: tempDir, reviewStatus: "invalid" },
    });

    expect(res._getStatusCode()).toBe(400);
  });

  it("returns 400 when reviewStatus is missing", async () => {
    const app = createApp(createTestDeps());
    const res = await invokeApp(app, {
      method: "PATCH",
      url: `/api/review/slide_001.jpg`,
      params: { imageName: "slide_001.jpg" },
      headers: { "content-type": "application/json" },
      body: { folder: tempDir },
    });

    expect(res._getStatusCode()).toBe(400);
  });
});

describe("GET /api/csv", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = createTempDir();
    fs.writeFileSync(path.join(tempDir, "slide_001.jpg"), "");
    fs.writeFileSync(path.join(tempDir, "slide_002.png"), "");
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it("returns CSV with correct columns and data", async () => {
    const statusPath = path.join(tempDir, "transcription-status.json");
    const status = {
      [path.join(tempDir, "slide_001.jpg")]: {
        processingStatus: "completed",
        reviewStatus: "verified",
        currentVersion: 1,
        verifiedAt: "2025-06-01T10:00:00.000Z",
      },
      [path.join(tempDir, "slide_002.png")]: {
        processingStatus: "completed",
        reviewStatus: "needs-improvement",
        currentVersion: 2,
      },
    };
    fs.writeFileSync(statusPath, JSON.stringify(status, null, 2));

    const app = createApp(createTestDeps());
    const res = await invokeApp(app, {
      method: "GET",
      url: `/api/csv`,
      query: { folder: tempDir },
    });

    expect(res._getStatusCode()).toBe(200);
    const contentType = res._getHeaders()["content-type"];
    expect(contentType).toContain("text/csv");

    const csv = res._getData();
    const lines = csv.trim().split("\n");
    expect(lines.length).toBe(3); // header + 2 data rows

    const header = lines[0];
    expect(header).toBe("image_name,processing_status,review_status,version,verified_at,notes");

    // Check that data rows contain expected values
    expect(csv).toContain("slide_001.jpg,completed,verified,1,2025-06-01T10:00:00.000Z,");
    expect(csv).toContain("slide_002.png,completed,needs-improvement,2,,");
  });

  it("returns 400 when folder is missing", async () => {
    const app = createApp(createTestDeps());
    const res = await invokeApp(app, {
      method: "GET",
      url: `/api/csv`,
      query: {},
    });

    expect(res._getStatusCode()).toBe(400);
  });

  it("returns CSV with empty data when no status file exists", async () => {
    const app = createApp(createTestDeps());
    const res = await invokeApp(app, {
      method: "GET",
      url: `/api/csv`,
      query: { folder: tempDir },
    });

    expect(res._getStatusCode()).toBe(200);
    const csv = res._getData();
    const lines = csv.trim().split("\n");
    // Header + rows for images that exist (initialized with defaults)
    expect(lines.length).toBeGreaterThanOrEqual(1);
    expect(lines[0]).toContain("image_name");
  });
});
