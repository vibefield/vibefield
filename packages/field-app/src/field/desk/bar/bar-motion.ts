import { useSyncExternalStore } from "react";

// THE BAR'S MOTION (DK-11; DESIGN.md §8 "The selection bar" — Motion, R8; "The bar grown" — the Me menu's grow,
// M4; §6 M6). Its numbers, one table: away for a gesture and while a note is written — out in 90 ms, back 200 ms
// after it ends, in over 180 ms (ICE's, as built); deselected, out over 120 ms ease-out; grown on the island
// curve over 600 ms, the rows fading and rising 4 px nearest first, 160 ms + 26 ms a row (capped at 400 ms), 240
// ms each; folded back as the Me menu folds — the content out in 120 ms, the shape from 80 ms over 600 ms.
// REDUCED MOTION (M6, R8) HALVES EVERY DURATION AND FADES ONLY: no growth (the menu fades in whole), no rise.
//
// IN HAND (DK-12; §8 "Tools in hand"; R13, M1): the same element TRAVELS into the hand — the anchor's `travelMs` (560, I20)
// on the island curve — its contents swapping by a 120 ms cross-fade over the travel's last 120 ms, so it arrives as the
// tools in hand; back the same way when the hand is gone. Reduced motion: no travel — out over half the cross-fade, the
// new place and contents, in over the other half (a fade only); the dots do not pop.

export interface BarMotion {
  /** Out for a gesture or a note being written. */
  readonly awayMs: number;
  /** Back this long after the gesture ends… */
  readonly backMs: number;
  /** …fading in over this. */
  readonly inMs: number;
  /** Deselected: out over this, ease-out. */
  readonly outMs: number;
  /** The grow on the island curve — or, reduced, the menu's fade at full size. */
  readonly growMs: number;
  /** Folding, the shape waits this long after the content goes. */
  readonly foldDelayMs: number;
  /** Folding, the content goes in this. */
  readonly contentOutMs: number;
  /** The surface firms to solid over this (and fades as it reaches the bar again). */
  readonly firmMs: number;
  /** Each row's fade (and rise). */
  readonly rowMs: number;
  /** The nearest row's delay, each further row's step, the cap on the step's sum. */
  readonly rowBase: number;
  readonly rowStep: number;
  readonly rowCap: number;
  /** The menu GROWS from the bar (false: it fades in whole, M6). */
  readonly grows: boolean;
  /** The rows RISE 4 px as they fade in (false: they fade only). */
  readonly rises: boolean;
  /** In hand: the contents' cross-fade at the travel's end — or, reduced, the fade out and in again around the jump. */
  readonly swapMs: number;
  /** The bar TRAVELS between the selection and the hand (false: it fades, M6). */
  readonly travels: boolean;
}

/** The travel into the hand when the anchor carries none (the layer's `hold.travelMs` — DESK_HOLD's 560). */
export const TRAVEL_MS = 560;

export const BAR_MOTION: BarMotion = {
  awayMs: 90,
  backMs: 200,
  inMs: 180,
  outMs: 120,
  growMs: 600,
  foldDelayMs: 80,
  contentOutMs: 120,
  firmMs: 160,
  rowMs: 240,
  rowBase: 160,
  rowStep: 26,
  rowCap: 400,
  grows: true,
  rises: true,
  swapMs: 120,
  travels: true,
};

/** The bar's motion — under reduced motion every duration halved, fades only (R8, M6). */
export function barMotion(reduced: boolean): BarMotion {
  if (!reduced) return BAR_MOTION;
  const half = (ms: number): number => ms / 2;
  return {
    awayMs: half(BAR_MOTION.awayMs),
    backMs: half(BAR_MOTION.backMs),
    inMs: half(BAR_MOTION.inMs),
    outMs: half(BAR_MOTION.outMs),
    growMs: half(BAR_MOTION.growMs),
    foldDelayMs: half(BAR_MOTION.foldDelayMs),
    contentOutMs: half(BAR_MOTION.contentOutMs),
    firmMs: half(BAR_MOTION.firmMs),
    rowMs: half(BAR_MOTION.rowMs),
    rowBase: half(BAR_MOTION.rowBase),
    rowStep: half(BAR_MOTION.rowStep),
    rowCap: half(BAR_MOTION.rowCap),
    grows: false,
    rises: false,
    swapMs: half(BAR_MOTION.swapMs),
    travels: false,
  };
}

/** The travel's transform transition (M1): its length the anchor's, on the island curve. */
export const travelTransition = (travelMs: number): string =>
  `transform ${travelMs}ms var(--vf-ease-island)`;

/** When the cross-fade starts in a travel: its last `swapMs`, so the bar arrives as the tools in hand. */
export const swapAt = (m: BarMotion, travelMs: number): number => Math.max(0, travelMs - m.swapMs);

/** A row's reveal delay, `fromNearest` counting from the row next to the bar (0). */
export const rowDelay = (m: BarMotion, fromNearest: number): number =>
  m.rowBase + Math.min(fromNearest * m.rowStep, m.rowCap);

/** The bar's opacity transition: away for a gesture, in again, or out on a deselect (its visibility after). */
export function shownTransition(m: BarMotion, phase: "away" | "in" | "out"): string {
  if (phase === "away") return `opacity ${m.awayMs}ms ease-out, visibility 0s linear ${m.awayMs}ms`;
  if (phase === "in") return `opacity ${m.inMs}ms ease-out`;
  return `opacity ${m.outMs}ms ease-out, visibility 0s linear ${m.outMs}ms`;
}

const REDUCED = "(prefers-reduced-motion: reduce)";

const subscribeReduced = (fn: () => void): (() => void) => {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return () => {};
  const query = window.matchMedia(REDUCED);
  query.addEventListener("change", fn);
  return () => query.removeEventListener("change", fn);
};

const readReduced = (): boolean =>
  typeof window !== "undefined" &&
  typeof window.matchMedia === "function" &&
  window.matchMedia(REDUCED).matches;

/** Whether the person asked for reduced motion — followed live. */
export function useReducedMotion(): boolean {
  return useSyncExternalStore(subscribeReduced, readReduced, () => false);
}
