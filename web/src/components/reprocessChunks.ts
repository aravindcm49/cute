const MAX_LINES = 4;

export type ReprocessDisplayState = {
  lines: string[];
};

export const INITIAL_DISPLAY_STATE: ReprocessDisplayState = { lines: [] };

export function updateReprocessDisplay(
  state: ReprocessDisplayState,
  chunk: string
): ReprocessDisplayState {
  // Content chunk — append with rolling window
  const lines = [...state.lines, chunk].slice(-MAX_LINES);
  return { lines };
}