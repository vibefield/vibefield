// THE SEAM'S FIRST SOURCE (src/fixture-live.ts — James's choice 4, ruled 2026-10-29): the fixture behind ICE's `LIVE`, the one
// seam a phone's screen is fed through. A face per key, `starting` until a demand asks; a live demand wakes it at once on the
// host's timer and its take presents ONE frame at the demanded raster into the HOST's writer, its logical size the screen's
// points; then it is woken only when a frame is due (the minute's turn, the rate's slot); paused, never; closed, its writer
// destroyed and its timer cancelled. A device the catalog lacks says `no-device` and draws nothing. The phone's own faces
// (live.ts) run over it unchanged — and nothing the plugin ships names a way of making frames.
import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  type Entity,
  type LiveDemand,
  type LiveTexture,
  liveSimulatorFace,
} from "@vibefield/plugin-sdk/desk";
import { describe, expect, it } from "vitest";
import {
  createPhoneFaces,
  type FixtureClock,
  type FixtureWriter,
  facePlan,
  fixtureSources,
  modelOf,
  simulatorSpec,
} from "../src";
import { fakeHost, TYPE } from "./fakes";

const AT = Date.UTC(2026, 9, 18, 10, 8);
const PRO = `${TYPE}iPhone-17-Pro`;
const BIND = { deviceType: PRO, runtime: "com.apple.CoreSimulator.SimRuntime.iOS-26-1" };
const SPEC = { ...simulatorSpec(BIND, "iPhone 17 Pro", "light") };
const live = (raster: readonly [number, number], fps = 30): LiveDemand => ({
  mode: "live",
  fps,
  raster,
  interactive: false,
});
const PAUSED: LiveDemand = { mode: "paused", fps: 0, raster: [0, 0], interactive: false };

/** The host's clock and timer: time moves only when the test runs it, firing each live timer due by then, in order. */
function fakeClock(start: number) {
  let t = start;
  const timers: { at: number; fn: () => void; live: boolean }[] = [];
  const clock: FixtureClock = {
    now: () => t,
    at(at, fn) {
      const timer = { at, fn, live: true };
      timers.push(timer);
      return () => {
        timer.live = false;
      };
    },
  };
  return {
    clock,
    run(to: number) {
      for (;;) {
        const due = timers.filter((x) => x.live && x.at <= to).sort((a, b) => a.at - b.at)[0];
        if (due === undefined) break;
        due.live = false;
        t = Math.max(t, due.at);
        due.fn();
      }
      t = to;
    },
    pending: () => timers.filter((x) => x.live).map((x) => x.at),
  };
}

/** The host's writers: each made at its first frame's size; a present of another size resizes it (its epoch moves), as ICE's does. */
function fakeWriters() {
  const made: {
    key: string;
    size: readonly [number, number];
    presents: { w: number; h: number; logical: readonly [number, number] | undefined }[];
    destroyed: boolean;
    face: LiveTexture;
  }[] = [];
  const writer = (key: string, width: number, height: number): FixtureWriter => {
    const face: { -readonly [K in keyof LiveTexture]: LiveTexture[K] } = {
      width,
      height,
      format: "rgba8unorm-srgb",
      revision: 0,
      epoch: 0,
      logical: [width, height],
      view: () => {
        throw new Error("no device in a unit");
      },
      prepare: () => {},
      bytes: width * height * 4,
    };
    const entry = {
      key,
      size: [width, height] as const,
      presents: [] as { w: number; h: number; logical: readonly [number, number] | undefined }[],
      destroyed: false,
      face,
    };
    made.push(entry);
    return {
      face,
      presentBytes(bytes, w, h, logical) {
        if (entry.destroyed) return;
        expect(bytes.length).toBe(w * h * 4);
        if (w !== face.width || h !== face.height) {
          face.width = w;
          face.height = h;
          face.epoch += 1;
        }
        face.revision += 1;
        face.logical = logical ?? [w, h];
        entry.presents.push({ w, h, logical });
      },
      destroy() {
        entry.destroyed = true;
      },
    };
  };
  return { writer, made };
}

const setup = () => {
  const c = fakeClock(AT);
  const w = fakeWriters();
  const sources = fixtureSources({ writer: w.writer, clock: c.clock });
  let woke = 0;
  const face = sources.open("k1", SPEC, () => {
    woke += 1;
  });
  return { ...c, ...w, sources, face, woke: () => woke };
};

describe("the fixture as a live source — the frame-source seam's first", () => {
  it("opens a face per key, starting with nothing until a demand asks — never woken, never drawn; a key opened twice is a host error", () => {
    const t = setup();
    expect(t.face.take()).toBe(false);
    expect(t.face.texture()).toBeUndefined();
    expect(t.face.state()).toEqual({ is: "starting" });
    expect(t.face.info()).toEqual({});
    // view-only, v1
    expect(t.face.input).toBeUndefined();
    expect(t.pending()).toEqual([]);
    t.run(AT + 5 * 60_000);
    expect(t.woke()).toBe(0);
    expect(t.made).toHaveLength(0);
    expect(() => t.sources.open("k1", SPEC, () => {})).toThrow(/open already/);
  });

  it("wakes the face at once on a live demand; its take presents ONE frame at the raster asked, its logical size the screen's points", () => {
    const t = setup();
    t.face.demand(live([603, 1311]));
    expect(t.pending()).toEqual([AT]);
    t.run(AT);
    expect(t.woke()).toBe(1);
    expect(t.face.take()).toBe(true);
    expect(t.made).toHaveLength(1);
    expect(t.made[0]?.size).toEqual([603, 1311]);
    expect(t.made[0]?.presents).toEqual([{ w: 603, h: 1311, logical: [402, 874] }]);
    expect(t.face.texture()).toBe(t.made[0]?.face);
    expect(t.face.state()).toEqual({ is: "live" });
    // its words say it streams, read as the SDK reads them, and the phone draws the stream at full light
    expect(liveSimulatorFace(t.face.info())).toEqual({ is: "live" });
    expect(facePlan(t.face.info(), t.face.state(), "iPhone 17 Pro", true)).toMatchObject({
      frame: true,
      brightness: 1,
      line: null,
      act: null,
    });
    expect(t.sources.stats()).toEqual({ opened: 1, closed: 0, frames: 1, wakes: 1 });
  });

  it("is woken next only when a frame is due — the minute's turn — and a take before then presents nothing", () => {
    const t = setup();
    t.face.demand(live([603, 1311]));
    t.run(AT);
    t.face.take();
    // one timer, at the minute's turn
    expect(t.pending()).toEqual([AT + 60_000]);
    t.run(AT + 1000);
    expect(t.face.take()).toBe(false);
    expect(t.pending()).toEqual([AT + 60_000]);
    t.run(AT + 59_999);
    expect(t.woke()).toBe(1);
    t.run(AT + 60_000);
    expect(t.woke()).toBe(2);
    expect(t.face.take()).toBe(true);
    expect(t.made[0]?.presents).toHaveLength(2);
    // the same texture, its revision moved: a redraw, not a remake
    expect(t.made[0]?.face.epoch).toBe(0);
    expect(t.made[0]?.face.revision).toBe(2);
  });

  it("follows a new raster in the writer's own texture (its epoch moves), and never faster than the rate asked", () => {
    const t = setup();
    t.face.demand(live([603, 1311], 2));
    t.run(AT);
    t.face.take();
    t.run(AT + 100);
    t.face.demand(live([302, 656], 2));
    // due at once by its change, held to the rate's slot: 500 ms after the last frame, less the feed's 1 ms grace
    expect(t.pending()).toEqual([AT + 499]);
    t.run(AT + 499);
    expect(t.face.take()).toBe(true);
    expect(t.made).toHaveLength(1);
    expect(t.made[0]?.presents.at(-1)).toEqual({ w: 302, h: 656, logical: [402, 874] });
    expect(t.made[0]?.face.epoch).toBe(1);
  });

  it("is never woken while paused, and a live demand again asks once more", () => {
    const t = setup();
    t.face.demand(live([603, 1311]));
    t.run(AT);
    t.face.take();
    t.face.demand(PAUSED);
    expect(t.pending()).toEqual([]);
    t.run(AT + 10 * 60_000);
    expect(t.woke()).toBe(1);
    expect(t.face.take()).toBe(false);
    // the last frame holds: still live, its texture kept
    expect(t.face.state()).toEqual({ is: "live" });
    expect(t.face.texture()).toBe(t.made[0]?.face);
    t.face.demand(live([603, 1311]));
    t.run(AT + 10 * 60_000);
    expect(t.woke()).toBe(2);
    expect(t.face.take()).toBe(true);
  });

  it("closes whole: its writer destroyed, its timer cancelled, its state closed — and the key may open again", () => {
    const t = setup();
    t.face.demand(live([603, 1311]));
    t.run(AT);
    t.face.take();
    expect(t.pending()).toHaveLength(1);
    t.face.close();
    expect(t.pending()).toEqual([]);
    expect(t.made[0]?.destroyed).toBe(true);
    expect(t.face.state()).toEqual({ is: "closed" });
    expect(t.face.texture()).toBeUndefined();
    expect(t.face.take()).toBe(false);
    t.face.close();
    expect(t.sources.stats().closed).toBe(1);
    expect(() => t.sources.open("k1", SPEC, () => {})).not.toThrow();
  });

  it("says no-device for a device its catalog lacks and draws nothing; a spec that is not a simulator's device fails with its reason", () => {
    const t = setup();
    const missing = t.sources.open(
      "k2",
      { ...SPEC, deviceType: `${TYPE}iPhone-1`, label: "iPhone 1" },
      () => {},
    );
    expect(liveSimulatorFace(missing.info())).toEqual({ is: "no-device" });
    expect(facePlan(missing.info(), missing.state(), "iPhone 1", false).line).toBe(
      "There's no iPhone 1 on this Mac",
    );
    missing.demand(live([603, 1311]));
    expect(t.pending()).toEqual([]);
    expect(missing.take()).toBe(false);
    expect(missing.texture()).toBeUndefined();
    const wrong = t.sources.open(
      "k3",
      { source: "browser", url: "https://example.org/" },
      () => {},
    );
    expect(wrong.state()).toEqual({ is: "failed", reason: "not a simulator's device" });
    expect(liveSimulatorFace(wrong.info())).toBeUndefined();
    expect(t.made).toHaveLength(0);
  });
});

describe("the phone's own faces run over it unchanged", () => {
  it("opens through it, the law's demand wakes it, and the tick takes the frame — a new texture: the record remade", () => {
    const c = fakeClock(AT);
    const w = fakeWriters();
    const sources = fixtureSources({ writer: w.writer, clock: c.clock });
    const H = fakeHost({ sources });
    const faces = createPhoneFaces(H.host);
    const e = 1 as Entity;
    const native = modelOf(PRO).screen.px;
    const face = faces.face(e, simulatorSpec(BIND, "iPhone 17 Pro", "light"), native);
    expect(face?.state()).toEqual({ is: "starting" });
    // a frame drew the phone; the tick steps the sight and sends the law's demand: the source wakes the face at once
    H.draw(faces, e, 1);
    faces.tick(AT);
    expect(faces.stats().demands).toBe(1);
    expect(c.pending()).toEqual([AT]);
    c.run(AT);
    expect(H.n.wake).toBe(1);
    faces.tick(AT);
    expect(H.n.remake).toEqual([e]);
    expect(faces.stats()).toMatchObject({ opened: 1, landed: 1, remakes: 1 });
    const [first] = w.made;
    expect(first?.presents).toHaveLength(1);
    // the frame at the law's rung: a halving of the native framebuffer, never larger, the screen's points its logical size
    const p = first?.presents[0];
    expect(p?.logical).toEqual([402, 874]);
    expect(p?.w ?? 0).toBeLessThanOrEqual(native[0]);
    expect((p?.w ?? 0) / (p?.h ?? 1)).toBeCloseTo(native[0] / native[1], 2);
    // the minute turns: the same texture again — a redraw, no record remade
    c.run(AT + 60_000);
    faces.tick(AT + 60_000);
    expect(H.n.remake).toEqual([e]);
    expect(H.n.redraw).toBe(1);
  });
});

describe("nothing the plugin ships names a way of making frames (choice 4)", () => {
  // the capture technologies a host might use — a kind is fed through LIVE and never learns which
  const NAMES =
    /ScreenCaptureKit|\bSCK\b|desktopCapturer|getDisplayMedia|serve-sim|IOSurface|simctl io|sharedTexture/i;
  const SRC = resolve(import.meta.dirname, "../src");

  it("holds no capture technology's name in src/ — code or comment", () => {
    const named: string[] = [];
    for (const file of readdirSync(SRC)) {
      const text = readFileSync(resolve(SRC, file), "utf8");
      text.split("\n").forEach((line, i) => {
        if (NAMES.test(line)) named.push(`${file}:${i + 1}`);
      });
    }
    expect(named).toEqual([]);
  });
});
