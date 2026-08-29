// DT-3c — the renderer half of the §10.2 coordinate law. The producer's suite
// pins that wire coordinates pass through to CDP unscaled; THIS suite pins
// that the view's one mapping — canvas box → displayed frame's logical space —
// is the only scaling that ever happens, and that it survives the classic
// double-scaling inputs: dpr ≠ 1 rasters, letterbox bars, visibleRect crops.

import type { LiveSurfaceGeometryV1 } from "@vibefield/contracts";
import { describe, expect, it } from "vitest";
import {
  mapPointerToLogical,
  pointerButtonFromDom,
  printableTextOf,
} from "../src/surfaces/view/input-map";

/** A dpr-2 browser surface: coded raster twice the CSS logical viewport. */
const GEOMETRY: LiveSurfaceGeometryV1 = {
  revision: 3,
  codedSize: { width: 1280, height: 720 },
  visibleRect: { x: 0, y: 0, width: 1280, height: 720 },
  logicalSize: { width: 640, height: 360 },
  orientation: 0,
};

describe("mapPointerToLogical (LSF §10.2)", () => {
  it("maps through the raster scale exactly once — the double-scaling control", () => {
    // The element box IS the logical viewport. A center click maps to the
    // logical center; a dpr² bug would answer (160,90) or (640,360).
    const point = mapPointerToLogical({ width: 640, height: 360 }, { x: 320, y: 180 }, GEOMETRY);
    expect(point).toEqual({ x: 320, y: 180 });
  });

  it("centers contain-fit content and answers null in the letterbox bars", () => {
    // A wider box: scale min(720/1280, 360/720) = 0.5, content 640×360, 40px bars.
    const box = { width: 720, height: 360 };
    expect(mapPointerToLogical(box, { x: 10, y: 100 }, GEOMETRY)).toBeNull();
    expect(mapPointerToLogical(box, { x: 715, y: 100 }, GEOMETRY)).toBeNull();
    expect(mapPointerToLogical(box, { x: 40 + 320, y: 180 }, GEOMETRY)).toEqual({ x: 320, y: 180 });
  });

  it("offsets by the visibleRect origin BEFORE the logical ratio applies", () => {
    const cropped: LiveSurfaceGeometryV1 = {
      ...GEOMETRY,
      visibleRect: { x: 200, y: 100, width: 400, height: 200 },
    };
    // Canvas bitmap is the 400×200 cut, shown 1:1. A click at (100,50) sits at
    // coded (300,150) → logical (150,75). Forgetting the origin says (50,25).
    const point = mapPointerToLogical({ width: 400, height: 200 }, { x: 100, y: 50 }, cropped);
    expect(point).toEqual({ x: 150, y: 75 });
  });

  it("keeps the content edge inside the logical bounds", () => {
    const point = mapPointerToLogical({ width: 640, height: 360 }, { x: 640, y: 360 }, GEOMETRY);
    expect(point).toEqual({ x: 640, y: 360 });
  });

  it("answers null with no drawable geometry at all", () => {
    expect(mapPointerToLogical({ width: 0, height: 0 }, { x: 0, y: 0 }, GEOMETRY)).toBeNull();
    expect(
      mapPointerToLogical({ width: 100, height: 100 }, { x: 1, y: 1 }, {
        ...GEOMETRY,
        visibleRect: { x: 0, y: 0, width: 0, height: 0 },
      } as LiveSurfaceGeometryV1),
    ).toBeNull();
  });
});

describe("DOM translation guards", () => {
  it("carries only the buttons the wire carries", () => {
    expect(pointerButtonFromDom(0)).toBe("left");
    expect(pointerButtonFromDom(1)).toBe("middle");
    expect(pointerButtonFromDom(2)).toBe("right");
    expect(pointerButtonFromDom(3)).toBeNull();
    expect(pointerButtonFromDom(4)).toBeNull();
  });

  it("types single characters, never shortcuts or special keys", () => {
    const base = { altKey: false, ctrlKey: false, metaKey: false, shiftKey: false };
    expect(printableTextOf({ ...base, key: "a" })).toBe("a");
    expect(printableTextOf({ ...base, key: "É" })).toBe("É");
    // One astral character is one character, not two code units of garbage.
    expect(printableTextOf({ ...base, key: "😀" })).toBe("😀");
    expect(printableTextOf({ ...base, key: "Enter" })).toBeNull();
    expect(printableTextOf({ ...base, key: "a", metaKey: true })).toBeNull();
    expect(printableTextOf({ ...base, key: "a", ctrlKey: true })).toBeNull();
  });
});
