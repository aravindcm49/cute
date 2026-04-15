# Slide Transcriber

A web-based tool for batch-transcribing presentation slides using AI vision models. Upload a folder of slide images, transcribe them with structured output, review and edit transcriptions, and export tracking data as CSV.

## Features

- **Batch transcription** — process entire folders of slide images
- **Structured output** — each transcription includes description, text content, key information, and a suggested filename
- **Verification workflow** — review, edit, and verify transcriptions one by one
- **SSE streaming** — real-time progress during transcription and re-processing
- **Model selection** — switch between available AI models at runtime
- **Custom instructions** — per-folder instructions for fine-tuning transcription output
- **CLI batch processor** — headless mode for processing without the web UI
- **Versioned transcriptions** — re-process images with incrementing versions
- **CSV export** — download tracking spreadsheet with processing and review status

## Quick Start

### 1. Install dependencies

```bash
npm install
```

### 2. Configure an AI provider

Set an API key environment variable (choose one):

```bash
export ANTHROPIC_API_KEY=sk-ant-...
# or
export OPENAI_API_KEY=sk-...
# or
export GOOGLE_API_KEY=...
```

For local models or custom providers, see [Provider Configuration](#provider-configuration) below.

### 3. Start the server

```bash
npm run dev
```

This starts both the Express API server and the Vite dev server for the web frontend.

### 4. Open the app

Navigate to `http://localhost:3000` and enter the path to a folder containing slide images (JPG, JPEG, PNG, or WebP).

### CLI mode

For headless batch processing without the web UI:

```bash
npx tsx src/index.ts            # process pending images
npx tsx src/index.ts --all       # re-process all images
npx tsx src/index.ts --errors-only  # retry only errored images
```

Configure the image directory and other settings in `src/config.ts`.

## Provider Configuration

Slide Transcriber uses the [pi-ai SDK](https://www.npmjs.com/package/@mariozechner/pi-coding-agent) to connect to AI providers. Authentication can be configured via environment variables or a `models.json` file.

### Environment variables

The simplest way is to set an API key for a built-in provider:

| Variable | Provider |
|----------|----------|
| `ANTHROPIC_API_KEY` | Anthropic (Claude) |
| `OPENAI_API_KEY` | OpenAI (GPT) |
| `GOOGLE_API_KEY` | Google (Gemini) |
| `MISTRAL_API_KEY` | Mistral |
| `XAI_API_KEY` | xAI (Grok) |

```bash
export ANTHROPIC_API_KEY=sk-ant-...
npm run dev
```

### models.json (custom providers & local models)

For local models or providers not covered by built-in environment variables, create `~/.pi/agent/models.json`:

```json
{
  "providers": {
    "my-provider": {
      "baseUrl": "http://localhost:11434/v1",
      "api": "openai-completions",
      "apiKey": "my-key",
      "models": [
        { "id": "model-name" }
      ]
    }
  }
}
```

The `api` field supports:

| API | Description |
|-----|-------------|
| `openai-completions` | OpenAI Chat Completions (most compatible) |
| `openai-responses` | OpenAI Responses API |
| `anthropic-messages` | Anthropic Messages API |
| `google-generative-ai` | Google Generative AI |

The server may need `apiKey` in the config even if the local server ignores it (e.g., Ollama uses `"apiKey": "ollama"`).

### Migrating from LM Studio

If you were previously using LM Studio with `@lmstudio/sdk`, configure it as an OpenAI-compatible provider:

```json
{
  "providers": {
    "lm-studio": {
      "baseUrl": "http://127.0.0.1:1234/v1",
      "api": "openai-completions",
      "apiKey": "lm-studio",
      "models": [
        { "id": "my-loaded-model" }
      ]
    }
  }
}
```

Replace `"my-loaded-model"` with the model identifier loaded in LM Studio. The server auto-detects models from LM Studio's `/v1/models` endpoint, so you can also inspect available models there.

> **Note:** LM Studio must be running with a model loaded for transcription to work. Vision-capable models (e.g., LLaVA, Qwen-VL) are required for image transcription.

### auth.json

For OAuth-based providers (ChatGPT Plus, Claude Pro, etc.), authenticate via:

```bash
pi /login
```

This stores credentials in `~/.pi/agent/auth.json`.

## Project Structure

```
src/
  ai-provider.ts    # AI provider abstraction (pi-ai SDK)
  config.ts          # Configuration (imageDir, statusFile, outputDir, maxTokens)
  index.ts           # CLI batch processor
  storage.ts          # Status file I/O and versioned transcriptions
  transcription.ts    # Image file discovery
server/
  app.ts             # Express routes and handlers
  index.ts           # Server entry point
  sse.ts             # SSE streaming module
web/
  src/               # React frontend components
tests/               # Test suite
```

## Development

```bash
npm run dev           # Start both server and web dev servers
npm run typecheck     # Type-check both server and web
npm run test           # Run full test suite
```

## Configuration

Edit `src/config.ts` to set defaults for the CLI processor:

```typescript
export const config = {
  imageDir: "/path/to/your/images",
  statusFile: "transcription-status.json",
  outputDir: "transcriptions",
  maxTokens: 1000,
};
```

In the web UI, the folder path is specified per-request and `imageDir` is only used by the CLI.