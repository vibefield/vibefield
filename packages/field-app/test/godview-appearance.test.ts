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
import { godviewBackdropStyle, godviewTerminalEffects } from "../src/godview/deck-theme";

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
          shaderEffects: ["ghosttea:vhs", "ghosttea:crt"],
          shaderAnimate: true,
          backdropOpacity: 0.6,
          backdropBlur: 18,
        }),
      ),
    ).toEqual({
      lightThemeName: "Solarized Light",
      darkThemeName: "Solarized Dark",
      opacity: 0.5,
      opacityCells: true,
      shaderEffects: ["ghosttea:vhs", "ghosttea:crt"],
      shaderAnimate: true,
      backdropOpacity: 0.6,
      backdropBlur: 18,
    });
  });

  it("reads a record from before the stack as a stack of its one effect (GT-7)", () => {
    // Every deck GT-3f saved holds `shaderEffect`: one name or null. The stack
    // must open wearing exactly that — and the smoke still seeds this shape.
    expect(
      parseDeckAppearance(JSON.stringify({ shaderEffect: "ghosttea:vhs" })).shaderEffects,
    ).toEqual(["ghosttea:vhs"]);
    expect(parseDeckAppearance(JSON.stringify({ shaderEffect: null })).shaderEffects).toEqual([]);
    // Once a stack is written, it wins over a stale single field beside it.
    expect(
      parseDeckAppearance(JSON.stringify({ shaderEffect: "ghosttea:vhs", shaderEffects: [] }))
        .shaderEffects,
    ).toEqual([]);
  });

  it("keeps a stack's order, drops non-names and repeats, and caps its depth", () => {
    const stack = parseDeckAppearance(
      JSON.stringify({
        shaderEffects: [
          "ghosttea:crt",
          7,
          "",
          "ghosttea:vhs",
          "ghosttea:crt",
          ...Array(20).fill("x"),
        ],
      }),
    ).shaderEffects;
    expect(stack.slice(0, 3)).toEqual(["ghosttea:crt", "ghosttea:vhs", "x"]);
    expect(stack.length).toBeLessThanOrEqual(8);
  });

  it("clamps the backdrop into its ranges and defaults it to the flat, opaque stage", () => {
    expect(parseDeckAppearance(JSON.stringify({ backdropOpacity: 3 })).backdropOpacity).toBe(1);
    expect(parseDeckAppearance(JSON.stringify({ backdropOpacity: -1 })).backdropOpacity).toBe(0);
    expect(parseDeckAppearance(JSON.stringify({ backdropBlur: 500 })).backdropBlur).toBe(80);
    expect(parseDeckAppearance(JSON.stringify({ backdropBlur: "soft" })).backdropBlur).toBe(0);
    expect(DEFAULT_DECK_APPEARANCE.backdropOpacity).toBe(1);
    expect(DEFAULT_DECK_APPEARANCE.backdropBlur).toBe(0);
  });

  it("reads a record written before shaders existed as no shader", () => {
    // Every deck saved by GT-3v holds one of these. It must open unchanged —
    // adding a control cannot restyle panes that were never asked about it.
    const legacy = parseDeckAppearance(
      JSON.stringify({ lightThemeName: null, darkThemeName: null, opacity: 0.7 }),
    );

    expect(legacy.shaderEffects).toEqual([]);
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
      shaderEffects: [],
      shaderAnimate: false,
      backdropOpacity: 1,
      backdropBlur: 0,
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
      shaderEffects: ["ghosttea:crt"],
      shaderAnimate: false,
      backdropOpacity: 0.5,
      backdropBlur: 12,
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
      shaderEffects: ["ghosttea:crt"],
      shaderAnimate: false,
      backdropOpacity: 0.5,
      backdropBlur: 12,
    });
    stop();
  });

  it("defaults to a see-through deck — the slice's own claim", () => {
    // If this ever reverts to 1, the glass is gone and everything else here
    // still passes.
    expect(DEFAULT_DECK_APPEARANCE.opacity).toBeLessThan(1);
    expect(DEFAULT_DECK_APPEARANCE.lightThemeName).toBeNull();
    expect(DEFAULT_DECK_APPEARANCE.darkThemeName).toBeNull();
    expect(DEFAULT_DECK_APPEARANCE.shaderEffects).toEqual([]);
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
        godviewTerminalEffects({ ...DEFAULT_DECK_APPEARANCE, shaderEffects: [shader.id] }),
      ).toEqual({ postProcess: "none", shaderEffects: [shader.id], animate: false });
    }
  });

  it("keeps postProcess at none even for the legacy Better CRT port", () => {
    // The one port `postProcess` could also name. The renderer reads
    // `shaderEffects` first and only falls back to `postProcess` when that list
    // is empty, so saying it twice would be one choice with two authorities.
    const effects = godviewTerminalEffects({
      ...DEFAULT_DECK_APPEARANCE,
      shaderEffects: ["ghosttea:better-crt"],
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
        shaderEffects: [animated?.id ?? ""],
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
        shaderEffects: ["ghosttea:retired-in-some-future-release"],
        shaderAnimate: true,
      }),
    ).toBeUndefined();
  });

  it("hands the renderer the whole stack in the viewer's order (GT-7)", () => {
    // The renderer runs one pass per effect in list order, so the order is the
    // look: CRT-then-VHS and VHS-then-CRT are two different pictures.
    expect(
      godviewTerminalEffects({
        ...DEFAULT_DECK_APPEARANCE,
        shaderEffects: ["ghosttea:vhs", "ghosttea:crt", "ghosttea:sparks-from-fire"],
        shaderAnimate: true,
      }),
    ).toEqual({
      postProcess: "none",
      shaderEffects: ["ghosttea:vhs", "ghosttea:crt", "ghosttea:sparks-from-fire"],
      animate: true,
    });
  });

  it("drops a retired port from a stack without dropping the rest", () => {
    expect(
      godviewTerminalEffects({
        ...DEFAULT_DECK_APPEARANCE,
        shaderEffects: ["ghosttea:retired-in-some-future-release", "ghosttea:crt"],
      })?.shaderEffects,
    ).toEqual(["ghosttea:crt"]);
  });

  it("returns a value that survives ghosttea's own equality key", () => {
    // 0.9.1 canonicalizes equal effect objects behind `workspaceEffectsKey`
    // (JSON of postProcess, animate, shaderEffects). Two projections of the
    // same stored selection must land on the same key or every parent rerender
    // would invalidate terminals the viewer never touched.
    const appearance = { ...DEFAULT_DECK_APPEARANCE, shaderEffects: ["ghosttea:crt"] };
    expect(JSON.stringify(godviewTerminalEffects(appearance))).toBe(
      JSON.stringify(godviewTerminalEffects({ ...appearance })),
    );
  });
});

/**
 * The stage's backdrop (GT-7, GT-D19) — the two variables godview.css reads,
 * from ONE projection the overlay, the catalog and Settings all use.
 */
describe("the viewer's backdrop, as the stage's variables", () => {
  it("projects the default as the reference's flat, opaque stage", () => {
    expect(godviewBackdropStyle(DEFAULT_DECK_APPEARANCE)).toEqual({
      "--vf-godview-stage-opacity": "100%",
      "--vf-godview-stage-blur": "0px",
    });
  });

  it("projects a see-through, blurred backdrop", () => {
    expect(
      godviewBackdropStyle({
        ...DEFAULT_DECK_APPEARANCE,
        backdropOpacity: 0.456,
        backdropBlur: 24,
      }),
    ).toEqual({ "--vf-godview-stage-opacity": "46%", "--vf-godview-stage-blur": "24px" });
  });
});
