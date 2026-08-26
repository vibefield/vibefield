import { describe, expect, it } from "vitest";
import {
  canvasGridConfig,
  defaultCanvasAppearance,
  defaultCanvasGridConfig,
} from "../src/field/canvas-appearance";

describe("canvas appearance", () => {
  it("projects the reviewed light and dark dot colors onto one grid contract", () => {
    expect(defaultCanvasGridConfig(false)).toMatchObject({
      spacings: [20, 100, 500],
      dotColor: [166 / 255, 166 / 255, 166 / 255],
      dotAlpha: 0.85,
      dotRadius: [1.5, 1.5],
    });
    expect(defaultCanvasGridConfig(true).dotColor).toEqual([28 / 255, 28 / 255, 28 / 255]);
  });

  it("returns isolated editable values without mutating product defaults", () => {
    const editable = defaultCanvasAppearance();
    editable.worldGrid.spacings[0] = 32;
    editable.canvasPalette.dotLight = "#123456";

    expect(canvasGridConfig(editable, false)).toMatchObject({
      spacings: [32, 100, 500],
      dotColor: [18 / 255, 52 / 255, 86 / 255],
    });
    expect(defaultCanvasAppearance().worldGrid.spacings[0]).toBe(20);
    expect(defaultCanvasAppearance().canvasPalette.dotLight).toBe("#A6A6A6");
  });

  describe("magnet dot mode (ICE design-010)", () => {
    it("OMITS the magnet block when off — absence is the off state (§10.1)", () => {
      // An explicit {enabled:false} would ride this spread through
      // configureGrid and clobber any factory-level enable upstream.
      expect(defaultCanvasGridConfig(false)).not.toHaveProperty("magnet");
      expect(defaultCanvasGridConfig(false, false)).not.toHaveProperty("magnet");
    });

    it("enables ONLY the dot glyph when on, leaving the rest of the grid intact", () => {
      const grid = defaultCanvasGridConfig(false, true);
      expect(grid.magnet).toEqual({ enabled: true, glyph: "dot" });
      // The classic contract is untouched — magnet replaces pixels, not config.
      expect(grid).toMatchObject({
        spacings: [20, 100, 500],
        dotRadius: [1.5, 1.5],
        dotAlpha: 0.85,
      });
    });

    it("carries the theme dot color into magnet mode (both themes)", () => {
      expect(defaultCanvasGridConfig(true, true).dotColor).toEqual([28 / 255, 28 / 255, 28 / 255]);
      expect(defaultCanvasGridConfig(false, true).dotColor).toEqual([
        166 / 255,
        166 / 255,
        166 / 255,
      ]);
    });

    it("does not leak the magnet block into the shared defaults", () => {
      defaultCanvasGridConfig(false, true);
      expect(defaultCanvasAppearance().worldGrid).not.toHaveProperty("magnet");
      expect(defaultCanvasGridConfig(false)).not.toHaveProperty("magnet");
    });
  });
});
