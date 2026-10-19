// @vitest-environment happy-dom
/**
 * THE DECK'S EDGE (DESIGN.md §8, 2026-09-28): the terminal deck is a sheet
 * over the monitor, and its top edge moves.
 *
 * The layout is the stylesheet's (`godview.css` reads one custom property), so
 * this fixture emulates that one rule in the only place happy-dom lays anything
 * out — `getBoundingClientRect` — and holds the edge to the contract:
 *   1. the bounds: up to the fill line, 104 from the window's top, down
 *      until the deck that is UP would drop under 120 — and a held edge on to
 *      24 short of the panes' foot
 *   2. a drag writes the shift onto the stage's root and nothing else, and the
 *      viewer's position is remembered (and only by the live overlay)
 *   3. the keyboard and a double-click move it the same way, and never
 *      minimize
 *   4. a window that shrinks clamps the edge; one that grows returns it
 *   5. with no monitor there is nothing to move against — no separator
 *   6. the stylesheet places the sheet at its edge and ends the monitor's
 *      field 12 above the edge as last set, and the tokens it reads exist
 *   7. the Lip's look (round 3, GV-D7 and GV-D12): a 30 bar holding the groove
 *      in its pill, on the frame tone, the panes in a well — and the facts the
 *      deck's marker says of the wrapper
 *   8. the edge's outcomes (round 3, W4): let go with less than 120 left, or
 *      flung down, and the terminals go away; otherwise the edge stays and is
 *      remembered. Held past the line, the stage says so. A lost pointer
 *      capture does not end the drag.
 */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { act, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { GodviewDeckState } from "../src/frame/deck-door";
import { DEFAULT_DECK_APPEARANCE } from "../src/godview/deck-appearance";
import {
  clampDeckShift,
  DECK_EDGE_STORAGE_KEY,
  DECK_FILL_LINE,
  DECK_FLING,
  DECK_HELD_LEAST,
  DECK_MIN_HEIGHT,
  DECK_SHIFT_PROPERTY,
  deckEdgeBounds,
  deckEdgeValueText,
  deckLetGo,
  deckShiftForKey,
  FIELD_SHIFT_PROPERTY,
  flingVelocity,
  trustDeckEdgeEventsForTest,
} from "../src/godview/deck-edge";
import { DECK_FALL_MS, DECK_RISE_MS, DECK_TRAVEL_GRACE_MS } from "../src/godview/deck-state";
import {
  godviewTerminalGroundStyle,
  godviewTerminalTheme,
  terminalGround,
} from "../src/godview/deck-theme";
import {
  getDeckWrapperFacts,
  resetDeckWrapperFactsForTest,
} from "../src/godview/deck-wrapper-witness";
import { GodviewStage } from "../src/godview/GodviewStage";
import { GodviewMiniature } from "../src/panels/terminal/GodviewMiniature";
import { BUILTIN_THEMES } from "../src/panels/terminal/theme-view";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const PACKAGE_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

// The emulated window: the bar is 40px, the monitor's tuned height 280px, so
// the deck's top at rest stands 320 from the stage's top — with the bar and
// without it (L8a: the head's height is given back to the monitor's basis).
const BAR = 40;
const REST_MONITOR = 280;
const DECK_REST = BAR + REST_MONITOR;
let windowHeight = 800;
/** Where the monitor's stage begins below the window's top: the bar's 40 today,
 * 0 once the head takes no band (the Stories head). */
let monitorTop = BAR;
/** Whether the emulated monitor stands alone (the terminals away). */
let awayMonitor = false;

function rootShift(element: Element, property: string): number {
  const root = element.closest<HTMLElement>(".vf-godview");
  const raw = root?.style.getPropertyValue(property) ?? "";
  return raw === "" ? 0 : Number.parseFloat(raw);
}
/** The edge as it stands — held or not. */
const appliedShift = (element: Element): number => rootShift(element, DECK_SHIFT_PROPERTY);
/** The edge as last SET — what the monitor's field follows (once per change). */
const fieldShift = (element: Element): number => rootShift(element, FIELD_SHIFT_PROPERTY);

function rect(top: number, height: number): DOMRect {
  return {
    x: 0,
    y: top,
    top,
    left: 0,
    width: 1200,
    height,
    right: 1200,
    bottom: top + height,
    toJSON: () => ({}),
  } as DOMRect;
}

// The Lip's height (tokens.css), and what the well keeps clear at its foot.
const LIP = 30;
const WELL_FOOT = 8;

/** A transform on an ancestor — the cover settling from 1.012, the Peek's
 * recede to 0.98 — scales what is PAINTED about the stage's top, never the
 * layout. `getBoundingClientRect` answers the painted box; `offset*` the laid
 * out one. */
let paintedScale = 1;

// `godview.css`'s rules, in the one place happy-dom measures: the sheet stands
// at its edge — rest and the shift — and the monitor's field ends 12 above the
// edge as last set, never above where it ends at rest; the body is the panes in
// the well.
function layout(this: Element): DOMRect {
  if (this.classList.contains("vf-godview")) return rect(0, windowHeight);
  // the stage's probe at the sheet's rest (`.vf-godview-deck-rest`)
  if (this.classList.contains("vf-godview-deck-rest")) return rect(DECK_REST, 0);
  if (this.classList.contains("vf-godview-monitor-stage")) {
    // away, the monitor alone has the window down to the covers' reserve
    if (awayMonitor) return rect(monitorTop, windowHeight - monitorTop - 88);
    const foot = DECK_REST + Math.max(0, fieldShift(this)) - 12;
    return rect(monitorTop, foot - monitorTop);
  }
  const deckTop = DECK_REST + appliedShift(this);
  if (this.classList.contains("vf-godview-terminal-deck")) {
    return rect(deckTop, windowHeight - deckTop);
  }
  if (this.classList.contains("vf-godview-terminal-deck-body")) {
    return rect(deckTop + LIP + 1, windowHeight - deckTop - LIP - WELL_FOOT - 2);
  }
  return rect(0, 0);
}

/** The painted box: the layout, scaled about the stage's top. */
function painted(this: Element): DOMRect {
  const box = layout.call(this);
  if (paintedScale === 1) return box;
  return {
    ...box,
    y: box.top * paintedScale,
    top: box.top * paintedScale,
    width: box.width * paintedScale,
    height: box.height * paintedScale,
    bottom: (box.top + box.height) * paintedScale,
    right: box.width * paintedScale,
    toJSON: () => ({}),
  } as DOMRect;
}

/** The laid-out box, as `offset*` answers it (the stage's root is the offset
 * parent of the deck; the body's is the well, whose top is its own). */
function laidOut(element: Element): { top: number; width: number; height: number } {
  const box = layout.call(element);
  return { top: Math.round(box.top), width: Math.round(box.width), height: Math.round(box.height) };
}

const observers: { callback: ResizeObserverCallback }[] = [];
class FakeResizeObserver {
  readonly callback: ResizeObserverCallback;
  constructor(callback: ResizeObserverCallback) {
    this.callback = callback;
    observers.push(this);
  }
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {
    const index = observers.indexOf(this);
    if (index >= 0) observers.splice(index, 1);
  }
}

function resizeWindow(height: number): void {
  windowHeight = height;
  act(() => {
    for (const observer of [...observers]) {
      observer.callback([], observer as unknown as ResizeObserver);
    }
  });
}

let root: Root | null = null;
let host: HTMLElement;

beforeEach(() => {
  windowHeight = 800;
  monitorTop = BAR;
  awayMonitor = false;
  localStorage.clear();
  resetDeckWrapperFactsForTest();
  paintedScale = 1;
  vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(painted);
  vi.spyOn(HTMLElement.prototype, "offsetTop", "get").mockImplementation(function (
    this: HTMLElement,
  ) {
    return laidOut(this).top;
  });
  vi.spyOn(HTMLElement.prototype, "offsetWidth", "get").mockImplementation(function (
    this: HTMLElement,
  ) {
    return laidOut(this).width;
  });
  vi.spyOn(HTMLElement.prototype, "offsetHeight", "get").mockImplementation(function (
    this: HTMLElement,
  ) {
    return laidOut(this).height;
  });
  vi.stubGlobal("ResizeObserver", FakeResizeObserver);
  const proto = HTMLElement.prototype as unknown as Record<string, unknown>;
  const captured = new Set<number>();
  proto["setPointerCapture"] = (id: number) => captured.add(id);
  proto["releasePointerCapture"] = (id: number) => captured.delete(id);
  proto["hasPointerCapture"] = (id: number) => captured.has(id);
  host = document.createElement("div");
  document.body.append(host);
  // a test's pointer events are synthetic: the edge reads trusted ones only
  trustDeckEdgeEventsForTest(true);
  clock = 1_000;
  vi.spyOn(performance, "now").mockImplementation(() => clock);
});

afterEach(() => {
  act(() => root?.unmount());
  root = null;
  host.remove();
  observers.length = 0;
  trustDeckEdgeEventsForTest(false);
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

/** The page's clock, which the edge reads for a fling (`performance.now`). */
let clock = 1_000;

function Monitor(): ReactElement {
  return <section className="vf-godview-monitor-stage" aria-label="Agent monitor" />;
}

function mount({
  monitor = true,
  persist = true,
  publishesDeck = false,
  edge = true,
  deckState = "up",
  onDeckState,
}: {
  monitor?: boolean;
  persist?: boolean;
  publishesDeck?: boolean;
  edge?: boolean;
  deckState?: GodviewDeckState;
  /** the owner's ear: with it, the terminals can be minimized */
  onDeckState?: (next: GodviewDeckState) => void;
} = {}) {
  root ??= createRoot(host);
  act(() =>
    root?.render(
      <GodviewStage
        open
        theme="light"
        tuningOpen={false}
        animations={false}
        {...(monitor ? { monitor: <Monitor /> } : {})}
        {...(edge ? { deckEdge: { persist } } : {})}
        publishesDeck={publishesDeck}
        deckState={deckState}
        {...(onDeckState !== undefined ? { onDeckState } : {})}
        deck={<p>deck</p>}
      />,
    ),
  );
}

const stageRoot = (): HTMLElement => host.querySelector<HTMLElement>(".vf-godview") as HTMLElement;
const separator = (): HTMLElement | null => host.querySelector<HTMLElement>('[role="separator"]');
const shiftOnRoot = (): string => stageRoot().style.getPropertyValue(DECK_SHIFT_PROPERTY);
const fieldOnRoot = (): string => stageRoot().style.getPropertyValue(FIELD_SHIFT_PROPERTY);
const readout = (): HTMLElement | null =>
  host.querySelector<HTMLElement>(".vf-godview > .vf-godview-deck-readout");
const veil = (): HTMLElement | null =>
  host.querySelector<HTMLElement>(".vf-godview > .vf-godview-deck-veil");

function pointer(type: string, clientY: number): void {
  const target = separator();
  if (target === null) throw new Error("no separator");
  act(() => {
    target.dispatchEvent(
      new PointerEvent(type, { bubbles: true, cancelable: true, clientY, pointerId: 1, button: 0 }),
    );
  });
}

function dragBy(dy: number): void {
  pointer("pointerdown", 400);
  pointer("pointermove", 400 + dy / 2);
  pointer("pointermove", 400 + dy);
  pointer("pointerup", 400 + dy);
}

function key(name: string, shiftKey = false): void {
  const target = separator();
  if (target === null) throw new Error("no separator");
  act(() => {
    target.dispatchEvent(new KeyboardEvent("keydown", { key: name, shiftKey, bubbles: true }));
  });
}

// The lowest a deck that is UP stands: 120 left above the window's foot
// (no reserve outside the cover) — 800 − 120 − 320
const MAX = 800 - DECK_MIN_HEIGHT - DECK_REST;
// the highest an UP deck stands: the fill line, 104 from the window's top — at
// rest it stands at 320, so it rises by 216 (W6; until then the head's reserve,
// 56, and before 2026-10-11 the bar's foot)
const MIN = DECK_FILL_LINE - DECK_REST;
// the lowest a HELD edge goes: 24 short of the panes' foot (round 3, W4)
const HELD = 800 - DECK_HELD_LEAST - DECK_REST;
/** Where the sheet's top stands in the window, from the shift on the root. */
const sheetTop = (): number =>
  DECK_REST + (shiftOnRoot() === "" ? 0 : Number.parseFloat(shiftOnRoot()));

describe("the deck edge's arithmetic", () => {
  it("rises to the fill line — 104 from the window's top — and falls until the deck's minimum; a held edge on to the window's top and to 24 short of the foot", () => {
    expect(DECK_FILL_LINE).toBe(104);
    expect(DECK_MIN_HEIGHT).toBe(120);
    expect(DECK_HELD_LEAST).toBe(24);
    // rest at 320 in an 800 stage with nothing kept under the panes
    expect(deckEdgeBounds({ restTop: 320, height: 800, reserve: 0 })).toEqual({
      min: -216,
      max: 360,
      held: 456,
      top: -320,
    });
    // inside the cover the panes end 88 above the foot (692 in the drawing's 780)
    expect(deckEdgeBounds({ restTop: 300, height: 780, reserve: 88 })).toEqual({
      // the fill line, 104
      min: 104 - 300,
      // held: the window's top, where maximized stands
      top: -300,
      // End: 120 left — 572 in the drawing
      max: 572 - 300,
      // held: 24 short of 692
      held: 692 - 24 - 300,
    });
    for (const restTop of [320, 280, 210]) {
      const { min } = deckEdgeBounds({ restTop, height: 800, reserve: 0 });
      expect(restTop + min, String(restTop)).toBe(104);
    }
    // A window too short for the minimum keeps the resting layout, held too.
    expect(deckEdgeBounds({ restTop: 320, height: 340, reserve: 0 })).toEqual({
      min: -216,
      max: 0,
      held: 0,
      top: -320,
    });
    // …and a monitor so short that rest already stands above the line keeps
    // it too: the line never pushes the edge DOWN from rest
    expect(deckEdgeBounds({ restTop: 40, height: 400, reserve: 0 })).toEqual({
      min: 0,
      max: 240,
      held: 336,
      top: -40,
    });
  });

  it("clamps, rounds and refuses a non-number", () => {
    const bounds = { min: -280, max: 360 };
    expect(clampDeckShift(-999, bounds)).toBe(-280);
    expect(clampDeckShift(999, bounds)).toBe(360);
    expect(clampDeckShift(12.6, bounds)).toBe(13);
    expect(clampDeckShift(Number.NaN, bounds)).toBe(0);
  });

  it("answers the separator's keys and leaves every other key alone — and keys never go past the up deck's least", () => {
    const bounds = { min: -280, max: 360, held: 456, top: -320 };
    expect(deckShiftForKey("ArrowUp", false, 0, bounds)).toBe(-24);
    expect(deckShiftForKey("ArrowDown", true, 0, bounds)).toBe(96);
    expect(deckShiftForKey("Home", false, 0, bounds)).toBe(-280);
    expect(deckShiftForKey("End", false, 0, bounds)).toBe(360);
    expect(deckShiftForKey("ArrowDown", true, 360, bounds)).toBe(360);
    expect(deckShiftForKey("a", false, 0, bounds)).toBeNull();
  });

  it("decides a let-go: less than 120 left goes away, a fling down goes away, above the fill line or a fling up maximizes, anything else stays", () => {
    const bounds = { min: -216, max: 360, held: 456, top: -320 };
    expect(DECK_FLING).toBe(1.4);
    // stays: anywhere the up deck may stand, let go slowly
    for (const shift of [-216, -100, 0, 200, 360]) {
      expect(deckLetGo(shift, bounds, 0), String(shift)).toBe("stays");
    }
    // less than 120 left: away
    expect(deckLetGo(361, bounds, 0)).toBe("away");
    expect(deckLetGo(456, bounds, 0)).toBe("away");
    // a fling decides without the distance: faster than 1.4 px/ms, down
    expect(deckLetGo(0, bounds, 1.41)).toBe("away");
    expect(deckLetGo(0, bounds, 1.4)).toBe("stays");
    // above the fill line: maximized; a fling UP maximizes whatever is above
    expect(deckLetGo(-217, bounds, 0)).toBe("maximized");
    expect(deckLetGo(-320, bounds, 0)).toBe("maximized");
    expect(deckLetGo(-100, bounds, -3)).toBe("maximized");
  });

  it("reads a fling from the last moves and the let-go itself, so a pause before letting go is no fling", () => {
    // 60px in 20ms: 3 px/ms
    expect(
      flingVelocity([
        [0, 400],
        [10, 430],
        [20, 460],
      ]),
    ).toBe(3);
    // the same moves, then held still 300ms before letting go at the same place
    expect(
      flingVelocity([
        [0, 400],
        [10, 430],
        [20, 460],
        [320, 460],
      ]),
    ).toBeLessThan(DECK_FLING);
    // up is negative
    expect(
      flingVelocity([
        [0, 460],
        [20, 400],
      ]),
    ).toBe(-3);
    // nothing to read: no fling
    expect(flingVelocity([[0, 400]])).toBe(0);
    expect(flingVelocity([])).toBe(0);
    expect(
      flingVelocity([
        [5, 400],
        [5, 600],
      ]),
    ).toBe(0);
  });

  it("says where the edge is in words", () => {
    expect(deckEdgeValueText(0)).toBe("at rest");
    expect(deckEdgeValueText(-40)).toBe("over the monitor by 40 pixels");
    expect(deckEdgeValueText(40)).toBe("monitor enlarged by 40 pixels");
  });
});

describe("the deck edge, mounted", () => {
  it("rests with no shift on the root, and is a focusable separator", () => {
    mount();
    expect(shiftOnRoot()).toBe("");
    const edge = separator();
    expect(edge?.getAttribute("aria-orientation")).toBe("horizontal");
    expect(edge?.getAttribute("tabindex")).toBe("0");
    expect(edge?.getAttribute("aria-valuemin")).toBe(String(MIN));
    expect(edge?.getAttribute("aria-valuemax")).toBe(String(MAX));
    // The deck's faces fill a body under the lip, never the section itself.
    expect(host.querySelector(".vf-godview-terminal-deck-body")?.textContent).toBe("deck");
  });

  it("drags up over the monitor, and remembers it", () => {
    mount();
    dragBy(-100);
    expect(shiftOnRoot()).toBe("-100px");
    expect(separator()?.getAttribute("aria-valuenow")).toBe("-100");
    expect(localStorage.getItem(DECK_EDGE_STORAGE_KEY)).toBe("-100");
  });

  it("stops at the fill line going up and at the deck's minimum going down, where nothing can minimize or maximize it", () => {
    // a stage with no owner to ask (a catalog's picture) keeps the up deck's bounds
    mount();
    dragBy(-5_000);
    expect(shiftOnRoot()).toBe(`${MIN}px`);
    expect(sheetTop()).toBe(104);
    dragBy(10_000);
    expect(shiftOnRoot()).toBe(`${MAX}px`);
  });

  it("reaches the same 104 from the window's top when no bar stands above the monitor", () => {
    // The head's owner removes the 40 bar and lets the stage begin at the
    // window's top. The reach is a place in the WINDOW, so it does not move —
    // and neither does rest (L8a: the monitor's basis takes the 40 back).
    monitorTop = 0;
    mount();
    expect(separator()?.getAttribute("aria-valuemin")).toBe(String(MIN));
    dragBy(-5_000);
    expect(sheetTop()).toBe(104);
    key("End");
    key("Home");
    expect(sheetTop()).toBe(104);
    key("ArrowUp", true);
    expect(sheetTop()).toBe(104);
  });

  it("clamps a remembered edge that stood above the fill line, at mount", () => {
    // Left at the bar's foot before 2026-10-11 (−280); the memory is kept, the
    // edge stands at the fill line.
    localStorage.setItem(DECK_EDGE_STORAGE_KEY, String(-REST_MONITOR));
    mount();
    expect(shiftOnRoot()).toBe(`${MIN}px`);
    expect(sheetTop()).toBe(104);
    expect(localStorage.getItem(DECK_EDGE_STORAGE_KEY)).toBe(String(-REST_MONITOR));
  });

  it("keeps the lip clear of the app's drag strip at its highest, with the bar and without", () => {
    // The strip is the window's top 52 (`styles/base.css`, `.app-drag`): inside
    // it the OS moves the window and the page gets no pointer, so a lip that
    // rose into it could not be taken back.
    const base = readFileSync(join(PACKAGE_ROOT, "src/styles/base.css"), "utf8");
    const strip = Number.parseFloat(
      base.match(/^\.app-drag \{[^}]*?\bheight: (\d+)px;/m)?.[1] ?? "NaN",
    );
    expect(strip).toBe(52);
    for (const top of [BAR, 0]) {
      monitorTop = top;
      mount();
      key("Home");
      expect(sheetTop(), `monitor at ${top}`).toBeGreaterThanOrEqual(strip);
      act(() => root?.unmount());
      root = null;
    }
  });

  it("stands where it was left on the next mount", () => {
    localStorage.setItem(DECK_EDGE_STORAGE_KEY, "150");
    mount();
    expect(shiftOnRoot()).toBe("150px");
  });

  it("returns to rest on a double-click, and forgets", () => {
    mount();
    dragBy(-100);
    act(() => {
      separator()?.dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
    });
    expect(shiftOnRoot()).toBe("");
    expect(localStorage.getItem(DECK_EDGE_STORAGE_KEY)).toBeNull();
  });

  it("moves by keyboard: arrows, ⇧ for four steps, Home and End", () => {
    mount();
    key("ArrowDown");
    expect(shiftOnRoot()).toBe("24px");
    key("ArrowUp", true);
    expect(shiftOnRoot()).toBe("-72px");
    key("Home");
    expect(shiftOnRoot()).toBe(`${MIN}px`);
    key("End");
    expect(shiftOnRoot()).toBe(`${MAX}px`);
  });

  it("clamps to a shorter window and returns when it grows back", () => {
    mount();
    dragBy(300);
    expect(shiftOnRoot()).toBe("300px");
    resizeWindow(600); // max = 600 − 40 − 280 − 120 = 160
    expect(shiftOnRoot()).toBe("160px");
    resizeWindow(800);
    expect(shiftOnRoot()).toBe("300px");
  });

  it("remembers nothing when the host says not to (the catalog)", () => {
    mount({ persist: false });
    dragBy(-100);
    expect(shiftOnRoot()).toBe("-100px");
    expect(localStorage.getItem(DECK_EDGE_STORAGE_KEY)).toBeNull();
  });

  it("keeps its minimum above the reserve at the well's foot (the cover's 88)", () => {
    // Inside the frame's cover the well stands 88 above the window's foot
    // (FC-D15), and the deck's 120 stands above that — read off the well, which
    // is what carries the reserve since the panes moved into it.
    const real = window.getComputedStyle.bind(window);
    vi.spyOn(window, "getComputedStyle").mockImplementation((element: Element) => {
      const style = real(element);
      if (!element.classList.contains("vf-godview-deck-well")) return style;
      return new Proxy(style, {
        get: (target, key) => (key === "marginBottom" ? "88px" : Reflect.get(target, key)),
      });
    });
    mount();
    expect(separator()?.getAttribute("aria-valuemax")).toBe(String(MAX - 88));
    dragBy(10_000);
    expect(shiftOnRoot()).toBe(`${MAX - 88}px`);
  });

  it("a stage with no edge draws the Lip as a picture: the groove at rest, and no separator", () => {
    // Settings' miniature: a still of Godview, which wears the groove.
    mount({ edge: false });
    expect(separator()).toBeNull();
    const lip = host.querySelector(".vf-godview-deck-lip");
    expect(lip?.getAttribute("aria-hidden")).toBe("true");
    expect(lip?.querySelector(".vf-godview-deck-grip > .vf-godview-deck-groove")).not.toBeNull();
  });

  it("says the wrapper's facts for the deck's marker: up, where its top is, and each change of the body's box", () => {
    mount({ publishesDeck: true });
    // rest: the deck's top is the bar's 40 and the monitor's 280 below the stage's
    expect(getDeckWrapperFacts()).toEqual({ state: "up", top: 320, bodyResizes: 0 });
    // a re-measure that moved nothing counts nothing
    resizeWindow(800);
    expect(getDeckWrapperFacts()).toEqual({ state: "up", top: 320, bodyResizes: 0 });
    // the window grows: the body's box changed once, the top did not move
    resizeWindow(900);
    expect(getDeckWrapperFacts()).toEqual({ state: "up", top: 320, bodyResizes: 1 });
    // a person's drag resizes as it goes — the count is what a product move
    // will be held to ("one resize per change", the slices to come)
    const before = getDeckWrapperFacts()?.bodyResizes ?? 0;
    dragBy(-100);
    resizeWindow(900); // the observer's turn after the drag's layout
    expect(getDeckWrapperFacts()?.top).toBe(220);
    expect(getDeckWrapperFacts()?.bodyResizes).toBeGreaterThan(before);
    // …and the stage going away withdraws them
    act(() => root?.unmount());
    root = null;
    expect(getDeckWrapperFacts()).toBeNull();
  });

  it("reads the LAYOUT, never the painted box: a transform on an ancestor moves no top and lays nothing out", () => {
    // The cover settles from 1.012 as Godview opens, and the Peek recedes the
    // view to 0.98 while it stands: what is painted is scaled, the box the
    // terminals fill is not. A witness reading the painted box said the deck's
    // top moved 313 → 316 (smoke:godview, 2026-10-11) and would count a resize
    // the terminals never had.
    mount({ publishesDeck: true });
    expect(getDeckWrapperFacts()).toEqual({ state: "up", top: 320, bodyResizes: 0 });
    paintedScale = 1.012;
    resizeWindow(800);
    expect(getDeckWrapperFacts()).toEqual({ state: "up", top: 320, bodyResizes: 0 });
    paintedScale = 0.98;
    resizeWindow(800);
    expect(getDeckWrapperFacts()).toEqual({ state: "up", top: 320, bodyResizes: 0 });
  });

  it("a stage that is not the window's measures nothing for the marker", () => {
    mount();
    resizeWindow(900);
    expect(getDeckWrapperFacts()).toBeNull();
  });

  it("minimize keeps the top: away, the edge is not measured again, and up again it stands where it was left", () => {
    // GV-D6 "as they were left": the edge is the viewer's. Away, the monitor
    // has the window (its box grows), and an edge that kept measuring would
    // re-clamp itself against that and lay the hidden sheet out again — the
    // one thing a minimized deck must not do (§8, one resize per change).
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    mount();
    dragBy(150);
    expect(shiftOnRoot()).toBe("150px");
    mount({ deckState: "away" });
    act(() => {
      vi.advanceTimersByTime(DECK_FALL_MS + DECK_TRAVEL_GRACE_MS);
    });
    // the monitor alone: the window to the covers' reserve, in this emulation
    awayMonitor = true;
    resizeWindow(800);
    resizeWindow(900);
    expect(shiftOnRoot()).toBe("150px");
    expect(localStorage.getItem(DECK_EDGE_STORAGE_KEY)).toBe("150");
    // a call brings it up THERE
    awayMonitor = false;
    mount({ deckState: "up" });
    act(() => {
      vi.advanceTimersByTime(DECK_RISE_MS + DECK_TRAVEL_GRACE_MS);
    });
    resizeWindow(800);
    expect(shiftOnRoot()).toBe("150px");
    expect(sheetTop()).toBe(BAR + REST_MONITOR + 150);
    vi.useRealTimers();
  });

  it("draws no separator and no shift without a monitor", () => {
    localStorage.setItem(DECK_EDGE_STORAGE_KEY, "-100");
    mount({ monitor: false });
    expect(separator()).toBeNull();
    expect(host.querySelector(".vf-godview-deck-lip")?.getAttribute("aria-hidden")).toBe("true");
    expect(shiftOnRoot()).toBe("");
  });
});

describe('the edge\'s outcomes (round 3, W4 — DESIGN.md §8 "A let-go decides")', () => {
  /** What the stage asked its owner for, in order. */
  let asked: GodviewDeckState[] = [];
  const owner = (next: GodviewDeckState): void => {
    asked.push(next);
  };
  beforeEach(() => {
    asked = [];
  });

  /** A held drag on the page's clock: `steps` moves `every` ms apart, then the
   * let-go — `pause` ms after the last move, where the last move was. */
  function hold(dy: number, { steps = 4, every = 100, pause = 16 } = {}): void {
    pointer("pointerdown", 400);
    for (let step = 1; step <= steps; step += 1) {
      clock += every;
      pointer("pointermove", 400 + (dy * step) / steps);
    }
    clock += pause;
    pointer("pointerup", 400 + dy);
  }

  it("less than 120 left goes away — and the place the viewer left the edge is still the one remembered", () => {
    localStorage.setItem(DECK_EDGE_STORAGE_KEY, "100");
    mount({ onDeckState: owner });
    expect(shiftOnRoot()).toBe("100px");
    expect(fieldOnRoot()).toBe("100px");
    // held down to 90 left, let go slowly (0.3 px/ms): away
    hold(MAX - 100 + 30, { steps: 6, every: 100 });
    expect(asked).toEqual(["away"]);
    // the drag that put them away is not a place: the memory and the field
    // still say where the edge was left
    expect(localStorage.getItem(DECK_EDGE_STORAGE_KEY)).toBe("100");
    expect(fieldOnRoot()).toBe("100px");
    // …and the sheet falls at the size it HAS: the held edge is not undone
    expect(shiftOnRoot()).toBe(`${MAX + 30}px`);
  });

  it("a fling past 1.4 px/ms goes away, however much is left", () => {
    mount({ onDeckState: owner });
    // 60 down in 30ms — 2 px/ms — with 300 still left
    hold(60, { steps: 3, every: 10, pause: 0 });
    expect(asked).toEqual(["away"]);
    expect(localStorage.getItem(DECK_EDGE_STORAGE_KEY)).toBeNull();
  });

  it("otherwise it stays, and is remembered — and the monitor's field follows it once, on the let-go, never per frame", () => {
    mount({ onDeckState: owner });
    pointer("pointerdown", 400);
    for (const y of [450, 500, 550, 600]) {
      clock += 100;
      pointer("pointermove", y);
      // the terminals follow the held edge (rows only); the field does not
      expect(fieldOnRoot()).toBe("");
    }
    expect(shiftOnRoot()).toBe("200px");
    clock += 16;
    pointer("pointerup", 600);
    expect(asked).toEqual([]);
    expect(localStorage.getItem(DECK_EDGE_STORAGE_KEY)).toBe("200");
    expect(fieldOnRoot()).toBe("200px");
  });

  it("a pause before letting go is no fling: fast, then held still, then let go, it stays", () => {
    mount({ onDeckState: owner });
    hold(90, { steps: 3, every: 10, pause: 300 });
    expect(asked).toEqual([]);
    expect(localStorage.getItem(DECK_EDGE_STORAGE_KEY)).toBe("90");
  });

  it("a held edge goes on down past the line, and stops 24 short of the panes' foot", () => {
    mount({ onDeckState: owner });
    pointer("pointerdown", 400);
    clock += 100;
    pointer("pointermove", 400 + 10_000);
    expect(shiftOnRoot()).toBe(`${HELD}px`);
    expect(sheetTop()).toBe(800 - 24);
    clock += 100;
    pointer("pointerup", 400 + 10_000);
    expect(asked).toEqual(["away"]);
  });

  it("a lost capture does not end the drag: the moves are read at the window", () => {
    // record §23 "Found while driving it": Chrome dropped the edge's capture
    // after the first move, with no release anywhere
    mount({ onDeckState: owner });
    pointer("pointerdown", 400);
    act(() => {
      separator()?.dispatchEvent(
        new PointerEvent("lostpointercapture", { bubbles: true, pointerId: 1 }),
      );
    });
    // the next moves land wherever the pointer is — here, on the page
    act(() => {
      clock += 100;
      document.body.dispatchEvent(
        new PointerEvent("pointermove", { bubbles: true, clientY: 450, pointerId: 1 }),
      );
    });
    expect(shiftOnRoot()).toBe("50px");
    expect(separator()?.getAttribute("data-dragging")).toBe("true");
    act(() => {
      clock += 100;
      document.body.dispatchEvent(
        new PointerEvent("pointerup", { bubbles: true, clientY: 450, pointerId: 1 }),
      );
    });
    expect(separator()?.hasAttribute("data-dragging")).toBe(false);
    expect(localStorage.getItem(DECK_EDGE_STORAGE_KEY)).toBe("50");
    // another pointer's moves are not this drag's
    pointer("pointerdown", 400);
    act(() => {
      document.body.dispatchEvent(
        new PointerEvent("pointermove", { bubbles: true, clientY: 600, pointerId: 2 }),
      );
    });
    expect(shiftOnRoot()).toBe("50px");
    pointer("pointerup", 400);
  });

  it("reads trusted moves only: a synthetic copy moves nothing", () => {
    trustDeckEdgeEventsForTest(false);
    mount({ onDeckState: owner });
    pointer("pointerdown", 400);
    pointer("pointermove", 500);
    pointer("pointerup", 500);
    expect(shiftOnRoot()).toBe("");
    expect(asked).toEqual([]);
  });

  it("held past the line, the stage says Minimize the terminals over a veil; let go, it goes", () => {
    mount({ onDeckState: owner });
    expect(readout()?.getAttribute("data-on")).toBe("false");
    expect(veil()?.getAttribute("data-on")).toBe("false");
    expect(readout()?.getAttribute("aria-hidden")).toBe("true");
    pointer("pointerdown", 400);
    clock += 100;
    pointer("pointermove", 400 + MAX - 10);
    // above the line: nothing said
    expect(readout()?.getAttribute("data-on")).toBe("false");
    clock += 100;
    pointer("pointermove", 400 + MAX + 10);
    // past it: the verb and the noun
    expect(readout()?.getAttribute("data-on")).toBe("true");
    expect(veil()?.getAttribute("data-on")).toBe("true");
    expect(readout()?.textContent).toBe("Minimize the terminals");
    expect(readout()?.querySelector("i")?.textContent).toBe("Minimize");
    // back above it, held: gone again
    clock += 100;
    pointer("pointermove", 400 + MAX - 10);
    expect(readout()?.getAttribute("data-on")).toBe("false");
    clock += 100;
    pointer("pointermove", 400 + MAX + 40);
    clock += 100;
    pointer("pointerup", 400 + MAX + 40);
    expect(readout()?.getAttribute("data-on")).toBe("false");
    expect(veil()?.getAttribute("data-on")).toBe("false");
    expect(asked).toEqual(["away"]);
  });

  it("let go above the fill line, the terminals maximize — at once, no travel — and the remembered edge stays the viewer's", () => {
    localStorage.setItem(DECK_EDGE_STORAGE_KEY, "100");
    mount({ onDeckState: owner });
    // held up to 20 above the fill line, let go slowly (0.4 px/ms)
    hold(MIN - 100 - 20, { steps: 6, every: 100 });
    expect(asked).toEqual(["maximized"]);
    expect(localStorage.getItem(DECK_EDGE_STORAGE_KEY)).toBe("100");
    expect(fieldOnRoot()).toBe("100px");
    // the owner says it: maximized in one layout, with no travel — the edge was
    // already in the hand (L10)
    mount({ deckState: "maximized", onDeckState: owner });
    expect(stageRoot().getAttribute("data-godview-deck-layout")).toBe("maximized");
    expect(stageRoot().hasAttribute("data-godview-deck-motion")).toBe(false);
  });

  it("a fling up maximizes, however far the fill line is", () => {
    mount({ onDeckState: owner });
    // 60 up in 30ms — 2 px/ms — with the edge still 156 below the line
    hold(-60, { steps: 3, every: 10, pause: 0 });
    expect(asked).toEqual(["maximized"]);
  });

  it("a held edge goes on up past the fill line to the window's top", () => {
    mount({ onDeckState: owner });
    pointer("pointerdown", 400);
    clock += 100;
    pointer("pointermove", 400 - 10_000);
    expect(sheetTop()).toBe(0);
    clock += 100;
    pointer("pointerup", 400 - 10_000);
    expect(asked).toEqual(["maximized"]);
  });

  it("held above the fill line, the stage says Maximize the terminals over the terminals; let go, it goes", () => {
    mount({ onDeckState: owner });
    pointer("pointerdown", 400);
    clock += 100;
    pointer("pointermove", 400 + MIN + 10);
    expect(readout()?.getAttribute("data-on")).toBe("false");
    clock += 100;
    pointer("pointermove", 400 + MIN - 10);
    expect(readout()?.getAttribute("data-on")).toBe("true");
    expect(readout()?.getAttribute("data-readout")).toBe("maximize");
    expect(veil()?.getAttribute("data-readout")).toBe("maximize");
    expect(readout()?.textContent).toBe("Maximize the terminals");
    expect(readout()?.querySelector("i")?.textContent).toBe("Maximize");
    clock += 100;
    pointer("pointerup", 400 + MIN - 10);
    expect(readout()?.getAttribute("data-on")).toBe("false");
    expect(asked).toEqual(["maximized"]);
  });

  it("the maximized grip: a drag out is the sheet again AT ONCE — up from the drag's start — and its let-go decides", () => {
    localStorage.setItem(DECK_EDGE_STORAGE_KEY, "100");
    mount({ onDeckState: owner });
    mount({ deckState: "maximized", onDeckState: owner });
    pointer("pointerdown", 15);
    // a press alone leaves the bar where it is (a double-click's first half)
    expect(asked).toEqual([]);
    clock += 50;
    pointer("pointermove", 16);
    // the door reads up from the start of the drag: the head returns at once,
    // and the sheet stands where the bar was, the window's top, the same box
    expect(asked).toEqual(["up"]);
    expect(sheetTop()).toBe(1);
    mount({ deckState: "up", onDeckState: owner });
    expect(stageRoot().hasAttribute("data-godview-deck-motion")).toBe(false);
    clock += 100;
    pointer("pointermove", 15 + DECK_REST + 50);
    expect(sheetTop()).toBe(DECK_REST + 50);
    clock += 200;
    pointer("pointerup", 15 + DECK_REST + 50);
    // stays, and that is the new place
    expect(asked).toEqual(["up"]);
    expect(localStorage.getItem(DECK_EDGE_STORAGE_KEY)).toBe("50");
  });

  it("a press of the maximized grip that never moves leaves the terminals maximized", () => {
    mount({ onDeckState: owner });
    mount({ deckState: "maximized", onDeckState: owner });
    pointer("pointerdown", 15);
    clock += 80;
    pointer("pointerup", 15);
    expect(asked).toEqual([]);
  });

  it("keys on the maximized grip take the terminals out: to the fill line, or with End to 120 left — never minimize, never maximize", () => {
    mount({ onDeckState: owner });
    mount({ deckState: "maximized", onDeckState: owner });
    key("ArrowDown");
    expect(asked).toEqual(["up"]);
    expect(shiftOnRoot()).toBe(`${MIN}px`);
    mount({ deckState: "maximized", onDeckState: owner });
    key("End");
    expect(asked).toEqual(["up", "up"]);
    expect(shiftOnRoot()).toBe(`${MAX}px`);
    mount({ deckState: "up", onDeckState: owner });
    // up, Home stops at the fill line, ↑ there moves nothing
    key("Home");
    key("ArrowUp", true);
    expect(shiftOnRoot()).toBe(`${MIN}px`);
    expect(asked).toEqual(["up", "up"]);
  });

  it("a double-click on the maximized grip restores the terminals to rest — a fall — and forgets the remembered edge", () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    localStorage.setItem(DECK_EDGE_STORAGE_KEY, "-100");
    mount({ onDeckState: owner });
    mount({ deckState: "maximized", onDeckState: owner });
    act(() => {
      separator()?.dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
    });
    expect(asked).toEqual(["up"]);
    expect(localStorage.getItem(DECK_EDGE_STORAGE_KEY)).toBeNull();
    mount({ deckState: "up", onDeckState: owner });
    // a fall: laid out as it was until it arrives, then at rest
    expect(stageRoot().getAttribute("data-godview-deck-motion")).toBe("restore");
    expect(stageRoot().getAttribute("data-godview-deck-layout")).toBe("maximized");
    act(() => {
      vi.advanceTimersByTime(DECK_FALL_MS + DECK_TRAVEL_GRACE_MS);
    });
    expect(stageRoot().getAttribute("data-godview-deck-layout")).toBe("up");
    expect(shiftOnRoot()).toBe("");
    vi.useRealTimers();
  });

  it("the grip's hit in the title bar: 168 wide, the bar's full height, holding the groove", () => {
    mount({ onDeckState: owner });
    const hit = separator()?.querySelector(".vf-godview-deck-grip-hit") ?? null;
    expect(hit).not.toBeNull();
    expect(hit?.querySelector(".vf-godview-deck-grip > .vf-godview-deck-groove")).not.toBeNull();
  });

  it("says no readout where nothing can minimize (a picture's edge)", () => {
    mount();
    expect(readout()).toBeNull();
  });

  it("keys never minimize: End stops at 120 left, and ↓ there moves nothing", () => {
    mount({ onDeckState: owner });
    key("End");
    expect(shiftOnRoot()).toBe(`${MAX}px`);
    key("ArrowDown");
    key("ArrowDown", true);
    expect(shiftOnRoot()).toBe(`${MAX}px`);
    expect(asked).toEqual([]);
    expect(readout()?.getAttribute("data-on")).toBe("false");
    // each key is a change: the field follows it
    expect(fieldOnRoot()).toBe(`${MAX}px`);
  });

  it("a double-click puts the edge back at rest and forgets — the field with it", () => {
    mount({ onDeckState: owner });
    key("ArrowUp", true);
    expect(fieldOnRoot()).toBe("-96px");
    act(() => {
      separator()?.dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
    });
    expect(shiftOnRoot()).toBe("");
    expect(fieldOnRoot()).toBe("");
    expect(localStorage.getItem(DECK_EDGE_STORAGE_KEY)).toBeNull();
    expect(asked).toEqual([]);
  });

  it("the readout's recipe: 800 64px/1, −0.04em in text main, the verb at 40%, haloed in the monitor's ground over a 62% veil — centred between y 60 and the edge, the veil to 26 above it", () => {
    const godview = readFileSync(join(PACKAGE_ROOT, "src/godview/godview.css"), "utf8");
    const rule = (selector: string): string => {
      const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/ /g, "\\s+");
      return godview.match(new RegExp(`^${escaped} \\{([^}]*)\\}`, "m"))?.[1] ?? "";
    };
    const words = rule(".vf-godview-deck-readout");
    expect(words).toContain("position: absolute;");
    expect(words).toMatch(
      /top: max\(\s*150px,\s*calc\(\(60px \+ var\(--vf-godview-deck-rest\) \+ var\(--vf-godview-deck-shift, 0px\)\) \/ 2\)\s*\);/,
    );
    expect(words).toContain("height: 0;");
    expect(words).toContain("place-items: center;");
    expect(words).toContain("pointer-events: none;");
    // under the sheet (10), over the monitor's chrome (7)
    expect(words).toContain("z-index: 9;");
    expect(words).toContain("opacity: 0;");
    expect(words).toContain("transition: opacity 160ms ease;");
    const on = rule('.vf-godview-deck-readout[data-on="true"]');
    expect(on).toContain("opacity: 1;");
    expect(on).toContain("transition-duration: 120ms;");
    const type = rule(".vf-godview-deck-readout b");
    expect(type).toContain("font: 800 64px / 1 var(--vf-font-sans);");
    expect(type).toContain("letter-spacing: -0.04em;");
    expect(type).toContain("color: var(--text-main);");
    expect(type).toContain("white-space: nowrap;");
    expect(type).toMatch(
      /text-shadow:\s*0 0 40px var\(--monitor-bg\),\s*0 0 18px var\(--monitor-bg\);/,
    );
    expect(rule(".vf-godview-deck-readout b i")).toContain("opacity: 0.4;");
    const theVeil = rule(".vf-godview-deck-veil");
    expect(theVeil).toContain("inset: 0;");
    expect(theVeil).toContain("z-index: 8;");
    expect(theVeil).toContain(
      "background: color-mix(in srgb, var(--monitor-bg) 62%, transparent);",
    );
    expect(theVeil).toMatch(
      /clip-path: inset\(\s*0 0\s*calc\(100% - var\(--vf-godview-deck-rest\) - var\(--vf-godview-deck-shift, 0px\) \+ 26px\)\s*0\s*\);/,
    );
    expect(theVeil).toContain("transition: opacity 160ms ease;");
    expect(rule('.vf-godview-deck-veil[data-on="true"]')).toContain("opacity: 1;");
  });
});

describe("the deck sheet's ground", () => {
  it("is the background of the very theme the panes are handed, per mode and per catalog choice", () => {
    for (const mode of ["light", "dark"] as const) {
      for (const appearance of [
        DEFAULT_DECK_APPEARANCE,
        {
          ...DEFAULT_DECK_APPEARANCE,
          lightThemeName: "Solarized Light",
          darkThemeName: "Solarized Dark",
        },
      ]) {
        const panes = terminalGround(godviewTerminalTheme(appearance, mode));
        // Round 3: the frame tone is the ground mixed toward the terminal's own
        // ink, so the stage's root is handed both, from the one projection.
        expect(godviewTerminalGroundStyle(appearance, mode)).toEqual({
          "--vf-godview-terminal-bg": panes.background,
          "--vf-godview-terminal-ink": panes.ink,
        });
      }
    }
    // The reference grounds (§2.7), opaque: the alpha is the stage's to set.
    expect(godviewTerminalGroundStyle(DEFAULT_DECK_APPEARANCE, "dark")).toEqual({
      "--vf-godview-terminal-bg": "rgb(40 44 52)",
      "--vf-godview-terminal-ink": "rgb(255 255 255)",
    });
  });
});

describe("the deck sheet's stylesheet", () => {
  const godview = readFileSync(join(PACKAGE_ROOT, "src/godview/godview.css"), "utf8");
  // a selector matched across the line breaks the formatter puts in a long one
  const rule = (selector: string): string => {
    const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/ /g, "\\s+");
    return godview.match(new RegExp(`^${escaped} \\{([^}]*)\\}`, "m"))?.[1] ?? "";
  };
  const placed = ".vf-godview[data-godview-deck-edge]";

  it("the monitor makes room: its field ends 12 above the edge as last SET — never above where it ends at rest — and draws no edge of its own", () => {
    // DESIGN.md §8 "The monitor makes room": measured once per change, never
    // per frame — so the field follows the edge as it was let go (the field
    // shift, set by the edge at each change), never the held one; and an edge
    // set above rest (a shift below zero) counts as none (James, 2026-10-19:
    // "no more squeezing the swarm bounds").
    const root = rule(".vf-godview");
    // rest (N15 (a)): the drawing's share of the stage, never above its floor
    expect(root).toMatch(
      /--vf-godview-deck-rest: max\(\s*var\(--vf-godview-deck-rest-share\),\s*var\(--vf-godview-deck-rest-floor\)\s*\);/,
    );
    expect(root).toMatch(
      /--vf-godview-field-foot: calc\(\s*var\(--vf-godview-deck-rest\) \+\s+max\(0px, var\(--vf-godview-field-shift, 0px\)\) -\s*var\(--vf-godview-deck-field-gap\)\s*\);/,
    );
    const monitor = rule(`${placed} .vf-godview-monitor-stage`);
    expect(monitor).toContain(
      "flex-basis: calc(var(--vf-godview-field-foot) - var(--vf-godview-head-height, 40px));",
    );
    // the held edge never reaches the field
    expect(monitor).not.toContain("--vf-godview-deck-shift");
    expect(rule(".vf-godview-monitor-stage")).not.toContain("--vf-godview-deck-shift");
    expect(rule(".vf-godview-monitor-stage")).not.toContain("border-bottom");
    expect(FIELD_SHIFT_PROPERTY).toBe("--vf-godview-field-shift");
  });

  it("stands the sheet at its edge — rest and the shift — over the monitor, as a sheet", () => {
    const deck = rule(".vf-godview-terminal-deck");
    expect(deck).toContain("z-index: 10");
    expect(deck).toContain("var(--deck-shadow)");
    expect(deck).toContain("var(--vf-godview-deck-radius)");
    // no margin follows the edge any more: the sheet is PLACED at it
    expect(deck).not.toContain("margin-top");
    const at = rule(`${placed} .vf-godview-terminal-deck`);
    expect(at).toContain("position: absolute;");
    expect(at).toMatch(
      /top: calc\(var\(--vf-godview-deck-rest\) \+ var\(--vf-godview-deck-shift, 0px\)\);/,
    );
    for (const side of ["right", "bottom", "left"]) expect(at).toContain(`${side}: 0;`);
    // a stage with an edge says so on its root; a picture (Settings'
    // miniature) keeps the sheet in the flow under its own monitor
    mount();
    expect(stageRoot().hasAttribute("data-godview-deck-edge")).toBe(true);
    act(() => root?.unmount());
    root = null;
    mount({ edge: false });
    expect(stageRoot().hasAttribute("data-godview-deck-edge")).toBe(false);
  });

  it("paints the sheet in the frame tone — the terminal's ground mixed toward its own ink — at the stage's glass", () => {
    // GV-D7: the sheet stops being the terminal's ground exactly; the panes sit
    // in a well set into a frame a shade off them.
    expect(rule(".vf-godview-terminal-deck")).toMatch(
      /background: color-mix\(\s*in srgb,\s*var\(--deck-frame\) var\(--vf-godview-stage-opacity, 100%\),\s*transparent\s*\);/,
    );
    expect(godview).toContain(
      "--deck-frame: color-mix(in srgb, var(--deck-ink) var(--deck-frame-ink), var(--deck-ground));",
    );
    // the ink is the terminal's, which the stage's root is handed; Godview's
    // text main only where a host hands none
    expect(godview).toContain("--deck-ink: var(--vf-godview-terminal-ink, var(--text-main));");
    for (const mode of ["light", "dark"]) {
      expect(godview).toContain(`--deck-frame-ink: var(--vf-godview-${mode}-deck-frame-ink);`);
      expect(godview).toContain(
        `--deck-ground: var(--vf-godview-terminal-bg, var(--vf-godview-${mode}-terminal-bg));`,
      );
    }
    // GV-D2: the launcher's clearing is untouched — still the TERMINAL's ground
    expect(rule(".vf-godview-terminal-deck")).toMatch(
      /--vf-pane-launcher-ground: color-mix\(\s*in srgb,\s*var\(--deck-ground\)/,
    );
  });

  it("the lip is a 30 bar holding a 40 × 6 groove, from tokens DESIGN.md names", () => {
    const tokens = readFileSync(join(PACKAGE_ROOT, "../design-kit/src/tokens.css"), "utf8");
    const design = readFileSync(join(PACKAGE_ROOT, "../../DESIGN.md"), "utf8");
    const token = (name: string): string | undefined =>
      tokens.match(new RegExp(`^\\s*${name}:\\s*([^;]+);`, "m"))?.[1];
    expect(token("--vf-godview-deck-lip")).toBe("30px");
    expect(token("--vf-godview-deck-grip-width")).toBe("40px");
    expect(token("--vf-godview-deck-grip-height")).toBe("6px");
    expect(token("--vf-godview-deck-grip-radius")).toBe("3px");
    for (const name of [
      "--vf-godview-deck-lip",
      "--vf-godview-deck-grip-width",
      "--vf-godview-deck-grip-height",
      "--vf-godview-deck-grip-radius",
    ]) {
      expect(design, name).toContain(`\`${name}\``);
    }
    // …and DESIGN.md states them as what ships: 14 and 72 × 4 are history
    expect(design).toMatch(/`--vf-godview-deck-lip` 30px/);
    expect(design).toMatch(
      /`--vf-godview-deck-grip-width` \/ `--vf-godview-deck-grip-height` 40 × 6/,
    );
    expect(design).not.toMatch(/Until it lands, the terminals keep the 14px lip/);

    // the bar reads its height; the groove its size, and is PRESSED IN: filled
    // with the well's edge, the well's shade inside its top, its rim under it
    expect(rule(".vf-godview-deck-lip")).toContain("flex: 0 0 var(--vf-godview-deck-lip);");
    const groove = rule(".vf-godview-deck-groove");
    expect(groove).toContain("width: var(--vf-godview-deck-grip-width);");
    expect(groove).toContain("height: var(--vf-godview-deck-grip-height);");
    expect(groove).toContain("border-radius: var(--vf-godview-deck-grip-radius);");
    expect(groove).toContain("background: var(--deck-well-edge);");
    expect(groove).toMatch(
      /box-shadow:\s*inset 0 1px 1\.5px var\(--deck-well-shade\),\s*0 1px 0 var\(--deck-well-rim\);/,
    );
    // its pill: 22 tall, padded by the token, fully round, clear at rest
    const pill = rule(".vf-godview-deck-grip");
    expect(pill).toContain("height: var(--vf-godview-deck-grip-pill);");
    expect(pill).toContain("padding: 0 var(--vf-godview-deck-grip-pill-pad);");
    expect(pill).toContain("border-radius: calc(var(--vf-godview-deck-grip-pill) / 2);");
    expect(pill).toContain("background: transparent;");
    // under the pointer: the pill the ink at 7%, the groove 30% of it in its edge
    expect(rule('.vf-godview-deck-lip[role="separator"]:hover .vf-godview-deck-grip')).toContain(
      "background: color-mix(in srgb, var(--deck-ink) 7%, transparent);",
    );
    expect(rule('.vf-godview-deck-lip[role="separator"]:hover .vf-godview-deck-groove')).toContain(
      "background: color-mix(in srgb, var(--deck-ink) 30%, var(--deck-well-edge));",
    );
    // held: 10%, and the groove the full ink — said AFTER the hover and at its
    // weight, because a held lip is also under the pointer
    const held = '.vf-godview-deck-lip[role="separator"][data-dragging="true"]';
    expect(rule(`${held} .vf-godview-deck-grip`)).toContain(
      "background: color-mix(in srgb, var(--deck-ink) 10%, transparent);",
    );
    expect(rule(`${held} .vf-godview-deck-groove`)).toContain("background: var(--deck-ink);");
    expect(godview.indexOf(`${held} .vf-godview-deck-groove`)).toBeGreaterThan(
      godview.indexOf('.vf-godview-deck-lip[role="separator"]:hover .vf-godview-deck-groove'),
    );
    expect(rule(held)).toContain("cursor: grabbing;");
    // the keyboard's focus: 1px in text main, 1 off the pill
    const focus = rule(".vf-godview-deck-lip:focus-visible .vf-godview-deck-grip");
    expect(focus).toContain("outline: 1px solid var(--text-main);");
    expect(focus).toContain("outline-offset: 1px;");
    // the old bar's ramp is gone with the bar
    expect(godview).not.toContain("background: var(--text-faint);\n  transition: background-color");

    // mounted: the separator holds the pill and the groove, and NO button —
    // minimize and maximize are drawn by the slices that make them work
    mount();
    const edge = separator();
    expect(edge?.querySelector(".vf-godview-deck-grip > .vf-godview-deck-groove")).not.toBeNull();
    expect(edge?.querySelectorAll("button")).toHaveLength(0);
  });

  it("the well's edge is drawn over the panes, 1 in, corners 10 and 9", () => {
    mount();
    // the sheet holds the lip, then the well; the well holds the box the deck fills
    const well = host.querySelector(".vf-godview-terminal-deck > .vf-godview-deck-well");
    expect(well).not.toBeNull();
    expect(well?.previousElementSibling?.classList.contains("vf-godview-deck-lip")).toBe(true);
    const body = well?.querySelector(":scope > .vf-godview-terminal-deck-body");
    expect(body?.textContent).toBe("deck");

    // the well: 8 in at each side and its foot, corners 10, a rim of light under it
    const wellRule = rule(".vf-godview-deck-well");
    expect(wellRule).toContain("margin: 0 8px 8px;");
    expect(wellRule).toContain("border-radius: var(--vf-godview-deck-well-radius);");
    expect(wellRule).toContain("box-shadow: 0 1px 0 var(--deck-well-rim);");
    // its edge and its shade are an overlay ABOVE the panes, never a border under them
    const over = rule(".vf-godview-deck-well::after");
    expect(over).toContain("inset: 0;");
    expect(over).toContain("z-index: 1;");
    expect(over).toContain("border-radius: inherit;");
    expect(over).toContain("pointer-events: none;");
    expect(over).toMatch(
      /box-shadow:\s*inset 0 0 0 1px var\(--deck-well-edge\),\s*inset 0 2px 4px var\(--deck-well-shade\);/,
    );
    // the panes: 1 in, clipped at 9, their own layers kept under that overlay
    const bodyRule = rule(".vf-godview-terminal-deck-body");
    expect(bodyRule).toContain("inset: 1px;");
    expect(bodyRule).toContain("overflow: hidden;");
    expect(bodyRule).toContain("border-radius: calc(var(--vf-godview-deck-well-radius) - 1px);");
    expect(bodyRule).toContain("isolation: isolate;");
    for (const mode of ["light", "dark"]) {
      for (const part of ["edge", "rim", "shade"]) {
        expect(godview).toContain(`--deck-well-${part}: var(--vf-godview-${mode}-well-${part});`);
      }
    }
    // inside the cover the well's foot is the window's reserve (FC-D15), and
    // nothing else of the well changes there
    expect(rule(".vf-cover .vf-godview-deck-well")).toBe("\n  margin-bottom: 88px;\n");
    expect(godview).not.toMatch(/^\.vf-cover \.vf-godview-terminal-deck-body \{/m);
  });

  it("the pane area is no-drag, so a pane's rows inside the window's drag strip take their clicks", () => {
    // GV-D11's carve, declared for good: an "up" sheet never stands in the top
    // 52, so this only bites when the terminals are maximized.
    expect(rule(".vf-godview-deck-well")).toContain("-webkit-app-region: no-drag;");
    // …and the wrapper's other regions are the maximized title bar's (W6): the
    // bar drags the window, the grip's hit and the buttons are holes in it
    expect(godview.match(/^\s*-webkit-app-region:/gm)).toHaveLength(4);
  });

  it("holds the deck's top at rest whatever the head's height: the monitor's basis gives back what the head takes (L8a)", () => {
    // The sheet stands at rest + the shift, rest the drawing's share of the
    // stage above its floor (N15 (a)) — a place in the stage that names no
    // head. The monitor's basis is the field's foot less the head's height:
    // with the head at 40 (the instrument bar) nothing moves; at 0 (the Stories
    // head) the monitor is exactly 40 taller and the deck's top is where it was.
    expect(rule(`${placed} .vf-godview-monitor-stage`)).toContain(
      "flex-basis: calc(var(--vf-godview-field-foot) - var(--vf-godview-head-height, 40px));",
    );
    expect(rule(".vf-godview-monitor-stage")).toMatch(
      /flex: 0 0\s+calc\(\s*var\(--vf-godview-deck-rest\) - var\(--vf-godview-head-height, 40px\)\s*\);/,
    );
    // The variable is set NOWHERE in this sheet: its default is the 40px inside
    // those `var()`s, and the head's owner sets it — to 0px, on the stage's
    // root — when the bar goes. A second default here would be a second owner.
    expect(godview).not.toMatch(/^\s*--vf-godview-head-height\s*:/m);
    expect(godview.match(/var\(--vf-godview-head-height, 40px\)/g)).toHaveLength(2);
    // the arithmetic: the monitor ends at the field's foot whatever the head,
    // and the deck's top never names the head
    const monitorFoot = (head: number, foot: number): number => head + (foot - head);
    const rest = (stage: number): number => Math.max((stage * 5) / 13, 232);
    const deckTop = (stage: number, shift: number): number => rest(stage) + shift;
    for (const [stage, shift] of [
      [780, 0],
      [520, 0],
      [780, 96],
    ] as const) {
      const foot = rest(stage) + Math.max(0, shift) - 12;
      expect(monitorFoot(0, foot)).toBe(monitorFoot(40, foot));
      // 12 above the edge — at rest always, rest's floor being the field's least and its gap
      expect(deckTop(stage, shift) - foot, `${stage}/${shift}`).toBeCloseTo(12, 6);
    }
  });

  it("reads tokens that exist (DESIGN.md first, then tokens.css)", () => {
    const tokens = readFileSync(join(PACKAGE_ROOT, "../design-kit/src/tokens.css"), "utf8");
    for (const token of [
      "--vf-godview-light-deck-shadow",
      "--vf-godview-dark-deck-shadow",
      "--vf-godview-deck-radius",
      "--vf-godview-deck-lip",
      "--vf-godview-deck-grip-width",
      "--vf-godview-deck-grip-height",
      "--vf-godview-deck-grip-radius",
      "--vf-godview-deck-grip-pill",
      "--vf-godview-deck-grip-pill-pad",
      "--vf-godview-deck-well-radius",
      "--vf-godview-deck-rest-share",
      "--vf-godview-deck-rest-floor",
      "--vf-godview-launcher-clearing-floor",
    ]) {
      expect(tokens, token).toMatch(new RegExp(`^\\s*${token}:`, "m"));
    }
  });
});

describe("the wrapper's tokens (round 3 — DESIGN.md first, then tokens.css)", () => {
  const tokens = readFileSync(join(PACKAGE_ROOT, "../design-kit/src/tokens.css"), "utf8");
  const design = readFileSync(join(PACKAGE_ROOT, "../../DESIGN.md"), "utf8");
  /** The ruled drawing's own numbers (One Frame's `kit/gv3.css` and `gv3.js`):
   * the frame tone and the well per Godview mode, then the geometry. */
  const WRAPPER_TOKENS: readonly (readonly [name: string, value: string])[] = [
    ["--vf-godview-light-deck-frame-ink", "11%"],
    ["--vf-godview-dark-deck-frame-ink", "9%"],
    ["--vf-godview-light-well-edge", "rgb(0 0 0 / 17%)"],
    ["--vf-godview-dark-well-edge", "rgb(0 0 0 / 42%)"],
    ["--vf-godview-light-well-rim", "rgb(255 255 255 / 60%)"],
    ["--vf-godview-dark-well-rim", "rgb(255 255 255 / 6%)"],
    ["--vf-godview-light-well-shade", "rgb(0 0 0 / 9%)"],
    ["--vf-godview-dark-well-shade", "rgb(0 0 0 / 28%)"],
    ["--vf-godview-deck-well-radius", "10px"],
    ["--vf-godview-deck-grip-radius", "3px"],
    ["--vf-godview-deck-grip-pill", "22px"],
    ["--vf-godview-deck-grip-pill-pad", "12px"],
    ["--vf-godview-deck-grip-hit", "168px"],
    ["--vf-godview-deck-control-width", "30px"],
    ["--vf-godview-deck-control-height", "24px"],
    ["--vf-godview-deck-control-radius", "8px"],
    ["--vf-godview-deck-field-gap", "12px"],
  ];

  it("each stands in tokens.css once, at the ruled drawing's value", () => {
    for (const [name, value] of WRAPPER_TOKENS) {
      const found = [...tokens.matchAll(new RegExp(`^\\s*${name}:\\s*([^;]+);`, "gm"))];
      expect(found.length, name).toBe(1);
      expect(found[0]?.[1], name).toBe(value);
    }
  });

  it("DESIGN.md names each by its whole name, so a token is never one the doc does not hold", () => {
    for (const [name] of WRAPPER_TOKENS) {
      expect(design, name).toContain(`\`${name}\``);
    }
  });
});

describe("Settings' miniature under the Lip (plan risk 10)", () => {
  const tokens = readFileSync(join(PACKAGE_ROOT, "../design-kit/src/tokens.css"), "utf8");
  const px = (name: string): number =>
    Number.parseFloat(tokens.match(new RegExp(`^\\s*${name}:\\s*([^;]+);`, "m"))?.[1] ?? "NaN");

  function mountMiniature(variant: "window" | "thumb" | "deck"): HTMLElement {
    root = createRoot(host);
    act(() =>
      root?.render(
        <GodviewMiniature
          variant={variant}
          mode="light"
          theme={BUILTIN_THEMES.light}
          palette={Array.from({ length: 16 }, () => "#808080")}
          appearance={DEFAULT_DECK_APPEARANCE}
        />,
      ),
    );
    return host.querySelector<HTMLElement>(".vf-ts-mini") as HTMLElement;
  }

  it("draws the shipping stage: the groove in its lip, its panes in the well", () => {
    const mini = mountMiniature("window");
    expect(
      mini.querySelector(".vf-godview-deck-lip > .vf-godview-deck-grip > .vf-godview-deck-groove"),
    ).not.toBeNull();
    expect(
      mini.querySelector(
        ".vf-godview-deck-well > .vf-godview-terminal-deck-body > .vf-ts-mini-deck .ghostty-pane",
      ),
    ).not.toBeNull();
    // a picture: nothing in it can be dragged
    expect(mini.querySelector('[role="separator"]')).toBeNull();
  });

  it("sizes its rows to what the Lip and the well leave a pane, never under the frame's bands", () => {
    // The pane's box is the deck less the Lip (the token), the well's foot (8)
    // and the 1 the panes stand in from the well at top and bottom; its grid is
    // the frame's: 24 above and 30 below, the terminal's 2 of origin inside.
    const lip = px("--vf-godview-deck-lip");
    expect(lip).toBe(30);
    for (const [variant, deck] of [
      ["window", 250],
      ["thumb", 212],
      ["deck", 250],
    ] as const) {
      const mini = mountMiniature(variant);
      const screen = mini.querySelector<HTMLElement>(".ghostty-pane.is-active .vf-ts-mini-screen");
      const rows = screen?.querySelectorAll(".vf-ts-mini-line").length ?? 0;
      const room = deck - lip - 8 - 2 - (24 + 2) - (30 + 2);
      expect(rows, variant).toBeGreaterThan(0);
      expect(rows * 19, variant).toBeLessThanOrEqual(room);
      expect((rows + 1) * 19, variant).toBeGreaterThan(room);
      expect(screen?.style.height, variant).toBe(`${rows * 19}px`);
      act(() => root?.unmount());
      root = null;
    }
  });
});
