/**
 * THE DRIVER'S CHOICE OF HOME, and how it finds out it was wrong (GT-3c, GT-5c).
 *
 * `new Worker(...)` resolves synchronously and proves nothing: the module is
 * fetched and evaluated afterwards, so a missing chunk in a packaged build or a
 * CSP regression fails LATER, on the `error` listener — which only logged. The
 * result was a motionless swarm under a mode marker reading `worker`, and the
 * smoke row built to catch exactly that certifying it as healthy (the review's
 * finding 9).
 *
 * The worker now posts `ready` from its module scope and the driver watches for
 * it. What is exercised here is the watchdog and the replay, with a stub Worker
 * standing in for the real one — happy-dom defines none.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createSwarmPhysicsDriver,
  currentSwarmPhysicsMode,
} from "../src/godview/views/swarm/swarm-physics-driver";
import type {
  SwarmPhysicsCommand,
  SwarmPhysicsEvent,
} from "../src/godview/views/swarm/swarm-physics-protocol";

const INIT: SwarmPhysicsCommand = {
  type: "init",
  agents: [{ id: "a", radius: 50 }],
  parameters: { gravityPull: 0.0002, restitution: 0, frictionAir: 0.2, physicsHz: 30 },
  bounds: { width: 800, height: 400 },
  obstacles: [],
  reducedMotion: false,
};

/** Every stub built in a test, so a test can speak to the one its driver holds. */
let workers: StubWorker[] = [];

class StubWorker {
  readonly posted: unknown[] = [];
  terminated = false;
  private readonly listeners = new Map<string, ((event: unknown) => void)[]>();

  constructor() {
    workers.push(this);
  }

  addEventListener(type: string, listener: (event: unknown) => void): void {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener]);
  }

  postMessage(message: unknown): void {
    this.posted.push(message);
  }

  terminate(): void {
    this.terminated = true;
  }

  /** What a live worker does the moment its module finishes evaluating. */
  announceReady(): void {
    this.emit("message", { data: { type: "ready" } });
  }

  emit(type: string, event: unknown): void {
    for (const listener of this.listeners.get(type) ?? []) listener(event);
  }
}

function driver(): ReturnType<typeof createSwarmPhysicsDriver> {
  return createSwarmPhysicsDriver({ onEvent: () => undefined, onFrame: () => undefined });
}

beforeEach(() => {
  workers = [];
  vi.useFakeTimers();
  (globalThis as { Worker?: unknown }).Worker = StubWorker;
});

afterEach(() => {
  vi.useRealTimers();
  (globalThis as { Worker?: unknown }).Worker = undefined;
});

describe("a worker that never loads", () => {
  it("is demoted to the inline driver, and the MODE says so", () => {
    const swarm = driver();
    expect(swarm.mode).toBe("worker");
    expect(currentSwarmPhysicsMode()).toBe("worker");

    swarm.post(INIT);
    vi.advanceTimersByTime(10_000);

    // The whole finding: without this the field stands still while the marker
    // the smoke reads certifies `worker`.
    expect(swarm.mode).toBe("inline");
    expect(currentSwarmPhysicsMode()).toBe("inline");
    expect(workers[0]?.terminated).toBe(true);
    swarm.dispose();
  });

  it("replays the WORLD into the driver that takes over", () => {
    const events: SwarmPhysicsEvent[] = [];
    const swarm = createSwarmPhysicsDriver({
      onEvent: (event) => events.push(event),
      onFrame: () => undefined,
    });
    swarm.post(INIT);
    swarm.post({
      type: "updateAgents",
      agents: [
        { id: "a", radius: 50 },
        { id: "b", radius: 50 },
      ],
    });
    // A gesture is deliberately NOT replayed: a pointer that was down four
    // seconds ago is not down now, and a query nobody is still waiting for
    // would answer against a stale requestId.
    swarm.post({ type: "dragStart", id: "a", point: { x: 1, y: 1 } });
    expect(events).toEqual([]);

    vi.advanceTimersByTime(10_000);

    expect(swarm.mode).toBe("inline");
    // An inline host with no `init` publishes nothing at all, so an id table
    // arriving IS the proof that the world crossed over — and the LAST one's
    // ids are what the last `updateAgents` named, which is the proof that the
    // replay is the current world and not just its opening state.
    const tables = events.filter((event) => event.type === "idTable");
    expect(tables).toHaveLength(2);
    expect(tables[0]?.type === "idTable" && tables[0].ids).toEqual(["a"]);
    expect(tables[1]?.type === "idTable" && tables[1].ids).toEqual(["a", "b"]);
    // …and the new host is genuinely live, answering the commands that follow.
    swarm.post({ type: "queryPoint", point: { x: -1_000, y: -1_000 }, requestId: 7 });
    expect(events.at(-1)).toEqual({ type: "queryResult", requestId: 7, id: null });
    swarm.dispose();
  });

  it("demotes on an async load error too, not only on the deadline", () => {
    const swarm = driver();
    swarm.post(INIT);
    workers[0]?.emit("error", { message: "Failed to fetch dynamically imported module" });

    expect(swarm.mode).toBe("inline");
    expect(workers[0]?.terminated).toBe(true);
    swarm.dispose();
  });
});

describe("a worker that does load", () => {
  it("stays the worker, and the watchdog stands down", () => {
    const swarm = driver();
    swarm.post(INIT);
    workers[0]?.announceReady();

    vi.advanceTimersByTime(10_000);

    expect(swarm.mode).toBe("worker");
    expect(currentSwarmPhysicsMode()).toBe("worker");
    expect(workers[0]?.terminated).toBe(false);
    // Commands still went to the worker all along — the replay buffer is a
    // copy, never a diversion.
    expect(workers[0]?.posted[0]).toBe(INIT);
    swarm.dispose();
  });

  it("keeps a LATE death loud rather than silently falling back", () => {
    // A worker that was live and then died takes the swarm's motion with it and
    // there is no honest way to hide that; rebuilding one would mean replaying
    // a whole world mid-gesture. Recorded residual, unchanged by GT-5c.
    const swarm = driver();
    swarm.post(INIT);
    workers[0]?.announceReady();
    workers[0]?.emit("error", { message: "worker died" });

    expect(swarm.mode).toBe("worker");
    expect(workers[0]?.terminated).toBe(false);
    swarm.dispose();
  });

  it("disposes the thread and clears the published mode", () => {
    const swarm = driver();
    workers[0]?.announceReady();
    swarm.dispose();
    expect(workers[0]?.terminated).toBe(true);
    expect(currentSwarmPhysicsMode()).toBe("none");
  });
});
