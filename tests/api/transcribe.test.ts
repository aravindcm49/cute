import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { createMocks } from "node-mocks-http";
import { createTranscribeHandler, type TranscriptionDeps } from "../../server/app";

const transcribeImageMock = vi.fn();
const createTranscriptionClientMock = vi.fn();

function createTempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "sandcastle-transcribe-"));
}

async function invokeTranscribe(folder: string, acceptHeader?: string) {
  const supportedExtensions = new Set([".jpg", ".jpeg", ".png", ".webp"]);
  const deps: TranscriptionDeps = {
    createTranscriptionClient: createTranscriptionClientMock,
    transcribeImage: transcribeImageMock,
    getImageFiles: (dir: string) => {
      const entries = fs.readdirSync(dir);
      return entries
        .filter((entry) => supportedExtensions.has(path.extname(entry).toLowerCase()))
        .map((entry) => path.join(dir, entry));
    },
  };

  const handler = createTranscribeHandler(deps);
  const { req, res } = createMocks({
    method: "POST",
    url: "/api/transcribe",
    headers: {
      "content-type": "application/json",
      ...(acceptHeader ? { accept: acceptHeader } : {}),
    },
    body: { folder },
  });

  await handler(req, res);
  return res;
}

describe("POST /api/transcribe", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = createTempDir();
    fs.writeFileSync(path.join(tempDir, "one.jpg"), "");
    fs.writeFileSync(path.join(tempDir, "two.png"), "");
    createTranscriptionClientMock.mockResolvedValue({ client: {}, model: {} });
    transcribeImageMock.mockImplementation(async (_client, _model, imagePath, onProgress) => {
      onProgress?.(`[mock] ${path.basename(imagePath)}`);
      return { description: "desc", textContent: "text", keyInformation: [] };
    });
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
    transcribeImageMock.mockReset();
    createTranscriptionClientMock.mockReset();
  });

  it("skips completed images and updates status for pending ones", async () => {
    const statusPath = path.join(tempDir, "transcription-status.json");
    const status = {
      [path.join(tempDir, "one.jpg")]: {
        processingStatus: "completed",
        reviewStatus: "not-verified",
        currentVersion: 1,
      },
    };
    fs.writeFileSync(statusPath, JSON.stringify(status, null, 2));

    const response = await invokeTranscribe(tempDir);

    expect(response._getStatusCode()).toBe(200);
    const body = response._getJSONData();
    expect(body.total).toBe(2);
    expect(body.processed).toBe(1);
    expect(body.skipped).toBe(1);
    expect(body.errors).toBe(0);

    expect(transcribeImageMock).toHaveBeenCalledTimes(1);
    expect(transcribeImageMock.mock.calls[0][2]).toBe(path.join(tempDir, "two.png"));

    const updated = JSON.parse(fs.readFileSync(statusPath, "utf-8"));
    expect(updated[path.join(tempDir, "two.png")].processingStatus).toBe("completed");
    expect(updated[path.join(tempDir, "one.jpg")].processingStatus).toBe("completed");
  });

  it("streams progress updates when SSE is requested", async () => {
    const response = await invokeTranscribe(tempDir, "text/event-stream");

    expect(response._getStatusCode()).toBe(200);
    expect(response._getHeaders()["content-type"]).toContain("text/event-stream");

    const data = response._getData();
    expect(data).toContain("[mock]");
    expect(data).toContain("data: [DONE]");
  });
});
