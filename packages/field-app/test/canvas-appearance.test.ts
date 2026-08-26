import { describe, expect, it } from "vitest";
import {
  canvasGridConfig,
  defaultCanvasAppearance,
  defaultCanvasGridConfig,
} from "../src/field/canvas-appearance";

describe("canvas appearance", () => {
  it("projects the reviewed magnet appearance onto one grid contract", () => {
    expect(defaultCanvasGridConfig(false)).toMatchObject({
      spacings: [20, 100, 500],
      dotColor: [166 / 255, 166 / 255, 166 / 255],
      dotAlpha: 0.85,
      dotRadius: [1.5, 1.5],
      magnet: { glyph: "dot" },
    });
    expect(defaultCanvasGridConfig(true).dotColor).toEqual([138 / 255, 138 / 255, 138 / 255]);
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

  describe("build-selected magnet grid (ICE 0.11.0)", () => {
    it("defaults to dots and accepts needle tuning without a renderer switch", () => {
      const grid = defaultCanvasGridConfig(false);
      expect(grid.magnet).toEqual({ glyph: "dot" });
      expect(grid.magnet).not.toHaveProperty("enabled");
      expect(defaultCanvasGridConfig(false, "needle").magnet).toEqual({ glyph: "needle" });
      expect(grid).toMatchObject({
        spacings: [20, 100, 500],
        dotRadius: [1.5, 1.5],
        dotAlpha: 0.85,
      });
    });

    it("uses the legible magnet ink in dark and the shared ink in light", () => {
      // DESIGN.md §2.1 (2026-08-25): the classic dark grid whispers on purpose
      // (#1C1C1C on #171717), but the selected responsive field must be visible
      // — magnet carries the experiment's #8A8A8A in dark. Light was already
      // legible and stays on the shared #A6A6A6.
      expect(defaultCanvasGridConfig(true).dotColor).toEqual([138 / 255, 138 / 255, 138 / 255]);
      expect(defaultCanvasGridConfig(false).dotColor).toEqual([166 / 255, 166 / 255, 166 / 255]);
    });

    it("does not leak implementation tuning into editable appearance defaults", () => {
      defaultCanvasGridConfig(false);
      expect(defaultCanvasAppearance().worldGrid).not.toHaveProperty("magnet");
      expect(defaultCanvasGridConfig(false).magnet).toEqual({ glyph: "dot" });
    });
  });
});
