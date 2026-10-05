/**
 * THE REPLAY DOOR (MV-0): a corpus stands where the daemon stood, and the seam
 * cannot tell. What this holds: both streams reach their subscribers in order;
 * a late mesh subscriber is re-snapshotted like a fresh subscription; the
 * roster is the corpus's; `deliverText` reads a fold frame the way the deck's
 * `observe` does (zod, an unreadable frame is a reason); and the verbs that are
 * not the corpus's go to the real door when there is one and refuse honestly
 * when there is not. The model board is one of them (MV-3b): the window reads
 * its rows through `door.model`, and under the lab that board is the model
 * replay client's (`modelBoardOver` instruments it), so a replay door that
 * dropped it left the window with no feed at all.
 */
import type { AgentMeshOpen } from "@vibefield/contracts";
import { describe, expect, it, vi } from "vitest";
import { generateCorpus } from "../src/godview/monitor/perf/corpus";
import type { RecordedFrame } from "../src/godview/monitor/perf/frame-recorder";
import { createReplayDoor } from "../src/godview/monitor/perf/replay-door";
import type { MonitorDoor } from "../src/godview/monitor/remote-door";

// long enough for desk frames to land outside the marker's quiet window
const corpus = generateCorpus({ n: 3, durationMs: 1_200, seed: 5, markerQuietMs: 100 });
const frames = corpus.frames;
const firstFold = frames.find((frame) => frame.kind === "fold") as Extract<
  RecordedFrame,
  { kind: "fold" }
>;
const open = frames.find((frame) => frame.kind === "mesh-open") as Extract<
  RecordedFrame,
  { kind: "mesh-open" }
>;

describe("the replay door", () => {
  it("feeds both streams in order and re-snapshots a late mesh subscriber", () => {
    const door = createReplayDoor({ roster: corpus.roster });
    const seen: string[] = [];
    door.observe({
      onFrame: (rows) => seen.push(`fold:${rows.length}`),
      onError: (reason) => seen.push(`fold-error:${reason}`),
    });
    for (const frame of frames.slice(0, 4)) door.deliver(frame);
    expect(seen[0]).toBe("fold:3");
    // the mesh subscriber arrives AFTER the open was delivered: it gets it at once
    const mesh: string[] = [];
    door.observeMesh({
      onOpen: (value: AgentMeshOpen) => mesh.push(`open:${value.devices.length}`),
      onFrame: (frame) => mesh.push(`frame:${frame.device}`),
      onError: (failure) => mesh.push(`error:${failure.reason}`),
    });
    expect(mesh).toEqual(["open:2"]);
    const delta = frames.find((frame) => frame.kind === "mesh-frame") as Extract<
      RecordedFrame,
      { kind: "mesh-frame" }
    >;
    door.deliver(delta);
    expect(mesh.at(-1)).toBe(`frame:${delta.frame.device}`);
    door.deliver({
      seq: 999,
      t: 1,
      wall: 1,
      kind: "mesh-error",
      failure: { reason: "gone", retryable: true },
    });
    door.deliver({ seq: 1000, t: 1, wall: 1, kind: "fold-error", reason: "closed" });
    expect(mesh.at(-1)).toBe("error:gone");
    expect(seen.at(-1)).toBe("fold-error:closed");
    expect(door.listeners()).toEqual({ fold: 1, mesh: 1, devices: 0 });
  });

  it("hands the corpus's roster to the roster port and marks to the harness", () => {
    const marks: string[] = [];
    const door = createReplayDoor({
      roster: corpus.roster,
      onMark: (frame) => marks.push(frame.name),
    });
    const rosters: number[] = [];
    const stop = door.devices?.subscribe((devices) => rosters.push(devices.length));
    expect(rosters).toEqual([2]);
    stop?.();
    expect(door.listeners().devices).toBe(0);
    const mark = frames.find((frame) => frame.kind === "mark") as RecordedFrame;
    door.deliver(mark);
    expect(marks).toEqual(["status-flip"]);
  });

  it("reads a text line the way the deck reads a frame, and reports an unreadable one", () => {
    const door = createReplayDoor({ roster: [] });
    const seen: string[] = [];
    door.observe({
      onFrame: (rows) => seen.push(`fold:${rows[0]?.runtimeRunId ?? "-"}`),
      onError: (reason) => seen.push(`error:${reason}`),
    });
    door.deliverText(JSON.stringify(firstFold));
    expect(seen).toEqual([`fold:${firstFold.rows[0]?.runtimeRunId}`]);
    door.deliverText(JSON.stringify({ ...firstFold, rows: [{ not: "a row" }] }));
    expect(seen.at(-1)).toMatch(/^error:agent\.subscribe answered an unreadable frame/);
    door.deliverText("{not json");
    expect(seen.at(-1)).toMatch(/^error:replay: an unreadable line/);
    // a non-fold line takes the parsed path
    const mesh: string[] = [];
    door.observeMesh({
      onOpen: (value) => mesh.push(`open:${value.devices.length}`),
      onFrame: () => mesh.push("frame"),
      onError: () => mesh.push("error"),
    });
    door.deliverText(JSON.stringify(open));
    expect(mesh).toEqual(["open:2"]);
  });

  it("sends the verbs that are not the corpus's to the real door, or refuses without one", async () => {
    const bare = createReplayDoor({ roster: [] });
    expect(await bare.attach({} as never)).toEqual({ state: "no-pane" });
    expect(await bare.createTerminal()).toEqual({ state: "no-pane" });
    expect(await bare.mountLocal("s1")).toEqual({ state: "no-pane" });
    expect(bare.profiles).toBeUndefined();
    expect(bare.model).toBeUndefined();

    const real: MonitorDoor = {
      observe: vi.fn(() => () => undefined),
      observeMesh: vi.fn(() => () => undefined),
      attach: vi.fn(async () => ({ state: "attached" as const, sessionId: "r", readWrite: true })),
      createTerminal: vi.fn(async () => ({ state: "mounted" as const, sessionId: "born" })),
      mountLocal: vi.fn(async (sessionId: string) => ({ state: "mounted" as const, sessionId })),
      history: {
        status: async () => ({
          reachable: true,
          detail: "real",
          checkedAt: "2026-10-03T00:00:00Z",
        }),
        facts: async () => [],
        search: async () => ({
          status: { reachable: true, detail: "real", checkedAt: "2026-10-03T00:00:00Z" },
          answered: true,
          hits: [],
          clipped: false,
        }),
      },
      usage: {
        snapshot: async () => ({ refreshedAt: "2026-10-03T00:00:00Z", entries: [] }),
        subscribe: () => () => undefined,
      },
      profiles: { subscribe: () => () => undefined },
      devices: { subscribe: vi.fn(() => () => undefined) },
      model: {
        subscribe: vi.fn(async () => ({ snapshot: null, unsubscribe: () => undefined })),
        reportShown: vi.fn(async () => ({ reported: true })),
      },
    };
    const door = createReplayDoor({ real, roster: corpus.roster });
    expect(await door.mountLocal("s2")).toEqual({ state: "mounted", sessionId: "s2" });
    expect(await door.createTerminal()).toEqual({ state: "mounted", sessionId: "born" });
    expect(door.history).toBe(real.history);
    expect(door.usage).toBe(real.usage);
    expect(door.profiles).toBe(real.profiles);
    expect(door.model).toBe(real.model);
    // the streams and the roster stay the corpus's: the real door is never asked
    door.observe({ onFrame: () => undefined, onError: () => undefined });
    door.devices?.subscribe(() => undefined);
    expect(real.observe).not.toHaveBeenCalled();
    expect(real.devices?.subscribe).not.toHaveBeenCalled();
  });
});
