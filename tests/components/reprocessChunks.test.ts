import { describe, it, expect } from "vitest";
import {
  updateReprocessDisplay,
  INITIAL_DISPLAY_STATE,
  type ReprocessDisplayState,
} from "../../web/src/components/reprocessChunks";

describe("updateReprocessDisplay", () => {
  it("appends a content chunk to an empty state", () => {
    const result = updateReprocessDisplay(INITIAL_DISPLAY_STATE, "Hello");
    expect(result.lines).toEqual(["Hello"]);
  });

  it("appends multiple content chunks", () => {
    let state = updateReprocessDisplay(INITIAL_DISPLAY_STATE, "Hello");
    state = updateReprocessDisplay(state, " world");
    state = updateReprocessDisplay(state, "!");
    expect(state.lines).toEqual(["Hello", " world", "!"]);
  });

  it("enforces a rolling window of 4 lines", () => {
    let state = INITIAL_DISPLAY_STATE;
    for (let i = 1; i <= 6; i++) {
      state = updateReprocessDisplay(state, `chunk ${i}`);
    }
    expect(state.lines).toEqual(["chunk 3", "chunk 4", "chunk 5", "chunk 6"]);
  });

  it("collapses progress lines — second progress replaces first", () => {
    let state = updateReprocessDisplay(INITIAL_DISPLAY_STATE, "Some content");
    state = updateReprocessDisplay(state, "[Prompt processing: 25%]");
    state = updateReprocessDisplay(state, "[Prompt processing: 50%]");

    // The 50% should replace the 25%, not append
    expect(state.lines).toEqual(["Some content", "[Prompt processing: 50%]"]);
  });

  it("collapses progress even with different percentages", () => {
    let state = updateReprocessDisplay(INITIAL_DISPLAY_STATE, "[Prompt processing: 10%]");
    state = updateReprocessDisplay(state, "[Prompt processing: 75%]");
    state = updateReprocessDisplay(state, "[Prompt processing: 99%]");

    expect(state.lines).toEqual(["[Prompt processing: 99%]"]);
  });

  it("appends progress line when no previous progress exists", () => {
    const state = updateReprocessDisplay(INITIAL_DISPLAY_STATE, "[Prompt processing: 30%]");
    expect(state.lines).toEqual(["[Prompt processing: 30%]"]);
  });

  it("handles progress line with leading/trailing whitespace", () => {
    let state = updateReprocessDisplay(INITIAL_DISPLAY_STATE, "  [Prompt processing: 50%]  ");
    expect(state.lines).toEqual(["[Prompt processing: 50%]"]);
  });

  it("handles mixed content and progress chunks", () => {
    let state = updateReprocessDisplay(INITIAL_DISPLAY_STATE, "Starting...");
    state = updateReprocessDisplay(state, "[Prompt processing: 25%]");
    state = updateReprocessDisplay(state, "Some text");
    state = updateReprocessDisplay(state, "[Prompt processing: 50%]");
    state = updateReprocessDisplay(state, "More text");

    // Progress lines collapse: 25% → 50%
    // Content lines append normally
    expect(state.lines).toEqual([
      "Starting...",
      "[Prompt processing: 50%]",
      "Some text",
      "More text",
    ]);
  });

  it("progress replacement respects rolling window after content pushes it out", () => {
    // Fill up with content to push the progress line out
    let state = updateReprocessDisplay(INITIAL_DISPLAY_STATE, "[Prompt processing: 10%]");
    state = updateReprocessDisplay(state, "chunk 1");
    state = updateReprocessDisplay(state, "chunk 2");
    state = updateReprocessDisplay(state, "chunk 3");
    state = updateReprocessDisplay(state, "chunk 4");
    // Now state has: ["chunk 1", "chunk 2", "chunk 3", "chunk 4"]
    // The progress line was pushed out by the rolling window
    expect(state.lines).toEqual(["chunk 1", "chunk 2", "chunk 3", "chunk 4"]);

    // New progress line should be appended (no existing progress to replace)
    state = updateReprocessDisplay(state, "[Prompt processing: 75%]");
    expect(state.lines).toEqual(["chunk 2", "chunk 3", "chunk 4", "[Prompt processing: 75%]"]);
  });

  it("does not treat regular text as progress", () => {
    const state = updateReprocessDisplay(INITIAL_DISPLAY_STATE, "Prompt processing was slow");
    expect(state.lines).toEqual(["Prompt processing was slow"]);
  });

  it("preserves state immutably — does not mutate input", () => {
    const state: ReprocessDisplayState = { lines: ["hello"] };
    const result = updateReprocessDisplay(state, "world");

    expect(state.lines).toEqual(["hello"]);
    expect(result.lines).toEqual(["hello", "world"]);
  });

  it("initial state is empty", () => {
    expect(INITIAL_DISPLAY_STATE.lines).toEqual([]);
  });

  it("adds a new progress line after content pushes old one out of the window", () => {
    let state = updateReprocessDisplay(INITIAL_DISPLAY_STATE, "[Prompt processing: 10%]");
    state = updateReprocessDisplay(state, "text A");
    state = updateReprocessDisplay(state, "text B");
    state = updateReprocessDisplay(state, "text C");
    state = updateReprocessDisplay(state, "text D");
    // Rolling window: ["text A", "text B", "text C", "text D"]
    expect(state.lines).toEqual(["text A", "text B", "text C", "text D"]);

    state = updateReprocessDisplay(state, "[Prompt processing: 90%]");
    expect(state.lines).toEqual(["text B", "text C", "text D", "[Prompt processing: 90%]"]);

    // New progress replaces existing progress
    state = updateReprocessDisplay(state, "[Prompt processing: 100%]");
    expect(state.lines).toEqual(["text B", "text C", "text D", "[Prompt processing: 100%]"]);
  });

  it("handles zero percentage", () => {
    let state = updateReprocessDisplay(INITIAL_DISPLAY_STATE, "[Prompt processing: 0%]");
    expect(state.lines).toEqual(["[Prompt processing: 0%]"]);

    state = updateReprocessDisplay(state, "[Prompt processing: 100%]");
    expect(state.lines).toEqual(["[Prompt processing: 100%]"]);
  });
});