/**
 * The contrast measured from the window's own capture (testing/smoke-contrast.ts; DK-16's method, shared since FG-O2):
 * a chip's ground and ink read from its pixels and their WCAG ratio, and a box cut from a whole window's capture.
 */
import { describe, expect, it } from "vitest";
import { contrast, cutChip, measureChip } from "../src/testing/smoke-contrast";

describe("the chip's contrast — measured from its pixels", () => {
  it("reads the glass as the ground and the glyphs' cores as the ink, and their WCAG contrast", () => {
    // 100 pixels of glass (232, 235, 230) and 4 of ink (58, 59, 60), BGRA
    const px: number[] = [];
    for (let i = 0; i < 100; i += 1) px.push(230, 235, 232, 255);
    for (let i = 0; i < 4; i += 1) px.push(60, 59, 58, 255);
    const m = measureChip(new Uint8Array(px));
    expect(m.ground).toEqual([232, 235, 230]);
    expect(m.ink).toEqual([58, 59, 60]);
    expect(m.ratio).toBeCloseTo(contrast([232, 235, 230], [58, 59, 60]), 1);
    expect(m.ratio).toBeGreaterThan(7);
    expect(contrast([255, 255, 255], [0, 0, 0])).toBeCloseTo(21, 5);
  });
});

describe("a chip cut from the window's capture (cutChip)", () => {
  // a window 4 × 3 CSS px, each device pixel's blue its x and its green its y
  const view = { width: 4, height: 3 };
  const captured = (scale: number): Uint8Array => {
    const w = view.width * scale;
    const h = view.height * scale;
    const px = new Uint8Array(w * h * 4);
    for (let y = 0; y < h; y += 1)
      for (let x = 0; x < w; x += 1) px.set([x, y, 0, 255], (y * w + x) * 4);
    return px;
  };
  const where = (chip: Uint8Array | null): number[][] => {
    const at: number[][] = [];
    for (let i = 0; chip !== null && i < chip.length; i += 4)
      at.push([chip[i] as number, chip[i + 1] as number]);
    return at;
  };

  it("cuts the box at the capture's own scale, widened to whole pixels", () => {
    // (1, 1) 1.5 × 1 at 2 to the px: device x 2 to 4, y 2 to 3
    expect(where(cutChip(captured(2), view, { x: 1, y: 1, width: 1.5, height: 1 }))).toEqual([
      [2, 2],
      [3, 2],
      [4, 2],
      [2, 3],
      [3, 3],
      [4, 3],
    ]);
    expect(where(cutChip(captured(1), view, { x: 1, y: 1, width: 1.5, height: 1 }))).toEqual([
      [1, 1],
      [2, 1],
    ]);
  });

  it("keeps the box inside the capture, and is null for a box with no pixel or a capture not the window's size", () => {
    expect(where(cutChip(captured(1), view, { x: 3, y: 2, width: 5, height: 5 }))).toEqual([
      [3, 2],
    ]);
    expect(cutChip(captured(1), view, { x: 4, y: 0, width: 2, height: 1 })).toBeNull();
    expect(cutChip(captured(2).subarray(4), view, { x: 0, y: 0, width: 1, height: 1 })).toBeNull();
  });
});
