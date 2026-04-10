import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { createMocks } from "node-mocks-http";
import { createSuggestNameHandler, type TranscriptionDeps } from "../../server/app";

function createTempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "sandcastle-suggest-"));
}

const transcribeImageMock = vi.fn();
const createTranscriptionClientMock = vi.fn();

function createDeps(): TranscriptionDeps {
  return {
    createTranscriptionClient: createTranscriptionClientMock,
    transcribeImage: transcribeImageMock,
    getImageFiles: () => [],
  };
}

async function invokeSuggestName(folder: string, imageName: string) {
  const handler = createSuggestNameHandler(createDeps());
  const { req, res } = createMocks({
    method: "POST",
    url: `/api/suggest-name/${imageName}`,
    params: { imageName },
    headers: { "content-type": "application/json" },
    body: { folder },
  });
  await handler(req, res);
  return res;
}

describe("POST /api/suggest-name/:imageName", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = createTempDir();
    fs.writeFileSync(path.join(tempDir, "IMG_001.jpg"), "image-data");
    createTranscriptionClientMock.mockResolvedValue({ client: {}, model: {} });
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
    transcribeImageMock.mockReset();
    createTranscriptionClientMock.mockReset();
  });

  it("returns a suggested filename from the model", async () => {
    transcribeImageMock.mockResolvedValue({
      description: "desc",
      textContent: "text",
      keyInformation: [],
      suggestedFilename: "cocktail-menu-slide",
    });

    const res = await invokeSuggestName(tempDir, "IMG_001.jpg");

    expect(res._getStatusCode()).toBe(200);
    const body = res._getJSONData();
    expect(body.suggestedFilename).toBe("cocktail-menu-slide");
  });

  it("returns 404 when image does not exist", async () => {
    const res = await invokeSuggestName(tempDir, "nonexistent.jpg");
    expect(res._getStatusCode()).toBe(404);
  });

  it("returns 400 when folder is missing", async () => {
    const res = await invokeSuggestName("", "IMG_001.jpg");
    expect(res._getStatusCode()).toBe(400);
  });

  it("returns 500 when model call fails", async () => {
    createTranscriptionClientMock.mockResolvedValue({ client: {}, model: {} });
    transcribeImageMock.mockRejectedValue(new Error("Model not loaded"));

    const res = await invokeSuggestName(tempDir, "IMG_001.jpg");
    expect(res._getStatusCode()).toBe(500);
  });
});
