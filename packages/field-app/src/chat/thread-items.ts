import type { SparkStatus } from "@vibefield/design-kit/spark-face";
import type { NeedsCard } from "./needs-card";
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
 * its case in `ThreadItemsView`, which does not compile until the new kind is drawn: CP-3's needs-you card
 * (`needs-card.ts`), and SP-1e's live cards to come. */
export type ThreadItem = HelloItem | NeedsCard;

/** NS-D4's "a new spark" (DESIGN.md §8 "Chat's thread", how "new" is read; TU-1, Q1): it never started, or fieldd
 * says it has never worked: its record (`turnedAt: null`) and its own run's row, which says a first turn before the
 * list is read again. Never while fieldd waits to resume its run (AR-4's pending), nor while it is awake and the board
 * does not show its run: nothing says fieldd watches that pane. Asleep, its run off the board, its record decides. A
 * spark whose record says neither (one from before fieldd kept the fact) is new only if it never started: nothing
 * else certifies it. An ask alone is no turn (Q2), so a spark whose own agent asks before it has worked is still new. */
export function sparkIsNew({ spark, run }: SparkEntry): boolean {
  if (spark.session === undefined) return true;
  if (run === null) return spark.session.live === false && spark.turnedAt === null;
  if (run.pending !== undefined) return false;
  return spark.turnedAt === null && typeof run.turnedAt !== "string";
}

/** Quiet (DESIGN.md §8 "Chat's thread"): the spark is new, its draft is empty, its hello has not left — `helloLeft`
 * once the pane took the keyboard or a send was pasted into it from this window, for the window's life — and, since
 * CP-3, nothing in the queue waits on you in its thread. */
export function threadQuiet(entry: SparkEntry, draftBlank: boolean, helloLeft: boolean): boolean {
  return draftBlank && !helloLeft && entry.items.length === 0 && sparkIsNew(entry);
}

/** What stands in the shown thread over its pane, one item at a time: the needs-you card while one stands (CP-3; its
 * way out included, so the hello never stands beside it), else the hello and its starters while the thread is quiet. */
export function threadItemsOf(
  entry: SparkEntry,
  quiet: boolean,
  card: NeedsCard | null,
): readonly ThreadItem[] {
  if (card !== null) return [card];
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
