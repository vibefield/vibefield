import { defineStruct, type RGB } from "@vibefield/plugin-sdk/desk";

// The kind's GPU RECORD, declared once: one {{title}} as its pass draws it. The struct's WGSL is
// generated from this declaration (shaders.ts hands it to `kitWgsl` as a struct), so the shader
// never declares `Disc` itself — the CPU side and the GPU side cannot drift apart.
// vec2f first, then the scalars, then the vec4f: tight under WGSL's alignment rules.
export const Disc = defineStruct("Disc", [
  ["centre", "vec2f"], // where it lies, world units
  ["radius", "f32"], // world units, the hand's lift in
  ["alpha", "f32"], // its presence: 1 alive, fading to 0 as a deleted one goes
  ["colour", "vec4f"], // its colour (sRGB, 0–1); unused
] as const);

/** The most discs one slot's pass draws (the record store grows to it). */
export const MAX_DISCS = 4096;

/** Where one lies, as `resolve` makes it each frame. */
export interface DiscGeometry {
  readonly cx: number;
  readonly cy: number;
  readonly r: number;
  readonly alpha: number;
}

/** What the pass draws for it: its geometry and its colour. */
export interface DiscRecord {
  readonly geometry: DiscGeometry;
  readonly colour: RGB;
}

/** One record as the struct's fields. */
export function discValues(d: DiscRecord) {
  const G = d.geometry;
  return {
    centre: [G.cx, G.cy],
    radius: G.r,
    alpha: G.alpha,
    colour: [d.colour[0], d.colour[1], d.colour[2], 1],
  };
}
