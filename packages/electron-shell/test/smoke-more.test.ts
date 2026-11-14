// MK-6 — the pill's and the board's rise's pure judges (testing/smoke-more.ts): More in Plugins…
// at the board's foot by §8's numbers, its red naming MK-4d while no pill is drawn, and the board
// risen after an install on the set's first category with its first object ICE's focus. The rows
// are held in the product: smoke:canvas's MORE and smoke:market's RISE (desk-gates rows 17 and 37).
import { describe, expect, it } from "vitest";
import {
  judgePill,
  judgePlace,
  judgeRise,
  MORE_WAITS,
  PILL,
  type RiseSeen,
} from "../src/testing/smoke-more";

/** the default window, 1180 × 780: the pill at 648…680 (§8 "The pegboard") */
const VIEW = { height: 780 };
const DRAWER = { x: 40, w: 1100, p: 1 };
const centre = DRAWER.x + DRAWER.w / 2;
const pill = (over: Partial<{ x0: number; y0: number; x1: number; y1: number }> = {}) => ({
  rect: { x0: centre - 80, y0: 648, x1: centre + 80, y1: 680, ...over },
  radius: "16px",
});

describe("MORE — the pill at the board's foot", () => {
  it("passes the pill §8 draws: 32 tall, on the drawer's centre line, its foot 100 up", () => {
    expect(judgePill(pill(), DRAWER, VIEW)).toEqual([]);
    expect(PILL.words).toBe("More in Plugins…");
  });

  it("names a missing drawer and a missing pill", () => {
    expect(judgePill(pill(), null, VIEW)).toEqual(["the tray drew no drawer"]);
    expect(judgePill(null, DRAWER, VIEW)).toEqual([
      'no "More in Plugins…" stood at the board\'s foot',
    ]);
  });

  it("names its height, its centre, its foot and its corners, each off", () => {
    expect(
      judgePill(
        { rect: { x0: centre - 60, y0: 640, x1: centre + 100, y1: 676 }, radius: "8px" },
        DRAWER,
        VIEW,
      ),
    ).toEqual([
      "the pill is 36 tall, not 32",
      `the pill's centre is ${centre + 20}, not the drawer's ${centre}`,
      "the pill's foot is at 676, not 680 (100 above the window's)",
      "the pill's corners are 8px, not 16px",
    ]);
  });

  it("follows a smaller window: its foot is 100 above that window's", () => {
    expect(judgePill(pill({ y0: 568, y1: 600 }), DRAWER, { height: 700 })).toEqual([]);
  });

  it("names MK-4d in its red while no pill stands (A7), and reads a drawn one", () => {
    expect(MORE_WAITS).toBe("MORE (waits on MK-4d's pill)");
    expect(judgePlace(null, DRAWER, VIEW)).toEqual([
      `${MORE_WAITS}: no "More in Plugins…" stood at the board's foot`,
    ]);
    expect(judgePlace(null, null, VIEW)).toEqual(["MORE: the tray drew no drawer"]);
    const drawn = { ...pill(), shown: false, focused: false, glyph: false };
    expect(judgePlace(drawn, DRAWER, VIEW)).toEqual([
      "MORE: the pill stood hidden with the board out",
      "MORE: the pill wears no `plugin` glyph",
    ]);
    expect(judgePlace({ ...drawn, shown: true, glyph: true }, DRAWER, VIEW)).toEqual([]);
  });
});

describe("RISE — the board after Show on the pegboard", () => {
  const first = { type: "vibefield.example.desk-clock", category: "things" };
  const risen: RiseSeen = {
    popupOpen: false,
    boardOpen: true,
    category: "things",
    focused: first.type,
    boardHasKeyboard: true,
    ring: true,
    view: "canvas",
  };

  it("passes the board on the set's first category, its first object focused and ringed", () => {
    expect(judgeRise(risen, first)).toEqual([]);
  });

  it("names a popup left standing, a frame left on Godview, and a board that never rose", () => {
    const left = { ...risen, popupOpen: true, view: "godview", boardOpen: false };
    expect(judgeRise(left, first)).toEqual([
      "the popup did not fold",
      "the frame stayed on godview, not Canvas (MK-E14)",
      "the board did not rise",
    ]);
  });

  it("names the wrong category, the wrong focus, no keyboard and no ring", () => {
    expect(
      judgeRise(
        {
          ...risen,
          category: "",
          focused: "desk.note",
          boardHasKeyboard: false,
          ring: false,
        },
        first,
      ),
    ).toEqual([
      'the board rose on "", not things',
      `ICE's focus is "desk.note", not the set's first ${first.type}`,
      "the board did not hold the keyboard",
      "no ring stood over the focused object",
    ]);
  });
});
