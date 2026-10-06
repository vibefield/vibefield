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
//
// DK-12 — SAME-POSITION INPUT IS NO EXCUSE SINCE ICE desk.4 (petition I33, filed from DK-10b's recorder): ICE's pointer
// adapter now DROPS a buttonless move that repeats the last one it enqueued — the resting pointer's move Chromium re-sends on
// a focus or visibility change, or that another window's input raises — so such a move wakes nothing and cannot touch the
// wind. The census counts it APART (`resting`), by ICE's own rule for one pointer: no button down, the same point ON THE
// DESK (its container's — `[data-ice-canvas]`), the same element under it and the same modifiers as the last move, no press or
// wheel between (the first move after one always counts). Everything else is `outside` and re-samples a window: a move to a
// new point, a press, a wheel, a key — and a resting pointer whose place on the desk CHANGED under it (the field receded and
// came back, another element came under it): ICE enqueues that one, a new fact, and DK-12's recorder caught it doing so.

/** One end of a window: the counters, the wakes by reason, the registered steps, the outside input received so far. */
export interface StillnessSample {
  readonly frames: number;
  readonly submits: number;
  readonly wakes: Readonly<Record<string, number>>;
  readonly timed: number;
  /** Real outside motion: a move to a new point, a press, a wheel, a key (trusted). */
  readonly outside: number;
  /** DK-12 — a resting pointer's repeated move (trusted, buttonless, the last move's point and modifiers): ICE drops it (I33). */
  readonly resting: number;
}

/**
 * The page's expression: one sample (`null` while `window.__vfDesk` is not installed). Its first call arms the outside-input
 * census — trusted pointer, wheel and key events anywhere in the window, counted in the capture phase, a resting pointer's
 * repeated move counted apart (DK-12, I33) — so a window's first end is where its census starts.
 */
export const STILLNESS_SAMPLE = `(() => {
  const g = globalThis;
  const d = g.__vfDesk;
  if (d === undefined) return null;
  if (g.__vfSmokeOutsideInput === undefined) {
    g.__vfSmokeOutsideInput = 0;
    g.__vfSmokeRestingInput = 0;
    const last = new Map();
    const count = (e) => {
      if (!e.isTrusted) return;
      if (e.type === "pointermove") {
        const desk = document.querySelector("[data-ice-canvas]")?.getBoundingClientRect();
        const x = e.clientX - (desk?.left ?? 0);
        const y = e.clientY - (desk?.top ?? 0);
        const at = [x, y, e.buttons, e.shiftKey, e.ctrlKey, e.altKey, e.metaKey].join(",");
        const was = last.get(e.pointerId);
        last.set(e.pointerId, { at, target: e.target });
        if (e.buttons === 0 && was !== undefined && was.at === at && was.target === e.target) {
          g.__vfSmokeRestingInput += 1;
          return;
        }
      } else if (e.type !== "keydown" && e.type !== "keyup") {
        last.clear();
      }
      g.__vfSmokeOutsideInput += 1;
    };
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
    resting: g.__vfSmokeRestingInput,
  };
})()`;

/** What moved a window: the wakes that grew in it (by reason), the timed steps it took, the outside input it received —
 * real motion (`outside`) and a resting pointer's repeats (`resting`, which wake nothing since I33). */
export interface Moved {
  readonly wakes: Readonly<Record<string, number>>;
  readonly timed: number;
  readonly outside: number;
  readonly resting: number;
}

export function movedBy(a: StillnessSample, b: StillnessSample): Moved {
  const wakes: Record<string, number> = {};
  for (const [reason, n] of Object.entries(b.wakes)) {
    const grew = n - (a.wakes[reason] ?? 0);
    if (grew > 0) wakes[reason] = grew;
  }
  return {
    wakes,
    timed: b.timed - a.timed,
    outside: b.outside - a.outside,
    resting: b.resting - a.resting,
  };
}

/** How many windows an idle row takes before outside input stops being an excuse. */
export const STILLNESS_TRIES = 3;

export type StillVerdict =
  | { readonly kind: "still" }
  /** Outside input reached the desk inside the window: sample again. */
  | { readonly kind: "again"; readonly moved: Moved }
  /** The desk moved by itself — or outside input past the last try: the row is red, and says why. */
  | { readonly kind: "moved"; readonly moved: Moved };

/** Judge one window, the `attempt`-th of at most `tries` (1-based). Only REAL outside motion that reached the desk (an
 * `input` wake grew) re-samples it — a resting pointer's repeats wake nothing since I33, so they excuse nothing. */
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
