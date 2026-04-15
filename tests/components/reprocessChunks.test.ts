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

  it("preserves state immutably — does not mutate input", () => {
    const state: ReprocessDisplayState = { lines: ["hello"] };
    const result = updateReprocessDisplay(state, "world");

    expect(state.lines).toEqual(["hello"]);
    expect(result.lines).toEqual(["hello", "world"]);
  });

  it("initial state is empty", () => {
    expect(INITIAL_DISPLAY_STATE.lines).toEqual([]);
  });

  it("handles content that happens to contain special characters", () => {
    const result = updateReprocessDisplay(INITIAL_DISPLAY_STATE, "text with | pipes | and such");
    expect(result.lines).toEqual(["text with | pipes | and such"]);
  });

  it("appends each delta text as a separate line", () => {
    let state = updateReprocessDisplay(INITIAL_DISPLAY_STATE, "The ");
    state = updateReprocessDisplay(state, "quick ");
    state = updateReprocessDisplay(state, "brown ");
    state = updateReprocessDisplay(state, "fox");

    expect(state.lines).toEqual(["The ", "quick ", "brown ", "fox"]);
  });

  it("rolling window drops oldest entries", () => {
    let state = INITIAL_DISPLAY_STATE;
    for (let i = 0; i < 10; i++) {
      state = updateReprocessDisplay(state, `delta-${i}`);
    }
    // Only last 4 kept
    expect(state.lines).toEqual(["delta-6", "delta-7", "delta-8", "delta-9"]);
  });
});
