// The pad pass's GPU record, declared once: one pad as drawn — its block where it lies and how high, the lamp's
// slope its shadow falls along, its colours (the look's — never a literal in the shader), its ruling, its ink's
// place in the ink layers, and the caret while the desk's editor is on it. The camera, the light, the gobo and
// the portal chain arrive in the slot's view block (`MatUniforms`), which the pass binds and never writes.

import { defineStruct, type RGB } from "@vibefield/plugin-sdk/desk";

// vec2s first, then scalars, then vec4s: tight under the alignment rules.
export const Pad = defineStruct("Pad", [
  ["centre", "vec2f"],
  ["half", "vec2f"], // the top sheet's half extents as drawn (the lift's scale in), world units
  ["slope", "vec2f"], // the shadow's ground offset per unit of height, world axes — away from the lamp, capped
  ["radius", "f32"], // the sheet's corner as drawn, world units
  ["lift", "f32"], // the hold's rise, world units
  ["alpha", "f32"], // its presence (a delete ghost fades)
  ["scale", "f32"], // world units per pad unit (the lift's scale)
  ["shadow", "vec4f"], // σ at contact, alpha, σ per unit of height, the block's thickness
  ["paper", "vec4f"], // the top sheet's paper (sRGB), its grain
  ["sheet", "vec4f"], // the lower sheets' edge (sRGB), how many show
  ["accent", "vec4f"], // the binding strip and the rules' tint (sRGB), the binding's height (pad units)
  ["rules", "vec4f"], // the first baseline, the pitch, the last baseline's limit (pad units), the rules' half width
  ["marks", "vec4f"], // the rules' alpha, the margin rule's x (pad units), its alpha, the caret's width (pad units)
  ["ink", "vec4f"], // the pen (sRGB), 1 when a raster is laid
  ["raster", "vec4f"], // the raster's layer, its band (texels per pad unit), its origin (pad units)
  ["rasterSize", "vec4f"], // the raster's texels (w, h), the layer's texels (w, h)
  ["caret", "vec4f"], // the caret's x, its top, its height (pad units), 1 when shown
  ["dims", "vec4f"], // the sheet's size (pad units: w, h), a lower sheet's step (pad units); unused
] as const);

/** The most pads one slot's pass draws (the record store grows to it). */
export const MAX_PADS = 1024;

/** A pad's geometry as resolved (kind.ts `resolvePad`) — what the pass draws and the pick reads. */
export interface PadGeometry {
  readonly centre: readonly [number, number];
  /** The top sheet's half extents as drawn (the hold's scale applied), world units. */
  readonly half: readonly [number, number];
  /** The sheet's size in pad units (its rect's, before the lift's scale). */
  readonly size: { readonly w: number; readonly h: number };
  readonly scale: number;
  readonly lift: number;
  readonly radius: number;
  readonly slope: readonly [number, number];
  readonly lamp: readonly [number, number, number];
  readonly shadow: {
    readonly sigma: number;
    readonly alpha: number;
    readonly sigmaPerUnit: number;
  };
  /** How many lower sheets show, and each one's step (pad units). */
  readonly sheets: number;
  readonly step: number;
  readonly thickness: number;
  readonly alpha: number;
}

/** Where a pad's ink lies in the ink layers (writing.ts lays it). */
export interface PadRaster {
  readonly layer: number;
  readonly band: number;
  /** Its origin, pad units from the sheet's top-left (the writing box's). */
  readonly x: number;
  readonly y: number;
  /** Its texels, and its layer's. */
  readonly w: number;
  readonly h: number;
  readonly layerW: number;
  readonly layerH: number;
}

/** The ruled lines: the first baseline, the pitch, the last baseline's limit (pad units). */
export interface PadRules {
  readonly first: number;
  readonly pitch: number;
  readonly last: number;
}

/** The caret while the desk's editor is on the pad: its x, its top and its height (pad units). */
export interface PadCaret {
  readonly x: number;
  readonly y: number;
  readonly h: number;
}

/** One pad for the pass. */
export interface PadInstance {
  readonly geometry: PadGeometry;
  readonly paper: RGB;
  readonly sheet: RGB;
  readonly accent: RGB;
  readonly ink: RGB;
  readonly binding: number;
  readonly grain: number;
  readonly rules: PadRules;
  readonly ruleHalf: number;
  readonly ruleAlpha: number;
  readonly margin: { readonly x: number; readonly alpha: number };
  readonly caretWidth: number;
  readonly raster?: PadRaster | undefined;
  readonly caret?: PadCaret | undefined;
}

export function padValues(r: PadInstance) {
  const G = r.geometry;
  const R = r.raster;
  const C = r.caret;
  return {
    centre: G.centre,
    half: G.half,
    slope: G.slope,
    radius: G.radius,
    lift: G.lift,
    alpha: G.alpha,
    scale: G.scale,
    shadow: [G.shadow.sigma, G.shadow.alpha, G.shadow.sigmaPerUnit, G.thickness],
    paper: [r.paper[0], r.paper[1], r.paper[2], r.grain],
    sheet: [r.sheet[0], r.sheet[1], r.sheet[2], G.sheets],
    accent: [r.accent[0], r.accent[1], r.accent[2], r.binding],
    rules: [r.rules.first, r.rules.pitch, r.rules.last, r.ruleHalf],
    marks: [r.ruleAlpha, r.margin.x, r.margin.alpha, r.caretWidth],
    ink: [r.ink[0], r.ink[1], r.ink[2], R === undefined ? 0 : 1],
    raster: R === undefined ? [0, 1, 0, 0] : [R.layer, R.band, R.x, R.y],
    rasterSize: R === undefined ? [0, 0, 1, 1] : [R.w, R.h, R.layerW, R.layerH],
    caret: C === undefined ? [0, 0, 0, 0] : [C.x, C.y, C.h, 1],
    dims: [G.size.w, G.size.h, G.step, 0],
  };
}
