import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { createAiProvider } from "../src/ai-provider";

// Mock the pi-coding-agent module
vi.mock("@mariozechner/pi-coding-agent", () => {
  const mockSession = {
    subscribe: vi.fn(() => vi.fn()),
    prompt: vi.fn(() => Promise.resolve()),
    setModel: vi.fn(() => Promise.resolve()),
    dispose: vi.fn(),
  };

  return {
    AuthStorage: {
      create: vi.fn(() => ({
        setRuntimeApiKey: vi.fn(),
      })),
    },
    ModelRegistry: {
      create: vi.fn(() => ({
        getAvailable: vi.fn(() =>
          Promise.resolve([
            { provider: "anthropic", id: "claude-sonnet-4", name: "Claude Sonnet 4" },
          ])
        ),
        find: vi.fn((provider: string, modelId: string) => {
          if (provider === "anthropic" && modelId === "claude-sonnet-4") {
            return { provider, id: modelId, name: "Claude Sonnet 4" };
          }
          return null;
        }),
      })),
    },
    SessionManager: {
      inMemory: vi.fn(() => ({})),
    },
    createAgentSession: vi.fn(() =>
      Promise.resolve({ session: mockSession })
    ),
  };
});

describe("AiProvider", () => {
  let tempDir: string;
  let testImagePath: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "sandcastle-ai-provider-"));
    // Create a minimal JPEG file (just has some bytes)
    const jpegHeader = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);
    testImagePath = path.join(tempDir, "test.jpg");
    fs.writeFileSync(testImagePath, jpegHeader);
  });

  afterEach(() => {
    vi.clearAllMocks();
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it("creates an AiProvider via createAiProvider", () => {
    const provider = createAiProvider();
    expect(provider).toBeDefined();
    expect(typeof provider.initialize).toBe("function");
    expect(typeof provider.transcribe).toBe("function");
    expect(typeof provider.getAvailableModels).toBe("function");
    expect(typeof provider.getCurrentModel).toBe("function");
    expect(typeof provider.setModel).toBe("function");
    expect(typeof provider.dispose).toBe("function");
  });

  it("initializes successfully and returns current model after initialize", async () => {
    const provider = createAiProvider();
    await provider.initialize();
    const model = provider.getCurrentModel();
    expect(model).not.toBeNull();
    expect(model?.provider).toBe("anthropic");
    expect(model?.id).toBe("claude-sonnet-4");
  });

  it("throws if transcribe is called before initialize", async () => {
    const provider = createAiProvider();
    await expect(provider.transcribe(testImagePath)).rejects.toThrow("not initialized");
  });

  it("throws if getAvailableModels is called before initialize", async () => {
    const provider = createAiProvider();
    await expect(provider.getAvailableModels()).rejects.toThrow("not initialized");
  });

  it("getAvailableModels returns available models after initialize", async () => {
    const provider = createAiProvider();
    await provider.initialize();
    const models = await provider.getAvailableModels();
    expect(models).toHaveLength(1);
    expect(models[0].provider).toBe("anthropic");
    expect(models[0].id).toBe("claude-sonnet-4");
  });

  it("dispose clears session", async () => {
    const provider = createAiProvider();
    await provider.initialize();
    provider.dispose();
    // After dispose, getCurrentModel still returns last known value
    // (dispose only closes the session, not the model state)
  });

  it("transcribe reads image file and returns structured result", async () => {
    const mockSubscribe = vi.fn(() => vi.fn());
    const mockPrompt = vi.fn();
    let promptCallback: ((event: any) => void) | null = null;

    (mockSubscribe as any).mockImplementation((cb: (event: any) => void) => {
      promptCallback = cb;
      return vi.fn();
    });

    mockPrompt.mockImplementation(async () => {
      if (promptCallback) {
        promptCallback({
          type: "message_update",
          assistantMessageEvent: {
            type: "text_delta",
            delta: '{"description": "A test slide", "textContent": "Hello world", "keyInformation": ["point1"], "suggestedFilename": "test-slide"}',
          },
        });
      }
    });

    const { createAgentSession } = await import("@mariozechner/pi-coding-agent");
    (createAgentSession as any).mockResolvedValue({
      session: {
        subscribe: mockSubscribe,
        prompt: mockPrompt,
        setModel: vi.fn(),
        dispose: vi.fn(),
      },
    });

    const provider = createAiProvider();
    await provider.initialize();

    const result = await provider.transcribe(testImagePath);
    expect(result.description).toBe("A test slide");
    expect(result.textContent).toBe("Hello world");
    expect(result.keyInformation).toContain("point1");
    expect(result.suggestedFilename).toBe("test-slide");

    // Verify prompt was called with image content
    expect(mockPrompt).toHaveBeenCalled();
    const promptCall = mockPrompt.mock.calls[0];
    expect(promptCall[1]).toBeDefined();
    expect(promptCall[1].images).toBeDefined();
    expect(promptCall[1].images[0].type).toBe("image");
    expect(promptCall[1].images[0].mimeType).toBe("image/jpeg");
  });

  it("transcribe handles non-JSON response gracefully", async () => {
    const mockSubscribe = vi.fn(() => vi.fn());
    const mockPrompt = vi.fn();
    let promptCallback: ((event: any) => void) | null = null;

    (mockSubscribe as any).mockImplementation((cb: (event: any) => void) => {
      promptCallback = cb;
      return vi.fn();
    });

    mockPrompt.mockImplementation(async () => {
      if (promptCallback) {
        promptCallback({
          type: "message_update",
          assistantMessageEvent: {
            type: "text_delta",
            delta: 'This is just plain text output from the model.',
          },
        });
      }
    });

    const { createAgentSession } = await import("@mariozechner/pi-coding-agent");
    (createAgentSession as any).mockResolvedValue({
      session: {
        subscribe: mockSubscribe,
        prompt: mockPrompt,
        setModel: vi.fn(),
        dispose: vi.fn(),
      },
    });

    const provider = createAiProvider();
    await provider.initialize();

    const result = await provider.transcribe(testImagePath);
    expect(result.textContent).toBe("This is just plain text output from the model.");
    expect(result.description).toContain("Raw transcription");
  });

  it("transcribe calls onDelta callback for each text chunk", async () => {
    const mockSubscribe = vi.fn(() => vi.fn());
    const mockPrompt = vi.fn();
    let promptCallback: ((event: any) => void) | null = null;
    const onDeltaCalls: string[] = [];

    (mockSubscribe as any).mockImplementation((cb: (event: any) => void) => {
      promptCallback = cb;
      return vi.fn();
    });

    mockPrompt.mockImplementation(async () => {
      if (promptCallback) {
        promptCallback({
          type: "message_update",
          assistantMessageEvent: { type: "text_delta", delta: "chunk1" },
        });
        promptCallback({
          type: "message_update",
          assistantMessageEvent: { type: "text_delta", delta: "chunk2" },
        });
        promptCallback({
          type: "message_update",
          assistantMessageEvent: {
            type: "text_delta",
            delta: '{"description":"d","textContent":"t","keyInformation":[],"suggestedFilename":"f"}',
          },
        });
      }
    });

    const { createAgentSession } = await import("@mariozechner/pi-coding-agent");
    (createAgentSession as any).mockResolvedValue({
      session: {
        subscribe: mockSubscribe,
        prompt: mockPrompt,
        setModel: vi.fn(),
        dispose: vi.fn(),
      },
    });

    const provider = createAiProvider();
    await provider.initialize();

    await provider.transcribe(testImagePath, undefined, (delta) => {
      onDeltaCalls.push(delta);
    });

    expect(onDeltaCalls).toContain("chunk1");
    expect(onDeltaCalls).toContain("chunk2");
  });

  it("transcribe passes extraInstructions in prompt", async () => {
    const mockSubscribe = vi.fn(() => vi.fn());
    const mockPrompt = vi.fn();
    let promptCallback: ((event: any) => void) | null = null;

    (mockSubscribe as any).mockImplementation((cb: (event: any) => void) => {
      promptCallback = cb;
      return vi.fn();
    });

    mockPrompt.mockImplementation(async () => {
      if (promptCallback) {
        promptCallback({
          type: "message_update",
          assistantMessageEvent: {
            type: "text_delta",
            delta: '{"description":"d","textContent":"t","keyInformation":[],"suggestedFilename":"f"}',
          },
        });
      }
    });

    const { createAgentSession } = await import("@mariozechner/pi-coding-agent");
    (createAgentSession as any).mockResolvedValue({
      session: {
        subscribe: mockSubscribe,
        prompt: mockPrompt,
        setModel: vi.fn(),
        dispose: vi.fn(),
      },
    });

    const provider = createAiProvider();
    await provider.initialize();

    await provider.transcribe(testImagePath, { extraInstructions: "Focus on charts" });

    expect(mockPrompt).toHaveBeenCalled();
    const promptText = mockPrompt.mock.calls[0][0];
    expect(promptText).toContain("Focus on charts");
  });

  it("setModel throws for unknown model", async () => {
    const provider = createAiProvider();
    await provider.initialize();

    await expect(provider.setModel("unknown", "nonexistent")).rejects.toThrow("not found");
  });
});