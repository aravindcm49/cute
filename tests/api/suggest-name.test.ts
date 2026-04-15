import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { createMocks } from "node-mocks-http";
import { createSuggestNameHandler, type AiProviderDeps } from "../../server/app";
import type { AiProvider } from "../../src/ai-provider";

const aiProviderMock = {
  initialize: vi.fn(),
  transcribe: vi.fn(),
  getAvailableModels: vi.fn(),
  getCurrentModel: vi.fn(),
  setModel: vi.fn(),
  dispose: vi.fn(),
} satisfies AiProvider;

function createTempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "sandcastle-suggest-"));
}

function createDeps(): AiProviderDeps {
  return {
    aiProvider: aiProviderMock,
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
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
    aiProviderMock.transcribe.mockReset();
  });

  it("returns a suggested filename from the model", async () => {
    aiProviderMock.transcribe.mockResolvedValue({
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
    aiProviderMock.transcribe.mockRejectedValue(new Error("Model not loaded"));

    const res = await invokeSuggestName(tempDir, "IMG_001.jpg");
    expect(res._getStatusCode()).toBe(500);
  });
});