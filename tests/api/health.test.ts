import { describe, it, expect, vi } from "vitest";
import { createMocks } from "node-mocks-http";
import { createHealthHandler, type HealthDeps } from "../../server/app";

function createMockDeps(overrides: Partial<HealthDeps> = {}): HealthDeps {
  return {
    createClient: overrides.createClient ?? vi.fn(),
    listLoaded: overrides.listLoaded ?? vi.fn().mockResolvedValue([]),
    listDownloaded: overrides.listDownloaded ?? vi.fn().mockResolvedValue([]),
    loadModel: overrides.loadModel ?? vi.fn(),
    modelName: overrides.modelName ?? "test-model",
  };
}

async function invokeHealth(deps: HealthDeps) {
  const handler = createHealthHandler(deps);
  const { req, res } = createMocks({ method: "GET", url: "/api/health" });
  await handler(req, res);
  return res;
}

describe("GET /api/health", () => {
  it("returns ready when model is already loaded", async () => {
    const deps = createMockDeps({
      createClient: vi.fn().mockResolvedValue({ llm: {}, system: {} }),
      listLoaded: vi.fn().mockResolvedValue([{ identifier: "test-model" }]),
      modelName: "test-model",
    });

    const res = await invokeHealth(deps);

    expect(res._getStatusCode()).toBe(200);
    const body = res._getJSONData();
    expect(body.status).toBe("ready");
    expect(body.loadedModel).toBe("test-model");
  });

  it("auto-loads model when downloaded but not loaded", async () => {
    const loadModelMock = vi.fn().mockResolvedValue({});
    const deps = createMockDeps({
      createClient: vi.fn().mockResolvedValue({ llm: {}, system: {} }),
      listLoaded: vi.fn().mockResolvedValue([]),
      listDownloaded: vi.fn().mockResolvedValue([{ modelKey: "test-model" }]),
      loadModel: loadModelMock,
      modelName: "test-model",
    });

    const res = await invokeHealth(deps);

    expect(loadModelMock).toHaveBeenCalledWith("test-model", expect.anything());
    const body = res._getJSONData();
    expect(body.status).toBe("ready");
    expect(body.loadedModel).toBe("test-model");
  });

  it("returns no_model when model is not downloaded", async () => {
    const deps = createMockDeps({
      createClient: vi.fn().mockResolvedValue({ llm: {}, system: {} }),
      listLoaded: vi.fn().mockResolvedValue([]),
      listDownloaded: vi.fn().mockResolvedValue([
        { modelKey: "other-model-a" },
        { modelKey: "other-model-b" },
      ]),
      modelName: "test-model",
    });

    const res = await invokeHealth(deps);

    const body = res._getJSONData();
    expect(body.status).toBe("no_model");
    expect(body.loadedModel).toBeNull();
    expect(body.availableModels).toEqual(["other-model-a", "other-model-b"]);
  });

  it("returns no_connection when client creation fails", async () => {
    const deps = createMockDeps({
      createClient: vi.fn().mockRejectedValue(new Error("Connection refused")),
    });

    const res = await invokeHealth(deps);

    expect(res._getStatusCode()).toBe(200);
    const body = res._getJSONData();
    expect(body.status).toBe("no_connection");
    expect(body.loadedModel).toBeNull();
    expect(body.availableModels).toEqual([]);
  });

  it("returns no_connection when listLoaded fails", async () => {
    const deps = createMockDeps({
      createClient: vi.fn().mockResolvedValue({ llm: {}, system: {} }),
      listLoaded: vi.fn().mockRejectedValue(new Error("timeout")),
    });

    const res = await invokeHealth(deps);

    const body = res._getJSONData();
    expect(body.status).toBe("no_connection");
  });

  it("returns no_model when auto-load fails", async () => {
    const deps = createMockDeps({
      createClient: vi.fn().mockResolvedValue({ llm: {}, system: {} }),
      listLoaded: vi.fn().mockResolvedValue([]),
      listDownloaded: vi.fn().mockResolvedValue([{ modelKey: "test-model" }]),
      loadModel: vi.fn().mockRejectedValue(new Error("Load failed")),
      modelName: "test-model",
    });

    const res = await invokeHealth(deps);

    const body = res._getJSONData();
    expect(body.status).toBe("no_model");
    expect(body.loadedModel).toBeNull();
  });
});
