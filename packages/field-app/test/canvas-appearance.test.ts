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
});
