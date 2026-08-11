// @vitest-environment node
/**
 * THE SWARM'S PHYSICS, ALONE (GT-3c, GT-D16).
 *
 * No worker, no DOM, no React — which is the claim this file makes before it
 * makes any other one. The module under test imports matter and nothing else,
 * so it can be hosted in a thread that has no document; if that ever stops being
 * true, this file stops loading (its environment is `node`, deliberately, rather
 * than the happy-dom the rest of the suite runs in).
 *
 * What it holds:
 *   1. the fixed timestep — step COUNTS against a driven clock, and the stall cap
 *   2. the 15Hz floor, clamped here and not only at the slider (GT-D15.2)
 *   3. determinism — same seed, same steps, same field
 *   4. the drag spring: added, followed, released, and immune to gravity
 *   5. membership — what counts as a new id-table and what does not
 *   6. the frame buffer's layout, and point queries for the renderer to come
 */

import Matter from "matter-js";
import { describe, expect, it, vi } from "vitest";
import { SWARM_PARAMETER_GROUPS } from "../src/godview/views/swarm/swarm-parameters";
import {
  FRAME_COUNT_INDEX,
  FRAME_GENERATION_INDEX,
  FRAME_HEADER_FLOATS,
  FRAME_STRIDE,
  FRICTION_AIR_CEILING,
  frameFloatsFor,
  PHYSICS_HZ_FLOOR,
  type SwarmAgentSpec,
  SwarmPhysics,
  type SwarmPhysicsParameters,
} from "../src/godview/views/swarm/swarm-physics";

const PARAMETERS: SwarmPhysicsParameters = {
  gravityPull: 0.0002,
  restitution: 0,
  frictionAir: 0.2,
  physicsHz: 30,
};

/** A fixed, ugly-on-purpose sequence: spawn placement and the click nudge both
 * draw from it, so "deterministic" means the same field twice rather than the
 * same field by luck. */
function sequence(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state * 1664525 + 1013904223) % 4294967296;
    return state / 4294967296;
  };
}

function build(
  overrides: Partial<SwarmPhysicsParameters> = {},
  agents: readonly SwarmAgentSpec[] = [
    { id: "a", radius: 50 },
    { id: "b", radius: 50 },
  ],
): SwarmPhysics {
  return new SwarmPhysics({
    parameters: { ...PARAMETERS, ...overrides },
    bounds: { width: 800, height: 400 },
    agents,
    random: sequence(7),
  });
}

/** Drive `frames` animation frames of `deltaMs` each, from a seeded clock. */
function drive(physics: SwarmPhysics, frames: number, deltaMs: number): number {
  let now = 0;
  physics.seed(now);
  let steps = 0;
  for (let index = 0; index < frames; index += 1) {
    now += deltaMs;
    steps += physics.advance(now);
  }
  return steps;
}

/** Let an already-seeded world run on for `frames` frames at 30Hz. */
function settle(physics: SwarmPhysics, frames: number): void {
  let now = 0;
  for (let index = 0; index < frames; index += 1) {
    now += 1000 / 30;
    physics.advance(now);
  }
}

function positions(physics: SwarmPhysics): number[] {
  const buffer = new Float32Array(frameFloatsFor(physics.ids().length));
  physics.writeFrame(buffer);
  return [...buffer];
}

/** The lab's own air-friction control. Read rather than restated, so a raised
 * ceiling reaches the stability arithmetic instead of sliding past it. */
function frictionControl(): { min: number; max: number } {
  const control = SWARM_PARAMETER_GROUPS.flatMap((group) => group.controls).find(
    (candidate) => candidate.key === "frictionAir",
  );
  if (control === undefined) throw new Error("the swarm panel has no air-friction control");
  return { min: control.min, max: control.max };
}

/** What matter is actually holding, which is the only thing the clamp is about
 * — a parameter object that agreed with itself would prove nothing. */
function bodyFriction(physics: SwarmPhysics): number {
  const bodies = (physics as unknown as { bodies: Map<string, { body: Matter.Body }> }).bodies;
  const first = [...bodies.values()][0];
  if (first === undefined) throw new Error("no bodies");
  return first.body.frictionAir;
}

describe("the fixed timestep, off the main thread (GT-D15.2)", () => {
  it("steps at physicsHz rather than once per pump", () => {
    const update = vi.spyOn(Matter.Engine, "update");
    const physics = build({ physicsHz: 25 });
    update.mockClear();

    // Twelve pumps × 10ms = 120ms of real time. At 25Hz that is three steps,
    // not twelve — the decoupling, stated as a number.
    expect(drive(physics, 12, 10)).toBe(3);
    expect(update).toHaveBeenCalledTimes(3);
    for (const call of update.mock.calls) expect(call[1]).toBeCloseTo(40, 6);

    update.mockRestore();
    physics.dispose();
  });

  it("tracks the rate: the same wall-clock at 50Hz solves twice as often", () => {
    const physics = build({ physicsHz: 50 });
    expect(drive(physics, 12, 10)).toBe(6);
    physics.dispose();
  });

  it("caps catch-up after a stall instead of spiralling through the backlog", () => {
    const physics = build({ physicsHz: 60 });
    // A two-second stall — a hidden window, a suspended machine. Unbounded this
    // would be 120 steps in one pump and every pump after it late.
    expect(drive(physics, 1, 2_000)).toBeLessThanOrEqual(5);
    physics.dispose();
  });

  it("solves nothing on its very first pump, because it has nothing to measure from", () => {
    // 25Hz against a 40ms delta, both exact in binary: an accumulator one ulp
    // short of a step boundary would put this count either side of the truth,
    // and this is a test about SEEDING rather than about rounding.
    const physics = build({ physicsHz: 25 });
    // Unseeded, the first pump has no previous timestamp; it must bank nothing
    // and solve nothing rather than treat the clock's whole history as a frame.
    expect(physics.advance(1_000)).toBe(0);
    expect(physics.advance(1_040)).toBe(1);
    physics.dispose();
  });
});

describe("the 15Hz floor is a stability law, not a preference (GT-D15.2)", () => {
  it("clamps a rate below the floor at construction and at every update", () => {
    const physics = build({ physicsHz: 4 });
    expect(physics.stepMs).toBeCloseTo(1000 / PHYSICS_HZ_FLOOR, 6);

    physics.setParameters({ ...PARAMETERS, physicsHz: 1 });
    expect(physics.stepMs).toBeCloseTo(1000 / PHYSICS_HZ_FLOOR, 6);

    // …and a rate above it is left alone: the ceiling costs, it does not
    // destabilise.
    physics.setParameters({ ...PARAMETERS, physicsHz: 120 });
    expect(physics.stepMs).toBeCloseTo(1000 / 120, 6);
    physics.dispose();
  });

  it("keeps matter's air friction POSITIVE at the floor, which is why the floor is there", () => {
    // The reason, restated as arithmetic rather than as a comment. Matter 0.19
    // scales air friction by the step against a 60Hz base, and the scaled term
    // goes negative — friction that ACCELERATES — once the step passes
    // `_baseDelta / frictionAir`. At the panel's maximum friction that is 83ms;
    // the floor's step is 66.7ms, which stays the right side of it.
    //
    // The worst case is DERIVED from the lab's own control (GT-5c). It was
    // hardcoded as `0.2`, so raising the slider's ceiling left this suite green
    // while friction went negative — the review's finding 14.
    const baseDelta = 1000 / 60;
    const worstFriction = frictionControl().max;
    const floorStepMs = 1000 / PHYSICS_HZ_FLOOR;
    expect(1 - worstFriction * (floorStepMs / baseDelta)).toBeGreaterThan(0);
    // One notch below the floor and the same sum is already negative.
    const belowStepMs = 1000 / (PHYSICS_HZ_FLOOR - 5);
    expect(1 - worstFriction * (belowStepMs / baseDelta)).toBeLessThan(0);
  });

  it("clamps air friction at construction and at every update, like the rate", () => {
    // The other half of the same inequality, and it was enforced only by the
    // view's normalizer — so any second caller of `setParameters` walked past
    // it. A law one side enforces is a law the next caller breaks.
    const physics = build({ frictionAir: 5 });
    expect(bodyFriction(physics)).toBeLessThanOrEqual(FRICTION_AIR_CEILING);

    physics.setParameters({ ...PARAMETERS, frictionAir: 99 });
    expect(bodyFriction(physics)).toBe(FRICTION_AIR_CEILING);

    physics.setParameters({ ...PARAMETERS, frictionAir: -1 });
    expect(bodyFriction(physics)).toBe(0);

    physics.setParameters({ ...PARAMETERS, frictionAir: Number.NaN });
    expect(bodyFriction(physics)).toBe(FRICTION_AIR_CEILING);

    // …and a value inside the range is left exactly alone.
    physics.setParameters({ ...PARAMETERS, frictionAir: 0.05 });
    expect(bodyFriction(physics)).toBeCloseTo(0.05, 6);
    physics.dispose();
  });

  it("declares the same ceiling in the lab as the physics enforces", () => {
    // The two are one number, stated once. If the slider's max ever drifts from
    // the clamp, the derivation above stops describing what a user can reach.
    expect(frictionControl().max).toBe(FRICTION_AIR_CEILING);
  });
});

describe("determinism", () => {
  it("puts the same field in the same place twice, from the same seed", () => {
    const first = build();
    const second = build();
    drive(first, 60, 1000 / 60);
    drive(second, 60, 1000 / 60);
    expect(positions(first)).toEqual(positions(second));
    first.dispose();
    second.dispose();
  });

  it("actually moved, so the comparison above is not two motionless fields", () => {
    const physics = build();
    const before = positions(physics);
    drive(physics, 60, 1000 / 60);
    expect(positions(physics)).not.toEqual(before);
    physics.dispose();
  });
});

describe("the drag spring", () => {
  it("adds on grab, follows the pointer, and releases on drop", () => {
    const physics = build({ gravityPull: 0 });
    physics.seed(0);
    expect(physics.isDragging("a")).toBe(false);

    const [startX, startY] = [positions(physics)[2] as number, positions(physics)[3] as number];
    physics.dragStart("a", { x: startX, y: startY });
    expect(physics.isDragging("a")).toBe(true);

    // Pull it a long way to one side and let the spring work.
    physics.dragMove("a", { x: startX + 200, y: startY });
    settle(physics, 30);
    const draggedX = positions(physics)[2] as number;
    expect(draggedX).toBeGreaterThan(startX + 50);

    physics.dragEnd("a");
    expect(physics.isDragging("a")).toBe(false);
    physics.dispose();
  });

  it("exempts a held bubble from the pull to centre, so it stays where it is put", () => {
    // The rule the old loop had inline (`if (!wrapper.dragConstraint)`) and the
    // reason it matters: gravity fighting the spring makes a held bubble creep.
    const physics = build({ gravityPull: 0.004 });
    physics.seed(0);
    const grabbed = { x: 700, y: 350 };
    physics.dragStart("a", {
      x: positions(physics)[2] as number,
      y: positions(physics)[3] as number,
    });
    physics.dragMove("a", grabbed);
    settle(physics, 90);

    const held = positions(physics);
    expect(held[2]).toBeCloseTo(grabbed.x, -1);
    expect(held[3]).toBeCloseTo(grabbed.y, -1);
    physics.dispose();
  });

  it("drops the spring when the agent leaves mid-drag", () => {
    const physics = build();
    physics.dragStart("a", { x: 100, y: 100 });
    expect(physics.isDragging("a")).toBe(true);
    physics.syncAgents([{ id: "b", radius: 50 }]);
    // The body is gone; a constraint pointing at it would be a leak with a
    // dangling reference on the end of it.
    expect(physics.isDragging("a")).toBe(false);
    expect(physics.ids()).toEqual(["b"]);
    physics.dispose();
  });
});

describe("membership and the id table", () => {
  it("reports a change for arrivals and departures, and NOT for a resize", () => {
    const physics = build();
    const generation = physics.generation;

    expect(
      physics.syncAgents([
        { id: "a", radius: 70 },
        { id: "b", radius: 50 },
      ]),
    ).toBe(false);
    // A radius is carried by every frame, so nobody above needs telling.
    expect(physics.generation).toBe(generation);

    expect(physics.syncAgents([{ id: "a", radius: 70 }])).toBe(true);
    expect(physics.generation).toBeGreaterThan(generation);
    expect(physics.ids()).toEqual(["a"]);

    expect(
      physics.syncAgents([
        { id: "a", radius: 70 },
        { id: "c", radius: 40 },
      ]),
    ).toBe(true);
    expect(physics.ids()).toEqual(["a", "c"]);
    physics.dispose();
  });

  it("grows a body toward its new radius rather than snapping it", () => {
    const physics = build({ gravityPull: 0 }, [{ id: "a", radius: 40 }]);
    expect(positions(physics)[4]).toBeCloseTo(40, 6);
    physics.syncAgents([{ id: "a", radius: 70 }]);
    // The scale is applied inside a step, so it takes one to land.
    expect(positions(physics)[4]).toBeCloseTo(40, 6);
    drive(physics, 1, 1000 / 30);
    expect(positions(physics)[4]).toBeCloseTo(70, 6);
    physics.dispose();
  });

  it("places a spawn hint where the gesture happened, clamped into the arena", () => {
    const physics = new SwarmPhysics({
      parameters: PARAMETERS,
      bounds: { width: 800, height: 400 },
      agents: [{ id: "a", radius: 50, spawnHint: { x: 640, y: 300 } }],
      random: sequence(1),
    });
    const frame = positions(physics);
    expect(frame[2]).toBeCloseTo(640, 6);
    expect(frame[3]).toBeCloseTo(300, 6);
    physics.dispose();
  });
});

describe("the frame buffer", () => {
  it("writes a header and then x, y, radius per body in table order", () => {
    const physics = build({ gravityPull: 0 }, [
      { id: "a", radius: 40, spawnHint: { x: 100, y: 120 } },
      { id: "b", radius: 60, spawnHint: { x: 300, y: 200 } },
    ]);
    const buffer = new Float32Array(frameFloatsFor(2));
    physics.writeFrame(buffer);

    expect(buffer[FRAME_GENERATION_INDEX]).toBe(physics.generation);
    expect(buffer[FRAME_COUNT_INDEX]).toBe(2);
    expect(buffer[FRAME_HEADER_FLOATS]).toBeCloseTo(100, 4);
    expect(buffer[FRAME_HEADER_FLOATS + 1]).toBeCloseTo(120, 4);
    expect(buffer[FRAME_HEADER_FLOATS + 2]).toBeCloseTo(40, 4);
    expect(buffer[FRAME_HEADER_FLOATS + FRAME_STRIDE]).toBeCloseTo(300, 4);
    expect(buffer[FRAME_HEADER_FLOATS + FRAME_STRIDE + 2]).toBeCloseTo(60, 4);
    physics.dispose();
  });
});

describe("point queries — for the renderer that has no elements to hit (GT-D16)", () => {
  it("names the bubble under a point and nothing under an empty one", () => {
    const physics = build({ gravityPull: 0 }, [
      { id: "a", radius: 40, spawnHint: { x: 120, y: 120 } },
      { id: "b", radius: 40, spawnHint: { x: 400, y: 300 } },
    ]);
    expect(physics.queryPoint({ x: 120, y: 120 })).toBe("a");
    expect(physics.queryPoint({ x: 400, y: 300 })).toBe("b");
    expect(physics.queryPoint({ x: 700, y: 60 })).toBeNull();
    // Just outside the drawn edge plus its collision gap.
    expect(physics.queryPoint({ x: 120 + 46, y: 120 })).toBeNull();
    physics.dispose();
  });
});

describe("disposal", () => {
  it("clears the engine and forgets every body", () => {
    const clear = vi.spyOn(Matter.Engine, "clear");
    const physics = build();
    physics.dispose();
    expect(clear).toHaveBeenCalled();
    expect(physics.ids()).toEqual([]);
    clear.mockRestore();
  });
});
