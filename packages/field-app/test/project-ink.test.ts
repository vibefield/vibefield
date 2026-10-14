// @vitest-environment node

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { PROJECT_GROUPING } from "@vibefield/contracts";
import {
  PROJECT_INK_ARCS,
  PROJECT_INK_TONE,
  projectInk,
  projectInkHex,
  projectInkHue,
} from "@vibefield/design-kit/project-ink";
import { describe, expect, it } from "vitest";

// DESIGN.md §2.9 — the project ink, the cool half (PJ-L7; A-D2: the host
// hands History's room a colour mapped from `ink` by the design kit). What a
// review cannot see by eye is pinned here, over EVERY deal fieldd can make:
// the hue never lands in state's half or the selection's band, the tone is
// the theme's (tokens.css, both themes), every ink clears 3:1 as a mark in
// both themes, and the hex a canvas takes keeps the hue it was dealt.

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const TOKENS = readFileSync(join(REPO, "packages/design-kit/src/tokens.css"), "utf8");
const DESIGN = readFileSync(join(REPO, "DESIGN.md"), "utf8");

const DEALS = Array.from({ length: PROJECT_GROUPING.INK_DEALS }, (_, ink) => ink);

/* ── colour arithmetic (OKLab, WCAG) ───────────────────────────────────── */

const linear = (channel: number): number => {
  const c = channel / 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
};
const rgbOf = (hex: string): [number, number, number] => {
  const n = Number.parseInt(hex.slice(1), 16);
  return [linear((n >> 16) & 255), linear((n >> 8) & 255), linear(n & 255)];
};
const luminance = (hex: string): number => {
  const [r, g, b] = rgbOf(hex);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const contrast = (a: string, b: string): number => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
};
/** a hex colour's OKLCH (lightness, chroma, hue in degrees) */
const oklch = (hex: string): { l: number; c: number; h: number } => {
  const [r, g, b] = rgbOf(hex);
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  const L = 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s;
  const A = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s;
  const B = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s;
  return { l: L, c: Math.hypot(A, B), h: ((Math.atan2(B, A) * 180) / Math.PI + 360) % 360 };
};
const around = (a: number, b: number): number => {
  const d = Math.abs(a - b) % 360;
  return Math.min(d, 360 - d);
};
/** a token's hex in tokens.css's light block */
const token = (name: string): string => {
  const found = new RegExp(`${name}:\\s*(#[0-9a-fA-F]{6})`).exec(TOKENS);
  if (found?.[1] === undefined) throw new Error(`no ${name} in tokens.css`);
  return found[1];
};

describe("DESIGN.md §2.9 — every deal's hue is on the cool half", () => {
  it("lands every one of the 997 deals on the two arcs: never state's half, never the selection's band", () => {
    expect(PROJECT_INK_ARCS).toEqual([
      [180, 238],
      [265, 350],
    ]);
    for (const ink of DEALS) {
      const hue = projectInkHue(ink);
      const onAnArc = PROJECT_INK_ARCS.some(([from, to]) => hue >= from && hue <= to);
      expect(onAnArc, `ink ${ink} → ${hue.toFixed(1)}°`).toBe(true);
    }
  });

  it("keeps clear of §2.5's state hues and the selection, measured from the tokens themselves", () => {
    const state = ["--vf-red", "--vf-orange", "--vf-yellow", "--vf-green"].map(
      (name) => oklch(token(name)).h,
    );
    const select = oklch(token("--vf-select")).h;
    let nearestState = 360;
    let nearestSelect = 360;
    for (const ink of DEALS) {
      const hue = projectInkHue(ink);
      for (const h of state) nearestState = Math.min(nearestState, around(hue, h));
      nearestSelect = Math.min(nearestSelect, around(hue, select));
    }
    // green (147°) to the band's edge at 180°, red (28°) to 350°
    expect(nearestState).toBeGreaterThan(32);
    expect(nearestSelect).toBeGreaterThan(12);
  });

  it("walks the golden ratio — the PJ page's own projectHue, number for number — so neighbours never sit side by side", () => {
    // 0.12 · 143° = 17.16° along the first arc
    expect(projectInkHue(0)).toBeCloseTo(197.16, 2);
    // (0.12 + φ) mod 1 = 0.738… · 143° = 105.54° → 47.54° into the second arc
    expect(projectInkHue(1)).toBeCloseTo(312.54, 1);
    for (let ink = 0; ink + 1 < PROJECT_GROUPING.INK_DEALS; ink += 1) {
      expect(around(projectInkHue(ink), projectInkHue(ink + 1)), `ink ${ink}`).toBeGreaterThan(30);
    }
  });

  it("reads a number that is not a deal as the nearest one it could be, never a hue off the arcs", () => {
    for (const odd of [-3, 2.7, Number.NaN, Number.POSITIVE_INFINITY, 1e9]) {
      const hue = projectInkHue(odd);
      expect(PROJECT_INK_ARCS.some(([from, to]) => hue >= from && hue <= to)).toBe(true);
    }
    expect(projectInkHue(2.7)).toBe(projectInkHue(2));
  });
});

describe("DESIGN.md §2.9 — the tone is the theme's, in both themes", () => {
  it("projects the theme's lightness and chroma into tokens.css, the dark block moving lightness only", () => {
    const light =
      /:root\s*\{[\s\S]*?--vf-project-ink-l:\s*([\d.]+);[\s\S]*?--vf-project-ink-c:\s*([\d.]+);/.exec(
        TOKENS,
      );
    const dark = /\.dark\s*\{[\s\S]*?--vf-project-ink-l:\s*([\d.]+);/.exec(TOKENS);
    expect(Number(light?.[1])).toBe(PROJECT_INK_TONE.light.l);
    expect(Number(light?.[2])).toBe(PROJECT_INK_TONE.light.c);
    expect(Number(dark?.[1])).toBe(PROJECT_INK_TONE.dark.l);
    expect(PROJECT_INK_TONE.dark.c).toBe(PROJECT_INK_TONE.light.c);
    // DESIGN.md says the same numbers first (UI_SYSTEM: the doc, then the tokens)
    expect(DESIGN).toContain("`--vf-project-ink-l` **0.60** by day and **0.74** by night");
    expect(DESIGN).toContain("`--vf-project-ink-c` **0.15** in both");
  });

  it("answers CSS that follows the theme on its own: the hue on the tokens", () => {
    expect(projectInk(0)).toBe("oklch(var(--vf-project-ink-l) var(--vf-project-ink-c) 197.2)");
  });

  it("every ink clears 3:1 as a mark — by day against white and the inset fill, by night against the chrome — and never 4.5:1 by day, so an ink is never text", () => {
    const grounds = {
      light: ["#ffffff", token("--vf-fill")],
      dark: ["#1c1c1e", "#2c2c2e", "#000000"],
    } as const;
    for (const theme of ["light", "dark"] as const) {
      let lowest = Number.POSITIVE_INFINITY;
      let highest = 0;
      for (const ink of DEALS) {
        const hex = projectInkHex(ink, theme);
        for (const ground of grounds[theme]) {
          const ratio = contrast(hex, ground);
          lowest = Math.min(lowest, ratio);
          highest = Math.max(highest, ratio);
        }
      }
      // DESIGN.md §2.9's measured ranges: 3.3–4.3:1 by day, 5.6–9.7:1 by night
      expect(lowest, theme).toBeGreaterThan(theme === "light" ? 3.3 : 5.6);
      expect(highest, theme).toBeLessThan(theme === "light" ? 4.5 : 9.8);
    }
  });

  it("the hex a canvas takes keeps its dealt hue and the theme's lightness, giving up only chroma", () => {
    for (const ink of DEALS) {
      for (const theme of ["light", "dark"] as const) {
        const hex = projectInkHex(ink, theme);
        expect(hex).toMatch(/^#[0-9a-f]{6}$/);
        const got = oklch(hex);
        expect(around(got.h, projectInkHue(ink)), `${theme} ink ${ink}`).toBeLessThan(2.5);
        expect(Math.abs(got.l - PROJECT_INK_TONE[theme].l)).toBeLessThan(0.01);
        expect(got.c).toBeLessThanOrEqual(PROJECT_INK_TONE[theme].c + 0.005);
      }
    }
  });
});

describe("DESIGN.md §2.9 — the phone reads the same ink (PJ-7)", () => {
  // The golden table the iOS port is held to (`ProjectInkTests`, over a
  // byte-identical copy `pnpm check:ios-fixtures` keeps): every deal's hue and
  // both themes' hex, as this kit answers them. A row that fails here means the
  // kit moved — regenerate the table on purpose (its `//` says how), never by
  // hand, and the phone's copy with it.
  const GOLDEN = JSON.parse(
    readFileSync(join(REPO, "packages/design-kit/fixtures/project-ink.golden.json"), "utf8"),
  ) as { rows: Array<{ ink: number; hue: number; light: string; dark: string }> };

  it("holds every one of the 997 deals, in order", () => {
    expect(GOLDEN.rows.map((row) => row.ink)).toEqual(DEALS);
  });

  it("answers each row's hue and hex exactly as the table says", () => {
    for (const row of GOLDEN.rows) {
      expect(projectInkHue(row.ink), `hue ${row.ink}`).toBe(row.hue);
      expect(projectInkHex(row.ink, "light"), `light ${row.ink}`).toBe(row.light);
      expect(projectInkHex(row.ink, "dark"), `dark ${row.ink}`).toBe(row.dark);
    }
  });
});
