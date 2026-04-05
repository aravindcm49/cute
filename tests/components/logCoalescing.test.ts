import { describe, it, expect } from "vitest";
import { coalesceLogEntry } from "../../web/src/components/logCoalescing";

describe("coalesceLogEntry", () => {
  it("appends status messages as new entries", () => {
    const { log } = coalesceLogEntry([], false, "Completed foo.jpg", "status");
    const result = coalesceLogEntry(log, false, "Starting bar.jpg", "status");

    expect(result.log).toEqual(["Completed foo.jpg", "Starting bar.jpg"]);
    expect(result.lastWasChunk).toBe(false);
  });

  it("appends the first chunk as a new entry", () => {
    const state = coalesceLogEntry([], false, "Starting foo.jpg", "status");
    const result = coalesceLogEntry(state.log, state.lastWasChunk, "chunk text 1", "chunk");

    expect(result.log).toEqual(["Starting foo.jpg", "chunk text 1"]);
    expect(result.lastWasChunk).toBe(true);
  });

  it("replaces last entry when consecutive chunks arrive", () => {
    let state = coalesceLogEntry([], false, "Starting foo.jpg", "status");
    state = coalesceLogEntry(state.log, state.lastWasChunk, "chunk text 1", "chunk");
    state = coalesceLogEntry(state.log, state.lastWasChunk, "chunk text 2", "chunk");

    expect(state.log).toEqual(["Starting foo.jpg", "chunk text 2"]);
  });

  it("does not replace a status entry with a chunk", () => {
    let state = coalesceLogEntry([], false, "Starting foo.jpg", "status");
    state = coalesceLogEntry(state.log, state.lastWasChunk, "chunk 1", "chunk");

    expect(state.log).toEqual(["Starting foo.jpg", "chunk 1"]);
  });

  it("resets coalescing after a status message", () => {
    let state = coalesceLogEntry([], false, "Starting foo.jpg", "status");
    state = coalesceLogEntry(state.log, state.lastWasChunk, "chunk 1", "chunk");
    state = coalesceLogEntry(state.log, state.lastWasChunk, "Completed foo.jpg", "status");

    expect(state.log).toEqual(["Starting foo.jpg", "chunk 1", "Completed foo.jpg"]);
    expect(state.lastWasChunk).toBe(false);

    // Next chunk should append fresh, not replace the status
    state = coalesceLogEntry(state.log, state.lastWasChunk, "chunk for bar", "chunk");
    expect(state.log).toEqual([
      "Starting foo.jpg",
      "chunk 1",
      "Completed foo.jpg",
      "chunk for bar",
    ]);
  });

  it("handles empty log with a chunk", () => {
    const result = coalesceLogEntry([], false, "first chunk", "chunk");

    expect(result.log).toEqual(["first chunk"]);
    expect(result.lastWasChunk).toBe(true);
  });

  it("handles empty log with a status", () => {
    const result = coalesceLogEntry([], false, "Starting foo.jpg", "status");

    expect(result.log).toEqual(["Starting foo.jpg"]);
    expect(result.lastWasChunk).toBe(false);
  });

  it("enforces max 200 entries", () => {
    const log = Array.from({ length: 200 }, (_, i) => `entry ${i}`);
    const result = coalesceLogEntry(log, false, "new status", "status");

    expect(result.log.length).toBe(200);
    expect(result.log[result.log.length - 1]).toBe("new status");
    expect(result.log[0]).toBe("entry 1");
  });
});