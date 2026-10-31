// The Setup Assistant's glass as the field draws it (track FG, FG-3b; FG-D24; DESIGN.md §5, §8 "The Setup
// Assistant's glass"). Its recipe is read off its CSS layers' computed style, so DESIGN.md's tokens stay the one
// authority for both glasses: the browser's over the field's still, and the field's own over the live field. Where
// it stands and how far it has formed are read off the glass whenever either moves. Both cross to the field's
// worker as plain numbers, and glass-pass.ts draws them.

/** A colour as the browser resolves it: r, g, b and alpha, 0 … 1, not premultiplied. */
export type Rgba = readonly [number, number, number, number];

/** One of the glass's outer shadows, as CSS's box-shadow gives it (glass px). */
export interface GlassShadow {
  readonly color: Rgba;
  readonly x: number;
  readonly y: number;
  readonly blur: number;
  readonly spread: number;
}

/** What the glass's CSS layers draw at full frost (wizard-ui.css; DESIGN.md §5, the Setup Assistant). */
export interface GlassLook {
  /** the frost's tint, `--vf-wizard-surface` as its layer resolves it */
  readonly tint: Rgba;
  /** the frost's blur, CSS px (the blur's standard deviation), `--vf-wizard-blur` */
  readonly blur: number;
  /** the frost's saturation, `--vf-wizard-saturate` */
  readonly saturate: number;
  /** the grain's opacity, `--vf-wizard-grain` */
  readonly grain: number;
  /** the glass's corner, glass px */
  readonly radius: number;
  /** its shadow on the field, in CSS's order: the first listed lies over the second */
  readonly shadows: readonly GlassShadow[];
  /** the logo wears `invert(1) hue-rotate(180deg)` (`--vf-wizard-logo-filter`, milk's), its colours kept */
  readonly logoInvert: boolean;
}

/** Where the glass stands on the field's canvas (CSS px from its top left), and how far it has formed. */
export interface GlassPose {
  /** its centre */
  readonly x: number;
  readonly y: number;
  /** its laid-out size, glass px (880 × 640) */
  readonly w: number;
  readonly h: number;
  /** CSS px a glass px: the fit (FG-L2) */
  readonly fit: number;
  /** `--vf-glass-frost`, 0 … 1 */
  readonly frost: number;
  /** `--vf-glass-rise` */
  readonly rise: number;
  /** `--vf-glass-logo`, 0 … 1: the logo, which only fades (FG-4b) */
  readonly logo: number;
}

/** The glass as the field draws it: its recipe, and where it stands. */
export interface GlassState {
  readonly look: GlassLook;
  readonly pose: GlassPose;
}

/** The glass's elements whose computed style is its recipe (wizard-ui.tsx draws them). */
export interface GlassLayers {
  /** the glass itself (`.vf-wizard-shell`): its corner, the tokens it inherits, and its forming */
  readonly glass: Element;
  /** the layer whose box-shadow is the glass's shadow */
  readonly shadow: Element;
  /** the frost, whose ::after is its tint */
  readonly frost: Element;
  /** the logo's own layer (the still mark), whose filter is the logo's */
  readonly logo: Element;
}

/** At most two shadows, as the field's pass draws them (DESIGN.md §5: `--vf-shadow-wizard-field` has two). */
export const GLASS_SHADOWS = 2;

const NUMBER = String.raw`-?(?:\d+\.?\d*|\.\d+)`;
const RGBA = new RegExp(
  String.raw`^rgba?\((${NUMBER}), (${NUMBER}), (${NUMBER})(?:, (${NUMBER}))?\)$`,
  "u",
);
const SHADOW = new RegExp(
  String.raw`^(rgba?\([^)]*\)) (${NUMBER})px (${NUMBER})px (${NUMBER})px (${NUMBER})px$`,
  "u",
);
const PX = new RegExp(`^(${NUMBER})px$`, "u");
const PLAIN = new RegExp(`^(${NUMBER})$`, "u");

/** A computed colour as the browser serializes it, `rgb(r, g, b)` or `rgba(r, g, b, a)`. Anything else (another
 * colour space) is null, so the field never draws a colour it misread: the browser keeps the glass. */
export function parseRgba(css: string): Rgba | null {
  const m = css.trim().match(RGBA);
  if (m === null) return null;
  const alpha = m[4] === undefined ? 1 : Number(m[4]);
  return [Number(m[1]) / 255, Number(m[2]) / 255, Number(m[3]) / 255, alpha];
}

/** A computed box-shadow, its shadows in CSS's order: each a colour and four lengths, as the browser serializes
 * them. An inset, or any form the field's pass doesn't draw, is null. */
export function parseShadows(css: string): GlassShadow[] | null {
  const value = css.trim();
  if (value === "none" || value === "") return [];
  const shadows: GlassShadow[] = [];
  for (const part of topLevel(value)) {
    const m = part.trim().match(SHADOW);
    const color = m === null ? null : parseRgba(m[1] ?? "");
    if (m === null || color === null) return null;
    shadows.push({
      color,
      x: Number(m[2]),
      y: Number(m[3]),
      blur: Number(m[4]),
      spread: Number(m[5]),
    });
  }
  return shadows;
}

/** A length in px, as a token or a computed style gives one; null for any other unit. */
export function parsePx(css: string): number | null {
  const m = css.trim().match(PX);
  return m === null ? null : Number(m[1]);
}

/** A plain number, as a token gives one. */
export function parseNumber(css: string): number | null {
  const m = css.trim().match(PLAIN);
  return m === null ? null : Number(m[1]);
}

/** The glass's recipe, read off its layers' computed style. Null when any of it can't be read, and then the field
 * draws no glass: the browser keeps drawing it whole. */
export function readGlassLook(
  { glass, shadow, frost, logo }: GlassLayers,
  style: typeof getComputedStyle = getComputedStyle,
): GlassLook | null {
  const own = style(glass);
  const token = (name: string): string => own.getPropertyValue(name);
  const tint = parseRgba(style(frost, "::after").backgroundColor);
  const blur = parsePx(token("--vf-wizard-blur"));
  const saturate = parseNumber(token("--vf-wizard-saturate"));
  const grain = parseNumber(token("--vf-wizard-grain"));
  const radius = parsePx(own.borderTopLeftRadius);
  const shadows = parseShadows(style(shadow).boxShadow);
  // the tokens give the logo one filter or none, so any filter is that one (the draft page's rule)
  const filter = style(logo).filter.trim();
  if (
    tint === null ||
    blur === null ||
    saturate === null ||
    grain === null ||
    radius === null ||
    shadows === null ||
    shadows.length > GLASS_SHADOWS
  )
    return null;
  return {
    tint,
    blur,
    saturate,
    grain,
    radius,
    shadows,
    logoInvert: filter !== "" && filter !== "none",
  };
}

/** Where the glass stands on the field's canvas, `field` being the canvas's box, and how far it has formed: its box
 * as laid out (the fit is an ancestor's scale; the rise scales its layers, never the glass, so its box holds the fit
 * alone), and the frost, the rise and the logo as they are this frame, since its forming and the logo's fades
 * animate them on it (wizard-ui.css). */
export function readGlassPose(
  glass: HTMLElement,
  field: DOMRectReadOnly,
  style: typeof getComputedStyle = getComputedStyle,
): GlassPose {
  const box = glass.getBoundingClientRect();
  const own = style(glass);
  const w = glass.offsetWidth;
  const h = glass.offsetHeight;
  const frost = parseNumber(own.getPropertyValue("--vf-glass-frost")) ?? 1;
  const logo = parseNumber(own.getPropertyValue("--vf-glass-logo")) ?? 0;
  return {
    x: box.left + box.width / 2 - field.left,
    y: box.top + box.height / 2 - field.top,
    w,
    h,
    fit: w > 0 && box.width > 0 ? box.width / w : 1,
    frost: Math.min(1, Math.max(0, frost)),
    rise: parseNumber(own.getPropertyValue("--vf-glass-rise")) ?? 1,
    logo: Math.min(1, Math.max(0, logo)),
  };
}

/** Two poses the field draws alike. */
export function samePose(a: GlassPose, b: GlassPose): boolean {
  return (
    a.x === b.x &&
    a.y === b.y &&
    a.w === b.w &&
    a.h === b.h &&
    a.fit === b.fit &&
    a.frost === b.frost &&
    a.rise === b.rise &&
    a.logo === b.logo
  );
}

/** A list's top-level items: commas inside a colour's parentheses don't split it. */
function topLevel(list: string): string[] {
  const items: string[] = [];
  let depth = 0;
  let from = 0;
  for (let i = 0; i < list.length; i++) {
    const c = list[i];
    if (c === "(") depth++;
    else if (c === ")") depth--;
    else if (c === "," && depth === 0) {
      items.push(list.slice(from, i));
      from = i + 1;
    }
  }
  items.push(list.slice(from));
  return items;
}
