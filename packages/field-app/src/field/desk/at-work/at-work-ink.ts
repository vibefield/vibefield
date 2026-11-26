import {
  DEFAULT_PROJECT_TINT,
  oklchToHex,
  projectHue,
} from "@vibefield/puppeteer-view-sdk/toolkit";
import { colourOf } from "../../../frame/cards/press/press-colours";

// THE AT-WORK INK (item 550, 2026-11-18; DESIGN.md §2.6's second exception, §2.9 "On the mat: the at-work frame").
// Whose work it is, never what it is doing: an agent's stroke and sticker wear the colour Godview gives its project, in
// both lights, because the mat is a dark ground under both (DESIGN.md §2.1). So the base is Godview's own dark tint over
// Godview's own deal (`projectColour(seq, tint.dark)`), and the hue comes from the view SDK's `projectHue`, never a second
// copy of the deal.
//
// THE LEANS (§2.9 "The leans"). The ink's iridescence leans either way of the project's hue: 58° of the full wheel,
// walked along the deal's OWN wheel (333°, the full turn less the 27° round the pencil's blue) and brought back through
// `projectHue`, so no lean lands in 238°–265° — it skips that band exactly as the deal does. Lean A is lighter than lean
// B; the deep tone is the project's hue, darker.
//
// NO COLOUR IS WRITTEN HERE. The numbers below are lightness and chroma (§2.9); every colour is computed by the toolkit
// or read from a root token by the caller (`--vf-atwork-neutral` for a run in no project, the `--vf-atwork-pearl` family
// for a spark's starlight), as the press reads its colours (`press-colours.ts`). GL takes the linear-light floats; the
// DOM form takes `css`.

/** Item 550 (2026-11-18): the ink's lightness and chroma, and the leans' walk (DESIGN.md §2.9). */
export const AT_WORK_INK = {
  /** Godview's own dark tint, L 0.74 and C 0.15 */
  base: DEFAULT_PROJECT_TINT.dark,
  leanA: { l: 0.82, c: 0.14 },
  leanB: { l: 0.8, c: 0.14 },
  deep: { l: 0.5, c: 0.14 },
  /** each lean walks this far along the deal's wheel, one way and the other: 58° of the full 360 on the 333° wheel
   * (53.65), held at DESIGN.md §2.9's 53.6 */
  walk: 53.6,
} as const;

/** The deal's wheel, as the view SDK's `projectHue` walks it (view-sdk 0.4.2 toolkit/colour.js): the full turn less the
 * 27° band, one project a golden step along it. The toolkit does not export these two numbers, so they are restated
 * here, and the ink's test holds them to `projectHue` itself. */
export const DEAL_WHEEL = { span: 333, golden: 0.6180339887498949 } as const;

/** The root tokens the ink reads (DESIGN.md first, then tokens.css). */
export const AT_WORK_INK_TOKENS = {
  neutral: "--vf-atwork-neutral",
  pearl: "--vf-atwork-pearl",
  pearlDeep: "--vf-atwork-pearl-deep",
  pearlRose: "--vf-atwork-pearl-rose",
  pearlAqua: "--vf-atwork-pearl-aqua",
} as const;

/** Red, green and blue, 0–1 a channel. */
export type Rgb01 = readonly [number, number, number];

/** One tone of an ink, in the two spaces a drawing may want. */
export interface InkTone {
  /** linear light, ready for GL's blending */
  readonly linear: Rgb01;
  /** sRGB-encoded, the space the overlay's shader mixes in (its uniforms are encoded sRGB) */
  readonly encoded: Rgb01;
}

/** An ink: its base, its two leans and its deep tone, and its CSS colour for the DOM form. */
export interface AtWorkInk {
  /** what it is, for a model that eases from one ink to another: `seq:<n>`, `neutral` or `starlight` */
  readonly id: string;
  readonly base: InkTone;
  readonly leanA: InkTone;
  readonly leanB: InkTone;
  readonly deep: InkTone;
  /** the DOM form's stroke colour: the computed colour, or the token itself */
  readonly css: string;
}

/** The two inks no project deals, read from the root by the caller. */
export interface AtWorkInks {
  /** a run in no project (or not dealt yet): the neutral pearl grey, never paused's matte grey */
  readonly neutral: AtWorkInk;
  /** a spark's own line: starlight, the material's own pearl (S-2 kept) */
  readonly starlight: AtWorkInk;
}

/** One sRGB channel, 0–1, to linear light. */
const toLinear = (encoded: number): number =>
  encoded <= 0.04045 ? encoded / 12.92 : ((encoded + 0.055) / 1.055) ** 2.4;

/** A tone from a colour as the toolkit or a token spells it, or null when it is not an opaque colour. PURE. */
export function toneOf(spelled: string): InkTone | null {
  const colour = colourOf(spelled.trim());
  if (colour === null || colour.alpha !== 1) return null;
  const [r, g, b] = colour.rgb;
  const encoded: Rgb01 = [r / 255, g / 255, b / 255];
  return { encoded, linear: [toLinear(encoded[0]), toLinear(encoded[1]), toLinear(encoded[2])] };
}

/** The hue `walk` degrees along the deal's own wheel from project `seq`'s, through `projectHue`'s skip: it never lands
 * in the withheld band. `leanHue(seq, 0)` is the project's own hue. PURE. */
export function leanHue(seq: number, walk: number): number {
  return projectHue(seq + walk / (DEAL_WHEEL.golden * DEAL_WHEEL.span));
}

/** A colour as the toolkit's `oklchToHex` answers it (always six hex digits after its mark, view-sdk 0.4.2
 * colour.js), as a tone. */
function dealtTone(spelled: string): InkTone {
  const channel = (at: number): number =>
    Number.parseInt(spelled.slice(1 + at * 2, 3 + at * 2), 16) / 255;
  const encoded: Rgb01 = [channel(0), channel(1), channel(2)];
  return { encoded, linear: [toLinear(encoded[0]), toLinear(encoded[1]), toLinear(encoded[2])] };
}

/** The toolkit's colour for an OKLCH lightness, chroma and hue (a hue out of gamut gives up chroma, as Godview's). */
const oklchTone = (l: number, c: number, hue: number): InkTone => dealtTone(oklchToHex(l, c, hue));

const dealt = new Map<number, AtWorkInk>();

/** Project `seq`'s ink, Godview's colour at the base (memoised per `seq`: the same object every time). PURE. */
export function projectInkOf(seq: number): AtWorkInk {
  const known = dealt.get(seq);
  if (known !== undefined) return known;
  const hue = projectHue(seq);
  const { base, leanA, leanB, deep, walk } = AT_WORK_INK;
  const css = oklchToHex(base.l, base.c, hue);
  const ink: AtWorkInk = {
    id: `seq:${seq}`,
    base: dealtTone(css),
    leanA: oklchTone(leanA.l, leanA.c, leanHue(seq, walk)),
    leanB: oklchTone(leanB.l, leanB.c, leanHue(seq, -walk)),
    deep: oklchTone(deep.l, deep.c, hue),
    css,
  };
  dealt.set(seq, ink);
  return ink;
}

/** The neutral ink from `--vf-atwork-neutral` as the root spells it, or null when it is not an opaque colour. It keeps
 * its gloss and its leans — the starlight's leans and deep tone — so it is never your hand's matte grey (DESIGN.md §2.9
 * "No project"). PURE. */
export function neutralInkOf(spelled: string, starlight: AtWorkInk): AtWorkInk | null {
  const base = toneOf(spelled);
  if (base === null) return null;
  return {
    id: "neutral",
    base,
    leanA: starlight.leanA,
    leanB: starlight.leanB,
    deep: starlight.deep,
    css: `var(${AT_WORK_INK_TOKENS.neutral})`,
  };
}

/** The spark's starlight from the pearl tokens as the root spells them, or null when one is missing. PURE but for
 * `read`. Lean A is the rose, lean B the aqua (DESIGN.md §2.10 "the starlight line"). */
export function starlightInkOf(read: (token: string) => string): AtWorkInk | null {
  const base = toneOf(read(AT_WORK_INK_TOKENS.pearl));
  const deep = toneOf(read(AT_WORK_INK_TOKENS.pearlDeep));
  const leanA = toneOf(read(AT_WORK_INK_TOKENS.pearlRose));
  const leanB = toneOf(read(AT_WORK_INK_TOKENS.pearlAqua));
  if (base === null || deep === null || leanA === null || leanB === null) return null;
  return { id: "starlight", base, leanA, leanB, deep, css: `var(${AT_WORK_INK_TOKENS.pearl})` };
}

/** Both inks no project deals, read through `read` (the root, `rootToken`), or null when any token is missing: then the
 * GL form cannot draw, and the DOM form stands. PURE but for `read`. */
export function readAtWorkInks(read: (token: string) => string): AtWorkInks | null {
  const starlight = starlightInkOf(read);
  if (starlight === null) return null;
  const neutral = neutralInkOf(read(AT_WORK_INK_TOKENS.neutral), starlight);
  return neutral === null ? null : { neutral, starlight };
}

/** A run's ink: its project's when Godview has dealt it one, else the neutral (item 550, 2026-11-18; at PJ-5 the
 * model switches to `project.ink`, DESIGN.md §2.9). PURE. */
export function atWorkInk(seq: number | undefined, neutral: AtWorkInk): AtWorkInk {
  return seq === undefined ? neutral : projectInkOf(seq);
}
