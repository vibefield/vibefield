// @vitest-environment happy-dom
/**
 * THE TERMINALS AWAY, AND CALLED UP (Godview round 3 — GV-D5, GV-D6; DESIGN.md
 * §8 "Minimized", "Called up", "One resize per change"; §6 "The terminals rise
 * and fall"). The SHIPPING overlay, with the deck stood in as
 * `godview-overlay-boundaries.test.tsx` stands it in (the real deck's door is
 * held in `godview-deck.test.tsx`), and the real monitor on a scripted board.
 * This file holds:
 *   1. the Lip's first button, minimize, beside the separator and never in it
 *   2. away: the deck takes no pointer, no focus and no key — inert, focus
 *      leaves the pane, no demand — and the monitor has the window to the reserve
 *   3. the fall and the rise: one travel each, on their own curves, and the
 *      sheet laid out once per change
 *   4. a call — the door's ask — brings them up as they were left; a call while
 *      up moves nothing
 *   5. the word: the frame's door says away and up while Godview shows, and the
 *      shell (`host.deck.set`) hears each change once
 *   6. the state is kept for the run (a reload), and a launch opens on the
 *      monitor alone: the deck is not called until the first call (W7)
 *   7. the lab's call (W7): under the Godview markers alone, safe at any time,
 *      answering nothing, and said in the wrapper's facts when it raised them
 *   8. ⌘W on the last pane (N16 (a)): the terminals go away and Godview stays
 */

import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { FrameViewState, GodviewDeckState, WindowLightsState } from "@vibefield/contracts";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  askGodviewDeckUp,
  getGodviewDeck,
  resetGodviewDeckDoorForTest,
} from "../src/frame/deck-door";
import { resetGodviewFindDoorForTest } from "../src/frame/find-door";
import { resetActiveViewForTest } from "../src/frame/view-state";
import {
  DECK_FALL_MS,
  DECK_RISE_MS,
  DECK_STATE_STORAGE_KEY,
  DECK_TRAVEL_GRACE_MS,
} from "../src/godview/deck-state";
import { getDeckWrapperFacts } from "../src/godview/deck-wrapper-witness";
import type { MonitorDoor } from "../src/godview/monitor/remote-door";
import { type FieldHost, setHost } from "../src/host";
import type { RendererLogger } from "../src/logging";
import { setRendererLogger } from "../src/logging";
import { configureTerminalPool, disposeTerminalPool } from "../src/terminal/pool";
import { nextTask } from "./chrome-clock-fixture";
import { managedSummary } from "./managed-session-fixture";
import { type ScriptedModelBoard, scriptedModelBoard } from "./model-board-fixture";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const PACKAGE_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

const godview = readFileSync(join(PACKAGE_ROOT, "src/godview/godview.css"), "utf8");

/** One rule's body in `godview.css`, its selector matched across the line
 * breaks the formatter puts in a long one. */
function rule(selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/ /g, "\\s+");
  return godview.match(new RegExp(`^${escaped} \\{([^}]*)\\}`, "m"))?.[1] ?? "";
}

/** When each travel has ended: its length, and two frames' grace. */
const FALL_ENDS = DECK_FALL_MS + DECK_TRAVEL_GRACE_MS;
const RISE_ENDS = DECK_RISE_MS + DECK_TRAVEL_GRACE_MS;

/** The deck, stood in: it says each `active` it is handed, and holds a pane's
 * input the way ghosttea's pane does, so focus can be put in it. */
const stand = vi.hoisted(() => ({
  active: [] as boolean[],
  called: [] as boolean[],
  mounts: 0,
  /** what the deck is handed for ⌘W on its last pane (N16) */
  lastPaneClose: undefined as (() => void) | undefined,
}));

vi.mock("../src/godview/GodviewDeck", async () => {
  const { useEffect } = await import("react");
  return {
    GodviewDeck: ({
      active,
      called,
      onLastPaneClose,
    }: {
      active: boolean;
      called?: boolean;
      onLastPaneClose?: () => void;
    }) => {
      stand.active.push(active);
      stand.called.push(called === true);
      stand.lastPaneClose = onLastPaneClose;
      useEffect(() => {
        stand.mounts += 1;
      }, []);
      return (
        <div className="deck-stand-in">
          <textarea className="terminal-input" aria-label="pane input" />
        </div>
      );
    },
  };
});

vi.mock("@vibefield/fieldd-client/react", () => ({
  useFielddClient: () => ({ request: vi.fn(async () => ({})) }),
}));

const { GodviewOverlay } = await import("../src/godview/GodviewOverlay");

const TOKENS: Record<string, string> = { "--tint-l": "0.6", "--tint-c": "0.15" };

let board: ScriptedModelBoard | null = null;
let root: Root | null = null;
let container: HTMLElement | null = null;
let publishView: ((state: FrameViewState) => void) | null = null;
/** Every word the shell was told, in order. */
let said: (GodviewDeckState | null)[] = [];
/** every view the page asked the shell for */
let asked: FrameViewState["view"][] = [];

function fakeDoor(): MonitorDoor {
  board = scriptedModelBoard({
    rows: [managedSummary({ runtimeRunId: "run-claude", kind: "claude", label: "Claude" })],
  });
  const status = { reachable: false, detail: "no index in this fixture", checkedAt: "2026-10-11" };
  return {
    model: board.port,
    attach: vi.fn(async () => ({ state: "no-pane" as const })),
    createTerminal: vi.fn(async () => ({ state: "no-pane" as const })),
    mountLocal: vi.fn(async (sessionId: string) => ({ state: "mounted" as const, sessionId })),
    transcripts: {
      status: async () => status,
      facts: async () => [],
      search: async () => ({ status, answered: false, hits: [], clipped: false }),
    },
    usage: {
      snapshot: async () => ({ refreshedAt: "2026-10-11", entries: [] }),
      subscribe: () => () => undefined,
    },
  };
}

async function settle(): Promise<void> {
  for (let round = 0; round < 4; round += 1) {
    await act(async () => {
      await nextTask();
    });
  }
}

async function setView(view: FrameViewState["view"]): Promise<void> {
  await act(async () => publishView?.({ view }));
  await settle();
}

async function mountOverlay(): Promise<HTMLElement> {
  container = document.createElement("div");
  // the window's cover, as the frame mounts Godview in it (FC-D15)
  container.className = "vf-cover";
  document.body.append(container);
  root = createRoot(container, { onCaughtError: vi.fn(), onUncaughtError: vi.fn() });
  await act(async () => root?.render(<GodviewOverlay />));
  await setView("godview");
  return container;
}

async function unmountOverlay(): Promise<void> {
  await act(async () => root?.unmount());
  root = null;
  container?.remove();
  container = null;
}

const stage = (host: ParentNode): HTMLElement =>
  host.querySelector<HTMLElement>(".vf-godview") as HTMLElement;
const sheet = (host: ParentNode): HTMLElement =>
  host.querySelector<HTMLElement>(".vf-godview-terminal-deck") as HTMLElement;
const minimizeButton = (host: ParentNode): HTMLButtonElement | null =>
  host.querySelector<HTMLButtonElement>('button[aria-label="Minimize the terminals"]');

/** The fall and the rise run on the window's timers; the test holds them. */
function holdTimers(): void {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
}
async function advance(ms: number): Promise<void> {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

async function minimize(host: HTMLElement): Promise<void> {
  await act(async () => minimizeButton(host)?.click());
}

beforeEach(() => {
  stand.active = [];
  stand.called = [];
  stand.mounts = 0;
  said = [];
  asked = [];
  stand.lastPaneClose = undefined;
  localStorage.clear();
  sessionStorage.clear();
  // a run whose terminals were already called up: most rows below begin there
  // (the launch's own rows clear it — W7)
  sessionStorage.setItem(DECK_STATE_STORAGE_KEY, "up");
  for (const [name, value] of Object.entries(TOKENS)) {
    document.documentElement.style.setProperty(name, value);
  }
  vi.spyOn(console, "log").mockImplementation(() => undefined);
  resetActiveViewForTest();
  resetGodviewFindDoorForTest();
  resetGodviewDeckDoorForTest();
  publishView = null;
  const quiet = () => undefined;
  setRendererLogger({
    child: () =>
      ({
        trace: quiet,
        debug: quiet,
        info: quiet,
        warn: quiet,
        error: quiet,
        fatal: quiet,
      }) as unknown as RendererLogger,
  } as unknown as RendererLogger);
  const door = fakeDoor();
  setHost({
    logger: {} as RendererLogger,
    platform: "darwin",
    view: {
      set: (view: FrameViewState["view"]) => {
        asked.push(view);
        return Promise.resolve({ view });
      },
      onState: (handler: (state: FrameViewState) => void) => {
        publishView = handler;
        return () => undefined;
      },
    },
    deck: {
      set: (deck: GodviewDeckState | null): Promise<WindowLightsState> => {
        said.push(deck);
        return Promise.resolve({ deck, lights: "head" });
      },
    },
  } as unknown as FieldHost);
  disposeTerminalPool();
  configureTerminalPool({ transport: "routed", defaultShell: "/bin/zsh", home: "/home/tester" });
  void door;
});

afterEach(async () => {
  vi.useRealTimers();
  await unmountOverlay();
  board?.dispose();
  board = null;
  disposeTerminalPool();
  for (const name of Object.keys(TOKENS)) document.documentElement.style.removeProperty(name);
  vi.restoreAllMocks();
});

describe("the Lip's first button: minimize (GV-D7)", () => {
  it("stands at the lip's right end, beside the separator and never inside it, in the window's words", async () => {
    const host = await mountOverlay();
    const button = minimizeButton(host);
    expect(button).not.toBeNull();
    // §9: the title says the one thing the gesture could leave in doubt
    expect(button?.getAttribute("title")).toBe("Minimize — every session keeps running");
    expect(button?.type).toBe("button");
    // the whole lip drags the edge, but never its buttons: the button is not
    // in the separator (whose children are presentational to assistive tech)
    expect(button?.closest('[role="separator"]')).toBeNull();
    const controls = button?.closest(".vf-godview-deck-controls");
    expect(controls?.parentElement).toBe(sheet(host));
    // §13: the `minimize` glyph at 14
    const glyph = button?.querySelector("svg");
    expect(glyph?.getAttribute("width")).toBe("14");
    // …and maximize after it, since W6 gave it its behaviour
    expect(controls?.querySelectorAll("button")).toHaveLength(2);
  });
});

describe("the Lip's minimize, drawn (DESIGN.md §2.7)", () => {
  it("is 30 × 24 with corners 8, 10 in from the lip's right end on its axis, in the terminal's ink at 64% — the full ink on a 10% fill under the pointer", () => {
    const controls = rule(".vf-godview-deck-controls");
    expect(controls).toContain("position: absolute;");
    expect(controls).toContain("right: 10px;");
    expect(controls).toContain("height: var(--vf-godview-deck-lip);");
    expect(controls).toContain("align-items: center;");
    expect(controls).toContain("gap: 4px;");
    // above the lip's reach, so the edge never takes the press
    expect(controls).toContain("z-index: 1;");
    const control = rule(".vf-godview-deck-control");
    expect(control).toContain("width: var(--vf-godview-deck-control-width);");
    expect(control).toContain("height: var(--vf-godview-deck-control-height);");
    expect(control).toContain("border-radius: var(--vf-godview-deck-control-radius);");
    expect(control).toContain("color: color-mix(in srgb, var(--deck-ink) 64%, transparent);");
    expect(control).toMatch(/transition:\s*background-color 120ms ease,\s*color 120ms ease;/);
    const hover = rule(".vf-godview-deck-control:hover");
    expect(hover).toContain("color: var(--deck-ink);");
    expect(hover).toContain("background: color-mix(in srgb, var(--deck-ink) 10%, transparent);");
    const focus = rule(".vf-godview-deck-control:focus-visible");
    expect(focus).toContain("outline: 1px solid var(--text-main);");
    expect(focus).toContain("outline-offset: 1px;");
  });
});

describe("away (GV-D6 — nothing, fully away)", () => {
  it("away: inert, hidden, no demand, focus leaves the pane, the stage ends at the reserve", async () => {
    const host = await mountOverlay();
    expect(stage(host).getAttribute("data-godview-deck")).toBe("up");
    expect(stand.active.at(-1)).toBe(true);
    // a person typing in a pane
    const input = host.querySelector<HTMLTextAreaElement>(".terminal-input");
    act(() => input?.focus());
    expect(document.activeElement).toBe(input);

    holdTimers();
    await minimize(host);
    // the state is away at once: no pointer, no focus, no key, no demand —
    // while the sheet still travels down at the size it has
    expect(stage(host).getAttribute("data-godview-deck")).toBe("away");
    expect(sheet(host).hasAttribute("inert")).toBe(true);
    expect(sheet(host).contains(document.activeElement)).toBe(false);
    expect(stand.active.at(-1)).toBe(false);
    expect(stage(host).getAttribute("data-godview-deck-motion")).toBe("fall");
    // …and on arrival it is away: out of the flow, below the foot, unseen
    await advance(FALL_ENDS);
    expect(stage(host).hasAttribute("data-godview-deck-motion")).toBe(false);
    expect(sheet(host).hasAttribute("inert")).toBe(true);
    // every session keeps running: the deck is never unmounted
    expect(stand.mounts).toBe(1);
    expect(host.querySelector(".deck-stand-in")).not.toBeNull();
  });

  it("the stylesheet: away and arrived, the sheet is out of the flow at its own box, below the foot and unseen; the monitor has the window to the reserve", () => {
    const arrived = '.vf-godview[data-godview-deck="away"]:not([data-godview-deck-motion])';
    const away = rule(`${arrived} .vf-godview-terminal-deck`);
    expect(away).toContain("visibility: hidden;");
    expect(away).toContain("transform: translateY(calc(100% + 40px));");
    // its own box: away changes nothing of its layout — the sheet is placed at
    // its edge, out of the flow, whatever the state (round 3, W4)
    expect(away).not.toMatch(/\b(position|top|bottom|height|margin-top|flex)\s*:/);
    const placed = rule(".vf-godview[data-godview-deck-edge] .vf-godview-terminal-deck");
    expect(placed).toContain("position: absolute;");
    expect(placed).toMatch(
      /top: calc\(var\(--vf-godview-deck-rest\) \+ var\(--vf-godview-deck-shift, 0px\)\);/,
    );
    expect(placed).toMatch(/bottom: 0;/);
    // the monitor alone: the window, to the covers' reserve (L5, FC-D15)
    expect(rule(`${arrived} .vf-godview-monitor-stage`)).toContain("flex: 1 1 0;");
    expect(rule(`.vf-cover ${arrived} .vf-godview-monitor-stage`)).toContain(
      "margin-bottom: 88px;",
    );
  });
});

describe("the fall and the rise (§6; §8 one resize per change)", () => {
  it("falls over 300ms on the retract curve and rises over 480ms on the island curve, a transform each, and at once under reduced motion", () => {
    expect(DECK_FALL_MS).toBe(300);
    expect(DECK_RISE_MS).toBe(480);
    const fall = rule('.vf-godview[data-godview-deck-motion="fall"] .vf-godview-terminal-deck');
    expect(fall).toContain("transform: translateY(calc(100% + 40px));");
    expect(fall).toContain("transition: transform 300ms cubic-bezier(0.4, 0, 1, 1);");
    const rise = rule('.vf-godview[data-godview-deck-motion="rise"] .vf-godview-terminal-deck');
    expect(rise).toContain("transition: transform 480ms var(--vf-ease-island);");
    // M3: transitions, never an animated edge — nothing in either changes the
    // sheet's size
    for (const travel of [fall, rise]) {
      expect(travel).not.toMatch(/\b(height|top|margin-top|flex)\s*:/);
    }
    expect(godview).toMatch(
      /@media \(prefers-reduced-motion: reduce\) \{\s*\.vf-godview\[data-godview-deck-motion\] \.vf-godview-terminal-deck \{\s*transition: none;\s*\}\s*\}/,
    );
  });

  it("rises from below the foot when called up from away, and the travel ends", async () => {
    const host = await mountOverlay();
    holdTimers();
    await minimize(host);
    await advance(FALL_ENDS);
    expect(stage(host).getAttribute("data-godview-deck")).toBe("away");

    await act(async () => {
      expect(askGodviewDeckUp()).toBe(true);
    });
    // laid out at its end size at once (the away rule no longer applies), and
    // travelling up by transform
    expect(stage(host).getAttribute("data-godview-deck")).toBe("up");
    expect(stage(host).getAttribute("data-godview-deck-motion")).toBe("rise");
    expect(sheet(host).hasAttribute("inert")).toBe(false);
    expect(stand.active.at(-1)).toBe(true);
    await advance(RISE_ENDS);
    expect(stage(host).hasAttribute("data-godview-deck-motion")).toBe(false);
    // the sheet's own style is left as the stylesheet draws it
    expect(sheet(host).style.transform).toBe("");
    expect(sheet(host).style.transition).toBe("");
  });

  it("a call during the fall turns it round: it rises from where it is", async () => {
    const host = await mountOverlay();
    holdTimers();
    await minimize(host);
    await advance(DECK_FALL_MS / 2);
    await act(async () => {
      askGodviewDeckUp();
    });
    expect(stage(host).getAttribute("data-godview-deck")).toBe("up");
    expect(stage(host).getAttribute("data-godview-deck-motion")).toBe("rise");
    // no start of its own: it goes back from where the fall had it
    expect(sheet(host).style.transform).toBe("");
    // the fall's arrival never comes
    await advance(FALL_ENDS);
    expect(stage(host).getAttribute("data-godview-deck")).toBe("up");
    await advance(RISE_ENDS);
    expect(stage(host).hasAttribute("data-godview-deck-motion")).toBe(false);
  });
});

describe("called up (GV-D5, GV-D6)", () => {
  it("a call brings them up as they were left; a call while up moves nothing", async () => {
    const host = await mountOverlay();
    const deckBefore = host.querySelector(".deck-stand-in");
    // up: a call moves nothing — no travel, no word
    await act(async () => {
      expect(askGodviewDeckUp()).toBe(true);
    });
    expect(stage(host).getAttribute("data-godview-deck")).toBe("up");
    expect(stage(host).hasAttribute("data-godview-deck-motion")).toBe(false);
    expect(said).toEqual(["up"]);

    holdTimers();
    await minimize(host);
    await advance(FALL_ENDS);
    await act(async () => {
      askGodviewDeckUp();
    });
    await advance(RISE_ENDS);
    // the same deck, never remounted: the same panes
    expect(host.querySelector(".deck-stand-in")).toBe(deckBefore);
    expect(stand.mounts).toBe(1);
    expect(stage(host).getAttribute("data-godview-deck")).toBe("up");
  });

  it("is heard while another view shows: a call from History raises them for the return", async () => {
    const host = await mountOverlay();
    holdTimers();
    await minimize(host);
    await advance(FALL_ENDS);
    vi.useRealTimers();
    await setView("history");
    expect(stage(host).getAttribute("data-godview-deck")).toBe("away");
    await act(async () => {
      askGodviewDeckUp();
    });
    await setView("godview");
    expect(stage(host).getAttribute("data-godview-deck")).toBe("up");
  });

  it("with no Godview to answer, the ask is heard by nobody and says so", () => {
    expect(askGodviewDeckUp()).toBe(false);
  });
});

describe("maximized — the bar is the window's title bar (round 3, W6 — GV-D11)", () => {
  const maximizeButton = (host: ParentNode): HTMLButtonElement | null =>
    host.querySelector<HTMLButtonElement>('button[aria-label="Maximize the terminals"]');
  const restoreButton = (host: ParentNode): HTMLButtonElement | null =>
    host.querySelector<HTMLButtonElement>(
      'button[aria-label="Restore the terminals to their place"]',
    );

  it("the Lip's two buttons: minimize, then maximize — the order windows keep them", async () => {
    const host = await mountOverlay();
    const names = [...(host.querySelectorAll(".vf-godview-deck-controls button") ?? [])].map(
      (button) => button.getAttribute("aria-label"),
    );
    expect(names).toEqual(["Minimize the terminals", "Maximize the terminals"]);
    expect(maximizeButton(host)?.getAttribute("title")).toBe("Maximize");
    expect(maximizeButton(host)?.querySelector("svg")?.getAttribute("width")).toBe("14");
  });

  it("maximize rises to the window's top and the door says maximized; restore falls back to the edge — the shell hears each by name once", async () => {
    const host = await mountOverlay();
    holdTimers();
    await act(async () => maximizeButton(host)?.click());
    expect(stage(host).getAttribute("data-godview-deck")).toBe("maximized");
    expect(stage(host).getAttribute("data-godview-deck-layout")).toBe("maximized");
    expect(stage(host).getAttribute("data-godview-deck-motion")).toBe("maximize");
    expect(getGodviewDeck()).toBe("maximized");
    expect(said).toEqual(["up", "maximized"]);
    // the panes stay the deck's, drawn — maximized is up, not away
    expect(stand.active.at(-1)).toBe(true);
    expect(sheet(host).hasAttribute("inert")).toBe(false);
    await advance(RISE_ENDS);
    expect(stage(host).hasAttribute("data-godview-deck-motion")).toBe(false);
    // the title bar's end: a hairline, minimize, restore — no maximize
    const names = [...host.querySelectorAll(".vf-godview-deck-controls button")].map((button) =>
      button.getAttribute("aria-label"),
    );
    expect(names).toEqual(["Minimize the terminals", "Restore the terminals to their place"]);
    expect(host.querySelector(".vf-godview-deck-controls > .vf-godview-deck-hair")).not.toBeNull();
    expect(restoreButton(host)?.getAttribute("title")).toBe("Restore");

    await act(async () => restoreButton(host)?.click());
    // up at once — the door, the head, the lights — while the sheet falls at
    // the size it has, laid out at its edge on arrival
    expect(stage(host).getAttribute("data-godview-deck")).toBe("up");
    expect(getGodviewDeck()).toBe("up");
    expect(said).toEqual(["up", "maximized", "up"]);
    expect(stage(host).getAttribute("data-godview-deck-motion")).toBe("restore");
    expect(stage(host).getAttribute("data-godview-deck-layout")).toBe("maximized");
    await advance(FALL_ENDS);
    expect(stage(host).hasAttribute("data-godview-deck-motion")).toBe(false);
    expect(stage(host).getAttribute("data-godview-deck-layout")).toBe("up");
  });

  it("minimize from the title bar goes away, and a call brings them back up — at their edge", async () => {
    const host = await mountOverlay();
    holdTimers();
    await act(async () => maximizeButton(host)?.click());
    await advance(RISE_ENDS);
    await minimize(host);
    expect(stage(host).getAttribute("data-godview-deck")).toBe("away");
    await advance(FALL_ENDS);
    await act(async () => {
      askGodviewDeckUp();
    });
    expect(stage(host).getAttribute("data-godview-deck")).toBe("up");
    expect(stage(host).getAttribute("data-godview-deck-layout")).toBe("up");
  });

  it("a reload keeps them maximized", async () => {
    let host = await mountOverlay();
    holdTimers();
    await act(async () => maximizeButton(host)?.click());
    await advance(RISE_ENDS);
    vi.useRealTimers();
    await unmountOverlay();
    resetGodviewDeckDoorForTest();
    host = await mountOverlay();
    expect(stage(host).getAttribute("data-godview-deck")).toBe("maximized");
    expect(stage(host).getAttribute("data-godview-deck-layout")).toBe("maximized");
    expect(stage(host).hasAttribute("data-godview-deck-motion")).toBe(false);
  });

  it("the stylesheet: the sheet at the window's top without corners, ring or shadow; the monitor resting; the bar a window-drag region with the grip's 168 and the buttons as holes", () => {
    const at = '.vf-godview[data-godview-deck-edge][data-godview-deck-layout="maximized"]';
    expect(rule(`${at} .vf-godview-terminal-deck`)).toContain("top: 0;");
    const max = '.vf-godview[data-godview-deck="maximized"]';
    const sheetRule = rule(`${max} .vf-godview-terminal-deck`);
    expect(sheetRule).toContain("border-radius: 0;");
    expect(sheetRule).toContain("box-shadow: none;");
    expect(rule(".vf-godview-terminal-deck")).toMatch(
      /border-radius 160ms ease,\s*box-shadow 160ms ease/,
    );
    expect(rule(`${max} .vf-godview-monitor-stage`)).toContain("opacity: 0;");
    expect(rule(".vf-godview-monitor-stage")).toMatch(/transition:[^;]*opacity 260ms ease;/);
    // the window drags by the bar; the grip's hit and the buttons are holes
    expect(rule(`${max} .vf-godview-deck-lip`)).toContain("-webkit-app-region: drag;");
    const hit = rule(".vf-godview-deck-grip-hit");
    expect(hit).toContain("width: var(--vf-godview-deck-grip-hit);");
    expect(hit).toContain("height: 100%;");
    expect(hit).toContain("-webkit-app-region: no-drag;");
    expect(rule(".vf-godview-deck-controls")).toContain("-webkit-app-region: no-drag;");
    // …and the panes' area, whose rows stand under the bar inside the strip
    expect(rule(".vf-godview-deck-well")).toContain("-webkit-app-region: no-drag;");
    expect(rule(`${max} .vf-godview-deck-controls`)).toContain("right: 8px;");
    const hair = rule(".vf-godview-deck-hair");
    expect(hair).toContain("width: 1px;");
    expect(hair).toContain("height: 14px;");
    expect(hair).toContain("background: color-mix(in srgb, var(--deck-ink) 16%, transparent);");
    // the rise to the top and the fall back, each a transform on the island
    // and retract curves, the corners and shadow with them
    expect(
      rule('.vf-godview[data-godview-deck-motion="maximize"] .vf-godview-terminal-deck'),
    ).toMatch(
      /transition:\s*transform 480ms var\(--vf-ease-island\),\s*border-radius 160ms ease,\s*box-shadow 160ms ease;/,
    );
    const restore = rule(
      '.vf-godview[data-godview-deck-motion="restore"] .vf-godview-terminal-deck',
    );
    expect(restore).toContain(
      "transform: translateY(calc(var(--vf-godview-deck-rest) + var(--vf-godview-deck-shift, 0px)));",
    );
    expect(restore).toMatch(/transform 300ms cubic-bezier\(0\.4, 0, 1, 1\)/);
    // the readout over the terminals: centred between the edge and the panes'
    // foot, its veil from the edge down, both over the sheet
    const words = rule('.vf-godview-deck-readout[data-readout="maximize"]');
    expect(words).toContain("z-index: 12;");
    expect(words).toMatch(/var\(--vf-godview-panes-foot\)/);
    const theVeil = rule('.vf-godview-deck-veil[data-readout="maximize"]');
    expect(theVeil).toContain("z-index: 11;");
    expect(theVeil).toContain(
      "clip-path: inset(calc(var(--vf-godview-deck-rest) + var(--vf-godview-deck-shift, 0px)) 0 0 0);",
    );
  });
});

describe("the word (L2; the shell's lights and ⌘W, W5)", () => {
  it("the door says away and up, and host.deck.set hears each change once", async () => {
    const host = await mountOverlay();
    expect(getGodviewDeck()).toBe("up");
    expect(said).toEqual(["up"]);

    holdTimers();
    await minimize(host);
    expect(getGodviewDeck()).toBe("away");
    expect(said).toEqual(["up", "away"]);
    // the fall's arrival is drawing, not news
    await advance(FALL_ENDS);
    expect(said).toEqual(["up", "away"]);

    await act(async () => {
      askGodviewDeckUp();
    });
    expect(getGodviewDeck()).toBe("up");
    expect(said).toEqual(["up", "away", "up"]);
    vi.useRealTimers();

    // another view: the frame's door is withdrawn, but the shell keeps the
    // word — main composes it with the view it owns, so ⌘2 back finds it
    await setView("canvas");
    expect(getGodviewDeck()).toBeNull();
    expect(said).toEqual(["up", "away", "up"]);
    await setView("godview");
    expect(getGodviewDeck()).toBe("up");
    expect(said).toEqual(["up", "away", "up"]);

    // the overlay going away takes its word with it
    await unmountOverlay();
    expect(said).toEqual(["up", "away", "up", null]);
  });
});

describe("as you left it, for the run (L3)", () => {
  it("a reload keeps the terminals away; a launch opens them away too", async () => {
    let host = await mountOverlay();
    holdTimers();
    await minimize(host);
    await advance(FALL_ENDS);
    vi.useRealTimers();
    // away is what a launch opens with: it keeps nothing of its own
    expect(sessionStorage.getItem(DECK_STATE_STORAGE_KEY)).toBeNull();

    // the renderer reloads: the same session's storage
    await unmountOverlay();
    resetGodviewDeckDoorForTest();
    stand.active = [];
    host = await mountOverlay();
    expect(stage(host).getAttribute("data-godview-deck")).toBe("away");
    expect(stage(host).hasAttribute("data-godview-deck-motion")).toBe(false);
    expect(getGodviewDeck()).toBe("away");
    expect(stand.active.every((active) => !active)).toBe(true);

    // a launch: a new session's storage, and the monitor alone (GV-D5)
    await unmountOverlay();
    sessionStorage.clear();
    host = await mountOverlay();
    expect(stage(host).getAttribute("data-godview-deck")).toBe("away");
  });
});

describe("the monitor alone at launch, then as you left it (round 3, W7 — GV-D5, N14 (a))", () => {
  it("a launch opens away, and the deck is not called — no restore, no workspace, no birth — until the first call", async () => {
    sessionStorage.clear();
    const host = await mountOverlay();
    expect(stage(host).getAttribute("data-godview-deck")).toBe("away");
    expect(stage(host).hasAttribute("data-godview-deck-motion")).toBe(false);
    expect(getGodviewDeck()).toBe("away");
    expect(said).toEqual(["away"]);
    // the deck is mounted (its door is the monitor's) but not called
    expect(stand.mounts).toBe(1);
    expect(stand.called.length).toBeGreaterThan(0);
    expect(stand.called.every((called) => !called)).toBe(true);
    expect(stand.active.every((active) => !active)).toBe(true);
    // the first call: up, rising from the foot, the deck called from now on
    holdTimers();
    await act(async () => {
      askGodviewDeckUp();
    });
    expect(stage(host).getAttribute("data-godview-deck")).toBe("up");
    expect(stage(host).getAttribute("data-godview-deck-motion")).toBe("rise");
    expect(stand.called.at(-1)).toBe(true);
    expect(stand.active.at(-1)).toBe(true);
    await advance(RISE_ENDS);
    // minimized again, the deck stays called: its panes keep their workspace
    await minimize(host);
    await advance(FALL_ENDS);
    expect(stand.called.at(-1)).toBe(true);
    expect(stand.mounts).toBe(1);
  });

  it("a reload into up or maximized finds the deck called; a reload into away waits for the next call", async () => {
    sessionStorage.setItem(DECK_STATE_STORAGE_KEY, "maximized");
    let host = await mountOverlay();
    expect(stage(host).getAttribute("data-godview-deck")).toBe("maximized");
    expect(stand.called.every((called) => called)).toBe(true);
    await unmountOverlay();
    resetGodviewDeckDoorForTest();
    stand.called = [];
    sessionStorage.removeItem(DECK_STATE_STORAGE_KEY);
    host = await mountOverlay();
    expect(stage(host).getAttribute("data-godview-deck")).toBe("away");
    expect(stand.called.every((called) => !called)).toBe(true);
  });
});

// W7 — THE LAB'S CALL (the MV lead's three conditions, 2026-10-12). A launch
// opens on the monitor alone, so a lab that measures the terminals brings them
// up first: `window.__vfGodviewDeck.up()`, there only under the Godview
// markers, read by no product code, safe at any time, answering nothing — and
// the deck's marker trail says when it was this call that raised them.
describe("the lab's call, under the Godview markers only (W7)", () => {
  // the suite's page carries the markers (`vitest.config.ts`); a case that
  // needs them off says so, and the page is given back as it was
  const page = location.href;
  const plain = location.pathname;
  afterEach(() => {
    history.replaceState(null, "", page);
  });

  it("is not there without the markers, and no product code names it but its installer", async () => {
    history.replaceState(null, "", plain);
    sessionStorage.clear();
    await mountOverlay();
    expect(window.__vfGodviewDeck).toBeUndefined();
    const naming = (readdirSync(join(PACKAGE_ROOT, "src"), { recursive: true }) as string[])
      .filter((file) => /\.tsx?$/.test(file))
      .filter((file) =>
        readFileSync(join(PACKAGE_ROOT, "src", file), "utf8").includes("__vfGodviewDeck"),
      );
    expect(naming).toEqual([join("godview", "deck-state.ts")]);
  });

  it("is there from the overlay's mount — the frame's — before Godview has ever shown", async () => {
    history.replaceState(null, "", `${plain}?godviewMarkers=1`);
    sessionStorage.clear();
    container = document.createElement("div");
    container.className = "vf-cover";
    document.body.append(container);
    root = createRoot(container, { onCaughtError: vi.fn(), onUncaughtError: vi.fn() });
    await act(async () => root?.render(<GodviewOverlay />));
    // no view has been set: Godview has not shown, and the call is already there
    expect(container.querySelector(".vf-godview")).toBeNull();
    expect(window.__vfGodviewDeck).toBeDefined();
    // called before Godview shows, it raises them for the open
    await act(async () => {
      window.__vfGodviewDeck?.up();
    });
    await setView("godview");
    expect(stage(container).getAttribute("data-godview-deck")).toBe("up");
    expect(stand.called.every((called) => called)).toBe(true);
  });

  it("raises the terminals from away and says so; twice, or while up, it moves nothing and answers nothing", async () => {
    history.replaceState(null, "", `${plain}?godviewMarkers=1`);
    sessionStorage.clear();
    const host = await mountOverlay();
    const lab = window.__vfGodviewDeck;
    if (lab === undefined) throw new Error("the markers' lab call is not installed");
    expect(getDeckWrapperFacts()).toMatchObject({ state: "away" });
    expect(getDeckWrapperFacts()?.raisedBy).toBeUndefined();
    const answers: unknown[] = [];
    holdTimers();
    await act(async () => {
      answers.push(lab.up());
      answers.push(lab.up());
    });
    expect(answers).toEqual([undefined, undefined]);
    expect(stage(host).getAttribute("data-godview-deck")).toBe("up");
    expect(said).toEqual(["away", "up"]);
    await advance(RISE_ENDS);
    // the marker trail: this call raised them
    expect(getDeckWrapperFacts()).toMatchObject({ state: "up", raisedBy: "lab" });
    // up while up: nothing moves, nothing more is said
    await act(async () => {
      answers.push(lab.up());
    });
    expect(answers).toEqual([undefined, undefined, undefined]);
    expect(said).toEqual(["away", "up"]);
    // away, the word goes with them; a product call raises them unsaid
    await minimize(host);
    await advance(FALL_ENDS);
    expect(getDeckWrapperFacts()).toMatchObject({ state: "away" });
    expect(getDeckWrapperFacts()?.raisedBy).toBeUndefined();
    await act(async () => {
      askGodviewDeckUp();
    });
    await advance(RISE_ENDS);
    expect(getDeckWrapperFacts()).toMatchObject({ state: "up" });
    expect(getDeckWrapperFacts()?.raisedBy).toBeUndefined();
    // the page going away takes the call with it
    vi.useRealTimers();
    await unmountOverlay();
    expect(window.__vfGodviewDeck).toBeUndefined();
  });
});

// N16 (a), James 2026-10-11 (DESIGN.md §8 "Minimized"): ⌘W on the last pane
// minimizes the terminals and stays in Godview. Ghosttea keeps its last pane
// and calls its platform's `closeWindow`; the deck hands that to the
// terminals' owner, which puts them away — never the Canvas it asked for
// until N16. The pane stays, so a call brings it back as it was.
describe("⌘W on the last pane minimizes the terminals and stays in Godview (N16 (a))", () => {
  it("puts them away with the fall, asks for no other view, and a call brings the same deck back", async () => {
    const host = await mountOverlay();
    expect(stage(host).getAttribute("data-godview-deck")).toBe("up");
    const close = stand.lastPaneClose;
    if (close === undefined) throw new Error("the deck was handed nothing for its last pane");
    holdTimers();
    await act(async () => close());
    expect(stage(host).getAttribute("data-godview-deck")).toBe("away");
    expect(stage(host).getAttribute("data-godview-deck-motion")).toBe("fall");
    expect(getGodviewDeck()).toBe("away");
    expect(said.at(-1)).toBe("away");
    expect(asked, "the last pane's ⌘W asked for another view").toEqual([]);
    await advance(FALL_ENDS);
    // the pane was kept: a call brings the same deck up, never a new one
    await act(async () => {
      askGodviewDeckUp();
    });
    expect(stage(host).getAttribute("data-godview-deck")).toBe("up");
    expect(stand.mounts).toBe(1);
  });

  it("puts them away from maximized too", async () => {
    sessionStorage.setItem(DECK_STATE_STORAGE_KEY, "maximized");
    const host = await mountOverlay();
    expect(stage(host).getAttribute("data-godview-deck")).toBe("maximized");
    await act(async () => stand.lastPaneClose?.());
    expect(stage(host).getAttribute("data-godview-deck")).toBe("away");
    expect(asked).toEqual([]);
  });
});
