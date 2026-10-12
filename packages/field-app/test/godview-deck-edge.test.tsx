// @vitest-environment happy-dom
/**
 * THE DECK'S EDGE (DESIGN.md §8, 2026-09-28): the terminal deck is a sheet
 * over the monitor, and its top edge moves.
 *
 * The layout is the stylesheet's (`godview.css` reads one custom property), so
 * this fixture emulates that one rule in the only place happy-dom lays anything
 * out — `getBoundingClientRect` — and holds the edge to the contract:
 *   1. the bounds: up to the head's reserve, 56 from the window's top (the
 *      monitor never shrinks), down until the deck would drop under its minimum
 *   2. a drag writes the shift onto the stage's root and nothing else, and the
 *      viewer's position is remembered (and only by the live overlay)
 *   3. the keyboard and a double-click move it the same way
 *   4. a window that shrinks clamps the edge; one that grows returns it
 *   5. with no monitor there is nothing to move against — no separator
 *   6. the stylesheet splits the one number into the monitor's growth and the
 *      deck's overlap, and the tokens it reads exist
 *   7. the Lip's look (round 3, GV-D7 and GV-D12): a 30 bar holding the groove
 *      in its pill, on the frame tone, the panes in a well — and the facts the
 *      deck's marker says of the wrapper
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
  DECK_HEAD_RESERVE,
  DECK_MIN_HEIGHT,
  DECK_SHIFT_PROPERTY,
  deckEdgeBounds,
  deckEdgeValueText,
  deckShiftForKey,
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

// The emulated window: the bar is 40px, the monitor's tuned height 280px.
const BAR = 40;
const REST_MONITOR = 280;
let windowHeight = 800;
/** Where the monitor's stage begins below the window's top: the bar's 40 today,
 * 0 once the head takes no band (the Stories head). */
let monitorTop = BAR;
/** Whether the emulated monitor stands alone (the terminals away). */
let awayMonitor = false;

function appliedShift(element: Element): number {
  const root = element.closest<HTMLElement>(".vf-godview");
  const raw = root?.style.getPropertyValue(DECK_SHIFT_PROPERTY) ?? "";
  return raw === "" ? 0 : Number.parseFloat(raw);
}

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

// `godview.css`'s monitor rule, in the one place happy-dom measures — and, for
// the wrapper's witness, where that rule puts the deck and the body in its well.
function layout(this: Element): DOMRect {
  if (this.classList.contains("vf-godview")) return rect(0, windowHeight);
  if (this.classList.contains("vf-godview-monitor-stage")) {
    // away, the monitor alone has the window down to the covers' reserve
    if (awayMonitor) return rect(monitorTop, windowHeight - monitorTop - 88);
    return rect(monitorTop, REST_MONITOR + Math.max(0, appliedShift(this)));
  }
  const deckTop = monitorTop + REST_MONITOR + appliedShift(this);
  if (this.classList.contains("vf-godview-terminal-deck")) {
    return rect(deckTop, windowHeight - deckTop);
  }
  if (this.classList.contains("vf-godview-terminal-deck-body")) {
    return rect(deckTop + LIP + 1, windowHeight - deckTop - LIP - WELL_FOOT - 2);
  }
  return rect(0, 0);
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
  vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(layout);
  vi.stubGlobal("ResizeObserver", FakeResizeObserver);
  const proto = HTMLElement.prototype as unknown as Record<string, unknown>;
  const captured = new Set<number>();
  proto["setPointerCapture"] = (id: number) => captured.add(id);
  proto["releasePointerCapture"] = (id: number) => captured.delete(id);
  proto["hasPointerCapture"] = (id: number) => captured.has(id);
  host = document.createElement("div");
  document.body.append(host);
});

afterEach(() => {
  act(() => root?.unmount());
  root = null;
  host.remove();
  observers.length = 0;
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function Monitor(): ReactElement {
  return <section className="vf-godview-monitor-stage" aria-label="Agent monitor" />;
}

function mount({
  monitor = true,
  persist = true,
  publishesDeck = false,
  edge = true,
  deckState = "up",
}: {
  monitor?: boolean;
  persist?: boolean;
  publishesDeck?: boolean;
  edge?: boolean;
  deckState?: GodviewDeckState;
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
        deck={<p>deck</p>}
      />,
    ),
  );
}

const stageRoot = (): HTMLElement => host.querySelector<HTMLElement>(".vf-godview") as HTMLElement;
const separator = (): HTMLElement | null => host.querySelector<HTMLElement>('[role="separator"]');
const shiftOnRoot = (): string => stageRoot().style.getPropertyValue(DECK_SHIFT_PROPERTY);

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

// room = 800 − 40 = 760 → the lowest edge: 760 − 280 − 120
const MAX = 800 - BAR - REST_MONITOR - DECK_MIN_HEIGHT;
// the highest: the sheet's top at the head's reserve, 56 from the window's top —
// at rest it stands at 40 + 280, so it rises by 264 (until 2026-10-11, by 280:
// to the bar's foot)
const MIN = DECK_HEAD_RESERVE - (BAR + REST_MONITOR);
/** Where the sheet's top stands in the window, from the shift on the root. */
const sheetTop = (): number =>
  monitorTop + REST_MONITOR + (shiftOnRoot() === "" ? 0 : Number.parseFloat(shiftOnRoot()));

describe("the deck edge's arithmetic", () => {
  it("rises to the head's reserve — 56 from the window's top — and falls until the deck's minimum", () => {
    expect(DECK_HEAD_RESERVE).toBe(56);
    // under the bar (the monitor begins at 40): rest is 320, the reach 56
    expect(deckEdgeBounds({ monitorTop: 40, restMonitor: 280, room: 760 })).toEqual({
      min: -264,
      max: 360,
    });
    // with no band above the monitor (it begins at 0): rest is 280, the reach the SAME 56
    expect(deckEdgeBounds({ monitorTop: 0, restMonitor: 280, room: 800 })).toEqual({
      min: -224,
      max: 400,
    });
    for (const geometry of [
      { monitorTop: 40, restMonitor: 280, room: 760 },
      { monitorTop: 0, restMonitor: 280, room: 800 },
      { monitorTop: 40, restMonitor: 170, room: 760 },
    ]) {
      const { min } = deckEdgeBounds(geometry);
      expect(geometry.monitorTop + geometry.restMonitor + min, JSON.stringify(geometry)).toBe(56);
    }
    // A window too short for the minimum keeps the resting layout.
    expect(deckEdgeBounds({ monitorTop: 40, restMonitor: 280, room: 300 })).toEqual({
      min: -264,
      max: 0,
    });
    // …and a monitor so short that rest already stands above the reserve keeps
    // it too: the reserve never pushes the edge DOWN from rest
    expect(deckEdgeBounds({ monitorTop: 0, restMonitor: 40, room: 400 })).toEqual({
      min: 0,
      max: 240,
    });
  });

  it("clamps, rounds and refuses a non-number", () => {
    const bounds = { min: -280, max: 360 };
    expect(clampDeckShift(-999, bounds)).toBe(-280);
    expect(clampDeckShift(999, bounds)).toBe(360);
    expect(clampDeckShift(12.6, bounds)).toBe(13);
    expect(clampDeckShift(Number.NaN, bounds)).toBe(0);
  });

  it("answers the separator's keys and leaves every other key alone", () => {
    const bounds = { min: -280, max: 360 };
    expect(deckShiftForKey("ArrowUp", false, 0, bounds)).toBe(-24);
    expect(deckShiftForKey("ArrowDown", true, 0, bounds)).toBe(96);
    expect(deckShiftForKey("Home", false, 0, bounds)).toBe(-280);
    expect(deckShiftForKey("End", false, 0, bounds)).toBe(360);
    expect(deckShiftForKey("a", false, 0, bounds)).toBeNull();
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

  it("stops at the head's reserve going up and at the deck's minimum going down", () => {
    mount();
    dragBy(-5_000);
    expect(shiftOnRoot()).toBe(`${MIN}px`);
    expect(sheetTop()).toBe(56);
    dragBy(10_000);
    expect(shiftOnRoot()).toBe(`${MAX}px`);
  });

  it("reaches the same 56 from the window's top when no bar stands above the monitor", () => {
    // The head's owner removes the 40 bar and lets the stage begin at the
    // window's top. The reach is a place in the WINDOW, so it does not move.
    monitorTop = 0;
    mount();
    expect(separator()?.getAttribute("aria-valuemin")).toBe(String(56 - REST_MONITOR));
    dragBy(-5_000);
    expect(sheetTop()).toBe(56);
    key("End");
    key("Home");
    expect(sheetTop()).toBe(56);
    key("ArrowUp", true);
    expect(sheetTop()).toBe(56);
  });

  it("clamps a remembered edge that stood above the reserve, at mount", () => {
    // Left at the bar's foot before 2026-10-11 (−280); the memory is kept, the
    // edge stands at the reserve.
    localStorage.setItem(DECK_EDGE_STORAGE_KEY, String(-REST_MONITOR));
    mount();
    expect(shiftOnRoot()).toBe(`${MIN}px`);
    expect(sheetTop()).toBe(56);
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
  const rule = (selector: string): string => {
    const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return godview.match(new RegExp(`^${escaped} \\{([^}]*)\\}`, "m"))?.[1] ?? "";
  };

  it("grows the monitor by the downward shift only, and draws no edge of its own", () => {
    const monitor = rule(".vf-godview-monitor-stage");
    expect(monitor).toContain("max(var(--vf-monitor-stage-height, 35%), 170px)");
    expect(monitor).toContain("max(0px, var(--vf-godview-deck-shift, 0px))");
    expect(monitor).not.toContain("border-bottom");
  });

  it("lays the deck over the monitor by the upward shift, as a sheet", () => {
    const deck = rule(".vf-godview-terminal-deck");
    expect(deck).toContain("margin-top: min(0px, var(--vf-godview-deck-shift, 0px))");
    expect(deck).toContain("z-index: 10");
    expect(deck).toContain("var(--deck-shadow)");
    expect(deck).toContain("var(--vf-godview-deck-radius)");
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
    // …and nothing else of the wrapper declares a region yet: the bar becomes
    // window-drag only with the slice that maximizes it
    expect(godview.match(/^\s*-webkit-app-region:/gm)).toHaveLength(1);
  });

  it("holds the deck's top at rest whatever the head's height: the stage's basis gives back what the head takes (L8a)", () => {
    // basis = max(tuned, 170px) + (40px − head height) + max(0px, shift). With
    // the head at 40 (the instrument bar, today) the middle term is 0 and
    // nothing moves; at 0 (the Stories head) the stage is exactly 40 taller and
    // the deck's top — head + basis — is where it was.
    const monitor = rule(".vf-godview-monitor-stage");
    expect(monitor).toMatch(
      /flex: 0 0\s+calc\(\s*max\(var\(--vf-monitor-stage-height, 35%\), 170px\) \+\s*\(40px - var\(--vf-godview-head-height, 40px\)\) \+\s*max\(0px, var\(--vf-godview-deck-shift, 0px\)\)\s*\);/,
    );
    // The variable is set NOWHERE in this sheet: its default is the 40px inside
    // that `var()`, and the head's owner sets it — to 0px, on the stage's root —
    // when the bar goes. A second default here would be a second owner.
    expect(godview).not.toMatch(/^\s*--vf-godview-head-height\s*:/m);
    expect(godview.match(/var\(--vf-godview-head-height, 40px\)/g)).toHaveLength(1);
    // the arithmetic the formula is: head + basis is the same number at 40 and at 0
    const top = (head: number, tuned: number, shift: number): number =>
      head + Math.max(tuned, 170) + (40 - head) + Math.max(0, shift);
    for (const [tuned, shift] of [
      [280, 0],
      [120, 0],
      [280, 96],
    ] as const) {
      expect(top(0, tuned, shift)).toBe(top(40, tuned, shift));
      expect(top(0, tuned, shift) - 0 - (top(40, tuned, shift) - 40)).toBe(40);
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
    ["--vf-godview-deck-field-floor", "220px"],
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
