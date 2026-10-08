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
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createModelReplayClient } from "../src/godview/monitor/perf/model-replay-client";
import { createReplayPlayer } from "../src/godview/monitor/perf/replay-player";
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
  vi.useFakeTimers({ toFake: ["Date", "setTimeout", "clearTimeout", "performance"] });
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

/** A live model subscriber records the wall clock at each delivered frame. */
async function replay() {
  const player = createReplayPlayer();
  const model = createModelReplayClient();
  player.attachModel(model);
  const times: { monotonic: number; wall: number }[] = [];
  await model.subscribe("agent.subscribe", { projection: "model", scope: "mesh" }, () => {
    times.push({ monotonic: performance.now(), wall: Date.now() });
  });
  player.load(RECIPE);
  player.pushModel(STREAM);
  return { player, times };
}

describe("the model replay's corpus clock", () => {
  it("delivers model frames on the corpus wall and restores the machine clock on stop", async () => {
    const { player, times } = await replay();
    const wall = player.wallAt(0);
    expect(wall).not.toBeNull();
    player.start();
    await vi.advanceTimersByTimeAsync(3_000);
    expect(player.state().phase).toBe("ended");
    expect(times.length).toBeGreaterThan(10);
    for (const time of times)
      expect(Math.abs(time.wall - (wall ?? 0) - time.monotonic)).toBeLessThan(1);
    expect(wallClockState().shifted).toBe(true);
    const { work, delivered, skipped } = player.state();
    expect(work.count).toBe(delivered - skipped);
    expect(work.count).toBeGreaterThan(0);
    player.stop();
    expect(wallClockState().shifted).toBe(false);
  });

  it("can leave the machine clock untouched for an explicit real-clock diagnostic", async () => {
    const { player, times } = await replay();
    const machine = Date.now;
    player.setClock("real");
    player.start();
    await vi.advanceTimersByTimeAsync(3_000);
    expect(Date.now).toBe(machine);
    expect(times.length).toBeGreaterThan(10);
    expect(wallClockState().shifted).toBe(false);
    player.stop();
  });

  it("stops at the capture's requested frame and can replay the whole stream afterward", async () => {
    const { player, times } = await replay();
    player.start({ untilT: 1_000 });
    await vi.advanceTimersByTimeAsync(3_000);
    const ended = player.state();
    expect(ended.phase).toBe("ended");
    expect(ended.delivered).toBeGreaterThan(0);
    expect(ended.delivered).toBeLessThan(ended.total);
    expect(times.every((time) => time.monotonic <= 1_000)).toBe(true);
    const partial = times.length;
    times.length = 0;
    player.start();
    await vi.advanceTimersByTimeAsync(3_000);
    expect(player.state().delivered).toBe(player.state().total);
    expect(times.length).toBeGreaterThan(partial);
    player.stop();
  });

  it("names the corpus wall at a fixed frame, as a capture freezes it", () => {
    const player = createReplayPlayer();
    expect(player.wallAt(1_000)).toBeNull();
    player.load(RECIPE);
    const base = Date.parse("2026-10-03T12:00:00Z");
    expect(player.wallAt(0)).toBe(base);
    expect(player.wallAt(1_500)).toBe(base + 1_500);
  });
});
