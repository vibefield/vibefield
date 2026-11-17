// NR S2 — MeshStream's own rules (`src/mesh-stream.ts`; `draft/thinking-native-replay-rearm.md` §3.2), over a scripted
// subscribe and a scripted mesh. The node gate's refusal is S0's golden (`error-data.mesh-not-up.json`), the shape the
// stream branches on. The daemon-level witnesses are `native-rearm-matrix.test.ts`.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MeshStream, type MeshStreamWake, meshStreamRefusal } from "../src/mesh-stream";
import { type NativeSubscribeOptions, RpcCallError } from "../src/native-link";

const golden = JSON.parse(
  readFileSync(
    join(
      dirname(fileURLToPath(import.meta.url)),
      "../../contracts/fixtures/error-data.mesh-not-up.json",
    ),
    "utf8",
  ),
) as { kind: string; retryable: boolean; details: unknown };
const nodeGate = (): RpcCallError =>
  new RpcCallError(golden.kind, "mesh node not up", golden.retryable, golden.details, -32006);
const doorGolden = JSON.parse(
  readFileSync(
    join(
      dirname(fileURLToPath(import.meta.url)),
      "../../contracts/fixtures/error-data.native-unresponsive.json",
    ),
    "utf8",
  ),
) as { kind: string; retryable: boolean; details: unknown };
const door = (): RpcCallError =>
  new RpcCallError(
    doorGolden.kind,
    "the floor is not answering",
    doorGolden.retryable,
    doorGolden.details,
  );
const timeout = (): RpcCallError =>
  new RpcCallError("TIMEOUT", "mgmt request exceeded its deadline", true);
const refusedForGood = (): RpcCallError =>
  new RpcCallError("PRECONDITION_FAILED", "unknown store", false);

type Mesh = MeshStreamWake & { up: boolean; moment(): void; listeners(): number };

/** A mesh whose node reads as a row sets it, and whose moments a row fires. */
function meshOf(up: boolean): Mesh {
  const fns = new Set<() => void>();
  return {
    up,
    nodeReadsUp() {
      return this.up;
    },
    onRearm(fn) {
      fns.add(fn);
      return () => {
        fns.delete(fn);
      };
    },
    moment() {
      for (const fn of [...fns]) fn();
    },
    listeners: () => fns.size,
  };
}

interface Floor {
  asks: number;
  disposed: number;
  /** Answers given so far. */
  answered: number;
  /** For each ask, in order: how many answers had been given, and how many streams let go, when it was made. */
  askedAt: Array<{ answered: number; disposed: number }>;
  /** Each answered stream's event road, in order: what the floor's forwarder writes to. */
  heard: Array<(payload: unknown, kind: "snapshot" | "delta") => void>;
  /** The replay owner the last answered ask carried: what NativeLink calls on a refused replay. */
  owner: ((error: RpcCallError) => void) | null;
  subscribe(
    onEvent: (payload: unknown, kind: "snapshot" | "delta") => void,
    opts: NativeSubscribeOptions,
  ): Promise<{ snapshot: unknown; dispose: () => void }>;
}

/** A subscribe that answers from a script: an error is a refusal, "ok" an answer; past the script, "ok". */
function floorOf(script: Array<RpcCallError | "ok">, after: RpcCallError | "ok" = "ok"): Floor {
  const floor: Floor = {
    asks: 0,
    disposed: 0,
    answered: 0,
    askedAt: [],
    heard: [],
    owner: null,
    subscribe: async (onEvent, opts) => {
      floor.asks += 1;
      floor.askedAt.push({ answered: floor.answered, disposed: floor.disposed });
      // answer on a later turn of the event loop, as a socket does: an ask loop then spins at the timer's pace, where a
      // row's beat and vitest's own timeout still fire, never on microtasks alone, where nothing else ever would
      await new Promise((resolve) => setImmediate(resolve));
      const next = script.shift() ?? after;
      if (next !== "ok") throw next;
      floor.answered += 1;
      floor.heard.push(onEvent);
      floor.owner = opts.onReplayFailed ?? null;
      return {
        snapshot: { asked: floor.asks },
        dispose: () => {
          floor.disposed += 1;
        },
      };
    },
  };
  return floor;
}

interface Seen {
  snapshots: Array<[unknown, boolean]>;
  events: Array<[unknown, "snapshot" | "delta"]>;
  stopped: unknown[];
}

const streams: MeshStream[] = [];
afterEach(() => {
  for (const stream of streams.splice(0)) stream.stop();
});

function streamOf(floor: Floor, mesh: MeshStreamWake): { stream: MeshStream; seen: Seen } {
  const seen: Seen = { snapshots: [], events: [], stopped: [] };
  const stream = new MeshStream({
    label: "field.docs.v1",
    subscribe: (onEvent, opts) => floor.subscribe(onEvent, opts),
    wake: mesh,
    onEvent: (payload, kind) => seen.events.push([payload, kind]),
    onSnapshot: (snapshot, again) => seen.snapshots.push([snapshot, again]),
    onStopped: (error) => seen.stopped.push(error),
    backoff: { baseMs: 20, capMs: 80 },
  });
  streams.push(stream);
  return { stream, seen };
}

/** What a promise settled to: "ok", or what it rejected with. A renewal is held this way from its call, so a row reads
 * its counts first and the settlement last. */
const settle = (promise: Promise<unknown>): Promise<unknown> =>
  promise.then(
    () => "ok",
    (error: unknown) => error,
  );

const beat = (ms = 60) => new Promise((resolve) => setTimeout(resolve, ms));
/** A few real turns of the event loop: the scripted floor answers on one. */
const flush = async () => {
  for (let i = 0; i < 3; i++) await new Promise((resolve) => setImmediate(resolve));
};

describe("NR — MeshStream asks again by what refused it", () => {
  it("reads the golden as the node gate, TIMEOUT and a full queue as paced, another retryable as the next moment, the rest as final", () => {
    expect(meshStreamRefusal(nodeGate())).toBe("node-gate");
    expect(meshStreamRefusal(timeout())).toBe("paced");
    // Q4 as amended 2026-11-08: a full mesh queue is load, as a TIMEOUT is
    expect(meshStreamRefusal(new RpcCallError("RESOURCE_EXHAUSTED", "queue full", true))).toBe(
      "paced",
    );
    // an UNAVAILABLE that names no mesh unit is not the node gate
    expect(meshStreamRefusal(new RpcCallError("UNAVAILABLE", "not connected", true))).toBe(
      "retryable",
    );
    // the link's own door while the floor is held unresponsive (WG-D4; the golden error-data.native-unresponsive.json)
    expect(meshStreamRefusal(door())).toBe("paced");
    expect(meshStreamRefusal(new RpcCallError("RESOURCE_EXHAUSTED", "not this one", false))).toBe(
      "final",
    );
    expect(meshStreamRefusal(refusedForGood())).toBe("final");
    expect(meshStreamRefusal(new Error("not an rpc refusal"))).toBe("final");
  });

  it("a node-gate refusal rejects start, waits while the node is down, and asks once at the next moment", async () => {
    const refusal = nodeGate();
    const floor = floorOf([refusal]);
    const mesh = meshOf(false);
    const { stream, seen } = streamOf(floor, mesh);
    await expect(stream.start(), "start's own ask is the owner's 'not live yet'").rejects.toBe(
      refusal,
    );
    await beat();
    expect(floor.asks, "no ask while the node reads down and no moment comes").toBe(1);
    mesh.up = true;
    mesh.moment();
    await beat();
    expect(floor.asks, "one ask at the moment").toBe(2);
    expect(stream.live).toBe(true);
    expect(seen.snapshots, "a re-arm's answer says so (`again`)").toEqual([[{ asked: 2 }, true]]);
  });

  it("asks once NOW for a node that reads up, and no more while the gate keeps refusing under it", async () => {
    const floor = floorOf([], nodeGate());
    const mesh = meshOf(true);
    const { stream } = streamOf(floor, mesh);
    await expect(stream.start()).rejects.toBeInstanceOf(RpcCallError);
    await beat(120);
    expect(floor.asks, "the refused ask and the one ask now, never a loop").toBe(2);
    mesh.moment();
    await beat(120);
    expect(floor.asks, "a moment opens one more wait: its ask and its one ask now").toBe(4);
    expect(stream.live).toBe(false);
  });

  it("a refused REPLAY (NativeLink's onReplayFailed) re-arms as a refused first ask does", async () => {
    const floor = floorOf([]);
    const mesh = meshOf(false);
    const { stream, seen } = streamOf(floor, mesh);
    await stream.start();
    expect(seen.snapshots).toEqual([[{ asked: 1 }, false]]);
    expect(floor.owner, "every ask carries the stream's replay owner").not.toBeNull();
    // the floor restarted with no node: the link ended the replay and tells its owner
    floor.owner?.(nodeGate());
    expect(stream.live, "the link ended it").toBe(false);
    await beat();
    expect(floor.asks, "the node reads down: it waits").toBe(1);
    mesh.up = true;
    mesh.moment();
    await beat();
    expect(floor.asks).toBe(2);
    expect(stream.live).toBe(true);
    expect(seen.snapshots.at(-1)).toEqual([{ asked: 2 }, true]);
  });

  it("a TIMEOUT is asked again on its pace, doubling to its cap, with no moment, until the floor answers", async () => {
    // the timers are the row's own (S2's review: a count alone passes a flat pace or an immediate retry); the floor's
    // turn stays real (setImmediate), so an answer still comes on a later turn
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    try {
      const floor = floorOf([timeout(), timeout(), timeout(), timeout(), timeout()]);
      const { stream } = streamOf(floor, meshOf(true));
      await expect(stream.start()).rejects.toBeInstanceOf(RpcCallError);
      let asked = floor.asks;
      // base 20 ms, doubling, capped at 80 ms (the row's pace; production's is 500 ms to 10 s)
      for (const pace of [20, 40, 80, 80, 80]) {
        await vi.advanceTimersByTimeAsync(pace - 1);
        await flush();
        expect(floor.asks, `no ask before ${pace} ms`).toBe(asked);
        await vi.advanceTimersByTimeAsync(1);
        await flush();
        expect(floor.asks, `the ask at ${pace} ms`).toBe(asked + 1);
        asked += 1;
      }
      expect(stream.live, "the sixth ask was answered").toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it("a retryable refusal that is not the gate waits for the next moment, even under a node read up; a moment while live asks nothing", async () => {
    const floor = floorOf([new RpcCallError("UNAVAILABLE", "not connected", true)]);
    const mesh = meshOf(true);
    const { stream } = streamOf(floor, mesh);
    await expect(stream.start()).rejects.toBeInstanceOf(RpcCallError);
    await beat();
    expect(floor.asks, "no ask now: only the node gate is owed one").toBe(1);
    mesh.moment();
    await beat();
    expect(floor.asks, "the moment's ask").toBe(2);
    expect(stream.live).toBe(true);
    mesh.moment();
    await beat();
    expect(floor.asks, "a moment while live asks nothing").toBe(2);
  });

  it("stop during the first ask lets the late answer go, and hands its owner no snapshot", async () => {
    const floor = floorOf([]);
    const { stream, seen } = streamOf(floor, meshOf(true));
    const starting = stream.start();
    stream.stop();
    await starting;
    expect(floor.asks).toBe(1);
    expect(floor.disposed, "the late answer was let go").toBe(1);
    expect(seen.snapshots).toEqual([]);
    expect(stream.live).toBe(false);
  });

  it("a refusal that is not retryable stops the stream: its owner hears it, and no moment asks again", async () => {
    const refusal = refusedForGood();
    const floor = floorOf([refusal]);
    const mesh = meshOf(true);
    const { stream, seen } = streamOf(floor, mesh);
    await expect(stream.start()).rejects.toBe(refusal);
    expect(seen.stopped).toEqual([refusal]);
    mesh.moment();
    await beat();
    expect(floor.asks).toBe(1);
  });

  // NR S3 — the owner's renewal (`renew`): a node built anew over a live link refuses nothing, so only the owner can
  // ask for its store again (the drive's holders, `drive/holders.ts` `nodeUp`).
  it("S3: a live stream's renew makes ONE ask, and lets the old stream go only after the new one answered", async () => {
    const floor = floorOf([]);
    const { stream, seen } = streamOf(floor, meshOf(true));
    await stream.start();
    const renewed = settle(stream.renew());
    expect(floor.disposed, "nothing is let go while the renewal is in flight").toBe(0);
    await beat();
    expect(floor.asks, "one renewal, one ask").toBe(2);
    expect(floor.askedAt[1], "the renewal asked while the old stream still stood").toEqual({
      answered: 1,
      disposed: 0,
    });
    expect(floor.disposed, "the old stream, let go once the new one answered").toBe(1);
    expect(stream.live).toBe(true);
    expect(seen.snapshots.at(-1), "the renewal's answer is a re-arm's (`again`)").toEqual([
      { asked: 2 },
      true,
    ]);
    expect(await renewed, "a renewal resolves").toBe("ok");
  });

  it("S3: a refused renew keeps the standing stream hearing, and the next moment asks", async () => {
    const floor = floorOf(["ok", new RpcCallError("UNAVAILABLE", "not connected", true)]);
    const mesh = meshOf(true);
    const { stream, seen } = streamOf(floor, mesh);
    await stream.start();
    const renewed = settle(stream.renew());
    await beat();
    expect(floor.asks, "the renewal asked").toBe(2);
    expect(floor.disposed, "a refused renewal lets nothing go").toBe(0);
    expect(stream.live, "the standing stream still stands").toBe(true);
    floor.heard[0]?.({ kind: "peerUpdated", deviceId: "studio" }, "delta");
    expect(seen.events, "and its events still reach the owner").toEqual([
      [{ kind: "peerUpdated", deviceId: "studio" }, "delta"],
    ]);
    mesh.moment();
    await beat();
    expect(floor.asks, "the refusal left the stream owed the next moment's ask").toBe(3);
    expect(floor.disposed, "whose answer lets the standing one go").toBe(1);
    expect(await renewed, "a refused renewal resolves: the refusal is the stream's").toBe("ok");
  });

  it("S3: renew during an ask in flight waits it out, then asks once (two asks in all, not three)", async () => {
    const floor = floorOf([]);
    const { stream, seen } = streamOf(floor, meshOf(true));
    const starting = stream.start();
    const renewed = settle(stream.renew());
    await starting;
    await beat();
    expect(floor.asks, "the flight, then ONE renewal").toBe(2);
    expect(
      floor.askedAt.map((at) => at.answered),
      "the renewal asked only after the flight was answered",
    ).toEqual([0, 1]);
    expect(floor.disposed, "the first stream, let go once the renewal answered").toBe(1);
    expect(seen.snapshots).toEqual([
      [{ asked: 1 }, false],
      [{ asked: 2 }, true],
    ]);
    expect(await renewed).toBe("ok");
  });

  it("S3: a WAITING stream's renew is one ask, and no second ask comes at the next moment", async () => {
    const refusal = nodeGate();
    const floor = floorOf([refusal]);
    const mesh = meshOf(false);
    const { stream } = streamOf(floor, mesh);
    await expect(stream.start()).rejects.toBe(refusal);
    const renewed = settle(stream.renew());
    await beat();
    expect(floor.asks, "the refused start, then the renewal").toBe(2);
    expect(stream.live).toBe(true);
    mesh.up = true;
    mesh.moment();
    await beat();
    expect(floor.asks, "the renewal answered the wait: the moment asks nothing").toBe(2);
    expect(await renewed).toBe("ok");
  });

  it("S3: stop during a renew lets the late answer go, and nothing reaches the owner", async () => {
    const floor = floorOf([]);
    const { stream, seen } = streamOf(floor, meshOf(true));
    await stream.start();
    const renewed = settle(stream.renew());
    stream.stop();
    await beat();
    expect(floor.asks, "the renewal had asked").toBe(2);
    expect(floor.disposed, "the standing stream at stop, then the late answer").toBe(2);
    expect(seen.snapshots, "the late answer reached no one").toEqual([[{ asked: 1 }, false]]);
    expect(stream.live).toBe(false);
    expect(await renewed).toBe("ok");
  });

  it("stop ends a live stream, lets go of its moments, and nothing asks after it", async () => {
    const floor = floorOf([]);
    const mesh = meshOf(true);
    const { stream } = streamOf(floor, mesh);
    await stream.start();
    stream.stop();
    expect(floor.disposed).toBe(1);
    expect(mesh.listeners()).toBe(0);
    floor.owner?.(nodeGate());
    mesh.moment();
    await beat();
    expect(floor.asks).toBe(1);
  });
});
