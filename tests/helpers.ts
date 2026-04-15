import { vi } from "vitest";
import type { AiProvider, TranscriptionResult } from "../src/ai-provider";
import type { AiProviderDeps } from "../server/app";
import { getImageFiles } from "../src/transcription";

export function createMockAiProvider(overrides: Partial<AiProvider> = {}): AiProvider {
  return {
    initialize: overrides.initialize ?? vi.fn().mockResolvedValue(undefined),
    transcribe: overrides.transcribe ?? vi.fn().mockResolvedValue({
      description: "mock description",
      textContent: "mock text content",
      keyInformation: [],
      suggestedFilename: "mock-filename",
    } satisfies TranscriptionResult),
    getAvailableModels: overrides.getAvailableModels ?? vi.fn().mockResolvedValue([]),
    getCurrentModel: overrides.getCurrentModel ?? vi.fn().mockReturnValue(null),
    setModel: overrides.setModel ?? vi.fn().mockResolvedValue(undefined),
    dispose: overrides.dispose ?? vi.fn(),
  };
}

export function createTestDeps(aiProvider?: AiProvider): AiProviderDeps {
  return {
    aiProvider: aiProvider ?? createMockAiProvider(),
    getImageFiles,
  };
}