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
      dotColor: [191 / 255, 196 / 255, 204 / 255],
      dotRadius: [0.75, 0.75],
    });
    expect(defaultCanvasGridConfig(true).dotColor).toEqual([89 / 255, 94 / 255, 102 / 255]);
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
    expect(defaultCanvasAppearance().canvasPalette.dotLight).toBe("#BFC4CC");
  });
});
