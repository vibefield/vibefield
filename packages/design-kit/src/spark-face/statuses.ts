// A spark's nineteen statuses and their words (DESIGN.md §2.10's table — spark-face.test.tsx reads
// the table, so the two never drift). Each id is one of the engine's own statuses; Coding and
// Debugging are an agent's work and never a spark's face.

export const SPARK_STATUSES = [
  { id: "hello", word: "Hello" },
  { id: "ready", word: "Ready" },
  { id: "listening", word: "Listening" },
  { id: "thinking", word: "Thinking" },
  { id: "planning", word: "Planning" },
  { id: "searching", word: "Searching" },
  { id: "reviewing", word: "Reading" },
  { id: "running", word: "Running" },
  { id: "focus", word: "Watching" },
  { id: "asking", word: "Asking you" },
  { id: "approval", word: "Needs your OK" },
  { id: "stuck", word: "Stuck" },
  { id: "limited", word: "Rate limited" },
  { id: "success", word: "Done" },
  { id: "shipped", word: "Shipped" },
  { id: "failed", word: "Failed" },
  { id: "thanked", word: "Thanked" },
  { id: "sleeping", word: "Asleep" },
  { id: "offline", word: "Offline" },
] as const;

export type SparkStatus = (typeof SPARK_STATUSES)[number]["id"];

const WORDS: ReadonlyMap<SparkStatus, string> = new Map(
  SPARK_STATUSES.map(({ id, word }) => [id, word]),
);

/** The status's word: beside the face wherever there is room, in its accessible name where not (S-3). */
export function sparkStatusWord(status: SparkStatus): string {
  return WORDS.get(status) ?? status;
}

/** S-4 (CH-D4): the four that need you — the row's word in the attention ink, never the face. */
export const SPARK_NEEDS_YOU: ReadonlySet<SparkStatus> = new Set([
  "asking",
  "approval",
  "stuck",
  "limited",
]);
