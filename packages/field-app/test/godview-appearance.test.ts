// @vitest-environment happy-dom
/**
 * The viewer's appearance (GT-3v / GT-D12) — the store and its projection.
 *
 * Two properties are worth holding still here. The store is a TOLERANT reader,
 * because it parses bytes a previous version of this app wrote and a preference
 * must never be able to fail a deck mount. And the projection carries the
 * viewer's alpha onto the renderer's background, which is the whole mechanism
 * that replaced GT-3's screen-composite interim — if that alpha stops arriving,
 * the panes go opaque and no test that only counts renders would notice.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  DEFAULT_DECK_APPEARANCE,
  deckThemeNameForMode,
  getDeckAppearance,
  parseDeckAppearance,
  resetDeckAppearanceForTest,
  setDeckAppearance,
  subscribeDeckAppearance,
} from "../src/godview/deck-appearance";

beforeEach(() => resetDeckAppearanceForTest());
afterEach(() => resetDeckAppearanceForTest());

describe("the deck appearance store", () => {
  it("reads a saved record back", () => {
    expect(
      parseDeckAppearance(
        JSON.stringify({
          lightThemeName: "Solarized Light",
          darkThemeName: "Solarized Dark",
          opacity: 0.5,
          opacityCells: true,
        }),
      ),
    ).toEqual({
      lightThemeName: "Solarized Light",
      darkThemeName: "Solarized Dark",
      opacity: 0.5,
      opacityCells: true,
    });
  });

  it("migrates the old shared color theme into both modes", () => {
    const appearance = parseDeckAppearance(
      JSON.stringify({ themeName: "Gruvbox", opacity: 0.5, opacityCells: false }),
    );

    expect(deckThemeNameForMode(appearance, "light")).toBe("Gruvbox");
    expect(deckThemeNameForMode(appearance, "dark")).toBe("Gruvbox");
  });

  it("answers the default for anything it cannot read", () => {
    for (const raw of [null, "", "not json", "[]", '"a string"', "7"]) {
      expect(parseDeckAppearance(raw)).toEqual(DEFAULT_DECK_APPEARANCE);
    }
  });

  it("keeps the fields that parsed when a record is only partly readable", () => {
    // A preference is not worth failing over, and a half-written record is
    // still evidence of what the user chose.
    expect(parseDeckAppearance(JSON.stringify({ opacity: 0.4, lightThemeName: 42 }))).toEqual({
      lightThemeName: null,
      darkThemeName: null,
      opacity: 0.4,
      opacityCells: false,
    });
  });

  it("clamps an out-of-range opacity rather than discarding the record", () => {
    expect(parseDeckAppearance(JSON.stringify({ opacity: 4 })).opacity).toBe(1);
    expect(parseDeckAppearance(JSON.stringify({ opacity: -2 })).opacity).toBe(0);
    expect(parseDeckAppearance(JSON.stringify({ opacity: Number.NaN }))).toEqual(
      DEFAULT_DECK_APPEARANCE,
    );
  });

  it("persists and announces a write", () => {
    let announced = 0;
    const stop = subscribeDeckAppearance(() => {
      announced += 1;
    });
    setDeckAppearance({
      lightThemeName: "Catppuccin Latte",
      darkThemeName: "Catppuccin Mocha",
      opacity: 0.33,
      opacityCells: true,
    });

    expect(announced).toBe(1);
    expect(getDeckAppearance().opacity).toBeCloseTo(0.33);
    // Persisted BEFORE the announcement: a listener that re-reads storage must
    // not be able to observe the old bytes.
    expect(parseDeckAppearance(localStorage.getItem("vf-godview-appearance-v1"))).toEqual({
      lightThemeName: "Catppuccin Latte",
      darkThemeName: "Catppuccin Mocha",
      opacity: 0.33,
      opacityCells: true,
    });
    stop();
  });

  it("defaults to a see-through deck — the slice's own claim", () => {
    // If this ever reverts to 1, the glass is gone and everything else here
    // still passes.
    expect(DEFAULT_DECK_APPEARANCE.opacity).toBeLessThan(1);
    expect(DEFAULT_DECK_APPEARANCE.lightThemeName).toBeNull();
    expect(DEFAULT_DECK_APPEARANCE.darkThemeName).toBeNull();
  });
});
