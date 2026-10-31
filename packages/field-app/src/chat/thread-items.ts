import type { AgentFieldRow, SparkSummary } from "@vibefield/contracts";
import type { SparkStatus } from "@vibefield/design-kit/spark-face";
import type { SparkEntry } from "./spark-status";

// THE THREAD'S ITEMS (SP-1d; DESIGN.md §8 "Chat's thread", the thread's items; VF-PM's Q2, 2026-10-31): what stands in
// a thread over its pane. THE SEAM every slice that draws in a thread extends: NS-D4's hello and its starters, CP-3's
// needs-you card (CP3-D8), SP-1e's live cards (CH-D2). One rule holds them all (`ThreadItemsView`): they stand in the
// thread's foot, over the pane's bottom rows, and never move or resize the pane, so a live agent's screen never
// reflows under them. Pure: Chat's reading of a spark in, what stands in its thread out.

/** One starter: a job the hello offers, pressed to be sent as Send sends. */
export interface Starter {
  readonly glyph: "agents" | "panes" | "duplicate";
  readonly words: string;
}

/** NS-D4's three starters, one per job, in the Sparks page's words as ruled (`sparks/src/kit.js`, VF-PM 2026-10-31),
 * with straight apostrophes. Words the spark reads, never an agent's id. */
export const STARTERS: readonly Starter[] = Object.freeze([
  { glyph: "agents", words: "Spawn 4 Grok agents to research a topic each" },
  { glyph: "panes", words: "Keep track of my agents in vibe-field" },
  { glyph: "duplicate", words: "Have Codex review claude·2's work until it's clean" },
]);

/** NS-D4's hello: what a new spark does, as its first words, in its voice. VibeField's words: never sent to the session,
 * never in its transcript. */
export function helloWords(name: string): string {
  return `Hi, I'm ${name}. I can start agents for you, keep track of the ones you run, and carry work between them. What first?`;
}

/** The hello and its starters, on one card, the spark's face its lead (§2.10, a message's lead). */
export interface HelloItem {
  readonly kind: "hello";
  readonly face: { readonly seed: number; readonly status: SparkStatus };
  readonly words: string;
  readonly starters: readonly Starter[];
}

/** One thing that stands in a thread over its pane. Each kind joins this union with the slice that draws it, and with
 * its case in `ThreadItemsView`, which does not compile until the new kind is drawn: CP-3 adds its needs-you card,
 * SP-1e its live cards. */
export type ThreadItem = HelloItem;

/** A hatch writes the spark's record and starts its first run in the same call, so that run is born within this of the
 * record. A wake's run, resumed or started afresh, is born when the spark is woken, after it has slept. */
export const HATCH_RUN_MS = 60_000;

/** The run is the one the spark hatched in: born within `HATCH_RUN_MS` after the spark's record. */
function bornInItsHatch(run: AgentFieldRow, spark: SparkSummary): boolean {
  const after = Date.parse(run.createdAt) - Date.parse(spark.createdAt);
  return after >= 0 && after <= HATCH_RUN_MS;
}

/** NS-D4's "a new spark" (DESIGN.md §8 "Chat's thread", how "new" is read): its session has had no turn yet, read
 * cautiously, because the board counts a run's tokens only as they are spent live — a run that reads its transcript
 * back (a woken spark's, or one fieldd re-attached) counts nothing from it. A spark that never started is new. One
 * whose own run the board shows is new only while that run is the one it hatched in, fieldd is watching it (not
 * waiting to resume it), and the window has never seen the spark have a turn (`turnSeen`). One whose run the board
 * does not show is not said to be new: nothing there certifies it. */
export function sparkIsNew(entry: SparkEntry): boolean {
  const { spark, run } = entry;
  if (run === null) return spark.session === undefined;
  if (entry.turnSeen || run.pending !== undefined) return false;
  return bornInItsHatch(run, spark);
}

/** Quiet (DESIGN.md §8 "Chat's thread"): the spark is new, its draft is empty, and its hello has not left — `helloLeft`
 * once the pane took the keyboard or a send was pasted into it from this window, for the window's life. */
export function threadQuiet(entry: SparkEntry, draftBlank: boolean, helloLeft: boolean): boolean {
  return draftBlank && !helloLeft && sparkIsNew(entry);
}

/** What stands in the shown thread over its pane, in order: at SP-1d, the hello and its starters while it is quiet. */
export function threadItemsOf(entry: SparkEntry, quiet: boolean): readonly ThreadItem[] {
  if (!quiet) return [];
  const { spark, status } = entry;
  return [
    {
      kind: "hello",
      face: { seed: spark.face.seed, status },
      words: helloWords(spark.name),
      starters: STARTERS,
    },
  ];
}
