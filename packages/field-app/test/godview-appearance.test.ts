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
import { GHOSTTEA_SHADER_OPTIONS } from "@vibecook/ghosttea-react/workspace";
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
import { godviewTerminalEffects } from "../src/godview/deck-theme";

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
          shaderEffect: "ghosttea:vhs",
          shaderAnimate: true,
        }),
      ),
    ).toEqual({
      lightThemeName: "Solarized Light",
      darkThemeName: "Solarized Dark",
      opacity: 0.5,
      opacityCells: true,
      shaderEffect: "ghosttea:vhs",
      shaderAnimate: true,
    });
  });

  it("reads a record written before shaders existed as no shader", () => {
    // Every deck saved by GT-3v holds one of these. It must open unchanged —
    // adding a control cannot restyle panes that were never asked about it.
    const legacy = parseDeckAppearance(
      JSON.stringify({ lightThemeName: null, darkThemeName: null, opacity: 0.7 }),
    );

    expect(legacy.shaderEffect).toBeNull();
    expect(legacy.shaderAnimate).toBe(false);
    expect(godviewTerminalEffects(legacy)).toBeUndefined();
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
    expect(
      parseDeckAppearance(
        JSON.stringify({ opacity: 0.4, lightThemeName: 42, shaderEffect: { id: "vhs" } }),
      ),
    ).toEqual({
      lightThemeName: null,
      darkThemeName: null,
      opacity: 0.4,
      opacityCells: false,
      shaderEffect: null,
      shaderAnimate: false,
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
      shaderEffect: "ghosttea:crt",
      shaderAnimate: false,
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
      shaderEffect: "ghosttea:crt",
      shaderAnimate: false,
    });
    stop();
  });

  it("defaults to a see-through deck — the slice's own claim", () => {
    // If this ever reverts to 1, the glass is gone and everything else here
    // still passes.
    expect(DEFAULT_DECK_APPEARANCE.opacity).toBeLessThan(1);
    expect(DEFAULT_DECK_APPEARANCE.lightThemeName).toBeNull();
    expect(DEFAULT_DECK_APPEARANCE.darkThemeName).toBeNull();
    expect(DEFAULT_DECK_APPEARANCE.shaderEffect).toBeNull();
  });
});

/**
 * The effects projection (GT-3f / petition G11) — against the REAL shader
 * metadata, unlike the theme catalog the deck fixture stubs. Four entries is a
 * table worth reading, and the ids are the whole contract: a projection tested
 * against invented ids would pass while handing the renderer a shader ghosttea
 * has never compiled.
 */
describe("the viewer's shader, as the effects prop", () => {
  it("omits the prop entirely when nothing is chosen", () => {
    // Not `{postProcess: "none", shaderEffects: []}`. Absent hands ghosttea its
    // own config-derived path back; an empty object is this viewer overriding
    // that floor with nothing, which is a claim we have no reason to make.
    expect(godviewTerminalEffects(DEFAULT_DECK_APPEARANCE)).toBeUndefined();
  });

  it("names the chosen port in shaderEffects and leaves postProcess alone", () => {
    for (const shader of GHOSTTEA_SHADER_OPTIONS) {
      expect(
        godviewTerminalEffects({ ...DEFAULT_DECK_APPEARANCE, shaderEffect: shader.id }),
      ).toEqual({ postProcess: "none", shaderEffects: [shader.id], animate: false });
    }
  });

  it("keeps postProcess at none even for the legacy Better CRT port", () => {
    // The one port `postProcess` could also name. The renderer reads
    // `shaderEffects` first and only falls back to `postProcess` when that list
    // is empty, so saying it twice would be one choice with two authorities.
    const effects = godviewTerminalEffects({
      ...DEFAULT_DECK_APPEARANCE,
      shaderEffect: "ghosttea:better-crt",
    });

    expect(effects?.postProcess).toBe("none");
    expect(effects?.shaderEffects).toEqual(["ghosttea:better-crt"]);
  });

  it("carries the animate flag through for an animated port", () => {
    const animated = GHOSTTEA_SHADER_OPTIONS.find((shader) => shader.animated);
    expect(animated, "upstream still bundles at least one animated port").toBeDefined();

    expect(
      godviewTerminalEffects({
        ...DEFAULT_DECK_APPEARANCE,
        shaderEffect: animated?.id ?? "",
        shaderAnimate: true,
      })?.animate,
    ).toBe(true);
  });

  it("answers no effect for an id this build no longer carries", () => {
    // A pinned catalog can drop a port between releases. Falling back to the
    // pane the viewer had yesterday beats asking the renderer for a shader it
    // cannot compile — the same posture `findDeckColorTheme` takes for themes.
    expect(
      godviewTerminalEffects({
        ...DEFAULT_DECK_APPEARANCE,
        shaderEffect: "ghosttea:retired-in-some-future-release",
        shaderAnimate: true,
      }),
    ).toBeUndefined();
  });

  it("returns a value that survives ghosttea's own equality key", () => {
    // 0.9.1 canonicalizes equal effect objects behind `workspaceEffectsKey`
    // (JSON of postProcess, animate, shaderEffects). Two projections of the
    // same stored selection must land on the same key or every parent rerender
    // would invalidate terminals the viewer never touched.
    const appearance = { ...DEFAULT_DECK_APPEARANCE, shaderEffect: "ghosttea:crt" };
    expect(JSON.stringify(godviewTerminalEffects(appearance))).toBe(
      JSON.stringify(godviewTerminalEffects({ ...appearance })),
    );
  });
});
