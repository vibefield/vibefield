// DK-12 — THE TOOLS IN HAND's SMOKE JUDGES (testing/smoke-tools-in-hand.ts; DESIGN.md §8 "Tools in hand"; R13; ICE I20): where
// the bar stands in hand, whether the held object's reading fit honours the layer's reserves, the travel's own timing read off
// the browser's transition events (560 on the island curve, the cross-fade its last 120, ended on their own), and the way back
// (200 after the landing). Pure — the rows' words, red where the canon is missed.
import { describe, expect, it } from "vitest";
import {
  HAND_SPECIMENS,
  judgeHandPlace,
  judgeReadingFit,
  judgeReturn,
  judgeTravel,
  type TransitionSeen,
  travelTiming,
} from "../src/testing/smoke-tools-in-hand";

const view = { width: 1180, height: 748 };
const seenAt = (x0: number, y0: number, w: number) => ({
  shown: true,
  role: "hand",
  face: "hand",
  traveling: false,
  row: { x0, y0, x1: x0 + w, y1: y0 + 40 },
  cells: [],
  readout: null,
  tips: {},
  pressed: {},
  on: [],
  dots: [],
});

describe("where the tools in hand stand (§8)", () => {
  it("top 64, 40 tall, centred on the window — or says what is off", () => {
    expect(judgeHandPlace(view, seenAt(590 - 237, 64, 474))).toEqual([]);
    expect(judgeHandPlace(view, seenAt(590 - 237, 56, 474))).toEqual([
      "the tools' top is 56, not 64",
    ]);
    expect(judgeHandPlace(view, seenAt(42, 64, 474))[0]).toMatch(
      /centre is 279, not the window's 590/,
    );
    expect(judgeHandPlace(view, { ...seenAt(0, 0, 0), row: null })).toEqual([
      "no tools in hand were drawn",
    ]);
  });
});

describe("the reading fit inside the layer's reserves (I20: 116 / 100)", () => {
  it("a fit to the band's height — the notebook's (smoke:canvas: cy 382, hy 266 at 748 tall) — passes", () => {
    expect(
      judgeReadingFit(view, { cx: 590, cy: 382, hx: 380, hy: 266, s: 2.11, settled: true }),
    ).toEqual([]);
    // the clock at its 3× cap: smaller than the band, centred in it
    expect(
      judgeReadingFit(view, { cx: 590, cy: 382, hx: 225, hy: 225, s: 3, settled: true }),
    ).toEqual([]);
  });

  it("ICE's own 56 / 72 (its demo's) cross the reserves — and the fit is said where it is off", () => {
    // ICE's default: top 56, band 72 → the band 56 … 676, centre 366
    const demo = { cx: 590, cy: 366, hx: 400, hy: 310, s: 2.4, settled: true };
    const said = judgeReadingFit(view, demo);
    expect(said).toContain("the held object's top 56 crosses the 116 reserve");
    expect(said).toContain("the held object's foot 676 crosses the 100 reserve (648)");
    expect(said).toContain("the held object's centre 366 is not the band's middle 382");
    expect(judgeReadingFit(view, null)).toEqual(["the desk drew no object in hand"]);
  });
});

/** The transitions smoke:canvas's recorder saw for the notebook (dk-12 try 3), re-based at 0. */
const NOTEBOOK: TransitionSeen[] = [
  { on: "bar", property: "transform", start: 0, end: 558.3, elapsed: 560, ended: "end" },
  { on: "hand", property: "opacity", start: 449.5, end: 566.8, elapsed: 120, ended: "end" },
  { on: "selection", property: "opacity", start: 449.5, end: 566.8, elapsed: 120, ended: "end" },
  { on: "bar", property: "width", start: 449.5, end: 566.8, elapsed: 120, ended: "end" },
];
const ISLAND = { ms: 560, easing: "cubic-bezier(0.25, 1, 0.3, 1)" };

describe("the travel's timing, from the browser's own transition events (R13)", () => {
  it("560 on the island curve, the cross-fade over its last 120, the width with it, each ended on its own", () => {
    const t = travelTiming(NOTEBOOK, ISLAND);
    expect(t.travel).toMatchObject({ ms: 558.3, ended: "end" });
    expect(t.crossFade).toMatchObject({ at: 449.5, ended: "end" });
    expect(t.crossFade?.ms).toBeCloseTo(117.3, 5);
    expect(judgeTravel(t)).toEqual([]);
  });

  it("is red for ICE's 340, another curve, a swap at the start, a transition cut short — each said", () => {
    expect(judgeTravel(travelTiming(NOTEBOOK, { ms: 340, easing: ISLAND.easing }))).toContain(
      "the travel declared 340 ms, not 560",
    );
    expect(judgeTravel(travelTiming(NOTEBOOK, { ms: 560, easing: "ease" }))[0]).toMatch(
      /not the island's/,
    );
    const early = NOTEBOOK.map((t) => (t.start > 0 ? { ...t, start: 10, end: 130 } : t));
    expect(judgeTravel(travelTiming(early, ISLAND))).toContain(
      "the cross-fade began 10 ms in, not 440 (the travel's last 120)",
    );
    // DK-12's recorder: a width taken off at the travel's nominal end was CANCELLED a frame short (101 ms)
    const cut = NOTEBOOK.map((t) =>
      t.property === "width" ? { ...t, end: 550.6, ended: "cancel" as const } : t,
    );
    expect(judgeTravel(travelTiming(cut, ISLAND))).toEqual([
      "the glass's width ran 101 ms, cancel — not 120 on its own",
    ]);
    const short = NOTEBOOK.map((t) =>
      t.property === "transform" ? { ...t, end: 340, ended: "cancel" as const } : t,
    );
    expect(judgeTravel(travelTiming(short, ISLAND))).toEqual([
      "the travel was cut short (`transitioncancel`)",
      "the travel took 340 ms, not 560",
    ]);
    expect(judgeTravel(travelTiming([], null))).toContain(
      "the travel declared no transform transition",
    );
  });
});

describe("the way back (§8: back over it 200 ms after it lands)", () => {
  it("the fade-in 200 ms after the landing — a frame either way — passes; none, or late, is said", () => {
    expect(judgeReturn(44371.3, 44587.5)).toEqual([]);
    expect(judgeReturn(1000, 1000)).toEqual(["the bar came back 0 ms after the landing, not 200"]);
    expect(judgeReturn(null, null)).toEqual(["the object never landed"]);
    expect(judgeReturn(1000, null)).toEqual(["the bar never came back over the object"]);
  });
});

describe("the four specimens (§8's own list)", () => {
  it("are the notebook, the whiteboard, the calendar and the clock, each tool in its declared order with its runs", () => {
    expect(HAND_SPECIMENS.map((s) => [s.name, s.type])).toEqual([
      ["notebook", "desk.notebook"],
      ["whiteboard", "desk.board"],
      ["calendar", "desk.calendar"],
      ["clock", "vibefield.example.desk-clock"],
    ]);
    expect(HAND_SPECIMENS[0]?.readout?.test("Page 1")).toBe(true);
    expect(HAND_SPECIMENS[2]?.readout?.test("September")).toBe(true);
    expect(HAND_SPECIMENS[3]?.readout?.test("10:08:42")).toBe(true);
    expect(HAND_SPECIMENS[1]?.readout).toBeNull();
  });
});
