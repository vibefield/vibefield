// @vitest-environment node
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createMonitorReplica } from "@vibecook/puppeteer-monitor/replica";
import type { FrameScheduler } from "@vibecook/puppeteer-view-sdk/model";
import { AgentModelDeskRow, AgentModelMeshFrame, AgentModelMeshOpen } from "@vibefield/contracts";
import { describe, expect, it, vi } from "vitest";
import { ModelBoardFold } from "../src/godview/monitor/model-board";
import { createGodviewMonitorFeed } from "../src/godview/monitor/model-replica";
import type { ModelBoardPort } from "../src/godview/monitor/remote-door";

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
    // MV-3b — the board row is kept beside each model row: the window's own
    // joins read the pane a model id stands for and the run it was dealt to
    expect(fold.heldRows().map((held) => [held.device, held.row.id])).toEqual([
      [HERE, "run-studio-q"],
      [HERE, "pty-s4"],
      [PEER, "run-loft-w"],
    ]);
    const terminal = fold.held("pty-s4");
    expect(terminal?.board.kind).toBe("terminal");
    expect(terminal?.board.terminal?.runtimeSessionId).toBe("pty-s4");
    expect(fold.held("run-studio-q")?.board.runtimeRunId).toBe("run-studio-q");
    expect(fold.held("nobody")).toBeUndefined();
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
    // …and the fold no longer holds it
    expect(fold.held("run-loft-w")).toBeUndefined();
    expect(fold.heldRows()).toHaveLength(2);
  });
});

describe("MV-3d — the chrome's runs: this desktop's run rows, split from the model as they land", () => {
  const ownEpoch = "fieldd-9b04c1e27a6d5f30.9";
  const own = (): AgentModelDeskRow => {
    const row = OPEN.devices[0]?.snapshot?.rows[0];
    if (row === undefined) throw new Error("the fixture's own run");
    return AgentModelDeskRow.parse(row);
  };
  const terminal = () => {
    const row = OPEN.devices[0]?.snapshot?.rows[1];
    if (row === undefined) throw new Error("the fixture's own terminal");
    return row;
  };

  it("holds every run row of this desktop with the facts beside it — model row or not — and never a terminal's or a peer's", () => {
    const fold = new ModelBoardFold();
    fold.open(OPEN);
    expect(fold.runs().map((run) => run.runtimeRunId)).toEqual(["run-studio-q"]);
    expect(fold.runs()[0]?.local).toMatchObject({
      cwd: "/Users/james/Projects/project100/vibe-field",
      spawnedBy: "user-shell",
      mirror: { alive: true },
    });
    // a run the backend has not assembled yet: no model row, so no row of the
    // model — and still a run the chrome reads (the marker names every run)
    const { monitorRow: _none, ...unassembled } = own();
    fold.frame({
      device: HERE,
      delta: {
        epoch: ownEpoch,
        since: 61,
        revision: 62,
        upserts: [{ ...unassembled, runtimeRunId: "run-new", revision: 1 }],
        removed: [],
      },
    });
    expect(fold.runs().map((run) => run.runtimeRunId)).toEqual(["run-studio-q", "run-new"]);
    expect(fold.heldRows().some((held) => held.board.runtimeRunId === "run-new")).toBe(false);
  });

  it("keeps the SAME array until one of this desktop's runs moves: a peer's frame, a terminal's, a state change wake nothing", () => {
    const fold = new ModelBoardFold();
    fold.open(OPEN);
    const first = fold.runs();
    expect(fold.runs()).toBe(first);
    fold.frame(FRAMES[1] as AgentModelMeshFrame); // the peer goes stale
    fold.frame(FRAMES[2] as AgentModelMeshFrame); // the peer's run leaves
    expect(fold.runs()).toBe(first);
    fold.frame({
      device: HERE,
      delta: {
        epoch: ownEpoch,
        since: 61,
        revision: 62,
        upserts: [{ ...terminal(), revision: 4 }],
        removed: [],
      },
    });
    expect(fold.runs()).toBe(first);
    // the run's own row moves (a fact beside the model): a new array, with it
    const moved = {
      ...own(),
      revision: 12,
      local: { ...own().local, cwd: "/Users/james/src/rosetta" },
    };
    fold.frame({
      device: HERE,
      delta: { epoch: ownEpoch, since: 62, revision: 63, upserts: [moved], removed: [] },
    });
    const second = fold.runs();
    expect(second).not.toBe(first);
    expect(second[0]?.local?.cwd).toBe("/Users/james/src/rosetta");
    // and leaves
    fold.frame({
      device: HERE,
      delta: { epoch: ownEpoch, since: 63, revision: 64, upserts: [], removed: ["run-studio-q"] },
    });
    expect(fold.runs()).toEqual([]);
    // a re-open replaces them whole
    fold.open(OPEN);
    expect(fold.runs().map((run) => run.runtimeRunId)).toEqual(["run-studio-q"]);
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
  /** The door's model port (`remote-door.ts`), scripted: the two verbs and nothing else. */
  interface FakeBoard extends ModelBoardPort {
    opens: number;
    unsubscribed: number;
    reports: string[][];
    /** the live subscription's frame sink */
    push(payload: unknown, kind?: "snapshot" | "delta"): void;
  }
  function fakeBoard(open: unknown = OPEN): FakeBoard {
    let sink: ((payload: unknown, kind?: "snapshot" | "delta") => void) | null = null;
    const board: FakeBoard = {
      opens: 0,
      unsubscribed: 0,
      reports: [],
      reportShown: async (ids) => {
        board.reports.push([...ids]);
        return { reported: true };
      },
      subscribe: async (onFrame) => {
        board.opens += 1;
        sink = onFrame;
        return {
          snapshot: open,
          unsubscribe: () => {
            board.unsubscribed += 1;
          },
        };
      },
      push: (payload, kind = "delta") => sink?.(payload, kind),
    };
    return board;
  }
  const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

  it("opens the model board, applies the open, folds frames, and re-subscribes on a gap", async () => {
    const door = fakeBoard();
    const frame = manualFrame();
    const feed = createGodviewMonitorFeed({ board: door, scheduler: frame });
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

  it("MV-3d — publishes this desktop's runs as the chrome, and tells its listeners when, and only when, they move", async () => {
    const door = fakeBoard();
    const feed = createGodviewMonitorFeed({ board: door, scheduler: manualFrame() });
    let heard = 0;
    feed.chrome.subscribe(() => {
      heard += 1;
    });
    await settle();
    expect(heard).toBe(1); // the open
    const opened = feed.chrome.runs();
    expect(opened.map((run) => run.runtimeRunId)).toEqual(["run-studio-q"]);
    door.push(FRAMES[1]); // the peer goes stale
    door.push(FRAMES[2]); // the peer's run leaves
    expect(heard).toBe(1);
    expect(feed.chrome.runs()).toBe(opened);
    door.push(FRAMES[0]); // this desktop's run leaves (its terminal goes idle)
    expect(heard).toBe(2);
    expect(feed.chrome.runs()).toEqual([]);
    feed.dispose();
    door.push(FRAMES[0]);
    expect(heard).toBe(2);
  });

  it("reports what the pane shows while the board is open, and again after a re-open", async () => {
    const door = fakeBoard();
    const feed = createGodviewMonitorFeed({ board: door, scheduler: manualFrame() });
    feed.reportShown(["pty-s4"]);
    // not yet live: held until the board answers
    expect(door.reports).toEqual([]);
    await settle();
    expect(door.reports).toEqual([["pty-s4"]]);
    feed.reportShown(["run-loft-w"]);
    expect(door.reports.at(-1)).toEqual(["run-loft-w"]);
    // a gap re-opens the board, and the screen is told again
    door.push("not a frame");
    await settle();
    expect(door.opens).toBe(2);
    expect(door.reports.at(-1)).toEqual(["run-loft-w"]);
    expect(door.reports).toHaveLength(3);
    feed.dispose();
  });

  it("a refusal no second ask changes stays as the reason; one that may heal is asked again on the backoff", async () => {
    vi.useFakeTimers();
    try {
      let attempts = 0;
      const door: ModelBoardPort = {
        reportShown: async () => undefined,
        subscribe: async () => {
          attempts += 1;
          throw Object.assign(new Error(attempts === 1 ? "not ready" : "no"), {
            kind: attempts === 1 ? "UNAVAILABLE" : "FORBIDDEN_SCOPE",
            retryable: attempts === 1,
          });
        },
      };
      const feed = createGodviewMonitorFeed({
        board: door,
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
