// @vitest-environment node
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createMonitorReplica } from "@vibecook/puppeteer-monitor/replica";
import type { FrameScheduler } from "@vibecook/puppeteer-view-sdk/model";
import { AgentModelMeshFrame, AgentModelMeshOpen } from "@vibefield/contracts";
import { describe, expect, it, vi } from "vitest";
import type { DoorClient } from "../src/godview/monitor/doors";
import { ModelBoardFold } from "../src/godview/monitor/model-board";
import { createGodviewMonitorFeed } from "../src/godview/monitor/model-replica";

// MV-3a (MV-D18, M3, M23) — the window adapter: the one door's per-device
// chains folded into ONE model chain, fed to the replica. The frames are the
// contracts' goldens — what fieldd sends is what this reads (EL9).

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "contracts", "fixtures");
const golden = (name: string): unknown =>
  JSON.parse(readFileSync(join(FIXTURES, name), "utf8")) as unknown;
const OPEN = AgentModelMeshOpen.parse(golden("agent-model-mesh-open.valid.json"));
const FRAMES = (golden("agent-model-mesh-frames.valid.json") as unknown[]).map((frame) =>
  AgentModelMeshFrame.parse(frame),
);
const HERE = "dev-01HQ9S7UD1";
const PEER = "dev-01HQ9S7XZ2";

/** A frame scheduler the test drains by hand. */
function manualFrame(): FrameScheduler & { flush(): void } {
  const queue: Array<{ work: () => void; cancelled: boolean }> = [];
  return {
    request(work) {
      const entry = { work, cancelled: false };
      queue.push(entry);
      return () => {
        entry.cancelled = true;
      };
    },
    flush() {
      while (queue.length > 0) {
        const entry = queue.shift();
        if (entry && !entry.cancelled) entry.work();
      }
    },
  };
}

describe("ModelBoardFold — one chain from every desktop's own", () => {
  it("the open replaces everything: this desktop first (self), its terminal among its rows, a peer's rows beside, an asleep desktop with none", () => {
    const fold = new ModelBoardFold();
    const snapshot = fold.open(OPEN);
    expect(fold.here).toBe(HERE);
    expect(snapshot.revision).toBe(1);
    expect(snapshot.rows.map((row) => [row.id, row.kind, row.device.self])).toEqual([
      ["run-studio-q", "agent", true],
      ["pty-s4", "terminal", true],
      ["run-loft-w", "agent", false],
    ]);
    // the owner's facts, untouched: the colour sequence this desktop dealt, none for the peer
    expect(snapshot.rows[0]?.project.seq).toBe(2);
    expect(snapshot.rows[2]?.project.seq).toBeUndefined();
    expect(snapshot.rows[2]?.device).toEqual({ id: PEER, name: "Loft", os: "linux", self: false });
    expect(fold.devices().map((device) => [device.device, device.state])).toEqual([
      [HERE, "live"],
      [PEER, "live"],
      ["dev-01HQ9S7Y44", "asleep"],
    ]);
  });

  it("frames in order: a delta is upserts and removals by model id, a state change moves no row (DS-L8), a peer's removal leaves", () => {
    const fold = new ModelBoardFold();
    fold.open(OPEN);
    const first = fold.frame(FRAMES[0] as AgentModelMeshFrame);
    expect(first).toMatchObject({
      since: 1,
      revision: 2,
      removed: ["run-studio-q"],
    });
    expect(
      first !== null && first !== "gap" ? first.upserts.map((row) => [row.id, row.status]) : null,
    ).toEqual([["pty-s4", "idle"]]);
    // the peer goes stale: its rows stay, the devices say so
    expect(fold.frame(FRAMES[1] as AgentModelMeshFrame)).toBeNull();
    expect(fold.devices().find((device) => device.device === PEER)?.state).toBe("stale");
    const third = fold.frame(FRAMES[2] as AgentModelMeshFrame);
    expect(third).toMatchObject({ since: 2, revision: 3, upserts: [], removed: ["run-loft-w"] });
  });

  it("a delta the fold cannot follow is a gap; a device's snapshot replaces that device's rows and removes what vanished", () => {
    const fold = new ModelBoardFold();
    fold.open(OPEN);
    // the peer's chain is at 17; a delta since 18 skips one
    const skipped = { ...(FRAMES[2] as Extract<AgentModelMeshFrame, { delta: unknown }>) };
    skipped.delta = { ...skipped.delta, since: 18, revision: 19 };
    expect(fold.frame(skipped)).toBe("gap");
    // a device never met sends a delta: a gap too
    expect(
      fold.frame({
        device: "dev-new",
        delta: { epoch: "x.1", since: 0, revision: 1, upserts: [], removed: [] },
      }),
    ).toBe("gap");
    // this desktop resets with its terminal gone: the terminal is removed, the run upserted
    const own = OPEN.devices[0]?.snapshot;
    if (own === undefined) throw new Error("the fixture's own board");
    const reset = fold.frame({
      device: HERE,
      snapshot: { epoch: "fieldd-9b04c1e27a6d5f30.10", revision: 1, rows: [own.rows[0]!] },
    });
    expect(reset).toMatchObject({ removed: ["pty-s4"] });
    expect(reset !== null && reset !== "gap" ? reset.upserts.map((row) => row.id) : null).toEqual([
      "run-studio-q",
    ]);
    // and the chain continues from the new epoch
    expect(
      fold.frame({
        device: HERE,
        delta: {
          epoch: "fieldd-9b04c1e27a6d5f30.10",
          since: 1,
          revision: 2,
          upserts: [],
          removed: ["run-studio-q"],
        },
      }),
    ).toMatchObject({ removed: ["run-studio-q"] });
  });

  it("a row with no model row (an older daemon) is no row, and removes what its key stood for", () => {
    const fold = new ModelBoardFold();
    fold.open(OPEN);
    const peer = OPEN.devices[1]?.snapshot?.rows[0];
    if (peer === undefined || peer.kind === "terminal") throw new Error("the peer's desk row");
    const { monitorRow: _omitted, ...older } = peer;
    const change = fold.frame({
      device: PEER,
      delta: {
        epoch: "fieldd-5d2c8f1a0b7e4c93.2",
        since: 17,
        revision: 18,
        upserts: [older as typeof peer],
        removed: [],
      },
    });
    expect(change).toMatchObject({ upserts: [], removed: ["run-loft-w"] });
  });
});

describe("the replica over the fold — structural sharing, the host's order", () => {
  it("applies the open and the frames; an untouched row keeps its object", () => {
    const frame = manualFrame();
    const replica = createMonitorReplica({ scheduler: frame });
    const fold = new ModelBoardFold();
    expect(replica.apply(fold.open(OPEN))).toBe(true);
    frame.flush();
    const before = replica.getSnapshot();
    // the contract's order: agents by birth, ties by id, then terminals
    expect(before.model.agents.map((agent) => agent.id)).toEqual([
      "run-loft-w",
      "run-studio-q",
      "pty-s4",
    ]);
    const loft = before.model.byId.get("run-loft-w");
    const change = fold.frame(FRAMES[0] as AgentModelMeshFrame);
    if (change === null || change === "gap") throw new Error("a change");
    expect(replica.apply(change)).toBe(true);
    frame.flush();
    const after = replica.getSnapshot();
    expect(after.model.agents.map((agent) => agent.id)).toEqual(["run-loft-w", "pty-s4"]);
    expect(after.model.byId.get("run-loft-w")).toBe(loft);
    expect(after.changes).toEqual({ added: [], updated: ["pty-s4"], removed: ["run-studio-q"] });
    replica.dispose();
  });
});

describe("createGodviewMonitorFeed — the one door, re-asked on a gap, the screen re-reported", () => {
  interface FakeDoor extends DoorClient {
    opens: number;
    unsubscribed: number;
    requests: Array<[string, Record<string, unknown>]>;
    /** the live subscription's frame sink */
    push(payload: unknown, kind?: "snapshot" | "delta"): void;
  }
  function fakeDoor(open: unknown = OPEN): FakeDoor {
    let sink: ((payload: unknown, kind?: "snapshot" | "delta") => void) | null = null;
    const door: FakeDoor = {
      opens: 0,
      unsubscribed: 0,
      requests: [],
      request: async (method, params) => {
        door.requests.push([method, params]);
        return { reported: true };
      },
      subscribe: async (_method, _params, onFrame) => {
        door.opens += 1;
        sink = onFrame;
        return {
          snapshot: open,
          unsubscribe: () => {
            door.unsubscribed += 1;
          },
        };
      },
      push: (payload, kind = "delta") => sink?.(payload, kind),
    };
    return door;
  }
  const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

  it("opens the model board, applies the open, folds frames, and re-subscribes on a gap", async () => {
    const door = fakeDoor();
    const frame = manualFrame();
    const feed = createGodviewMonitorFeed({ client: door, scheduler: frame });
    await settle();
    expect(door.opens).toBe(1);
    expect(feed.state()).toEqual({ state: "live", here: HERE });
    frame.flush();
    expect(feed.replica.getSnapshot().model.agents).toHaveLength(3);
    door.push(golden("agent-model-mesh-frames.valid.json") as unknown[] as never);
    // a frame that is not a frame is a gap: asked again
    await settle();
    expect(door.unsubscribed).toBe(1);
    expect(door.opens).toBe(2);
    // a readable delta applies
    door.push((golden("agent-model-mesh-frames.valid.json") as unknown[])[0]);
    frame.flush();
    expect(feed.replica.getSnapshot().model.byId.has("run-studio-q")).toBe(false);
    expect(feed.replica.getSnapshot().model.byId.get("pty-s4")?.status).toBe("idle");
    // a delta that skips the chain is a gap too
    door.push({
      device: PEER,
      delta: {
        epoch: "fieldd-5d2c8f1a0b7e4c93.2",
        since: 40,
        revision: 41,
        upserts: [],
        removed: [],
      },
    });
    await settle();
    expect(door.opens).toBe(3);
    feed.dispose();
    expect(door.unsubscribed).toBe(3);
  });

  it("reports what the pane shows while the board is open, and again after a re-open", async () => {
    const door = fakeDoor();
    const feed = createGodviewMonitorFeed({ client: door, scheduler: manualFrame() });
    feed.reportShown(["pty-s4"]);
    // not yet live: held until the board answers
    expect(door.requests).toEqual([]);
    await settle();
    expect(door.requests).toEqual([["agent.reportShown", { ids: ["pty-s4"] }]]);
    feed.reportShown(["run-loft-w"]);
    expect(door.requests.at(-1)).toEqual(["agent.reportShown", { ids: ["run-loft-w"] }]);
    // a gap re-opens the board, and the screen is told again
    door.push("not a frame");
    await settle();
    expect(door.opens).toBe(2);
    expect(door.requests.at(-1)).toEqual(["agent.reportShown", { ids: ["run-loft-w"] }]);
    expect(door.requests).toHaveLength(3);
    feed.dispose();
  });

  it("a refusal no second ask changes stays as the reason; one that may heal is asked again on the backoff", async () => {
    vi.useFakeTimers();
    try {
      let attempts = 0;
      const door: DoorClient = {
        request: async () => undefined,
        subscribe: async () => {
          attempts += 1;
          throw Object.assign(new Error(attempts === 1 ? "not ready" : "no"), {
            kind: attempts === 1 ? "UNAVAILABLE" : "FORBIDDEN_SCOPE",
            retryable: attempts === 1,
          });
        },
      };
      const feed = createGodviewMonitorFeed({
        client: door,
        scheduler: manualFrame(),
        retryMinMs: 10,
      });
      await vi.advanceTimersByTimeAsync(0);
      expect(feed.state()).toMatchObject({
        state: "unavailable",
        retryable: true,
        reason: "not ready",
      });
      await vi.advanceTimersByTimeAsync(300);
      expect(attempts).toBe(2);
      expect(feed.state()).toMatchObject({ state: "unavailable", retryable: false, reason: "no" });
      await vi.advanceTimersByTimeAsync(10_000);
      expect(attempts).toBe(2);
      feed.dispose();
    } finally {
      vi.useRealTimers();
    }
  });
});
