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
  judgeStuck,
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

  it("FRAME-HOVER: a pointer over the frame's link, not off it", () => {
    expect(judgeFrameHover({ over: "pointer", off: "default" })).toEqual([]);
    expect(judgeFrameHover({ over: null, off: "pointer" })).toEqual([
      "FRAME-HOVER: over the frame's link the cursor is nothing, not a pointer — the hover never reached the frame",
      "FRAME-HOVER: off the link the cursor is still a pointer — the hover's leave never reached the frame",
    ]);
  });

  it("FRAME-DOUBLE: the frame's word selected", () => {
    expect(judgeFrameDouble({ sel: `${FRAMES_WORD} ` })).toEqual([]);
    expect(judgeFrameDouble({ sel: "" })).toEqual([
      `FRAME-DOUBLE: a double-click selected "" in the frame, not "${FRAMES_WORD}" — its count never reached it`,
    ]);
  });

  it("FRAME-DRAG: the thumb moved, and after a release OUTSIDE the frame its next move holds no button; a drag that never reached it, or a button left down, says so", () => {
    expect(judgeFrameDrag({ before: 10, after: 84, buttonsAfter: 0 })).toEqual([]);
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

  it("FRAME-TYPE: the text and the composition in the frame's field, the caret after them — and no key heard by the HOST meanwhile (M7 H2: one there went down the page's session with the frame focused)", () => {
    const want = FRAMES_ROWS.typed + FRAMES_ROWS.composed;
    expect(judgeFrameType({ field: want, caret: want.length, hostHeard: [] })).toEqual([]);
    expect(judgeFrameType({ field: "", caret: 0, hostHeard: [] })).toEqual([
      `FRAME-TYPE: the frame's field holds "", not ${JSON.stringify(want)} — the keys never reached the frame`,
    ]);
    expect(judgeFrameType({ field: want, caret: 0, hostHeard: [] })).toEqual([
      `FRAME-TYPE: the frame's caret stands at 0, not after what was typed (${want.length})`,
    ]);
    expect(
      judgeFrameType({
        field: want,
        caret: want.length,
        hostHeard: ["pointerdown #f", "keydown h", "keydown é"],
      }),
    ).toEqual([
      "FRAME-TYPE: the host page heard 2 key(s) while the frame's field was typed in (keydown h, keydown é) — they went down the page's session with a frame of another site focused (M3's banned path)",
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
  });

  it("FRAME-PICKER (M2): the nested frame's file input cancelled, nothing chosen, main's windows as they were", () => {
    expect(judgeFramePicker({ cancels: 1, changes: 0, windows: [1, 1] })).toEqual([]);
    expect(judgeFramePicker({ cancels: 0, changes: 1, windows: [1, 2] })).toEqual([
      "FRAME-PICKER: the nested frame's file input heard no `cancel` — its picker was not intercepted in a frame inside a frame",
      "FRAME-PICKER: a file was CHOSEN in the nested frame — a real panel answered",
      "FRAME-PICKER: main's windows went from 1 to 2 — a panel opened",
    ]);
    expect(judgeFramePicker({ cancels: null, changes: null, windows: [1, 1] })).toEqual([
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
  });
});
