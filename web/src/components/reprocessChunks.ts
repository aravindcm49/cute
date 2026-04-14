const PROGRESS_PATTERN = /^\s*\[Prompt processing:\s*(\d+)%\]\s*$/;
const MAX_LINES = 4;

export type ReprocessDisplayState = {
  lines: string[];
};

export const INITIAL_DISPLAY_STATE: ReprocessDisplayState = { lines: [] };

export function updateReprocessDisplay(
  state: ReprocessDisplayState,
  chunk: string
): ReprocessDisplayState {
  const trimmed = chunk.trim();

  if (PROGRESS_PATTERN.test(trimmed)) {
    // Progress line — find and replace any existing progress line
    const progressIndex = state.lines.findIndex((line) =>
      PROGRESS_PATTERN.test(line.trim())
    );

    if (progressIndex !== -1) {
      const lines = [...state.lines];
      lines[progressIndex] = trimmed;
      return { lines };
    }

    // No existing progress line — append with rolling window
    const lines = [...state.lines, trimmed].slice(-MAX_LINES);
    return { lines };
  }

  // Regular content chunk — append with rolling window
  const lines = [...state.lines, chunk].slice(-MAX_LINES);
  return { lines };
}