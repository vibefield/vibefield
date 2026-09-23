/**
 * The notch and its drawer are ONE path drawn from the wall (DESIGN.md §8,
 * edge trays; the design record is draft/composer/compact.html §15–19): a
 * concave fillet INTO the wall, a straight run, a convex face corner, the run
 * down the face, and back — so the object grows out of the edge it hangs from
 * instead of sitting on it. The right edge is the same path mirrored by the
 * shape's transform. Pure: the numbers are the drawing's inputs, and the
 * suite pins the strings.
 */
export interface NotchSpec {
  /** the width from the wall to the face */
  readonly w: number;
  /** the straight run between the two fillets */
  readonly h: number;
  /** the concave fillet into the wall */
  readonly f: number;
  /** the convex radius of the face's corners; must leave `w - c >= f` */
  readonly c: number;
}

/** N1, as ruled 2026-09-23: 26 wide, 116 tall including the fillets. */
export const NOTCH: NotchSpec = { w: 26, h: 92, f: 12, c: 14 };
/** P4's drawer: the notch's geometry at the panel's scale. */
export const DRAWER_FILLET = 18;
export const DRAWER_FACE = 22;
export const DRAWER_WIDTH = 152;

export function notchHeight(spec: NotchSpec): number {
  return spec.h + 2 * spec.f;
}

/** The drawer's spec for a panel of this rendered box. */
export function drawerSpec(width: number, height: number): NotchSpec {
  return { w: width, h: height, f: DRAWER_FILLET, c: DRAWER_FACE };
}

function topRun(s: NotchSpec): string {
  return `M0 0A${s.f} ${s.f} 0 0 0 ${s.f} ${s.f}H${s.w - s.c}A${s.c} ${s.c} 0 0 1 ${s.w} ${s.f + s.c}`;
}

function bottomRun(s: NotchSpec): string {
  return `A${s.c} ${s.c} 0 0 1 ${s.w - s.c} ${s.f + s.h}H${s.f}A${s.f} ${s.f} 0 0 0 0 ${2 * s.f + s.h}`;
}

/** The silhouette; `closed` adds the wall segment for a fill. */
export function notchPath(s: NotchSpec, closed: boolean): string {
  const d = `${topRun(s)}V${s.f + s.h - s.c}${bottomRun(s)}`;
  return closed ? `${d}Z` : d;
}

/**
 * The drawer's hairline with a GAP where the notch sits — its fillets start on
 * the face exactly there, so the two outlines read as one line and never a
 * seam (James, 2026-09-23). `gap` is [top, bottom] in the path's own
 * coordinates (the fillet's height is already inside them).
 */
export function drawerLinePath(s: NotchSpec, gap: readonly [number, number] | null): string {
  if (gap === null) return notchPath(s, false);
  return `${topRun(s)}V${gap[0]}M${s.w} ${gap[1]}V${s.f + s.h - s.c}${bottomRun(s)}`;
}

/** Where the notch's box sits on a drawer of this height: centred, in the
 * drawer path's coordinates (which start one fillet above the panel). */
export function notchGap(panelHeight: number, notch: NotchSpec = NOTCH): [number, number] {
  const mid = DRAWER_FILLET + panelHeight / 2;
  const half = notchHeight(notch) / 2;
  return [mid - half, mid + half];
}
