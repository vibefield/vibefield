import type { NeedsCard } from "./needs-card";
import type { SparkEntry } from "./spark-status";

// THE THREAD'S ITEMS (SP-1d; DESIGN.md §8 "Chat's thread", the thread's items; VF-PM's Q2, 2026-10-31): what stands
// in the thread's foot. THE SEAM every slice that draws there extends: CP-3's needs-you card (CP3-D8). Pure: Chat's
// reading of a spark in, what stands in its thread out. TH-1: the items stand in the foot above the composer, covering
// nothing; the hello and its starters are the flow's first row (`transcriptItemsOf`), and the live cards (CH-D2) will
// stand in the flow too. Whether a spark is new, which the hello reads, is read here.
// *Amended 2026-11-05 (TH-1, the pane leaves Chat):* the items stood over the pane's bottom rows and never moved or
// resized it, and the hello was one of them, a card standing while the thread was quiet (`threadQuiet`,
// `threadItemsOf`). They are in git.

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

/** One thing that stands in the thread's foot. Each kind joins this union with the slice that draws it, and with its
 * case in `ThreadItemsView`, which does not compile until the new kind is drawn: CP-3's needs-you card
 * (`needs-card.ts`). */
export type ThreadItem = NeedsCard;

/** NS-D4's "a new spark" (DESIGN.md §8 "Chat's thread", how "new" is read; TU-1, Q1): it never started, or fieldd
 * says it has never worked: its record (`turnedAt: null`) and its own run's row, which says a first turn before the
 * list is read again. Never while fieldd waits to resume its run (AR-4's pending), nor while it is awake and the board
 * does not show its run: nothing says fieldd watches its run. Asleep, its run off the board, its record decides. A
 * spark whose record says neither (one from before fieldd kept the fact) is new only if it never started: nothing
 * else certifies it. An ask alone is no turn (Q2), so a spark whose own agent asks before it has worked is still new. */
export function sparkIsNew({ spark, run }: SparkEntry): boolean {
  if (spark.session === undefined) return true;
  if (run === null) return spark.session.live === false && spark.turnedAt === null;
  if (run.pending !== undefined) return false;
  return spark.turnedAt === null && typeof run.turnedAt !== "string";
}

/** What stands in the shown thread's foot (TH-1; TH-Q26 (a)): the needs-you card while one stands, its way out
 * included, above the composer and covering nothing. The hello is the flow's first row (`transcriptItemsOf`), so a
 * card never takes it away (CO-Q2 (b)). */
export function footItemsOf(card: NeedsCard | null): readonly ThreadItem[] {
  return card === null ? [] : [card];
}
