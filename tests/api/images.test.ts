import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createMocks } from "node-mocks-http";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { createApp } from "../../server/app";
import { createTestDeps } from "../helpers";

function createTempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "sandcastle-images-"));
}

describe("GET /api/images", () => {
  let tempDir: string;
  async function invokeImages(folder?: string) {
    const app = createApp(createTestDeps());
    const { req, res } = createMocks({
      method: "GET",
      url: "/api/images",
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

  beforeEach(() => {
    tempDir = createTempDir();
    fs.writeFileSync(path.join(tempDir, "one.jpg"), "");
    fs.writeFileSync(path.join(tempDir, "two.png"), "");
    fs.writeFileSync(path.join(tempDir, "ignore.txt"), "");
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it("lists supported image files", async () => {
    const response = await invokeImages(tempDir);

    expect(response._getStatusCode()).toBe(200);
    const body = response._getJSONData();
    expect(body.count).toBe(2);
    expect(body.images.map((image: { name: string }) => image.name).sort()).toEqual([
      "one.jpg",
      "two.png",
    ]);
  });

  it("returns 400 for missing folder parameter", async () => {
    const response = await invokeImages();

    expect(response._getStatusCode()).toBe(400);
    const body = response._getJSONData();
    expect(body.error).toContain("folder");
  });

  it("returns 404 when folder does not exist", async () => {
    const response = await invokeImages(path.join(tempDir, "missing"));

    expect(response._getStatusCode()).toBe(404);
  });
});
