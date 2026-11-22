// @vitest-environment node
/**
 * The terminal's own colours (TL-4c, 2026-11-19; DESIGN.md §2.7 "The terminal's own colours").
 *
 * Three things are held here. The twin in code is the tokens, value for value, so the sixteen the
 * deck tells fieldd are the ones the stylesheet names. Each colour the tokens name clears the floor
 * DESIGN.md writes beside it, on its own ground. And Godview's own look stands on that ground
 * wherever it is drawn: a pane's theme, the block cursor's text, Settings' built-in preview, and
 * the sixteen a session is told, which a picked catalog theme replaces whole.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { DEFAULT_DECK_APPEARANCE } from "../src/godview/deck-appearance";
import {
  findDeckColorTheme,
  godviewTerminalPalette,
  godviewTerminalTheme,
} from "../src/godview/deck-theme";
import { GODVIEW_TERMINAL_LOOK, type TerminalLookMode } from "../src/godview/terminal-look";
import { BUILTIN_THEMES } from "../src/panels/terminal/theme-view";

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const TOKENS = readFileSync(join(REPO, "packages/design-kit/src/tokens.css"), "utf8");
const MODES: readonly TerminalLookMode[] = ["light", "dark"];
const HEX = /^#[0-9a-f]{6}$/;

/** A token's value as tokens.css writes it, or undefined. */
function token(name: string): string | undefined {
  return new RegExp(`\\n\\s*${name}:\\s*(#[0-9a-f]{6});`).exec(TOKENS)?.[1];
}

/** A channel in linear light, by sRGB's threshold 0.04045 (WCAG 2's text says 0.03928; no 8-bit value
 * falls between the two, so either gives these hexes the same ratios). */
function channel(hex: string, at: number): number {
  const c = Number.parseInt(hex.slice(at, at + 2), 16) / 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

function luminance(hex: string): number {
  return 0.2126 * channel(hex, 1) + 0.7152 * channel(hex, 3) + 0.0722 * channel(hex, 5);
}

/** WCAG 2's contrast ratio, unrounded, as DESIGN.md §2.7 states "at least": a colour clears its floor
 * and is never rounded up to it. The least margins are a few thousandths, by design: each colour was
 * solved at its floor, so a token nudged across one fails here, and a change to either ground
 * re-solves the set rather than nudging it. */
function contrast(a: string, b: string): number {
  const [x, y] = [luminance(a), luminance(b)];
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}

/** DESIGN.md §2.7's "at least" column, by index: by day the ink, the six, white, bright black, the
 * six brights, bright white; by night every colour but black, which is a ground colour. */
const FLOORS: Readonly<Record<TerminalLookMode, readonly (number | null)[]>> = {
  light: [14, 4.6, 4.6, 4.6, 4.6, 4.6, 4.6, 4.6, 6.5, 5.6, 5.6, 5.6, 5.6, 5.6, 5.6, 3.2],
  dark: [null, 4.5, 4.5, 4.5, 4.5, 4.5, 4.5, 4.5, 4.5, 4.5, 4.5, 4.5, 4.5, 4.5, 4.5, 4.5],
};

function rgbText(hex: string): string {
  return [1, 3, 5].map((at) => Number.parseInt(hex.slice(at, at + 2), 16)).join(" ");
}

function rgbOf(colour: readonly number[]): string {
  return colour
    .slice(0, 3)
    .map((value) => Math.round(value * 255))
    .join(" ");
}

describe("the terminal's own colours are tokens, and their twin in code is them (TL-4c)", () => {
  it("names the ground and the sixteen of each mode exactly as tokens.css does", () => {
    for (const mode of MODES) {
      const look = GODVIEW_TERMINAL_LOOK[mode];
      expect(token(`--vf-godview-${mode}-terminal-bg`), `${mode} ground`).toBe(look.ground);
      expect(look.palette, `${mode} palette`).toHaveLength(16);
      look.palette.forEach((colour, index) => {
        expect(token(`--vf-godview-${mode}-terminal-ansi-${index}`), `${mode} ${index}`).toBe(
          colour,
        );
      });
    }
  });

  it("puts the day on paper, and leaves the night on graphite", () => {
    expect(token("--vf-godview-light-terminal-bg")).toBe("#f1f0ee");
    expect(token("--vf-godview-light-terminal-divider")).toBe("#d6d5d3");
    expect(token("--vf-godview-dark-terminal-bg")).toBe("#282c34");
    expect(token("--vf-godview-dark-terminal-divider")).toBe("#414650");
  });

  it("holds every colour tokens.css names to the floor DESIGN.md writes beside it, on its own ground", () => {
    for (const mode of MODES) {
      const ground = token(`--vf-godview-${mode}-terminal-bg`) ?? "";
      expect(ground, `${mode} ground`).toMatch(HEX);
      FLOORS[mode].forEach((floor, index) => {
        const colour = token(`--vf-godview-${mode}-terminal-ansi-${index}`) ?? "";
        expect(colour, `${mode} ${index}`).toMatch(HEX);
        if (floor === null) return;
        expect(contrast(colour, ground), `${mode} ${index} ${colour}`).toBeGreaterThanOrEqual(
          floor,
        );
      });
    }
  });
});

describe("Godview's own look stands on the deck's own ground (TL-4c)", () => {
  it("draws a pane, and a block cursor's text, on the paper by day and the graphite by night", () => {
    for (const mode of MODES) {
      const theme = godviewTerminalTheme(DEFAULT_DECK_APPEARANCE, mode);
      expect(rgbOf(theme.background), mode).toBe(rgbText(GODVIEW_TERMINAL_LOOK[mode].ground));
      expect(rgbOf(theme.cursorText ?? []), mode).toBe(rgbText(GODVIEW_TERMINAL_LOOK[mode].ground));
      // the pane's alpha is the viewer's, never the ground's
      expect(theme.background[3], mode).toBe(DEFAULT_DECK_APPEARANCE.opacity);
    }
  });

  it("shows Settings' built-in preview on the same ground", () => {
    for (const mode of MODES) {
      expect(BUILTIN_THEMES[mode].background, mode).toBe(GODVIEW_TERMINAL_LOOK[mode].ground);
    }
  });

  it("tells a session the deck's own sixteen, or a picked catalog theme's whole", () => {
    for (const mode of MODES) {
      expect(godviewTerminalPalette(DEFAULT_DECK_APPEARANCE, mode), mode).toEqual(
        GODVIEW_TERMINAL_LOOK[mode].palette,
      );
    }
    const picked = {
      ...DEFAULT_DECK_APPEARANCE,
      lightThemeName: "iTerm2 Solarized Light",
      darkThemeName: "iTerm2 Solarized Dark",
    };
    for (const mode of MODES) {
      const chosen = findDeckColorTheme(
        mode === "dark" ? picked.darkThemeName : picked.lightThemeName,
      );
      expect(chosen, `${mode}: the catalog name resolves`).toBeDefined();
      expect(godviewTerminalPalette(picked, mode), mode).toEqual(chosen?.palette);
    }
  });
});

describe("the phone's day look is the deck's (PF-6, 2026-11-21)", () => {
  // DESIGN.md §2.7 "The terminal's own colours", on the phone: by day the phone's terminal wears the
  // deck's day look, and its twin in the kit is held to this one here, value for value.
  const SWIFT = readFileSync(
    join(REPO, "apps/ios/VibeFieldKit/Sources/FieldTerminal/TerminalLook.swift"),
    "utf8",
  );
  /** `TerminalLook.day`'s own text, from its name to its palette's last colour. */
  const DAY = /static let day = TerminalThemeColours\(([\s\S]*?)\]\)/.exec(SWIFT)?.[1] ?? "";
  const field = (name: string): string =>
    new RegExp(`\\b${name}: "(#[0-9a-f]{6})"`).exec(DAY)?.[1] ?? "";
  const palette = /palette: \[([\s\S]*)$/.exec(DAY)?.[1]?.match(/#[0-9a-f]{6}/g) ?? [];
  const deck = godviewTerminalTheme(DEFAULT_DECK_APPEARANCE, "light");

  /** A translucent colour laid over the paper, as the phone's renderer needs it: solid. */
  function overPaper(colour: readonly number[] | undefined): string {
    const [r = 0, g = 0, b = 0, alpha = 1] = colour ?? [];
    return [r, g, b]
      .map((value, index) =>
        Math.round((value * alpha + (deck.background[index] ?? 0) * (1 - alpha)) * 255),
      )
      .join(" ");
  }

  it("names the paper, the reference's ink and the day's sixteen as the deck does", () => {
    expect(field("background")).toBe(GODVIEW_TERMINAL_LOOK.light.ground);
    expect(field("cursorText"), "a block cursor's text is the ground").toBe(
      GODVIEW_TERMINAL_LOOK.light.ground,
    );
    expect(rgbText(field("foreground"))).toBe(rgbOf(deck.foreground));
    expect(palette).toEqual(GODVIEW_TERMINAL_LOOK.light.palette);
  });

  it("lays the reference's translucent cursor and selection over the paper", () => {
    expect(deck.cursor?.[3], "the reference's cursor is translucent").toBeLessThan(1);
    expect(deck.selection?.[3], "and so is its selection").toBeLessThan(1);
    expect(rgbText(field("cursor"))).toBe(overPaper(deck.cursor));
    expect(rgbText(field("selection"))).toBe(overPaper(deck.selection));
    expect(rgbText(field("selectionForeground"))).toBe(rgbOf(deck.selectionForeground ?? []));
  });
});
