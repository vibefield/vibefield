/**
 * PT-3 — the page in use in the product (testing/smoke-use-pane.ts): the judges the use rows hold the product to — HELD-CLICK,
 * DOUBLE, WHEEL, KEYS, IME, CURSOR, TOOLS, ESC and IDLE — each passing what the product should do and failing, in words with its
 * numbers, what it should not; and where a point of the page stands on the window with the pane in hand.
 */
import { describe, expect, it } from "vitest";
import {
  CURRENT_AT,
  judgeClick,
  judgeCursor,
  judgeDouble,
  judgeEdit,
  judgeEsc,
  judgeIdle,
  judgeIme,
  judgeKeys,
  judgeTools,
  judgeWheel,
  pageOnWindow,
  USE_ROWS,
  type UseSeen,
} from "../src/testing/smoke-use-pane";

const ORIGIN = "http://127.0.0.1:50123";

describe("the page in use — its rows", () => {
  it("CURRENT_AT (PT-5d, G6): a press after a navigation waits for a frame of the document NOW at the address the row just sent the pane to — `current` at another address (the desk has not heard the commit: the document before's frame), or not current, is not it", () => {
    const sent = "http://127.0.0.1:4321/acts?visit=2";
    const at = (faces: readonly unknown[]): boolean =>
      new Function("globalThis", `return ${CURRENT_AT("k", sent)};`)({
        __vfDesk: { live: () => ({ faces }) },
      }) as boolean;
    expect(at([{ key: "k", current: true, info: { address: sent } }])).toBe(true);
    expect(
      at([{ key: "k", current: true, info: { address: "http://127.0.0.1:4321/acts?visit=1" } }]),
    ).toBe(false);
    expect(at([{ key: "k", current: false, info: { address: sent } }])).toBe(false);
    expect(at([{ key: "k", current: true, info: {} }])).toBe(false);
    expect(at([{ key: "other", current: true, info: { address: sent } }])).toBe(false);
    expect(at([])).toBe(false);
  });

  it("HELD-CLICK: the page, its address and its url at /next; ⌘Z takes the desk's edit back, never the page's navigation", () => {
    const ok: UseSeen["click"] = {
      path: "/next",
      address: `${ORIGIN}/next`,
      url: `${ORIGIN}/next`,
      undone: { undos: 1, finish: "low-iron", path: "/next", url: `${ORIGIN}/next` },
    };
    expect(judgeClick(ok)).toEqual([]);
    // the finish unset after the undo is the type's default — taken back
    expect(judgeClick({ ...ok, undone: { ...ok.undone, finish: null } })).toEqual([]);
    expect(judgeClick({ ...ok, path: "/page" })).toEqual([
      "HELD-CLICK: the page is at /page, not /next",
    ]);
    expect(judgeClick({ ...ok, address: `${ORIGIN}/page` })[0]).toMatch(
      /the face says .*\/page, not the page's \/next/,
    );
    expect(judgeClick({ ...ok, url: `${ORIGIN}/page` })[0]).toMatch(
      /the url prop is .*\/page, not the page's \/next/,
    );
    expect(judgeClick({ ...ok, url: null })[0]).toMatch(/the url prop is unset/);
    expect(judgeClick({ ...ok, undone: { ...ok.undone, undos: 4, finish: "float" } })).toEqual([
      "HELD-CLICK: 4 ⌘Z left the finish float, never taking back the desk's last edit",
    ]);
    // the url taken back by ⌘Z — the page sent back with it
    expect(
      judgeClick({ ...ok, undone: { ...ok.undone, path: "/page", url: `${ORIGIN}/page` } }),
    ).toEqual([
      `HELD-CLICK: ⌘Z sent the page back (at /page, url ${ORIGIN}/page) — a page's navigation is not a desk edit`,
    ]);
    // the url alone taken back (the page not yet followed) is as wrong
    expect(judgeClick({ ...ok, undone: { ...ok.undone, url: `${ORIGIN}/page` } })[0]).toMatch(
      /⌘Z sent the page back/,
    );
  });

  it("DOUBLE: the word selected (as the platform says it, a space aside); the pane still in hand", () => {
    expect(judgeDouble({ sel: "portals", held: true })).toEqual([]);
    expect(judgeDouble({ sel: "portals ", held: true })).toEqual([]);
    expect(judgeDouble({ sel: "", held: true })).toEqual([
      'DOUBLE: the page selected "", not "portals"',
    ]);
    expect(judgeDouble({ sel: null, held: true })[0]).toMatch(/selected null/);
    expect(judgeDouble({ sel: "alpha portals omega", held: true })[0]).toMatch(/not "portals"/);
    expect(judgeDouble({ sel: "portals", held: false })).toEqual([
      "DOUBLE: the double-click put the pane down",
    ]);
  });

  it("WHEEL: the page scrolls by the finger's travel in its own px; never by the travel's device px, never the hand panning", () => {
    const ok: UseSeen["wheel"] = {
      travel: 240,
      pagePerScreen: 1.6,
      scrollY: 384,
      panned: false,
      held: true,
    };
    expect(judgeWheel(ok)).toEqual([]);
    expect(judgeWheel({ ...ok, scrollY: 384 * 1.2 })).toEqual([]);
    // twice (a density applied twice) and half (CSS px sent where CDP wanted device px) are both refused
    expect(judgeWheel({ ...ok, scrollY: 768 })).toEqual([
      "WHEEL: the page scrolled 768 px for the finger's 240 px, not ~384 (that travel in its px)",
    ]);
    expect(judgeWheel({ ...ok, scrollY: 192 })[0]).toMatch(/scrolled 192 px/);
    // the travel unconverted (screen px sent as page px)
    expect(judgeWheel({ ...ok, scrollY: 240 })[0]).toMatch(/scrolled 240 px/);
    expect(judgeWheel({ ...ok, scrollY: null })).toEqual(["WHEEL: the page said no scroll"]);
    expect(judgeWheel({ ...ok, travel: 0 })).toEqual(["WHEEL: the window saw no wheel travel"]);
    expect(judgeWheel({ ...ok, panned: true })).toEqual([
      "WHEEL: the hand panned for a wheel over the page",
    ]);
    expect(judgeWheel({ ...ok, held: false })).toEqual(["WHEEL: the wheel put the pane down"]);
  });

  it("KEYS: the field focused, holding exactly what was typed, its form submitted by ⏎ — a letter lost, doubled, a slip kept, the focus elsewhere, no submit refused", () => {
    expect(judgeKeys({ field: USE_ROWS.typed, focused: "field", submitted: 1 })).toEqual([]);
    expect(judgeKeys({ field: "hhello portals", focused: "field", submitted: 1 })).toEqual([
      'KEYS: the field holds "hhello portals", not "hello portals"',
    ]);
    expect(judgeKeys({ field: "hello portal", focused: "field", submitted: 1 })[0]).toMatch(
      /holds "hello portal"/,
    );
    expect(judgeKeys({ field: "", focused: "", submitted: 1 })).toEqual([
      'KEYS: the page\'s focus is "", not its field',
      'KEYS: the field holds "", not "hello portals"',
    ]);
    // the slip kept (⌫ never reached the page), and ⏎ that submitted nothing
    expect(judgeKeys({ field: "hello portalzs", focused: "field", submitted: 1 })[0]).toMatch(
      /holds "hello portalzs"/,
    );
    expect(judgeKeys({ field: USE_ROWS.typed, focused: "field", submitted: 0 })).toEqual([
      "KEYS: ⏎ in the field did not submit its form",
    ]);
  });

  it("IME: the composition committed after what was typed — the preedit left, or the commit doubled, refused", () => {
    expect(judgeIme({ field: "hello portals日本" })).toEqual([]);
    expect(judgeIme({ field: "hello portalsにほ" })).toEqual([
      'IME: the field holds "hello portalsにほ", not "hello portals日本"',
    ]);
    expect(judgeIme({ field: "hello portals日本日本" })[0]).toMatch(/日本日本/);
    expect(judgeIme({ field: null })[0]).toMatch(/holds null/);
  });

  it("CURSOR: the page's pointer over its link and its text cursor over its field — never the desk's own", () => {
    expect(judgeCursor({ link: "pointer", field: "text" })).toEqual([]);
    expect(judgeCursor({ link: "grab", field: "text" })).toEqual([
      'CURSOR: over the link the window shows "grab", not "pointer"',
    ]);
    expect(judgeCursor({ link: "pointer", field: "default" })).toEqual([
      'CURSOR: over the field the window shows "default", not "text"',
    ]);
  });

  it("TOOLS: back, reload, the address over the capsule and gone to, Esc back to the page — each refused alone", () => {
    const ok: UseSeen["tools"] = {
      back: "/page",
      reload: { before: 3, after: 4 },
      editor: { value: `${ORIGIN}/page`, overCapsule: true },
      typed: USE_ROWS.typedPath,
      escHeld: true,
      escValue: "",
    };
    expect(judgeTools(ok)).toEqual([]);
    expect(judgeTools({ ...ok, back: "/next" })).toEqual([
      "TOOLS: ‹ left the page at /next, not /page",
    ]);
    expect(judgeTools({ ...ok, reload: { before: 3, after: 3 } })).toEqual([
      "TOOLS: ↻ did not reload the page (3 → 3 loads)",
    ]);
    expect(judgeTools({ ...ok, editor: { value: "", overCapsule: true } })).toEqual([
      "TOOLS: ⌘L's editor holds \"\", not the page's address",
    ]);
    expect(judgeTools({ ...ok, editor: { value: null, overCapsule: false } })).toEqual([
      "TOOLS: ⌘L's editor holds null, not the page's address",
      "TOOLS: ⌘L's editor does not stand over the head's capsule",
    ]);
    expect(judgeTools({ ...ok, typed: "/page" })).toEqual([
      "TOOLS: the typed address took the page to /page, not /next?typed=1",
    ]);
    expect(judgeTools({ ...ok, escHeld: false })).toEqual([
      "TOOLS: Esc in the address put the pane down — it returns to the page",
    ]);
    expect(judgeTools({ ...ok, escValue: `${ORIGIN}/next?typed=1` })[0]).toMatch(
      /after Esc the editor holds/,
    );
  });

  it("EDIT: the page's own chords — ⌘A then a letter replaces the field, ⌘Z takes it back; a chord the page never heard refused", () => {
    expect(judgeEdit({ replaced: "x", undone: "abc" })).toEqual([]);
    expect(judgeEdit({ replaced: "abcx", undone: "abc" })).toEqual([
      'EDIT: ⌘A then "x" left the field "abcx", not "x" — the page selected nothing',
    ]);
    expect(judgeEdit({ replaced: "x", undone: "x" })).toEqual([
      'EDIT: ⌘Z left the field "x", not "abc" — the page\'s own undo',
    ]);
    expect(judgeEdit({ replaced: null, undone: null })).toHaveLength(2);
  });

  it("ESC: one press puts the pane down", () => {
    expect(judgeEsc({ down: true })).toEqual([]);
    expect(judgeEsc({ down: false })).toEqual(["ESC: one Esc did not put the pane down"]);
  });

  it("IDLE: a still page in hand draws, submits and receives nothing over the watch — a short watch refused too", () => {
    const ok: UseSeen["idle"] = { ms: 1210, frames: 0, submits: 0, arrivals: 0 };
    expect(judgeIdle(ok)).toEqual([]);
    expect(judgeIdle({ ...ok, frames: 3 })).toEqual([
      "IDLE: the desk drew 3 frames of a still page in hand",
    ]);
    expect(judgeIdle({ ...ok, submits: 2 })).toEqual([
      "IDLE: the desk submitted 2 times for a still page in hand",
    ]);
    expect(judgeIdle({ ...ok, arrivals: 5 })).toEqual(["IDLE: 5 frames arrived from a still page"]);
    expect(judgeIdle({ ...ok, ms: 900 })).toEqual(["IDLE: watched 900 ms, under 1200"]);
  });
});

describe("a point of the page on the window, the pane in hand", () => {
  it("stands the page at the open extent's foot, as wide as it, by the page's own aspect", () => {
    // an extent 800 × 600 on screen, centred at (500, 400) in a desk 20 px from the window's left, 40 from its top; a 1280 × 800 page
    const f = { cx: 500, cy: 400, hx: 400, hy: 300 };
    const off = { left: 20, top: 40 };
    const k = 800 / 1280;
    // the page's top-left: the extent's left; its foot the extent's
    expect(pageOnWindow(f, [1280, 800], off, 0, 0)).toEqual({ x: 120, y: 40 + 700 - 800 * k });
    expect(pageOnWindow(f, [1280, 800], off, 1280, 800)).toEqual({ x: 920, y: 740 });
    expect(pageOnWindow(f, [1280, 800], off, 640, 400)).toEqual({ x: 520, y: 740 - 400 * k });
    // the head is the extent above the page: never under a point of the page
    expect(pageOnWindow(f, [1280, 800], off, 0, 0).y).toBeGreaterThan(40 + 400 - 300);
  });
});
