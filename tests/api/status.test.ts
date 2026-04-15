import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createMocks } from "node-mocks-http";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { createApp } from "../../server/app";
import { createTestDeps } from "../helpers";

function createTempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "sandcastle-status-"));
}

describe("/api/status", () => {
  let tempDir: string;

  async function invokeStatus(folder?: string) {
    const app = createApp(createTestDeps());
    const { req, res } = createMocks({
      method: "GET",
      url: "/api/status",
      query: folder ? { folder } : {},
    });

    const handler = app as unknown as (req: any, res: any) => void;

    await new Promise<void>((resolve) => {
      const done = () => resolve();
      res.on("end", done);
      res.on("finish", done);
      handler(req, res);
      if (res.writableEnded) {
        resolve();
      }
    });

    return res;
  }

  async function invokePatch(
    folder: string | undefined,
    imageName: string,
    body: Record<string, unknown>
  ) {
    const app = createApp(createTestDeps());
    const { req, res } = createMocks({
      method: "PATCH",
      url: `/api/status/${imageName}`,
      params: { imageName },
      query: folder ? { folder } : {},
      headers: { "content-type": "application/json" },
      body,
    });

    const handler = app as unknown as (req: any, res: any) => void;

    await new Promise<void>((resolve) => {
      const done = () => resolve();
      res.on("end", done);
      res.on("finish", done);
      handler(req, res);
      if (res.writableEnded) {
        resolve();
      }
    });

    return res;
  }

  beforeEach(() => {
    tempDir = createTempDir();
    fs.writeFileSync(path.join(tempDir, "one.jpg"), "");
    fs.writeFileSync(path.join(tempDir, "two.png"), "");
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it("returns default status for each image in folder and persists the file", async () => {
    const response = await invokeStatus(tempDir);

    expect(response._getStatusCode()).toBe(200);
    const body = response._getJSONData();
    expect(body.count).toBe(2);

    const status = body.status as Record<string, any>;
    const expectedKeys = [path.join(tempDir, "one.jpg"), path.join(tempDir, "two.png")].sort();
    expect(Object.keys(status).sort()).toEqual(expectedKeys);

    for (const entry of Object.values(status)) {
      expect(entry.processingStatus).toBe("pending");
      expect(entry.reviewStatus).toBe("not-verified");
      expect(entry.currentVersion).toBe(1);
    }

    const statusFile = path.join(tempDir, "transcription-status.json");
    expect(fs.existsSync(statusFile)).toBe(true);
    const fileData = JSON.parse(fs.readFileSync(statusFile, "utf-8"));
    expect(Object.keys(fileData).sort()).toEqual(expectedKeys);
  });

  it("patches status for a single image and persists timestamps", async () => {
    await invokeStatus(tempDir);

    const response = await invokePatch(tempDir, "one.jpg", {
      processingStatus: "completed",
      reviewStatus: "verified",
    });

    expect(response._getStatusCode()).toBe(200);
    const body = response._getJSONData();
    expect(body.imagePath).toBe(path.join(tempDir, "one.jpg"));
    expect(body.status.processingStatus).toBe("completed");
    expect(body.status.reviewStatus).toBe("verified");
    expect(typeof body.status.completedAt).toBe("string");
    expect(typeof body.status.verifiedAt).toBe("string");

    const statusFile = path.join(tempDir, "transcription-status.json");
    const fileData = JSON.parse(fs.readFileSync(statusFile, "utf-8"));
    expect(fileData[path.join(tempDir, "one.jpg")].processingStatus).toBe("completed");
    expect(fileData[path.join(tempDir, "one.jpg")].reviewStatus).toBe("verified");
  });
});
