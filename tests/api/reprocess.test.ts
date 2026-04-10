import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { createMocks } from "node-mocks-http";
import { createReprocessHandler, type TranscriptionDeps } from "../../server/app";

const transcribeImageMock = vi.fn();
const createTranscriptionClientMock = vi.fn();

function createTempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "sandcastle-reprocess-"));
}

async function invokeReprocess(
  folder: string,
  imageName: string,
  deps?: Partial<TranscriptionDeps>,
  extraBody?: Record<string, unknown>
) {
  const supportedExtensions = new Set([".jpg", ".jpeg", ".png", ".webp"]);
  const fullDeps: TranscriptionDeps = {
    createTranscriptionClient: deps?.createTranscriptionClient ?? createTranscriptionClientMock,
    transcribeImage: deps?.transcribeImage ?? transcribeImageMock,
    getImageFiles: deps?.getImageFiles ?? ((dir: string) => {
      const entries = fs.readdirSync(dir);
      return entries
        .filter((entry) => supportedExtensions.has(path.extname(entry).toLowerCase()))
        .map((entry) => path.join(dir, entry));
    }),
  };

  const handler = createReprocessHandler(fullDeps);
  const { req, res } = createMocks({
    method: "POST",
    url: `/api/reprocess/${imageName}`,
    params: { imageName },
    headers: { "content-type": "application/json" },
    body: { folder, ...extraBody },
  });

  await handler(req, res);
  return res;
}

async function invokeReprocessSse(
  folder: string,
  imageName: string,
  deps?: Partial<TranscriptionDeps>,
  extraBody?: Record<string, unknown>
) {
  const supportedExtensions = new Set([".jpg", ".jpeg", ".png", ".webp"]);
  const fullDeps: TranscriptionDeps = {
    createTranscriptionClient: deps?.createTranscriptionClient ?? createTranscriptionClientMock,
    transcribeImage: deps?.transcribeImage ?? transcribeImageMock,
    getImageFiles: deps?.getImageFiles ?? ((dir: string) => {
      const entries = fs.readdirSync(dir);
      return entries
        .filter((entry) => supportedExtensions.has(path.extname(entry).toLowerCase()))
        .map((entry) => path.join(dir, entry));
    }),
  };

  const handler = createReprocessHandler(fullDeps);
  const { req, res } = createMocks({
    method: "POST",
    url: `/api/reprocess/${imageName}`,
    params: { imageName },
    headers: { "content-type": "application/json", accept: "text/event-stream" },
    body: { folder, ...extraBody },
  });

  await handler(req, res);
  return res;
}

describe("POST /api/reprocess/:imageName", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = createTempDir();
    fs.writeFileSync(path.join(tempDir, "slide_001.jpg"), "");
    fs.writeFileSync(path.join(tempDir, "slide_002.png"), "");
    createTranscriptionClientMock.mockResolvedValue({ client: {}, model: {} });
    transcribeImageMock.mockImplementation(async (_client: unknown, _model: unknown, _imagePath: string, onProgress?: (msg: string) => void) => {
      onProgress?.("token chunk 1");
      onProgress?.("token chunk 2");
      return { description: "desc", textContent: "text", keyInformation: ["info"] };
    });
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
    transcribeImageMock.mockReset();
    createTranscriptionClientMock.mockReset();
  });

  it("creates a versioned markdown file on successful re-process", async () => {
    // Set up initial status with version 1 and needs-improvement
    const statusPath = path.join(tempDir, "transcription-status.json");
    const status = {
      [path.join(tempDir, "slide_001.jpg")]: {
        processingStatus: "completed",
        reviewStatus: "needs-improvement",
        currentVersion: 1,
      },
    };
    fs.writeFileSync(statusPath, JSON.stringify(status, null, 2));

    const response = await invokeReprocess(tempDir, "slide_001.jpg");

    expect(response._getStatusCode()).toBe(200);
    const body = response._getJSONData();
    expect(body.version).toBe(2);
    expect(body.status.currentVersion).toBe(2);
    expect(body.status.reviewStatus).toBe("not-verified");

    // Verify the versioned markdown file was created
    const mdPath = path.join(tempDir, "slide_001_v2.md");
    expect(fs.existsSync(mdPath)).toBe(true);

    // Verify status file was updated
    const updatedStatus = JSON.parse(fs.readFileSync(statusPath, "utf-8"));
    const entry = updatedStatus[path.join(tempDir, "slide_001.jpg")];
    expect(entry.currentVersion).toBe(2);
    expect(entry.reviewStatus).toBe("not-verified");
  });

  it("keeps needs-improvement status and does not increment version on failure", async () => {
    const statusPath = path.join(tempDir, "transcription-status.json");
    const status = {
      [path.join(tempDir, "slide_001.jpg")]: {
        processingStatus: "completed",
        reviewStatus: "needs-improvement",
        currentVersion: 1,
      },
    };
    fs.writeFileSync(statusPath, JSON.stringify(status, null, 2));

    transcribeImageMock.mockRejectedValue(new Error("LLM connection failed"));

    const response = await invokeReprocess(tempDir, "slide_001.jpg");

    expect(response._getStatusCode()).toBe(500);
    const body = response._getJSONData();
    expect(body.error).toContain("LLM connection failed");

    // Verify version was NOT incremented
    const updatedStatus = JSON.parse(fs.readFileSync(statusPath, "utf-8"));
    const entry = updatedStatus[path.join(tempDir, "slide_001.jpg")];
    expect(entry.currentVersion).toBe(1);
    expect(entry.reviewStatus).toBe("needs-improvement");

    // Verify no versioned file was created
    expect(fs.existsSync(path.join(tempDir, "slide_001_v2.md"))).toBe(false);
  });

  it("returns 400 when folder is missing", async () => {
    const response = await invokeReprocess("", "slide_001.jpg");
    expect(response._getStatusCode()).toBe(400);
  });

  it("returns 404 when image does not exist", async () => {
    const response = await invokeReprocess(tempDir, "nonexistent.jpg");
    expect(response._getStatusCode()).toBe(404);
  });

  it("increments from version 2 to version 3 on second re-process", async () => {
    const statusPath = path.join(tempDir, "transcription-status.json");
    const status = {
      [path.join(tempDir, "slide_001.jpg")]: {
        processingStatus: "completed",
        reviewStatus: "needs-improvement",
        currentVersion: 2,
      },
    };
    fs.writeFileSync(statusPath, JSON.stringify(status, null, 2));

    const response = await invokeReprocess(tempDir, "slide_001.jpg");

    expect(response._getStatusCode()).toBe(200);
    const body = response._getJSONData();
    expect(body.version).toBe(3);

    // Verify v3 file was created
    const mdPath = path.join(tempDir, "slide_001_v3.md");
    expect(fs.existsSync(mdPath)).toBe(true);
  });

  it("returns SSE stream with FILE_START, token chunks, and FILE_DONE on success", async () => {
    const statusPath = path.join(tempDir, "transcription-status.json");
    const status = {
      [path.join(tempDir, "slide_001.jpg")]: {
        processingStatus: "completed",
        reviewStatus: "needs-improvement",
        currentVersion: 1,
      },
    };
    fs.writeFileSync(statusPath, JSON.stringify(status, null, 2));

    const response = await invokeReprocessSse(tempDir, "slide_001.jpg");

    expect(response._getStatusCode()).toBe(200);
    expect(response._getHeaders()["content-type"]).toContain("text/event-stream");

    const data = response._getData();
    expect(data).toContain("[FILE_START] slide_001.jpg");
    expect(data).toContain("token chunk 1");
    expect(data).toContain("token chunk 2");
    expect(data).toContain("[FILE_DONE] slide_001.jpg");

    // Verify status and file were still updated
    const updatedStatus = JSON.parse(fs.readFileSync(statusPath, "utf-8"));
    const entry = updatedStatus[path.join(tempDir, "slide_001.jpg")];
    expect(entry.currentVersion).toBe(2);
    expect(entry.reviewStatus).toBe("not-verified");

    const mdPath = path.join(tempDir, "slide_001_v2.md");
    expect(fs.existsSync(mdPath)).toBe(true);
  });

  it("emits FILE_ERROR event on SSE stream when transcription fails", async () => {
    const statusPath = path.join(tempDir, "transcription-status.json");
    const status = {
      [path.join(tempDir, "slide_001.jpg")]: {
        processingStatus: "completed",
        reviewStatus: "needs-improvement",
        currentVersion: 1,
      },
    };
    fs.writeFileSync(statusPath, JSON.stringify(status, null, 2));

    transcribeImageMock.mockRejectedValue(new Error("LLM connection failed"));

    const response = await invokeReprocessSse(tempDir, "slide_001.jpg");

    expect(response._getStatusCode()).toBe(200);
    const data = response._getData();
    expect(data).toContain("[FILE_START] slide_001.jpg");
    expect(data).toContain("[FILE_ERROR] slide_001.jpg | LLM connection failed");

    // Verify version was NOT incremented
    const updatedStatus = JSON.parse(fs.readFileSync(statusPath, "utf-8"));
    const entry = updatedStatus[path.join(tempDir, "slide_001.jpg")];
    expect(entry.currentVersion).toBe(1);
  });

  it("passes extraInstructions to transcribeImage when provided", async () => {
    const statusPath = path.join(tempDir, "transcription-status.json");
    const status = {
      [path.join(tempDir, "slide_001.jpg")]: {
        processingStatus: "completed",
        reviewStatus: "needs-improvement",
        currentVersion: 1,
      },
    };
    fs.writeFileSync(statusPath, JSON.stringify(status, null, 2));

    const response = await invokeReprocess(tempDir, "slide_001.jpg", undefined, {
      extraInstructions: "Look for the price list in the bottom-left corner",
    });

    expect(response._getStatusCode()).toBe(200);
    expect(transcribeImageMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.anything(),
      expect.any(Function),
      "Look for the price list in the bottom-left corner"
    );
  });

  it("does not pass extraInstructions when not provided", async () => {
    const statusPath = path.join(tempDir, "transcription-status.json");
    const status = {
      [path.join(tempDir, "slide_001.jpg")]: {
        processingStatus: "completed",
        reviewStatus: "needs-improvement",
        currentVersion: 1,
      },
    };
    fs.writeFileSync(statusPath, JSON.stringify(status, null, 2));

    await invokeReprocess(tempDir, "slide_001.jpg");

    expect(transcribeImageMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.anything(),
      expect.any(Function),
      undefined
    );
  });

  it("passes extraInstructions via SSE reprocess", async () => {
    const statusPath = path.join(tempDir, "transcription-status.json");
    const status = {
      [path.join(tempDir, "slide_001.jpg")]: {
        processingStatus: "completed",
        reviewStatus: "needs-improvement",
        currentVersion: 1,
      },
    };
    fs.writeFileSync(statusPath, JSON.stringify(status, null, 2));

    await invokeReprocessSse(tempDir, "slide_001.jpg", undefined, {
      extraInstructions: "Focus on the chart data",
    });

    expect(transcribeImageMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.anything(),
      expect.any(Function),
      "Focus on the chart data"
    );
  });

  it("prepends custom folder instructions to extraInstructions", async () => {
    const statusPath = path.join(tempDir, "transcription-status.json");
    const status = {
      [path.join(tempDir, "slide_001.jpg")]: {
        processingStatus: "completed",
        reviewStatus: "needs-improvement",
        currentVersion: 1,
      },
    };
    fs.writeFileSync(statusPath, JSON.stringify(status, null, 2));
    fs.writeFileSync(path.join(tempDir, "custom_instructions.txt"), "CAFI meetup about bartending");

    await invokeReprocess(tempDir, "slide_001.jpg", undefined, {
      extraInstructions: "Focus on the chart data",
    });

    expect(transcribeImageMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.anything(),
      expect.any(Function),
      "CAFI meetup about bartending\n\nFocus on the chart data"
    );
  });

  it("passes only custom instructions when no extraInstructions provided", async () => {
    const statusPath = path.join(tempDir, "transcription-status.json");
    const status = {
      [path.join(tempDir, "slide_001.jpg")]: {
        processingStatus: "completed",
        reviewStatus: "needs-improvement",
        currentVersion: 1,
      },
    };
    fs.writeFileSync(statusPath, JSON.stringify(status, null, 2));
    fs.writeFileSync(path.join(tempDir, "custom_instructions.txt"), "CAFI meetup about bartending");

    await invokeReprocess(tempDir, "slide_001.jpg");

    expect(transcribeImageMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.anything(),
      expect.any(Function),
      "CAFI meetup about bartending"
    );
  });

  it("still returns JSON when Accept header is not text/event-stream", async () => {
    const statusPath = path.join(tempDir, "transcription-status.json");
    const status = {
      [path.join(tempDir, "slide_001.jpg")]: {
        processingStatus: "completed",
        reviewStatus: "needs-improvement",
        currentVersion: 1,
      },
    };
    fs.writeFileSync(statusPath, JSON.stringify(status, null, 2));

    const response = await invokeReprocess(tempDir, "slide_001.jpg");

    expect(response._getStatusCode()).toBe(200);
    const body = response._getJSONData();
    expect(body.imageName).toBe("slide_001.jpg");
    expect(body.version).toBe(2);
  });
});
