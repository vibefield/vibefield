import { describe, expect, it } from "vitest";
import {
  deserializeVisualTweaks,
  serializeVisualTweaks,
  VISUAL_TWEAK_DOCUMENT_KIND,
  VISUAL_TWEAK_DOCUMENT_VERSION,
  VisualTweakDocumentError,
} from "../src/design-system/tweaks/visual-tweak-document";
import {
  defaultVisualTweakValues,
  visualTweakCssVariables,
} from "../src/design-system/tweaks/visual-tweaks";

describe("visual tweak document", () => {
  it("round-trips every canvas, world-grid, and overlap property", () => {
    const values = defaultVisualTweakValues();
    values.canvasPalette.bgLight = "#123456";
    values.canvasPalette.dotDark = "#ABCDEF";
    values.worldGrid.spacings = [12, 96, 768];
    values.worldGrid.dotAlpha = 0.72;
    values.worldGrid.fadeIn = [5, 18];
    values.worldGrid.fadeOut = [140, 360];
    values.worldGrid.dotRadius = [0.5, 1.25];
    values.worldGrid.levelWeight = [0.9, -0.1];
    values.overlapFeedback.colors.rimDark = "#102030";
    values.overlapFeedback.glowAlpha = [0.12, 0.78];
    values.overlapFeedback.glowSize = [42, 144];
    values.overlapFeedback.rimAlpha = [0.34, 0.88];
    values.overlapFeedback.rimWidth = 2.4;
    values.overlapFeedback.rimRadius = 720;

    const serialized = serializeVisualTweaks(values);
    const raw = JSON.parse(serialized) as Record<string, unknown>;
    expect(raw["kind"]).toBe(VISUAL_TWEAK_DOCUMENT_KIND);
    expect(raw["version"]).toBe(VISUAL_TWEAK_DOCUMENT_VERSION);
    expect(deserializeVisualTweaks(serialized)).toEqual(values);
  });

  it("rejects partial and out-of-range files instead of applying half a preset", () => {
    const document = JSON.parse(serializeVisualTweaks(defaultVisualTweakValues())) as {
      canvasPalette: Record<string, unknown>;
      worldGrid: Record<string, unknown>;
      overlapFeedback: Record<string, unknown>;
    };
    delete document.canvasPalette["dotLight"];
    expect(() => deserializeVisualTweaks(JSON.stringify(document))).toThrow(
      VisualTweakDocumentError,
    );

    const missingGridValue = JSON.parse(serializeVisualTweaks(defaultVisualTweakValues())) as {
      worldGrid: Record<string, unknown>;
    };
    delete missingGridValue.worldGrid["fadeOut"];
    expect(() => deserializeVisualTweaks(JSON.stringify(missingGridValue))).toThrow(
      VisualTweakDocumentError,
    );

    const invalidRange = JSON.parse(serializeVisualTweaks(defaultVisualTweakValues())) as {
      overlapFeedback: Record<string, unknown>;
    };
    invalidRange.overlapFeedback["rimAlpha"] = [0.2, 2];
    expect(() => deserializeVisualTweaks(JSON.stringify(invalidRange))).toThrow(
      "overlapFeedback.rimAlpha[1] must be between 0 and 1",
    );
  });

  it("rejects unknown document versions", () => {
    const document = JSON.parse(serializeVisualTweaks(defaultVisualTweakValues())) as Record<
      string,
      unknown
    >;
    document["version"] = 3;
    expect(() => deserializeVisualTweaks(JSON.stringify(document))).toThrow(
      "Unsupported visual tweak version: 3",
    );
  });

  it("migrates version 1 exports with reviewed World grid defaults", () => {
    const document = JSON.parse(serializeVisualTweaks(defaultVisualTweakValues())) as Record<
      string,
      unknown
    >;
    document["version"] = 1;
    delete document["worldGrid"];
    expect(deserializeVisualTweaks(JSON.stringify(document)).worldGrid).toEqual(
      defaultVisualTweakValues().worldGrid,
    );
  });

  it("projects every overlap control onto CardShell's live CSS variables", () => {
    const values = defaultVisualTweakValues();
    values.overlapFeedback.colors.rimDark = "#123456";
    values.overlapFeedback.glowSize = [22, 44];
    values.overlapFeedback.rimAlpha = [0.2, 0.8];
    values.overlapFeedback.rimWidth = 2.5;
    values.overlapFeedback.rimRadius = 640;

    expect(visualTweakCssVariables(values, true)).toMatchObject({
      "--ic-rim-color": "18, 52, 86",
      "--ic-glow-size-c": "22px",
      "--ic-glow-size-t": "44px",
      "--ic-rim-alpha-c": "0.2",
      "--ic-rim-alpha-t": "0.8",
      "--ic-rim-width": "2.5px",
      "--ic-rim-radius": "640px",
    });
  });
});
