// PORTED VERBATIM from ICE's worked third-party kind (`infinite-canvas-engine/examples/desk-clock/src/layout.ts`, design-016 K8b) — re-wrapped by this repo's formatter,
// its imports moved to the SDK's `/desk` door — a VibeField plugin imports nothing of ICE but what the SDK re-exports (K-L1).

// The clock pass's GPU record, declared once: one clock as drawn — its case where it lies and how high, the lamp it is lit by,
// its hands' angles, its dial, its heights (for the shadows its parts cast) and its colours (the look's, never a literal in the
// shader). The camera, the light, the gobo and the portal chain arrive in the slot's view block (`MatUniforms`), which the pass
// binds and never writes (K-L3).

import type { RGB } from "@vibefield/plugin-sdk/desk";
import { defineStruct } from "@vibefield/plugin-sdk/desk";
import type { HandAngles } from "./law";

// vec2s first, then scalars, then vec4s: tight under the alignment rules.
export const Clock = defineStruct("Clock", [
  ["centre", "vec2f"],
  ["slope", "vec2f"], // the shadow's ground offset per unit of height, world axes — away from the lamp, capped
  ["radius", "f32"], // the case's radius as drawn (the hold's scale in), world units
  ["lift", "f32"], // the hold's rise, world units
  ["alpha", "f32"], // its presence (a delete ghost fades)
  ["lamp", "vec4f"], // the unit direction to the lamp, world axes (x right, y down, z off the desk); unused
  ["hands", "vec4f"], // the hour, minute and second hands, radians clockwise from twelve; the seconds hand shown (0/1)
  ["dial", "vec4f"], // its style (0 classic · 1 station · 2 graphite), the 24-hour ring (0/1); unused ×2
  ["dims", "vec4f"], // the dial's radius (of the case's), the bezel's relief, the seconds hand's height; unused
  ["heights", "vec4f"], // off the desk, world units (the lift is the shader's to add): the bezel's crown, the dial, the hour and minute hands
  ["shadow", "vec4f"], // σ at contact, alpha, σ per unit of height; unused
  ["dialColour", "vec4f"], // the dial (sRGB), its grain's amplitude
  ["ink", "vec4f"], // the printing (sRGB); unused
  ["caseColour", "vec4f"], // the case (sRGB), its metal — the highlight's strength
  ["handColour", "vec4f"], // the hour and minute hands (sRGB); unused
  ["secondColour", "vec4f"], // the seconds hand (sRGB); unused
  ["lume", "vec4f"], // the lume's paint (sRGB), its glow by night (0 = none)
] as const);

/** The most clocks one slot's pass draws (the record store grows to it). */
export const MAX_CLOCKS = 4096;

/** A clock's geometry as resolved (kind.ts `resolveClock`) — what the pass draws and the pick reads. */
export interface ClockGeometry {
  readonly centre: readonly [number, number];
  /** The case's radius as drawn, world units. */
  readonly radius: number;
  /** The dial's radius, of the case's. */
  readonly face: number;
  readonly lift: number;
  readonly scale: number;
  readonly slope: readonly [number, number];
  readonly lamp: readonly [number, number, number];
  readonly shadow: {
    readonly sigma: number;
    readonly alpha: number;
    readonly sigmaPerUnit: number;
  };
  readonly relief: number;
  readonly heights: {
    readonly case: number;
    readonly face: number;
    readonly hour: number;
    readonly minute: number;
    readonly second: number;
  };
  readonly alpha: number;
}

/** A dial's colours (the look's, per style — theme.ts). */
export interface DialColours {
  readonly dial: RGB;
  readonly grain: number;
  readonly ink: RGB;
  readonly case: RGB;
  readonly metal: number;
  readonly hands: RGB;
  readonly second: RGB;
  readonly lume: RGB;
  readonly glow: number;
}

/** One clock for the pass. */
export interface ClockInstance {
  readonly geometry: ClockGeometry;
  readonly hands: HandAngles;
  readonly seconds: boolean;
  /** The style's index in `CLOCK_STYLES`. */
  readonly style: number;
  readonly ring24: boolean;
  readonly colours: DialColours;
}

export function clockValues(c: ClockInstance) {
  const G = c.geometry;
  const k = c.colours;
  return {
    centre: G.centre,
    slope: G.slope,
    radius: G.radius,
    lift: G.lift,
    alpha: G.alpha,
    lamp: [G.lamp[0], G.lamp[1], G.lamp[2], 0],
    hands: [c.hands.hour, c.hands.minute, c.hands.second, c.seconds ? 1 : 0],
    dial: [c.style, c.ring24 ? 1 : 0, 0, 0],
    dims: [G.face, G.relief, G.heights.second, 0],
    heights: [G.heights.case, G.heights.face, G.heights.hour, G.heights.minute],
    shadow: [G.shadow.sigma, G.shadow.alpha, G.shadow.sigmaPerUnit, 0],
    dialColour: [k.dial[0], k.dial[1], k.dial[2], k.grain],
    ink: [k.ink[0], k.ink[1], k.ink[2], 0],
    caseColour: [k.case[0], k.case[1], k.case[2], k.metal],
    handColour: [k.hands[0], k.hands[1], k.hands[2], 0],
    secondColour: [k.second[0], k.second[1], k.second[2], 0],
    lume: [k.lume[0], k.lume[1], k.lume[2], k.glow],
  };
}
