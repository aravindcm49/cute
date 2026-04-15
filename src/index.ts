import * as fs from "fs";
import * as path from "path";
import { config } from "./config";
import {
  loadStatusFile,
  updateFileStatus,
  type StatusFile,
} from "./storage";
import { getImageFiles } from "./transcription";
import { createAiProvider } from "./ai-provider";

type RunMode = "pending" | "errors-only" | "all";

function parseArgs(): { mode: RunMode } {
  const args = process.argv.slice(2);
  if (args.includes("--all")) {
    return { mode: "all" };
  }
  if (args.includes("--errors-only")) {
    return { mode: "errors-only" };
  }
  return { mode: "pending" };
}

async function main() {
  const { mode } = parseArgs();

  let isInterrupted = false;
  process.on("SIGINT", () => {
    console.log("\n  [Interrupted - will finish current image then exit]");
    isInterrupted = true;
  });

  if (!fs.existsSync(config.imageDir)) {
    console.error(`Directory not found: ${config.imageDir}`);
    process.exit(1);
  }

  const imageFiles = getImageFiles(config.imageDir);

  if (imageFiles.length === 0) {
    console.log("No image files found in the directory.");
    process.exit(0);
  }

  const status = loadStatusFile();
  let filesToProcess: string[];

  if (mode === "all") {
    filesToProcess = imageFiles;
    console.log(`Mode: ALL - processing ${filesToProcess.length} image(s) from scratch.\n`);
  } else if (mode === "errors-only") {
    filesToProcess = imageFiles.filter((f: string) => status[f]?.processingStatus === "error");
    console.log(`Mode: ERRORS-ONLY - processing ${filesToProcess.length} errored image(s).\n`);
  } else {
    filesToProcess = imageFiles.filter((f: string) => {
      const s = status[f];
      return !s || s.processingStatus !== "completed";
    });
    console.log(`Mode: PENDING - processing ${filesToProcess.length} pending image(s).\n`);
  }

  if (filesToProcess.length === 0) {
    console.log("No images to process. Exiting.");
    process.exit(0);
  }

  const aiProvider = createAiProvider();
  await aiProvider.initialize();

  const modelInfo = aiProvider.getCurrentModel();
  console.log(`Using model: ${modelInfo?.provider}/${modelInfo?.id}\n`);

  let completed = 0;
  let errors = 0;
  let skipped = 0;

  for (let i = 0; i < filesToProcess.length; i++) {
    const imagePath = filesToProcess[i];
    const imageName = path.basename(imagePath);

    if (isInterrupted) {
      console.log(`\nInterrupted. Stopping. Processed ${completed}/${filesToProcess.length} files.`);
      break;
    }

    if (mode === "pending" && status[imagePath]?.processingStatus === "completed") {
      console.log(`[${i + 1}/${filesToProcess.length}] [SKIP] ${imageName} (already completed)`);
      skipped++;
      continue;
    }

    console.log(`\n[${i + 1}/${filesToProcess.length}] ${imageName}`);

    try {
      const result = await aiProvider.transcribe(imagePath, undefined, (delta) => {
        process.stdout.write(delta);
      });
      updateFileStatus(status, imagePath, "completed");
      completed++;
      console.log(`\n  [Done: ${imageName}]`);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      updateFileStatus(status, imagePath, "error", errorMessage);
      console.error(`  [ERROR] ${errorMessage}`);
      errors++;
    }
  }

  aiProvider.dispose();

  const total = imageFiles.length;
  console.log(`\n--- Done ---`);
  console.log(`Completed: ${completed}, Errors: ${errors}, Skipped: ${skipped}, Total: ${total}`);
  console.log(`Status file: ${config.statusFile}`);
  console.log(`Transcriptions: ${config.outputDir}/`);
}

main().catch(console.error);