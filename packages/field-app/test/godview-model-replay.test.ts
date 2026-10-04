// @vitest-environment happy-dom
/**
 * THE B-SIDE REPLAY SOURCE (MV-3c, step 3): the paired harness's player feeds
 * the WINDOW ADAPTER (`createGodviewMonitorFeed`: `ModelBoardFold`, the
 * replica) from a model stream, in place of the live `model` subscription,
 * behind the same `godviewReplay=1` switch — and with nothing asked, the
 * feed's client is the client.
 *
 * The proof runs on the tree as it stands (the window does not read the model
 * yet, mv3b wires it): the replayed stream reaches a replica built by the
 * window adapter's own code, and the replica's rows ARE the stream's rows —
 * checked against a fold of the stream written here, independently of the
 * adapter's.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { gunzipSync } from "node:zlib";
import type { AgentView } from "@vibecook/puppeteer-view-sdk/model";
import type {
  AgentModelBoardRow,
  AgentModelMeshFrame,
  AgentModelMeshOpen,
} from "@vibefield/contracts";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DoorClient } from "../src/godview/monitor/doors";
import { createGodviewMonitorFeed } from "../src/godview/monitor/model-replica";
import {
  instrumentModelClient,
  instrumentMonitorDoor,
  resetGodviewDoorInstrumentsForTest,
} from "../src/godview/monitor/perf/door-instruments";
import { godviewPerfLab, resetGodviewPerfLabForTest } from "../src/godview/monitor/perf/lab-bridge";
import { decodeModelStreamJsonl } from "../src/godview/monitor/perf/model-stream";
import type { MonitorDoor } from "../src/godview/monitor/remote-door";

const STREAM = gunzipSync(
  readFileSync(
    join(import.meta.dirname, "fixtures", "godview-model-streams", "n10-2s-s1.model.jsonl.gz"),
  ),
).toString("utf8");
const RECIPE = "n=10,duration=2000,seed=1";

function refusingClient(): DoorClient & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    request: async (method) => {
      calls.push(`request ${method}`);
      throw new Error(`no daemon: ${method}`);
    },
    subscribe: async (method) => {
      calls.push(`subscribe ${method}`);
      throw new Error(`no daemon: ${method}`);
    },
  };
}

function quietDoor(): MonitorDoor {
  return {
    observe: () => () => undefined,
    observeMesh: () => () => undefined,
    attach: async () => ({ state: "no-pane" as const }),
    createTerminal: async () => ({ state: "no-pane" as const }),
    mountLocal: async (sessionId: string) => ({ state: "mounted" as const, sessionId }),
    history: {
      status: async () => ({
        reachable: false,
        detail: "fixture",
        checkedAt: "2026-10-03T00:00:00Z",
      }),
      facts: async () => [],
      search: async () => ({
        status: { reachable: false, detail: "fixture", checkedAt: "2026-10-03T00:00:00Z" },
        answered: false,
        hits: [],
        clipped: false,
      }),
    },
    usage: {
      snapshot: async () => ({ refreshedAt: "2026-10-03T00:00:00Z", entries: [] }),
      subscribe: () => () => undefined,
    },
  };
}

/** The stream's rows, folded here and not by the adapter: each desktop's
 * board by key, then every row's model row with the reader's one fact. */
function streamRows(text: string, upToSeq = Number.POSITIVE_INFINITY): Map<string, unknown> {
  const { meta, frames } = decodeModelStreamJsonl(text);
  const boards = new Map<string, Map<string, AgentModelBoardRow>>();
  for (const frame of frames) {
    if (frame.seq > upToSeq) break;
    if (frame.kind === "model-open") {
      boards.clear();
      for (const device of (frame.open as AgentModelMeshOpen).devices) {
        boards.set(
          device.device,
          new Map((device.snapshot?.rows ?? []).map((row) => [row.runtimeRunId, row])),
        );
      }
    } else if (frame.kind === "model-frame") {
      const wire = frame.frame as AgentModelMeshFrame;
      if ("snapshot" in wire)
        boards.set(wire.device, new Map(wire.snapshot.rows.map((row) => [row.runtimeRunId, row])));
      if ("delta" in wire) {
        const board = boards.get(wire.device) ?? new Map();
        for (const row of wire.delta.upserts) board.set(row.runtimeRunId, row);
        for (const key of wire.delta.removed) board.delete(key);
        boards.set(wire.device, board);
      }
    }
  }
  const rows = new Map<string, unknown>();
  for (const board of boards.values()) {
    for (const row of board.values()) {
      const model = row.monitorRow;
      if (model === undefined) continue;
      rows.set(
        model.id,
        JSON.parse(
          JSON.stringify({
            ...model,
            device: { ...model.device, self: model.device.id === meta.here },
          }),
        ),
      );
    }
  }
  return rows;
}

const VIEW_ONLY = new Set(["colour", "active", "receded", "attachment", "spawnHint"]);
function rowOf(view: AgentView): unknown {
  return JSON.parse(
    JSON.stringify(Object.fromEntries(Object.entries(view).filter(([key]) => !VIEW_ONLY.has(key)))),
  );
}

beforeEach(() => {
  vi.useFakeTimers({
    toFake: [
      "setTimeout",
      "clearTimeout",
      "setInterval",
      "clearInterval",
      "requestAnimationFrame",
      "cancelAnimationFrame",
      "performance",
    ],
  });
});

afterEach(() => {
  window.history.replaceState(null, "", "/");
  resetGodviewDoorInstrumentsForTest();
  resetGodviewPerfLabForTest();
  vi.useRealTimers();
});

describe("the model door's instrument", () => {
  it("with nothing asked, the feed's client is the client", () => {
    const real = refusingClient();
    expect(instrumentModelClient(real, "")).toBe(real);
    expect(instrumentModelClient(real, "?godviewRecord=1")).toBe(real);
    expect(instrumentModelClient(real, "?godviewMarkers=1&godviewPerf=1")).toBe(real);
    expect(godviewPerfLab()).toBeNull();
  });

  it("under replay, the model board is the player's and every other call the real client's", async () => {
    const real: DoorClient = {
      request: vi.fn(async () => "real-answer"),
      subscribe: vi.fn(async () => ({ snapshot: "real-board", unsubscribe: () => undefined })),
    };
    const client = instrumentModelClient(real, "?godviewReplay=1");
    expect(client).not.toBe(real);
    // one per renderer life, attached to the lab's player
    expect(instrumentModelClient(real, "?godviewReplay=1")).toBe(client);
    expect(godviewPerfLab()).not.toBeNull();
    await expect(client.request("agent.reportShown", { ids: ["x"] })).resolves.toEqual({
      reported: true,
    });
    await expect(client.request("agents.usage", {})).resolves.toBe("real-answer");
    const board = await client.subscribe(
      "agent.subscribe",
      { projection: "model", scope: "mesh" },
      () => undefined,
    );
    expect(board.snapshot).toEqual({ devices: [] });
    const desk = await client.subscribe(
      "agent.subscribe",
      { projection: "desk", scope: "mesh" },
      () => undefined,
    );
    expect(desk.snapshot).toBe("real-board");
    expect(real.request).toHaveBeenCalledTimes(1);
    expect(real.subscribe).toHaveBeenCalledTimes(1);
  });
});

describe("the B-side replay — on the tree as it stands", () => {
  it("the replayed model stream reaches the window adapter's replica, whose rows are the stream's rows", async () => {
    window.history.replaceState(null, "", "/?godviewPerf=1&godviewReplay=1");
    const real = refusingClient();
    // the window adapter, built as a window builds it: its client goes through the switch
    const feed = createGodviewMonitorFeed({ client: real });
    instrumentMonitorDoor(quietDoor());
    await vi.advanceTimersByTimeAsync(0);
    expect(feed.state()).toEqual({ state: "live", here: undefined });
    const lab = godviewPerfLab();
    if (lab === null) throw new Error("the switch installed no lab");
    const { player, probe } = lab;
    const loaded = player.load(RECIPE);
    const model = player.pushModel(STREAM);
    const { meta, frames } = decodeModelStreamJsonl(STREAM);
    expect(model).toEqual({
      corpus: "n10-2s-s1",
      frames: frames.length,
      marks: 1,
      corpusFrames: loaded.frames,
    });
    expect(player.source()).toBe("model");

    // what the marker's row says, each time the replica publishes
    const markerId = (meta.marker?.runtimeRunId ?? "").replace("run-", "run-pty-");
    const seen: string[] = [];
    feed.replica.subscribe(() => {
      const status = feed.replica.getSnapshot().model.byId.get(markerId)?.status;
      if (status !== undefined && seen.at(-1) !== status) seen.push(status);
    });

    probe.reset();
    const started = player.start();
    expect(started.source).toBe("model");
    expect(started.listeners).toEqual({ fold: 0, mesh: 0, devices: 0, model: 1 });
    await vi.advanceTimersByTimeAsync((meta.recipe?.durationMs ?? 2_000) + 1_000);
    const ended = player.state();
    expect(ended.phase).toBe("ended");
    expect(ended.delivered).toBe(ended.total);
    // nothing on this tree reads the fold or the desk's mesh: every corpus
    // frame was passed over, and every model frame was handed to the adapter
    expect(ended.skipped).toBe(loaded.frames);
    expect(ended.total).toBe(loaded.frames + frames.length);
    expect(ended.model).toEqual({
      subscribes: 0,
      opens: 1,
      frames: frames.filter((frame) => frame.kind === "model-frame").length,
      reports: 0,
    });
    expect(ended.marks.map((mark) => mark.name)).toEqual(["status-flip"]);
    expect(probe.report().marks.map((mark) => mark.name)).toEqual(["status-flip"]);
    // no gap was asked: the feed's one subscription heard the whole stream
    expect(real.calls).toEqual([]);
    expect(feed.state()).toEqual({ state: "live", here: meta.here });

    // THE ROWS: the replica's, without the window-only joins, against the stream's own
    await vi.advanceTimersByTimeAsync(100); // the replica's frame
    const expected = streamRows(STREAM);
    const agents = feed.replica.getSnapshot().model.agents;
    expect(agents).toHaveLength(expected.size);
    expect(agents).toHaveLength(
      (meta.recipe?.n ?? 0) + (meta.recipe?.bareTerminals ?? 0) + (meta.recipe?.peerAgents ?? 0),
    );
    for (const view of agents) expect(rowOf(view), view.id).toEqual(expected.get(view.id));
    // and the marker's change reached it: idle, then blocked
    expect(seen).toEqual(["idle", "blocked"]);
    feed.dispose();
  });

  it("refuses a stream for another corpus, and plays the fold source untouched without one", async () => {
    window.history.replaceState(null, "", "/?godviewPerf=1&godviewReplay=1");
    const feed = createGodviewMonitorFeed({ client: refusingClient() });
    const replayDoor = instrumentMonitorDoor(quietDoor());
    const lab = godviewPerfLab();
    if (lab === null) throw new Error("the switch installed no lab");
    lab.player.load("n=20,duration=2000,seed=1");
    expect(() => lab.player.pushModel(STREAM)).toThrow(/does not belong/);
    expect(lab.player.source()).toBe("fold");
    const started = lab.player.start();
    expect(started.source).toBe("fold");
    expect(started.model).toBeNull();
    await vi.advanceTimersByTimeAsync(3_000);
    expect(lab.player.state().phase).toBe("ended");
    expect(lab.player.state().skipped).toBe(0);
    expect(replayDoor).not.toBeNull();
    feed.dispose();
  });
});
