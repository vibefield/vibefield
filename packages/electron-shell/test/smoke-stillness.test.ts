// DK-10b — A STILLNESS WINDOW'S WITNESS (testing/smoke-stillness.ts): the GPU-on desk smokes' idle rows judge a window by the
// desk's counters at its two ends — still, or moved — and a moved window says WHAT moved it (the wakes that grew, by reason;
// the timed steps; the outside input received). One moved while trusted OS input reached the desk is sampled again, a bounded
// number of times (a person at a shared machine touched the wind); anything else that moves a resting desk is red at once.
import { afterEach, describe, expect, it } from "vitest";
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
  resting: 0,
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
    expect(movedBy(a, b)).toEqual({
      wakes: { world: 1, "desk:ambient": 1 },
      timed: 2,
      outside: 0,
      resting: 0,
    });
  });

  it("a window the desk moved BY ITSELF is red at once, its waker named (no outside input)", () => {
    const a = sample();
    const b = sample({ frames: 2517, submits: 2541, wakes: { world: 57, doc: 8, presence: 9 } });
    expect(judgeWindow(a, b, 1)).toEqual({
      kind: "moved",
      moved: { wakes: { world: 1 }, timed: 0, outside: 0, resting: 0 },
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
    const moved = { wakes: { input: 7 }, timed: 0, outside: 7, resting: 0 };
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
      moved: { wakes: {}, timed: 1, outside: 3, resting: 0 },
    });
  });

  it("DK-12 — a window moved while only a RESTING pointer's repeats arrived is red at once: since I33 they wake nothing", () => {
    // ICE desk.4 drops a buttonless move at the last move's point (I33): it cannot have moved the desk, so it is no excuse —
    // whatever moved the window is named (here the wind, touched by nothing outside), never sampled again
    const a = sample();
    const b = sample({
      frames: 2517,
      submits: 2541,
      wakes: { world: 56, doc: 8, presence: 9, "desk:ambient": 1 },
      resting: 6,
    });
    expect(judgeWindow(a, b, 1)).toEqual({
      kind: "moved",
      moved: { wakes: { "desk:ambient": 1 }, timed: 0, outside: 0, resting: 6 },
    });
    // a still window with them is simply still
    expect(judgeWindow(a, sample({ resting: 6 }), 1)).toEqual({ kind: "still" });
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

// DK-12 — THE PAGE'S CENSUS, RUN: the expression evaluated over a stand-in page (its listeners captured, a stub desk), fed
// the events a person and Chromium send. A resting pointer's repeated move — buttonless, at the last move's point, with the
// same modifiers, no press or wheel between — is counted APART (`resting`), by ICE's I33 rule; everything else is `outside`.
describe("the page's outside-input census (DK-12, I33)", () => {
  const g = globalThis as unknown as Record<string, unknown>;
  const listeners = new Map<string, (e: Record<string, unknown>) => void>();
  /** Where the desk's container stands in the window (ICE measures a move from it). */
  const desk = { left: 0, top: 0 };
  const arm = (): (() => StillnessSample) => {
    listeners.clear();
    desk.left = 0;
    desk.top = 0;
    g["document"] = {
      querySelector: (q: string) =>
        q === "[data-ice-canvas]" ? { getBoundingClientRect: () => ({ ...desk }) } : null,
    };
    g["window"] = {
      addEventListener: (type: string, fn: (e: Record<string, unknown>) => void) =>
        listeners.set(type, fn),
    };
    g["__vfDesk"] = {
      rest: () => ({ wakes: {}, timed: 0 }),
      perf: () => ({ frames: 0 }),
      submits: () => ({ total: 0 }),
    };
    // the page's expression, evaluated at the global scope as the page evaluates it
    const read = new Function(`return ${STILLNESS_SAMPLE};`) as () => StillnessSample;
    read();
    return read;
  };
  afterEach(() => {
    for (const key of [
      "window",
      "document",
      "__vfDesk",
      "__vfSmokeOutsideInput",
      "__vfSmokeRestingInput",
    ])
      delete g[key];
  });
  const move = (x: number, y: number, over: Record<string, unknown> = {}) =>
    listeners.get("pointermove")?.({
      type: "pointermove",
      isTrusted: true,
      pointerId: 1,
      clientX: x,
      clientY: y,
      buttons: 0,
      shiftKey: false,
      ctrlKey: false,
      altKey: false,
      metaKey: false,
      ...over,
    });
  const other = (type: string) => listeners.get(type)?.({ type, isTrusted: true, pointerId: 1 });

  it("a move to a new point is outside; the same move again, buttonless, is resting — however often it comes", () => {
    const read = arm();
    move(100, 200);
    move(100, 200);
    move(100, 200);
    move(101, 200);
    move(101, 200);
    expect(read()).toMatchObject({ outside: 2, resting: 3 });
  });

  it("a held button's same-point move, a modifier's change and a press or a wheel between are all real input", () => {
    const read = arm();
    move(10, 10);
    move(10, 10, { buttons: 1 }); // a drag held at one point
    move(10, 10, { buttons: 1 });
    move(10, 10, { shiftKey: true }); // a modifier changed
    other("pointerdown");
    move(10, 10); // the first move after a press counts
    other("wheel");
    move(10, 10); // …and after a wheel
    other("keydown"); // a key is real input…
    move(10, 10); // …but no transition: the next same-point move is resting
    expect(read()).toMatchObject({ outside: 9, resting: 1 });
  });

  it("the same point over ANOTHER element is real input — the DOM changed under a resting pointer, a new hover fact ICE enqueues", () => {
    const read = arm();
    const under = { id: "the canvas" };
    move(40, 40, { target: under });
    move(40, 40, { target: under });
    move(40, 40, { target: { id: "a tooltip that came" } });
    move(40, 40, { target: { id: "a tooltip that came" } }); // a fresh object: another element again
    expect(read()).toMatchObject({ outside: 3, resting: 1 });
  });

  it("the same point in the WINDOW is real input when the desk moved under it — the field receded, then came back", () => {
    // DK-12's recorder: a move sent while the field stood receded (the desk's container at 11.8, 7.48) and the same point
    // sent again once it was back (at 0, 0) — ICE enqueued the first of those (another point on the desk), dropped the rest
    const read = arm();
    desk.left = 11.8;
    desk.top = 7.48;
    move(600, 420);
    desk.left = 0;
    desk.top = 0;
    move(600, 420);
    move(600, 420);
    expect(read()).toMatchObject({ outside: 2, resting: 1 });
  });

  it("each pointer is its own; an untrusted event is never counted", () => {
    const read = arm();
    move(5, 5);
    move(5, 5, { pointerId: 2 });
    move(5, 5, { isTrusted: false });
    move(5, 5);
    expect(read()).toMatchObject({ outside: 2, resting: 1 });
  });
});
