import { BACK_MARK } from "./back-mark";
import { PRESS_TOKENS } from "./press-numbers";

/**
 * THE PRESS'S COLOURS (DESIGN.md §5 "the press", "Its colours are tokens"; item 403): every colour the press prints
 * with is a token, read from the root as it stands when the press prints, so a print is made in its theme's own values
 * and the press's code holds no colour of its own. A token it cannot read, or that is not a colour, is no print: the
 * cards keep their flat stock.
 */

/** An sRGB colour, 0–255 a channel. */
export type Rgb = readonly [number, number, number];

export interface PressColours {
  /** the front's paper, and the back's margin */
  readonly paper: Rgb;
  /** the back's field */
  readonly field: Rgb;
  /** the back's one rule */
  readonly rule: Rgb;
  /** the band pressed into the back, as its token spells it (it carries its own alpha) */
  readonly deboss: string;
  /** each of the mark's lights, by its token, as the token spells it */
  readonly lights: ReadonlyMap<string, string>;
}

/** A colour as tokens.css spells one — `#rgb`, `#rrggbb`, `rgb(r g b)` or `rgb(r g b / a%)` — or null. PURE. */
export function colourOf(value: string): { readonly rgb: Rgb; readonly alpha: number } | null {
  const hex = /^#([\da-f]{3}|[\da-f]{6})$/i.exec(value)?.[1];
  if (hex !== undefined) {
    const full = hex.length === 3 ? [...hex].map((digit) => digit + digit).join("") : hex;
    const at = (from: number): number => Number.parseInt(full.slice(from, from + 2), 16);
    return { rgb: [at(0), at(2), at(4)], alpha: 1 };
  }
  const fn = /^rgb\(\s*(\d+)\s+(\d+)\s+(\d+)\s*(?:\/\s*([\d.]+)%)?\s*\)$/.exec(value);
  if (fn === null) return null;
  const rgb: Rgb = [Number(fn[1]), Number(fn[2]), Number(fn[3])];
  if (rgb.some((channel) => channel > 255)) return null;
  const alpha = fn[4] === undefined ? 1 : Number(fn[4]) / 100;
  return alpha >= 0 && alpha <= 1 ? { rgb, alpha } : null;
}

/** The press's colours, each read through `token`, or null when any is missing or not a colour. PURE but for `token`. */
export function pressColours(token: (name: string) => string): PressColours | null {
  const opaque = (name: string): Rgb | null => {
    const colour = colourOf(token(name).trim());
    return colour === null || colour.alpha !== 1 ? null : colour.rgb;
  };
  const spelled = (name: string): string | null => {
    const value = token(name).trim();
    return colourOf(value) === null ? null : value;
  };
  const paper = opaque(PRESS_TOKENS.paper);
  const field = opaque(PRESS_TOKENS.field);
  const rule = opaque(PRESS_TOKENS.rule);
  const deboss = spelled(PRESS_TOKENS.deboss);
  if (paper === null || field === null || rule === null || deboss === null) return null;
  const lights = new Map<string, string>();
  for (const [name] of BACK_MARK.lights) {
    const ink = spelled(name);
    if (ink === null) return null;
    lights.set(name, ink);
  }
  return { paper, field, rule, deboss, lights };
}

/** A token as the root holds it now, in its theme (an unregistered custom property: as written, a `var()` resolved). */
export function rootToken(name: string): string {
  if (typeof document === "undefined") return "";
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}
