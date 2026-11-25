// THE BAR'S GEOMETRY (DK-11; DESIGN.md §8 "The selection bar" — Place; "The bar grown"; §10 "The mat's places";
// R6, R7). Pure numbers from the anchor ICE publishes (`handle.selection.anchor()` — the brackets' box ON SCREEN,
// CSS px of the view, and the view's size) and the bar's own measured width. The reserves are measured from the
// window's edges and hold at every size; the y values the canon quotes are the default window's (1180 × 780).

/** The bar's numbers (§8 "The selection bar"; §10 "The mat's places"). */
export const BAR = {
  /** the top chrome's height */
  height: 40,
  /** its foot above the brackets (the anchor's box: 6 out for one object, the union's 10 out for several) */
  above: 10,
  /** the SAFE TOP — a bar whose top would cross it stands below. It was the rulers' band (ending at 86 at their margin of
   * 60) plus 8; the rulers print at the window's edges since 2026-10-29 and it stays 94, clear of the head's controls */
  safeTop: 94,
  /** kept from each side: 16 since the edges left (HN-8) — the notch's 26 + 16 until then */
  sides: 16,
  /** its top never lower than the window's foot less this — 660 at 780: its foot 8 above the line's top (708) */
  lowest: 120,
  /** the line's reserve: nothing of the bar's grows lower than the window's foot less this (700 at 780) */
  foot: 80,
  /** how far the anchor's box stands out of the selected objects: the brackets' 6 round one, the union's 10 round
   * several (ICE's `MARKS.select.gap`, `MARKS.union.gap`) — a clearance from the objects' edge is measured past it
   * (item 550, 2026-11-18) */
  bracketGap: 6,
  unionGap: 10,
} as const;

/** The bar IN HAND (§8 "Tools in hand"; MC-D4): under the head, its top at y 64 (centre 84) — 16 under the name pill —
 * centred on the window. Its foot is 104; the held object's reading fit keeps 12 more (the layer's `hold.top`, 116). */
export const HAND = {
  /** the top, CSS px of the view (the head's 48 and the name pill's 16 under it) */
  top: 64,
} as const;

/**
 * Where the bar stands IN HAND (§8 "Tools in hand"): its top at y 64, centred on the window — kept 16 from each side
 * where the window is narrower than the bar and its sides. The selection's box is not read: the tools are the
 * hand's, not the object's place on the desk.
 */
export function placeHand(view: ViewSize, width: number): BarPlace {
  return {
    x: clamp(view.width / 2 - width / 2, BAR.sides, view.width - BAR.sides - width),
    y: HAND.top,
    below: false,
  };
}

/** The bar grown (§8 "The bar grown — More, and right-click"; R6, R20). */
export const GROWN = {
  /** at least this wide — the bar's own width when wider */
  minWidth: 244,
  /** the strong hairline between the list and the bar's own row */
  hairline: 1,
} as const;

export interface ScreenBox {
  readonly x0: number;
  readonly y0: number;
  readonly x1: number;
  readonly y1: number;
}

export interface ViewSize {
  readonly width: number;
  readonly height: number;
}

/** Where the bar stands: its top-left (CSS px of the view), and whether it stands BELOW its object. */
export interface BarPlace {
  readonly x: number;
  readonly y: number;
  readonly below: boolean;
}

const clamp = (v: number, lo: number, hi: number): number =>
  Math.min(Math.max(v, lo), Math.max(lo, hi));

/** A box wholly outside the view: no part of the selection is on screen (R7). */
export const offScreen = (box: ScreenBox, view: ViewSize): boolean =>
  box.x1 <= 0 || box.y1 <= 0 || box.x0 >= view.width || box.y0 >= view.height;

/**
 * Where the bar goes over a selection (R7): centred over the brackets, its foot 10 above them; when its top would
 * cross the safe top (94) it stands 10 below them instead, and a bar flipped below clamps at 94; kept 16 from each
 * side; its top never lower than the window's foot less 120 (660). Null — no bar — with nothing selected, no box
 * drawn, or the selection wholly off-screen.
 *
 * Over an object at work (item 550, 2026-11-18; §8 "The selection bar", Place) the foot stands `clear` off the
 * selected objects' edge — the reach of their marks, `atWorkBarClear` — and flipped, as far below; never nearer than
 * the 10 above the brackets. With no clearance (0) the place is the one above, number for number.
 *
 * THE WORDS BAR (V7, 2026-11-25; §8 "The words bar" — Place, B): `across` is the box it is CENTRED over — the selected
 * words, or a bare caret — while `box`, the sheet's brackets, says its height by the rule above, so it stands at the
 * sheet's edge and never over the writing. Absent, the bar is centred over `box`, as over objects.
 */
export function placeBar(
  anchor: {
    readonly box: ScreenBox | null;
    readonly count: number;
    readonly view: ViewSize;
    readonly across?: ScreenBox;
  },
  width: number,
  clear = 0,
): BarPlace | null {
  const { box, view } = anchor;
  if (box === null || anchor.count === 0 || offScreen(box, view)) return null;
  const centre = anchor.across ?? box;
  const x = clamp(
    (centre.x0 + centre.x1) / 2 - width / 2,
    BAR.sides,
    view.width - BAR.sides - width,
  );
  const lowest = view.height - BAR.lowest;
  const gap = anchor.count === 1 ? BAR.bracketGap : BAR.unionGap;
  const above = clear > 0 ? Math.max(BAR.above, clear - gap) : BAR.above;
  let y = box.y0 - above - BAR.height;
  let below = false;
  if (y < BAR.safeTop) {
    y = Math.max(box.y1 + above, BAR.safeTop);
    below = true;
  }
  return { x, y: Math.min(y, Math.max(BAR.safeTop, lowest)), below };
}

/** The bar grown into its menu: where the one element stands, and how its list fits. */
export interface MenuPlace {
  /** The grown element's left and width (CSS px of the view). */
  readonly x: number;
  readonly width: number;
  /** Grown upward from the bar's row (true), or downward with the row heading it (R6). */
  readonly up: boolean;
  /** The list's height as laid: its own, or the room it was clamped to (then it scrolls). */
  readonly listHeight: number;
  readonly scroll: boolean;
}

/**
 * The bar grown (R6, R20): at least 244 wide — the bar's width when wider — centred on the bar and kept 16 from
 * the sides; UPWARD from the bar's own row, or DOWNWARD when its top would cross the safe top (94), the row then
 * heading it; when it fits neither way the list scrolls inside it, clamped between the safe top and the line's
 * reserve, on the side with the more room. The bar's row never moves (M2): the menu is placed from it.
 * `first: "down"` (V7: the words bar flipped BELOW its sheet) tries downward first, away from the sheet, then upward.
 */
export function growMenu(
  bar: { readonly x: number; readonly y: number; readonly width: number },
  list: number,
  view: ViewSize,
  opts: { readonly first?: "up" | "down" } = {},
): MenuPlace {
  const width = Math.max(GROWN.minWidth, bar.width);
  const x = clamp(bar.x + bar.width / 2 - width / 2, BAR.sides, view.width - BAR.sides - width);
  const roomUp = bar.y - GROWN.hairline - BAR.safeTop;
  const roomDown = view.height - BAR.foot - (bar.y + BAR.height + GROWN.hairline);
  if (opts.first === "down" && list <= roomDown)
    return { x, width, up: false, listHeight: list, scroll: false };
  if (list <= roomUp) return { x, width, up: true, listHeight: list, scroll: false };
  if (list <= roomDown) return { x, width, up: false, listHeight: list, scroll: false };
  const up = roomUp >= roomDown;
  return { x, width, up, listHeight: Math.max(0, up ? roomUp : roomDown), scroll: true };
}
