// @vitest-environment node
/**
 * Item 550 (2026-11-18) — THE AT-WORK INK (DESIGN.md §2.6's second exception, §2.9 "On the mat: the at-work frame").
 * Whose work, never what: an agent's mark wears the colour Godview gives its project — `projectColour(seq,
 * DEFAULT_PROJECT_TINT.dark)`, L 0.74 and C 0.15, in both lights, the mat being dark under both — and its iridescent
 * leans walk 53.6° along the deal's own 333° wheel, through `projectHue`'s skip, so no lean lands in 238°–265° by the
 * pencil's blue (where a raw ±58° would). A run in no project wears `--vf-atwork-neutral` with the starlight's leans and
 * deep tone, a spark's line the `--vf-atwork-pearl` family, read from the root by the caller — tokens.css's own values
 * among them. GL takes linear light; the DOM form a CSS colour; the code holds no colour literal of any spelling. Red
 * first.
 */
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  DEFAULT_PROJECT_TINT,
  oklchToHex,
  projectColour,
  projectHue,
} from "@vibefield/puppeteer-view-sdk/toolkit";
import { describe, expect, it } from "vitest";
import {
  AT_WORK_INK,
  AT_WORK_INK_TOKENS,
  atWorkInk,
  DEAL_WHEEL,
  type InkTone,
  leanHue,
  neutralInkOf,
  projectInkOf,
  readAtWorkInks,
  starlightInkOf,
  toneOf,
} from "../src/field/desk/at-work/at-work-ink";

const PACKAGE_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

/** The sRGB transfer, written out here so the module's own is checked against the standard, not against itself. */
const linearOf = (channel255: number): number => {
  const c = channel255 / 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
};
/** A `#rrggbb` the toolkit answers, as its three channels. */
const channelsOf = (spelled: string): readonly [number, number, number] => [
  Number.parseInt(spelled.slice(1, 3), 16),
  Number.parseInt(spelled.slice(3, 5), 16),
  Number.parseInt(spelled.slice(5, 7), 16),
];
const toneFrom = (spelled: string): InkTone => {
  const [r, g, b] = channelsOf(spelled);
  return { encoded: [r / 255, g / 255, b / 255], linear: [linearOf(r), linearOf(g), linearOf(b)] };
};
const inBand = (hue: number): boolean => hue >= 238 && hue < 265;

/** A fixture theme's pearl family: any opaque colour reads (tokens.css's own are read below). */
const PEARL: Readonly<Record<string, string>> = {
  "--vf-atwork-neutral": "rgb(190 190 196)",
  "--vf-atwork-pearl": "rgb(240 236 226)",
  "--vf-atwork-pearl-deep": "rgb(140 126 160)",
  "--vf-atwork-pearl-rose": "rgb(240 200 220)",
  "--vf-atwork-pearl-aqua": "rgb(200 236 236)",
};
const pearl = (token: string): string => PEARL[token] ?? "";

/** tokens.css's `:root`, as written: a reader over it stands in for the root (as card-press.test.ts reads the press's). */
const TOKENS = readFileSync(join(PACKAGE_ROOT, "../design-kit/src/tokens.css"), "utf8");
function rootBlock(): string {
  const start = TOKENS.indexOf("\n:root {");
  return start < 0 ? "" : TOKENS.slice(start, TOKENS.indexOf("\n}", start));
}
function tokenOf(name: string): string {
  const value = new RegExp(`\\s${name}:\\s*([^;]+);`).exec(rootBlock())?.[1]?.trim() ?? "";
  const alias = /^var\((--[\w-]+)\)$/.exec(value)?.[1];
  return alias === undefined ? value : tokenOf(alias);
}

describe("a project's ink — Godview's colour", () => {
  it("wears Godview's own dark tint, L 0.74 and C 0.15, in both lights", () => {
    expect(AT_WORK_INK.base).toEqual(DEFAULT_PROJECT_TINT.dark);
    expect(AT_WORK_INK.base).toEqual({ l: 0.74, c: 0.15 });
  });

  it("is exactly the colour Godview deals the project: projectColour(seq, the dark tint)", () => {
    for (let seq = 0; seq < 24; seq += 1) {
      const godview = projectColour(seq, DEFAULT_PROJECT_TINT.dark);
      expect(projectInkOf(seq).css, `seq ${seq}`).toBe(godview);
      expect(projectInkOf(seq).id).toBe(`seq:${seq}`);
    }
  });

  it("hands GL linear light, and the sRGB-encoded floats the overlay's shader mixes in", () => {
    const seq = 3;
    expect(projectInkOf(seq).base).toEqual(toneFrom(projectColour(seq, DEFAULT_PROJECT_TINT.dark)));
    const grey = toneOf("rgb(128 128 128)");
    expect(grey?.encoded[0]).toBeCloseTo(128 / 255, 12);
    expect(grey?.linear[0]).toBeCloseTo(0.2158605, 6);
    // the transfer's linear toe
    expect(toneOf("rgb(10 10 10)")?.linear[0]).toBeCloseTo(10 / 255 / 12.92, 12);
  });

  it("deals each project's ink once: the same object every time", () => {
    expect(projectInkOf(7)).toBe(projectInkOf(7));
  });
});

describe("the leans — walked on the deal's own wheel", () => {
  it("holds the deal's wheel to the view SDK's projectHue: a full turn, and a walk of 10° that crosses nothing", () => {
    expect(DEAL_WHEEL.span).toBe(360 - 27);
    for (const seq of [0, 1, 2, 5, 11, 40]) {
      expect(leanHue(seq, 0), `seq ${seq}`).toBe(projectHue(seq));
      expect(leanHue(seq, DEAL_WHEEL.span), `seq ${seq}`).toBeCloseTo(projectHue(seq), 6);
    }
    // project 1 sits at 130.8°, far from the band and the wheel's end
    expect(leanHue(1, 10)).toBeCloseTo(projectHue(1) + 10, 9);
    expect(leanHue(1, -10)).toBeCloseTo(projectHue(1) - 10, 9);
  });

  it("walks 58° of the full wheel on the 333° one, held at DESIGN.md §2.9's 53.6", () => {
    expect((58 * DEAL_WHEEL.span) / 360).toBeCloseTo(53.65, 9);
    expect(AT_WORK_INK.walk).toBe(53.6);
  });

  it("never lands a lean in 238°–265°, where a raw ±58° of hue would for some projects", () => {
    let raw = 0;
    for (let seq = 0; seq < 400; seq += 1) {
      const hue = projectHue(seq);
      if (inBand((hue + 58) % 360) || inBand((hue + 302) % 360)) raw += 1;
      for (const walk of [AT_WORK_INK.walk, -AT_WORK_INK.walk]) {
        expect(inBand(leanHue(seq, walk)), `seq ${seq}, walk ${walk}`).toBe(false);
      }
    }
    expect(raw).toBeGreaterThan(0);
    // project 5 sits at 315°: 58° back is 257°, by the pencil; the walk skips the band to 234.4°
    expect(inBand(projectHue(5) - 58)).toBe(true);
    expect(leanHue(5, -AT_WORK_INK.walk)).toBeCloseTo(projectHue(5) - 27 - 53.6, 6);
  });

  it("deals lean A at L 0.82, lean B at L 0.80, both C 0.14, and the deep tone at L 0.50 C 0.14 on the project's hue", () => {
    expect(AT_WORK_INK.leanA).toEqual({ l: 0.82, c: 0.14 });
    expect(AT_WORK_INK.leanB).toEqual({ l: 0.8, c: 0.14 });
    expect(AT_WORK_INK.deep).toEqual({ l: 0.5, c: 0.14 });
    for (const seq of [0, 3, 5, 11]) {
      const ink = projectInkOf(seq);
      expect(ink.leanA).toEqual(toneFrom(oklchToHex(0.82, 0.14, leanHue(seq, 53.6))));
      expect(ink.leanB).toEqual(toneFrom(oklchToHex(0.8, 0.14, leanHue(seq, -53.6))));
      expect(ink.deep).toEqual(toneFrom(oklchToHex(0.5, 0.14, projectHue(seq))));
    }
  });
});

describe("the inks no project deals — read from the root", () => {
  it("wears the neutral token for a run in no project, the starlight's leans and deep tone its gloss, its CSS the token itself", () => {
    const starlight = starlightInkOf(pearl);
    if (starlight === null) throw new Error("the starlight did not read");
    const neutral = neutralInkOf(pearl("--vf-atwork-neutral"), starlight);
    if (neutral === null) throw new Error("the neutral did not read");
    expect(neutral.id).toBe("neutral");
    expect(neutral.base.encoded).toEqual([190 / 255, 190 / 255, 196 / 255]);
    expect([neutral.leanA, neutral.leanB, neutral.deep]).toEqual([
      starlight.leanA,
      starlight.leanB,
      starlight.deep,
    ]);
    // never a flat grey: its leans are not its base
    expect(neutral.leanA).not.toEqual(neutral.base);
    expect(neutral.css).toBe("var(--vf-atwork-neutral)");
    expect(atWorkInk(undefined, neutral)).toBe(neutral);
    expect(atWorkInk(4, neutral)).toBe(projectInkOf(4));
  });

  it("reads a spark's starlight from the pearl family: its rose lean A, its aqua lean B", () => {
    const starlight = starlightInkOf(pearl);
    if (starlight === null) throw new Error("the starlight did not read");
    expect(starlight.base).toEqual(toneOf("rgb(240 236 226)"));
    expect(starlight.deep).toEqual(toneOf("rgb(140 126 160)"));
    expect(starlight.leanA).toEqual(toneOf("rgb(240 200 220)"));
    expect(starlight.leanB).toEqual(toneOf("rgb(200 236 236)"));
    expect(starlight.css).toBe("var(--vf-atwork-pearl)");
  });

  it("reads no ink from a token that is missing or not an opaque colour, so the DOM form stands", () => {
    const starlight = starlightInkOf(pearl);
    if (starlight === null) throw new Error("the starlight did not read");
    expect(neutralInkOf("", starlight)).toBeNull();
    expect(neutralInkOf("rgb(1 2 3 / 50%)", starlight)).toBeNull();
    expect(neutralInkOf("var(--vf-atwork-neutral)", starlight)).toBeNull();
    const missing: Readonly<Record<string, string>> = { ...PEARL, "--vf-atwork-pearl-aqua": "" };
    expect(readAtWorkInks((token) => missing[token] ?? "")).toBeNull();
    const noNeutral: Readonly<Record<string, string>> = { ...PEARL, "--vf-atwork-neutral": "" };
    expect(readAtWorkInks((token) => noNeutral[token] ?? "")).toBeNull();
    const both = readAtWorkInks(pearl);
    expect(both?.neutral.id).toBe("neutral");
    expect(both?.starlight.id).toBe("starlight");
  });

  it("reads both inks from tokens.css's own root: every at-work token there, opaque", () => {
    for (const token of Object.values(AT_WORK_INK_TOKENS)) {
      expect(toneOf(tokenOf(token)), token).not.toBeNull();
    }
    const inks = readAtWorkInks(tokenOf);
    expect(inks).not.toBeNull();
    expect(inks?.neutral.base).toEqual(toneOf(tokenOf("--vf-atwork-neutral")));
    expect(inks?.starlight.base).toEqual(toneOf(tokenOf("--vf-atwork-pearl")));
  });

  it("names its tokens in the at-work namespace", () => {
    for (const token of Object.values(AT_WORK_INK_TOKENS)) expect(token).toMatch(/^--vf-atwork-/);
  });
});

describe("the at-work code", () => {
  it("holds no colour literal of any spelling: every colour is the toolkit's or a token's", () => {
    // the boundaries test's spelling of a colour literal (ui-system-boundaries.test.ts, UA-7)
    const COLOUR_LITERAL = /#[\da-f]{3,8}\b|\b(?:rgba?|hsla?|oklch|lab|lch)\(/i;
    const folder = join(PACKAGE_ROOT, "src", "field", "desk", "at-work");
    const modules = readdirSync(folder).filter((name) => name.endsWith(".ts"));
    // the folder this reads is the at-work code's own, whatever else lands in it later
    const ours = ["at-work-ink.ts", "at-work-rows.ts", "at-work-store.ts"];
    expect(modules).toEqual(expect.arrayContaining(ours));
    const offenders: string[] = [];
    for (const name of modules) {
      readFileSync(join(folder, name), "utf8")
        .split("\n")
        .forEach((line, index) => {
          if (COLOUR_LITERAL.test(line)) offenders.push(`${name}:${index + 1}`);
        });
    }
    expect(offenders).toEqual([]);
  });
});
