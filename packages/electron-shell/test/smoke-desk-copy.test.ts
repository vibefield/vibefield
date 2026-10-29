// HN-D3 — THE DESK'S COPY, ITS SMOKE JUDGES (testing/smoke-desk-copy.ts; DESIGN.md §8 "The desk's Copy"): the card the act
// dealt (its kind and title, or the reason none was), the still a picture card carries (the anchor's box less the
// brackets' 6 at the device's px; asked without the selection's marks, the selection standing — ICE I40, DK-17b), the
// selection unchanged frame by frame (no blink), and the bar standing through it (nothing waits on the line any more).
// Pure — the rows' words, red where the canon is missed.
import { describe, expect, it } from "vitest";
import {
  type CopiedSeen,
  type CopyRecorded,
  copiedToMain,
  judgeBarStayed,
  judgeCard,
  judgeSelectionKept,
  judgeStill,
  NOTE_LINE,
  NOTE_TITLE,
} from "../src/testing/smoke-desk-copy";

const copiedSeen = (over: Partial<CopiedSeen> = {}): CopiedSeen => ({
  seq: 1,
  from: "bar",
  objects: [{ type: "vibefield.example.desk-clock", name: "Clock" }],
  fromBox: { left: 106, top: 106, width: 74.5, height: 74.5 },
  rect: { x0: 106, y0: 106, x1: 180.5, y1: 180.5 },
  words: null,
  wrote: null,
  marks: false,
  kept: true,
  still: { width: 149, height: 149, bytes: 9000 },
  card: { id: "card-pict-1", kind: "pict", title: "Clock" },
  refused: null,
  at: { pressed: 1000, captured: 1012, dealt: 1030 },
  ...over,
});
const BOX = { x0: 100, y0: 100, x1: 186.5, y1: 186.5 };

describe("the card the act dealt (HN-D3: a note's words a text card, anything else a picture titled by its name)", () => {
  it("passes the canon's card", () => {
    expect(judgeCard(copiedSeen(), { kind: "pict", title: "Clock" })).toEqual([]);
    expect(NOTE_TITLE).toBe("Ship the desk by Friday.");
    expect(NOTE_LINE.startsWith(NOTE_TITLE)).toBe(true);
  });

  it("names a card of the wrong kind or title, no card with the reason the line was told, and no record", () => {
    const textCard = copiedSeen({ card: { id: "c", kind: "text", title: "Clock" } });
    expect(judgeCard(textCard, { kind: "pict", title: "Clock" })[0]).toMatch(
      /a text card, not a pict card/u,
    );
    expect(judgeCard(copiedSeen(), { kind: "pict", title: "2 objects" })[0]).toMatch(
      /titled "Clock", not "2 objects"/u,
    );
    const refused = copiedSeen({ card: null, refused: "Not copied — the desk could not draw it" });
    expect(judgeCard(refused, { kind: "pict", title: "Clock" })).toEqual([
      "no card was dealt (Not copied — the desk could not draw it)",
    ]);
    expect(judgeCard(copiedSeen({ card: null }), { kind: "pict", title: "Clock" })).toEqual([
      "no card was dealt (and no reason was said)",
    ]);
    expect(judgeCard(null, { kind: "pict", title: "Clock" })).toEqual(["no Copy was recorded"]);
  });
});

describe("the still (DK-D26: the anchor's box less the brackets' 6, at the device's px; without the marks — ICE I40)", () => {
  it("passes the canon's still", () => {
    expect(judgeStill(copiedSeen(), BOX, 2)).toEqual([]);
    expect(judgeStill(copiedSeen(), null, 2, true)).toEqual([]);
  });

  it("names a missing still, a rect with the brackets in it, a wrong size, no bytes, the marks asked, the selection moved", () => {
    expect(judgeStill(copiedSeen({ still: null }), BOX, 2)).toEqual([
      "no still was taken for the card",
    ]);
    expect(
      judgeStill(copiedSeen({ rect: { x0: 100, y0: 100, x1: 186.5, y1: 186.5 } }), BOX, 2)[0],
    ).toMatch(/not the anchor's box less the brackets' 6/u);
    expect(
      judgeStill(copiedSeen({ still: { width: 75, height: 75, bytes: 1 } }), BOX, 2)[0],
    ).toMatch(/75 × 75/u);
    expect(
      judgeStill(copiedSeen({ still: { width: 149, height: 149, bytes: 0 } }), BOX, 2),
    ).toEqual(["the still carries no bytes"]);
    // the record keeps the marks as the capture door was handed them (copy-to-hand.ts): a door
    // handed true drew the brackets into the still, and a door never asked drew no still at all
    expect(judgeStill(copiedSeen({ marks: true }), BOX, 2)).toEqual([
      "the still was asked WITH the selection's marks (the door was handed true)",
    ]);
    expect(judgeStill(copiedSeen({ marks: null }), BOX, 2)).toEqual([
      "the capture door was never asked for the still",
    ]);
    expect(judgeStill(copiedSeen({ kept: false }), BOX, 2)[0]).toMatch(
      /did not stand as at the press/u,
    );
    expect(judgeStill(copiedSeen({ kept: null }), null, 2, true)[0]).toMatch(/kept null, in hand/u);
    expect(judgeStill(null, BOX, 2)).toEqual(["no Copy was recorded"]);
  });
});

describe("the words reach main's copy door, and only its record (R-T 4: a marked run never writes the pasteboard)", () => {
  it("finds the note's words among those the door kept since the press — none before it count", () => {
    const kept = ["an earlier copy", NOTE_LINE, "a later copy"];
    expect(copiedToMain(kept, 0, NOTE_LINE)).toBe(true);
    expect(copiedToMain(kept, 1, NOTE_LINE)).toBe(true);
    expect(copiedToMain(kept, 2, NOTE_LINE)).toBe(false);
    expect(copiedToMain([], 0, NOTE_LINE)).toBe(false);
  });

  it("has nothing to read in an unmarked run, whose door writes the real clipboard", () => {
    expect(copiedToMain(undefined, 0, NOTE_LINE)).toBeNull();
  });
});

const recorded = (over: Partial<CopyRecorded> = {}): CopyRecorded => ({
  t0: 990,
  bar: [{ t: 990, shown: "true" }],
  selection: [{ t: 990, count: 1 }],
  ...over,
});

describe("no blink (ICE I40): the selection never changes during Copy, frame by frame", () => {
  it("passes a selection that stood at its count from the arming on", () => {
    expect(judgeSelectionKept(recorded())).toEqual([]);
    expect(judgeSelectionKept(recorded({ selection: [{ t: 990, count: 2 }] }))).toEqual([]);
  });

  it("names a blink — cleared for the still and put back 150 ms later — and a recorder that saw nothing", () => {
    const blink = recorded({
      selection: [
        { t: 990, count: 1 },
        { t: 1003, count: 0 },
        { t: 1150, count: 1 },
      ],
    });
    expect(judgeSelectionKept(blink)[0]).toMatch(
      /1 at the press, then 0 at \+13 ms, 1 at \+160 ms \(a blink a peer would see\)/u,
    );
    expect(judgeSelectionKept(recorded({ selection: [] }))).toEqual([
      "the recorder saw no selection",
    ]);
  });
});

describe("the bar stands through a Copy (HN-D3: nothing waits on the line, so it never steps aside)", () => {
  it("passes a bar that stayed shown from the press on", () => {
    expect(judgeBarStayed(recorded(), 1000)).toEqual([]);
  });

  it("names a bar that stepped aside after the press — never one that was away before it", () => {
    const aside = recorded({
      bar: [
        { t: 990, shown: "true" },
        { t: 1004, shown: "false" },
        { t: 1210, shown: "true" },
      ],
    });
    expect(judgeBarStayed(aside, 1000)).toEqual([
      "the bar stepped aside for Copy (false at +4 ms)",
    ]);
    expect(
      judgeBarStayed(
        recorded({
          bar: [
            { t: 900, shown: "false" },
            { t: 990, shown: "true" },
          ],
        }),
        1000,
      ),
    ).toEqual([]);
  });
});
