// THE COST TABLE (PHONE.md §10), AS FAR AS A UNIT CAN WITNESS IT. The table's milliseconds are a rig's to measure (the PT-S1
// hand-back's first-run list); what a unit holds is what makes them small, each held here or named where it is held:
//  - a screen re-mipped only as deep as it is read — and by night down to the glow's level (layout.ts `screenMips`; once per
//    revision is ICE's `LiveTexture.prepare`, its own unit's);
//  - the spill pass only by night, and only under a screen that is on (`spills`);
//  - the glare within its reach and no further: the quad grows by `glowReach` alone by night (kind.test.ts's night row,
//    law.test.ts "measures a quad"), held here as 3σ of the spill;
//  - a phone off screen asks for 0 fps, and its rung holds through a wobbling zoom (law.test.ts "the stream");
//  - the stream costs nothing between frames: a source wakes its face only when a frame is due — an hour of a still screen at
//    30 fps is 61 frames, not 108,000 — and a frame in the same texture redraws without remaking a record (live.test.ts);
//  - idle: a phone with nothing owed leaves the kind due never, and a morph's cost is paid only while it runs (morph.test.ts
//    "…then sleeps"; law.test.ts "is each model at its ends — the very objects": a settled phone blends nothing).
import { liveDepth } from "@vibefield/plugin-sdk/desk";
import { describe, expect, it } from "vitest";
import {
  fixtureSources,
  glowLevel,
  glowReach,
  MM,
  PHONE,
  phoneReach,
  SCREEN_OFF,
  screenMips,
  simulatorSpec,
  spills,
} from "../src";
import { fakeClock, fakeWriters, TYPE } from "./fakes";

const NATIVE = { width: 1206, height: 2622 };

describe("PHONE.md §10 — what makes the phone cheap, held by units", () => {
  it("re-mips a screen only as deep as its display's pixels read it: none magnified, one level a halving — by night to the glow's level", () => {
    // drawn at its size or larger: no level made by day
    expect(screenMips(NATIVE, [1206, 2622], false)).toBe(0);
    expect(screenMips(NATIVE, [2412, 5244], false)).toBe(0);
    // each halving of the drawn size one level more, never one more than it reads
    let last = 0;
    for (const w of [1206, 900, 603, 400, 302, 151, 75, 38]) {
      const px: readonly [number, number] = [w, (w * NATIVE.height) / NATIVE.width];
      const depth = screenMips(NATIVE, px, false);
      expect(depth, `${w}`).toBe(liveDepth(NATIVE, px));
      expect(depth, `${w}`).toBeGreaterThanOrEqual(last);
      const ratio = Math.max(NATIVE.width / px[0], NATIVE.height / px[1]);
      expect(2 ** depth, `${w}`).toBeGreaterThanOrEqual(ratio - 1e-9);
      if (depth > 0) expect(2 ** (depth - 1), `${w}`).toBeLessThan(ratio);
      last = depth;
    }
    // by night the glow's colour is read some 8 texels across: the chain made down to it, however large the screen is drawn
    const glow = Math.ceil(glowLevel(NATIVE.width));
    expect(glow).toBe(8);
    expect(screenMips(NATIVE, [2412, 5244], true)).toBe(glow);
    expect(screenMips(NATIVE, [38, 83], true)).toBe(Math.max(liveDepth(NATIVE, [38, 83]), glow));
  });

  it("lights what lies below only by night, and only under a screen that is on — the spill pass is the night's cost alone", () => {
    expect(spills({ on: 1 }, true)).toBe(true);
    expect(spills({ on: 1 }, false)).toBe(false);
    expect(spills(SCREEN_OFF, true)).toBe(false);
    expect(spills(SCREEN_OFF, false)).toBe(false);
  });

  it("reaches for its glow 3σ of the spill and no further — the one glow term in the phone's reach", () => {
    expect(glowReach()).toBeCloseTo(3 * PHONE.glow.spillSigma * MM, 12);
    // the glare's two σ lie within it: the spill is the widest term
    for (const sigma of PHONE.glow.sigma)
      expect(3 * sigma * MM).toBeLessThanOrEqual(glowReach() + 1e-9);
    expect(phoneReach()).toBeGreaterThan(glowReach());
  });

  it("costs nothing between frames: an hour of a still screen asked at 30 fps is a frame a minute — 61, not 108,000", () => {
    const AT = Date.UTC(2026, 9, 18, 10, 8);
    const c = fakeClock(AT);
    const w = fakeWriters();
    const sources = fixtureSources({ writer: w.writer, clock: c.clock });
    let woke = 0;
    const face = sources.open(
      "k1",
      {
        ...simulatorSpec(
          {
            deviceType: `${TYPE}iPhone-17-Pro`,
            runtime: "com.apple.CoreSimulator.SimRuntime.iOS-26-1",
          },
          "iPhone 17 Pro",
          "light",
        ),
      },
      () => {
        woke += 1;
        // the kind's tick takes what arrived (live.ts) — here at once
        face.take();
      },
    );
    // the law counts wakes and frames, not pixels: a 17 Pro's raster quartered across (its aspect kept), since a full-size
    // fixture frame is some 90 ms of JS shading at load, and 61 of them outran vitest's 5 s at the first run (2026-10-29)
    face.demand({ mode: "live", fps: 30, raster: [151, 328], interactive: false });
    c.run(AT + 60 * 60_000);
    expect(woke).toBe(61);
    expect(sources.stats().frames).toBe(61);
    expect(w.made).toHaveLength(1);
    expect(c.pending()).toEqual([AT + 61 * 60_000]);
  });
});
