import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { createMocks } from "node-mocks-http";
import { createTranscribeHandler, type AiProviderDeps } from "../../server/app";
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
  return fs.mkdtempSync(path.join(os.tmpdir(), "sandcastle-transcribe-"));
}

async function invokeTranscribe(folder: string, acceptHeader?: string) {
  const supportedExtensions = new Set([".jpg", ".jpeg", ".png", ".webp"]);
  const deps: AiProviderDeps = {
    aiProvider: aiProviderMock,
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
    aiProviderMock.transcribe.mockImplementation(async (_imagePath: string, _options?: { extraInstructions?: string }, onDelta?: (text: string) => void) => {
      onDelta?.("mock progress");
      return { description: "desc", textContent: "text", keyInformation: [] };
    });
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
    aiProviderMock.transcribe.mockReset();
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

    expect(aiProviderMock.transcribe).toHaveBeenCalledTimes(1);
    expect(aiProviderMock.transcribe.mock.calls[0][0]).toBe(path.join(tempDir, "two.png"));

    const updated = JSON.parse(fs.readFileSync(statusPath, "utf-8"));
    expect(updated[path.join(tempDir, "two.png")].processingStatus).toBe("completed");
    expect(updated[path.join(tempDir, "one.jpg")].processingStatus).toBe("completed");
  });

  it("streams progress using named SSE events with JSON payloads", async () => {
    const response = await invokeTranscribe(tempDir, "text/event-stream");

    expect(response._getStatusCode()).toBe(200);
    expect(response._getHeaders()["content-type"]).toContain("text/event-stream");

    const data = response._getData();

    // Should contain named SSE events
    expect(data).toContain("event: file_start");
    expect(data).toContain("event: delta");
    expect(data).toContain("event: file_done");
    expect(data).toContain("event: done");

    // Should contain JSON payloads
    expect(data).toContain(`data: {"name":"one.jpg"}`);
    expect(data).toContain(`data: {"name":"two.png"}`);
    expect(data).toContain(`data: {"text":"mock progress"}`);
    expect(data).toContain("data: {}");
  });

  it("passes custom instructions from folder to transcribe", async () => {
    fs.writeFileSync(path.join(tempDir, "custom_instructions.txt"), "These are CAFI slides");

    // Remove one image so only one call
    fs.unlinkSync(path.join(tempDir, "two.png"));

    const response = await invokeTranscribe(tempDir);

    expect(response._getStatusCode()).toBe(200);
    expect(aiProviderMock.transcribe).toHaveBeenCalledTimes(1);
    // Second argument is options object with extraInstructions
    expect(aiProviderMock.transcribe.mock.calls[0][1]).toEqual({ extraInstructions: "These are CAFI slides" });
  });

  it("does not pass extraInstructions when no custom_instructions.txt exists", async () => {
    fs.unlinkSync(path.join(tempDir, "two.png"));

    const response = await invokeTranscribe(tempDir);

    expect(response._getStatusCode()).toBe(200);
    expect(aiProviderMock.transcribe).toHaveBeenCalledTimes(1);
    expect(aiProviderMock.transcribe.mock.calls[0][1]).toBeUndefined();
  });
});
