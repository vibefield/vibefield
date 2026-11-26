// EY-1 (2026-11-19) — a call window's pacing pins: inside a window the page is its own size, awake and painting, under
// the transport's ceiling; at the close it returns to the demand as it then stands; steps come in the producer's order.
import { describe, expect, it } from "vitest";
import { pacingFor, pacingSteps } from "../src/main/pages/core/pins";
import { CALL_WINDOW_PINS, type PacingDemand } from "../src/main/pages/core/types";

const PAUSED: PacingDemand = {
  mode: "paused",
  fps: 1,
  maxFps: 60,
  captureScale: 0.5,
  mobile: false,
};
const LIVE: PacingDemand = { mode: "live", fps: 15, maxFps: 60, captureScale: 0.5, mobile: false };

describe("a call window's pacing pins", () => {
  it("no window: the demand's pacing (paused: 1 fps, no painting; live: its fps and capture scale)", () => {
    expect(pacingFor(PAUSED, false)).toEqual({ captureScale: 0.5, frameRate: 1, painting: false });
    expect(pacingFor(LIVE, false)).toEqual({ captureScale: 0.5, frameRate: 15, painting: true });
    // the cpu-bgra transport's ceiling holds outside a window too
    expect(pacingFor({ ...LIVE, fps: 60, maxFps: 10 }, false).frameRate).toBe(10);
  });

  it("a window: scale 1, frame rate at least the floor, painting on", () => {
    expect(CALL_WINDOW_PINS.minFrameRate).toBe(30);
    expect(pacingFor(PAUSED, true)).toEqual({ captureScale: 1, frameRate: 30, painting: true });
    expect(pacingFor(LIVE, true)).toEqual({ captureScale: 1, frameRate: 30, painting: true });
    expect(pacingFor({ ...LIVE, fps: 60 }, true).frameRate).toBe(60);
    const pins = { ...CALL_WINDOW_PINS, minFrameRate: 45 };
    expect(pacingFor(LIVE, true, pins).frameRate).toBe(45);
    // the floor never passes the transport's ceiling
    expect(pacingFor({ ...PAUSED, maxFps: 10 }, true).frameRate).toBe(10);
  });

  it("a mobile page's scale is never pinned", () => {
    const phone: PacingDemand = { ...LIVE, mobile: true, captureScale: 0.75 };
    expect(pacingFor(phone, true)).toEqual({ captureScale: 0.75, frameRate: 30, painting: true });
    expect(pacingFor({ ...phone, mode: "paused", fps: 1 }, true)).toEqual({
      captureScale: 0.75,
      frameRate: 30,
      painting: true,
    });
  });

  it("wake and rest steps come in the producer's order, only for what differs", () => {
    const rest = pacingFor(PAUSED, false);
    const awake = pacingFor(PAUSED, true);
    expect(pacingSteps(rest, awake)).toEqual([
      { kind: "frame-rate", fps: 30 },
      { kind: "metrics", captureScale: 1 },
      { kind: "painting", on: true },
    ]);
    expect(pacingSteps(awake, rest)).toEqual([
      { kind: "metrics", captureScale: 0.5 },
      { kind: "frame-rate", fps: 1 },
      { kind: "painting", on: false },
    ]);
    // a live page at its own size and above the floor moves nothing
    const full: PacingDemand = { ...LIVE, fps: 60, captureScale: 1 };
    expect(pacingSteps(pacingFor(full, false), pacingFor(full, true))).toEqual([]);
  });

  it("a demand change inside a window keeps the pins; close restores the demand as it then stands", () => {
    const open = pacingFor({ ...LIVE, fps: 60 }, true);
    // the person's pane goes to rest while the agent acts: the page stays pinned and painting
    const pausedInside = pacingFor(PAUSED, true);
    expect(pausedInside).toEqual({ captureScale: 1, frameRate: 30, painting: true });
    expect(pacingSteps(open, pausedInside)).toEqual([{ kind: "frame-rate", fps: 30 }]);
    // the close goes to the demand as it reads now, not as it read at open
    const closed = pacingFor(PAUSED, false);
    expect(pacingSteps(pausedInside, closed)).toEqual([
      { kind: "metrics", captureScale: 0.5 },
      { kind: "frame-rate", fps: 1 },
      { kind: "painting", on: false },
    ]);
    const smaller = pacingFor({ ...LIVE, captureScale: 0.25 }, false);
    expect(pacingSteps(pacingFor(LIVE, true), smaller)).toEqual([
      { kind: "frame-rate", fps: 15 },
      { kind: "metrics", captureScale: 0.25 },
    ]);
  });

  it("device is re-sent only when the journal's emulation row is non-empty", () => {
    const rest = pacingFor(PAUSED, false);
    const awake = pacingFor(PAUSED, true);
    expect(pacingSteps(rest, awake).some((s) => s.kind === "device")).toBe(false);
    expect(pacingSteps(awake, rest, { emulationTouched: true })).toEqual([
      { kind: "metrics", captureScale: 0.5 },
      { kind: "device" },
      { kind: "frame-rate", fps: 1 },
      { kind: "painting", on: false },
    ]);
    // nothing else moves: the device alone
    expect(pacingSteps(awake, awake, { emulationTouched: true })).toEqual([{ kind: "device" }]);
  });
});
