import type { Sparklings } from "./engine";
import type { FlatStarEye } from "./flat-star";
import type { StillFace } from "./stills";

// A face as a picture a host draws (DESIGN.md §2.10; TH-3, 2026-11-19): the still the window's one canvas
// draws, or, where the window has no WebGL2, the flat star as an SVG picture. TH-3's seam: the shapes, and
// an inert stub that draws nothing yet.

/** A face's picture. The same key promises the same picture. */
export interface SparkPicture {
  readonly key: string;
  /** a `data:image/png` still, or a `data:image/svg+xml` flat star */
  readonly image: string;
}

/** The flat star in the star's radii: the one drawing behind the face's SVG and its picture. */
export interface FlatStarFigure {
  /** the box, the disc's when framed and the star's when free */
  readonly box: { readonly x: number; readonly y: number; readonly side: number };
  /** the body's glow: its centre, its middle, its rim */
  readonly glow: readonly [string | undefined, string | undefined, string | undefined];
  /** the palette's backdrop, top then bottom: a framed face's disc */
  readonly deep: readonly [string | undefined, string | undefined];
  /** a framed face's disc: its centre's height and its radius; null when free */
  readonly disc: { readonly cy: number; readonly r: number } | null;
  readonly outline: string;
  readonly eyes: readonly [FlatStarEye, FlatStarEye];
}

/** A face's flat star (DESIGN.md §2.10), or null for a seed whose palette the engine does not hold. */
export function flatStarFigure(
  _engines: Sparklings,
  _face: { readonly seed: number; readonly size: number; readonly framed: boolean },
): FlatStarFigure | null {
  return null;
}

/** The face's picture: its still, or its flat star where the window has no WebGL2. */
export function sparkPicture(
  _engines: Sparklings,
  _face: Omit<StillFace, "room">,
): SparkPicture | null {
  return null;
}
