/**
 * PT-2 — the page live in the product (testing/smoke-live-pane.ts): the judges the live-pane rows hold the product to — the
 * fixture's own hue (the classifier the renderer runs, run here as the same text), LIVE, IDLE, PLAYING, HELD, UNSEEN, RELOAD
 * and GONE — each passing what the product should do and failing, in words with its numbers, what it should not.
 */
import { describe, expect, it } from "vitest";
import { FIXTURE_HUE } from "../src/testing/live-fixture";
import {
  CLASSIFY,
  type Counts,
  FIXTURE_HUE_DEG,
  judgeGone,
  judgeHeld,
  judgeIdle,
  judgeLive,
  judgePlaying,
  judgeReload,
  judgeUnseen,
  LIVE_ROWS,
  type LiveSeen,
} from "../src/testing/smoke-live-pane";

const classify = new Function(`return ${CLASSIFY}`)() as (
  r: number,
  g: number,
  b: number,
) => number;

const counts = (over: Partial<Counts> = {}): Counts => ({
  frames: 100,
  arrivals: 40,
  presented: 40,
  writers: 1,
  epoch: 0,
  ...over,
});

describe("the live page's pixels — the fixture's own hue", () => {
  it("knows the fixture's ground by its hue, light or shaded; white as white; the mat, the runner, the bars and greys as neither", () => {
    expect(FIXTURE_HUE_DEG).toBeCloseTo(213.7, 1);
    const { r, g, b } = FIXTURE_HUE;
    expect(classify(r, g, b)).toBe(1);
    expect(classify(20, 80, 160)).toBe(1); // the ground under a shade
    expect(classify(255, 255, 255)).toBe(2);
    expect(classify(247, 243, 235)).toBe(2); // the sample's warm white is white, never the fixture
    expect(classify(64, 120, 90)).toBe(0); // the mat's green
    expect(classify(255, 211, 77)).toBe(0); // the runner
    expect(classify(192, 215, 244)).toBe(0); // a bar: white over the ground, too pale to be it
    expect(classify(29, 170, 216)).toBe(0); // a cyan: another blue, not the fixture's
    expect(classify(128, 128, 128)).toBe(0);
    expect(classify(0, 0, 0)).toBe(0);
    expect(classify(10, 30, 60)).toBe(0); // the ground's hue in the dark: too dim to be its pixels
  });
});

describe("the live page's rows", () => {
  const face = { px: 10_000, hue: 7_800, white: 800, colors: 60, lumaRange: 170 };

  it("LIVE: the face live with a present and the page the fixture's — never the sample's still or the film", () => {
    const ok: LiveSeen["live"] = {
      state: "live",
      presented: 1,
      address: "http://127.0.0.1:1/page",
      face,
    };
    expect(judgeLive(ok)).toEqual([]);
    expect(judgeLive({ ...ok, state: "starting" })).toEqual([
      "LIVE: the face is starting, not live",
    ]);
    expect(judgeLive({ ...ok, state: null })).toEqual(["LIVE: the face is not open, not live"]);
    expect(judgeLive({ ...ok, presented: 0 })).toEqual([
      "LIVE: no frame was presented into the face",
    ]);
    expect(judgeLive({ ...ok, face: null })).toEqual(["LIVE: the page was not captured"]);
    // the sample's still: light, contrasted — and none of the fixture's blue
    expect(judgeLive({ ...ok, face: { ...face, hue: 0, white: 6_000 } })[0]).toMatch(
      /^LIVE: 0 of the page is the fixture's blue, under 0.5/,
    );
    expect(judgeLive({ ...ok, face: { ...face, white: 100 } })).toEqual([
      "LIVE: 0.01 of the page is its white headline, under 0.03",
    ]);
    expect(judgeLive({ ...ok, face: { ...face, lumaRange: 40 } })).toEqual([
      "LIVE: the page's luma spans 40, under 120",
    ]);
  });

  it("IDLE: a still page draws no frame and presents nothing over the watch", () => {
    const ok: LiveSeen["idle"] = { ms: 1205, from: counts(), to: counts() };
    expect(judgeIdle(ok)).toEqual([]);
    expect(judgeIdle({ ...ok, to: counts({ frames: 102 }) })).toEqual([
      "IDLE: the desk drew 2 frames over 1205 ms of a still page",
    ]);
    expect(judgeIdle({ ...ok, to: counts({ presented: 41 }) })).toEqual([
      "IDLE: 1 frames presented from a still page",
    ]);
    expect(judgeIdle({ ...ok, ms: 600 })).toEqual(["IDLE: watched 600 ms, under 1200"]);
  });

  it("PLAYING: presents at the source's rate, the desk drawing as many, the writer never remade", () => {
    const ok: LiveSeen["playing"] = {
      ms: 2000,
      from: counts(),
      to: counts({ presented: 100, arrivals: 101, frames: 161 }),
    };
    expect(judgePlaying(ok)).toEqual([]);
    expect(judgePlaying({ ...ok, to: counts({ presented: 50, frames: 110 }) })).toEqual([
      "PLAYING: 5 presents a second (10 in 2000 ms), not 18–40",
    ]);
    expect(judgePlaying({ ...ok, to: counts({ presented: 130, frames: 190 }) })).toEqual([
      "PLAYING: 45 presents a second (90 in 2000 ms), not 18–40",
    ]);
    expect(judgePlaying({ ...ok, to: counts({ presented: 100, frames: 130 }) })).toEqual([
      "PLAYING: the desk drew 30 frames for 60 presents (± 12)",
    ]);
    expect(
      judgePlaying({ ...ok, to: counts({ presented: 100, frames: 161, writers: 2 }) }),
    ).toEqual(["PLAYING: the writer was remade (1 → 2)"]);
    expect(judgePlaying({ ...ok, to: counts({ presented: 100, frames: 161, epoch: 1 }) })).toEqual([
      "PLAYING: the face's texture was remade (epoch 0 → 1)",
    ]);
  });

  it("HELD: the kind asks native at 60, interactive, and the wire says so at priority 80", () => {
    const ok: LiveSeen["held"] = {
      held: true,
      ask: { mode: "live", fps: 60, raster: [2560, 1600], interactive: true },
      wire: { mode: "live", targetFps: 60, priority: 80, interactive: true },
    };
    expect(judgeHeld(ok)).toEqual([]);
    expect(judgeHeld({ ...ok, held: false })).toEqual(["HELD: the pane never came into the hand"]);
    expect(
      judgeHeld({ ...ok, ask: { ...ok.ask, fps: 30, interactive: false } as never })[0],
    ).toMatch(/^HELD: the kind asked .*"fps":30.*, not live at 60, interactive$/);
    expect(judgeHeld({ ...ok, wire: { ...ok.wire, priority: 50 } as never })[0]).toMatch(
      /^HELD: the wire says .*"priority":50.*, not live at 60, interactive, priority 80$/,
    );
    expect(judgeHeld({ ...ok, wire: null })).toEqual([
      "HELD: the wire says null, not live at 60, interactive, priority 80",
    ]);
  });

  it("UNSEEN: off screen, the ask and the wire paused, and no frame arrives — the source paused, not merely undrawn", () => {
    const ok: LiveSeen["unseen"] = {
      offScreen: true,
      ask: { mode: "paused", fps: 0, raster: [0, 0], interactive: false },
      wire: { mode: "paused", targetFps: 0, priority: 0, interactive: false },
      ms: 1210,
      from: counts(),
      to: counts(),
    };
    expect(judgeUnseen(ok)).toEqual([]);
    expect(judgeUnseen({ ...ok, offScreen: false })).toEqual([
      "UNSEEN: the pane never left the screen",
    ]);
    expect(judgeUnseen({ ...ok, ask: { ...ok.ask, mode: "live" } as never })[0]).toMatch(
      /^UNSEEN: the kind asked .*"mode":"live".*, not paused$/,
    );
    expect(judgeUnseen({ ...ok, wire: null })).toEqual(["UNSEEN: the wire says null, not paused"]);
    // frames still arriving and dropped: drawn nowhere, but the source never paused
    expect(judgeUnseen({ ...ok, to: counts({ arrivals: 76 }) })).toEqual([
      "UNSEEN: 36 frames arrived from a paused source over 1210 ms",
    ]);
    expect(judgeUnseen({ ...ok, to: counts({ presented: 41 }) })).toEqual([
      "UNSEEN: 1 frames presented off screen",
    ]);
  });

  it("RELOAD: the desk ready, the face live with a frame — and the same page: no new load, no new token", () => {
    const ok: LiveSeen["reload"] = {
      ready: true,
      state: "live",
      presented: 3,
      loads: [1, 1],
      tokens: [["a1"], ["a1"]],
    };
    expect(judgeReload(ok)).toEqual([]);
    expect(judgeReload({ ...ok, ready: false })).toEqual([
      "RELOAD: the desk was not ready again after the reload",
    ]);
    expect(judgeReload({ ...ok, state: "starting", presented: 0 })).toEqual([
      "RELOAD: the face is starting after the reload, not live",
      "RELOAD: no frame was presented after the reload",
    ]);
    expect(judgeReload({ ...ok, loads: [1, 2], tokens: [["a1"], ["a1", "b2"]] })).toEqual([
      "RELOAD: the fixture was loaded again (1 → 2): a new page, not the same",
      "RELOAD: the page's memory is not the same (1 → 2 tokens): a new page",
    ]);
    expect(judgeReload({ ...ok, tokens: [[], []] })).toEqual([
      "RELOAD: 0 pages before the reload, not one",
    ]);
  });

  it("GONE: the face gone at once, and main's runtimes back to the count before the page opened", () => {
    const ok: LiveSeen["gone"] = { before: 0, with: 1, after: 0, faceLeft: true, ms: 61_200 };
    expect(judgeGone(ok)).toEqual([]);
    expect(judgeGone({ ...ok, faceLeft: false })).toEqual([
      "GONE: the pane's face was still open after the pane was deleted",
    ]);
    expect(judgeGone({ ...ok, after: 1, ms: LIVE_ROWS.goneWithinMs })).toEqual([
      "GONE: 1 runtimes 75000 ms after the pane was deleted, not the 0 before its page opened",
    ]);
    expect(judgeGone({ ...ok, with: 0 })).toEqual(["GONE: 0 runtimes with the page open, not 1"]);
    expect(judgeGone({ ...ok, after: null })).toEqual([
      "GONE: main's live-surface custody could not be read",
    ]);
  });
});
