import { describe, it, expect, vi } from "vitest";
import { createMocks } from "node-mocks-http";
import { createSseStream } from "../server/sse";

function createMockRequestResponse(acceptHeader?: string) {
  return createMocks({
    method: "GET",
    headers: acceptHeader ? { accept: acceptHeader } : {},
  });
}

describe("createSseStream", () => {
  it("returns null when Accept header does not include text/event-stream", () => {
    const { req, res } = createMockRequestResponse("application/json");
    const stream = createSseStream(req, res);
    expect(stream).toBeNull();
  });

  it("returns null when no Accept header is present", () => {
    const { req, res } = createMockRequestResponse(undefined);
    const stream = createSseStream(req, res);
    expect(stream).toBeNull();
  });

  it("returns a stream object when Accept header includes text/event-stream", () => {
    const { req, res } = createMockRequestResponse("text/event-stream");
    const stream = createSseStream(req, res);
    expect(stream).not.toBeNull();
    expect(stream!.emit).toBeTypeOf("function");
    expect(stream!.close).toBeTypeOf("function");
  });

  it("sets correct SSE headers on the response", () => {
    const { req, res } = createMockRequestResponse("text/event-stream");
    createSseStream(req, res);

    expect(res._getHeaders()["content-type"]).toBe("text/event-stream");
    expect(res._getHeaders()["cache-control"]).toBe("no-cache, no-transform");
    expect(res._getHeaders()["connection"]).toBe("keep-alive");
  });

  it("emit writes standard SSE format with named event and JSON data", () => {
    const { req, res } = createMockRequestResponse("text/event-stream");
    const stream = createSseStream(req, res);

    stream!.emit("file_start", { name: "photo.jpg" });

    const data = res._getData();
    expect(data).toContain("event: file_start\n");
    expect(data).toContain(`data: {"name":"photo.jpg"}\n\n`);
  });

  it("emit with no data argument writes empty JSON object", () => {
    const { req, res } = createMockRequestResponse("text/event-stream");
    const stream = createSseStream(req, res);

    stream!.emit("done");

    const data = res._getData();
    expect(data).toContain("event: done\n");
    expect(data).toContain("data: {}\n\n");
  });

  it("emit writes delta event with text payload", () => {
    const { req, res } = createMockRequestResponse("text/event-stream");
    const stream = createSseStream(req, res);

    stream!.emit("delta", { text: "Hello world" });

    const data = res._getData();
    expect(data).toContain("event: delta\n");
    expect(data).toContain(`data: {"text":"Hello world"}\n\n`);
  });

  it("emit writes file_error event with name and error", () => {
    const { req, res } = createMockRequestResponse("text/event-stream");
    const stream = createSseStream(req, res);

    stream!.emit("file_error", { name: "photo.jpg", error: "Connection failed" });

    const data = res._getData();
    expect(data).toContain("event: file_error\n");
    expect(data).toContain(`data: {"name":"photo.jpg","error":"Connection failed"}\n\n`);
  });

  it("multiple emit calls produce multiple SSE events", () => {
    const { req, res } = createMockRequestResponse("text/event-stream");
    const stream = createSseStream(req, res);

    stream!.emit("file_start", { name: "a.jpg" });
    stream!.emit("delta", { text: "chunk1" });
    stream!.emit("delta", { text: "chunk2" });
    stream!.emit("file_done", { name: "a.jpg" });

    const data = res._getData();
    expect(data).toContain("event: file_start\ndata: {\"name\":\"a.jpg\"}\n\n");
    expect(data).toContain("event: delta\ndata: {\"text\":\"chunk1\"}\n\n");
    expect(data).toContain("event: delta\ndata: {\"text\":\"chunk2\"}\n\n");
    expect(data).toContain("event: file_done\ndata: {\"name\":\"a.jpg\"}\n\n");
  });

  it("close ends the response", () => {
    const { req, res } = createMockRequestResponse("text/event-stream");
    const stream = createSseStream(req, res);

    stream!.emit("done");
    stream!.close();

    // After close, the response should be ended
    expect(res._isEndCalled()).toBe(true);
  });

  it("isClosed starts as false", () => {
    const { req, res } = createMockRequestResponse("text/event-stream");
    const stream = createSseStream(req, res);
    expect(stream!.isClosed).toBe(false);
  });

  it("isClosed becomes true after close is called", () => {
    const { req, res } = createMockRequestResponse("text/event-stream");
    const stream = createSseStream(req, res);
    stream!.close();
    expect(stream!.isClosed).toBe(true);
  });

  it("emit does not write after close", () => {
    const { req, res } = createMockRequestResponse("text/event-stream");
    const stream = createSseStream(req, res);

    stream!.emit("delta", { text: "before" });
    stream!.close();
    stream!.emit("delta", { text: "after" });

    const data = res._getData();
    expect(data).toContain("before");
    expect(data).not.toContain("after");
  });

  it("isClosed becomes true when request is aborted", () => {
    const { req, res } = createMockRequestResponse("text/event-stream");
    const stream = createSseStream(req, res);

    expect(stream!.isClosed).toBe(false);

    // Simulate client disconnect via request abort
    req.emit("aborted");

    expect(stream!.isClosed).toBe(true);
  });

  it("emit does not write after request is aborted", () => {
    const { req, res } = createMockRequestResponse("text/event-stream");
    const stream = createSseStream(req, res);

    stream!.emit("delta", { text: "before" });
    req.emit("aborted");
    stream!.emit("delta", { text: "after" });

    const data = res._getData();
    expect(data).toContain("before");
    expect(data).not.toContain("after");
  });

  it("request close alone does not close SSE stream", () => {
    const { req, res } = createMockRequestResponse("text/event-stream");
    const stream = createSseStream(req, res);

    req.emit("close");

    expect(stream!.isClosed).toBe(false);
  });
});
