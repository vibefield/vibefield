// @vitest-environment node
/**
 * THE WIRE (GT-3c, GT-D16).
 *
 * A fake worker sits between the two halves and moves messages the way a real
 * one does — including the part that usually goes untested: `postMessage` with a
 * transfer list DETACHES the sender's buffer. `structuredClone(value, {transfer})`
 * has exactly that effect, so a host that reused a buffer it had already sent
 * would fail here rather than in a renderer.
 *
 * Delivery is queued and flushed by hand. Nothing about this contract should
 * depend on a message arriving in the same tick it was sent, and a harness that
 * called straight through would never notice if it did.
 *
 * What it holds:
 *   1. the id table arrives BEFORE the frames that are addressed by it, and only
 *      when membership actually changed
 *   2. ping-pong: two buffers, returned and reused, never allocated per frame
 *   3. back-pressure: a consumer that stops returning buffers gets stale frames,
 *      not a growing heap
 *   4. queryPoint round-trips by requestId
 *   5. the renderer socket holds an OffscreenCanvas and draws nothing with it
 *   6. dispose stops the world
 *   7. the MAIN→WORKER half of that same discipline: the view's read-then-release
 *      order, played through the detaching harness (GT-5c)
 */

import { describe, expect, it } from "vitest";
import { type BubbleState, readSwarmFrame } from "../src/godview/views/swarm/swarm-frame";
import {
  FRAME_COUNT_INDEX,
  type SwarmPhysicsParameters,
} from "../src/godview/views/swarm/swarm-physics";
import {
  createSwarmPhysicsHost,
  type SwarmPhysicsHost,
} from "../src/godview/views/swarm/swarm-physics-host";
import {
  isSwarmFrame,
  type SwarmPhysicsCommand,
  type SwarmPhysicsEvent,
  type SwarmPhysicsOutbound,
} from "../src/godview/views/swarm/swarm-physics-protocol";

const PARAMETERS: SwarmPhysicsParameters = {
  gravityPull: 0.0002,
  restitution: 0,
  frictionAir: 0.2,
  physicsHz: 25,
};

interface Harness {
  host: SwarmPhysicsHost;
  /** Send a command down, as the view would. */
  send(command: SwarmPhysicsCommand): void;
  /** Advance the physics clock by `deltaMs` and deliver whatever it published. */
  tick(deltaMs: number): void;
  /** Frames the main side has received and not yet handed back. */
  held: Float32Array[];
  events: SwarmPhysicsEvent[];
  /** Every frame ever delivered — a count that survives handing the buffer back,
   * which the held list deliberately does not. */
  received(): number;
  /** The contents of the newest frame, copied out at delivery. */
  lastFrame(): number[] | null;
  /** Hand every held frame back, the way the view does the moment it has read one. */
  releaseAll(): void;
  /**
   * How many distinct buffers the HOST has emitted, counted on its own side
   * before any transfer.
   *
   * Only meaningful in `transfer: false` mode. Moving a buffer across a real
   * boundary hands the receiver a new wrapper over the same memory, and hands a
   * new one BACK on release — so identity churns by design and cannot say
   * anything about allocation. Pass-by-reference is the inline driver's real
   * path, and there identity is exactly allocation.
   */
  hostBuffers(): number;
}

function harness(options: { autoRelease?: boolean; transfer?: boolean } = {}): Harness {
  const autoRelease = options.autoRelease ?? true;
  const transferring = options.transfer ?? true;
  const outbound: SwarmPhysicsOutbound[] = [];
  const held: Float32Array[] = [];
  const events: SwarmPhysicsEvent[] = [];
  const emitted: ArrayBufferLike[] = [];
  let receivedFrames = 0;
  let newest: number[] | null = null;
  let now = 0;

  const host = createSwarmPhysicsHost({
    post: (message, transfer) => {
      if (isSwarmFrame(message) && !emitted.includes(message.buffer)) emitted.push(message.buffer);
      // The real boundary, faithfully: a transfer list detaches what it names.
      outbound.push(
        transferring && transfer && transfer.length > 0
          ? (structuredClone(message, { transfer }) as SwarmPhysicsOutbound)
          : message,
      );
    },
    now: () => now,
  });

  const releaseAll = (): void => {
    while (held.length > 0) {
      const frame = held.shift() as Float32Array;
      host.handle({ type: "releaseFrame", buffer: frame });
    }
  };

  const flush = (): void => {
    while (outbound.length > 0) {
      const message = outbound.shift() as SwarmPhysicsOutbound;
      if (isSwarmFrame(message)) {
        receivedFrames += 1;
        newest = [...message];
        held.push(message);
      } else {
        events.push(message);
      }
    }
    if (autoRelease) releaseAll();
  };

  return {
    host,
    send: (command) => {
      host.handle(command);
      flush();
    },
    tick: (deltaMs) => {
      now += deltaMs;
      host.pump(now);
      flush();
    },
    held,
    events,
    received: () => receivedFrames,
    lastFrame: () => newest,
    releaseAll,
    hostBuffers: () => emitted.length,
  };
}

function init(bus: Harness, ids: readonly string[] = ["a", "b"]): void {
  bus.send({
    type: "init",
    agents: ids.map((id) => ({ id, radius: 50 })),
    parameters: PARAMETERS,
    bounds: { width: 800, height: 400 },
    obstacles: [],
    reducedMotion: false,
  });
}

const tables = (bus: Harness): Extract<SwarmPhysicsEvent, { type: "idTable" }>[] =>
  bus.events.filter((event) => event.type === "idTable");

describe("the id table", () => {
  it("is published at init, and frames carry the generation it named", () => {
    const bus = harness({ autoRelease: false });
    init(bus);

    const [table] = tables(bus);
    expect(table?.ids).toEqual(["a", "b"]);
    // The table is sent BEFORE the frame it addresses — a frame read against a
    // table that has not arrived would put one agent's position on another's
    // bubble.
    expect(bus.events.length).toBe(1);
    expect(bus.received()).toBe(1);
    expect(bus.lastFrame()?.[0]).toBe(table?.generation);
    bus.host.dispose();
  });

  it("is republished when membership changes, and NOT when only a radius does", () => {
    const bus = harness();
    init(bus);
    const first = tables(bus).length;
    const framesAfterInit = bus.received();

    bus.send({
      type: "updateAgents",
      agents: [
        { id: "a", radius: 70 },
        { id: "b", radius: 50 },
      ],
    });
    expect(tables(bus).length, "a resize invented a new table").toBe(first);

    bus.send({ type: "updateAgents", agents: [{ id: "a", radius: 70 }] });
    const republished = tables(bus);
    expect(republished.length).toBe(first + 1);
    expect(republished[republished.length - 1]?.ids).toEqual(["a"]);
    // A membership change publishes a frame immediately rather than making the
    // new bubble wait out a step for its first position — asserted as the FRAME
    // COUNT growing. This line read `expect(bus.host.disposed).toBe(false)`
    // until GT-5c: vacuous under a comment claiming otherwise, and deleting the
    // behaviour left the suite green (the review's finding 15).
    expect(bus.received(), "a membership change published no frame").toBe(framesAfterInit + 1);
    expect(bus.lastFrame()?.[FRAME_COUNT_INDEX]).toBe(1);
    bus.host.dispose();
  });
});

describe("the ping-pong", () => {
  it("rotates two buffers forever instead of allocating a frame at a time", () => {
    // Pass-by-reference, so buffer identity IS allocation (see `hostBuffers`).
    const bus = harness({ transfer: false });
    init(bus);
    // Forty frames at 25Hz against 40ms pumps: one step and one frame each.
    for (let index = 0; index < 40; index += 1) bus.tick(40);
    expect(bus.received()).toBeGreaterThan(20);
    expect(bus.hostBuffers()).toBeLessThanOrEqual(2);
    bus.host.dispose();
  });

  it("never writes into a buffer it has already sent", () => {
    // The claim the detaching harness exists to make. A host that kept its own
    // reference to a transferred buffer would write into a detached array —
    // which reads as a zero-length nothing rather than as a position, and would
    // reach the view as a frame with no bodies in it.
    const bus = harness({ autoRelease: false });
    init(bus);
    for (let index = 0; index < 10; index += 1) {
      bus.tick(40);
      const frame = bus.held[bus.held.length - 1];
      if (frame) {
        expect(frame.length).toBeGreaterThan(0);
        expect(frame[FRAME_COUNT_INDEX]).toBe(2);
      }
      bus.releaseAll();
    }
    bus.host.dispose();
  });

  it("drops frames rather than memory when the consumer stops reading", () => {
    // Back-pressure by construction: a main thread too busy to hand buffers
    // back loses freshness, never heap. Two buffers out means the next frame is
    // simply not written.
    const bus = harness({ autoRelease: false });
    init(bus);
    for (let index = 0; index < 20; index += 1) bus.tick(40);

    // Twenty-one frames were due; the pool can only lend two, so everything
    // after that had nowhere to be written and was simply not written.
    expect(bus.held.length).toBe(2);
    expect(bus.received()).toBe(2);

    // And it recovers the moment the consumer catches up.
    bus.releaseAll();
    bus.tick(40);
    expect(bus.received()).toBe(3);
    bus.host.dispose();
  });
});

describe("commands that are not frames", () => {
  it("answers a point query by requestId", () => {
    const bus = harness();
    init(bus, ["a"]);
    // The lone body spawns in the middle of the arena, with nothing to avoid.
    bus.send({ type: "queryPoint", point: { x: 400, y: 200 }, requestId: 77 });
    const answer = bus.events.find((event) => event.type === "queryResult");
    expect(answer).toEqual({ type: "queryResult", requestId: 77, id: "a" });

    bus.send({ type: "queryPoint", point: { x: 10, y: 10 }, requestId: 78 });
    const empty = bus.events.filter((event) => event.type === "queryResult").at(-1);
    expect(empty).toEqual({ type: "queryResult", requestId: 78, id: null });
    bus.host.dispose();
  });

  it("enforces the 15Hz floor on the physics side too, not only at the slider", () => {
    const bus = harness();
    init(bus);
    bus.send({ type: "updateParameters", parameters: { ...PARAMETERS, physicsHz: 2 } });
    expect(bus.host.stepMs()).toBeCloseTo(1000 / 15, 6);
    bus.host.dispose();
  });

  it("holds the renderer's canvas and draws nothing with it (GT-D16's socket)", () => {
    const bus = harness();
    init(bus);
    expect(bus.host.renderSurface()).toBeNull();

    // A stand-in with the shape the real one will have. The point of the
    // assertion is the ABSENCE of drawing: the socket accepts a surface today
    // so that James's SDF session has somewhere to plug in, and touching it here
    // would be shipping an untested renderer on the path the DOM view is using.
    const canvas = { width: 640, height: 480 } as unknown as OffscreenCanvas;
    bus.send({ type: "adoptCanvas", canvas });
    expect(bus.host.renderSurface()).toBe(canvas);

    const before = bus.received();
    bus.tick(40);
    // It still simulates, and it still says nothing about rendering.
    expect(bus.received()).toBeGreaterThan(before);
    bus.host.dispose();
  });
});

describe("the MAIN→WORKER half of the transfer discipline (the review's finding 17)", () => {
  // The direction that was never exercised with a real detach. The view reads a
  // frame and then hands the buffer back WITH ITS ArrayBuffer IN THE TRANSFER
  // LIST — which detaches this side's view of it. Read second and the array is
  // length zero: not an error, just a swarm that has stopped moving. Under the
  // inline driver `post` drops the transfer list, so both orders passed, and
  // moving the release above the read loop — the exact mistake the view's own
  // comment warns about — kept every test green.
  //
  // `readSwarmFrame` is the view's own read, extracted so this can play the
  // view's sequence rather than a copy of it.

  /** The main side's `post`, with the boundary's real semantics. */
  function release(bus: Harness, frame: Float32Array): void {
    bus.host.handle(
      structuredClone({ type: "releaseFrame", buffer: frame } as SwarmPhysicsCommand, {
        transfer: [frame.buffer],
      }),
    );
  }

  function deliveredFrame(bus: Harness): Float32Array {
    const frame = bus.held.shift();
    if (frame === undefined) throw new Error("the harness delivered no frame");
    return frame;
  }

  it("reads a frame and THEN releases it, exactly as the view does", () => {
    const bus = harness({ autoRelease: false });
    init(bus);
    const frame = deliveredFrame(bus);
    const table = tables(bus)[0];
    if (table === undefined) throw new Error("no id table");

    const states = new Map<string, BubbleState>();
    expect(readSwarmFrame(frame, table, states)).toBe(true);
    release(bus, frame);

    // The read happened against live memory…
    expect([...states.keys()]).toEqual(["a", "b"]);
    expect(Number.isFinite(states.get("a")?.x)).toBe(true);
    // …and the release genuinely detached it, which is what makes the order
    // load-bearing rather than a preference.
    expect(frame.length).toBe(0);
    bus.host.dispose();
  });

  it("would read NOTHING the other way round — the assertion that makes this non-vacuous", () => {
    const bus = harness({ autoRelease: false });
    init(bus);
    const frame = deliveredFrame(bus);
    const table = tables(bus)[0];
    if (table === undefined) throw new Error("no id table");

    const states = new Map<string, BubbleState>();
    release(bus, frame);
    // A detached array reports zero bodies rather than throwing, so the view
    // simply stops updating: no error, no log line, no moving swarm.
    expect(readSwarmFrame(frame, table, states)).toBe(false);
    expect(states.size).toBe(0);
    bus.host.dispose();
  });

  it("hands a released buffer back into the pool, so the ping-pong survives the detach", () => {
    const bus = harness({ autoRelease: false });
    init(bus);
    const first = deliveredFrame(bus);
    release(bus, first);
    // Two out of two would have been dropped; one returned means the next pump
    // has somewhere to write.
    const before = bus.received();
    bus.tick(40);
    expect(bus.received()).toBe(before + 1);
    bus.host.dispose();
  });
});

describe("dispose", () => {
  it("stops the world, and ignores everything sent afterwards", () => {
    const bus = harness();
    init(bus);
    bus.tick(40);
    const settled = bus.events.length;

    const delivered = bus.received();
    bus.send({ type: "dispose" });
    expect(bus.host.disposed).toBe(true);

    bus.tick(40);
    bus.send({ type: "updateAgents", agents: [{ id: "z", radius: 50 }] });
    bus.tick(40);
    // Nothing new was published, because there is nothing left to publish it.
    expect(bus.events.length).toBe(settled);
    expect(bus.received()).toBe(delivered);
    expect(bus.held.length).toBe(0);
  });
});
