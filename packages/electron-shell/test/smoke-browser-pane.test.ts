/**
 * PT-1 — the browser pane in the product (testing/smoke-browser-pane.ts): laid from the pegboard by the pointer — one pane
 * more, the one selection, its kind not faulted, the board folded; its FACE drawn by day and by night (judged by its colours
 * and its contrast, never by a hash, the night's page darker than the day's); a resize by the SE knob that writes Size and a
 * readout that FOLLOWS (the viewport the new size cuts, whole CSS px); a device switch re-cut about the centre with the head
 * at the phone's viewport, and ONE ⌘Z taking the size, the place and the device back together; and ICE's pick-up — in hand,
 * settled, its word the address, its five tools declared only — put down by Esc, still selected.
 */
import { describe, expect, it } from "vitest";
import {
  judgeDevice,
  judgeFace,
  judgeHand,
  judgeLaid,
  judgeResize,
  laptopViewport,
  PANE,
  type PaneSeen,
  pageRegion,
  travelAfterSlop,
} from "../src/testing/smoke-browser-pane";

/** The first product run's numbers (smoke:canvas, PT-1). */
const SEEN: PaneSeen = {
  laid: { before: 0, after: 1, selected: 1, faulted: false, folded: true },
  face: {
    day: { px: 360_000, colors: 412, lumaRange: 221, lumaMean: 186 },
    night: { px: 360_000, colors: 268, lumaRange: 182, lumaMean: 54 },
  },
  resize: {
    before: { x: 520.92, y: 386.063, w: 698.16, h: 461.94 },
    after: { x: 520.92, y: 386.063, w: 773.318, h: 512.046 },
    saidBefore: [1280, 800],
    saidAfter: [1423, 895],
    dragged: { dx: 90, dy: 60 },
    travel: { dx: 81, dy: 54 },
    zoom: 1.08465,
  },
  device: {
    after: { x: 807.064, y: 431.091, w: 201.03, h: 421.99 },
    afterDevice: "phone",
    said: [402, 874],
    undone: { x: 520.92, y: 386.063, w: 773.318, h: 512.046 },
    undoneDevice: "laptop",
  },
  hand: {
    held: true,
    settled: true,
    word: "lumen.example",
    readout: "lumen.example",
    tools: PANE.tools.map((id) => ({ id, dim: true })),
    down: true,
    selectedAfter: 1,
  },
};

describe("the viewport a size cuts — the law's, said again for the smoke", () => {
  it("cuts the laptop's page at its pegboard size, and never under the smallest viewport", () => {
    expect(laptopViewport({ w: 698.16, h: 461.94 })).toEqual([1280, 800]);
    expect(laptopViewport({ w: 40, h: 40 })).toEqual([320, 240]);
  });
});

describe("the PAGE's region of a framed pane — what FACE judges", () => {
  it("lies inside the clear border and under the engraved head, 4 % further in, at the frame's scale about its centre", () => {
    const rect = { w: 698.16, h: 461.94 };
    const page = pageRegion({ x0: 0, y0: 0, x1: rect.w, y1: rect.h }, rect);
    // 5 mm in from the sides and the foot, 11 mm under the top edge — then 4 % of what is left, each side
    expect(page.x0).toBeCloseTo(40, 3);
    expect(page.x1).toBeCloseTo(658.16, 3);
    expect(page.y0).toBeCloseTo(45.669, 3);
    expect(page.y1).toBeCloseTo(432.019, 3);
    // framed at twice the size, 100 px over: the region at twice the size, 100 px over
    const twice = pageRegion(
      { x0: 100, y0: 100, x1: 100 + 2 * rect.w, y1: 100 + 2 * rect.h },
      rect,
    );
    expect(twice.x0).toBeCloseTo(180, 3);
    expect(twice.y1).toBeCloseTo(100 + 2 * 432.019, 2);
  });
});

describe("the travel a handle's drag writes — ICE's drag starts where it leaves the dead zone", () => {
  it("is the drag less its first move past the slop: 90 × 60 in ten moves leaves it on the first (9 × 6, 10.8 px)", () => {
    expect(travelAfterSlop({ dx: 90, dy: 60 }, 10, 10)).toEqual({ dx: 81, dy: 54 });
    // in four moves the first is 22.5 × 15 — the whole of it before the drag begins
    expect(travelAfterSlop({ dx: 90, dy: 60 }, 4, 10)).toEqual({ dx: 67.5, dy: 45 });
    // a drag that never leaves the dead zone writes nothing
    expect(travelAfterSlop({ dx: 6, dy: 6 }, 3, 10)).toEqual({ dx: 0, dy: 0 });
  });
});

describe("LAID — the pane taken off the pegboard by the pointer", () => {
  it("passes the run's take", () => {
    expect(judgeLaid(SEEN.laid)).toEqual([]);
  });

  it("refuses a take that laid nothing, an object not selected, a faulted kind, a board left out", () => {
    expect(judgeLaid({ ...SEEN.laid, after: 0 })[0]).toMatch(/laid 0 panes, not one/);
    expect(judgeLaid({ ...SEEN.laid, selected: 0 })[0]).toMatch(/not the one pane/);
    expect(judgeLaid({ ...SEEN.laid, faulted: true })[0]).toMatch(/refused or struck/);
    expect(judgeLaid({ ...SEEN.laid, folded: false })).toEqual([
      "LAID: the board stayed out after the take",
    ]);
  });
});

describe("FACE — the page drawn, by day and by night", () => {
  it("passes the run's faces", () => {
    expect(judgeFace(SEEN.face)).toEqual([]);
  });

  it("refuses a flat face (a fill, a film), a capture that answered nothing, a night no darker than the day", () => {
    const flat = { px: 360_000, colors: 6, lumaRange: 30, lumaMean: 20 };
    expect(judgeFace({ ...SEEN.face, day: flat })[0]).toMatch(/by day the page is flat/);
    expect(judgeFace({ ...SEEN.face, night: null })).toEqual([
      "FACE: no capture answered by night",
    ]);
    expect(
      judgeFace({ day: SEEN.face.day, night: { ...SEEN.face.night, lumaMean: 180 } as never })[0],
    ).toMatch(/no darker than by day/);
  });
});

describe("RESIZE — the SE knob writes Size, and the head's readout follows", () => {
  it("passes the run's resize", () => {
    expect(judgeResize(SEEN.resize)).toEqual([]);
  });

  it("refuses a size the drag did not make, a moved top-left, a readout that stayed or names another viewport", () => {
    expect(judgeResize({ ...SEEN.resize, after: SEEN.resize.before })[0]).toMatch(
      /the drag's travel makes/,
    );
    // the whole drag, as if ICE's dead zone were not there: short by the first move
    expect(judgeResize({ ...SEEN.resize, travel: SEEN.resize.dragged })[0]).toMatch(
      /the drag's travel makes/,
    );
    expect(
      judgeResize({ ...SEEN.resize, after: { ...SEEN.resize.after, x: 20 } }).some((p) =>
        /moved the top-left/.test(p),
      ),
    ).toBe(true);
    expect(judgeResize({ ...SEEN.resize, saidAfter: [1280, 800] })).toEqual([
      "RESIZE: the head reads 1280 × 800, not the 1423 × 895 the new size cuts — the readout did not follow",
      "RESIZE: the head's readout stayed 1280 × 800",
    ]);
    expect(judgeResize({ ...SEEN.resize, saidAfter: null })).toEqual([
      "RESIZE: the pane's witness says nothing of its head",
    ]);
  });
});

describe("DEVICE — the iPhone act re-cuts the pane in one transaction", () => {
  it("passes the run's switch and its one undo step", () => {
    expect(judgeDevice(SEEN.resize.after, SEEN.device)).toEqual([]);
  });

  it("refuses a switch that wrote no device, a size not the phone's, a moved centre, a head not at the phone's viewport", () => {
    expect(judgeDevice(SEEN.resize.after, { ...SEEN.device, afterDevice: "laptop" })[0]).toMatch(
      /wrote device laptop, not phone/,
    );
    expect(
      judgeDevice(SEEN.resize.after, {
        ...SEEN.device,
        after: { ...SEEN.device.after, w: 300 },
      }).some((p) => /not the phone's cut/.test(p)),
    ).toBe(true);
    expect(
      judgeDevice(SEEN.resize.after, {
        ...SEEN.device,
        after: { ...SEEN.device.after, x: 0, y: 0 },
      }).some((p) => /moved the pane's centre/.test(p)),
    ).toBe(true);
    expect(judgeDevice(SEEN.resize.after, { ...SEEN.device, said: [1423, 895] })).toEqual([
      "DEVICE: the head reads 1423 × 895, not the phone's 402 × 874",
    ]);
  });

  it("refuses an undo that took back the device without the size, or the size without the device — two transactions", () => {
    expect(judgeDevice(SEEN.resize.after, { ...SEEN.device, undoneDevice: "phone" })).toEqual([
      "DEVICE: one ⌘Z left the device phone — the switch was not one transaction",
    ]);
    expect(
      judgeDevice(SEEN.resize.after, { ...SEEN.device, undone: SEEN.device.after })[0],
    ).toMatch(/did not take the size and place back with the device/);
  });
});

describe("HAND — ICE's pick-up, put down by Esc", () => {
  it("passes the run's pick-up", () => {
    expect(judgeHand(SEEN.hand)).toEqual([]);
  });

  it("refuses no pick-up, a word that is not the address, tools missing or shown live, a pane not put down", () => {
    expect(judgeHand({ ...SEEN.hand, held: false })[0]).toBe("HAND: ⏎ did not pick the pane up");
    expect(judgeHand({ ...SEEN.hand, settled: false })[0]).toBe("HAND: the pick-up never settled");
    expect(judgeHand({ ...SEEN.hand, readout: "Search or enter website name" })[0]).toMatch(
      /held bar prints "Search or enter website name", not the address lumen\.example/,
    );
    expect(judgeHand({ ...SEEN.hand, tools: [] })[0]).toMatch(/held tools are none/);
    expect(
      judgeHand({
        ...SEEN.hand,
        tools: SEEN.hand.tools.map((t) => (t.id === "reload" ? { ...t, dim: false } : t)),
      }),
    ).toEqual(["HAND: reload shown live — PT-1 declares them only"]);
    expect(judgeHand({ ...SEEN.hand, down: false, selectedAfter: 0 })).toEqual([
      "HAND: Esc did not put the pane down",
      "HAND: put down, 0 selected — not the pane still",
    ]);
  });
});
