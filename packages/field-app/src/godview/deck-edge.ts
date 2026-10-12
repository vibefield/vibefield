// THE DECK'S EDGE (DESIGN.md §8, 2026-09-28): where the terminal sheet's top
// edge stands, as ONE signed number — the SHIFT, in CSS pixels, from the edge's
// resting place (the head's 40 and the monitor's tuned basis below the stage's
// top, whatever the head — L8a; since the Stories head the head takes no height
// and the stage runs under it).
//
//   shift > 0 — the edge moved DOWN; shift < 0 — it moved UP, as far as the
//               head's reserve (`DECK_HEAD_RESERVE`, a place in the window).
//
// Two copies of it stand on the stage's root, for `godview.css`:
//
//   `--vf-godview-deck-shift` — the edge as it STANDS, held or not: the sheet
//       is placed there, and a person's drag moves it every frame (the
//       terminals resize with it, rows only).
//   `--vf-godview-field-shift` — the edge as last SET (round 3, W4: "the
//       monitor makes room"): the monitor's field ends 12 above it, never above
//       220, measured once per change — a let-go, a key, a double-click, a
//       window that moved the bounds — and never once per frame of a drag.
//
// The stylesheet owns the layout. What lives here is the bounds, the outcome of
// a let-go, and the viewer's memory of where they left the edge.

/** The custom property the stage's root carries; `godview.css` reads it. */
export const DECK_SHIFT_PROPERTY = "--vf-godview-deck-shift";
/** The edge as last set, which the monitor's field follows (W4). */
export const FIELD_SHIFT_PROPERTY = "--vf-godview-field-shift";

/** Per viewer, like the theme (GT-D12): where THIS person left the edge. */
export const DECK_EDGE_STORAGE_KEY = "vf-godview-deck-edge-v1";

/** The least a deck that is UP keeps above the panes' foot — the lip plus a
 * few rows (§8) — and the line past which letting go puts it away (W4). */
export const DECK_MIN_HEIGHT = 120;

/** A HELD edge goes on down past that line, and stops this far short of the
 * panes' foot (the ruled drawing's `K.foot - 24`). */
export const DECK_HELD_LEAST = 24;

/** Let go moving faster than this, in px per ms, and the speed decides without
 * the distance: down, the terminals go away (and up, once they can be
 * maximized, they will maximize). */
export const DECK_FLING = 1.4;

/** How many of the latest positions a fling is read from (the drawing's six),
 * the let-go's own among them. */
export const DECK_FLING_SAMPLES = 6;

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
  /** The sheet's top with the edge at rest, from the stage's top. */
  restTop: number;
  /** The stage's height — the window's, inside the cover. */
  height: number;
  /** What the well keeps clear under the panes: the covers' reserve inside
   * the cover (FC-D15: the panes end at 692 in the drawing's 780), its own 8
   * outside it. */
  reserve: number;
}

export interface DeckEdgeBounds {
  /** The highest the edge goes: the head's reserve, `DECK_HEAD_RESERVE` from
   * the window's top. Never below rest — a monitor so short that rest already
   * stands above the reserve keeps the resting layout. */
  min: number;
  /** The lowest a deck that is UP stands: 120 left above the panes' foot —
   * where End takes it, and the line past which letting go puts it away.
   * Never above rest — a window too short for the minimum keeps the resting
   * layout rather than being pushed over the monitor by it. */
  max: number;
  /** The lowest a HELD edge goes: 24 short of the panes' foot. Never above
   * `max`. */
  held: number;
}

export function deckEdgeBounds(geometry: DeckEdgeGeometry): DeckEdgeBounds {
  const foot = geometry.height - geometry.reserve;
  const min = Math.min(0, DECK_HEAD_RESERVE - geometry.restTop);
  const max = Math.max(0, foot - DECK_MIN_HEIGHT - geometry.restTop);
  const held = Math.max(max, foot - DECK_HELD_LEAST - geometry.restTop);
  return { min, max, held };
}

export function clampDeckShift(shift: number, bounds: { min: number; max: number }): number {
  if (!Number.isFinite(shift)) return 0;
  return Math.round(Math.min(bounds.max, Math.max(bounds.min, shift)));
}

/**
 * Measure the stage as it is LAID OUT (`offset*`, never a painted box: the
 * sheet's own rise, the cover's settle and the Peek's recede are transforms).
 * `appliedShift` is the shift currently in the stylesheet: the sheet stands at
 * rest plus it, so taking it back out recovers rest — which keeps a re-measure
 * after the edge moved idempotent (no feedback through the ResizeObserver that
 * calls this).
 */
export function measureDeckEdge(
  root: HTMLElement,
  sheet: HTMLElement,
  well: Element | null,
  appliedShift: number,
): DeckEdgeGeometry {
  const reserve = well === null ? 0 : Number.parseFloat(getComputedStyle(well).marginBottom) || 0;
  return {
    restTop: sheet.offsetTop - appliedShift,
    height: root.offsetHeight,
    reserve,
  };
}

/** One position of the held edge: when, and where. */
export type DeckSample = readonly [ms: number, at: number];

/** How fast the edge was moving when it was let go, in px per ms (down is
 * positive): across the latest samples, the let-go's own among them — so an
 * edge flung and then held still before letting go is no fling. */
export function flingVelocity(samples: readonly DeckSample[]): number {
  const recent = samples.slice(-DECK_FLING_SAMPLES);
  const first = recent[0];
  const last = recent[recent.length - 1];
  if (first === undefined || last === undefined) return 0;
  const span = last[0] - first[0];
  return span > 0 ? (last[1] - first[1]) / span : 0;
}

/** Where a let-go takes the terminals: they stay — at the edge, remembered —
 * or they go away. Less than 120 left goes away; so does a fling down,
 * whatever is left. (A fling up, or an edge above the fill line, maximizes:
 * that is the next slice's, and until it lands the edge stays.) */
export type DeckLetGo = "stays" | "away";

export function deckLetGo(shift: number, bounds: DeckEdgeBounds, velocity: number): DeckLetGo {
  return shift > bounds.max || velocity > DECK_FLING ? "away" : "stays";
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
 * is not the separator's (it then reaches whatever else wants it). Keys move
 * the edge between the reach and the up deck's least, and nowhere else: they
 * never minimize. */
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

/** Whether a pointer event is the person's own: the drag reads TRUSTED moves
 * only (the ruled drawing's rule — a synthetic copy of a move is not the
 * hand). */
let trusted = (event: Event): boolean => event.isTrusted;

export function deckEdgeEventTrusted(event: Event): boolean {
  return trusted(event);
}

/** Test seam: a test's events are synthetic, so it says to trust them. */
export function trustDeckEdgeEventsForTest(on: boolean): void {
  trusted = on ? () => true : (event) => event.isTrusted;
}
