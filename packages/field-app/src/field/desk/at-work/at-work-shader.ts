import type { MatLight } from "@vibecook/ice/desk/kit";
import { colourOf } from "../../../frame/cards/press/press-colours";
import { AT_WORK_ATLAS, AT_WORK_STICKER } from "./at-work-atlas";
import type { Rgb01 } from "./at-work-ink";
import { AT_WORK, type ScreenFrame } from "./at-work-model";

/**
 * THE AT-WORK SHADER (item 550, 2026-11-18; DESIGN.md §8 "At work on the mat", §5 "The at-work mark's shadows and its
 * light", §2.8 the at-work sticker, §2.10 the printed star). The overlay's own WebGL2 layer: the marker stroke with its
 * tooth, wet ink, gloss, flecks and the hand's wobble; the die-cut foil sticker with one 1.6 px paper edge, the 0.7 px
 * cut, its shadow and its iridescence; a crew sticker's one sheet (a smooth union with the printed star, a channel of
 * bare paper and a fillet); the printed star's eyes, lit by night; a spark's free star's soft shadow; and a spark's
 * starlight line, which is the marker in the starlight ink.
 *
 * HOW IT DRAWS. One instanced draw a frame, TRIANGLE_STRIP, four vertices an instance, no vertex attributes (the
 * corner is `gl_VertexID`, the instance `gl_InstanceID`). Instances `[0, objects × 8)` are each object's BAND: eight
 * quads (four edges, four corners) covering only the strokes' reach and glow, `quadReach` ink px either side of the
 * strokes' centre lines, never the object's middle. The instances after them are the SEATS: one quad per sticker,
 * count or star, `seatReach` ink px round its centre. Every quad lies in its object's own turn, and hands the
 * fragment its ink-px coordinate there (`vLocal`), so the hand's wobble, the tooth and the flecks are taken in the
 * stroke's own coordinates (τ along it, x across it), never `gl_FragCoord`: a pan never crawls (DESIGN.md §8).
 *
 * HOW IT COMPOSES (DESIGN.md §5). Premultiplied, blended ONE / ONE_MINUS_SRC_ALPHA into a canvas made
 * `premultipliedAlpha: true`. Ink, foil, paper and shadows are colour with alpha; the ink's light is added with no
 * alpha of its own, after a tone map g / (1 + 0.45 g). Over this layer's own ink and paper the light is a screen; over
 * the desk beneath, which this layer cannot read, the window's compositor adds it (its ONE / ONE_MINUS_SRC_ALPHA over
 * a colour brighter than its alpha). A seat's quad lies over its band's, so a sticker's paper covers the ink's light,
 * and its shadow dims that light by its own 38% at most.
 *
 * HOW IT IS LIT (DESIGN.md §5). By the theme's night (ICE's `MatLight`, its numbers for the night model) and the lit
 * mat's mean light, one constant (`AT_WORK_MEAN_LIGHT`), never ICE's gobo, which this layer cannot sample until ICE's
 * host-marks hook (item 553). Its flecks catch light only by night.
 *
 * NO INK IS WRITTEN HERE. Every colour is a uniform read from a root token (`atWorkShaderColours`), an ink the model
 * computes or reads from tokens (`at-work-ink.ts`, in the rows), a printed star's palette (the atlas), or the theme's
 * light. The only colours the GLSL spells are light, not ink, its own numbers as the press keeps its lamp (DESIGN.md
 * §5): the white of every added light and highlight, 1, and the one warm light, the printed star's eyes by night,
 * `EYE_NIGHT` (1, 0.99, 0.965), named once. It writes the luma and colour-space weights as scalar arithmetic, so no
 * other vec3 or vec4 of numbers but 0 and 1 appears (`at-work-shader.test.ts` allows the eye by its name alone).
 *
 * THE ROWS: an RGBA32F texture `AT_WORK_ROWS.texels` texels wide, one row a record, read with `texelFetch` (the
 * texture NEAREST, no mipmaps). Object rows are rows `[0, objects)`, in the band instances' order; stroke rows sit
 * wherever their object's row names them; seat rows follow from `uCounts.z`, in the seat instances' order. Lengths in
 * ink px unless said; colours sRGB-encoded 0–1, the space the marks are mixed in.
 *
 * | Row    | Texel | x                  | y                 | z                    | w                        |
 * |--------|-------|--------------------|-------------------|----------------------|--------------------------|
 * | object | 0     | centre x (CSS px)  | centre y (CSS px) | half width (CSS px)  | half height (CSS px)     |
 * | object | 1     | cos(turn)          | sin(turn)         | corner (CSS px)      | screen px per ink px     |
 * | object | 2     | strokes (0–3)      | first stroke row  | the marks' clock (s) | under the hand 0 / 1     |
 * | stroke | 0     | drawn 0–1          | gap edge→centre   | travel (px along)    | wet 0–1                  |
 * | stroke | 1     | ink r              | ink g             | ink b                | glow                     |
 * | stroke | 2     | deep r             | deep g            | deep b               | seam (its seat's rank)   |
 * | stroke | 3     | lean A r           | lean A g          | lean A b             | quiet 0–1                |
 * | stroke | 4     | lean B r           | lean B g          | lean B b             | close (px past its start)|
 * | stroke | 5     | seed               | shiver            | form (0 1 2)         | opacity 0–1              |
 * | stroke | 6     | half-width         | —                 | —                    | —                        |
 * | seat   | 0     | centre x (CSS px)  | centre y (CSS px) | its object's row     | form (0 1 2)             |
 * | seat   | 1     | ink r              | ink g             | ink b                | seal 0–1.15              |
 * | seat   | 2     | lean A r           | lean A g          | lean A b             | lift 0–1                 |
 * | seat   | 3     | lean B r           | lean B g          | lean B b             | sweep 0–1                |
 * | seat   | 4     | seed               | atlas cell        | shiver               | quiet 0–1                |
 * | seat   | 5     | ring phase 0–1     | ring strength 0–1 | opacity 0–1          | seated 0–1 (a star's)    |
 * | seat   | 6     | star cell (−1 none)| crew grown 0–1    | crew seat x          | crew seat y              |
 * | seat   | 7     | star tone r        | star tone g       | star tone b          | —                        |
 * | seat   | 8     | star lean A r      | g                 | b                    | —                        |
 * | seat   | 9     | star lean B r      | g                 | b                    | —                        |
 *
 * A stroke's form: 0 an agent's marker, 1 a spark's starlight (it closes on its star, no flick), 2 the far band's thin
 * line. A seat's form: 0 a foil sticker, 1 a paper count, 2 a spark's free star (only its shadow: the stage draws the
 * star). A stroke's inks are its `ink` and `inkFrom` mixed by `inkMix`, tone by tone, in the encoded space. The marks'
 * clock is the model's `marks.clock` in seconds; a seat's cell is the atlas's `mark(agent)` or `count(n)`; its crew
 * seat is the atlas's `crewSeat(cell, star.cell)`. A star's `seated` is `clamp((drawn − 0.9) / 0.1)` of its line while
 * the line draws on, else 1: its shadow lands as it settles where the line closes (DESIGN.md §6).
 *
 * THE UNIFORMS, and what feeds each:
 *
 * | Uniform       | Type      | Fed by                                                                           |
 * |---------------|-----------|----------------------------------------------------------------------------------|
 * | `uData`       | sampler2D | the rows above (RGBA32F)                                                         |
 * | `uAtlas`      | sampler2D | `at-work-atlas.ts`'s `texels()` (RG8, LINEAR)                                    |
 * | `uAtlasGrid`  | vec2      | the atlas's cells a row (`AT_WORK_ATLAS.cols`) and its rows                       |
 * | `uView`       | vec4      | the canvas in CSS px (width, height), its pixel ratio (≤ 2), —                   |
 * | `uCounts`     | ivec4     | objects, seats, the first seat row, —                                            |
 * | `uLight`      | vec4      | the theme's `MatLight.night`, `AT_WORK_MEAN_LIGHT`, —, —                          |
 * | `uMoonlight`  | vec4      | the theme's `MatLight` lux, exposure, snow, fill                                 |
 * | `uMoon`       | vec3      | the theme's `MatLight.moon`                                                      |
 * | `uRod`        | vec3      | the theme's `MatLight.rod`                                                       |
 * | `uEigen`      | vec3      | the theme's `MatLight.eigengrau`                                                 |
 * | `uPrint`      | vec3      | `--vf-atwork-print`: the mark printed on the foil, a count's figure              |
 * | `uCast`       | vec3      | `--vf-atwork-cast`: every at-work shadow by day                                  |
 * | `uCastNight`  | vec3      | `--vf-atwork-cast-night`: the same by night                                      |
 * | `uPaper`      | vec3      | `--vf-sticker-edge`: a sticker's paper                                           |
 * | `uCut`        | vec4      | `--vf-sticker-cut`: the cut line, its colour and its alpha                       |
 * | `uPencilBox`  | vec4      | the selection's brackets: centre x, y and half extents (CSS px); none: z ≤ 0     |
 * | `uPencilTurn` | vec4      | their cos, sin, corner (CSS px), and how far further out they may stand (lock-on)|
 * | `uHandBox`    | vec4      | the object in hand's silhouette: centre x, y and half extents (CSS px); none: z ≤ 0|
 * | `uHandTurn`   | vec4      | its cos, sin, corner (CSS px), —                                                 |
 *
 * In the rows: a project's ink (`projectInkOf`), the neutral (`--vf-atwork-neutral`) and the starlight
 * (`--vf-atwork-pearl`, `-pearl-deep`, `-pearl-rose`, `-pearl-aqua`), all through `at-work-ink.ts`; a printed star's
 * tone through the atlas (its palette's c[0], c[2], c[4]).
 *
 * THE HAND'S COVER (2026-11-24; DESIGN.md §8 When not). The object in hand stands over the whole desk, so an object
 * whose row says it lies under the hand (object texel 2's w) has every fragment of its band and its seats masked out of
 * the hand's silhouette (`uHandBox`, `uHandTurn`), with the edge's half pixel of antialias; the held object's own marks
 * are never under it.
 */

// ———————————————————————————————————————————————————————————————— the numbers both sides read

/** Item 550 (2026-11-18): the rows' layout, texel by texel (the table above). The layer writes by these names. */
export const AT_WORK_ROWS = {
  texels: 10,
  object: { frame: 0, turn: 1, strokes: 2 },
  stroke: { motion: 0, ink: 1, deep: 2, leanA: 3, leanB: 4, hand: 5, width: 6 },
  seat: {
    place: 0,
    ink: 1,
    leanA: 2,
    leanB: 3,
    hand: 4,
    ring: 5,
    crew: 6,
    crewInk: 7,
    crewLeanA: 8,
    crewLeanB: 9,
  },
  form: { marker: 0, starlight: 1, line: 2 },
  seatForm: { sticker: 0, count: 1, star: 2 },
  /** a band is this many quads: four edges, four corners */
  pieces: 8,
  /** an object draws at most this many strokes (the model's `AT_WORK.stroke.most`) */
  strokes: AT_WORK.stroke.most,
  /** no star cell */
  noStar: -1,
} as const;

/** Item 550 (2026-11-18): the shader's own numbers (DESIGN.md §5, §8 "At work on the mat"). */
export const AT_WORK_SHADER = {
  /** the iridescence's strength (DESIGN.md §2.9, the leans) */
  irid: 0.6,
  /** nothing of a stroke is drawn further than this from its centre line */
  bandReach: 44,
  /** a band's quads stand this far either side of the strokes' centre lines: the reach, the shiver (2.4), an edge */
  quadReach: 48,
  /** a seat's quad's half side: a seat draws nothing further than √2100 (45.8) from its centre */
  seatReach: 46,
  /** the band along the pencil where nothing of the overlay lies, CSS px (DESIGN.md §7) */
  pencilBand: 2.5,
  /** the tooth's grain and the flecks' cells, ink px in the stroke's own coordinates (DESIGN.md §8) */
  tooth: 2.2,
  fleck: 1.6,
  /** every shadow falls away from this, and a stroke's falls along its normal's share of this (DESIGN.md §5) */
  toLight: [-0.2891, -0.9573],
  strokeShadow: [0.9, 1.9],
} as const;

/** Item 550 (2026-11-18): the gobo value the overlay lights its marks at, 0 (full shade) to 1 (full sun): the lit
 * mat's mean light, one constant read off the palm plate (its mean base light, 0.709), standing in for the dapple
 * the overlay cannot sample (DESIGN.md §5). */
export const AT_WORK_MEAN_LIGHT = 0.71;

/** Item 550 (2026-11-18): the canvas the overlay draws in, and how it blends (the composition above). A context
 * the browser would run in software is refused, so the heavy fragment stage never runs on the CPU: the DOM form
 * stands instead (DESIGN.md §8 "At work on the mat": without WebGL2, the DOM form). */
export const AT_WORK_CONTEXT: WebGLContextAttributes = {
  alpha: true,
  premultipliedAlpha: true,
  antialias: false,
  depth: false,
  stencil: false,
  failIfMajorPerformanceCaveat: true,
};

/** The selection's brackets as ICE 0.17.0 sets them (its `MARKS.select` and `MARKS.union`, which ICE does not
 * export): 6 out at rest with a corner of the frame's + 6 up to 10, arriving from 8 further out; several's union 10
 * out, square to the mat, its corner 4 (DESIGN.md §7). */
export const AT_WORK_PENCIL = {
  gap: 6,
  radiusMost: 10,
  arrive: 8,
  unionGap: 10,
  unionRadius: 4,
} as const;

/** The uniforms' names, for the layer's look-ups. */
export const AT_WORK_UNIFORMS = [
  "uData",
  "uAtlas",
  "uAtlasGrid",
  "uView",
  "uCounts",
  "uLight",
  "uMoonlight",
  "uMoon",
  "uRod",
  "uEigen",
  "uPrint",
  "uCast",
  "uCastNight",
  "uPaper",
  "uCut",
  "uPencilBox",
  "uPencilTurn",
  "uHandBox",
  "uHandTurn",
] as const;

// ———————————————————————————————————————————————————————————————— the colours and the light, read

/** Item 550 (2026-11-18): the root tokens the shader's colour uniforms read (DESIGN.md first, then tokens.css). */
export const AT_WORK_SHADER_TOKENS = {
  print: "--vf-atwork-print",
  cast: "--vf-atwork-cast",
  castNight: "--vf-atwork-cast-night",
  paper: "--vf-sticker-edge",
  cut: "--vf-sticker-cut",
} as const;

/** The shader's colour uniforms, sRGB-encoded 0–1. */
export interface AtWorkShaderColours {
  readonly print: Rgb01;
  readonly cast: Rgb01;
  readonly castNight: Rgb01;
  readonly paper: Rgb01;
  readonly cut: { readonly rgb: Rgb01; readonly alpha: number };
}

/** The colour uniforms, each read through `token` (the root, `rootToken`), or null when any is missing or not a
 * colour: then the GL form cannot draw, and the DOM form stands. PURE but for `token`. */
export function atWorkShaderColours(token: (name: string) => string): AtWorkShaderColours | null {
  const read = (name: string): { readonly rgb: Rgb01; readonly alpha: number } | null => {
    const colour = colourOf(token(name).trim());
    if (colour === null) return null;
    const [r, g, b] = colour.rgb;
    return { rgb: [r / 255, g / 255, b / 255], alpha: colour.alpha };
  };
  const opaque = (name: string): Rgb01 | null => {
    const colour = read(name);
    return colour === null || colour.alpha !== 1 ? null : colour.rgb;
  };
  const T = AT_WORK_SHADER_TOKENS;
  const print = opaque(T.print);
  const cast = opaque(T.cast);
  const castNight = opaque(T.castNight);
  const paper = opaque(T.paper);
  const cut = read(T.cut);
  if (print === null || cast === null || castNight === null || paper === null || cut === null)
    return null;
  return { print, cast, castNight, paper, cut };
}

/** The light uniforms. */
export interface AtWorkLightUniforms {
  /** `uLight`: the night, the mean light */
  readonly light: readonly [number, number, number, number];
  /** `uMoonlight`: lux, exposure, snow, fill */
  readonly moonlight: readonly [number, number, number, number];
  readonly moon: Rgb01;
  readonly rod: Rgb01;
  readonly eigengrau: Rgb01;
}

/** The light uniforms for a theme's light (`deskTheme(name).matLight`). PURE. */
export function atWorkLight(
  light: MatLight,
  meanLight: number = AT_WORK_MEAN_LIGHT,
): AtWorkLightUniforms {
  const three = (c: MatLight["moon"]): Rgb01 => [c[0], c[1], c[2]];
  return {
    light: [light.night, meanLight, 0, 0],
    moonlight: [light.lux, light.exposure, light.snow, light.fill],
    moon: three(light.moon),
    rod: three(light.rod),
    eigengrau: three(light.eigengrau),
  };
}

/** `uPencilBox` and `uPencilTurn`: where the overlay keeps off the pencil. */
export interface AtWorkPencil {
  readonly box: readonly [number, number, number, number];
  readonly turn: readonly [number, number, number, number];
}

/** No selection: nothing is kept off. */
export const AT_WORK_NO_PENCIL: AtWorkPencil = { box: [0, 0, 0, 0], turn: [1, 0, 0, 0] };

/** A sole selection's brackets round its frame on screen (ICE 0.17.0's `selectionGeometry` at rest, its box turned
 * with the frame), kept off out to `travel` further: mid lock-on the brackets' corners stand up to √2 × the arrival
 * off the rest box, so a caller that cannot place them passes `arrive × √2` until it is over. PURE. */
export function atWorkPencilOf(frame: ScreenFrame, travel = 0): AtWorkPencil {
  const P = AT_WORK_PENCIL;
  return {
    box: [frame.cx, frame.cy, frame.hx + P.gap, frame.hy + P.gap],
    turn: [
      Math.cos(frame.angle),
      Math.sin(frame.angle),
      Math.min(frame.r + P.gap, P.radiusMost),
      travel,
    ],
  };
}

/** Several's union: the anchor's `box` (already 10 out, square to the mat), its corner 4. PURE. */
export function atWorkPencilOfUnion(box: {
  readonly x0: number;
  readonly y0: number;
  readonly x1: number;
  readonly y1: number;
}): AtWorkPencil {
  return {
    box: [
      (box.x0 + box.x1) / 2,
      (box.y0 + box.y1) / 2,
      (box.x1 - box.x0) / 2,
      (box.y1 - box.y0) / 2,
    ],
    turn: [1, 0, AT_WORK_PENCIL.unionRadius, 0],
  };
}

/** `uHandBox` and `uHandTurn`: the silhouette of the object in hand, which covers the marks behind it (2026-11-24). */
export interface AtWorkHand {
  readonly box: readonly [number, number, number, number];
  readonly turn: readonly [number, number, number, number];
}

/** Nothing in hand: nothing is covered. */
export const AT_WORK_NO_HAND: AtWorkHand = { box: [0, 0, 0, 0], turn: [1, 0, 0, 0] };

/** Item 550 (2026-11-24): the hand's uniforms for the silhouette of the object in hand on screen, or none. PURE. */
export function atWorkHandUniforms(frame: ScreenFrame | null): AtWorkHand {
  if (frame === null) return AT_WORK_NO_HAND;
  return {
    box: [frame.cx, frame.cy, frame.hx, frame.hy],
    turn: [Math.cos(frame.angle), Math.sin(frame.angle), Math.max(frame.r, 0), 0],
  };
}

// ———————————————————————————————————————————————————————————————— the GLSL

/** A number as a GLSL float literal: never a bare integer, which GLSL ES reads as an int. PURE. */
export function glslFloat(n: number): string {
  if (!Number.isFinite(n)) throw new Error(`no GLSL float spells ${n}`);
  return Number.isInteger(n) ? n.toFixed(1) : String(n);
}
const glf = glslFloat;

const R = AT_WORK_ROWS;
const L = AT_WORK_SHADER;
const A = AT_WORK_ATLAS;
const S = AT_WORK_STICKER;
const SEAT = AT_WORK.seat;

/** The constants both stages read: the rows' texels and the shader's numbers, from the one source above. */
const HEAD = `#version 300 es
precision highp float;
precision highp int;
precision highp sampler2D;

const int ROW_TEXELS = ${R.texels};
const int O_FRAME = ${R.object.frame};
const int O_TURN = ${R.object.turn};
const int O_STROKES = ${R.object.strokes};
const int S_MOTION = ${R.stroke.motion};
const int S_INK = ${R.stroke.ink};
const int S_DEEP = ${R.stroke.deep};
const int S_LEAN_A = ${R.stroke.leanA};
const int S_LEAN_B = ${R.stroke.leanB};
const int S_HAND = ${R.stroke.hand};
const int S_WIDTH = ${R.stroke.width};
const int E_PLACE = ${R.seat.place};
const int E_INK = ${R.seat.ink};
const int E_LEAN_A = ${R.seat.leanA};
const int E_LEAN_B = ${R.seat.leanB};
const int E_HAND = ${R.seat.hand};
const int E_RING = ${R.seat.ring};
const int E_CREW = ${R.seat.crew};
const int E_CREW_INK = ${R.seat.crewInk};
const int E_CREW_A = ${R.seat.crewLeanA};
const int E_CREW_B = ${R.seat.crewLeanB};
const int PIECES = ${R.pieces};
const int MOST = ${R.strokes};
const float FORM_STARLIGHT = ${glf(R.form.starlight)};
const float FORM_LINE = ${glf(R.form.line)};
const float SEAT_COUNT = ${glf(R.seatForm.count)};
const float SEAT_STAR = ${glf(R.seatForm.star)};
const float QUAD_REACH = ${glf(L.quadReach)};
const float SEAT_REACH = ${glf(L.seatReach)};

uniform sampler2D uData;
uniform vec4 uView;

vec4 row(int r, int t) { return texelFetch(uData, ivec2(t, r), 0); }
`;

/** Item 550 (2026-11-18): the vertex stage. Each instance is a band piece or a seat; it lays its quad in its object's
 * turn and hands the fragment its ink-px coordinate there. */
export const AT_WORK_VS = `${HEAD}
uniform ivec4 uCounts;

flat out int vKind;
flat out int vRow;
out vec2 vLocal;
out vec2 vScreen;

const float SQRT_HALF = 0.70710678;
// the eight pieces: the top, right, bottom and left edges, then the corners clockwise from the top right
const vec2 SIDES[8] = vec2[8](
  vec2(0.0, -1.0), vec2(1.0, 0.0), vec2(0.0, 1.0), vec2(-1.0, 0.0),
  vec2(1.0, -1.0), vec2(1.0, 1.0), vec2(-1.0, 1.0), vec2(-1.0, -1.0)
);

// one axis of a piece: the strip out on its side, or the span between
vec2 spanOf(float side, float inner, float outer) {
  if (side < -0.5) return vec2(-outer, -inner);
  if (side > 0.5) return vec2(inner, outer);
  return vec2(-inner, inner);
}

void main() {
  vec2 corner = vec2(float(gl_VertexID & 1), float(gl_VertexID >> 1));
  int bands = uCounts.x * PIECES;
  vec2 centre;
  vec4 turn;
  vec2 local;
  if (gl_InstanceID < bands) {
    int o = gl_InstanceID / PIECES;
    int piece = gl_InstanceID - o * PIECES;
    vec4 frame = row(o, O_FRAME);
    turn = row(o, O_TURN);
    vec4 strokes = row(o, O_STROKES);
    float zs = max(turn.w, 0.1);
    vec2 B = frame.zw / zs;
    float r = min(turn.z / zs, min(B.x, B.y));
    int n = int(strokes.x + 0.5);
    int first = int(strokes.y + 0.5);
    float lo = 1e9;
    float hi = -1e9;
    for (int k = 0; k < MOST; k++) {
      if (k >= n) break;
      float g = row(first + k, S_MOTION).y;
      lo = min(lo, g);
      hi = max(hi, g);
    }
    vKind = 0;
    vRow = o;
    if (n <= 0) {
      // nothing to draw round it: the quad folds to a point
      vLocal = vec2(0.0);
      vScreen = vec2(0.0);
      gl_Position = vec4(0.0, 0.0, 0.0, 1.0);
      return;
    }
    // how far in from the edge the band reaches, and the inner box that keeps clear of it even at a round corner
    float din = max(QUAD_REACH - lo, 0.0);
    float inset = max(din, r * (1.0 - SQRT_HALF) + din * SQRT_HALF);
    vec2 inner = max(B - inset, vec2(0.0));
    vec2 outer = B + hi + QUAD_REACH;
    vec2 side = SIDES[piece];
    vec2 sx = spanOf(side.x, inner.x, outer.x);
    vec2 sy = spanOf(side.y, inner.y, outer.y);
    local = vec2(mix(sx.x, sx.y, corner.x), mix(sy.x, sy.y, corner.y));
    centre = frame.xy;
  } else {
    int s = uCounts.z + gl_InstanceID - bands;
    vec4 place = row(s, E_PLACE);
    turn = row(int(place.z + 0.5), O_TURN);
    vKind = 1;
    vRow = s;
    local = (corner * 2.0 - 1.0) * SEAT_REACH;
    centre = place.xy;
  }
  vLocal = local;
  vec2 p = local * max(turn.w, 0.1);
  vScreen = centre + vec2(turn.x * p.x - turn.y * p.y, turn.y * p.x + turn.x * p.y);
  gl_Position = vec4(vScreen.x / uView.x * 2.0 - 1.0, 1.0 - vScreen.y / uView.y * 2.0, 0.0, 1.0);
}
`;

/** Item 550 (2026-11-18): the fragment stage, the marker and the sticker. */
export const AT_WORK_FS = `${HEAD}
uniform sampler2D uAtlas;
uniform vec2 uAtlasGrid;
uniform vec4 uLight;
uniform vec4 uMoonlight;
uniform vec3 uMoon;
uniform vec3 uRod;
uniform vec3 uEigen;
uniform vec3 uPrint;
uniform vec3 uCast;
uniform vec3 uCastNight;
uniform vec3 uPaper;
uniform vec4 uCut;
uniform vec4 uPencilBox;
uniform vec4 uPencilTurn;
uniform vec4 uHandBox;
uniform vec4 uHandTurn;

flat in int vKind;
flat in int vRow;
in vec2 vLocal;
in vec2 vScreen;
out vec4 fragOut;

const float PI = 3.14159265359;
const float IRID = ${glf(L.irid)};
const float BAND_REACH = ${glf(L.bandReach)};
const float PENCIL_BAND = ${glf(L.pencilBand)};
const float TOOTH = ${glf(L.tooth)};
const float FLECK = ${glf(L.fleck)};
const vec2 TO_LIGHT = vec2(${glf(L.toLight[0])}, ${glf(L.toLight[1])});
const vec2 STROKE_SHADOW = vec2(${glf(L.strokeShadow[0])}, ${glf(L.strokeShadow[1])});
// a sticker cell is 160 texels for a 72-texel (24-unit) mark, its fields reaching 42 texels
const float CELL_UNITS = ${glf(A.cell / (A.mark / A.units))};
const float MARK_UNITS = ${glf(A.units)};
const float SPREAD_FRAC = ${glf(A.spread / A.cell)};
const float STICKER = ${glf(S.scale)};
const float FOIL = ${glf(S.foil)};
const float EDGE = ${glf(S.edge)};
const float CUT = ${glf(S.cut)};
// a worn star: its cell in ink px (its radius is 36 texels of 160), its channel, its fillet, its own lean
const float CREW_BOX = ${glf((A.cell / A.star) * S.crew.radius)};
const float CREW_CHAN = ${glf(S.crew.channel)};
const float CREW_FILLET = ${glf(S.crew.fillet)};
const float CREW_TILT = ${glf((S.crew.tilt * Math.PI) / 180)};
// the seats down the object's right side (the model's AT_WORK.seat)
const float SEAT_FIRST = ${glf(SEAT.first)};
const float SEAT_APART = ${glf(SEAT.apart)};
const float SEAT_DEEPEST = ${glf(SEAT.deepest)};
// the printed star's eyes by night: a warm light, not ink, the code's own number as the press
// keeps its lamp (DESIGN.md §5)
const vec3 EYE_NIGHT = vec3(1.0, 0.99, 0.965);

// ---- small tools
float hash12(vec2 p) {
  float n = sin(dot(p, vec2(127.1, 311.7))) * 43758.5453;
  return n - floor(n);
}
float hash11(float p) {
  p = fract(p * 0.1031);
  p *= p + 33.33;
  p *= p + p;
  return fract(p);
}
float valueNoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  float a = mix(hash12(i), hash12(i + vec2(1.0, 0.0)), f.x);
  float b = mix(hash12(i + vec2(0.0, 1.0)), hash12(i + vec2(1.0, 1.0)), f.x);
  return mix(a, b, f.y);
}
float n1(float x) {
  float i = floor(x);
  float f = fract(x);
  f = f * f * (3.0 - 2.0 * f);
  return mix(hash11(i), hash11(i + 1.0), f);
}
float linstep(float a, float b, float x) { return clamp((x - a) / max(b - a, 1e-5), 0.0, 1.0); }
// pow(x, 2.0) as a square: GLSL leaves pow undefined for a negative x
float sq(float x) { return x * x; }
// luma, as arithmetic
float luma(vec3 c) { return 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b; }

// premultiplied: lay colour c at alpha a over what lies here
void lay(inout vec4 acc, vec3 c, float a) {
  float k = clamp(a, 0.0, 1.0);
  acc = vec4(c * k, k) + acc * (1.0 - k);
}

// ---- the light: the mean light by day, the theme's night model by night (DESIGN.md §5)
float sunDOf(float gobo) { return pow(mix(1.0, 0.5 + 0.5 * gobo, 0.975), 1.0 / 2.2); }
float toLinear1(float c) { return c <= 0.04045 ? c / 12.92 : pow((c + 0.055) / 1.055, 2.4); }
vec3 toLinear(vec3 c) { return vec3(toLinear1(c.r), toLinear1(c.g), toLinear1(c.b)); }
float encode1(float c) { return c < 0.0031308 ? c * 12.92 : 1.055 * pow(c, 1.0 / 2.4) - 0.055; }
vec3 encode(vec3 c) { return vec3(encode1(c.r), encode1(c.g), encode1(c.b)); }
float photopic(vec3 c) { return 0.2126729 * c.r + 0.7151522 * c.g + 0.072175 * c.b; }
float scotopic(vec3 c) {
  float x = 0.4124564 * c.r + 0.3575761 * c.g + 0.1804375 * c.b;
  float y = photopic(c);
  float z = 0.0193339 * c.r + 0.119192 * c.g + 0.9503041 * c.b;
  return y * (1.33 * (1.0 + (y + z) / max(x, 1e-6)) - 1.68);
}
float mesopic(float lum) {
  return clamp(0.767 + 0.3334 * log(max(lum, 1e-9)) * 0.4342944819, 0.0, 1.0);
}
// the mat's night model on a linear albedo, as the theme's MatLight states it
vec3 moonlit(vec3 albedo, float gobo, float noise) {
  float shade = uMoonlight.w + (1.0 - uMoonlight.w) * gobo;
  vec3 cone = albedo * uMoon * shade;
  float rod = max(scotopic(cone), 0.0) / scotopic(vec3(1.0));
  float lum = uMoonlight.x * photopic(cone) * 0.3183098862;
  vec3 see = mix(rod * uRod, cone, mesopic(lum));
  return encode(uEigen + see * uMoonlight.y) + (noise - 0.5) * uMoonlight.z;
}
// a sticker's paper under the one light: the mean light by day, untinted (no token holds a shade's tint)
vec3 litPaper(vec3 a, float gobo, float night, float noise) {
  vec3 day = a * sunDOf(gobo);
  if (night <= 0.0) return day;
  return mix(day, moonlit(toLinear(a), gobo, noise), night);
}

// ---- the rounded box: its distance, its outward normal, the length along it
float sdRoundBox(vec2 p, vec2 b, float r) {
  r = min(r, min(b.x, b.y));
  vec2 q = abs(p) - b + r;
  return min(max(q.x, q.y), 0.0) + length(max(q, 0.0)) - r;
}
vec2 gradRoundBox(vec2 p, vec2 b, float r) {
  r = min(r, min(b.x, b.y));
  vec2 w = abs(p) - (b - r);
  vec2 s = vec2(p.x < 0.0 ? -1.0 : 1.0, p.y < 0.0 ? -1.0 : 1.0);
  vec2 q = max(w, 0.0);
  float l = length(q);
  if (max(w.x, w.y) > 0.0 && l > 1e-5) return s * q / l;
  return s * ((w.x > w.y) ? vec2(1.0, 0.0) : vec2(0.0, 1.0));
}
// arc length along the rounded box (half B, corner R), clockwise on screen from the top's centre; P its perimeter
float arcS(vec2 p, vec2 B, float R, out float P) {
  R = min(R, min(B.x, B.y));
  vec2 c = max(B - R, vec2(1e-3));
  float qc = 1.5707963 * R;
  P = 4.0 * (c.x + c.y) + 4.0 * qc;
  vec2 a = abs(p);
  bool corner = a.x > c.x && a.y > c.y;
  if (!corner) {
    bool horiz = (a.x <= c.x && a.y > c.y)
      ? true
      : ((a.y <= c.y && a.x > c.x) ? false : ((B.y - a.y) < (B.x - a.x)));
    if (horiz) {
      float x = clamp(p.x, -c.x, c.x);
      if (p.y < 0.0) return x >= 0.0 ? x : P + x;
      return c.x + 2.0 * qc + 2.0 * c.y + (c.x - x);
    }
    float y = clamp(p.y, -c.y, c.y);
    if (p.x > 0.0) return c.x + qc + (y + c.y);
    return 3.0 * c.x + 3.0 * qc + 2.0 * c.y + (c.y - y);
  }
  vec2 v = p - c * sign(p);
  float th = atan(v.y, v.x);
  if (p.x > 0.0 && p.y < 0.0) return c.x + R * (th + 1.5707963);
  if (p.x > 0.0) return c.x + qc + 2.0 * c.y + R * th;
  if (p.y > 0.0) return 3.0 * c.x + 2.0 * qc + 2.0 * c.y + R * (th - 1.5707963);
  return 3.0 * c.x + 3.0 * qc + 4.0 * c.y + R * (th + PI);
}

// ---- iridescence: four stops round the ink (itself, a lean, a pearl, the other lean) (DESIGN.md §2.9)
vec3 irid(vec3 C, vec3 Ia, vec3 Ib, float ph) {
  float a = fract(ph) * 4.0;
  float t = fract(a);
  t = t * t * (3.0 - 2.0 * t);
  vec3 pearl = mix(C, vec3(1.0), 0.7);
  if (a < 1.0) return mix(C, Ia, t);
  if (a < 2.0) return mix(Ia, pearl, t);
  if (a < 3.0) return mix(pearl, Ib, t);
  return mix(Ib, C, t);
}

// ---- where a stroke starts: under its own seat (DESIGN.md §8, the stroke)
float seamOff(float rank, vec2 hb, float r) {
  float cy = max(hb.y - min(r, min(hb.x, hb.y)), 1.0);
  return min(SEAT_FIRST + SEAT_APART * rank, SEAT_DEEPEST * cy);
}
float seamS(float rank, vec2 hb, float r, vec2 B, float R) {
  float Rm = min(R, min(B.x, B.y));
  return max(B.x - Rm, 1e-3) + 1.5707963 * Rm + seamOff(rank, hb, r);
}

// ---- the sticker's fields, cells laid in a grid
vec2 cellUv(float cell, vec2 uv) {
  float cols = max(uAtlasGrid.x, 1.0);
  float col = mod(cell, cols);
  float line = floor(cell / cols);
  return vec2((col + uv.x) / cols, (line + uv.y) / max(uAtlasGrid.y, 1.0));
}
// printed: the mark itself (R); else its silhouette with its holes filled (G)
float glyphField(float cell, vec2 v, float box, bool printed) {
  vec2 uv = v / box + 0.5;
  if (uv.x <= 0.004 || uv.x >= 0.996 || uv.y <= 0.004 || uv.y >= 0.996) return SPREAD_FRAC * box;
  vec2 tx = textureLod(uAtlas, cellUv(cell, uv), 0.0).rg;
  return (0.5 - (printed ? tx.r : tx.g)) * 2.0 * SPREAD_FRAC * box;
}
// a printed star's eyes (x) and outline (y), ink px; outside its cell it is far away
vec2 starField(float cell, vec2 v, float box) {
  vec2 uv = v / box + 0.5;
  if (uv.x <= 0.004 || uv.x >= 0.996 || uv.y <= 0.004 || uv.y >= 0.996) return vec2(1e3);
  vec2 tx = textureLod(uAtlas, cellUv(cell, uv), 0.0).rg;
  vec2 d = (0.5 - tx) * 2.0 * SPREAD_FRAC * box;
  if (tx.g < 0.02) d.y = 1e3;
  return d;
}
// two shapes joined with a fillet of k where they meet (a blade cannot turn a sharp inside corner)
float smin(float a, float b, float k) {
  float h = max(k - abs(a - b), 0.0) / max(k, 1e-4);
  return min(a, b) - h * h * k * 0.25;
}

// ---- the marker (DESIGN.md §8, the stroke). The hand at arc position tau: how far it strays, how wide the nib lies.
void hand(float tau, float P, float Tend, float seed, float turn, float nib, float hw0, float spk,
          out float wob, out float hw) {
  wob = 4.4 * (n1(tau / 150.0 + seed * 17.31) - 0.5) + 1.8 * (n1(tau / 41.0 + seed * 5.77) - 0.5)
    + 0.6 * (n1(tau / 11.0 + seed * 9.1) - 0.5);
  wob += 1.0 * sin(6.2831853 * 3.0 * tau / P + seed * 4.7);
  wob -= turn;
  // it does not close on itself: the end comes in wide of the start, crosses over it, and runs on a little
  wob += (3.2 * smoothstep(P - 80.0, P, tau) * (1.0 - 2.1 * smoothstep(P, Tend, tau))
    - 1.6 * (1.0 - smoothstep(0.0, 60.0, tau))) * (1.0 - spk);
  hw = hw0 * (0.87 + 0.26 * n1(tau / 57.0 + seed * 3.1)) * nib;
  hw *= 1.0 + 0.2 * (1.0 - smoothstep(0.0, 9.0, tau));
  hw *= mix(mix(0.5, 1.0, smoothstep(0.0, 26.0, Tend - tau)), 1.0, spk);
}
// the wet stretch: the nib while a line is drawn or wiped, the pass over it while work runs
float beadAt(vec4 A, float t, float P, float Tend) {
  if (A.w <= 0.001) return 0.0;
  float head = (A.x < 0.999) ? mod(A.x * Tend, P) : mod(A.z, P);
  float dl = mod(head - t + P, P);
  float nh = min(dl, P - dl);
  return A.w * (exp(-(nh * nh) / 170.0)
    + 0.7 * exp(-dl / 180.0) * (1.0 - smoothstep(0.5 * P, 0.8 * P, dl)));
}
// the ink film across the line: raised at both rims, streaked by the nib's fibres, broken where it ran dry
float film(float v, float x, float tau, float seed, float dry, out float fib, out float rim) {
  float av = abs(v);
  rim = exp(-sq((av - 0.86) / 0.11));
  float f1 = valueNoise(vec2(x / 2.2 + seed * 7.0, tau / 76.0));
  float f2 = valueNoise(vec2(x / 0.95 + seed * 3.0, tau / 29.0));
  fib = smoothstep(0.18, 0.82, 0.5 * f1 + 0.5 * f2);
  float gaps = mix(1.0, smoothstep(0.3, 0.52, 0.4 * f1 + 0.6 * f2 + 0.2 * rim - 0.14 * dry), dry);
  return (0.78 + 0.22 * rim) * (0.7 + 0.3 * fib) * gaps * (1.0 - smoothstep(0.92, 1.08, av));
}

void marker(int s, vec2 q, vec2 hb, float r, vec2 cs, float aa, float night, float sunD,
            float clock, inout vec4 acc, inout vec3 glow) {
  vec4 A = row(s, S_MOTION);
  if (A.x <= 0.0005) return;
  vec4 ink = row(s, S_INK);
  vec4 dp = row(s, S_DEEP);
  vec4 la = row(s, S_LEAN_A);
  vec4 lb = row(s, S_LEAN_B);
  vec4 hd = row(s, S_HAND);
  vec3 C = ink.rgb;
  vec3 deep = dp.rgb;
  vec3 Ia = la.rgb;
  vec3 Ib = lb.rgb;
  float level = ink.w;
  float seed = hd.x;
  float quiet = la.w;
  float op = hd.w;
  float hw0 = row(s, S_WIDTH).x;
  float gap = A.y;
  vec2 Bx = hb + gap;
  float R = r + gap;
  q.x += hd.y;
  float d = sdRoundBox(q, Bx, R);
  if (abs(d) > BAND_REACH) return;
  float P;
  float arc = arcS(q, Bx, R, P);
  float t = mod(arc - seamS(dp.w, hb, r, Bx, R) + P, P);
  float Tend = P + lb.w;
  float T1 = A.x * Tend;
  float day = 1.0 - night;

  // the far band: a plain thin line in the ink, drawn on as the stroke is
  if (hd.z > FORM_LINE - 0.5) {
    // (DESIGN.md §8 "Zoom": under 24 px on screen only a 2 px line remains)
    float lineVis = 1.0 - smoothstep(T1 - 1.5, T1 + 1.5, t);
    float lineA = (1.0 - smoothstep(-aa, aa, abs(d) - hw0)) * lineVis * op;
    vec3 lineC = mix(C, vec3(luma(C)) * 0.86 + C * 0.06, 0.74 * quiet) * mix(1.0, sunD, 0.55 * day);
    lay(acc, lineC, lineA);
    return;
  }

  float Rm = min(R, min(Bx.x, Bx.y));
  vec2 cw = abs(q) - (Bx - Rm);
  float bump = (cw.x > 0.0 && cw.y > 0.0) ? 2.0 * cw.x * cw.y / max(dot(cw, cw), 1e-3) : 0.0;
  float ci = (q.x > 0.0 ? 1.0 : 0.0) + (q.y > 0.0 ? 2.0 : 0.0);
  float turn = (hash11(seed * 7.3 + ci * 1.91) - 0.3) * 3.6 * bump;
  float spk = hd.z > FORM_STARLIGHT - 0.5 ? 1.0 : 0.0;
  vec2 Nl = gradRoundBox(q, Bx, R);
  vec2 Ns = vec2(cs.x * Nl.x - cs.y * Nl.y, cs.y * Nl.x + cs.x * Nl.y);
  // the nib is a chisel held at an angle: wider across it than along it
  float cr = 0.53 * Ns.y - 0.848 * Ns.x;
  float nib = (1.0 + 0.13 * (2.0 * cr * cr - 1.0)) * (1.0 + 0.08 * bump);
  float Ll = dot(Ns, TO_LIGHT);
  float shOff = dot(Ns, STROKE_SHADOW);
  float c0 = 0.0;
  float c1 = 0.0;
  float x0 = 0.0;
  float x1 = 0.0;
  float h0 = hw0;
  float h1 = hw0;
  float t0 = t;
  float t1 = t;
  float k0 = 0.5;
  float k1 = 0.5;
  float sh = 0.0;
  float gd = 60.0;
  for (int lap = 0; lap < 2; lap++) {
    float tau = t + float(lap) * P;
    if (tau > Tend + 2.0) continue;
    float wob;
    float hw;
    hand(tau, P, Tend, seed, turn, nib, hw0, spk, wob, hw);
    // a felt nib leaves no straight edge
    float ro = 0.5 * (n1(tau / 13.0 + seed * 11.0) - 0.5)
      + 0.42 * (n1(tau / 4.7 + seed * 31.0) - 0.5) + 0.26 * (n1(tau / 1.9 + seed * 53.0) - 0.5);
    float ri = 0.5 * (n1(tau / 12.0 + seed * 23.0) - 0.5)
      + 0.42 * (n1(tau / 4.3 + seed * 43.0) - 0.5) + 0.26 * (n1(tau / 2.1 + seed * 61.0) - 0.5);
    float vis = 1.0 - smoothstep(T1 - 1.5, T1 + 1.5, tau);
    float x = d - wob;
    // the tooth under the nib, in the stroke's own coordinates (across, along), never the screen's (DESIGN.md §8)
    float tooth = valueNoise(vec2(x, tau) / TOOTH);
    float e = (x > 0.0 ? x - (hw + ro) : -x - (hw + ri)) + (tooth - 0.5) * 0.5;
    float c = (1.0 - smoothstep(-aa, aa, e)) * vis;
    if (lap == 0) {
      c0 = c;
      x0 = x;
      h0 = hw;
      t0 = tau;
      k0 = tooth;
    } else {
      c1 = c;
      x1 = x;
      h1 = hw;
      t1 = tau;
      k1 = tooth;
    }
    sh = max(sh, (1.0 - smoothstep(-0.7, 1.7, abs(x - shOff) - hw)) * vis);
    gd = min(gd, mix(60.0, max(e, 0.0), vis));
  }
  float cov = 1.0 - (1.0 - c0) * (1.0 - c1);
  if (cov <= 0.001 && sh <= 0.001 && gd > 32.0) return;
  // where the loop closed, the later lap lies on top
  bool top = c1 > 0.02;
  float xs = top ? x1 : x0;
  float hws = top ? h1 : h0;
  float taus = top ? t1 : t0;
  float toothS = top ? k1 : k0;
  float twice = c0 * c1;
  float wet = beadAt(A, t, P, Tend);
  float w1 = clamp(wet, 0.0, 1.0);

  // where the nib ran dry: late in a long pull, and as it lifts; never at a corner, nor under the wet stretch
  float v = clamp(xs / max(hws, 0.5), -1.3, 1.3);
  float dry = smoothstep(0.5, 0.84, n1(taus / 160.0 + seed * 2.2));
  dry = max(dry, 0.9 * (1.0 - smoothstep(4.0, 34.0, Tend - taus)) * (1.0 - spk));
  dry *= (1.0 - 0.8 * bump) * (1.0 - clamp(wet * 1.6, 0.0, 1.0)) * smoothstep(10.0, 40.0, taus)
    * (1.0 - 0.7 * twice);
  float fib;
  float rim;
  float fa;
  float fb;
  float hC = film(v, xs, taus, seed, dry, fib, rim);
  float dv = 0.16;
  float hP = film(v + dv, xs + dv * hws, taus, seed, dry, fa, fb);
  float hM = film(v - dv, xs - dv * hws, taus, seed, dry, fa, fb);
  float slope = (hP - hM) / (2.0 * dv);
  // how much of the mat it hides: all of it at the rims, less through the middle, none where the nib skipped
  float opq = clamp(0.7 + 0.26 * fib + 0.14 * rim + 0.3 * twice + 0.3 * w1, 0.0, 1.0);
  float aT = (top ? c1 : cov) * smoothstep(0.02, 0.36, hC) * opq * (0.86 + 0.14 * toothS);
  float alpha = 1.0 - (1.0 - aT) * (1.0 - (top ? c0 * 0.9 : 0.0));

  // its colour: the ink, leaning through its neighbours as the film thins and the stroke turns; the rims stay true
  float dirPh = atan(Ns.y, Ns.x) / 6.2831853 + seed * 0.37;
  float ph = dirPh + 0.6 * (fib - 0.5) + 0.3 * n1(taus / 130.0 + seed * 8.3) + 0.1 * v;
  vec3 base = mix(C, irid(C, Ia, Ib, ph), 0.78 * IRID * (1.0 - 0.6 * rim));
  base *= 0.92 + 0.12 * fib + 0.03 * rim;
  base = mix(base, deep, 0.16 * twice * (1.0 - rim));
  // the film has a body: each rim has a flank toward the light and one away from it
  float rel = clamp(-slope * Ll * 0.5, -1.0, 1.0);
  float gloss = mix(0.1, 0.85, w1);
  vec3 inkC = base * (1.0 + 0.16 * max(rel, 0.0) * day);
  inkC = mix(inkC, deep, 0.42 * max(-rel, 0.0) * day);
  inkC *= mix(1.0, sunD, 0.55 * day);
  inkC += mix(vec3(1.0), irid(C, Ia, Ib, ph + 0.31), 0.6 * IRID) * pow(max(rel, 0.0), 1.5) * gloss
    * mix(sunD, 0.3, night);
  // wet: glossier, and the sheen runs through its colours along the line
  vec3 sheen = irid(C, Ia, Ib, ph + taus / 90.0 - clock * 0.45);
  inkC = mix(inkC, sheen * (0.96 + 0.14 * day * sunD), 0.55 * w1 * IRID);
  inkC += vec3(1.0) * 0.3 * smoothstep(0.8, 1.3, wet) * (1.0 - min(abs(v), 1.0))
    * mix(sunD, 0.5, night);
  // by night it is light, brightest where the ink is thickest
  vec3 lum = base * (0.66 + 0.46 * hC + 0.3 * w1) + vec3(1.0) * 0.05 * rim;
  inkC = mix(inkC, lum, night * clamp(0.35 + level, 0.0, 1.0));
  // the person's hand on it: matte and quiet
  inkC = mix(inkC, vec3(luma(inkC)) * 0.86 + base * 0.06, 0.74 * quiet);

  vec3 castC = mix(uCast, uCastNight, night);
  lay(acc, castC, sh * (1.0 - cov) * 0.46 * (1.0 - 0.7 * night) * op);
  lay(acc, inkC, alpha * op);

  // flecks in the ink that catch the light, a few at a time, by night only (DESIGN.md §5)
  vec2 cellp = floor(vec2(xs, taus) / FLECK);
  float hsh = hash12(cellp + seed * 13.0);
  float tw = 0.5 + 0.5 * sin(clock * (0.9 + 2.6 * fract(hsh * 17.0)) + hsh * 50.0);
  tw *= tw * tw;
  float catchL = 0.55 * night;
  glow += irid(C, Ia, Ib, hsh * 9.0) * step(0.945, hsh) * tw * alpha * catchL * (0.3 + 0.9 * w1)
    * IRID * (1.0 - quiet) * op;
  // its light (DESIGN.md §5): a tight lip and a wide glow, added; by day the edge stays crisp. It falls on the mat
  // alone: the overlay does not read ICE's lattice, so no line catches it more strongly (until item 553)
  float lip = pow(1.0 - linstep(0.0, 5.0, gd), 3.0);
  float spill = pow(1.0 - linstep(0.0, 30.0, gd), 4.0);
  vec3 fringe = mix(C, irid(C, Ia, Ib, dirPh + taus / 400.0 + 0.4), 0.5 * IRID);
  glow += (C * lip * 0.36 * mix(0.2, 1.0, night) + fringe * spill * 0.3 * mix(0.3, 1.0, night))
    * level * (1.0 + 1.8 * w1) * (1.0 - quiet) * op;
}

void bandFrag(int o, vec2 q, float aaCss, inout vec4 acc, inout vec3 glow) {
  vec4 frame = row(o, O_FRAME);
  vec4 turn = row(o, O_TURN);
  vec4 strokes = row(o, O_STROKES);
  float zs = max(turn.w, 0.1);
  vec2 hb = frame.zw / zs;
  float r = turn.z / zs;
  float night = uLight.x;
  float sunD = sunDOf(uLight.y);
  int n = int(strokes.x + 0.5);
  int first = int(strokes.y + 0.5);
  for (int k = 0; k < MOST; k++) {
    if (k >= n) break;
    marker(first + k, q, hb, r, turn.xy, aaCss / zs, night, sunD, strokes.z, acc, glow);
  }
}

// ---- the sticker (DESIGN.md §2.8): the agent's mark die-cut on foil in its ink, printed in the
// print ink, a paper edge, a cut line, a shadow, its own small angle; a count is paper alone; a spark's
// free star throws only its shadow
void seatFrag(int s, vec2 local, float aaCss, inout vec4 acc, inout vec3 glow) {
  vec4 place = row(s, E_PLACE);
  vec4 ink = row(s, E_INK);
  float pres = ink.w;
  if (pres <= 0.001) return;
  int o = int(place.z + 0.5);
  float form = place.w;
  vec4 turn = row(o, O_TURN);
  float zs = max(turn.w, 0.1);
  float aa = aaCss / zs;
  float clock = row(o, O_STROKES).z;
  float night = uLight.x;
  float gobo = uLight.y;
  float sunD = sunDOf(gobo);
  vec4 la = row(s, E_LEAN_A);
  vec4 lb = row(s, E_LEAN_B);
  vec4 hd = row(s, E_HAND);
  vec4 rg = row(s, E_RING);
  vec4 crew = row(s, E_CREW);
  vec2 v = local + vec2(hd.z, 0.0);
  if (dot(v, v) > SEAT_REACH * SEAT_REACH) return;
  float seed = hd.x;
  float cell = floor(hd.y + 0.5);
  float quiet = hd.w;
  float lift = la.w;
  float sweep = lb.w;
  float op = rg.z;
  float isCount = abs(form - SEAT_COUNT) < 0.5 ? 1.0 : 0.0;
  vec3 C = ink.rgb;
  vec3 Ia = la.rgb;
  vec3 Ib = lb.rgb;
  float show = clamp(pres * 1.7, 0.0, 1.0);
  vec3 castC = mix(uCast, uCastNight, night);

  // it asks for you: a ring leaves it every 2.4 s (its phase is the model's)
  if (rg.y > 0.001) {
    float rp = rg.x;
    float ring = (1.0 - smoothstep(0.7, 1.7, abs(length(v) - (14.0 + 24.0 * rp))))
      * (1.0 - rp) * (1.0 - rp) * rg.y * show;
    lay(acc, mix(C, vec3(1.0), 0.35), ring * 0.85);
    glow += C * ring * 0.6 * mix(0.45, 1.0, night);
  }
  if (form > SEAT_STAR - 0.5) {
    // a spark's own star is drawn by its stage over this layer; here is only the shadow it throws, a little off the
    // mat, once it is seated
    vec2 dd = v - vec2(1.4, 4.4) * (1.0 + 0.8 * lift);
    float blob = exp(-dot(dd, dd) / 103.7) * 0.36 * (1.0 - 0.4 * night) * show * rg.w;
    lay(acc, castC, blob);
    acc *= op;
    glow *= op;
    return;
  }
  // its own small angle, relaxed as it lifts
  float ang = (hash11(seed * 3.7) - 0.5) * 0.19 * (1.0 - 0.65 * lift);
  float ca = cos(ang);
  float sa = sin(ang);
  v = vec2(ca * v.x + sa * v.y, -sa * v.x + ca * v.y);
  float grow = mix(0.55, 1.0, min(pres, 1.25)) * (1.0 + 0.08 * lift);
  float box = STICKER * grow * CELL_UNITS;
  float reach = SPREAD_FRAC * box;
  float pad = FOIL * grow;
  float edge = EDGE * grow;
  vec2 so = vec2(0.6, 1.5) * (1.0 + 1.9 * lift);
  // the star it wears when a spark started it: on the mark's shoulder, part of the same sheet; it buds from the
  // mark's side, so the paper round the two is one sheet from the first frame
  float starCell = floor(crew.x + 0.5);
  float worn = (crew.x > -0.5 && isCount < 0.5) ? smoothstep(0.0, 0.3, crew.y) : 0.0;
  float sdStar = 1e3;
  float sdEye = 1e3;
  float sdStarS = 1e3;
  if (worn > 0.001) {
    float sbox = CREW_BOX * grow * mix(0.4, 1.0, crew.y);
    vec2 sc = crew.zw * grow * mix(0.55, 1.0, min(crew.y, 1.0));
    float ct = cos(CREW_TILT);
    float st = sin(CREW_TILT);
    float away = (1.0 - worn) * 10.0;
    vec2 sv = v - sc;
    sv = vec2(ct * sv.x + st * sv.y, -st * sv.x + ct * sv.y);
    vec2 sf = starField(starCell, sv, sbox);
    sdEye = sf.x;
    sdStar = sf.y + away;
    vec2 ss = v - so - sc;
    ss = vec2(ct * ss.x + st * ss.y, -st * ss.x + ct * ss.y);
    sdStarS = starField(starCell, ss, sbox).y + away;
  }
  float sdS = glyphField(cell, v - so, box, false);
  float sheetS = smin(sdS - pad, sdStarS, CREW_FILLET) - edge;
  float shadowFar = min(2.2 + 2.2 * lift, 0.94 * reach - pad - edge);
  float shadow = (1.0 - smoothstep(-1.2, shadowFar, sheetS)) * 0.38 * (1.0 - 0.45 * night) * show;
  lay(acc, castC, shadow);
  float sdB = glyphField(cell, v, box, false);
  float sdG = glyphField(cell, v, box, true);
  // one sheet of paper under both, and one cut round it
  float sheet = smin(sdB - pad, sdStar, CREW_FILLET) - edge;
  float cut = (1.0 - smoothstep(-aa, aa, sheet - CUT)) * show;
  lay(acc, uCut.rgb, cut * uCut.a);
  float back = (1.0 - smoothstep(-aa, aa, sheet)) * show;
  // the night's snow on the paper, in the sticker's own coordinates (a device pixel's cell), never the screen's
  float noise = hash12(floor(v * zs * max(uView.z, 1.0)) * 0.37 + seed);
  vec3 paper = litPaper(uPaper, gobo, night * 0.72, noise);
  lay(acc, paper, back);
  // a sticker lies over the ink's light, it does not shine through
  glow *= 1.0 - back;
  // the foil: the ink leaning across the sticker's face, one soft band of light on it and a second crossing it while
  // its agent works; where a star sits, the foil stands back from it by a little bare paper
  float sdF = -smin(pad - sdB, sdStar - CREW_CHAN * worn, 0.9);
  float body = (1.0 - smoothstep(-aa, aa, sdF)) * show * (1.0 - isCount);
  float across = dot(v, vec2(0.78, 0.62)) / (STICKER * grow * MARK_UNITS);
  float ph = across * 1.1 + seed * 0.61 + 0.05 * sin(clock * 0.7 + seed);
  vec3 foil = mix(C, irid(C, Ia, Ib, ph), 0.72 * IRID);
  foil += (vec3(1.0) - foil) * exp(-sq((across + 0.2) / 0.2)) * 0.22;
  float bandAt = mix(-1.0, 1.0, fract(clock * 0.42 + seed * 0.13));
  float band = exp(-sq((across - bandAt) / 0.14)) * sweep;
  foil = mix(foil, mix(vec3(1.0), irid(C, Ia, Ib, ph + 0.4), 0.4 * IRID), band * 0.8);
  // the print deepens a little toward its cut
  foil *= 1.0 - 0.16 * smoothstep(-1.4, 0.0, sdF);
  vec3 fc = mix(foil * mix(1.0, sunD, 0.5), mix(foil, vec3(1.0), 0.06), night);
  fc = mix(fc, vec3(luma(fc)) * 0.82, 0.75 * quiet);
  lay(acc, fc, body);
  float fill = (1.0 - smoothstep(-aa, aa, sdG)) * show;
  lay(acc, uPrint, fill * 0.95);
  glow += C * pow(1.0 - linstep(0.0, 5.0 * grow, max(sdB - pad, 0.0)), 3.0)
    * smoothstep(-0.5, 0.5, sdB - pad) * 0.24 * night * show * (1.0 - quiet) * (1.0 - isCount);
  // the star: foil in its own flat colour (S-2: a palette colours the star, nothing else), its eyes left as paper
  if (worn > 0.001) {
    vec3 Cs = row(s, E_CREW_INK).rgb;
    vec3 Sa = row(s, E_CREW_A).rgb;
    vec3 Sb = row(s, E_CREW_B).rgb;
    float star = (1.0 - smoothstep(-aa, aa, sdStar)) * show;
    vec3 sfoil = mix(Cs, irid(Cs, Sa, Sb, ph + 0.31), 0.45 * IRID);
    sfoil += (vec3(1.0) - sfoil) * exp(-sq((across + 0.2) / 0.2)) * 0.22;
    sfoil = mix(sfoil, mix(vec3(1.0), irid(Cs, Sa, Sb, ph + 0.71), 0.4 * IRID), band * 0.8);
    sfoil *= 1.0 - 0.16 * smoothstep(-1.2, 0.0, sdStar);
    vec3 sc2 = mix(sfoil * mix(1.0, sunD, 0.5), mix(sfoil, vec3(1.0), 0.06), night);
    sc2 = mix(sc2, vec3(luma(sc2)) * 0.82, 0.75 * quiet);
    lay(acc, sc2, star);
    // its eyes are bare paper by day; by night they stay lit, as the star's own are, with a little light round them
    float lit = night * (1.0 - 0.6 * quiet);
    float eyeM = (1.0 - smoothstep(-aa, aa, sdEye)) * star;
    lay(acc, vec3(1.0), exp(-max(sdEye, 0.0) / (0.5 * grow)) * 0.3 * lit * star * (1.0 - eyeM));
    lay(acc, mix(paper, EYE_NIGHT, lit), eyeM);
    glow += Sa * pow(1.0 - linstep(0.0, 4.0 * grow, max(sdStar, 0.0)), 3.0)
      * smoothstep(-0.5, 0.5, sdStar) * 0.2 * night * show * worn * (1.0 - quiet);
  }
  acc *= op;
  glow *= op;
}

// ---- the pencil: the overlay keeps off a band along the selection's brackets, so the pencil shows through
// (DESIGN.md §7): 2.5 px keeps off the 1.5 px pencil and its edge
float pencilMask(vec2 p, float aaCss) {
  if (uPencilBox.z <= 0.0) return 1.0;
  vec2 w = p - uPencilBox.xy;
  vec2 c = uPencilTurn.xy;
  vec2 l = vec2(c.x * w.x + c.y * w.y, -c.y * w.x + c.x * w.y);
  float d = sdRoundBox(l, uPencilBox.zw, uPencilTurn.z);
  float h = 0.5 * PENCIL_BAND;
  float outer = uPencilTurn.w + h;
  float inBand = smoothstep(-h - aaCss, -h, d) * (1.0 - smoothstep(outer, outer + aaCss, d));
  return 1.0 - inBand;
}

// ---- the hand's cover (2026-11-24): an object under the hand is not drawn where the object in hand lies over it
float handMask(int o, vec2 p, float aaCss) {
  if (uHandBox.z <= 0.0 || row(o, O_STROKES).w < 0.5) return 1.0;
  vec2 w = p - uHandBox.xy;
  vec2 c = uHandTurn.xy;
  vec2 l = vec2(c.x * w.x + c.y * w.y, -c.y * w.x + c.x * w.y);
  float d = sdRoundBox(l, uHandBox.zw, uHandTurn.z);
  return smoothstep(-aaCss, aaCss, d);
}

void main() {
  float dpr = max(uView.z, 1.0);
  // a close picture is the same desk seen larger, so its edges stay as fine
  float aaCss = dpr > 2.0 ? 1.5 / dpr : 0.5 + 0.5 / dpr;
  vec4 acc = vec4(0.0);
  vec3 glow = vec3(0.0);
  if (vKind == 0) {
    bandFrag(vRow, vLocal, aaCss, acc, glow);
  } else {
    seatFrag(vRow, vLocal, aaCss, acc, glow);
  }
  // light is added, as the laser's is: over this layer's own ink and paper a screen, over the desk added
  vec3 light = clamp(glow / (1.0 + 0.45 * glow), 0.0, 1.0);
  // a band piece's object is its row; a seat's is the row its place names
  int o = vKind == 0 ? vRow : int(row(vRow, E_PLACE).z + 0.5);
  fragOut = vec4(acc.rgb + light * (1.0 - acc.rgb), acc.a) * pencilMask(vScreen, aaCss)
    * handMask(o, vScreen, aaCss);
}
`;
