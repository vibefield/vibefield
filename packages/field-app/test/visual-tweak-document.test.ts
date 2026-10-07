import { describe, expect, it } from "vitest";
import {
  defaultProductAppearance,
  productAppearanceCssVariables,
} from "../src/appearance/product-appearance";
import {
  deserializeVisualTweaks,
  serializeVisualTweaks,
  VISUAL_TWEAK_DOCUMENT_KIND,
  VISUAL_TWEAK_DOCUMENT_VERSION,
  VisualTweakDocumentError,
} from "../src/appearance/product-appearance-document";

/** A version-3 export exactly as the v3 writer made it (DK-17's base, `c32ecf92`) — the shape James's
 * machines hold: the plain ground beside the 0.11 ground's tuning and the DOM card's overlap feedback. */
function v3Export(): Record<string, unknown> {
  return {
    kind: "vibefield.visual-tweaks",
    version: 3,
    canvasPalette: {
      dotLight: "#A6A6A6",
      dotDark: "#1C1C1C",
      magnetDotDark: "#8A8A8A",
      bgLight: "#F2EAD3",
      bgDark: "#1E2A22",
    },
    worldGrid: {
      spacings: [25, 50, 100],
      dotAlpha: 1,
      fadeIn: [20, 30],
      fadeOut: [90, 100],
      dotRadius: [1.5, 1.5],
      levelWeight: [1, 0],
    },
    magnetGrid: {
      glyph: "needle",
      reach: 85,
      polarity: -1,
      widgets: false,
      widgetStrength: 1.75,
      widgetRadius: 20,
      alwaysAlign: true,
      needleLength: 8,
      needleWidth: 0.9,
      maxSources: 96,
      fadeZoom: 0.35,
    },
    overlapFeedback: {
      colors: {
        glowLight: "#FFFFFF",
        glowDark: "#6E6E6E",
        rimLight: "#E0E0E0",
        rimDark: "#5C5C5C",
      },
      glowAlpha: [0.25, 0.5],
      glowSize: [60, 60],
      rimAlpha: [0.55, 0.85],
      rimWidth: 1.5,
      rimRadius: 600,
    },
  };
}

const V3_GROUND = { canvasPalette: { bgLight: "#F2EAD3", bgDark: "#1E2A22" } };

describe("visual tweak document", () => {
  it("is the plain ground alone — the reviewed product default (DK-17, v4)", () => {
    expect(defaultProductAppearance()).toEqual({
      canvasPalette: { bgLight: "#FAFAFA", bgDark: "#171717" },
    });
  });

  it("writes version 4 with the ground and nothing that retired, and round-trips it", () => {
    const values = defaultProductAppearance();
    values.canvasPalette.bgLight = "#123456";
    values.canvasPalette.bgDark = "#abcdef";

    const serialized = serializeVisualTweaks(values);
    expect(JSON.parse(serialized)).toEqual({
      kind: VISUAL_TWEAK_DOCUMENT_KIND,
      version: 4,
      canvasPalette: { bgLight: "#123456", bgDark: "#abcdef" },
    });
    expect(VISUAL_TWEAK_DOCUMENT_VERSION).toBe(4);
    expect(deserializeVisualTweaks(serialized)).toEqual({
      canvasPalette: { bgLight: "#123456", bgDark: "#ABCDEF" },
    });
  });

  it("reads a version-3 export past what retired — exactly its ground", () => {
    expect(deserializeVisualTweaks(JSON.stringify(v3Export()))).toEqual(V3_GROUND);
  });

  it("reads past the retired halves even where the v3 reader refused them", () => {
    // The v3 reader refused a fractional source cap, an out-of-range rim and a partial grid; nothing
    // on the desk draws any of them now.
    const document = v3Export();
    (document["magnetGrid"] as Record<string, unknown>)["maxSources"] = 63.5;
    (document["overlapFeedback"] as Record<string, unknown>)["rimAlpha"] = [0.2, 2];
    delete (document["worldGrid"] as Record<string, unknown>)["fadeOut"];
    delete (document["canvasPalette"] as Record<string, unknown>)["magnetDotDark"];
    expect(deserializeVisualTweaks(JSON.stringify(document))).toEqual(V3_GROUND);
  });

  it("reads versions 1 and 2 the same way (before the world grid, before the magnet block)", () => {
    const v1 = v3Export();
    v1["version"] = 1;
    delete v1["worldGrid"];
    delete v1["magnetGrid"];
    expect(deserializeVisualTweaks(JSON.stringify(v1))).toEqual(V3_GROUND);

    const v2 = v3Export();
    v2["version"] = 2;
    delete v2["magnetGrid"];
    expect(deserializeVisualTweaks(JSON.stringify(v2))).toEqual(V3_GROUND);
  });

  it("stays strict about the ground: a missing or malformed colour rejects the whole file", () => {
    const missing = v3Export();
    delete (missing["canvasPalette"] as Record<string, unknown>)["bgDark"];
    expect(() => deserializeVisualTweaks(JSON.stringify(missing))).toThrow(
      "canvasPalette.bgDark must be a six-digit hex color.",
    );

    const malformed = JSON.parse(serializeVisualTweaks(defaultProductAppearance())) as {
      canvasPalette: Record<string, unknown>;
    };
    malformed.canvasPalette["bgLight"] = "#FFF";
    expect(() => deserializeVisualTweaks(JSON.stringify(malformed))).toThrow(
      VisualTweakDocumentError,
    );

    const groundless = { kind: VISUAL_TWEAK_DOCUMENT_KIND, version: 4 };
    expect(() => deserializeVisualTweaks(JSON.stringify(groundless))).toThrow(
      "canvasPalette must be an object.",
    );
  });

  it("rejects unknown document versions and kinds", () => {
    const document = JSON.parse(serializeVisualTweaks(defaultProductAppearance())) as Record<
      string,
      unknown
    >;
    document["version"] = 5;
    expect(() => deserializeVisualTweaks(JSON.stringify(document))).toThrow(
      "Unsupported visual tweak version: 5",
    );
    document["version"] = 4;
    document["kind"] = "vibefield.something-else";
    expect(() => deserializeVisualTweaks(JSON.stringify(document))).toThrow(
      `Expected kind "${VISUAL_TWEAK_DOCUMENT_KIND}".`,
    );
  });

  it("projects the ground onto --vf-canvas-bg and nothing else", () => {
    const values = defaultProductAppearance();
    values.canvasPalette.bgDark = "#123456";
    expect(productAppearanceCssVariables(values, true)).toEqual({ "--vf-canvas-bg": "#123456" });
    expect(productAppearanceCssVariables(values, false)).toEqual({ "--vf-canvas-bg": "#FAFAFA" });
  });
});
