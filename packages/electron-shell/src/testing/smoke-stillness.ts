// DK-10b — A STILLNESS WINDOW'S WITNESS (the GPU-on desk smokes' idle rows, and the parked rows' words). A window is the
// desk's counters at its two ends (`perf().frames`, `submits()`), its outside wakes by reason (`rest().wakes` — `world`,
// `input`, `doc`, `presence`, `desk:…`), its registered steps (`timed`), and the OUTSIDE INPUT it received: trusted OS
// pointer, wheel and key events. A smoke sends none inside a window; a person at a shared machine does — DK-10b's recorder
// caught 7 and 31 `input` wakes in two smoke:canvas runs that sent none (the second kept the desk awake past the idle row's
// 45 s), and the window's OS focus moving in two more. The wind restarts on a touch (ICE's ambient: a pointer move is a touch,
// twenty seconds more of it), so one stray move inside the idle row's two seconds is a red row with nothing wrong in the desk.
//
// So a window the desk moved in NAMES what moved it, and one moved while outside input reached the desk is sampled again —
// a bounded number of times. Anything else that moves a resting desk (a kind's wake, a write, a still taken at rest) fails at
// once, with its reason; outside input that never reached the desk (no `input` wake) is no excuse either.

/** One end of a window: the counters, the wakes by reason, the registered steps, the outside input received so far. */
export interface StillnessSample {
  readonly frames: number;
  readonly submits: number;
  readonly wakes: Readonly<Record<string, number>>;
  readonly timed: number;
  readonly outside: number;
}

/**
 * The page's expression: one sample (`null` while `window.__vfDesk` is not installed). Its first call arms the outside-input
 * census — trusted pointer, wheel and key events anywhere in the window, counted in the capture phase — so a window's first
 * end is where its census starts.
 */
export const STILLNESS_SAMPLE = `(() => {
  const g = globalThis;
  const d = g.__vfDesk;
  if (d === undefined) return null;
  if (g.__vfSmokeOutsideInput === undefined) {
    g.__vfSmokeOutsideInput = 0;
    const count = (e) => { if (e.isTrusted) g.__vfSmokeOutsideInput += 1; };
    for (const type of ["pointermove", "pointerdown", "pointerup", "wheel", "keydown", "keyup"]) {
      window.addEventListener(type, count, { capture: true, passive: true });
    }
  }
  const r = d.rest();
  return {
    frames: d.perf().frames,
    submits: d.submits()?.total ?? -1,
    wakes: r.wakes,
    timed: r.timed,
    outside: g.__vfSmokeOutsideInput,
  };
})()`;

/** What moved a window: the wakes that grew in it (by reason), the timed steps it took, the outside input it received. */
export interface Moved {
  readonly wakes: Readonly<Record<string, number>>;
  readonly timed: number;
  readonly outside: number;
}

export function movedBy(a: StillnessSample, b: StillnessSample): Moved {
  const wakes: Record<string, number> = {};
  for (const [reason, n] of Object.entries(b.wakes)) {
    const grew = n - (a.wakes[reason] ?? 0);
    if (grew > 0) wakes[reason] = grew;
  }
  return { wakes, timed: b.timed - a.timed, outside: b.outside - a.outside };
}

/** How many windows an idle row takes before outside input stops being an excuse. */
export const STILLNESS_TRIES = 3;

export type StillVerdict =
  | { readonly kind: "still" }
  /** Outside input reached the desk inside the window: sample again. */
  | { readonly kind: "again"; readonly moved: Moved }
  /** The desk moved by itself — or outside input past the last try: the row is red, and says why. */
  | { readonly kind: "moved"; readonly moved: Moved };

/** Judge one window, the `attempt`-th of at most `tries` (1-based). */
export function judgeWindow(
  a: StillnessSample,
  b: StillnessSample,
  attempt: number,
  tries: number = STILLNESS_TRIES,
): StillVerdict {
  if (a.frames === b.frames && a.submits === b.submits) return { kind: "still" };
  const moved = movedBy(a, b);
  const reachedTheDesk = moved.outside > 0 && (moved.wakes["input"] ?? 0) > 0;
  if (reachedTheDesk && attempt < tries) return { kind: "again", moved };
  return { kind: "moved", moved };
}

/** A sample's counters alone — what the rows print (`rest0`, `parked1`, …). */
export function countersOf(s: StillnessSample): {
  readonly frames: number;
  readonly submits: number;
} {
  return { frames: s.frames, submits: s.submits };
}
