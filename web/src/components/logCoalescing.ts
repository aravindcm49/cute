type EntryType = "status" | "chunk";

type CoalesceResult = {
  log: string[];
  lastWasChunk: boolean;
};

export function coalesceLogEntry(
  log: string[],
  lastWasChunk: boolean,
  message: string,
  type: EntryType
): CoalesceResult {
  let next: string[];

  if (type === "chunk" && lastWasChunk && log.length > 0) {
    next = [...log.slice(0, -1), message];
  } else {
    next = [...log, message];
  }

  if (next.length > 200) {
    next = next.slice(-200);
  }

  return {
    log: next,
    lastWasChunk: type === "chunk",
  };
}