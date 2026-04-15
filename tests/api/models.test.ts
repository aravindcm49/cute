import { describe, it, expect, vi, beforeEach } from "vitest";
import { createMocks } from "node-mocks-http";
import { createApp, type AiProviderDeps } from "../../server/app";
import type { AiProvider } from "../../src/ai-provider";

function createMockProvider(overrides: Partial<AiProvider> = {}): AiProvider {
  return {
    initialize: vi.fn().mockResolvedValue(undefined),
    transcribe: vi.fn().mockResolvedValue({
      description: "desc",
      textContent: "text",
      keyInformation: [],
    }),
    getAvailableModels: overrides.getAvailableModels ?? vi.fn().mockResolvedValue([
      { provider: "anthropic", id: "claude-3-sonnet", name: "Claude 3 Sonnet" },
      { provider: "openai", id: "gpt-4o", name: "GPT-4o" },
    ]),
    getCurrentModel: overrides.getCurrentModel ?? vi.fn().mockReturnValue({
      provider: "anthropic",
      id: "claude-3-sonnet",
      name: "Claude 3 Sonnet",
    }),
    setModel: overrides.setModel ?? vi.fn().mockResolvedValue(undefined),
    dispose: vi.fn(),
  };
}

describe("GET /api/models", () => {
  it("returns available models and current model", async () => {
    const aiProvider = createMockProvider();
    const app = createApp({ aiProvider, getImageFiles: vi.fn() });

    const { req, res } = createMocks({ method: "GET", url: "/api/models" });
    await app(req, res);

    expect(res._getStatusCode()).toBe(200);
    const body = res._getJSONData();
    expect(body.models).toHaveLength(2);
    expect(body.models[0]).toEqual({
      provider: "anthropic",
      id: "claude-3-sonnet",
      name: "Claude 3 Sonnet",
    });
    expect(body.current).toEqual({
      provider: "anthropic",
      id: "claude-3-sonnet",
      name: "Claude 3 Sonnet",
    });
  });

  it("returns null current model when no model is selected", async () => {
    const aiProvider = createMockProvider({
      getCurrentModel: vi.fn().mockReturnValue(null),
    });
    const app = createApp({ aiProvider, getImageFiles: vi.fn() });

    const { req, res } = createMocks({ method: "GET", url: "/api/models" });
    await app(req, res);

    expect(res._getStatusCode()).toBe(200);
    const body = res._getJSONData();
    expect(body.current).toBeNull();
    expect(body.models).toHaveLength(2);
  });

  it("returns 500 when getAvailableModels fails", async () => {
    const aiProvider = createMockProvider({
      getAvailableModels: vi.fn().mockRejectedValue(new Error("Provider unavailable")),
    });
    const app = createApp({ aiProvider, getImageFiles: vi.fn() });

    const { req, res } = createMocks({ method: "GET", url: "/api/models" });
    await app(req, res);

    expect(res._getStatusCode()).toBe(500);
  });
});

describe("POST /api/model", () => {
  it("switches the active model and returns updated current", async () => {
    const aiProvider = createMockProvider();
    const app = createApp({ aiProvider, getImageFiles: vi.fn() });

    const { req, res } = createMocks({
      method: "POST",
      url: "/api/model",
      body: { provider: "openai", modelId: "gpt-4o" },
    });
    await app(req, res);

    expect(res._getStatusCode()).toBe(200);
    const body = res._getJSONData();
    expect(body.current).toEqual({
      provider: "anthropic",
      id: "claude-3-sonnet",
      name: "Claude 3 Sonnet",
    });
    expect(aiProvider.setModel).toHaveBeenCalledWith("openai", "gpt-4o");
  });

  it("returns 400 when provider is missing", async () => {
    const aiProvider = createMockProvider();
    const app = createApp({ aiProvider, getImageFiles: vi.fn() });

    const { req, res } = createMocks({
      method: "POST",
      url: "/api/model",
      body: { modelId: "gpt-4o" },
    });
    await app(req, res);

    expect(res._getStatusCode()).toBe(400);
    const body = res._getJSONData();
    expect(body.error).toContain("required");
  });

  it("returns 400 when modelId is missing", async () => {
    const aiProvider = createMockProvider();
    const app = createApp({ aiProvider, getImageFiles: vi.fn() });

    const { req, res } = createMocks({
      method: "POST",
      url: "/api/model",
      body: { provider: "openai" },
    });
    await app(req, res);

    expect(res._getStatusCode()).toBe(400);
  });

  it("returns 400 for unknown provider/model combination", async () => {
    const aiProvider = createMockProvider({
      setModel: vi.fn().mockRejectedValue(new Error("Model not found: unknown/nonexistent")),
    });
    const app = createApp({ aiProvider, getImageFiles: vi.fn() });

    const { req, res } = createMocks({
      method: "POST",
      url: "/api/model",
      body: { provider: "unknown", modelId: "nonexistent" },
    });
    await app(req, res);

    expect(res._getStatusCode()).toBe(400);
  });
});