import type { SparkId } from "@vibefield/contracts";
import type { SparkEntry } from "./spark-status";

// A THREAD'S MARK (SP-1d; DESIGN.md §8 "Chat's list", Needs you, as amended 2026-10-31). Pure: what a window has seen
// happen in each thread while that thread was not on screen. A need there keeps its orange dot until the thread is
// opened, even after the need ends; the spark's own turn ending there marks the thread unread, the same dot in
// `--vf-cyan`. A thread is on screen while Chat is the view and it is the one shown, and opening it reads it. The
// window's feed holds the one ledger (`sparks-feed.ts`) for the window's life, written nowhere (HN-D9's rule); the
// row's dot and Chat's cell draw what it says.

/** A thread's dot: a need's (`--vf-orange`), or unread (`--vf-cyan`). A need outranks unread. */
export type ThreadMark = "needs" | "unread";

/** A dot that outlasts the row's status word, in the words its accessible name says after that word (DESIGN.md §9
 * "Chat's words"): a need that has ended, or unread. */
export const THREAD_MARK_WORDS: Readonly<Record<ThreadMark, string>> = {
  needs: "needed you",
  unread: "unread",
};

/** What a row's dot says that its status word does not: unread, or a need that has ended; null for no dot, or for a
 * need standing now, which the word says itself (Asking you). */
export function lastingMarkOf(entry: SparkEntry, mark: ThreadMark | null): string | null {
  if (mark === null || (mark === "needs" && entry.needsYou)) return null;
  return THREAD_MARK_WORDS[mark];
}

/** What a window has latched since each thread was last on screen. */
export interface ThreadLatches {
  /** the threads that needed you while not on screen */
  readonly needs: ReadonlySet<SparkId>;
  /** the threads whose spark's own turn ended while not on screen */
  readonly unread: ReadonlySet<SparkId>;
}

/** A reading with no window behind it: nothing latched, so a thread's only mark is a need standing now. */
export const NO_LATCHES: ThreadLatches = { needs: new Set(), unread: new Set() };

/** A thread's mark: a need standing now or latched since it was last on screen, else unread, else none. */
export function threadMarkOf(entry: SparkEntry, latches: ThreadLatches): ThreadMark | null {
  const spark = entry.spark.id;
  if (entry.needsYou || latches.needs.has(spark)) return "needs";
  return latches.unread.has(spark) ? "unread" : null;
}

/** Every thread's mark on one reading, by its spark; a thread with none is absent. */
export function threadMarksOf(
  entries: readonly SparkEntry[],
  latches: ThreadLatches,
): ReadonlyMap<SparkId, ThreadMark> {
  const marks = new Map<SparkId, ThreadMark>();
  for (const entry of entries) {
    const mark = threadMarkOf(entry, latches);
    if (mark !== null) marks.set(entry.spark.id, mark);
  }
  return marks;
}

/** Chat's cell: the orange dot while any needs-you dot stands, else the cyan one while a thread is unread. */
export function cellMarkOf(marks: ReadonlyMap<SparkId, ThreadMark>): ThreadMark | null {
  let mark: ThreadMark | null = null;
  for (const each of marks.values()) {
    if (each === "needs") return "needs";
    mark = each;
  }
  return mark;
}

/** The spark's own turn is under way: its own run alive and at work on the board. */
function turnRuns(entry: SparkEntry): boolean {
  return entry.run?.alive === true && entry.run.status === "working";
}

/** The window's ledger: each reading of the feed latches what happened off screen, and showing a thread reads it. */
export class ThreadLedger implements ThreadLatches {
  readonly #needs = new Set<SparkId>();
  readonly #unread = new Set<SparkId>();
  /** each spark's own turn under way on the last reading; none before the first, so a turn the window never saw end
   * is no news (a need it finds is: its dot stands, as any need's does) */
  #turns: ReadonlyMap<SparkId, boolean> = new Map();
  #onScreen: SparkId | null = null;

  get needs(): ReadonlySet<SparkId> {
    return this.#needs;
  }

  get unread(): ReadonlySet<SparkId> {
    return this.#unread;
  }

  /** One reading of the feed: a need, or a turn's end, in a thread not on screen is latched there. A spark the list
   * no longer holds takes its marks with it. */
  read(entries: readonly SparkEntry[]): void {
    const before = this.#turns;
    const turns = new Map(entries.map((entry) => [entry.spark.id, turnRuns(entry)]));
    this.#turns = turns;
    for (const latched of [this.#needs, this.#unread]) {
      for (const spark of latched) if (!turns.has(spark)) latched.delete(spark);
    }
    for (const entry of entries) {
      const spark = entry.spark.id;
      if (spark === this.#onScreen) continue;
      if (entry.needsYou) this.#needs.add(spark);
      if (before.get(spark) === true && !turnRuns(entry)) this.#unread.add(spark);
    }
  }

  /** The thread on screen now (null: none), on the feed's last reading. Opening it reads it; a thread that leaves the
   * screen while it needs you keeps the need's dot. */
  show(spark: SparkId | null, entries: readonly SparkEntry[]): void {
    this.#onScreen = spark;
    for (const entry of entries) {
      if (entry.needsYou && entry.spark.id !== spark) this.#needs.add(entry.spark.id);
    }
    if (spark === null) return;
    this.#needs.delete(spark);
    this.#unread.delete(spark);
  }
}
