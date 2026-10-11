// THE DECK'S EDGE (DESIGN.md §8, 2026-09-28): where the terminal sheet's top
// edge stands, as ONE signed number — the SHIFT, in CSS pixels, from the edge's
// resting place (the monitor's tuned height below the head's band, which since
// the Stories head takes no height: the stage runs under the head).
//
//   shift > 0 — the edge moved DOWN: the monitor grows by `shift` and the swarm's
//               field grows with it (the view re-measures its own section).
//   shift < 0 — the edge moved UP: the monitor keeps its tuned height (its
//               minimum) and the sheet slides OVER it by `-shift`, as far as
//               the head's reserve (`DECK_HEAD_RESERVE`, a place in the window).
//
// `godview.css` turns the one number into both halves — the monitor's
// `max(0px, shift)` growth and the deck's `min(0px, shift)` overlap — so the
// stylesheet, not this file, owns the layout. What lives here is the bounds and
// the viewer's memory of where they left it.

/** The custom property the stage's root carries; `godview.css` reads it. */
export const DECK_SHIFT_PROPERTY = "--vf-godview-deck-shift";

/** Per viewer, like the theme (GT-D12): where THIS person left the edge. */
export const DECK_EDGE_STORAGE_KEY = "vf-godview-deck-edge-v1";

/** The deck never gets shorter than this — the lip plus a few rows (§8). */
export const DECK_MIN_HEIGHT = 120;

/** The sheet's top never stands above this, measured from the WINDOW's top:
 * the head's reserve (DESIGN.md §8 "Godview's head — Stories": "56 (the head's
 * foot at 48, plus 8)"). A place in the window, not a distance from the
 * monitor: the reach is the same 56 whether the monitor begins under the 40
 * bar or, once the head takes no band, at the window's top — where "the
 * monitor's top" would be y 0, inside the app's 52 drag strip, a lip the
 * pointer could not take back.
 *
 * AN INTERIM (2026-10-11): the slice that maximizes the terminals restates the
 * reach as the ruled fill line (104, §8 "A drag has three outcomes"). */
export const DECK_HEAD_RESERVE = 56;

/** One arrow press; ⇧ multiplies it (§8). */
export const DECK_EDGE_STEP = 24;
export const DECK_EDGE_STEP_LARGE = DECK_EDGE_STEP * 4;

/** What the bounds are computed from, measured off the live stage. */
export interface DeckEdgeGeometry {
  /** Where the monitor begins below the stage's top — the window's top, in the
   * product: 40 under the instrument bar, 0 once the head takes no band. */
  monitorTop: number;
  /** The monitor's height with the edge at rest — its tuned height, and the
   * floor it never goes under. */
  restMonitor: number;
  /** From the monitor's top to the stage's bottom: all the room the monitor
   * and the deck share. */
  room: number;
}

export interface DeckEdgeBounds {
  /** The highest the edge goes: the head's reserve, `DECK_HEAD_RESERVE` from
   * the window's top (until 2026-10-11 the monitor's top, right under the
   * bar). Never below rest — a monitor so short that rest already stands above
   * the reserve keeps the resting layout. */
  min: number;
  /** The lowest: where the deck would drop below its minimum height. Never
   * above rest — a window too short for the minimum keeps the resting layout
   * rather than being pushed over the monitor by it. */
  max: number;
}

export function deckEdgeBounds(
  geometry: DeckEdgeGeometry,
  minDeck: number = DECK_MIN_HEIGHT,
): DeckEdgeBounds {
  // At rest the sheet's top stands the monitor's top and its tuned height
  // below the window's; it may rise by what that leaves above the reserve.
  const min = Math.min(0, DECK_HEAD_RESERVE - (geometry.monitorTop + geometry.restMonitor));
  const max = Math.max(0, geometry.room - geometry.restMonitor - minDeck);
  return { min, max };
}

export function clampDeckShift(shift: number, bounds: DeckEdgeBounds): number {
  if (!Number.isFinite(shift)) return 0;
  return Math.round(Math.min(bounds.max, Math.max(bounds.min, shift)));
}

/**
 * Measure the stage as it stands. `appliedShift` is the shift currently in
 * the stylesheet: the monitor's measured height includes its growth, so the
 * resting height is recovered by taking it back out — which is what keeps a
 * re-measure after the edge moved idempotent (no feedback through the
 * ResizeObserver that calls this).
 */
export function measureDeckEdge(
  root: Element,
  monitor: Element,
  appliedShift: number,
): DeckEdgeGeometry {
  const rootRect = root.getBoundingClientRect();
  const monitorRect = monitor.getBoundingClientRect();
  return {
    monitorTop: monitorRect.top - rootRect.top,
    restMonitor: monitorRect.height - Math.max(0, appliedShift),
    room: rootRect.bottom - monitorRect.top,
  };
}

/** The saved shift, or 0 (rest) when there is none or it cannot be read. */
export function storedDeckShift(): number {
  try {
    const raw = localStorage.getItem(DECK_EDGE_STORAGE_KEY);
    if (raw === null) return 0;
    const value = Number(raw);
    return Number.isFinite(value) ? Math.round(value) : 0;
  } catch {
    return 0;
  }
}

export function storeDeckShift(shift: number): void {
  try {
    if (shift === 0) localStorage.removeItem(DECK_EDGE_STORAGE_KEY);
    else localStorage.setItem(DECK_EDGE_STORAGE_KEY, String(Math.round(shift)));
  } catch {
    // A disabled storage partition costs the memory, never the edge itself.
  }
}

/** The separator's spoken value: where the edge is, in words. */
export function deckEdgeValueText(shift: number): string {
  if (shift === 0) return "at rest";
  return shift < 0
    ? `over the monitor by ${Math.abs(shift)} pixels`
    : `monitor enlarged by ${shift} pixels`;
}

/** The keyboard's answer for one key on the separator, or null when the key
 * is not the separator's (it then reaches whatever else wants it). */
export function deckShiftForKey(
  key: string,
  shiftKey: boolean,
  shift: number,
  bounds: DeckEdgeBounds,
): number | null {
  const step = shiftKey ? DECK_EDGE_STEP_LARGE : DECK_EDGE_STEP;
  switch (key) {
    case "ArrowUp":
      return clampDeckShift(shift - step, bounds);
    case "ArrowDown":
      return clampDeckShift(shift + step, bounds);
    case "Home":
      return bounds.min;
    case "End":
      return bounds.max;
    default:
      return null;
  }
}
