// Item 290 (plan lanes/rv/plan/item-290-PLAN.md §5–§7; James's D4, 2026-11-10 06:49Z; DESIGN.md §9 "The quit's
// words") — a person's quit's latch. The quit gate's hold sets it (the gate port in `index.ts`) and its release clears
// it. While it is set, a switch to another person and a new user are refused BEFORE they reach any coordinator, in
// James's words, and a pair bundle born now starts held (`FielddHandleCoordinator`'s `heldAtBirth`), so nothing it is
// asked starts a pair. Pure, so its refusal is held by a test without the composition root.

/** James's words (D4): the latch's refusal of a switch or a new user while VibeField quits, kept for the log. Since
 * item 315 no door draws them: the window ignores a press while the quit's hold stands (its desktop state's
 * `quitting`, `onHeld` below), and a refusal from here reaches a door only in the race the preload's bridge row holds
 * (`preload-users.test.ts`). */
export const QUITTING_WORDS = "VibeField is quitting";

/** The refusal a switch carries up to the window's doors, which draw its message whole. Main replies with its
 * `toString()`, and the preload strips a class's name only when it ends in `Error` (`preload/index.ts`,
 * `REMOTE_ERROR_PREFIX`), so this name keeps James's words alone on screen (item 314). Its reason is the log's. */
export class QuitRefusalError extends Error {
  constructor() {
    super(QUITTING_WORDS);
    this.name = "QuitRefusalError";
  }
}

/** What was refused, for the log only. */
export type QuitRefused = "switch" | "new-user";

export interface QuitLatchOptions {
  /** said once per refusal, for the log (never the person's words) */
  readonly onRefused?: (what: QuitRefused) => void;
  /** Item 315 — the hold set (true) and its release (false), for the window's desktop state (`quitting`). */
  readonly onHeld?: (held: boolean) => void;
}

export interface QuitLatch {
  /** set from the quit gate's hold until its release */
  readonly held: boolean;
  hold(): void;
  release(): void;
  /** while held, throws a `QuitRefusalError` and says `what` to the log; otherwise does nothing */
  refuse(what: QuitRefused): void;
}

export function createQuitLatch(options: QuitLatchOptions = {}): QuitLatch {
  let held = false;
  return {
    get held() {
      return held;
    },
    hold() {
      held = true;
      options.onHeld?.(true);
    },
    release() {
      held = false;
      options.onHeld?.(false);
    },
    refuse(what) {
      if (!held) return;
      options.onRefused?.(what);
      throw new QuitRefusalError();
    },
  };
}

/** Item 290 (VF-PM's bound 3, 09:57:55Z) — a switch under the quit's latch: refused before it starts its pair, and
 * refused again once that pair has answered if the quit's hold came while it started, so a switch already starting
 * never swaps the window mid-quit. The pair it started stays up for the quit's second read to stop
 * (`quit-gate.ts`'s stop). `attachUser` in `index.ts` runs through it. The second refusal and the swap run in the same
 * turn, so no hold can land between them. */
export async function latchedSwitch<S, T>(
  latch: Pick<QuitLatch, "refuse">,
  what: QuitRefused,
  start: () => Promise<S>,
  swap: (started: S) => T,
): Promise<T> {
  latch.refuse(what);
  const started = await start();
  latch.refuse(what);
  return swap(started);
}
