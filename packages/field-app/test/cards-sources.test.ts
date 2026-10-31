// @vitest-environment node
/**
 * HN-D2 — where a snapshot's card leaves from (frame/cards/cards-sources.ts `captureFrom`): the
 * region the tool kept, mapped from the shell's screen DIP bounds into this window. PURE — the
 * cases the clipboard tray's fly-in held for the same mapping (its suite at e23fa8a1f): a window
 * away from the screen's origin, a region elsewhere on the screen, and no bounds to map.
 */
import { describe, expect, it } from "vitest";
import { captureFrom } from "../src/frame/cards/cards-sources";

/** A window 1180 × 780 whose top-left stands at (100, 50) on the screen. */
const WIN = { screenX: 100, screenY: 50, innerWidth: 1180, innerHeight: 780 };

describe("where a snapshot's card leaves from (captureFrom)", () => {
  it("maps a region inside the window by the window's place on the screen — its size kept", () => {
    expect(captureFrom({ x: 300, y: 200, width: 600, height: 375 }, WIN)).toEqual({
      left: 200,
      top: 150,
      width: 600,
      height: 375,
    });
    // a region only partly over the window still leaves from where it was taken
    expect(captureFrom({ x: 40, y: 20, width: 200, height: 100 }, WIN)).toEqual({
      left: -60,
      top: -30,
      width: 200,
      height: 100,
    });
  });

  it("deals from where the card will stand when the region lies elsewhere on the screen", () => {
    expect(captureFrom({ x: -5_000, y: 200, width: 600, height: 375 }, WIN)).toBeNull();
    // past the window's right and bottom edges, by its place on the screen and not by its origin
    expect(captureFrom({ x: 1_280, y: 200, width: 100, height: 100 }, WIN)).toBeNull();
    expect(captureFrom({ x: 300, y: 830, width: 100, height: 100 }, WIN)).toBeNull();
    // touching the window's left edge from outside is not inside it
    expect(captureFrom({ x: 0, y: 200, width: 100, height: 100 }, WIN)).toBeNull();
  });

  it("deals from where the card will stand with no bounds to map, or a region with no size", () => {
    expect(captureFrom(undefined, WIN)).toBeNull();
    expect(captureFrom({ x: 300, y: 200, width: 0, height: 375 }, WIN)).toBeNull();
    expect(captureFrom({ x: 300, y: 200, width: 600, height: 0 }, WIN)).toBeNull();
  });
});
