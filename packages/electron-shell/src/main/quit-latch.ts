// Item 290 (plan lanes/rv/plan/item-290-PLAN.md §5–§7; James's D4, 2026-11-10 06:49Z; DESIGN.md §9 "The quit's
// words") — a person's quit's latch. The quit gate's hold sets it (the gate port in `index.ts`) and its release clears
// it. While it is set, a switch to another person and a new user are refused BEFORE they reach any coordinator, in
// James's words, and a pair bundle born now starts held (`FielddHandleCoordinator`'s `heldAtBirth`), so nothing it is
// asked starts a pair. Pure, so its refusal is held by a test without the composition root.

/** James's words (D4): what a switch or a new user asked for while VibeField quits says. The Me menu draws "Couldn't
 * switch to Lee — VibeField is quitting." (`refusalSentence`); Settings → Account draws the words alone. */
export const QUITTING_WORDS = "VibeField is quitting";

/** The refusal a switch carries up to the window's doors, which draw its message whole. Its reason is the log's. */
export class QuitRefusal extends Error {
  constructor() {
    super(QUITTING_WORDS);
    this.name = "QuitRefusal";
  }
}

/** What was refused, for the log only. */
export type QuitRefused = "switch" | "new-user";

export interface QuitLatchOptions {
  /** said once per refusal, for the log (never the person's words) */
  readonly onRefused?: (what: QuitRefused) => void;
}

export interface QuitLatch {
  /** set from the quit gate's hold until its release */
  readonly held: boolean;
  hold(): void;
  release(): void;
  /** while held, throws a `QuitRefusal` and says `what` to the log; otherwise does nothing */
  refuse(what: QuitRefused): void;
}

export function createQuitLatch(_options: QuitLatchOptions = {}): QuitLatch {
  let held = false;
  return {
    get held() {
      return held;
    },
    hold() {
      held = true;
    },
    release() {
      held = false;
    },
    // Item 290's red: a stub that refuses nothing (the green throws a `QuitRefusal` while held, and says `what`)
    refuse(_what) {},
  };
}

/** Item 290 (VF-PM's bound 3, 09:57:55Z) — a switch under the quit's latch: refused before it starts its pair, and
 * refused again once that pair has answered if the quit's hold came while it started, so a switch already starting
 * never swaps the window mid-quit. The pair it started stays up for the quit's second read to stop
 * (`quit-gate.ts`'s stop). `attachUser` in `index.ts` runs through it. Item 290's red 2: a stub that refuses only
 * before the start (the green refuses again before the swap). */
export async function latchedSwitch<S, T>(
  latch: Pick<QuitLatch, "refuse">,
  what: QuitRefused,
  start: () => Promise<S>,
  swap: (started: S) => T,
): Promise<T> {
  latch.refuse(what);
  const started = await start();
  return swap(started);
}
