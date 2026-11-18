import { describe, expect, it } from "vitest";
import { coalesceBrowserInput as merge } from "../src/main/live-surfaces/browser-input-coalescing";
import type { BrowserSurfaceInputRequest } from "../src/main/live-surfaces/browser-producer";

const wheel = (deltaY = 8): BrowserSurfaceInputRequest => ({
  kind: "wheel",
  geometryRevision: 1,
  x: 20,
  y: 30,
  deltaX: 0,
  deltaY,
});
const move = (x = 20): BrowserSurfaceInputRequest => ({
  kind: "mouse",
  type: "move",
  geometryRevision: 1,
  x,
  y: 30,
});
describe("continuous browser input coalescing", () => {
  it("keeps the newest hover and preserves total wheel travel", () => {
    expect(merge(move(), move(90))).toEqual(move(90));
    expect(merge(wheel(8), wheel(12))).toEqual(wheel(20));
  });
  it("keeps discrete input, drags, direction changes, locations and geometry as barriers", () => {
    expect(
      merge(move(), { ...move(), type: "down" } as BrowserSurfaceInputRequest),
    ).toBeUndefined();
    expect(
      merge({ ...move(), buttons: 1 } as BrowserSurfaceInputRequest, move(30)),
    ).toBeUndefined();
    expect(merge(wheel(), wheel(-8))).toBeUndefined();
    expect(merge(wheel(), { ...wheel(), x: 21 } as BrowserSurfaceInputRequest)).toBeUndefined();
    expect(merge(wheel(), { ...wheel(), geometryRevision: 2 })).toBeUndefined();
    expect(merge(wheel(), move())).toBeUndefined();
  });
  it("cannot hide invalid input or exceed the wheel contract", () => {
    expect(merge({ ...move(), x: NaN } as BrowserSurfaceInputRequest, move())).toBeUndefined();
    expect(merge({ ...move(), x: -1 } as BrowserSurfaceInputRequest, move())).toBeUndefined();
    expect(merge(wheel(Infinity), wheel())).toBeUndefined();
    expect(merge(wheel(60000), wheel(60000))).toBeUndefined();
  });
});
