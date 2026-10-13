/**
 * PT-5d — the frames rows' judges (testing/smoke-frames.ts): a frame of another site reached where the hand pressed, its
 * hover, its double-click, its drag released outside it, its wheel and the chain past it, keys and a composition, a frame in
 * a frame, a frame half out of view, a phone's tap, a frame gone under a held press, the nested frame's file input; a page
 * that goes back by itself written (BACK-WRITTEN); a page that hangs (STUCK). Each judge passes the rows as meant, and says
 * in words what the lane before PT-5d did — and what proves nothing.
 */
import { describe, expect, it } from "vitest";
import { FRAMES_WORD } from "../src/testing/live-fixture";
import {
  FRAMES_ROWS,
  type HeldEyeSeen,
  judgeBackWritten,
  judgeFrameBusy,
  judgeFrameClipped,
  judgeFrameCovered,
  judgeFrameDouble,
  judgeFrameDrag,
  judgeFrameGone,
  judgeFrameHalf,
  judgeFrameHover,
  judgeFrameMenu,
  judgeFrameNested,
  judgeFramePicker,
  judgeFramePress,
  judgeFrameTouch,
  judgeFrameType,
  judgeFrameWheel,
  judgeFrameZoomed,
  judgePressAnswer,
  judgeStood,
  judgeStuck,
  pageOfWindow,
  pageThroughEye,
  visibleView,
} from "../src/testing/smoke-frames";
import { pageOnWindow } from "../src/testing/smoke-use-pane";

/** A point in a page's own CSS px. */
type Point = readonly [number, number];

describe("PT-5d — the frames rows, as the product says them", () => {
  it("FRAME-PRESS: the frame's click where the hand pressed (±1 CSS px), the host hearing nothing on the frame's element; before PT-5d the host heard the press on the element and the frame nothing", () => {
    expect(
      judgeFramePress("FRAME-PRESS", { aimed: [90, 42], clicked: [90, 42], hostHeard: [] }),
    ).toEqual([]);
    expect(
      judgeFramePress("FRAME-PRESS", { aimed: [90, 42], clicked: [91, 41], hostHeard: [] }),
    ).toEqual([]);
    expect(
      judgeFramePress("FRAME-PRESS", {
        aimed: [90, 42],
        clicked: null,
        hostHeard: ["pointerdown #f", "mousedown #f", "click #f"],
      }),
    ).toEqual([
      "FRAME-PRESS: the frame heard no click — the press never reached a frame of another site (the host heard pointerdown #f, mousedown #f, click #f)",
      "FRAME-PRESS: the host page heard the press on the frame's element (pointerdown #f, mousedown #f, click #f) — it went down the page's own session",
    ]);
    expect(
      judgeFramePress("FRAME-PRESS", { aimed: [90, 42], clicked: [96, 42], hostHeard: [] }),
    ).toEqual([
      "FRAME-PRESS: the frame's click landed at 96, 42, not where the hand pressed (90.0, 42.0, ±1): the routing carried the point elsewhere",
    ]);
    expect(judgeFramePress("FRAME-PRESS", { aimed: null, clicked: null, hostHeard: [] })).toEqual([
      "FRAME-PRESS: the frame's part could not be aimed at — the row proved nothing",
    ]);
    // M6.1: its second press, in the frame's own child of its site — the same words, its own name
    expect(
      judgeFramePress("FRAME-PRESS (its own site's frame in it)", {
        aimed: [70, 30],
        clicked: [17, 7],
        hostHeard: [],
      }),
    ).toEqual([
      "FRAME-PRESS (its own site's frame in it): the frame's click landed at 17, 7, not where the hand pressed (70.0, 30.0, ±1): the routing carried the point elsewhere",
    ]);
  });

  it("FRAME-PRESS (PT-6a, ruling 3) — the hand aims THROUGH THE PANE'S OWN EYE, both ways: the frame's click judged at the point its WHOLE window point presses (±1) — M18's interpolation and M22 A's column gone; the host's own presses beside the frame each within ±1 of theirs (what the calibration reads), else the aim is off: the click proved nothing; a press taken never heard, or none, or no calibration: the click proved nothing", () => {
    const ground = (aimed: Point, pressed: Point, clicked: Point | null) => ({
      aimed,
      pressed,
      clicked,
    });
    const calibration = {
      left: ground([140, 162], [140.3, 161.8], [140, 162]),
      right: ground([820, 162], [819.6, 162.2], [820, 162]),
      column: ground([250, 560], [250.2, 559.7], [250, 560]),
      at: 250,
    };
    const press = {
      aimed: [90, 42] as const,
      pressed: [89.7, 42.3] as const,
      clicked: [90, 42] as const,
      hostHeard: [],
      calibration,
    };
    expect(judgeFramePress("FRAME-PRESS", press)).toEqual([]);
    // a click 3 px from where the hand pressed, its calibration within ±1: the routing's
    expect(judgeFramePress("FRAME-PRESS", { ...press, clicked: [93, 42] })).toEqual([
      "FRAME-PRESS: the frame's click landed at 93, 42, not where the hand pressed (89.7, 42.3, ±1; the host's calibration beside it within 0.4, 0.3): the routing carried the point elsewhere",
    ]);
    // run 1's flat aim, as its calibration read it (+4, +2 left of the frame): the aim is off — the click proved nothing
    expect(
      judgeFramePress("FRAME-PRESS", {
        ...press,
        clicked: [93, 44],
        calibration: { ...calibration, left: ground([140, 162], [140, 162], [144, 164]) },
      }),
    ).toEqual([
      "FRAME-PRESS: the host's own clicks beside the frame landed 4.0, 2.0 from where the hand pressed them (±1) — the smoke's reading of the hand is off: the click proved nothing",
    ]);
    // a side out of the page's view, not pressed (FRAME-TOUCH's phone shows 402 of its host's 800): read from the presses taken
    expect(
      judgeFramePress("FRAME-PRESS", { ...press, calibration: { ...calibration, right: null } }),
    ).toEqual([]);
    // a press taken never heard; none taken; none at all
    for (const c of [
      { ...calibration, column: ground([250, 560], [250.4, 559.7], null) },
      { left: null, right: null, at: 250 },
      null,
    ])
      expect(judgeFramePress("FRAME-PRESS", { ...press, calibration: c })).toEqual([
        "FRAME-PRESS: the host's calibration beside the frame never landed — the click proved nothing",
      ]);
    // a ground press saying no point pressed is read at its aim
    expect(
      judgeFramePress("FRAME-PRESS", {
        ...press,
        calibration: { ...calibration, left: { aimed: [140, 162], clicked: [142, 162] } },
      }),
    ).toEqual([
      "FRAME-PRESS: the host's own clicks beside the frame landed 2.0, 0.3 from where the hand pressed them (±1) — the smoke's reading of the hand is off: the click proved nothing",
    ]);
  });

  it("PT-6a (ruling 3) — the aim THROUGH THE PANE'S OWN EYE: an eye infinitely high aims as the flat map (`pageOnWindow`) does; the product's eye, over its rect's centre, the face a lift above the mat, aims k = h / (h − z) farther from the eye's foot; and the product's own way back (core's held input, the law's `facePoint`, `pagePoint`) returns the page point", () => {
    // a laptop's pane laid as the law lays it: its rect at 1000, 500; its page 1280 × 800 CSS px on a face 640 × 400 units,
    // centred 20 below the rect's centre (the head above it), the pane's half height 230 — its open extent −230 … 220, its
    // centre 5 above the rect's; the desk drew that extent at 700, 420, 1.5 CSS px a unit, the desk 10, 30 into the window
    const view = [1280, 800] as const;
    const off = { left: 10, top: 30 };
    const held = (h: number): HeldEyeSeen => ({
      cx: 700,
      cy: 420,
      hx: 320 * 1.5,
      hy: 225 * 1.5,
      s: 1.5,
      settled: true,
      eye: { ex: 1000, ey: 500, h },
      centre: [1000, 500, 24.6],
      axes: [
        [1, 0, 0],
        [0, 1, 0],
        [0, 0, 1],
      ],
      page: [0, 20, 320, 200],
      ext: [1000, 495],
    });
    const points = [
      [140, 162],
      [820, 162],
      [250, 560],
      [640, 400],
    ] as const;
    for (const [px, py] of points) {
      const flat = pageOnWindow(held(1e12), view, off, px, py);
      const far = pageThroughEye(held(1e12), view, off, px, py);
      expect(far.x).toBeCloseTo(flat.x, 6);
      expect(far.y).toBeCloseTo(flat.y, 6);
      // the eye's foot on the window: the rect's centre, 5 units below the extent's — 710, 457.5
      const k = 1636.6 / (1636.6 - 24.6);
      const aim = pageThroughEye(held(1636.6), view, off, px, py);
      expect(aim.x - 710).toBeCloseTo((flat.x - 710) * k, 6);
      expect(aim.y - 457.5).toBeCloseTo((flat.y - 457.5) * k, 6);
      const back = pageOfWindow(held(1636.6), view, off, aim.x, aim.y);
      expect(back[0]).toBeCloseTo(px, 9);
      expect(back[1]).toBeCloseTo(py, 9);
    }
    // the page's 140, 375 window px left of the eye's foot: drawn and pressed 1.5 % farther out — 5.7 px left of the flat aim
    const flat = pageOnWindow(held(1636.6), view, off, 140, 162);
    expect(pageThroughEye(held(1636.6), view, off, 140, 162).x - flat.x).toBeCloseTo(-5.72, 2);
  });

  it("M16-1 — each row of the host's frame starts from a KNOWN state and says where its frame stands: the frame where the row aims (the host at its top) — else the row proved nothing, never a pass (run 1: FRAME-WHEEL's chain left the host at its end, every row after it aimed at a frame out of view)", () => {
    expect(judgeStood("FRAME-TYPE", { x: 160, y: 120, w: 640, h: 420 })).toEqual([]);
    expect(judgeStood("FRAME-TYPE", { x: 160, y: -1480, w: 640, h: 420 })).toEqual([
      "FRAME-TYPE: its frame stood at 160, -1480, not at 160, 120 where the row aims — the row proved nothing",
    ]);
    expect(judgeStood("FRAME-NESTED", null)).toEqual([
      "FRAME-NESTED: its frame stood nowhere the host said — the row proved nothing",
    ]);
  });

  it("M22 D1 — a row aims through the page's VISUAL viewport: a phone's page that overflows its layout (its layout 800, 402 of it shown) is aimed by the 402 it shows; a page naming no viewport (980 shown at 0.41), by its 980; one that says no visible size, by its view", () => {
    expect(visibleView({ view: [800, 1739], vv: [1, 0, 0, 402, 874] }).size).toEqual([402, 874]);
    expect(visibleView({ view: [980, 2130], vv: [0.41, 0, 0, 980, 2130] }).size).toEqual([
      980, 2130,
    ]);
    expect(visibleView({ view: [1280, 800], vv: [1, 0, 0] }).size).toEqual([1280, 800]);
    expect(visibleView({ view: [1280, 800] }).size).toEqual([1280, 800]);
  });

  it("PT-6a (K7) — the part a row aims through KEEPS its offset: a pinch-panned page shows its layout from there — a page's client point is aimed less it (M23: \"less its offset\"); a page at its layout's origin, or one saying no visible size, offset 0", () => {
    expect(visibleView({ view: [1280, 800], vv: [2, 300, 120, 640, 400] })).toEqual({
      size: [640, 400],
      offset: [300, 120],
    });
    expect(visibleView({ view: [800, 1739], vv: [1, 0, 0, 402, 874] })).toEqual({
      size: [402, 874],
      offset: [0, 0],
    });
    expect(visibleView({ view: [1280, 800] })).toEqual({ size: [1280, 800], offset: [0, 0] });
  });

  it("FRAME-HOVER: a pointer over the frame's link; the pointer moved OUT of the frame (M7 H15: a real leave) — the cursor no pointer, and the frame heard its link left", () => {
    expect(judgeFrameHover({ over: "pointer", off: "default", left: true })).toEqual([]);
    expect(judgeFrameHover({ over: null, off: "pointer", left: false })).toEqual([
      "FRAME-HOVER: over the frame's link the cursor is nothing, not a pointer — the hover never reached the frame",
      "FRAME-HOVER: out of the frame the cursor is still a pointer — the hover's leave never reached the frame",
      "FRAME-HOVER: the frame never heard the pointer leave its link — the hover's leave never reached it",
    ]);
    expect(judgeFrameHover({ over: "pointer", off: "default", left: null })).toEqual([
      "FRAME-HOVER: the frame never said what it heard — the leave proved nothing",
    ]);
  });

  it("FRAME-DOUBLE: the frame's word selected", () => {
    expect(judgeFrameDouble({ sel: `${FRAMES_WORD} ` })).toEqual([]);
    expect(judgeFrameDouble({ sel: "" })).toEqual([
      `FRAME-DOUBLE: a double-click selected "" in the frame, not "${FRAMES_WORD}" — its count never reached it`,
    ]);
  });

  it("FRAME-DRAG: the thumb moved, and after a release OUTSIDE the frame its next move holds no button; a drag that never reached it, or a button left down, says so — M15 F3: and which half failed, by the moves the frame heard with its button held", () => {
    expect(judgeFrameDrag({ before: 10, after: 84, buttonsAfter: 0 })).toEqual([]);
    expect(judgeFrameDrag({ before: 10, after: 100, buttonsAfter: 0, movesHeld: 12 })).toEqual([]);
    // M18 B: and the host's OWN range dragged on the page's session — moved; or not (the defect every page had)
    expect(
      judgeFrameDrag({
        before: 10,
        after: 100,
        buttonsAfter: 0,
        movesHeld: 12,
        host: { before: 10, after: 90 },
      }),
    ).toEqual([]);
    expect(
      judgeFrameDrag({
        before: 10,
        after: 100,
        buttonsAfter: 0,
        movesHeld: 12,
        host: { before: 10, after: 10 },
      }),
    ).toEqual([
      "FRAME-DRAG (the host's own range): it stood at 10 after the drag (from 10) — a drag on the page's own session never moved it",
    ]);
    expect(
      judgeFrameDrag({
        before: 10,
        after: 100,
        buttonsAfter: 0,
        movesHeld: 12,
        host: { before: null, after: null },
      }),
    ).toEqual([
      "FRAME-DRAG (the host's own range): the host never said its range — that leg proved nothing",
    ]);
    // M15 F3: the moves never reached the frame — or reached it, and its thumb never followed
    expect(judgeFrameDrag({ before: 10, after: 10, buttonsAfter: 0, movesHeld: 0 })).toEqual([
      "FRAME-DRAG: the range stood at 10 after the drag (from 10) — the frame heard no move with its button held: the drag's moves never reached it",
    ]);
    expect(judgeFrameDrag({ before: 10, after: 10, buttonsAfter: 0, movesHeld: 12 })).toEqual([
      "FRAME-DRAG: the range stood at 10 after the drag (from 10) — the frame heard 12 moves with its button held and its thumb never followed: they reached it and did not drag",
    ]);
    expect(judgeFrameDrag({ before: 10, after: 10, buttonsAfter: 1 })).toEqual([
      "FRAME-DRAG: the range stood at 10 after the drag (from 10) — the drag never moved it",
      "FRAME-DRAG: after the release outside the frame its next move held buttons 1 — a button left down in the frame (every hover a drag)",
    ]);
    expect(judgeFrameDrag({ before: 10, after: 84, buttonsAfter: null })).toEqual([
      "FRAME-DRAG: the frame heard no move after the release — the row proved nothing of what was left down",
    ]);
    expect(judgeFrameDrag({ before: null, after: null, buttonsAfter: null })).toEqual([
      "FRAME-DRAG: the frame never said its range — the row proved nothing",
    ]);
  });

  it("FRAME-WHEEL: the frame's scroller scrolled, and past its end the host page — PT-6a (M1): the leg's whole time bounded, two bubbles past its sending at most, never one a wheel", () => {
    const leg = { sentMs: 1_300, drainedMs: 1_800 };
    expect(judgeFrameWheel({ scroller: [0, 1020], host: [0, 400], leg })).toEqual([]);
    expect(judgeFrameWheel({ scroller: [0, 0], host: [0, 0], leg })).toEqual([
      "FRAME-WHEEL: the frame's scroller stood at 0 (from 0) — the wheel never reached the frame",
      "FRAME-WHEEL: past the scroller's end the host stood at 0 (from 0) — the wheel did not chain to the page",
    ]);
    expect(judgeFrameWheel({ scroller: [null, 0], host: [0, 0], leg })).toEqual([
      "FRAME-WHEEL: the scroller or the host never said its scroll — the row proved nothing",
    ]);
    // two bubbles past the sending, to the ms; past it — run 4's chain, a bubble a wheel; never drained; never sent
    const bound = 1_300 + 2 * 1_020 + 600;
    expect(
      judgeFrameWheel({ scroller: [0, 1020], host: [0, 400], leg: { ...leg, drainedMs: bound } }),
    ).toEqual([]);
    expect(
      judgeFrameWheel({
        scroller: [0, 1020],
        host: [0, 400],
        leg: { ...leg, drainedMs: bound + 1 },
      }),
    ).toEqual([
      "FRAME-WHEEL: the hand's chain drained 3941 ms after the first wheel (its wheels sent over 1300 ms; at most 3940: two bubbles past the sending) — the frame held the chain a bubble a wheel",
    ]);
    expect(
      judgeFrameWheel({ scroller: [0, 1020], host: [0, 400], leg: { ...leg, drainedMs: null } }),
    ).toEqual([
      "FRAME-WHEEL: the hand's chain drained not within 25000 ms after the first wheel (its wheels sent over 1300 ms; at most 3940: two bubbles past the sending) — the frame held the chain a bubble a wheel",
    ]);
    expect(judgeFrameWheel({ scroller: [0, 0], host: [0, 0], leg: null })).toEqual([
      "FRAME-WHEEL: the frame's scroller stood at 0 (from 0) — the wheel never reached the frame",
      "FRAME-WHEEL: past the scroller's end the host stood at 0 (from 0) — the wheel did not chain to the page",
      "FRAME-WHEEL: its wheels were never sent — the row proved nothing",
    ]);
  });

  it("FRAME-TYPE (M15, a stated limit): typing into a frame of another site is OFF — its field left EMPTY, no key heard by the host or by the frame, and main counting each leg's refusals (the typing, the IME, ⌘A); before M15 the field held what was typed — the path that crashed main", () => {
    const off = {
      focused: true,
      refused: { typed: 10, composed: 2, selectAll: 1 },
      field: "",
      hostHeard: ["pointerdown #f"],
      frameHeard: ["mouseup #t", "click #t"],
      hostAsks: 2,
      frameAsks: 2,
    };
    expect(judgeFrameType(off)).toEqual([]);
    // the field never focused: the legs typed at nothing of the frame's
    expect(judgeFrameType({ ...off, focused: false })).toEqual([
      "FRAME-TYPE: the frame's field never took the focus — the row proved nothing",
    ]);
    // as built before M15: what was typed in the field — the keys down the frame's own session — and none refused
    expect(
      judgeFrameType({
        ...off,
        refused: { typed: 0, composed: 0, selectAll: 0 },
        field: FRAMES_ROWS.typed + FRAMES_ROWS.composed,
        frameHeard: [...off.frameHeard, "keydown h", "keydown é"],
      }),
    ).toEqual([
      `FRAME-TYPE: the frame's field holds ${JSON.stringify(FRAMES_ROWS.typed + FRAMES_ROWS.composed)} — typing reached a frame of another site (M15: refused, a stated limit — through the product's frame session it crashed main)`,
      `FRAME-TYPE (typed): main refused 0 key-like event(s), not ${FRAMES_ROWS.refusedAtLeast.typed} or more — the rest went somewhere, or never reached main`,
      `FRAME-TYPE (composed): main refused 0 key-like event(s), not ${FRAMES_ROWS.refusedAtLeast.composed} or more — the rest went somewhere, or never reached main`,
      `FRAME-TYPE (selectAll): main refused 0 key-like event(s), not ${FRAMES_ROWS.refusedAtLeast.selectAll} or more — the rest went somewhere, or never reached main`,
      "FRAME-TYPE: the frame heard 2 key(s) (keydown h, keydown é) — they went down its own session (M15: typing into a frame of another site is off)",
    ]);
    // main's count never read: that leg proved nothing
    expect(judgeFrameType({ ...off, refused: { ...off.refused, composed: null } })).toEqual([
      "FRAME-TYPE (composed): main's count of the refused was never read — the leg proved nothing",
    ]);
    // the host heard keys: the page's session, with a frame of another site focused (M3's banned path)
    expect(judgeFrameType({ ...off, hostHeard: [...off.hostHeard, "keydown h"] })).toEqual([
      "FRAME-TYPE: the host page heard 1 key(s) while the frame's field was typed in (keydown h) — they went down the page's session with a frame of another site focused (M3's banned path)",
    ]);
    // M12 J11, M15: each page's word read after two more of its asks — one taken after the last key; fewer: proved nothing
    expect(judgeFrameType({ ...off, hostAsks: 1, frameAsks: null })).toEqual([
      "FRAME-TYPE: the host's word was read before one taken after the last key (1 ask since) — its host-heard half proved nothing",
      "FRAME-TYPE: the frame's word was read before one taken after the last key (0 ask since) — its empty field and its keys heard proved nothing",
    ]);
  });

  it("FRAME-NESTED and FRAME-HALF: a press that lands — only where the nested frame is a third site, and only where the frame is half out", () => {
    const landed = { aimed: [70, 40] as const, clicked: [70, 40] as const, hostHeard: [] };
    expect(judgeFrameNested({ ...landed, third: true })).toEqual([]);
    expect(judgeFrameNested({ ...landed, third: false })).toEqual([
      "FRAME-NESTED: the nested frame is not of a third site (no IPv6 loopback) — the row proved nothing",
    ]);
    expect(
      judgeFrameNested({ aimed: [70, 40], clicked: null, hostHeard: [], third: true }),
    ).toEqual([
      "FRAME-NESTED: the frame heard no click — the press never reached a frame of another site (the host heard nothing)",
    ]);
    expect(judgeFrameHalf({ ...landed, top: -210 })).toEqual([]);
    expect(judgeFrameHalf({ ...landed, top: 120 })).toEqual([
      "FRAME-HALF: the frame's top stood at 120 — it was not half out of the view: the row proved nothing",
    ]);
  });

  it("FRAME-CLIPPED (M6.3a): the frame half under its scroller's clip edge — a press on its clipped part is the HOST's (its header, drawn there), on its part in view the frame's; before M6.3a the frame took both; a frame not clipped, or a part not aimed at, proves nothing", () => {
    const shown = { aimed: [90, 352] as const, clicked: [90, 352] as const, hostHeard: [] };
    const header = ["pointerdown #hd", "mousedown #hd", "mouseup #hd", "click #hd"];
    expect(
      judgeFrameClipped({
        top: 90,
        edge: 300,
        hidden: { hostHeard: header, frameClicks: 0 },
        shown,
      }),
    ).toEqual([]);
    expect(
      judgeFrameClipped({ top: 90, edge: 300, hidden: { hostHeard: [], frameClicks: 1 }, shown }),
    ).toEqual([
      "FRAME-CLIPPED: the press on the frame's clipped part went to the FRAME (1 click) — the host draws there",
      "FRAME-CLIPPED: the host heard nothing — not the press on its header, which it draws over the frame's clipped part",
    ]);
    expect(
      judgeFrameClipped({
        top: 90,
        edge: 300,
        hidden: { hostHeard: header, frameClicks: 0 },
        shown: { aimed: [90, 352], clicked: null, hostHeard: ["pointerdown #f"] },
      }),
    ).toEqual([
      "FRAME-CLIPPED (its part in view): the frame heard no click — the press never reached a frame of another site (the host heard pointerdown #f)",
      "FRAME-CLIPPED (its part in view): the host page heard the press on the frame's element (pointerdown #f) — it went down the page's own session",
    ]);
    expect(
      judgeFrameClipped({
        top: 300,
        edge: 300,
        hidden: { hostHeard: header, frameClicks: 0 },
        shown,
      }),
    ).toEqual([
      "FRAME-CLIPPED: the frame's top stood at 300, its scroller's at 300 — it was not clipped: the row proved nothing",
    ]);
    expect(judgeFrameClipped({ top: 90, edge: 300, hidden: null, shown })).toEqual([
      "FRAME-CLIPPED: the frame's clipped part could not be aimed at — that half proved nothing",
    ]);
  });

  it("FRAME-COVERED (M7 H3): a fixed header over the frame's top — a press on the header there is the HOST's, one below it the frame's; before H3 the frame took both; a header not over the frame proves nothing", () => {
    const shown = { aimed: [90, 352] as const, clicked: [90, 352] as const, hostHeard: [] };
    const header = ["pointerdown #hd", "mousedown #hd", "mouseup #hd", "click #hd"];
    expect(
      judgeFrameCovered({
        top: 60,
        edge: 140,
        hidden: { hostHeard: header, frameClicks: 0 },
        shown,
      }),
    ).toEqual([]);
    expect(
      judgeFrameCovered({ top: 60, edge: 140, hidden: { hostHeard: [], frameClicks: 1 }, shown }),
    ).toEqual([
      "FRAME-COVERED: the press on the header over the frame went INTO the frame (1 click) — the host draws its header there",
      "FRAME-COVERED: the host heard nothing — not the press on its header, drawn over the frame",
    ]);
    expect(
      judgeFrameCovered({
        top: 140,
        edge: 140,
        hidden: { hostHeard: header, frameClicks: 0 },
        shown,
      }),
    ).toEqual([
      "FRAME-COVERED: the frame's top stood at 140, the header's bottom at 140 — the header was not over it: the row proved nothing",
    ]);
    expect(judgeFrameCovered({ top: 60, edge: 140, hidden: null, shown })).toEqual([
      "FRAME-COVERED: the frame's covered part could not be aimed at — that half proved nothing",
    ]);
    // M8: the leg whose page HIDES its header from the read (its own world's DOM methods replaced): still the host's
    expect(
      judgeFrameCovered({
        top: 60,
        edge: 140,
        hidden: { hostHeard: header, frameClicks: 0 },
        shown,
        sly: { hostHeard: header, frameClicks: 0 },
      }),
    ).toEqual([]);
    expect(
      judgeFrameCovered({
        top: 60,
        edge: 140,
        hidden: { hostHeard: header, frameClicks: 0 },
        shown,
        sly: { hostHeard: [], frameClicks: 1 },
      }),
    ).toEqual([
      "FRAME-COVERED (a page hiding its header from the read): the press on the header went INTO the frame (1 click) — the read believed the page's own world",
      "FRAME-COVERED (a page hiding its header from the read): the host heard nothing — not the press on its header",
    ]);
    expect(
      judgeFrameCovered({
        top: 60,
        edge: 140,
        hidden: { hostHeard: header, frameClicks: 0 },
        shown,
        sly: null,
      }),
    ).toEqual([
      "FRAME-COVERED (a page hiding its header from the read): its press could not be aimed — that leg proved nothing",
    ]);
    // M12 J5: the frame held in an about:blank SLOT of the host (a frame of its own process), the header over the SLOT:
    // its press still the host's; below it, the frame's
    const plain = { top: 60, edge: 140, hidden: { hostHeard: header, frameClicks: 0 }, shown };
    const slot = { top: 60, edge: 140, hidden: { hostHeard: header, frameClicks: 0 }, shown };
    expect(judgeFrameCovered({ ...plain, slot })).toEqual([]);
    expect(
      judgeFrameCovered({ ...plain, slot: { ...slot, hidden: { hostHeard: [], frameClicks: 1 } } }),
    ).toEqual([
      "FRAME-COVERED (the frame in an about:blank slot): the press on the header over the slot went INTO the frame (1 click) — the page draws its header over the slot (M12 J5)",
      "FRAME-COVERED (the frame in an about:blank slot): the host heard nothing — not the press on its header, drawn over the slot",
    ]);
    expect(
      judgeFrameCovered({ ...plain, slot: { ...slot, shown: { ...shown, clicked: null } } }),
    ).toEqual([
      "FRAME-COVERED (the frame in an about:blank slot, below the header): the frame heard no click — the press never reached a frame of another site (the host heard nothing)",
    ]);
    expect(judgeFrameCovered({ ...plain, slot: { ...slot, top: 140 } })).toEqual([
      "FRAME-COVERED (the frame in an about:blank slot): the slot's top stood at 140, the header's bottom at 140 — the header was not over it: that half proved nothing",
    ]);
    expect(judgeFrameCovered({ ...plain, slot: null })).toEqual([
      "FRAME-COVERED (the frame in an about:blank slot): its presses could not be aimed — that leg proved nothing",
    ]);
  });

  it("FRAME-MENU (M7 H3): the host's dropdown opened over the frame — its item's press is the host's, the frame hears nothing; before H3 the frame took it; a menu never opened proves nothing", () => {
    expect(
      judgeFrameMenu({
        opened: true,
        hostHeard: ["pointerdown #mi", "mousedown #mi", "mouseup #mi", "click #mi"],
        frameHeard: [],
      }),
    ).toEqual([]);
    expect(
      judgeFrameMenu({
        opened: true,
        hostHeard: [],
        frameHeard: ["pointerdown #r", "mousedown #r", "click #r"],
      }),
    ).toEqual([
      "FRAME-MENU: the host heard nothing — not its menu item's press",
      "FRAME-MENU: the frame heard pointerdown #r, mousedown #r, click #r — the item's press went INTO the frame under the menu",
    ]);
    expect(judgeFrameMenu({ opened: false, hostHeard: [], frameHeard: [] })).toEqual([
      "FRAME-MENU: the host's menu never opened over the frame — the row proved nothing",
    ]);
  });

  it("FRAME-TOUCH (M22 D1): a tap aimed through the page's VISUAL viewport (a phone's page that overflows its layout shows 402 of its 800) lands on the frame's button, where the hand's own mapping put it — the page's own taps on its ground beside the frame landing where aimed (its session's: M22-3); a tap on the host's ground, never the frame's: its click proved nothing", () => {
    const device = {
      frame: { ua: "iPhone/26", touch: 5, dark: false },
      host: { ua: "iPhone/26", touch: 5, dark: false },
      systemDark: true,
    };
    const calibration = {
      left: { aimed: [140, 162] as const, clicked: [141, 163] as const },
      right: { aimed: [820, 162] as const, clicked: [821, 163] as const },
      column: { aimed: [250, 560] as const, clicked: [251, 561] as const },
      at: 250,
    };
    const seen = {
      heard: ["pointerdown #b", "touchstart #b", "pointerup #b", "touchend #b", "click #b"],
      clicks: 1,
      device,
      press: { aimed: [90, 42] as const, clicked: [91, 43] as const, hostHeard: [], calibration },
    };
    expect(judgeFrameTouch(seen)).toEqual([]);
    expect(
      judgeFrameTouch({
        ...seen,
        heard: [],
        clicks: 0,
        press: {
          ...seen.press,
          clicked: null,
          calibration: { ...calibration, column: { aimed: [250, 560], clicked: null } },
        },
      }),
    ).toEqual([
      "FRAME-TOUCH: the frame heard nothing — no touch of the phone's finger on its button",
      "FRAME-TOUCH: the tap made no click in the frame",
      "FRAME-TOUCH: the frame heard no click — the press never reached a frame of another site (the host heard nothing)",
    ]);
  });

  it("FRAME-TOUCH: on a phone, the touch's start and end on the frame's button, and its click — and the frame told the PHONE (M6.5b): its own agent, touch points and colours the page's; before M6.5b a laptop's", () => {
    const phone = { ua: "iPhone/26", touch: 5, dark: true };
    const told = { frame: phone, host: phone };
    expect(
      judgeFrameTouch({
        heard: ["pointerdown #b", "touchstart #b", "touchend #b", "click #b"],
        clicks: 1,
        device: told,
      }),
    ).toEqual([]);
    expect(judgeFrameTouch({ heard: [], clicks: 0, device: told })).toEqual([
      "FRAME-TOUCH: the frame heard nothing — no touch of the phone's finger on its button",
      "FRAME-TOUCH: the tap made no click in the frame",
    ]);
    const tap = { heard: ["touchstart #b", "touchend #b"], clicks: 1 };
    expect(
      judgeFrameTouch({
        ...tap,
        device: { frame: { ua: "Macintosh/150", touch: 0, dark: false }, host: phone },
      }),
    ).toEqual([
      'FRAME-TOUCH: the frame was told another agent ("Macintosh/150"), not the page\'s ("iPhone/26")',
      "FRAME-TOUCH: the frame says 0 touch points, the page 5",
      "FRAME-TOUCH: the frame's colour scheme is not the page's (dark false, the page's true)",
    ]);
    expect(judgeFrameTouch({ ...tap, device: { frame: null, host: phone } })).toEqual([
      "FRAME-TOUCH: the frame or its host never said its device — that half proved nothing",
    ]);
    expect(
      judgeFrameTouch({ ...tap, device: { frame: phone, host: { ...phone, touch: 0 } } }),
    ).toEqual([
      "FRAME-TOUCH: the host page was told no touch — not a phone: that half proved nothing",
    ]);
    // M12 J11: the colours prove something only where the page was told colours NOT the system's — a frame told nothing
    // follows the system's
    expect(judgeFrameTouch({ ...tap, device: { ...told, systemDark: false } })).toEqual([]);
    expect(judgeFrameTouch({ ...tap, device: { ...told, systemDark: true } })).toEqual([
      "FRAME-TOUCH: the page was told the system's own colours (dark true) — a frame told nothing would match them: the colour half proved nothing",
    ]);
  });

  it("FRAME-GONE: the frame went elsewhere under a held press; the next press landed in its new document at once — not after waiting on the gone one", () => {
    expect(judgeFrameGone({ went: true, nextClicks: 1, ms: 120 })).toEqual([]);
    expect(judgeFrameGone({ went: true, nextClicks: 0, ms: null })).toEqual([
      "FRAME-GONE: the next press never landed in the frame's new document — the hand stalled on the gone one",
    ]);
    expect(judgeFrameGone({ went: true, nextClicks: 1, ms: FRAMES_ROWS.goneMs + 1 })).toEqual([
      `FRAME-GONE: the next press landed ${FRAMES_ROWS.goneMs + 1} ms after it was sent — it waited on the gone document`,
    ]);
    expect(judgeFrameGone({ went: false, nextClicks: 0, ms: null })).toEqual([
      "FRAME-GONE: the frame never went elsewhere under the held press — the row proved nothing",
    ]);
    // M7 H11: its leg whose frame goes to ANOTHER SITE under the held press — its session swapped
    const landed = { went: true, nextClicks: 1, ms: 120 };
    expect(judgeFrameGone({ ...landed, swap: { went: true, nextClicks: 1, ms: 300 } })).toEqual([]);
    expect(judgeFrameGone({ ...landed, swap: { went: true, nextClicks: 0, ms: null } })).toEqual([
      "FRAME-GONE (to another site — its session swapped): the next press never landed in its new document — the hand stalled on the gone session",
    ]);
    expect(judgeFrameGone({ ...landed, swap: { went: false, nextClicks: 0, ms: null } })).toEqual([
      "FRAME-GONE (to another site — its session swapped): the frame never went there under the held press — that leg proved nothing",
    ]);
  });

  it("FRAME-ZOOMED (M7 H11; M22 D, E; PT-6a ruling 3): a phone host naming no viewport (drawn at 0.41) — a tap into its frame lands where its WHOLE window point pressed, through the pane's own eye (±1: a window px is ~3 of the page's — the aim's rounding judged, never tolerated); run 5's flat aim, as its calibration read it: the aim is off — the click proved nothing; a page at scale 1 proves nothing", () => {
    const ground = (aimed: Point, pressed: Point, clicked: Point) => ({ aimed, pressed, clicked });
    const calibration = {
      left: ground([140, 280], [141.2, 279.1], [141, 279]),
      right: ground([820, 280], [818.9, 281.3], [819, 281]),
      column: ground([698, 560], [697.4, 561.5], [697, 562]),
      at: 698,
    };
    const phone = {
      aimed: [540, 160] as const,
      pressed: [541.4, 158.8] as const,
      // (2, −2 from the aim: within ±1 of where its whole window point pressed)
      clicked: [542, 158] as const,
      hostHeard: [],
      calibration,
      scale: 0.41,
    };
    expect(judgeFrameZoomed({ phone })).toEqual([]);
    expect(judgeFrameZoomed({ phone: { ...phone, clicked: [220, 70] } })).toEqual([
      "FRAME-ZOOMED (a phone, its page at 0.41): the frame's click landed at 220, 70, not where the hand pressed (541.4, 158.8, ±1; the host's calibration beside it within -0.4, 0.5): the routing carried the point elsewhere",
    ]);
    // ±1 of where it pressed — never a window px of the page's (3 at 0.41)
    expect(judgeFrameZoomed({ phone: { ...phone, clicked: [544, 159] } })).toEqual([
      "FRAME-ZOOMED (a phone, its page at 0.41): the frame's click landed at 544, 159, not where the hand pressed (541.4, 158.8, ±1; the host's calibration beside it within -0.4, 0.5): the routing carried the point elsewhere",
    ]);
    // run 5's flat aim at 0.41: its host's own taps missed by −3 … +3, +11
    expect(
      judgeFrameZoomed({
        phone: {
          ...phone,
          calibration: {
            left: { aimed: [140, 280] as const, clicked: [143, 291] as const },
            right: { aimed: [820, 280] as const, clicked: [817, 291] as const },
            column: { aimed: [698, 560] as const, clicked: [696, 571] as const },
            at: 698,
          },
        },
      }),
    ).toEqual([
      "FRAME-ZOOMED (a phone, its page at 0.41): the host's own clicks beside the frame landed 3.0, 11.0 from where the hand pressed them (±1) — the smoke's reading of the hand is off: the click proved nothing",
    ]);
    expect(judgeFrameZoomed({ phone: { ...phone, scale: 1 } })).toEqual([
      "FRAME-ZOOMED (a phone, its page at its own scale): the page stood at scale 1 — not drawn at another: that leg proved nothing",
    ]);
  });

  it("FRAME-PICKER (M2; M7 H11): the nested frame's file input cancelled, nothing chosen — and what can see a native panel: its `cancel` (none heard: a panel may be up), the app's focused window (a panel takes it), a window more (a BrowserWindow panel — a native one is none, so this alone cannot see it)", () => {
    expect(judgeFramePicker({ cancels: 1, changes: 0, raised: 0, focused: [3, 3] })).toEqual([]);
    expect(judgeFramePicker({ cancels: 0, changes: 1, raised: 1, focused: [3, null] })).toEqual([
      "FRAME-PICKER: the nested frame's file input heard no `cancel` — its picker was not intercepted in a frame inside a frame (a panel may be up)",
      "FRAME-PICKER: a file was CHOSEN in the nested frame — a real panel answered",
      "FRAME-PICKER: the app has 1 window it did not have before — a panel opened",
      "FRAME-PICKER: the focused window is none, not 3 as before the press — a panel took the app's focus",
    ]);
    expect(judgeFramePicker({ cancels: null, changes: null, raised: 0, focused: [3, 3] })).toEqual([
      "FRAME-PICKER: the nested frame never said its file input — the row proved nothing",
    ]);
  });

  it("BACK-WRITTEN (ruling 5): after the page's own ‹ the document's url is A again", () => {
    const a = "http://127.0.0.1:1/page?back=a";
    expect(judgeBackWritten({ a, arrived: true, url: a })).toEqual([]);
    expect(judgeBackWritten({ a, arrived: true, url: "http://127.0.0.1:1/next?back=b" })).toEqual([
      `BACK-WRITTEN: after the page's own ‹ the document's url is http://127.0.0.1:1/next?back=b, not ${a} — a page that went back by itself was never written`,
    ]);
    expect(judgeBackWritten({ a, arrived: false, url: null })).toEqual([
      "BACK-WRITTEN: the page never arrived where the document sent it — the row proved nothing",
    ]);
  });

  it("STUCK (ruling 6): the page said stopped responding within the host's bound, and ↻ brings it back; a chain stalled for good says so", () => {
    const reason = "unresponsive: Browser page stopped responding";
    expect(judgeStuck({ hung: true, saidMs: 21_000, reason, reloaded: true })).toEqual([]);
    // a page said stopped for another reason (its process gone) is not this one
    expect(
      judgeStuck({
        hung: true,
        saidMs: 900,
        reason: "stopped: Browser page stopped",
        reloaded: true,
      }),
    ).toEqual([
      "STUCK: the face never said the page stopped responding (it said stopped: Browser page stopped) — the hand's chain stalled behind a command never answered",
    ]);
    expect(judgeStuck({ hung: true, saidMs: null, reason: null, reloaded: false })).toEqual([
      "STUCK: the face never said the page stopped responding (it said nothing) — the hand's chain stalled behind a command never answered",
      "STUCK: ↻ did not bring the page back",
    ]);
    const late = FRAMES_ROWS.hungMs + FRAMES_ROWS.stuckMarginMs + 1;
    expect(judgeStuck({ hung: true, saidMs: late, reason, reloaded: true })).toEqual([
      `STUCK: it was said ${late} ms after the key — past the host's bound (${FRAMES_ROWS.hungMs} ms) and its margin`,
    ]);
    expect(judgeStuck({ hung: false, saidMs: null, reason: null, reloaded: false })).toEqual([
      "STUCK: the page never stopped answering — the row proved nothing",
    ]);
    // M7 H11: ↻ and an address typed WHILE the chain is stalled — never on the hand's chain: they act
    const said = { hung: true, saidMs: 21_000, reason, reloaded: true };
    expect(
      judgeStuck({ ...said, reloadActed: true, typed: { arrived: true, stayed: true } }),
    ).toEqual([]);
    expect(
      judgeStuck({ ...said, reloadActed: false, typed: { arrived: false, stayed: false } }),
    ).toEqual([
      "STUCK: ↻ pressed while the chain was stalled asked nothing of the page (its address not asked again) — it waited behind the stalled chain",
      "STUCK: an address typed while the chain was stalled never took the page there",
    ]);
    expect(
      judgeStuck({ ...said, reloadActed: true, typed: { arrived: true, stayed: false } }),
    ).toEqual([
      "STUCK: the page at the address typed while stalled was said stopped after — the stalled command of the document before outlived it",
    ]);
    expect(judgeStuck({ ...said, reloadActed: null, typed: null })).toEqual([
      "STUCK: its legs while stalled (↻, an address typed) never ran — they proved nothing",
    ]);
    // M20 F6: EACH leg runs (its hang tried again, bounded) — one that never ran proved nothing; no leg passes by timing
    // (runs 2 and 3: one leg each, by chance)
    expect(
      judgeStuck({ ...said, reloadActed: null, typed: { arrived: true, stayed: true } }),
    ).toEqual([
      "STUCK: ↻ while the chain was stalled never ran (the page never hung again) — that leg proved nothing",
    ]);
    expect(judgeStuck({ ...said, reloadActed: true, typed: null })).toEqual([
      "STUCK: an address typed while the chain was stalled never ran (the page never hung again) — that leg proved nothing",
    ]);
    // M12 J11: the legs prove something only with the chain STALLED — a key the hung page never answers sent before them
    // (a press is answered: with nothing in flight they act with or without the let-go)
    const legs = { reloadActed: true, typed: { arrived: true, stayed: true } };
    expect(judgeStuck({ ...said, ...legs, stalled: true })).toEqual([]);
    expect(judgeStuck({ ...said, ...legs, stalled: false })).toEqual([
      "STUCK: its legs while stalled (↻, an address typed) ran with nothing of the hand in flight (main's count) — no command left unanswered: they proved nothing",
    ]);
  });

  it("PT-6a (K1) FRAME-BUSY: on a page holding an ad-like frame of another site, busy after a press (a laptop's) or a tap (a phone's) on its own field, the keys typed meanwhile land in ORDER — refused or lost, said; a page that never got busy, or a field never aimed at, proves nothing", () => {
    const spun = { spins: [[100, 1500, "press"] as const], timers: [1601], clicks: [60] };
    const ok = { typed: "abc", field: "abc", busy: spun, held: true };
    expect(judgeFrameBusy({ press: ok, tap: { ...ok, held: false } })).toEqual([]);
    expect(judgeFrameBusy({ press: { ...ok, field: "" }, tap: { ...ok, field: "bc" } })).toEqual([
      'FRAME-BUSY (press): the keys typed while the page was busy after a press on its field landed as "", not "abc" in order — refused, or lost',
      'FRAME-BUSY (tap): the keys typed while the page was busy after a tap on its field landed as "bc", not "abc" in order — refused, or lost',
    ]);
    expect(
      judgeFrameBusy({ press: { ...ok, busy: { spins: [], timers: [], clicks: [] } }, tap: null }),
    ).toEqual([
      "FRAME-BUSY (press): the page never got busy after a press on its field — the leg proved nothing",
      "FRAME-BUSY (tap): its field could not be aimed at — the leg proved nothing",
    ]);
  });

  it("PT-6a (runs 6–10) FRAME-BUSY's KEY leg: the page busy after a KEY on its own field (its keydown posts the task) — its keys land in order, judged as the press's and the tap's are; `held` is said, never required (no leg can force K1's order: run 10)", () => {
    const keyed = {
      spins: [[200, 1500, "key"] as const],
      timers: [201],
      clicks: [120],
      keys: [190],
    };
    const key = { typed: "abc", field: "abc", busy: keyed, held: false };
    const spun = { spins: [[100, 1500, "press"] as const], timers: [101], clicks: [60] };
    const ok = { typed: "abc", field: "abc", busy: spun, held: false };
    // run 10, as main saw it: the page's word before its task — the keys in order, K1 not reached: green
    expect(judgeFrameBusy({ press: ok, tap: ok, key })).toEqual([]);
    expect(judgeFrameBusy({ press: ok, tap: ok, key: { ...key, held: true } })).toEqual([]);
    expect(judgeFrameBusy({ press: ok, tap: ok, key: { ...key, field: "" } })).toEqual([
      'FRAME-BUSY (key): the keys typed while the page was busy after a key on its field landed as "", not "abc" in order — refused, or lost',
    ]);
    expect(
      judgeFrameBusy({
        press: ok,
        tap: ok,
        key: { ...key, busy: { spins: [], timers: [], clicks: [], keys: [] } },
      }),
    ).toEqual([
      "FRAME-BUSY (key): the page never got busy after a key on its field — the leg proved nothing",
    ]);
    expect(judgeFrameBusy({ press: ok, tap: ok, key: null })).toEqual([
      "FRAME-BUSY (key): its field could not be aimed at — the leg proved nothing",
    ]);
  });

  it("PT-6a (K1, the engine's fact) PRESS-ANSWER: judged only for having MEASURED — the page's own mousedown ran and main's count was read; how long the press waited is the fact, said", () => {
    expect(judgePressAnswer({ down: [100, 3000], answerMs: 3010, lookMs: 20 })).toEqual([]);
    expect(judgePressAnswer({ down: [100, 3000], answerMs: 0, lookMs: 20 })).toEqual([]);
    expect(judgePressAnswer({ down: null, answerMs: 0, lookMs: 20 })).toEqual([
      "PRESS-ANSWER: the page's own mousedown never ran — the press proved nothing",
    ]);
    expect(judgePressAnswer({ down: [100, 3000], answerMs: null, lookMs: 20 })).toEqual([
      "PRESS-ANSWER: main's count was never read — the row proved nothing",
    ]);
    expect(judgePressAnswer(null)).toEqual([
      "PRESS-ANSWER: the page's button could not be aimed at — the row proved nothing",
    ]);
  });
});
