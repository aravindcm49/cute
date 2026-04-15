import { createApp } from "./app";
import { createAiProvider } from "../src/ai-provider";
import { getImageFiles } from "../src/transcription";

const port = Number(process.env.PORT ?? 3000);

async function start() {
  const aiProvider = createAiProvider();
  await aiProvider.initialize();

  const modelInfo = aiProvider.getCurrentModel();
  console.log(`AI Provider initialized with model: ${modelInfo?.provider}/${modelInfo?.id}`);

  const app = createApp({
    aiProvider,
    getImageFiles,
  });

  app.listen(port, () => {
    console.log(`Express listening on http://localhost:${port}`);
  });
}

start().catch((error) => {
  console.error("Failed to start server:", error);
  process.exit(1);
});