import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { lampOn, normalOf, TURN } from "../src/frame/cards/lamp/turn";
import { PRESS } from "../src/frame/cards/press/press-numbers";

// THE FLOOR UNDER A CARD'S LIGHT (DESIGN.md §5 "The lamp, live", "How brightly"; §2.4; item 613, 2026-11-20). A
// card's light is the night's dim times the lamp's light on it, and CSS's `brightness()` multiplies the sRGB channels
// of the ground and of the ink alike. Turned from the lamp that product alone takes the face's words under 4.5:1 (by
// night a terminal's output falls to 2.96:1), so the stylesheet never takes it under `--vf-card-light-floor`. These
// rows are the witness, by arithmetic over the tokens and the stylesheet's own inks, since no still can stand a card
// at every turn. What they do not hold: the light the lamp ADDS over the ink turned toward it (the varnish's sheen),
// which is measured on a plate of its own.

const CARDS_CSS = readFileSync(join(process.cwd(), "src/frame/cards/cards.css"), "utf8");
const TOKENS = readFileSync(join(process.cwd(), "../design-kit/src/tokens.css"), "utf8");

type Rgb = readonly [number, number, number];

/** A rule's body in the hand's stylesheet. */
function rule(selector: string): string {
  const from = CARDS_CSS.indexOf(`${selector} {`);
  return from < 0 ? "" : CARDS_CSS.slice(from, CARDS_CSS.indexOf("}", from));
}

/** A token's value in one theme's block of tokens.css, as written, or "" where the block does not name it. */
function token(theme: ":root" | ".dark", name: string): string {
  const start = TOKENS.indexOf(`\n${theme} {`);
  if (start < 0) return "";
  const block = TOKENS.slice(start, TOKENS.indexOf("\n}", start));
  return new RegExp(`\\s${name}:\\s*([^;]+);`, "u").exec(block)?.[1]?.trim() ?? "";
}

const over = (top: Rgb, alpha: number, below: Rgb): Rgb => [
  top[0] * alpha + below[0] * (1 - alpha),
  top[1] * alpha + below[1] * (1 - alpha),
  top[2] * alpha + below[2] * (1 - alpha),
];

/** A colour as tokens.css spells one, `#rrggbb` or `rgb(r g b / a%)`, laid over what stands under it. */
function colour(value: string, under: Rgb): Rgb {
  const hex = /^#([\da-f]{6})$/iu.exec(value)?.[1];
  if (hex !== undefined) {
    const at = (from: number): number => Number.parseInt(hex.slice(from, from + 2), 16);
    return [at(0), at(2), at(4)];
  }
  const fn = /^rgb\(\s*(\d+)\s+(\d+)\s+(\d+)\s*(?:\/\s*([\d.]+)%)?\s*\)$/u.exec(value);
  const channel = (at: 1 | 2 | 3): number => Number(fn?.[at] ?? Number.NaN);
  const alpha = fn?.[4] === undefined ? 1 : Number(fn[4]) / 100;
  return over([channel(1), channel(2), channel(3)], alpha, under);
}

/** The ink a rule of the stylesheet wears, laid over its ground: the rule's own `color`, resolved to the tokens. */
function inkOf(selector: string, ground: Rgb, stock: "paper" | "dark" = "paper"): Rgb {
  const worn = /(?:^|[\s;{])color:\s*([^;]+);/u.exec(rule(selector))?.[1]?.trim() ?? "";
  const ink = stock === "dark" ? "--vf-card-dark-ink" : "--vf-card-stock-ink";
  const mixed = /^color-mix\(in srgb, var\(--card-ink\) (\d+)%, transparent\)$/u.exec(worn)?.[1];
  if (mixed !== undefined) {
    return over(colour(token(":root", ink), ground), Number(mixed) / 100, ground);
  }
  if (worn === "var(--card-ink)") return colour(token(":root", ink), ground);
  if (worn === "var(--card-ink-2)") return colour(token(":root", `${ink}-2`), ground);
  return colour(token(":root", /^var\((--vf-[\w-]+)\)$/u.exec(worn)?.[1] ?? "-"), ground);
}

/** WCAG 2's relative luminance of an sRGB colour whose channels a `brightness(m)` has multiplied. */
function luminance(rgb: Rgb, m: number): number {
  const linear = (channel: number): number => {
    const c = Math.min(255, channel * m) / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * linear(rgb[0]) + 0.7152 * linear(rgb[1]) + 0.0722 * linear(rgb[2]);
}

/** WCAG 2's contrast of an ink on its ground, both under a `brightness(m)`. */
function contrast(ground: Rgb, ink: Rgb, m: number): number {
  const [a, b] = [luminance(ground, m), luminance(ink, m)];
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

const BLACK: Rgb = [0, 0, 0];
const PAPER = colour(token(":root", "--vf-card-press-paper"), BLACK);
const PLATE = colour(token(":root", "--vf-card-plate"), PAPER);
/** The stock's foot, where the faces stand: the flat stock is darker there, by `--card-foot` at the most. */
const FOOT = over(BLACK, Number(/--card-foot:\s*([\d.]+);/u.exec(rule(".vf-card"))?.[1]), PAPER);
const DARK = colour(token(":root", "--vf-card-dark-stock"), BLACK);

/** The words the floor is for: every ink of a card's face that keeps 4.5:1 held flat (DESIGN.md §5 names them). */
const HELD: ReadonlyArray<{ readonly what: string; readonly ink: Rgb; readonly ground: Rgb }> = [
  { what: "the name", ink: inkOf(".vf-card-name", PAPER), ground: PAPER },
  { what: "the type's glyph", ink: inkOf(".vf-card-type", PAPER), ground: PAPER },
  { what: "the first face", ink: inkOf(".vf-card-faces > :first-child", FOOT), ground: FOOT },
  { what: "a text card's words", ink: inkOf(".vf-card-words", PLATE), ground: PLATE },
  { what: "a file's lines", ink: inkOf(".vf-card-lines", PLATE), ground: PLATE },
  { what: "a terminal's output", ink: inkOf(".vf-card-out", PLATE), ground: PLATE },
  { what: "a terminal's bold", ink: inkOf(".vf-card-out b", PLATE), ground: PLATE },
  { what: "the dark card's name", ink: inkOf(".vf-card-name", DARK, "dark"), ground: DARK },
  { what: "the dark card's state", ink: inkOf(".vf-card-state", DARK, "dark"), ground: DARK },
  // a terminal's summary line is words too, and reads as its output does (item 616)
  {
    what: "a terminal's summary line",
    ink: inkOf(".vf-card-out [data-quiet]", PLATE),
    ground: PLATE,
  },
];

/** The stock's marks, which §2.4 holds to 3:1: a prompt's `$`, and the other faces along the foot (item 616). */
const MARKS: ReadonlyArray<{ readonly what: string; readonly ink: Rgb; readonly ground: Rgb }> = [
  { what: "a prompt's $", ink: inkOf(".vf-card-prompt", PLATE), ground: PLATE },
  { what: "the other faces", ink: inkOf(".vf-card-faces", FOOT), ground: FOOT },
];
const OUTPUT = HELD[5] ?? { what: "", ink: BLACK, ground: BLACK };
const STATE = HELD[8] ?? { what: "", ink: BLACK, ground: BLACK };

const DIM = {
  day: Number(token(":root", "--vf-card-dim")),
  night: Number(token(".dark", "--vf-card-dim")),
};
/** The floor, as tokens.css has it: 0 where it has none, so a tree without it reads what the lamp alone does. */
const FLOOR = Number(token(":root", "--vf-card-light-floor"));

/** The turn's whole reach, as a grid of 61 by 61 turns. */
const REACH: ReadonlyArray<{ readonly x: number; readonly y: number }> = Array.from(
  { length: 61 * 61 },
  (_, at) => ({
    x: TURN.reach.x * (Math.floor(at / 61) / 30 - 1),
    y: TURN.reach.y * ((at % 61) / 30 - 1),
  }),
);

/** A card's light at a turn before any floor: the night's dim times the lamp's light on it. */
const lampAlone = (turn: { readonly x: number; readonly y: number }, night: boolean): number =>
  (night ? DIM.night : DIM.day) * lampOn(normalOf(turn), night);

/** The least contrast of an ink on its ground across the turn's whole reach, each turn at the light the stylesheet's
 * one filter gives it, `max(floor, dim × lamp)`. */
function least(ground: Rgb, ink: Rgb, night: boolean, floor: number): number {
  let low = Number.POSITIVE_INFINITY;
  for (const turn of REACH) {
    low = Math.min(low, contrast(ground, ink, Math.max(floor, lampAlone(turn, night))));
  }
  return low;
}

describe("the floor under a card's light (DESIGN.md §5 'The lamp, live'; item 613)", () => {
  it("is one token, 0.72, the same by day and by night, and both of the stylesheet's filters hold to it", () => {
    expect(token(":root", "--vf-card-light-floor")).toBe("0.72");
    expect(token(".dark", "--vf-card-light-floor")).toBe("");
    const lit =
      "filter: brightness(max(var(--vf-card-light-floor), var(--vf-card-dim) * var(--vf-cards-lamp, 1)));";
    expect(rule(".vf-card")).toContain(lit);
    expect(rule(".vf-card-back")).toContain(lit);
  });

  it("keeps every word it is for at 4.5:1 or more at every turn, by day and by night", () => {
    expect(HELD).toHaveLength(10);
    for (const { what, ink, ground } of HELD) {
      // each of them keeps it held flat, or the floor is not for it
      expect(contrast(ground, ink, 1), `${what}, flat`).toBeGreaterThanOrEqual(4.5);
      expect(least(ground, ink, false, FLOOR), `${what}, by day`).toBeGreaterThanOrEqual(4.5);
      expect(least(ground, ink, true, FLOOR), `${what}, by night`).toBeGreaterThanOrEqual(4.5);
    }
  });

  it("keeps the stock's marks at 3:1 or more at every turn, by day and by night (item 616)", () => {
    expect(MARKS).toHaveLength(2);
    for (const { what, ink, ground } of MARKS) {
      expect(contrast(ground, ink, 1), `${what}, flat`).toBeGreaterThanOrEqual(3);
      expect(least(ground, ink, false, FLOOR), `${what}, by day`).toBeGreaterThanOrEqual(3);
      expect(least(ground, ink, true, FLOOR), `${what}, by night`).toBeGreaterThanOrEqual(3);
    }
  });

  it("is set over the lightest of them with room to spare: a terminal's output, and the dark card's state", () => {
    // DESIGN.md quotes these two at the floor: 4.81:1 and 5.09:1
    expect(contrast(OUTPUT.ground, OUTPUT.ink, FLOOR)).toBeCloseTo(4.81, 1);
    expect(contrast(STATE.ground, STATE.ink, FLOOR)).toBeCloseTo(5.09, 1);
    expect(token(":root", "--vf-card-dark-ink-2")).toBe("rgb(255 255 255 / 70%)");
  });

  it("binds where the lamp alone would not hold them: by night, and by day in the corner turned from it", () => {
    expect(FLOOR).toBeGreaterThan(DIM.night * PRESS.ambient.night);
    expect(FLOOR).toBeGreaterThan(DIM.day * PRESS.ambient.day);
    expect(FLOOR).toBeLessThan(DIM.night);
    // the lamp alone: by night a terminal's output is far under §2.4's 4.5:1, by day it is on the line itself
    expect(least(OUTPUT.ground, OUTPUT.ink, true, 0)).toBeLessThan(3);
    expect(least(OUTPUT.ground, OUTPUT.ink, false, 0)).toBeLessThan(4.6);
  });

  it("moves nothing where it does not bind: at rest, toward the lamp, and by day but for the far corner", () => {
    const rest = { x: 0, y: 0 };
    const toward = { x: TURN.reach.x, y: TURN.reach.y };
    for (const night of [false, true]) {
      // at rest a card's light is the night's dim alone, and toward the lamp it is over 1: the floor is under both
      expect(lampAlone(rest, night)).toBeCloseTo(night ? DIM.night : DIM.day, 9);
      expect(Math.max(FLOOR, lampAlone(rest, night))).toBe(lampAlone(rest, night));
      expect(lampAlone(toward, night)).toBeGreaterThan(1);
      expect(Math.max(FLOOR, lampAlone(toward, night))).toBe(lampAlone(toward, night));
    }
    // by day it binds only where the card is turned down and left, from the lamp, and lifts it by 0.04 at the most
    const bound = REACH.filter((turn) => lampAlone(turn, false) < FLOOR);
    expect(bound.length).toBeGreaterThan(0);
    expect(bound.length / REACH.length).toBeLessThan(0.06);
    for (const turn of bound) {
      expect(turn.x).toBeLessThan(0);
      expect(turn.y).toBeLessThan(0);
      expect(FLOOR - lampAlone(turn, false)).toBeLessThanOrEqual(FLOOR - PRESS.ambient.day + 1e-9);
    }
    // by night it holds up the third of the reach turned from the lamp, and nothing of the rest
    const held = REACH.filter((turn) => lampAlone(turn, true) < FLOOR).length / REACH.length;
    expect(held).toBeGreaterThan(0.25);
    expect(held).toBeLessThan(0.35);
  });
});
