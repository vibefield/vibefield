// @vitest-environment happy-dom
/**
 * One Frame FR-1 — the view frame, at the grain the repo tests chrome: the
 * renderer's mirror of the window's ONE view owner (main's `view.ts`), the
 * views track and its keys, and the cover. Main's half is
 * `electron-shell/test/view-state.test.ts`; the delivery of ⌘1–⌘4 from a
 * focused terminal pane in a live window is the godview smoke's row 11g.
 */
import type { FrameView, FrameViewState } from "@vibefield/contracts";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ViewFrame } from "../src/frame/ViewFrame";
import {
  getActiveView,
  requestView,
  resetActiveViewForTest,
  useActiveView,
} from "../src/frame/view-state";
import { type FieldHost, setHost } from "../src/host";
import type { RendererLogger } from "../src/logging";
import { setRendererLogger } from "../src/logging";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let publish: ((state: FrameViewState) => void) | null = null;
let asked: FrameView[] = [];
let root: Root | null = null;
let host: HTMLElement | null = null;
let pane: HTMLElement | null = null;

function installHost(
  platform: "darwin" | "win32" | undefined,
  door: FieldHost["view"] | "default" = "default",
): void {
  setRendererLogger({
    child: () => ({ error: () => undefined }) as unknown as RendererLogger,
    error: () => undefined,
  } as unknown as RendererLogger);
  const view: FieldHost["view"] =
    door === "default"
      ? {
          set: (next) => {
            asked.push(next);
            return Promise.resolve({ view: next });
          },
          onState: (handler) => {
            publish = handler;
            return () => {
              publish = null;
            };
          },
        }
      : door;
  setHost({
    logger: {} as RendererLogger,
    getConnection: () => Promise.resolve({ port: 1, token: "t" }),
    onPrepareClose: () => () => undefined,
    completeClose: () => undefined,
    ...(platform === undefined ? {} : { platform }),
    ...(view === undefined ? {} : { view }),
  } as FieldHost);
}

beforeEach(() => {
  vi.useRealTimers();
  resetActiveViewForTest();
  publish = null;
  asked = [];
  installHost("darwin");
});

afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
  pane?.remove();
  root = null;
  host = null;
  pane = null;
  vi.useRealTimers();
});

function mountFrame(): HTMLElement {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  act(() => root?.render(<ViewFrame godview={<div data-testid="godview-content" />} />));
  return host;
}

function to(view: FrameView): void {
  act(() => publish?.({ view }));
}

const track = (): HTMLElement => {
  const line = host?.querySelector<HTMLElement>(".vf-views-line");
  if (!line) throw new Error("the views track did not render");
  return line;
};
const cell = (view: FrameView): HTMLButtonElement => {
  const button = host?.querySelector<HTMLButtonElement>(`.vf-views-cell[data-view="${view}"]`);
  if (!button) throw new Error(`no cell for ${view}`);
  return button;
};
const cover = (): HTMLElement => {
  const element = host?.querySelector<HTMLElement>(".vf-cover");
  if (!element) throw new Error("the cover did not render");
  return element;
};
const coverView = (view: "godview" | "history"): HTMLElement => {
  const element = host?.querySelector<HTMLElement>(`[data-cover-view="${view}"]`);
  if (!element) throw new Error(`no cover view for ${view}`);
  return element;
};

/** A focused pane that consumes every key at its target, as a ghosttea
 * terminal does (product-chords.test.tsx's stand-in). */
function focusedPane(): { heard: string[] } {
  const heard: string[] = [];
  pane = document.createElement("div");
  pane.tabIndex = 0;
  pane.addEventListener("keydown", (event) => {
    heard.push(`${event.metaKey ? "meta+" : ""}${event.ctrlKey ? "ctrl+" : ""}${event.key}`);
    event.preventDefault();
    event.stopPropagation();
  });
  document.body.appendChild(pane);
  pane.focus();
  return { heard };
}

function press(target: EventTarget, init: KeyboardEventInit, type = "keydown"): KeyboardEvent {
  const event = new KeyboardEvent(type, { bubbles: true, cancelable: true, ...init });
  act(() => {
    target.dispatchEvent(event);
  });
  return event;
}

const command = (digit: string): KeyboardEventInit => ({
  key: digit,
  code: `Digit${digit}`,
  metaKey: true,
});

describe("the view's mirror (one owner, main's)", () => {
  function Probe(): null {
    useActiveView();
    return null;
  }

  it("starts on the canvas and follows the host, which owns the value", () => {
    host = document.createElement("div");
    root = createRoot(host);
    act(() => root?.render(<Probe />));
    expect(getActiveView()).toBe("canvas");
    to("history");
    expect(getActiveView()).toBe("history");
  });

  it("asks for a view by NAME, and moves only when the host answers — no optimistic echo", async () => {
    mountFrame();
    await act(async () => requestView("godview"));
    expect(asked).toEqual(["godview"]);
    // The host was asked; until it PUBLISHES, the window is where it was.
    expect(track().getAttribute("data-view")).toBe("canvas");
    to("godview");
    expect(track().getAttribute("data-view")).toBe("godview");
  });

  it("stays on the canvas on a host with no view door — nothing there can move it", async () => {
    resetActiveViewForTest();
    installHost("darwin", undefined);
    mountFrame();
    act(() => cell("godview").click());
    await act(async () => requestView("history"));
    expect(track().getAttribute("data-view")).toBe("canvas");
    expect(getActiveView()).toBe("canvas");
  });
});

describe("the views track (DESIGN.md §8)", () => {
  it("draws four cells, each printing its key under its glyph, the Assistant waiting", () => {
    mountFrame();
    const cells = [...track().querySelectorAll<HTMLButtonElement>(".vf-views-cell")];
    expect(cells.map((button) => button.dataset.view)).toEqual([
      "canvas",
      "godview",
      "history",
      "assistant",
    ]);
    expect(cells.map((button) => button.querySelector(".vf-views-key")?.textContent)).toEqual([
      "⌘1",
      "⌘2",
      "⌘3",
      "⌘4",
    ]);
    expect(cells.map((button) => button.querySelector(".vf-glyph") !== null)).toEqual([
      true,
      true,
      true,
      true,
    ]);
    expect(cell("godview").getAttribute("aria-keyshortcuts")).toBe("Meta+2");
    expect(cell("godview").title).toBe("Godview  ⌘2");
    expect(cell("canvas").getAttribute("aria-pressed")).toBe("true");
    expect(cell("assistant").getAttribute("aria-disabled")).toBe("true");
    expect(cell("assistant").getAttribute("aria-label")).toBe("Assistant, not built yet");
  });

  it("prints Ctrl off the Mac (FC-D4: Ctrl+1…4 on Windows)", () => {
    installHost("win32");
    mountFrame();
    expect(cell("history").querySelector(".vf-views-key")?.textContent).toBe("Ctrl3");
    expect(cell("history").getAttribute("aria-keyshortcuts")).toBe("Control+3");
    expect(cell("history").title).toBe("History  Ctrl+3");
  });

  it("asks the owner for the view a cell names — a click, or Space on a focused cell", () => {
    mountFrame();
    act(() => cell("godview").click());
    expect(asked).toEqual(["godview"]);
    const space = press(cell("history"), { key: " ", code: "Space" });
    // answered here, so ICE's pan modifier leaves it alone
    expect(space.defaultPrevented).toBe(true);
    expect(asked).toEqual(["godview", "history"]);
  });

  it("answers the waiting cell with its note, and asks nothing", () => {
    mountFrame();
    act(() => cell("assistant").click());
    expect(asked).toEqual([]);
    expect(track().querySelector(".vf-views-note")?.textContent).toBe("Assistant · not built yet");
  });
});

describe("⌘1–⌘4, the product chords (GT-D21, FC-D4)", () => {
  it("take the window's view from inside a focused pane, and the pane never hears them", () => {
    mountFrame();
    const { heard } = focusedPane();
    press(pane as HTMLElement, command("2"));
    expect(asked).toEqual(["godview"]);
    to("godview");
    press(pane as HTMLElement, command("3"));
    press(pane as HTMLElement, command("1"));
    expect(asked).toEqual(["godview", "history", "canvas"]);
    // an ordinary key still belongs to the pane
    press(pane as HTMLElement, { key: "l" });
    expect(heard).toEqual(["l"]);
  });

  it("dips the thumb for the key that is down, even when the view does not move", () => {
    mountFrame();
    to("godview");
    press(window, command("2"));
    // already there: nothing is asked, but the button is the key and goes down
    expect(asked).toEqual([]);
    expect(track().querySelector(".vf-views-thumb-face")?.getAttribute("data-dip")).toBe("pressed");
    press(window, command("1"));
    expect(track().querySelector(".vf-views-thumb-face")?.getAttribute("data-dip")).toBe("landed");
  });

  it("⌘4 says the Assistant waits, for 1.4s, and moves nothing", () => {
    vi.useFakeTimers();
    mountFrame();
    const { heard } = focusedPane();
    press(pane as HTMLElement, command("4"));
    expect(asked).toEqual([]);
    expect(heard).toEqual([]);
    expect(track().querySelector(".vf-views-note")?.textContent).toBe("Assistant · not built yet");
    act(() => {
      vi.advanceTimersByTime(1_399);
    });
    expect(track().querySelector(".vf-views-note")).not.toBeNull();
    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(track().querySelector(".vf-views-note")).toBeNull();
  });

  it("are ⌘ on the Mac and Ctrl elsewhere — never both, and never with ⇧ or ⌥", () => {
    mountFrame();
    // the Mac's ⌃2 is the pane's (Spaces; ^2 in a shell)
    const control = press(window, { key: "2", code: "Digit2", ctrlKey: true });
    const shifted = press(window, { ...command("2"), shiftKey: true });
    const option = press(window, { ...command("2"), altKey: true });
    expect(asked).toEqual([]);
    expect([control, shifted, option].map((event) => event.defaultPrevented)).toEqual([
      false,
      false,
      false,
    ]);
    act(() => root?.unmount());
    root = null;
    resetActiveViewForTest();
    installHost("win32");
    mountFrame();
    press(window, { key: "2", code: "Digit2", ctrlKey: true });
    press(window, command("3"));
    expect(asked).toEqual(["godview"]);
  });

  it("claim a held key's repeats, and act on none of them", () => {
    mountFrame();
    const repeat = press(window, { ...command("3"), repeat: true });
    expect(repeat.defaultPrevented).toBe(true);
    expect(asked).toEqual([]);
  });

  it("⇧⇧ opens nothing — the gesture retired with FC-D4", () => {
    mountFrame();
    const { heard } = focusedPane();
    for (let tap = 0; tap < 2; tap++) {
      press(pane as HTMLElement, { key: "Shift", code: "ShiftLeft", shiftKey: true });
      press(pane as HTMLElement, { key: "Shift", code: "ShiftLeft" }, "keyup");
    }
    expect(asked).toEqual([]);
    expect(track().getAttribute("data-view")).toBe("canvas");
    // the Shift taps were the pane's all along
    expect(heard).toEqual(["Shift", "Shift"]);
  });
});

describe("the field under a cover keeps no keys (DESIGN.md §6)", () => {
  it("stops a key aimed at nothing before the canvas's window keymap hears it — chords still run", () => {
    mountFrame();
    // a stand-in for ICE's keymap: the window, bubble phase, any unclaimed key
    const keymap = vi.fn();
    window.addEventListener("keydown", keymap);
    try {
      press(document.body, { key: "Backspace", code: "Backspace" });
      expect(keymap).toHaveBeenCalledTimes(1); // on the canvas it is the canvas's
      to("history");
      press(document.body, { key: "Backspace", code: "Backspace" });
      press(document.body, { key: "z", code: "KeyZ", metaKey: true });
      expect(keymap).toHaveBeenCalledTimes(1);
      // the frame's own chords are the window's capture listeners: still heard
      press(document.body, command("1"));
      expect(asked).toEqual(["canvas"]);
      // and a key aimed at a control in the cover is that control's, as ever
      const control = document.createElement("button");
      host?.querySelector('[data-cover-view="history"]')?.appendChild(control);
      press(control, { key: "Enter" });
      expect(keymap).toHaveBeenCalledTimes(2);
      to("canvas");
      press(document.body, { key: "Backspace", code: "Backspace" });
      expect(keymap).toHaveBeenCalledTimes(3);
    } finally {
      window.removeEventListener("keydown", keymap);
    }
  });
});

describe("⌘ held alone (DESIGN.md §8)", () => {
  it("lights the keys after 400ms, and letting go puts them out", () => {
    vi.useFakeTimers();
    mountFrame();
    press(window, { key: "Meta", metaKey: true });
    act(() => {
      vi.advanceTimersByTime(399);
    });
    expect(track().hasAttribute("data-held")).toBe(false);
    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(track().getAttribute("data-held")).toBe("true");
    press(window, { key: "Meta" }, "keyup");
    expect(track().hasAttribute("data-held")).toBe(false);
  });

  it("never lights for ⌘C, and a click puts them out", () => {
    vi.useFakeTimers();
    mountFrame();
    press(window, { key: "Meta", metaKey: true });
    press(window, { key: "c", code: "KeyC", metaKey: true });
    act(() => {
      vi.advanceTimersByTime(1_000);
    });
    expect(track().hasAttribute("data-held")).toBe(false);
    press(window, { key: "Meta" }, "keyup");
    press(window, { key: "Meta", metaKey: true });
    act(() => {
      vi.advanceTimersByTime(400);
    });
    expect(track().getAttribute("data-held")).toBe("true");
    act(() => {
      window.dispatchEvent(new Event("pointerdown"));
    });
    expect(track().hasAttribute("data-held")).toBe(false);
  });
});

describe("the cover (DESIGN.md §6)", () => {
  it("is down on the canvas, and rises with the view it holds", () => {
    mountFrame();
    expect(cover().getAttribute("data-cover")).toBe("down");
    expect(cover().getAttribute("aria-hidden")).toBe("true");
    to("godview");
    expect(cover().getAttribute("data-cover")).toBe("up");
    expect(cover().getAttribute("data-cover-motion")).toBe("rise");
    expect(coverView("godview").getAttribute("data-active")).toBe("true");
    expect(host?.querySelector('[data-testid="godview-content"]')).not.toBeNull();
  });

  it("swaps its content in place between covered views, and keeps it while it lowers", () => {
    mountFrame();
    to("godview");
    to("history");
    expect(cover().getAttribute("data-cover-motion")).toBe("swap");
    expect(coverView("history").getAttribute("data-active")).toBe("true");
    expect(coverView("history").textContent).toContain("History is not wired yet");
    to("canvas");
    expect(cover().getAttribute("data-cover")).toBe("down");
    expect(cover().getAttribute("data-cover-motion")).toBe("lower");
    // what leaves is what was there
    expect(cover().getAttribute("data-view")).toBe("history");
    // …and rising again onto Godview switches the content under the rise
    to("godview");
    expect(cover().getAttribute("data-cover-motion")).toBe("rise");
    expect(cover().getAttribute("data-view")).toBe("godview");
  });

  it("keeps the motion it was given through an unrelated render, so a fade is never cut", () => {
    mountFrame();
    to("godview");
    to("history");
    // a key's dip re-renders the frame mid-swap
    press(window, command("3"));
    expect(cover().getAttribute("data-cover-motion")).toBe("swap");
  });

  it("makes every view that is not showing inert, so no hidden pane keeps the keyboard", () => {
    mountFrame();
    expect(coverView("godview").hasAttribute("inert")).toBe(true);
    expect(coverView("history").hasAttribute("inert")).toBe(true);
    to("godview");
    expect(coverView("godview").hasAttribute("inert")).toBe(false);
    expect(coverView("history").hasAttribute("inert")).toBe(true);
    to("history");
    expect(coverView("godview").hasAttribute("inert")).toBe(true);
    expect(coverView("history").hasAttribute("inert")).toBe(false);
  });
});
