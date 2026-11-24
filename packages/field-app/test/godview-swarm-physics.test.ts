// @vitest-environment node
import {
  createSwarmPhysicsHost,
  FRAME_COUNT_INDEX,
  FRAME_HEADER_FLOATS,
  FRAME_STRIDE,
  isSwarmFrame,
  type SwarmAgentSpec,
} from "@vibefield/puppeteer-views/physics";
import { expect, it } from "vitest";

const bounds = { width: 1164, height: 748 };
const obstacles = [
  { x: 0, y: 0, width: bounds.width, height: 56 },
  { x: 10, y: 64, width: 62, height: 142 },
  { x: bounds.width - 72, y: 65, width: 60, height: 52 },
];
const defaults = { physicsHz: 30, frictionAir: 0.2, gravityPull: 0.0002, restitution: 0 };
const idle: SwarmAgentSpec = { id: "alone", radius: 28 };

// Use the same command and frame boundary as the desktop worker. The clock
// advances in simulation time, independently of the speed of the test runner.
function simulation(agents: SwarmAgentSpec[], parameters = defaults, holdBuffers = false) {
  let now = 0;
  let seed = 13;
  let frames = 0;
  let last = new Float32Array();
  const held: Float32Array[] = [];
  const host = createSwarmPhysicsHost({
    now: () => now,
    random: () => {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      return seed / 4294967296;
    },
    post(message) {
      if (!isSwarmFrame(message)) return;
      last = message.slice();
      frames++;
      if (holdBuffers) held.push(message);
      else host.handle({ type: "releaseFrame", buffer: message });
    },
  });
  host.handle({
    type: "init",
    agents,
    parameters,
    bounds,
    obstacles,
    floor: 288,
    reducedMotion: false,
  });
  function advance(ms: number) {
    const end = now + ms;
    while (now < end) {
      now = Math.min(end, now + 1000 / 120);
      host.pump(now);
    }
  }
  return { host, advance, held, frame: () => last, count: () => frames };
}

function topToBottom(frame: Float32Array, count: number) {
  const ys = Array.from(
    { length: count },
    (_, i) => frame[FRAME_HEADER_FLOATS + i * FRAME_STRIDE + 1]!,
  );
  return Math.max(...ys) - Math.min(...ys);
}

it.each([15, 30, 120])(
  "settles a crowded terminal lift and responds to reopening at %i Hz",
  { timeout: 15_000 },
  (physicsHz) => {
    const radii = [50, 50, 50, 60, 75];
    const agents = Array.from({ length: 40 }, (_, i) => ({
      id: String(i),
      radius: radii[i % radii.length]! * 0.56,
    }));
    const sim = simulation(agents, { ...defaults, physicsHz });
    try {
      sim.advance(6000);
      const before = topToBottom(sim.frame(), agents.length);
      for (let tick = 1; tick <= 12; tick++) {
        sim.host.handle({ type: "updateFloor", floor: 288 - (64 * tick) / 12 });
        sim.advance(1000 / 30);
      }
      sim.advance(12000);
      const compressed = topToBottom(sim.frame(), agents.length);
      expect(compressed).toBeLessThan(before - 20);
      const last = sim.frame();
      const count = sim.count();
      sim.advance(4000);
      expect(sim.frame()).toEqual(last);
      expect(sim.count()).toBe(count);
      expect(sim.host.ticking).toBe(false);

      sim.host.handle({ type: "updateFloor", floor: 420 });
      expect(sim.host.ticking).toBe(true);
      expect(sim.frame()).toEqual(last);
      sim.advance(1200);
      expect(topToBottom(sim.frame(), agents.length)).toBeGreaterThan(compressed + 20);
    } finally {
      sim.host.dispose();
    }
  },
);

it("wakes on changed physical inputs and keeps identical measurements and rows quiet", () => {
  const sim = simulation([idle]);
  const send = sim.host.handle;
  try {
    sim.advance(2000);
    send({ type: "updateFloor", floor: 288 });
    send({ type: "updateBounds", bounds: { ...bounds } });
    send({ type: "updateParameters", parameters: { ...defaults } });
    send({ type: "updateAgents", agents: [{ ...idle }] });
    send({ type: "updateObstacles", obstacles: obstacles.map((rect) => ({ ...rect })) });
    expect(sim.host.ticking).toBe(false);
    const center = { x: bounds.width / 2, y: 144 };
    send({ type: "dragStart", id: idle.id, point: center });
    send({ type: "dragMove", id: idle.id, point: { x: center.x + 120, y: center.y } });
    sim.advance(3000);
    expect(sim.host.ticking).toBe(true);
    expect(sim.frame()[FRAME_HEADER_FLOATS]).toBeGreaterThan(center.x + 90);
    send({ type: "dragEnd", id: idle.id });
    sim.advance(8000);
    expect(sim.host.ticking).toBe(false);
    send({ type: "nudge", id: idle.id });
    expect(sim.host.ticking).toBe(true);
    sim.advance(8000);
    expect(sim.host.ticking).toBe(false);
    send({ type: "updateAgents", agents: [{ ...idle, radius: 40 }] });
    sim.advance(2000);
    expect(sim.frame()[FRAME_HEADER_FLOATS + 2]).toBe(40);
    expect(sim.host.ticking).toBe(false);
    send({
      type: "updateObstacles",
      obstacles: [...obstacles, { x: center.x - 15, y: center.y - 8, width: 30, height: 16 }],
    });
    expect(sim.host.ticking).toBe(true);
    sim.advance(2000);
    expect(Math.abs(sim.frame()[FRAME_HEADER_FLOATS + 1]! - center.y)).toBeGreaterThan(20);
  } finally {
    sim.host.dispose();
  }
});

it("delivers the settled frame when both transfer buffers were held", () => {
  const sim = simulation([{ ...idle, spawnHint: { x: 250, y: 144 } }], defaults, true);
  try {
    sim.advance(10000);
    expect(sim.host.ticking).toBe(false);
    expect(sim.held).toHaveLength(2);
    sim.host.handle({ type: "releaseFrame", buffer: sim.held.shift()! });
    expect(sim.count()).toBe(3);
    expect(sim.frame()[FRAME_HEADER_FLOATS]).toBeCloseTo(bounds.width / 2, 1);
    sim.host.handle({ type: "releaseFrame", buffer: sim.held.shift()! });
    expect(sim.count()).toBe(3);
  } finally {
    sim.host.dispose();
  }
});

it("applies changes made while paused and resumes on a fresh clock", () => {
  const sim = simulation([idle]);
  const send = sim.host.handle;
  try {
    sim.advance(2000);
    expect(sim.host.ticking).toBe(false);
    const x = sim.frame()[FRAME_HEADER_FLOATS]!;
    const frames = sim.count();
    send({ type: "pause" });
    send({ type: "updateBounds", bounds: { ...bounds, width: bounds.width + 200 } });
    sim.advance(60_000);
    expect(sim.count()).toBe(frames);
    send({ type: "resume" });
    expect(sim.host.ticking).toBe(true);
    sim.advance(40);
    const first = sim.frame()[FRAME_HEADER_FLOATS]!;
    expect(first).toBeGreaterThan(x);
    expect(first).toBeLessThan(x + 15);
    sim.advance(10000);
    expect(sim.host.ticking).toBe(false);
    expect(sim.frame()[FRAME_HEADER_FLOATS]).toBeCloseTo(x + 100, 1);
    send({ type: "updateAgents", agents: [idle, { id: "arrival", radius: 28 }] });
    expect(sim.frame()[FRAME_COUNT_INDEX]).toBe(2);
    expect(sim.host.ticking).toBe(true);
  } finally {
    sim.host.dispose();
  }
});

it.each([1, 2])("lets a free group of %i drift under a weak pull", (count) => {
  // The pair has a horizontal contact while both bodies travel vertically.
  const agents = Array.from({ length: count }, (_, i) => ({
    id: String(i),
    radius: 28,
    spawnHint: { x: 551 + i * 62, y: 221 },
  }));
  const sim = simulation(agents, { ...defaults, gravityPull: 1e-8 });
  try {
    sim.advance(5000);
    expect(sim.host.ticking).toBe(true);
    expect(sim.frame()[FRAME_HEADER_FLOATS + 1]).toBeLessThan(221);
  } finally {
    sim.host.dispose();
  }
});
