// @vitest-environment happy-dom
/**
 * THE CORPUS CLOCK (MV-3c, build-mv M31): while a replay plays, the page's
 * `Date.now` reads the corpus's own wall time. Today's seam classifies recency
 * in the renderer against `Date.now()`; the model stream's backend computed the
 * same rows' recency offline, at the corpus's time. Under the clock the two
 * agree on every row; under the machine's clock a corpus dated a day ago draws
 * every row stale on A's seam while B's rows say fresh — the harness artifact
 * the clock exists to remove.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { gunzipSync } from "node:zlib";
import { classifyMonitorRecency } from "@vibecook/puppeteer-core";
import type { AgentSessionSummary } from "@vibefield/contracts";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createModelReplayClient } from "../src/godview/monitor/perf/model-replay-client";
import { createReplayDoor } from "../src/godview/monitor/perf/replay-door";
import { createReplayPlayer, type ReplayClock } from "../src/godview/monitor/perf/replay-player";
import {
  freezeWallClock,
  restoreWallClock,
  shiftWallClock,
  wallClockState,
} from "../src/godview/monitor/perf/wall-clock";

const STREAM = gunzipSync(
  readFileSync(
    join(import.meta.dirname, "fixtures", "godview-model-streams", "n10-2s-s1.model.jsonl.gz"),
  ),
).toString("utf8");
const RECIPE = "n=10,duration=2000,seed=1";
const DAY_MS = 86_400_000;

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "performance"] });
});

afterEach(() => {
  restoreWallClock();
  vi.useRealTimers();
});

describe("the wall clock", () => {
  it("shifts Date.now, freezes it, and gives the machine's back", () => {
    const machine = Date.now;
    const corpus = Date.parse("2026-10-03T12:00:00Z");
    shiftWallClock(corpus);
    expect(Math.abs(Date.now() - corpus)).toBeLessThan(1_000);
    expect(wallClockState().shifted).toBe(true);
    freezeWallClock(corpus + 5_000);
    expect(Date.now()).toBe(corpus + 5_000);
    expect(Date.now()).toBe(corpus + 5_000);
    restoreWallClock();
    expect(Date.now).toBe(machine);
    expect(wallClockState().shifted).toBe(false);
    expect(Math.abs(Date.now() - corpus)).toBeGreaterThan(DAY_MS / 2);
  });
});

/** One replay of the n10 corpus with its model stream; at the end, what the
 * seam would classify for each run (against `Date.now()` as read when the last
 * fold frame arrived) beside what the backend said (`monitorRow.stale`). */
async function replay(clock: ReplayClock) {
  const player = createReplayPlayer();
  const door = createReplayDoor({
    roster: { current: () => player.roster(), onChange: (listener) => player.onRoster(listener) },
  });
  player.attach(door);
  const model = createModelReplayClient();
  player.attachModel(model);
  let seam = new Map<string, boolean>();
  door.observe({
    onFrame(rows: readonly AgentSessionSummary[]) {
      const nowMs = Date.now();
      seam = new Map(
        rows.map((row) => [
          row.runtimeRunId,
          classifyMonitorRecency(row.monitor?.freshness?.lastEvidenceAt, nowMs).recency === "stale",
        ]),
      );
    },
    onError: () => undefined,
  });
  await model.subscribe("agent.subscribe", { projection: "model", scope: "mesh" }, () => undefined);
  player.load(RECIPE);
  player.pushModel(STREAM);
  player.setClock(clock);
  const started = player.start();
  expect(started.clock).toBe(clock);
  expect(started.source).toBe("model");
  await vi.advanceTimersByTimeAsync(3_000);
  const ended = player.state();
  expect(ended.phase).toBe("ended");
  const shiftedAtEnd = wallClockState().shifted;
  const backend = new Map<string, boolean>();
  for (const device of model.current().devices) {
    for (const row of device.snapshot?.rows ?? []) {
      if ("monitorRow" in row && row.monitorRow?.kind === "agent") {
        backend.set(row.runtimeRunId, row.monitorRow.stale === true);
      }
    }
  }
  player.stop();
  return {
    seam,
    backend,
    shiftedAtEnd,
    work: ended.work,
    delivered: ended.delivered,
    skipped: ended.skipped,
  };
}

describe("the seam's recency and the backend's, under the corpus clock", () => {
  it("agree on every run the two share", async () => {
    const { seam, backend, shiftedAtEnd, work, delivered, skipped } = await replay("corpus");
    expect(shiftedAtEnd).toBe(true);
    const shared = [...seam.keys()].filter((id) => backend.has(id));
    expect(shared.length).toBeGreaterThanOrEqual(8);
    for (const id of shared)
      expect({ id, stale: seam.get(id) }).toEqual({ id, stale: backend.get(id) });
    // the stop gives the machine's clock back
    expect(wallClockState().shifted).toBe(false);
    // each frame handed over was timed (the ones nobody reads were passed over)
    expect(work.count).toBe(delivered - skipped);
    expect(work.count).toBeGreaterThan(0);
  });

  it("disagree under the machine's clock — the artifact the clock removes", async () => {
    vi.spyOn(Date, "now").mockReturnValue(Date.parse("2026-10-04T21:00:00Z"));
    const { seam, backend, shiftedAtEnd } = await replay("real");
    expect(shiftedAtEnd).toBe(false);
    const shared = [...seam.keys()].filter((id) => backend.has(id));
    expect(shared.length).toBeGreaterThanOrEqual(8);
    const disagree = shared.filter((id) => seam.get(id) !== backend.get(id));
    // a day after the corpus every seam row reads stale; the backend's do not
    expect(shared.every((id) => seam.get(id) === true)).toBe(true);
    expect(disagree.length).toBeGreaterThan(0);
  });

  it("a start that ends at `untilT` delivers only the frames up to it", async () => {
    const player = createReplayPlayer();
    const door = createReplayDoor({
      roster: { current: () => player.roster(), onChange: (listener) => player.onRoster(listener) },
    });
    player.attach(door);
    const ts: number[] = [];
    door.observe({ onFrame: () => ts.push(performance.now()), onError: () => undefined });
    const loaded = player.load(RECIPE);
    player.start({ untilT: 1_000 });
    await vi.advanceTimersByTimeAsync(3_000);
    const ended = player.state();
    expect(ended.phase).toBe("ended");
    expect(ended.delivered).toBeGreaterThan(0);
    expect(ended.delivered).toBeLessThan(loaded.frames);
    player.start();
    await vi.advanceTimersByTimeAsync(3_000);
    expect(player.state().delivered).toBe(loaded.frames);
  });

  it("names the corpus's wall at a fixed frame, as a capture freezes it", () => {
    const player = createReplayPlayer();
    expect(player.wallAt(1_000)).toBeNull();
    player.load(RECIPE);
    const base = Date.parse("2026-10-03T12:00:00Z");
    expect(player.wallAt(0)).toBe(base);
    expect(player.wallAt(1_500)).toBe(base + 1_500);
  });
});
