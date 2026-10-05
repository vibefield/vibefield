// DK-10b — A STILLNESS WINDOW'S WITNESS (testing/smoke-stillness.ts): the GPU-on desk smokes' idle rows judge a window by the
// desk's counters at its two ends — still, or moved — and a moved window says WHAT moved it (the wakes that grew, by reason;
// the timed steps; the outside input received). One moved while trusted OS input reached the desk is sampled again, a bounded
// number of times (a person at a shared machine touched the wind); anything else that moves a resting desk is red at once.
import { describe, expect, it } from "vitest";
import {
  countersOf,
  judgeWindow,
  movedBy,
  STILLNESS_SAMPLE,
  STILLNESS_TRIES,
  type StillnessSample,
} from "../src/testing/smoke-stillness";

const sample = (over: Partial<StillnessSample> = {}): StillnessSample => ({
  frames: 2380,
  submits: 2404,
  wakes: { world: 56, doc: 8, presence: 9 },
  timed: 3,
  outside: 0,
  ...over,
});

describe("a stillness window — still, or moved, and by what", () => {
  it("a window with not one frame and not one submit is still — whatever presence or a timed step did in it", () => {
    const a = sample();
    const b = sample({ wakes: { world: 56, doc: 8, presence: 10 }, timed: 4 });
    expect(judgeWindow(a, b, 1)).toEqual({ kind: "still" });
  });

  it("names what moved a window: the wakes that GREW, by reason — never one that stood still or shrank", () => {
    const a = sample({ wakes: { world: 56, presence: 9, input: 2 } });
    const b = sample({
      frames: 2517,
      submits: 2541,
      wakes: { world: 57, presence: 9, input: 2, "desk:ambient": 1 },
      timed: 5,
      outside: 0,
    });
    expect(movedBy(a, b)).toEqual({ wakes: { world: 1, "desk:ambient": 1 }, timed: 2, outside: 0 });
  });

  it("a window the desk moved BY ITSELF is red at once, its waker named (no outside input)", () => {
    const a = sample();
    const b = sample({ frames: 2517, submits: 2541, wakes: { world: 57, doc: 8, presence: 9 } });
    expect(judgeWindow(a, b, 1)).toEqual({
      kind: "moved",
      moved: { wakes: { world: 1 }, timed: 0, outside: 0 },
    });
  });

  it("a window moved while outside input REACHED THE DESK is sampled again — until the last try, then red", () => {
    const a = sample();
    const b = sample({
      frames: 2403,
      submits: 2427,
      wakes: { world: 56, doc: 8, presence: 9, input: 7 },
      outside: 7,
    });
    const moved = { wakes: { input: 7 }, timed: 0, outside: 7 };
    for (let attempt = 1; attempt < STILLNESS_TRIES; attempt += 1) {
      expect(judgeWindow(a, b, attempt)).toEqual({ kind: "again", moved });
    }
    expect(judgeWindow(a, b, STILLNESS_TRIES)).toEqual({ kind: "moved", moved });
  });

  it("outside input that never reached the desk (no `input` wake) excuses nothing", () => {
    const a = sample();
    const b = sample({ frames: 2403, submits: 2427, timed: 4, outside: 3 });
    expect(judgeWindow(a, b, 1)).toEqual({
      kind: "moved",
      moved: { wakes: {}, timed: 1, outside: 3 },
    });
  });

  it("a submit with no frame — a still taken at rest — moves a window too", () => {
    const a = sample();
    const b = sample({ submits: 2405 });
    expect(judgeWindow(a, b, 1).kind).toBe("moved");
  });

  it("prints a sample's counters alone, as the rows always have", () => {
    expect(countersOf(sample({ outside: 4 }))).toEqual({ frames: 2380, submits: 2404 });
  });

  it("the page's sample counts TRUSTED pointer, wheel and key input, armed once, in the capture phase", () => {
    expect(STILLNESS_SAMPLE).toContain("e.isTrusted");
    for (const type of ["pointermove", "pointerdown", "pointerup", "wheel", "keydown", "keyup"]) {
      expect(STILLNESS_SAMPLE).toContain(`"${type}"`);
    }
    expect(STILLNESS_SAMPLE).toContain("capture: true");
    expect(STILLNESS_SAMPLE).toContain("g.__vfSmokeOutsideInput === undefined");
  });
});
