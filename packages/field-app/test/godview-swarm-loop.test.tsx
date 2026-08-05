// @vitest-environment happy-dom
/**
 * THE SWARM'S LOOP (GT-3p, GT-D15.2/3).
 *
 * Three claims, each of which the old loop would fail:
 *
 *   1. the engine steps at `physicsHz` and NOT at the display's rate — the
 *      whole decoupling, measured by counting `Engine.update` against a driven
 *      clock rather than by reading the source;
 *   2. render interpolates between solved states, so a frame BETWEEN two steps
 *      still moves the bubble — a fixed timestep without interpolation would
 *      hold position and stutter, which is the regression this must not be;
 *   3. DOM writes are damage-gated: a frame where nothing moved writes nothing.
 *
 * The real matter engine runs here (GT-3m finding 1: it needs no stub under
 * happy-dom, being pure physics), so what is asserted is the real schedule.
 */

import Matter from "matter-js";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readMonitorPalette } from "../src/godview/monitor/monitor-palette";
import type { MonitorAgent } from "../src/godview/monitor/types";
import { AgentSwarm } from "../src/godview/views/swarm/AgentSwarm";
import { DEFAULT_SWARM_PARAMETERS } from "../src/godview/views/swarm/swarm-parameters";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let container: HTMLElement | null = null;
/** The driven clock and frame queue: rAF is replaced so a test decides exactly
 * how much time passes between frames, which is the only way to make a claim
 * about a rate. */
let now = 0;
let frameCallbacks: Array<(time: number) => void> = [];

function agent(id: string): MonitorAgent {
  return {
    id,
    session: { id },
    project: "vibe-field",
    detail: "working",
    status: "working",
    color: "#6366f1",
    active: false,
    agent: null,
    attachment: null,
  } as unknown as MonitorAgent;
}

/** Advance one animation frame by `deltaMs`, running whatever rAF holds. */
function frame(deltaMs: number): void {
  now += deltaMs;
  const due = frameCallbacks;
  frameCallbacks = [];
  act(() => {
    for (const callback of due) callback(now);
  });
}

function mount(parameters: Record<string, number>): void {
  container = document.createElement("div");
  // happy-dom reports 0 for every measured box, and the loop's spawn placement
  // and wall geometry both read the container. A fixed, honest size keeps the
  // physics in a real arena rather than a degenerate one.
  Object.defineProperty(container, "clientWidth", { value: 800, configurable: true });
  Object.defineProperty(container, "clientHeight", { value: 400, configurable: true });
  document.body.appendChild(container);
  root = createRoot(container);
  act(() =>
    root?.render(
      <AgentSwarm
        agents={[agent("a"), agent("b")]}
        parameters={{ ...DEFAULT_SWARM_PARAMETERS, ...parameters }}
        actions={{ select: vi.fn(), createAt: vi.fn() }}
        palette={readMonitorPalette()}
      />,
    ),
  );
}

beforeEach(() => {
  now = 0;
  frameCallbacks = [];
  vi.stubGlobal("requestAnimationFrame", (callback: (time: number) => void) => {
    frameCallbacks.push(callback);
    return frameCallbacks.length;
  });
  vi.stubGlobal("cancelAnimationFrame", () => undefined);
  vi.spyOn(performance, "now").mockImplementation(() => now);
});

afterEach(() => {
  act(() => root?.unmount());
  root = null;
  container?.remove();
  container = null;
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("the swarm's fixed-timestep loop (GT-D15.2)", () => {
  // The rates and frame deltas below divide EXACTLY in binary floating point
  // (25Hz is a 40ms step, 50Hz a 20ms one, driven by 10ms frames). A 120Hz
  // display against a 30Hz engine is the real-world case, but 1000/120 and
  // 1000/30 do not divide exactly, and an accumulator one ulp short of a step
  // boundary makes the count land either side of the truth — a test about a
  // SCHEDULE should not also be a test about rounding.
  it("steps the engine at physicsHz, not once per painted frame", () => {
    const update = vi.spyOn(Matter.Engine, "update");
    mount({ physicsHz: 25 });
    update.mockClear();

    // Twelve frames × 10ms = 120ms of real time. At 25Hz that is three steps,
    // not twelve — the decoupling, stated as a number.
    for (let index = 0; index < 12; index += 1) frame(10);

    expect(update).toHaveBeenCalledTimes(3);
    // And every step used the FIXED delta, never the frame's own.
    for (const call of update.mock.calls) {
      expect(call[1]).toBeCloseTo(40, 6);
    }
  });

  it("tracks the rate: the same wall-clock at 50Hz solves twice as often", () => {
    const update = vi.spyOn(Matter.Engine, "update");
    mount({ physicsHz: 50 });
    update.mockClear();

    for (let index = 0; index < 12; index += 1) frame(10);

    expect(update).toHaveBeenCalledTimes(6);
  });

  it("caps catch-up after a stall instead of spiralling through the backlog", () => {
    const update = vi.spyOn(Matter.Engine, "update");
    mount({ physicsHz: 60 });
    update.mockClear();

    // A two-second stall — a hidden window, a suspended machine. Unbounded,
    // this would be 120 steps in one frame and every frame after it late.
    frame(2_000);

    expect(update.mock.calls.length).toBeLessThanOrEqual(5);
  });

  it("interpolates between solved states, so a frame between steps still moves", () => {
    mount({ physicsHz: 30, gravityPull: 0.004 });
    // One step, so the bodies have a velocity and a history to blend across.
    frame(1000 / 30);
    const positioner = container?.querySelector<HTMLElement>(".vf-monitor-bubble-positioner");
    const afterStep = positioner?.style.transform;

    // A frame that solves NOTHING (well under one step). Without interpolation
    // the transform would be byte-identical; with it the bubble keeps moving.
    frame(1000 / 120);
    const betweenSteps = positioner?.style.transform;

    expect(afterStep).toBeTruthy();
    expect(betweenSteps).not.toEqual(afterStep);
  });
});

describe("damage-gated DOM writes (GT-D15.3)", () => {
  it("writes nothing on a frame where no body moved", () => {
    // No gravity and no motion: the swarm is asleep, which is what it is for
    // most of its life on screen.
    mount({ physicsHz: 30, gravityPull: 0, frictionAir: 0.2 });
    // Let it settle: spawn writes and any residual drift are spent here.
    for (let index = 0; index < 40; index += 1) frame(1000 / 60);

    const positioner = container?.querySelector<HTMLElement>(".vf-monitor-bubble-positioner");
    if (!positioner) throw new Error("no bubble mounted");

    // Spy on the style setter itself: the claim is about WRITES, and a test
    // that compared values could not tell a skipped write from a rewritten
    // identical one — which is the entire difference this slice bought.
    let writes = 0;
    const style = positioner.style;
    const original = Object.getOwnPropertyDescriptor(
      Object.getPrototypeOf(style),
      "transform",
    ) as PropertyDescriptor;
    Object.defineProperty(style, "transform", {
      configurable: true,
      get: () => original.get?.call(style),
      set: (value: string) => {
        writes += 1;
        original.set?.call(style, value);
      },
    });

    for (let index = 0; index < 10; index += 1) frame(1000 / 60);

    expect(writes).toBe(0);
  });
});
