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
  judgeBackWritten,
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
  judgeStood,
  judgeStuck,
  visibleView,
} from "../src/testing/smoke-frames";

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
      "FRAME-PRESS: the frame's click landed at 96, 42, not where the hand pressed (90, 42, ±1)",
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
      "FRAME-PRESS (its own site's frame in it): the frame's click landed at 17, 7, not where the hand pressed (70, 30, ±1)",
    ]);
  });

  it("FRAME-PRESS (M15 A, M18) — a frame's click judged against the HAND's own mapping: the host's calibration left and right of the frame at the frame point's height, its errors interpolated to the point's x, ±1; a side never heard: the click proved nothing", () => {
    // run 2's numbers: the host's own clicks miss by +4, +2 left of the frame and −2, +2 right of it
    const calibration = (at: number, y: number) => ({
      left: { aimed: [140, y] as const, clicked: [144, y + 2] as const },
      right: { aimed: [820, y] as const, clicked: [818, y + 2] as const },
      at,
    });
    // F's button at the host's x 250: the mapping's error there +3.0, +2.0 — its click at 93, 44 is where the hand put it
    expect(
      judgeFramePress("FRAME-PRESS", {
        aimed: [90, 42],
        clicked: [93, 44],
        hostHeard: [],
        calibration: calibration(250, 162),
      }),
    ).toEqual([]);
    // its own-site child's at the host's x 700: −0.9, +2.0 — 69, 32 is where the hand put it
    expect(
      judgeFramePress("FRAME-PRESS (its own site's frame in it)", {
        aimed: [70, 30],
        clicked: [69, 32],
        hostHeard: [],
        calibration: calibration(700, 170),
      }),
    ).toEqual([]);
    // a click 3 px from where the hand's mapping put it: the routing's
    expect(
      judgeFramePress("FRAME-PRESS", {
        aimed: [90, 42],
        clicked: [96, 44],
        hostHeard: [],
        calibration: calibration(250, 162),
      }),
    ).toEqual([
      "FRAME-PRESS: the frame's click landed at 96, 44, not where the hand's own mapping put the aim 90, 42 (93.0, 44.0 — the host's calibration beside it missed by 3.0, 2.0; ±1): the routing carried the point elsewhere",
    ]);
    // a calibration side never heard; none taken
    expect(
      judgeFramePress("FRAME-PRESS", {
        aimed: [90, 42],
        clicked: [93, 44],
        hostHeard: [],
        calibration: { ...calibration(250, 162), right: { aimed: [820, 162], clicked: null } },
      }),
    ).toEqual([
      "FRAME-PRESS: the host's calibration beside the frame never landed — the click proved nothing",
    ]);
    expect(
      judgeFramePress("FRAME-PRESS", {
        aimed: [90, 42],
        clicked: [93, 44],
        hostHeard: [],
        calibration: null,
      }),
    ).toEqual([
      "FRAME-PRESS: the host's calibration beside the frame never landed — the click proved nothing",
    ]);
  });

  it("FRAME-PRESS (M22 A, refined) — the x error measured by a host-ground press at the press's SAME window x (below the frame), the y error by presses left and right at its SAME window y: the window's quantisation is the press's own column's and row's — run 5's own-site child (68 for an interpolated 69.1) lands where its column put it", () => {
    // run 5's child S at the host's x 700: the line between +4 and −2 says −0.9 there; its own column's press says −2
    const refined = {
      left: { aimed: [140, 170] as const, clicked: [144, 172] as const },
      right: { aimed: [820, 170] as const, clicked: [818, 172] as const },
      column: { aimed: [700, 560] as const, clicked: [698, 562] as const },
      at: 700,
    };
    expect(
      judgeFramePress("FRAME-PRESS (its own site's frame in it)", {
        aimed: [70, 30],
        clicked: [68, 32],
        hostHeard: [],
        calibration: refined,
      }),
    ).toEqual([]);
    // a side out of the page's view, not pressed (FRAME-TOUCH's phone shows 402 of its host's 800): the row's y from the other
    expect(
      judgeFramePress("FRAME-PRESS (its own site's frame in it)", {
        aimed: [70, 30],
        clicked: [68, 32],
        hostHeard: [],
        calibration: { ...refined, right: null },
      }),
    ).toEqual([]);
    // the column's press never heard: the click proved nothing
    expect(
      judgeFramePress("FRAME-PRESS (its own site's frame in it)", {
        aimed: [70, 30],
        clicked: [68, 32],
        hostHeard: [],
        calibration: { ...refined, column: { aimed: [700, 560], clicked: null } },
      }),
    ).toEqual([
      "FRAME-PRESS (its own site's frame in it): the host's calibration beside the frame never landed — the click proved nothing",
    ]);
    // a click 2 px from where its column put it: the routing's
    expect(
      judgeFramePress("FRAME-PRESS (its own site's frame in it)", {
        aimed: [70, 30],
        clicked: [66, 32],
        hostHeard: [],
        calibration: refined,
      }),
    ).toEqual([
      "FRAME-PRESS (its own site's frame in it): the frame's click landed at 66, 32, not where the hand's own mapping put the aim 70, 30 (68.0, 32.0 — the host's calibration beside it missed by -2.0, 2.0; ±1): the routing carried the point elsewhere",
    ]);
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
    expect(visibleView({ view: [800, 1739], vv: [1, 0, 0, 402, 874] })).toEqual([402, 874]);
    expect(visibleView({ view: [980, 2130], vv: [0.41, 0, 0, 980, 2130] })).toEqual([980, 2130]);
    expect(visibleView({ view: [1280, 800], vv: [1, 0, 0] })).toEqual([1280, 800]);
    expect(visibleView({ view: [1280, 800] })).toEqual([1280, 800]);
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

  it("FRAME-WHEEL: the frame's scroller scrolled, and past its end the host page", () => {
    expect(judgeFrameWheel({ scroller: [0, 1020], host: [0, 400] })).toEqual([]);
    expect(judgeFrameWheel({ scroller: [0, 0], host: [0, 0] })).toEqual([
      "FRAME-WHEEL: the frame's scroller stood at 0 (from 0) — the wheel never reached the frame",
      "FRAME-WHEEL: past the scroller's end the host stood at 0 (from 0) — the wheel did not chain to the page",
    ]);
    expect(judgeFrameWheel({ scroller: [null, 0], host: [0, 0] })).toEqual([
      "FRAME-WHEEL: the scroller or the host never said its scroll — the row proved nothing",
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

  it("FRAME-ZOOMED (M7 H11; M22 D, E): a phone host naming no viewport (drawn at 0.41) — a tap into its frame lands on its target, judged against the hand's own mapping (A's calibration, ±1); a page at scale 1 proves nothing; the desk's leg is gone (E: no door gives a laptop's page a scale — carried to PT-6)", () => {
    // run 5's tap at 0.41: on bm at 538, 171 — its column and row on the host missing by -2, +11 (a window px ≈ 4 of the page's)
    const calibration = {
      left: { aimed: [140, 280] as const, clicked: [143, 291] as const },
      right: { aimed: [820, 280] as const, clicked: [817, 291] as const },
      column: { aimed: [698, 560] as const, clicked: [696, 571] as const },
      at: 698,
    };
    const phone = {
      aimed: [540, 160] as const,
      clicked: [538, 171] as const,
      hostHeard: [],
      calibration,
      scale: 0.41,
    };
    expect(judgeFrameZoomed({ phone })).toEqual([]);
    expect(judgeFrameZoomed({ phone: { ...phone, clicked: [220, 70] } })).toEqual([
      "FRAME-ZOOMED (a phone, its page at 0.41): the frame's click landed at 220, 70, not where the hand's own mapping put the aim 540, 160 (538.0, 171.0 — the host's calibration beside it missed by -2.0, 11.0; ±1): the routing carried the point elsewhere",
    ]);
    // calibrated, the tolerance is A's ±1 — never a window px of the page's (3 at 0.41)
    expect(judgeFrameZoomed({ phone: { ...phone, clicked: [540, 173] } })).toEqual([
      "FRAME-ZOOMED (a phone, its page at 0.41): the frame's click landed at 540, 173, not where the hand's own mapping put the aim 540, 160 (538.0, 171.0 — the host's calibration beside it missed by -2.0, 11.0; ±1): the routing carried the point elsewhere",
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
      "STUCK: its legs while stalled (↻, an address typed) ran with nothing in flight — no key left unanswered: they proved nothing",
    ]);
  });
});
