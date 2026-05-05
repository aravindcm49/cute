import * as fs from "fs";
import * as path from "path";
import {
  AuthStorage,
  createAgentSession,
  ModelRegistry,
  SessionManager,
} from "@mariozechner/pi-coding-agent";
import type { ImageContent, Model } from "@mariozechner/pi-ai";
import { z } from "zod";

const TranscriptionSchema = z.object({
  description: z.string().describe("A brief description of what the slide/image shows, including visual layout details"),
  textContent: z.string().describe("The exact text content visible on the slide, preserving line breaks and formatting. Include all text, symbols, bullet points, and markers exactly as they appear."),
  keyInformation: z.array(z.string()).describe("Key takeaways or points conveyed by the slide"),
  suggestedFilename: z.string().describe("A short, descriptive filename (without extension) for this image based on its content. Use lowercase with hyphens, e.g. 'cocktail-menu-slide' or 'speaker-introduction'."),
});

export type TranscriptionResult = z.infer<typeof TranscriptionSchema>;

export interface AiProvider {
  initialize(): Promise<void>;
  transcribe(
    imagePath: string,
    options?: { extraInstructions?: string },
    onDelta?: (text: string) => void
  ): Promise<TranscriptionResult>;
  getAvailableModels(): Promise<Array<{ provider: string; id: string; name: string }>>;
  getCurrentModel(): { provider: string; id: string; name: string } | null;
  setModel(provider: string, modelId: string): Promise<void>;
  dispose(): void;
}

const SYSTEM_PROMPT = `You are a precise slide transcription assistant. This is a photograph of a presentation slide from a meetup.

Your task:
1. Transcribe ALL text visible on the slide exactly as it appears — every line, bullet point, symbol, marker, and heading. Do not paraphrase or summarize the text. Preserve the original formatting, line breaks, and any special characters (e.g. (X), (!), arrows, etc.).
2. Provide a brief description of the slide's visual layout and design.
3. Extract the key takeaways or points the slide is conveying.

Important:
- Focus ONLY on the projected slide/screen content.
- Ignore any whiteboard, handwritten notes, or background elements.
- Do NOT skip or abbreviate any text on the slide.

Respond in JSON format with these fields:
- description: brief visual description
- textContent: exact text content from the slide
- keyInformation: array of key points
- suggestedFilename: short descriptive filename (lowercase with hyphens)`;

function imageToBase64(imagePath: string): { data: string; mimeType: string } {
  const ext = path.extname(imagePath).toLowerCase();
  const mimeTypes: Record<string, string> = {
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".png": "image/png",
    ".webp": "image/webp",
  };
  const mimeType = mimeTypes[ext] ?? "application/octet-stream";
  const buffer = fs.readFileSync(imagePath);
  return { data: buffer.toString("base64"), mimeType };
}

export function createAiProvider(options?: {
  authDir?: string;
  modelsJsonPath?: string;
}): AiProvider {
  let session: Awaited<ReturnType<typeof createAgentSession>>["session"] | null = null;
  let currentModelFull: Model<any> | null = null;
  let currentModelInfo: { provider: string; id: string; name: string } | null = null;
  let authStorage: AuthStorage | null = null;
  let modelRegistry: ModelRegistry | null = null;

  return {
    async initialize() {
      authStorage = AuthStorage.create(options?.authDir);
      modelRegistry = ModelRegistry.create(authStorage, options?.modelsJsonPath);

      const available = await modelRegistry.getAvailable();
      if (available.length === 0) {
        throw new Error(
          "No AI models available. Configure a provider via environment variables (e.g. ANTHROPIC_API_KEY) or ~/.pi/agent/models.json"
        );
      }

      currentModelFull = available[0];
      currentModelInfo = {
        provider: currentModelFull.provider,
        id: currentModelFull.id,
        name: currentModelFull.name,
      };

      const result = await createAgentSession({
        sessionManager: SessionManager.inMemory(),
        authStorage,
        modelRegistry,
        model: currentModelFull,
      });

      session = result.session;
    },

    async transcribe(
      imagePath: string,
      options?: { extraInstructions?: string },
      onDelta?: (text: string) => void
    ): Promise<TranscriptionResult> {
      if (!session) {
        throw new Error("AiProvider not initialized. Call initialize() first.");
      }

      const { data, mimeType } = imageToBase64(imagePath);
      const imageContent: ImageContent = {
        type: "image",
        data,
        mimeType,
      };

      let promptText = SYSTEM_PROMPT;
      if (options?.extraInstructions && options.extraInstructions.trim()) {
        promptText += `\n\nAdditional instructions:\n${options.extraInstructions}`;
      }

      let responseText = "";
      let deltaCount = 0;
      let lastDeltaAt = Date.now();

      const unsubscribe = session.subscribe((event) => {
        // Log ALL event types to diagnose hang
        const subType = event.type === "message_update" ? event.assistantMessageEvent.type : "";
        console.log(`[ai-provider] session event: type=${event.type} subType=${subType}`);

        if (event.type === "message_update" && event.assistantMessageEvent.type === "text_delta") {
          const delta = event.assistantMessageEvent.delta;
          deltaCount++;
          lastDeltaAt = Date.now();
          if (deltaCount <= 3 || deltaCount % 50 === 0) {
            console.log(`[ai-provider] delta #${deltaCount}: ${delta.length} chars, total so far: ${responseText.length}`);
          }
          responseText += delta;
          onDelta?.(delta);
        }
      });

      try {
        console.log(`[ai-provider] calling session.prompt for ${imagePath}...`);
        console.log(`[ai-provider] awaiting session.prompt — will log if/when it resolves`);

        // Watchdog: if deltas stopped arriving but prompt hasn't resolved, log it
        const watchdog = setInterval(() => {
          const sinceLast = Date.now() - lastDeltaAt;
          console.log(`[ai-provider] WATCHDOG: prompt still awaiting for ${imagePath}. deltas: ${deltaCount}, lastDeltaAgo: ${sinceLast}ms, responseLen: ${responseText.length}`);
        }, 10_000);

        await session.prompt(promptText, { images: [imageContent] });
        clearInterval(watchdog);
        console.log(`[ai-provider] session.prompt RESOLVED for ${imagePath}. deltas: ${deltaCount}, total response: ${responseText.length} chars, lastDeltaAgo: ${Date.now() - lastDeltaAt}ms`);
      } finally {
        unsubscribe();
        console.log(`[ai-provider] unsubscribed from session events for ${imagePath}`);
      }

      // Parse the response — best effort JSON extraction
      let parsed: TranscriptionResult;
      try {
        // Try to parse the response as JSON (model may have added markdown fences)
        let jsonText = responseText.trim();
        const fenceMatch = jsonText.match(/```(?:json)?\s*\n?([\s\S]*?)\n?\s*```/);
        if (fenceMatch) {
          jsonText = fenceMatch[1].trim();
        }
        parsed = TranscriptionSchema.parse(JSON.parse(jsonText));
      } catch {
        // If parsing fails, save the raw text as the transcription
        parsed = {
          description: "Raw transcription (JSON parsing failed)",
          textContent: responseText,
          keyInformation: [],
          suggestedFilename: path.basename(imagePath, path.extname(imagePath)).toLowerCase().replace(/[^a-z0-9]+/g, "-"),
        };
      }

      return parsed;
    },

    async getAvailableModels() {
      if (!modelRegistry) {
        throw new Error("AiProvider not initialized.");
      }
      const available = await modelRegistry.getAvailable();
      return available.map((m: { provider: string; id: string; name: string }) => ({
        provider: m.provider,
        id: m.id,
        name: m.name,
      }));
    },

    getCurrentModel() {
      return currentModelInfo;
    },

    async setModel(provider: string, modelId: string) {
      if (!modelRegistry) {
        throw new Error("AiProvider not initialized.");
      }
      const model = modelRegistry.find(provider, modelId);
      if (!model) {
        throw new Error(`Model not found: ${provider}/${modelId}`);
      }
      currentModelFull = model;
      currentModelInfo = {
        provider: model.provider,
        id: model.id,
        name: model.name,
      };
      if (session) {
        await session.setModel(model);
      }
    },

    dispose() {
      if (session) {
        session.dispose();
        session = null;
      }
    },
  };
}