import * as fs from "fs";
import * as path from "path";
import { LMStudioClient, LLM } from "@lmstudio/sdk";
import { z } from "zod";
import { config } from "./config";
import { saveTranscriptionAsMarkdown } from "./storage";

const TranscriptionSchema = z.object({
  description: z.string().describe("A brief description of what the slide/image shows, including visual layout details"),
  textContent: z.string().describe("The exact text content visible on the slide, preserving line breaks and formatting. Include all text, symbols, bullet points, and markers exactly as they appear."),
  keyInformation: z.array(z.string()).describe("Key takeaways or points conveyed by the slide"),
  suggestedFilename: z.string().describe("A short, descriptive filename (without extension) for this image based on its content. Use lowercase with hyphens, e.g. 'cocktail-menu-slide' or 'speaker-introduction'."),
});

export type TranscriptionResult = z.infer<typeof TranscriptionSchema>;

export async function createTranscriptionClient(): Promise<{ client: LMStudioClient; model: LLM }> {
  const client = new LMStudioClient({ baseUrl: config.lmStudioBaseUrl });
  const model = await client.llm.model(config.modelName);
  return { client, model };
}

export async function transcribeImage(
  client: LMStudioClient,
  model: LLM,
  imagePath: string,
  onProgress?: (msg: string) => void,
  extraInstructions?: string
): Promise<TranscriptionResult> {
  const image = await client.files.prepareImage(imagePath);

  let totalTokens = 0;
  const startTime = Date.now();

  const emit = (message: string) => {
    process.stdout.write(message);
    if (onProgress) {
      onProgress(message);
    }
  };

  const emitLine = (message: string) => {
    console.log(message);
    if (onProgress) {
      onProgress(message);
    }
  };

  const messages: Array<{ role: "user"; content: string; images?: unknown[] }> = [
    {
      role: "user",
      content: `You are a precise slide transcription assistant. This is a photograph of a presentation slide from a meetup.

Your task:
1. Transcribe ALL text visible on the slide exactly as it appears — every line, bullet point, symbol, marker, and heading. Do not paraphrase or summarize the text. Preserve the original formatting, line breaks, and any special characters (e.g. (X), (!), arrows, etc.).
2. Provide a brief description of the slide's visual layout and design.
3. Extract the key takeaways or points the slide is conveying.

Important:
- Focus ONLY on the projected slide/screen content.
- Ignore any whiteboard, handwritten notes, or background elements.
- Do NOT skip or abbreviate any text on the slide.`,
      images: [image],
    },
  ];

  if (extraInstructions && extraInstructions.trim().length > 0) {
    messages.push({
      role: "user",
      content: extraInstructions,
    });
  }

  const prediction = model.respond(
    messages as Parameters<typeof model.respond>[0],
    {
      structured: TranscriptionSchema,
      maxTokens: config.maxTokens,
      onPromptProcessingProgress: (progress) => {
        const pct = (progress * 100).toFixed(0);
        emit(`\r  [Prompt processing: ${pct}%]`);
      },
      onFirstToken: () => {
        emit(`\r  [Prompt processing: 100%]\n`);
        emit(`  [Generating tokens: `);
      },
    },
  );

  for await (const { content, tokensCount } of prediction) {
    totalTokens += tokensCount;
    emit(content);
  }
  emit("]\n");

  const result = await prediction.result();
  const elapsed = ((Date.now() - startTime) / 1000).toFixed(2);

  emitLine(`  [Stats: ${totalTokens} tokens, ${elapsed}s`);
  if (result.stats?.tokensPerSecond) {
    emitLine(`   ${result.stats.tokensPerSecond.toFixed(2)} tokens/sec`);
  }
  if (result.stats?.stopReason) {
    emitLine(`   Stop: ${result.stats.stopReason}]`);
  } else {
    emitLine(`]`);
  }

  const transcription = result.parsed;
  const mdPath = saveTranscriptionAsMarkdown(imagePath, transcription);
  emitLine(`  [Saved: ${mdPath}]`);

  return transcription;
}

export function getImageFiles(imageDir: string): string[] {
  const supportedExtensions = [".jpg", ".jpeg", ".png", ".webp"];
  const files = fs.readdirSync(imageDir);
  return files
    .filter((file) => supportedExtensions.includes(path.extname(file).toLowerCase()))
    .map((file) => path.join(imageDir, file));
}
