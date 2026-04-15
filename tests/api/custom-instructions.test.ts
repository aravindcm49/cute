import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createMocks } from "node-mocks-http";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { createApp } from "../../server/app";
import { createTestDeps } from "../helpers";

function createTempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "sandcastle-instructions-"));
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

describe("Custom Instructions API", () => {
  let tempDir: string;
  let app: ReturnType<typeof createApp>;

  beforeEach(() => {
    tempDir = createTempDir();
    app = createApp(createTestDeps());
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  describe("POST /api/custom-instructions", () => {
    it("saves instructions to custom_instructions.txt", async () => {
      const res = await invokeApp(app, {
        method: "POST",
        url: "/api/custom-instructions",
        headers: { "content-type": "application/json" },
        body: { folder: tempDir, instructions: "These are photos from a CAFI meetup" },
      });

      expect(res._getStatusCode()).toBe(200);
      const filePath = path.join(tempDir, "custom_instructions.txt");
      expect(fs.existsSync(filePath)).toBe(true);
      expect(fs.readFileSync(filePath, "utf-8")).toBe("These are photos from a CAFI meetup");
    });

    it("returns 400 when folder is missing", async () => {
      const res = await invokeApp(app, {
        method: "POST",
        url: "/api/custom-instructions",
        headers: { "content-type": "application/json" },
        body: { instructions: "test" },
      });

      expect(res._getStatusCode()).toBe(400);
    });

    it("returns 404 when folder does not exist", async () => {
      const res = await invokeApp(app, {
        method: "POST",
        url: "/api/custom-instructions",
        headers: { "content-type": "application/json" },
        body: { folder: "/nonexistent/path", instructions: "test" },
      });

      expect(res._getStatusCode()).toBe(404);
    });

    it("overwrites existing instructions", async () => {
      const filePath = path.join(tempDir, "custom_instructions.txt");
      fs.writeFileSync(filePath, "old instructions");

      const res = await invokeApp(app, {
        method: "POST",
        url: "/api/custom-instructions",
        headers: { "content-type": "application/json" },
        body: { folder: tempDir, instructions: "new instructions" },
      });

      expect(res._getStatusCode()).toBe(200);
      expect(fs.readFileSync(filePath, "utf-8")).toBe("new instructions");
    });
  });

  describe("GET /api/custom-instructions", () => {
    it("returns saved instructions", async () => {
      fs.writeFileSync(path.join(tempDir, "custom_instructions.txt"), "My custom prompt");

      const res = await invokeApp(app, {
        method: "GET",
        url: "/api/custom-instructions",
        query: { folder: tempDir },
      });

      expect(res._getStatusCode()).toBe(200);
      const body = res._getJSONData();
      expect(body.instructions).toBe("My custom prompt");
    });

    it("returns empty string when no file exists", async () => {
      const res = await invokeApp(app, {
        method: "GET",
        url: "/api/custom-instructions",
        query: { folder: tempDir },
      });

      expect(res._getStatusCode()).toBe(200);
      const body = res._getJSONData();
      expect(body.instructions).toBe("");
    });

    it("returns 400 when folder is missing", async () => {
      const res = await invokeApp(app, {
        method: "GET",
        url: "/api/custom-instructions",
        query: {},
      });

      expect(res._getStatusCode()).toBe(400);
    });

    it("returns 404 when folder does not exist", async () => {
      const res = await invokeApp(app, {
        method: "GET",
        url: "/api/custom-instructions",
        query: { folder: "/nonexistent/path" },
      });

      expect(res._getStatusCode()).toBe(404);
    });
  });
});
