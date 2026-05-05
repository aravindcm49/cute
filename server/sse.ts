import type { Request, Response } from "express";

export interface SseStream {
  emit(event: string, data?: Record<string, unknown>): void;
  close(): void;
  readonly isClosed: boolean;
}

export function createSseStream(req: Request, res: Response): SseStream | null {
  const accepts =
    typeof req.headers.accept === "string" && req.headers.accept.includes("text/event-stream");

  if (!accepts) {
    return null;
  }

  res.status(200);
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  if (typeof res.flushHeaders === "function") {
    try {
      res.flushHeaders();
    } catch {
      // Ignore flush errors in mock/test responses.
    }
  }

  // Disable Nagle's algorithm so each small SSE write is sent immediately
  // instead of being buffered by the kernel TCP stack.
  try {
    res.socket?.setNoDelay(true);
  } catch {
    // Socket may not be available in test environments.
  }

  let closed = false;

  // IMPORTANT: do NOT treat req "close" as client disconnect for SSE.
  // For POST handlers, the request side can close as soon as the body is fully
  // read, while the response stream is still active. That would prematurely
  // stop SSE emission after the first event.
  req.on("aborted", () => {
    closed = true;
    console.log(`[SSE] req aborted event fired`);
  });

  // The response "close" event is the reliable signal that the client is gone
  // (or the response stream was terminated).
  res.on("close", () => {
    closed = true;
    console.log(`[SSE] res close event fired`);
  });

  return {
    emit(event: string, data?: Record<string, unknown>) {
      if (closed) return;
      const payload = data ?? {};
      try {
        const msg = `event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`;
        res.write(msg);
        const hasFlush = typeof (res as any).flush === "function";
        console.log(`[SSE emit] event=${event} closed=${closed} writeLen=${msg.length} hasFlush=${hasFlush}`);
        if (hasFlush) {
          (res as any).flush();
          console.log(`[SSE emit] flushed`);
        }
      } catch (err) {
        console.error(`[SSE emit] write failed, marking closed`, err);
        closed = true;
      }
    },
    close() {
      if (closed) return;
      closed = true;
      console.log(`[SSE close] closing stream`);
      try {
        res.end();
      } catch {
        // Already closed — nothing to do.
      }
    },
    get isClosed() {
      return closed;
    },
  };
}
