// THE PROJECT INK (DESIGN.md §2.9; PJ-L7, PJ-D5 (a)): the one map from a
// project's dealt number — `ink`, in [0, PROJECT_GROUPING.INK_DEALS) — to
// its colour. Only the HUE is the project's, and only the cool half of the
// OKLCH wheel is free: 350°→180° belongs to state (§2.5's red, orange,
// yellow, green) and 238°–265° to the selection (`--vf-select`). The deal
// walks the golden ratio across the two arcs that are left (180°–238°,
// 265°–350°), so neighbouring numbers never sit side by side. Lightness and
// chroma are the theme's tokens (`--vf-project-ink-l`, `--vf-project-ink-c`),
// so the CSS colour follows the theme by itself. Pure: no React, no DOM.

/** The arcs a project's hue is dealt on, in order (OKLCH degrees). */
export const PROJECT_INK_ARCS: ReadonlyArray<readonly [number, number]> = [
  [180, 238],
  [265, 350],
];

/** The theme's lightness and chroma (DESIGN.md §2.9), for a caller with no
 * CSS to read them from. */
export const PROJECT_INK_TONE: Readonly<Record<"light" | "dark", { l: number; c: number }>> = {
  light: { l: 0.6, c: 0.15 },
  dark: { l: 0.74, c: 0.15 },
};

const GOLDEN = 0.6180339887498949;
/** Where the walk starts: the PJ page's own `projectHue`, so its drawing and
 * the product's agree number for number. */
const START = 0.12;
const SPAN = PROJECT_INK_ARCS.reduce((sum, [from, to]) => sum + (to - from), 0);

/** The hue (OKLCH degrees) of a project's dealt number. A number that is not
 * a finite integer is read as its integer part, a negative one from 0. */
export function projectInkHue(ink: number): number {
  const seq = Number.isFinite(ink) ? Math.max(0, Math.trunc(ink)) : 0;
  let along = ((((START + seq * GOLDEN) % 1) + 1) % 1) * SPAN;
  for (const [from, to] of PROJECT_INK_ARCS) {
    if (along < to - from) return from + along;
    along -= to - from;
  }
  // only a rounding at the very end of the last arc lands here
  return PROJECT_INK_ARCS[PROJECT_INK_ARCS.length - 1]?.[1] ?? 0;
}

/** The project's colour as CSS: its hue on the theme's lightness and chroma.
 * It follows the theme (the tokens move under `.dark`), and the engine maps a
 * hue it cannot show into gamut by giving up chroma. */
export function projectInk(ink: number): string {
  return `oklch(var(--vf-project-ink-l) var(--vf-project-ink-c) ${projectInkHue(ink).toFixed(1)})`;
}

function oklchToLinearSrgb(l: number, c: number, hue: number): [number, number, number] {
  const angle = (hue * Math.PI) / 180;
  const a = c * Math.cos(angle);
  const b = c * Math.sin(angle);
  const l1 = l + 0.3963377774 * a + 0.2158037573 * b;
  const m1 = l - 0.1055613458 * a - 0.0638541728 * b;
  const s1 = l - 0.0894841775 * a - 1.291485548 * b;
  const L = l1 * l1 * l1;
  const M = m1 * m1 * m1;
  const S = s1 * s1 * s1;
  return [
    4.0767416621 * L - 3.3077115913 * M + 0.2309699292 * S,
    -1.2684380046 * L + 2.6097574011 * M - 0.3413193965 * S,
    -0.0041960863 * L - 0.7034186147 * M + 1.707614701 * S,
  ];
}

const inGamut = (rgb: readonly number[]): boolean =>
  rgb.every((channel) => channel >= -0.0005 && channel <= 1.0005);

const encode = (channel: number): number => {
  const clamped = Math.max(0, Math.min(1, channel));
  return clamped <= 0.0031308 ? 12.92 * clamped : 1.055 * clamped ** (1 / 2.4) - 0.055;
};

/** The project's colour as sRGB hex for a surface that cannot resolve CSS (a
 * WebGPU canvas): the theme's tone, and a hue sRGB cannot reach at that
 * chroma keeps its hue and lightness and gives up chroma until it fits. */
export function projectInkHex(ink: number, theme: "light" | "dark"): string {
  const { l, c } = PROJECT_INK_TONE[theme];
  const hue = projectInkHue(ink);
  let rgb = oklchToLinearSrgb(l, c, hue);
  if (!inGamut(rgb)) {
    let low = 0;
    let high = c;
    for (let step = 0; step < 24; step += 1) {
      const middle = (low + high) / 2;
      const candidate = oklchToLinearSrgb(l, middle, hue);
      if (inGamut(candidate)) {
        low = middle;
        rgb = candidate;
      } else high = middle;
    }
    if (!inGamut(rgb)) rgb = oklchToLinearSrgb(l, low, hue);
  }
  return `#${rgb
    .map((channel) =>
      Math.round(encode(channel) * 255)
        .toString(16)
        .padStart(2, "0"),
    )
    .join("")}`;
}
