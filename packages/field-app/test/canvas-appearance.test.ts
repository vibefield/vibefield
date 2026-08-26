import { describe, expect, it } from "vitest";
import {
  canvasGridConfig,
  defaultCanvasAppearance,
  defaultCanvasGridConfig,
} from "../src/field/canvas-appearance";

describe("canvas appearance", () => {
  it("projects the reviewed magnet appearance onto one grid contract", () => {
    expect(defaultCanvasGridConfig(false)).toMatchObject({
      spacings: [25, 50, 100],
      dotColor: [166 / 255, 166 / 255, 166 / 255],
      dotAlpha: 1,
      dotRadius: [1.5, 1.5],
      magnet: {
        glyph: "dot",
        reach: 60,
        polarity: 1,
        widgets: true,
        widgetStrength: 0.1,
        widgetRadius: 12,
        alwaysAlign: false,
        needleLength: 5,
        needleWidth: 0.55,
        maxSources: 256,
        fadeZoom: 0,
      },
    });
    expect(defaultCanvasGridConfig(true).dotColor).toEqual([138 / 255, 138 / 255, 138 / 255]);
  });

  it("returns isolated editable values without mutating product defaults", () => {
    const editable = defaultCanvasAppearance();
    editable.worldGrid.spacings[0] = 32;
    editable.magnetGrid.reach = 90;
    editable.canvasPalette.dotLight = "#123456";

    expect(canvasGridConfig(editable, false)).toMatchObject({
      spacings: [32, 50, 100],
      dotColor: [18 / 255, 52 / 255, 86 / 255],
      magnet: { reach: 90 },
    });
    expect(defaultCanvasAppearance().worldGrid.spacings[0]).toBe(25);
    expect(defaultCanvasAppearance().magnetGrid.reach).toBe(60);
    expect(defaultCanvasAppearance().canvasPalette.dotLight).toBe("#A6A6A6");
  });

  describe("build-selected magnet grid (ICE 0.11.0)", () => {
    it("defaults to dots and accepts needle tuning without a renderer switch", () => {
      const grid = defaultCanvasGridConfig(false);
      expect(grid.magnet).toMatchObject({ glyph: "dot", reach: 60, maxSources: 256 });
      expect(grid.magnet).not.toHaveProperty("enabled");
      expect(defaultCanvasGridConfig(false, "needle").magnet).toMatchObject({
        glyph: "needle",
        reach: 60,
        maxSources: 256,
      });
      expect(grid).toMatchObject({
        spacings: [25, 50, 100],
        dotRadius: [1.5, 1.5],
        dotAlpha: 1,
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

    it("projects every editable magnet field through the shared grid contract", () => {
      const appearance = defaultCanvasAppearance();
      appearance.magnetGrid = {
        glyph: "needle",
        reach: 75,
        polarity: -1,
        widgets: false,
        widgetStrength: 1.5,
        widgetRadius: 18,
        alwaysAlign: true,
        needleLength: 7,
        needleWidth: 0.8,
        maxSources: 64,
        fadeZoom: 0.4,
      };

      expect(canvasGridConfig(appearance, false).magnet).toEqual(appearance.magnetGrid);
    });
  });
});
