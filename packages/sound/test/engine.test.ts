import { describe, expect, it } from "vitest";
import {
  CLEAR_AFTER_S,
  CUE_IDS,
  CUES,
  type CueId,
  clearOf,
  haptics,
  layout,
  momentaryMax,
  type Render,
  type RenderOptions,
  render,
  SR,
} from "../src/index.ts";

// SD-1 — the engine as DESIGN.md §14 states it: every sound strikes its count at its rate, is mastered to its
// target, peaks where §14 says, says itself when §14 says, and is the same sound every time it is asked for.

const cache = new Map<string, Render>();
const heard = (cue: CueId, opts: RenderOptions = {}): Render => {
  const key = `${cue}|${JSON.stringify(opts)}`;
  let r = cache.get(key);
  if (!r) {
    r = render(cue, opts);
    cache.set(key, r);
  }
  return r;
};
const peakOf = (r: Render): number => {
  let p = 0;
  for (const c of r.channels) for (let i = 0; i < c.length; i++) p = Math.max(p, Math.abs(c[i]!));
  return p;
};
const dBFS = (x: number): number => 20 * Math.log10(x);

/** Every strike, as the score has it (variant 0, no stretch). */
const STRIKES: Record<CueId, number[]> = {
  failed: [0],
  done: [0, 0.32],
  question: [0, 0.15, 0.3],
  approval: [0, 0.1, 0.36, 0.46],
  settle: [0, 0.09, 0.2, 0.335, 0.5, 0.7, 0.945],
  mark: [0.55, 0.7, 0.85, 1.25, 1.43, 1.75],
};

describe("the family strikes its count at its rate (§14 S4)", () => {
  it.each(CUE_IDS)("%s", (cue) => {
    const r = heard(cue);
    expect(r.meta.strikes).toEqual(STRIKES[cue]);
    expect(r.meta.strikes).toHaveLength(
      { failed: 1, done: 2, question: 3, approval: 4, settle: 7, mark: 6 }[cue],
    );
    expect(r.sampleRate).toBe(SR);
  });
});

describe("every sound is mastered to its target (§14 the family, the spaces, the masters)", () => {
  for (const space of ["day", "night", "far"] as const) {
    it.each(CUE_IDS)(`%s, desktop, ${space}`, (cue) => {
      const r = heard(cue, { space });
      const gain = { day: 0, night: -2, far: -6 }[space];
      expect(r.meta.target).toBe(CUES[cue].target + gain);
      expect(Math.abs(momentaryMax(r.channels) - r.meta.target)).toBeLessThan(0.05);
      // measured true peaks at −13 dBFS or under: no sample above it
      expect(dBFS(peakOf(r))).toBeLessThanOrEqual(-13);
    });
  }
  it.each(CUE_IDS)("%s, phone: 20 dB louder, limited at −1.5 dBFS", (cue) => {
    const r = heard(cue, { profile: "phone" });
    expect(r.meta.target).toBe(CUES[cue].target + 20);
    const m = momentaryMax(r.channels);
    // the limiter may hold a peaky sound under its target (Failed ~1.6 dB, the mark ~1.4 dB), never over it
    expect(m).toBeLessThan(r.meta.target + 0.05);
    expect(m).toBeGreaterThan(r.meta.target - 2);
    expect(peakOf(r)).toBeLessThanOrEqual(0.84 + 1e-6);
  });
  it("the four status sounds sit within 1.5 LU of each other (loudness never carries urgency)", () => {
    const targets = (["failed", "done", "question", "approval"] as const).map(
      (c) => CUES[c].target,
    );
    expect(Math.max(...targets) - Math.min(...targets)).toBeLessThanOrEqual(1.5);
  });
});

describe("lengths: the tails ring where §14's spaces put them", () => {
  // measured on 2026-11-05, the lab engine and this package bit-identical (223 renders)
  const DAY: Record<CueId, number> = {
    failed: 1.69,
    done: 3.58,
    question: 2.55,
    approval: 2.04,
    settle: 4.75,
    mark: 5.49,
  };
  const PHONE: Record<CueId, number> = {
    failed: 1.35,
    done: 2.11,
    question: 1.69,
    approval: 1.83,
    settle: 2.95,
    mark: 4.55,
  };
  it.each(CUE_IDS)("%s", (cue) => {
    expect(heard(cue).meta.seconds).toBeCloseTo(DAY[cue], 1);
    expect(heard(cue, { profile: "phone" }).meta.seconds).toBeCloseTo(PHONE[cue], 1);
    // the phone's files are shorter: iOS turns your music down for as long as one plays
    expect(heard(cue, { profile: "phone" }).meta.seconds).toBeLessThan(heard(cue).meta.seconds);
  });
});

describe("spacing: a sound has said itself 450 ms after its last strike (SD-D10)", () => {
  it.each(CUE_IDS)("%s", (cue) => {
    const r = heard(cue);
    expect(r.meta.clear).toBeCloseTo(STRIKES[cue].at(-1)! + CLEAR_AFTER_S, 9);
    expect(clearOf(cue)).toBe(r.meta.clear);
  });
  it("clearOf reads the take and the stretch the render plays", () => {
    for (const opts of [{ variant: 3 }, { stretch: 1.25, level: -6 }, { count: 3, variant: 1 }]) {
      expect(clearOf("question", opts)).toBe(heard("question", opts).meta.clear);
    }
  });
});

describe("one sound, every time (§14 where it lives)", () => {
  it("a render is a pure function of its cue and options", () => {
    const a = render("done", { variant: 2, space: "night" });
    const b = heard("done", { variant: 2, space: "night" });
    expect(a.channels[0]).toEqual(b.channels[0]);
    expect(a.channels[1]).toEqual(b.channels[1]);
  });
  it("variants vary the detail, never the count or the contour", () => {
    for (const cue of ["done", "approval"] as const) {
      const canon = heard(cue);
      for (let variant = 1; variant <= 4; variant++) {
        const r = heard(cue, { variant });
        expect(r.channels[0]).not.toEqual(canon.channels[0]);
        expect(r.meta.strikes).toHaveLength(canon.meta.strikes.length);
        // ±4 ms in time, never the first strike
        for (const [i, t] of r.meta.strikes.entries()) {
          expect(Math.abs(t - canon.meta.strikes[i]!)).toBeLessThanOrEqual(0.0045);
        }
        expect(r.meta.strikes[0]).toBe(0);
        // the notes never change
        expect(layout(cue, { variant }).notes.map((x) => x.n)).toEqual(
          layout(cue).notes.map((x) => x.n),
        );
      }
    }
  });
});

describe("many at once: a Done chord climbs the field, fuller, never louder (SD-D9)", () => {
  it("each extra agent adds the landing's fifth, ninth, twelfth, strummed 22 ms apart, three at most", () => {
    expect(layout("done", { count: 2 }).notes.map((x) => x.n)).toEqual(["Ab5", "Db5", "Ab5"]);
    expect(layout("done", { count: 4 }).notes.map((x) => x.n)).toEqual([
      "Ab5",
      "Db5",
      "Ab5",
      "Eb6",
      "Ab6",
    ]);
    expect(layout("done", { count: 9 }).strikes).toEqual([0, 0.32, 0.342, 0.364, 0.386]);
    const chord = heard("done", { count: 4 });
    expect(Math.abs(momentaryMax(chord.channels) - chord.meta.target)).toBeLessThan(0.05);
  });
});

describe("reminders and places", () => {
  it("a reminder is 6 dB softer and a quarter slower (SD-D13)", () => {
    const r = heard("question", { level: -6, stretch: 1.25 });
    expect(r.meta.target).toBe(-32);
    expect(r.meta.strikes.at(-1)).toBeCloseTo(0.375, 3);
  });
  it("a sound is placed toward its agent, never more than 60% of the way to a side (SD-D11)", () => {
    const left = heard("approval", { pan: -0.6 });
    const energyOf = (c: Float32Array) => c.reduce((s, x) => s + x * x, 0);
    expect(energyOf(left.channels[0])).toBeGreaterThan(energyOf(left.channels[1]) * 1.5);
    expect(render("approval", { pan: 0.95 }).channels[1]).toEqual(
      heard("approval", { pan: 0.6 }).channels[1],
    );
  });
  it("the phone plays All quiet an octave higher (nothing under ~300 Hz survives its speaker)", () => {
    const phone = layout("settle", { profile: "phone" });
    expect(phone.shift).toBe(12);
    expect(phone.notes[0]!.n).toBe("Ab7");
    expect(layout("settle").notes[0]!.n).toBe("Ab6");
    expect(layout("done", { profile: "phone" }).shift).toBe(0);
  });
});

describe("the phone's touch keeps each sound's rhythm (SD-D16)", () => {
  it("one tap per strike, at the strike", () => {
    for (const cue of CUE_IDS) expect(haptics(cue).map((t) => t.t)).toEqual(STRIKES[cue]);
  });
  it("Approval's knocks are the sharpest taps, Failed's the dullest; Question rises, Done falls", () => {
    expect(haptics("approval").map((t) => t.sharpness)).toEqual([0.85, 0.85, 0.85, 0.85]);
    expect(haptics("failed")).toEqual([{ t: 0, intensity: 0.72, sharpness: 0.05 }]);
    expect(haptics("question").map((t) => t.sharpness)).toEqual([0.5, 0.6, 0.7]);
    expect(haptics("done").map((t) => t.sharpness)).toEqual([0.6, 0.5]);
    const all = CUE_IDS.flatMap((c) => haptics(c).map((t) => t.sharpness));
    expect(Math.max(...all)).toBe(0.85);
    expect(Math.min(...all)).toBe(0.05);
  });
  it("intensity follows the strongest note struck: 0.35 + 0.6 × its velocity", () => {
    expect(haptics("done").map((t) => t.intensity)).toEqual([0.65, 0.86]);
  });
});

it("renders at the rate it says, every sample finite", () => {
  for (const cue of CUE_IDS) {
    const r = heard(cue);
    expect(r.channels[0].length).toBe(Math.round(r.meta.seconds * SR));
    for (const c of r.channels) expect(c.every((x) => Number.isFinite(x))).toBe(true);
  }
});
