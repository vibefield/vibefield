// @vitest-environment happy-dom
/**
 * THE FRAME RECORDER (MV-0): what the door is handed, written down — and the
 * one property every later slice leans on, that with no switch set the deck's
 * door is THE SAME OBJECT it was. A recorder that cost the shipping path even a
 * wrapper would make every MV-0 baseline a baseline of the instrument.
 */
import type { AgentMeshFrame, AgentMeshOpen } from "@vibefield/contracts";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AgentSessionSummary } from "../src/godview/monitor/facet-types";
import {
  GODVIEW_RECORD_PARAM,
  godviewDoorInstrument,
  instrumentMonitorDoor,
  resetGodviewDoorInstrumentsForTest,
} from "../src/godview/monitor/perf/door-instruments";
import {
  createFrameRecorder,
  decodeFramesJsonl,
  encodeFramesJsonl,
  type RecordedFrame,
  type RecorderClock,
  recordingDoor,
} from "../src/godview/monitor/perf/frame-recorder";
import type { MeshBoardListener, MonitorDoor } from "../src/godview/monitor/remote-door";
import { managedSummary } from "./managed-session-fixture";

interface Taps {
  fold: ((rows: readonly AgentSessionSummary[]) => void) | null;
  foldError: ((reason: string) => void) | null;
  mesh: MeshBoardListener | null;
  disposed: { fold: number; mesh: number };
}

/** A door whose two streams a test pushes into by hand; every other member is
 * a distinct function so identity can be checked member by member. */
function door(): { door: MonitorDoor; taps: Taps } {
  const taps: Taps = { fold: null, foldError: null, mesh: null, disposed: { fold: 0, mesh: 0 } };
  const built: MonitorDoor = {
    observe: (listener) => {
      taps.fold = listener.onFrame;
      taps.foldError = listener.onError;
      return () => {
        taps.disposed.fold += 1;
      };
    },
    observeMesh: (listener) => {
      taps.mesh = listener;
      return () => {
        taps.disposed.mesh += 1;
      };
    },
    attach: vi.fn(async () => ({ state: "no-pane" as const })),
    createTerminal: vi.fn(async () => ({ state: "no-pane" as const })),
    mountLocal: vi.fn(async (sessionId: string) => ({ state: "mounted" as const, sessionId })),
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
    devices: { subscribe: () => () => undefined },
    profiles: { subscribe: () => () => undefined },
    statusHistory: { load: async () => [] },
  };
  return { door: built, taps };
}

function clock(): RecorderClock & { tick(ms: number): void } {
  let t = 1_000;
  let wall = 1_759_500_000_000;
  return {
    now: () => t,
    wall: () => wall,
    tick(ms) {
      t += ms;
      wall += ms;
    },
  };
}

const OPEN: AgentMeshOpen = {
  devices: [{ device: "desk-a", state: "live", asOf: "2026-10-03T00:00:00.000Z" }],
};
const FRAME: AgentMeshFrame = {
  device: "desk-a",
  state: "stale",
  asOf: "2026-10-03T00:00:01.000Z",
};

afterEach(() => {
  resetGodviewDoorInstrumentsForTest();
});

describe("the frame recorder", () => {
  it("stamps every event in order on both clocks and hands the listener the same objects", () => {
    const c = clock();
    const recorder = createFrameRecorder({ clock: c });
    const { door: inner, taps } = door();
    const teed = recordingDoor(inner, recorder);

    const seen: unknown[] = [];
    teed.observe({ onFrame: (rows) => seen.push(rows), onError: (reason) => seen.push(reason) });
    teed.observeMesh({
      onOpen: (open) => seen.push(open),
      onFrame: (frame) => seen.push(frame),
      onError: (failure) => seen.push(failure),
    });

    const rows = [managedSummary({ runtimeRunId: "run-1" })];
    taps.fold?.(rows);
    c.tick(16);
    taps.mesh?.onOpen(OPEN);
    c.tick(100);
    taps.mesh?.onFrame(FRAME);
    c.tick(1);
    taps.foldError?.("the daemon went away");
    taps.mesh?.onError({ reason: "board not ready", retryable: true });

    // delivered untouched, in order
    expect(seen).toEqual([
      rows,
      OPEN,
      FRAME,
      "the daemon went away",
      { reason: "board not ready", retryable: true },
    ]);
    expect(seen[0]).toBe(rows);
    expect(seen[1]).toBe(OPEN);

    const frames = recorder.drain();
    expect(frames.map((frame) => [frame.kind, frame.seq, frame.t])).toEqual([
      ["fold", 1, 1_000],
      ["mesh-open", 2, 1_016],
      ["mesh-frame", 3, 1_116],
      ["fold-error", 4, 1_117],
      ["mesh-error", 5, 1_117],
    ]);
    expect(frames[0]?.wall).toBe(1_759_500_000_000);
    expect(frames[0]?.kind === "fold" ? frames[0].rows : undefined).toBe(rows);
    // drained means forgotten
    expect(recorder.held()).toBe(0);
    expect(recorder.drain()).toEqual([]);
  });

  it("forwards disposes and keeps every other door member by identity", () => {
    const recorder = createFrameRecorder({ clock: clock() });
    const { door: inner, taps } = door();
    const teed = recordingDoor(inner, recorder);
    expect(teed).not.toBe(inner);
    for (const key of [
      "attach",
      "createTerminal",
      "mountLocal",
      "history",
      "usage",
      "devices",
      "profiles",
      "statusHistory",
    ] as const) {
      expect(teed[key]).toBe(inner[key]);
    }
    const stopFold = teed.observe({ onFrame: () => undefined, onError: () => undefined });
    const stopMesh = teed.observeMesh({
      onOpen: () => undefined,
      onFrame: () => undefined,
      onError: () => undefined,
    });
    stopFold();
    stopMesh();
    expect(taps.disposed).toEqual({ fold: 1, mesh: 1 });
  });

  it("is bounded: frames past the capacity are counted, never kept, and the count clears on drain", () => {
    const recorder = createFrameRecorder({ clock: clock(), capacity: 2 });
    recorder.record({ kind: "mark", name: "a" });
    recorder.record({ kind: "mark", name: "b" });
    const third = recorder.record({ kind: "mark", name: "c" });
    expect(third.seq).toBe(3);
    expect(recorder.held()).toBe(2);
    expect(recorder.dropped()).toBe(1);
    expect(recorder.drain().map((frame) => (frame.kind === "mark" ? frame.name : ""))).toEqual([
      "a",
      "b",
    ]);
    expect(recorder.dropped()).toBe(0);
  });

  it("round-trips through JSONL and skips lines that are not frames", () => {
    const c = clock();
    const recorder = createFrameRecorder({ clock: c });
    recorder.record({ kind: "fold", rows: [managedSummary({ runtimeRunId: "run-7" })] });
    c.tick(16);
    recorder.record({ kind: "mesh-open", open: OPEN });
    recorder.record({ kind: "mark", name: "flip", detail: { agent: "run-7" } });
    const frames = recorder.drain();
    const text = `${JSON.stringify({ kind: "meta", version: 1 })}\nnot json\n${encodeFramesJsonl(frames)}\n{"kind":"fold"}\n`;
    const decoded = decodeFramesJsonl(text);
    expect(decoded).toEqual(JSON.parse(JSON.stringify(frames)) as RecordedFrame[]);
    expect(encodeFramesJsonl([])).toBe("");
  });
});

describe("the door's instruments", () => {
  it("read the switch from the renderer's URL", () => {
    expect(godviewDoorInstrument("")).toBe("off");
    expect(godviewDoorInstrument("?godviewMarkers=1")).toBe("off");
    expect(godviewDoorInstrument(`?${GODVIEW_RECORD_PARAM}=1`)).toBe("record");
    expect(godviewDoorInstrument(`?${GODVIEW_RECORD_PARAM}=0`)).toBe("off");
  });

  it("hand back THE SAME door when nothing is asked — the shipping path is unchanged", () => {
    const { door: inner } = door();
    expect(instrumentMonitorDoor(inner, "")).toBe(inner);
    expect(instrumentMonitorDoor(inner, "?godviewMarkers=1")).toBe(inner);
    expect(window.__vfGodviewRecorder).toBeUndefined();
  });

  it("record through one published recorder the host can drain as JSONL", () => {
    const { door: inner, taps } = door();
    const teed = instrumentMonitorDoor(inner, `?${GODVIEW_RECORD_PARAM}=1`);
    expect(teed).not.toBe(inner);
    const bridge = window.__vfGodviewRecorder;
    expect(bridge).toBeDefined();
    teed.observe({ onFrame: () => undefined, onError: () => undefined });
    taps.fold?.([managedSummary({ runtimeRunId: "run-1" })]);
    taps.fold?.([]);
    expect(bridge?.held()).toBe(2);
    const text = bridge?.drain() ?? "";
    const frames = decodeFramesJsonl(text);
    expect(frames.map((frame) => frame.kind)).toEqual(["fold", "fold"]);
    expect(frames[0]?.kind === "fold" ? frames[0].rows[0]?.runtimeRunId : "").toBe("run-1");
    expect(bridge?.held()).toBe(0);
    expect(bridge?.drain()).toBe("");
    // a second door (a new runtime) records into the same buffer
    const again = instrumentMonitorDoor(door().door, `?${GODVIEW_RECORD_PARAM}=1`);
    expect(window.__vfGodviewRecorder).toBe(bridge);
    expect(again).not.toBe(inner);
  });
});
