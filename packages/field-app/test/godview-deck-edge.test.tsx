// @vitest-environment happy-dom
/**
 * THE DECK'S EDGE (DESIGN.md §8, 2026-09-28): the terminal deck is a sheet
 * over the monitor, and its top edge moves.
 *
 * The layout is the stylesheet's (`godview.css` reads one custom property), so
 * this fixture emulates that one rule in the only place happy-dom lays anything
 * out — `getBoundingClientRect` — and holds the edge to the contract:
 *   1. the bounds: up to the monitor's top (the monitor never shrinks), down
 *      until the deck would drop under its minimum
 *   2. a drag writes the shift onto the stage's root and nothing else, and the
 *      viewer's position is remembered (and only by the live overlay)
 *   3. the keyboard and a double-click move it the same way
 *   4. a window that shrinks clamps the edge; one that grows returns it
 *   5. with no monitor there is nothing to move against — no separator
 *   6. the stylesheet splits the one number into the monitor's growth and the
 *      deck's overlap, and the tokens it reads exist
 */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { act, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_DECK_APPEARANCE } from "../src/godview/deck-appearance";
import {
  clampDeckShift,
  DECK_EDGE_STORAGE_KEY,
  DECK_MIN_HEIGHT,
  DECK_SHIFT_PROPERTY,
  deckEdgeBounds,
  deckEdgeValueText,
  deckShiftForKey,
} from "../src/godview/deck-edge";
import {
  godviewTerminalGroundStyle,
  godviewTerminalTheme,
  terminalGround,
} from "../src/godview/deck-theme";
import { GodviewStage } from "../src/godview/GodviewStage";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const PACKAGE_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

// The emulated window: the bar is 40px, the monitor's tuned height 280px.
const BAR = 40;
const REST_MONITOR = 280;
let windowHeight = 800;

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

// `godview.css`'s monitor rule, in the one place happy-dom measures.
function layout(this: Element): DOMRect {
  if (this.classList.contains("vf-godview")) return rect(0, windowHeight);
  if (this.classList.contains("vf-godview-monitor-stage")) {
    return rect(BAR, REST_MONITOR + Math.max(0, appliedShift(this)));
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
  localStorage.clear();
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

function mount({ monitor = true, persist = true }: { monitor?: boolean; persist?: boolean } = {}) {
  root = createRoot(host);
  act(() =>
    root?.render(
      <GodviewStage
        open
        theme="light"
        tuningOpen={false}
        animations={false}
        {...(monitor ? { monitor: <Monitor /> } : {})}
        deckEdge={{ persist }}
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
const MIN = -REST_MONITOR;

describe("the deck edge's arithmetic", () => {
  it("rises to the monitor's top and falls until the deck's minimum", () => {
    expect(deckEdgeBounds({ restMonitor: 280, room: 760 })).toEqual({ min: -280, max: 360 });
    // A window too short for the minimum keeps the resting layout.
    expect(deckEdgeBounds({ restMonitor: 280, room: 300 })).toEqual({ min: -280, max: 0 });
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

  it("stops at the monitor's top going up and at the deck's minimum going down", () => {
    mount();
    dragBy(-5_000);
    expect(shiftOnRoot()).toBe(`${MIN}px`);
    dragBy(10_000);
    expect(shiftOnRoot()).toBe(`${MAX}px`);
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
        const panes = terminalGround(godviewTerminalTheme(appearance, mode)).background;
        expect(godviewTerminalGroundStyle(appearance, mode)).toEqual({
          "--vf-godview-terminal-bg": panes,
        });
      }
    }
    // The reference grounds (§2.7), opaque: the alpha is the stage's to set.
    expect(godviewTerminalGroundStyle(DEFAULT_DECK_APPEARANCE, "dark")).toEqual({
      "--vf-godview-terminal-bg": "rgb(40 44 52)",
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

  it("paints the sheet in the terminal's own ground, falling back per mode to §2.7's", () => {
    expect(rule(".vf-godview-terminal-deck")).toContain("var(--deck-ground)");
    expect(godview).toContain(
      "--deck-ground: var(--vf-godview-terminal-bg, var(--vf-godview-light-terminal-bg));",
    );
    expect(godview).toContain(
      "--deck-ground: var(--vf-godview-terminal-bg, var(--vf-godview-dark-terminal-bg));",
    );
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
    ]) {
      expect(tokens, token).toMatch(new RegExp(`^\\s*${token}:`, "m"));
    }
  });
});
