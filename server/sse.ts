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
  if (typeof res.flushHeaders === "function") {
    try {
      res.flushHeaders();
    } catch {
      // Ignore flush errors in mock/test responses.
    }
  }

  let closed = false;
  req.on("close", () => {
    closed = true;
  });

  return {
    emit(event: string, data?: Record<string, unknown>) {
      if (closed) return;
      const payload = data ?? {};
      res.write(`event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`);
    },
    close() {
      if (closed) return;
      closed = true;
      res.end();
    },
    get isClosed() {
      return closed;
    },
  };
}
