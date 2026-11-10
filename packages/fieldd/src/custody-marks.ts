import { CUSTODY, type CustodyMarksFrame } from "@vibefield/contracts";
import { createNoopLogger, type Logger } from "@vibefield/logging";

// OB custody (C5; contracts custody.ts `CustodyMarksFrame`, mgmt.ts `NativeMarksSet*`, registries.ts `CUSTODY`) —
// fieldd's view of every MARK.
//
// A mark is a named number that only rises: what a survivor remembers of a store, so that a store put back as it was
// earlier is below its mark and is seen to be stale. fieldd's own memory dies with fieldd, so two that outlive it
// keep each mark: the floor (told here, `native.marks.set`, and saying what it holds in every hello ack) and the
// shell (which reads this view from `system.custody.marks.subscribe` and hands the highest it heard to the next
// fieldd it spawns, `CustodyHandoff.expect`).
//
// This holder is the view between them. It starts from what the spawner remembered, is raised by the floor's word at
// each hello and by a store's `note`, and says every rise WHOLE to whoever listens. It never falls: nothing here
// lowers a mark or forgets a name.
//
// At `files` the daemon makes one with no floor behind it, so a store has one code path: a note raises the view and
// answers it, and nothing new is asked of a floor. That view then dies with fieldd, which is what `files` is.
//
// A mark is not a secret (a name and a count), but it is not an agent's to move either: the floor's verb is on the
// management channel alone, and the stream is the local shell's alone (daemon.ts).

const MARK_NAME = new RegExp(CUSTODY.MARK_NAME);

/** A count: what a store may note. */
const isCount = (value: unknown): value is number =>
  typeof value === "number" && Number.isSafeInteger(value) && value >= 0;

/** What `note` refuses a caller for, by a word a log line may print (CUSTODY-SPEC v0.19: a custody log line prints an
 * error's `code`, never its message, and the grants file prints this one as `grants_mark_unanswered`'s reason):
 *  · `mark-name` — the name is off `CUSTODY.MARK_NAME`;
 *  · `mark-count` — the value is no count;
 *  · `marks-full` — one name more than `CUSTODY.MARKS_MAX`. */
export class CustodyMarkRefusal extends Error {
  constructor(
    readonly code: "mark-name" | "mark-count" | "marks-full",
    message: string,
  ) {
    super(message);
    this.name = "CustodyMarkRefusal";
  }
}

/** An error as a custody log line prints it: its code alone. Node's file errors name a whole path in their message,
 * which holds the person's home and rides into a support bundle. The link's own refusal carries its word as `kind`
 * and a number as `code` (native-link.ts `RpcCallError`), so its `kind` is read; an error with neither is `unknown`. */
const codeOf = (error: unknown): string => {
  const said = error as { code?: unknown; kind?: unknown } | null | undefined;
  if (typeof said?.code === "string") return said.code;
  return typeof said?.kind === "string" ? said.kind : "unknown";
};

/** A mark as another side said it (the spawner, the floor): a whole number from 0 up, or undefined when it is not
 * one. The floor's count is a u64 with no ceiling of its own, so one past the safe integers reads as THE TOP and
 * never as nothing: a mark that read as nothing would be a mark that fell (CUSTODY-SPEC §8, "the count never wraps":
 * a store whose next count would pass the top cannot write, which is the safe side). */
export function markOf(value: unknown): number | undefined {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0) return undefined;
  return Math.min(value, Number.MAX_SAFE_INTEGER);
}

/** The floor, as much of it as the marks need. `NativeLink` is one. */
export interface CustodyMarksFloor {
  /** `native.marks.set` — the floor keeps max(old, value) and answers what it keeps. It rejects when the floor
   * cannot be asked or refuses. */
  setMark(name: string, value: number): Promise<number>;
}

export interface CustodyMarksOptions {
  /** the marks the spawner remembered (`CustodyHandoff.expect`); none at `files`, or from a shell that heard none */
  expect?: Readonly<Record<string, number>>;
  /** the floor that keeps the marks past this fieldd; none at `files` */
  floor?: CustodyMarksFloor;
  logger?: Logger;
}

export class CustodyMarks {
  /** a Map, never an object: a mark may be named as something every object has (`constructor` fits the pattern) */
  readonly #view = new Map<string, number>();
  readonly #listeners = new Set<(frame: CustodyMarksFrame) => void>();
  readonly #floor: CustodyMarksFloor | undefined;
  readonly #logger: Logger;

  constructor(opts: CustodyMarksOptions = {}) {
    this.#floor = opts.floor;
    this.#logger = opts.logger ?? createNoopLogger();
    // read on its own terms: the hand-off's contract admits any string for a name
    for (const [name, value] of Object.entries(opts.expect ?? {})) this.#raise(name, value);
  }

  /** fieldd's view of one mark now: 0 when it holds none. */
  get(name: string): number {
    return this.#view.get(name) ?? 0;
  }

  /** Every mark, whole, as the stream says it: a value of its own each time, by name. */
  frame(): CustodyMarksFrame {
    const byName = [...this.#view].sort(([a], [b]) => (a < b ? -1 : 1));
    return { marks: Object.fromEntries(byName) };
  }

  /** A store's word that its mark is now at least `value`. The view is raised at once (before any answer), every
   * listener is told if it rose, and the floor is told; the answer is what the floor keeps, or this view when no
   * floor is behind it or the floor does not answer. A value at or below the mark changes nothing, asks nobody and
   * answers the mark.
   *
   * It rejects only for what its caller got wrong: a name off `CUSTODY.MARK_NAME`, a value that is no count, or one
   * name more than `CUSTODY.MARKS_MAX` (the floor holds no more, and a hand-off carries no more), each a
   * `CustodyMarkRefusal` with its `code`. A floor's silence or refusal is never a rejection. */
  async note(name: string, value: number): Promise<number> {
    if (!MARK_NAME.test(name)) {
      throw new CustodyMarkRefusal("mark-name", "a mark's name is off the pattern");
    }
    if (!isCount(value)) {
      const said = `a mark is a count, and ${name} was noted as something else`;
      throw new CustodyMarkRefusal("mark-count", said);
    }
    const held = this.get(name);
    if (value <= held) return held;
    if (!this.#view.has(name) && this.#view.size >= CUSTODY.MARKS_MAX) {
      const said = `fieldd holds ${CUSTODY.MARKS_MAX} marks already; ${name} is one more`;
      throw new CustodyMarkRefusal("marks-full", said);
    }
    this.#view.set(name, value);
    this.#say();
    return await this.#tell(name, value);
  }

  /** The floor's word at a hello: the marks it holds (`HelloAck.marks`, as `NativeLink.marks` read them). The view
   * is raised to it before this returns its promise, so whoever reads the view next reads the higher of the two;
   * then the floor is told every mark it holds less of (a floor that came up since, or came back empty: it is a
   * survivor again). Never rejects. */
  async heard(held: ReadonlyMap<string, number>): Promise<void> {
    let rose = false;
    for (const [name, value] of held) rose = this.#raise(name, value) || rose;
    if (rose) this.#say();
    if (this.#floor === undefined) return;
    for (const [name, value] of [...this.#view]) {
      const theirs = markOf(held.get(name));
      if (theirs !== undefined && theirs >= value) continue;
      await this.#tell(name, value);
    }
  }

  /** Hear every rise, whole. Answers the way to leave. */
  onChange(listener: (frame: CustodyMarksFrame) => void): () => void {
    this.#listeners.add(listener);
    return () => {
      this.#listeners.delete(listener);
    };
  }

  /** Raise one mark to `value` if that is a rise this view can hold. Answers whether it rose. */
  #raise(name: string, value: unknown): boolean {
    const mark = markOf(value);
    if (!MARK_NAME.test(name) || mark === undefined) return false;
    const held = this.#view.get(name);
    if (mark <= (held ?? 0)) return false;
    if (held === undefined && this.#view.size >= CUSTODY.MARKS_MAX) return false;
    this.#view.set(name, mark);
    return true;
  }

  /** Tell the floor one mark and take what it keeps into the view. Answers the view for that name; never rejects. */
  async #tell(name: string, value: number): Promise<number> {
    const floor = this.#floor;
    if (floor === undefined) return this.get(name);
    try {
      // the floor may keep more than it was told: a mark set by a fieldd before this one
      if (this.#raise(name, await floor.setMark(name, value))) this.#say();
    } catch (error) {
      // the error's code, never the error: what it says may name a path
      this.#logger.debug(
        "fieldd.custody.marks.floor_untold",
        "The floor did not take a mark; fieldd's own view of it stands",
        { name, code: codeOf(error) },
      );
    }
    return this.get(name);
  }

  #say(): void {
    for (const listener of [...this.#listeners]) {
      try {
        listener(this.frame());
      } catch (error) {
        // one listener's failure (a subscriber whose socket is gone) is not the note's, nor the next listener's
        this.#logger.debug(
          "fieldd.custody.marks.listener_failed",
          "A listener of the marks threw; the others were still told",
          { code: codeOf(error) },
        );
      }
    }
  }
}
