import { defineConfig, type ProxyOptions } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "url";
import * as path from "path";

const rootDir = path.dirname(fileURLToPath(import.meta.url));

const serverPort = process.env.PORT ?? 3000;

const apiProxy: ProxyOptions = {
  target: `http://localhost:${serverPort}`,
  // SSE requires responses to be streamed without buffering.
  // http-proxy's default pipe() buffers small writes, which causes
  // delta / file_done events to never reach the client.
  // Using selfHandleResponse lets us forward SSE chunks immediately.
  selfHandleResponse: true,
  configure: (proxy) => {
    proxy.on("proxyRes", (proxyRes, _req, res) => {
      const isSSE =
        proxyRes.headers["content-type"]?.includes("text/event-stream");

      if (isSSE) {
        // Forward SSE chunks immediately — no buffering.
        // Headers must be written before any data.
        const headers = { ...proxyRes.headers };
        headers["x-accel-buffering"] = "no";
        headers["cache-control"] = "no-cache, no-transform";
        res.writeHead(proxyRes.statusCode ?? 200, headers);
        console.log(`[Vite proxy] SSE response detected, headers forwarded`);

        let closed = false;
        let chunkCount = 0;
        _req.on("close", () => { closed = true; console.log(`[Vite proxy] SSE req closed`); });
        res.on("close", () => { closed = true; console.log(`[Vite proxy] SSE res closed`); });

        proxyRes.on("data", (chunk: Buffer) => {
          chunkCount++;
          const preview = chunk.toString("utf8").replace(/\n/g, "\\n").slice(0, 120);
          console.log(`[Vite proxy] SSE chunk #${chunkCount}: ${chunk.length}b → ${preview}`);
          if (!closed) {
            const ok = res.write(chunk);
            console.log(`[Vite proxy] res.write returned: ${ok}`);
          }
        });
        proxyRes.on("end", () => {
          console.log(`[Vite proxy] SSE upstream ended after ${chunkCount} chunks`);
          if (!closed) res.end();
        });
      } else {
        // Non-SSE responses: buffer and send in one shot.
        const chunks: Buffer[] = [];
        proxyRes.on("data", (chunk: Buffer) => chunks.push(chunk));
        proxyRes.on("end", () => {
          res.writeHead(proxyRes.statusCode ?? 200, proxyRes.headers);
          res.end(Buffer.concat(chunks));
        });
      }
    });
  },
};

export default defineConfig({
  root: rootDir,
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      "/api": apiProxy,
    },
  },
});
