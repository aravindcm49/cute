import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "url";
import * as path from "path";

const rootDir = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  plugins: [react()],
  test: {
    include: ["tests/**/*.test.ts", "tests/**/*.test.tsx"],
    environment: "jsdom",
    setupFiles: ["./tests/setup.ts"],
    environmentOptions: {
      jsdom: {
        pretendToBeVisual: true,
      },
    },
  },
  resolve: {
    alias: {
      "@web": path.resolve(rootDir, "web/src"),
    },
  },
});