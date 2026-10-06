// DK-14 — SEND TO…'s SMOKE JUDGES (testing/smoke-send-to.ts; DESIGN.md §8 "Send to…", the line's chip; R15): the chip's
// face and size, the draft after it lands (focused, the @ typed after it, @'s list open, the caret after), the flight
// read off the flier's own transition events and its box every frame (560 on the island curve, 1.25 → 0.86 on a straight
// line, from the selection to where the chip stands), the @ 180 ms after the landing, the still (the anchor's box less the
// brackets' 6 at the device's px; the marks hidden first and put back), and the bar aside while the act is on. Pure — the
// rows' words, red where the canon is missed.
import { describe, expect, it } from "vitest";
import {
  type ChipSeen,
  type FlierSample,
  judgeAtAfter,
  judgeBarAside,
  judgeChip,
  judgeFlight,
  judgeStill,
  judgeTyped,
  type LineSeen,
  matrixScale,
  NOTE_INK,
  NOTE_LABEL,
  NOTE_PAPER,
  type SendRecorded,
  type SentSeen,
} from "../src/testing/smoke-send-to";

const chipSeen = (over: Partial<ChipSeen> = {}): ChipSeen => ({
  kind: "desk",
  glyph: "snippets",
  label: NOTE_LABEL,
  paper: true,
  background: NOTE_PAPER,
  color: NOTE_INK,
  still: "149 × 149",
  title: "",
  height: 24,
  radius: "7px",
  font: "12.5px",
  weight: "500",
  glyphSize: 13,
  rect: { x0: 423, y0: 690, x1: 640, y1: 714 },
  transition: "",
  ...over,
});
const note = { glyph: "snippets", label: NOTE_LABEL, paper: NOTE_PAPER, ink: NOTE_INK };

describe("the chip (§8: its face by kind; 24 tall, corners 7, 12.5/500, the glyph 13)", () => {
  it("passes the note's chip as the canon draws it", () => {
    expect(judgeChip(chipSeen(), note)).toEqual([]);
    expect(NOTE_LABEL).toBe("Ship the desk by Friday,…");
    expect(Array.from(NOTE_LABEL.slice(0, -1))).toHaveLength(24);
  });
  it("names what is off: its words, its glyph, its paper, its ink, its size", () => {
    expect(judgeChip(chipSeen({ label: "Note" }), note)[0]).toMatch(/reads "Note"/u);
    expect(judgeChip(chipSeen({ glyph: null }), note)[0]).toMatch(/wears no glyph, not snippets/u);
    expect(judgeChip(chipSeen({ background: "rgb(1, 2, 3)" }), note)[0]).toMatch(/paper/u);
    expect(judgeChip(chipSeen({ color: "rgb(1, 2, 3)" }), note)[0]).toMatch(/ink/u);
    expect(judgeChip(chipSeen({ height: 26 }), note)[0]).toMatch(/26 tall/u);
    expect(judgeChip(chipSeen({ radius: "8px" }), note)[0]).toMatch(/corners/u);
    expect(judgeChip(chipSeen({ font: "13px" }), note)[0]).toMatch(/12\.5px\/500/u);
    expect(judgeChip(chipSeen({ glyphSize: 16 }), note)[0]).toMatch(/glyph is 16/u);
    expect(judgeChip(chipSeen({ kind: "capture" }), note)[0]).toMatch(/capture/u);
    expect(judgeChip(undefined, note)).toEqual(["no chip stood in the draft"]);
  });
  it("a kind's chip: its name and no glyph", () => {
    const clock = chipSeen({ glyph: null, label: "Clock", paper: false, glyphSize: null });
    expect(judgeChip(clock, { glyph: null, label: "Clock" })).toEqual([]);
    expect(judgeChip({ ...clock, glyph: "capture" }, { glyph: null, label: "Clock" })).toHaveLength(
      1,
    );
  });
});

const lineSeen = (over: Partial<LineSeen> = {}): LineSeen => ({
  text: `${NOTE_LABEL} @`,
  chips: [],
  focused: true,
  atOpen: true,
  sendArmed: true,
  caret: { afterChip: " @", atEnd: true },
  aim: null,
  ...over,
});

describe("the draft after it lands (§8: focused, the @ typed, the list open, the caret after the chip)", () => {
  it("passes the canon's draft and names each miss", () => {
    expect(judgeTyped(lineSeen())).toEqual([]);
    expect(judgeTyped(lineSeen({ focused: false }))).toEqual(["the draft was not focused"]);
    expect(judgeTyped(lineSeen({ atOpen: false }))).toEqual(["@'s list was not open"]);
    expect(judgeTyped(lineSeen({ caret: { afterChip: "@", atEnd: true } }))[0]).toMatch(
      /read "@", not " @"/u,
    );
    expect(judgeTyped(lineSeen({ caret: { afterChip: " @", atEnd: false } }))).toEqual([
      "the caret was not after the chip and its @",
    ]);
    expect(judgeTyped(lineSeen({ caret: null }))).toEqual(["the draft held no caret"]);
  });
});

/** A flight as the island curve would run it: from (100, 100) at 1.25 to (500, 702) at 0.86. */
const ease = (t: number): number => 1 - (1 - t) ** 4;
const flight = (over: Partial<SendRecorded> = {}, bend = 0): SendRecorded => {
  const samples: FlierSample[] = [];
  for (let i = 0; i <= 33; i++) {
    const p = ease(i / 33);
    samples.push({
      t: 1000 + i * 16.7,
      cx: 100 + 400 * p,
      cy: 100 + 602 * p + Math.sin(p * Math.PI) * bend,
      scale: 1.25 - 0.39 * p,
      opacity: 1,
    });
  }
  return {
    t0: 990,
    events: [
      {
        type: "transitionstart",
        property: "transform",
        t: 1000,
        duration: "0.56s, 0.14s",
        timing: "cubic-bezier(0.25, 1, 0.3, 1), ease",
      },
      {
        type: "transitionend",
        property: "transform",
        t: 1561,
        duration: "0.56s, 0.14s",
        timing: "cubic-bezier(0.25, 1, 0.3, 1), ease",
      },
    ],
    samples,
    chipAt: 1570,
    atAt: 1752,
    atGoneAt: 3000,
    chipTransition: null,
    bar: [
      { t: 990, shown: "true" },
      { t: 1003, shown: "false" },
      { t: 3215, shown: "true" },
    ],
    ...over,
  };
};
const FROM = { x0: 60, y0: 60, x1: 140, y1: 140 };
const LANDED = { x0: 440, y0: 690, x1: 560, y1: 714 };

describe("the flight (§8: 1.25 → 0.86, 560 ms on the island curve, a straight line)", () => {
  it("passes the canon's flight", () => {
    expect(judgeFlight(flight(), FROM, LANDED)).toEqual([]);
    expect(matrixScale("matrix(0.86, 0, 0, 0.86, 10, 20)")).toBeCloseTo(0.86);
    expect(matrixScale("none")).toBe(1);
  });
  it("names a flight off the canon: no flight, its length, its curve, cut short, its scales, a bend, its ends", () => {
    expect(judgeFlight(flight({ events: [] }), FROM, LANDED)).toEqual([
      "the chip never flew (no transform transition on the flier)",
    ]);
    const long = flight();
    expect(
      judgeFlight(
        { ...long, events: long.events.map((e) => ({ ...e, duration: "0.6s" })) },
        FROM,
        LANDED,
      )[0],
    ).toMatch(/declared 0\.6s/u);
    expect(
      judgeFlight(
        { ...long, events: long.events.map((e) => ({ ...e, timing: "ease" })) },
        FROM,
        LANDED,
      )[0],
    ).toMatch(/not the island's/u);
    expect(
      judgeFlight(
        { ...long, events: [long.events[0]!, { ...long.events[1]!, type: "transitioncancel" }] },
        FROM,
        LANDED,
      ),
    ).toContain("the flight was cut short (`transitioncancel`)");
    expect(
      judgeFlight(
        { ...long, events: [long.events[0]!, { ...long.events[1]!, t: 1340 }] },
        FROM,
        LANDED,
      )[0],
    ).toMatch(/took 340 ms/u);
    const grown = flight();
    expect(
      judgeFlight(
        { ...grown, samples: grown.samples.map((s) => ({ ...s, scale: 1 })) },
        FROM,
        LANDED,
      ).join(" "),
    ).toMatch(/left at 1\.00.*arrived at 1\.00/u);
    expect(judgeFlight(flight({}, 60), FROM, LANDED).join(" ")).toMatch(/left its straight line/u);
    expect(judgeFlight(flight(), { x0: 300, y0: 300, x1: 340, y1: 340 }, LANDED)[0]).toMatch(
      /not the selection's middle/u,
    );
    expect(judgeFlight(flight(), FROM, { ...LANDED, x0: 456, x1: 576 })[0]).toMatch(
      /not where it stands/u,
    );
  });
});

describe("the @ after the landing (§8: 180 ms; reduced, 90)", () => {
  it("passes 180 give or take a frame, and names a miss", () => {
    expect(judgeAtAfter(flight())).toEqual([]);
    expect(judgeAtAfter(flight({ atAt: 1600 }))[0]).toMatch(
      /30 ms after the chip landed, not 180/u,
    );
    expect(judgeAtAfter(flight({ chipAt: 1570, atAt: 1662 }), 90)).toEqual([]);
    expect(judgeAtAfter(flight({ atAt: null }))).toEqual(["@'s list never opened"]);
    expect(judgeAtAfter(flight({ chipAt: null }))).toEqual(["the chip never stood in the draft"]);
  });
});

const sentSeen = (over: Partial<SentSeen> = {}): SentSeen => ({
  from: "bar",
  label: NOTE_LABEL,
  glyph: "snippets",
  paper: "#f6e7a9",
  ink: "#264a9a",
  objects: [],
  fromBox: { x0: 106, y0: 106, x1: 180, y1: 180 },
  rect: { x0: 106, y0: 106, x1: 180.5, y1: 180.5 },
  marks: { cleared: true, restored: true },
  taken: true,
  aimed: false,
  reduced: false,
  still: { width: 149, height: 149, bytes: 9000 },
  at: { pressed: 1000 },
  ...over,
});
const BOX = { x0: 100, y0: 100, x1: 186.5, y1: 186.5 };

describe("the still (DK-D26: the anchor's box less the brackets' 6, at the device's px; the marks hidden first)", () => {
  it("passes the canon's still", () => {
    expect(judgeStill(sentSeen(), BOX, 2)).toEqual([]);
    expect(
      judgeStill(sentSeen({ marks: { cleared: false, restored: false } }), null, 2, true),
    ).toEqual([]);
  });
  it("names a missing still, a rect with the brackets in it, a wrong size, the marks left in", () => {
    expect(judgeStill(sentSeen({ still: null }), BOX, 2)).toEqual([
      "no still was attached to the chip",
    ]);
    expect(
      judgeStill(sentSeen({ rect: { x0: 100, y0: 100, x1: 186.5, y1: 186.5 } }), BOX, 2)[0],
    ).toMatch(/not the anchor's box less the brackets' 6/u);
    expect(judgeStill(sentSeen({ still: { width: 75, height: 75, bytes: 1 } }), BOX, 2)[0]).toMatch(
      /75 × 75/u,
    );
    expect(judgeStill(sentSeen({ marks: { cleared: false, restored: false } }), BOX, 2)[0]).toMatch(
      /marks were not hidden first/u,
    );
    expect(judgeStill(sentSeen({ marks: { cleared: true, restored: false } }), BOX, 2)[0]).toMatch(
      /put back/u,
    );
    expect(judgeStill(sentSeen(), null, 2, true)).toEqual([
      "in hand the selection was cleared (nothing to hide there)",
    ]);
    expect(judgeStill(null, BOX, 2)).toEqual(["no Send to… was recorded"]);
  });
});

describe("the bar aside (§8: away while Send to… is on and @'s list open; back 200 after it folds)", () => {
  it("passes the canon's bar", () => {
    expect(judgeBarAside(flight(), 1000)).toEqual([]);
  });
  it("names a bar that stayed, came back early, or never came back", () => {
    expect(
      judgeBarAside(
        flight({
          bar: [
            { t: 990, shown: "true" },
            { t: 1300, shown: "false" },
            { t: 3215, shown: "true" },
          ],
        }),
        1000,
      ),
    ).toContain("the bar did not step aside as Send to… was pressed");
    expect(
      judgeBarAside(
        flight({
          bar: [
            { t: 1003, shown: "false" },
            { t: 1800, shown: "true" },
            { t: 1900, shown: "false" },
            { t: 3215, shown: "true" },
          ],
        }),
        1000,
      )[0],
    ).toMatch(/stood over the selection while Send to… was on/u);
    expect(
      judgeBarAside(
        flight({
          bar: [
            { t: 1003, shown: "false" },
            { t: 3010, shown: "true" },
          ],
        }),
        1000,
      )[0],
    ).toMatch(/came back 10 ms after the fold/u);
    expect(judgeBarAside(flight({ bar: [{ t: 1003, shown: "false" }] }), 1000)).toEqual([
      "the bar did not come back after @'s list folded",
    ]);
    // a bar that never left is said once — it did not step aside — with no way back to judge
    expect(judgeBarAside(flight({ bar: [{ t: 990, shown: "true" }] }), 1000)).toEqual([
      "the bar did not step aside as Send to… was pressed",
    ]);
    expect(judgeBarAside(flight({ atGoneAt: null }), 1000)).toEqual(["@'s list never folded"]);
  });
});
