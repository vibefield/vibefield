// @vitest-environment happy-dom
/**
 * M49 — THE OVERLAY'S CHROME, BEHIND ITS BOUNDARIES (MV-8b, M176 item 2).
 *
 * Godview's window holds the monitor and, beside it, chrome: the deck (with its
 * edge) and System control. One bad read in any of them used to unmount the
 * whole tree, the monitor and its view with it (M47's class). Each now sits
 * behind its own named `ChromeBoundary`, and this file mounts the SHIPPING
 * overlay to hold that: a throwing deck, panel or edge says "<name>
 * unavailable" where it stood, while the monitor's stage, its bar and its view
 * root stay — the same elements, never remounted.
 *
 * Three things are stood in, and only these: the deck (its own fixture
 * mounts the real one over ghosttea's stubs; here it is a stand-in that builds
 * and withdraws its door as the real one does, GT-D17), and pass-through
 * wrappers on the panel and the edge that throw on demand. The monitor is the
 * real one, on fieldd's real backend through the scripted model board.
 */

import type { FrameViewState } from "@vibefield/contracts";
import { act, useEffect, useSyncExternalStore } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { GodviewMonitorFacts } from "../src/development-console";
import { getGodviewDeck, resetGodviewDeckDoorForTest } from "../src/frame/deck-door";
import { getGodviewFindDoor, resetGodviewFindDoorForTest } from "../src/frame/find-door";
import {
  getSystemControlDoor,
  resetSystemControlDoorForTest,
  runSystemControl,
} from "../src/frame/system-control-door";
import { resetActiveViewForTest } from "../src/frame/view-state";
import type { MonitorDoor } from "../src/godview/monitor/remote-door";
import { type FieldHost, setHost } from "../src/host";
import type { RendererLogger } from "../src/logging";
import { setRendererLogger } from "../src/logging";
import { configureTerminalPool, disposeTerminalPool } from "../src/terminal/pool";
import { advanceChromeClock, holdChromeClock, nextTask } from "./chrome-clock-fixture";
import { managedSummary } from "./managed-session-fixture";
import { type ScriptedModelBoard, scriptedModelBoard } from "./model-board-fixture";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/** What the stand-ins do, set per test. `tick` re-renders the deck on demand. */
const stand = vi.hoisted(() => ({
  deckThrows: false,
  panelThrows: false,
  edgeThrows: false,
  deckMounts: 0,
  /** every render the deck was asked for, thrown or not */
  deckRenders: 0,
  door: null as unknown,
  tick: 0,
  ticked: new Set<() => void>(),
}));

/** The deck, stood in: it builds its door on mount and withdraws it on unmount,
 * as `GodviewDeck` does ("the deck going away takes the door with it"), and it
 * throws while told to — the way a deck reader's throw reaches its boundary. */
vi.mock("../src/godview/GodviewDeck", () => ({
  GodviewDeck: ({ onRemoteDoor }: { onRemoteDoor?: (door: MonitorDoor | null) => void }) => {
    stand.deckRenders += 1;
    useSyncExternalStore(
      (fn) => {
        stand.ticked.add(fn);
        return () => stand.ticked.delete(fn);
      },
      () => stand.tick,
    );
    useEffect(() => {
      stand.deckMounts += 1;
      onRemoteDoor?.(stand.door as MonitorDoor);
      return () => onRemoteDoor?.(null);
    }, [onRemoteDoor]);
    if (stand.deckThrows) throw new Error("the deck's read lost its board");
    return <div className="deck-stand-in">deck</div>;
  },
}));

vi.mock("../src/godview/GodviewTuningPanel", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/godview/GodviewTuningPanel")>();
  return {
    ...actual,
    GodviewTuningPanel: (props: Parameters<typeof actual.GodviewTuningPanel>[0]) => {
      if (stand.panelThrows && props.open) throw new Error("the panel lost its sections");
      return <actual.GodviewTuningPanel {...props} />;
    },
  };
});

vi.mock("../src/godview/GodviewDeckEdge", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/godview/GodviewDeckEdge")>();
  return {
    ...actual,
    GodviewDeckEdge: (props: Parameters<typeof actual.GodviewDeckEdge>[0]) => {
      if (stand.edgeThrows) throw new Error("the edge lost its stored shift");
      return <actual.GodviewDeckEdge {...props} />;
    },
  };
});

vi.mock("@vibefield/fieldd-client/react", () => ({
  useFielddClient: () => ({ request: vi.fn(async () => ({})) }),
}));

const { GodviewOverlay } = await import("../src/godview/GodviewOverlay");

/** The palette's inputs (godview-monitor.test.tsx says why the tint pair matters). */
const TOKENS: Record<string, string> = { "--tint-l": "0.6", "--tint-c": "0.15" };

let board: ScriptedModelBoard | null = null;
let root: Root | null = null;
let container: HTMLElement | null = null;
let publishView: ((state: FrameViewState) => void) | null = null;
let markers: GodviewMonitorFacts[] = [];

function fakeDoor(): MonitorDoor {
  board = scriptedModelBoard({
    rows: [managedSummary({ runtimeRunId: "run-claude", kind: "claude", label: "Claude" })],
  });
  const status = { reachable: false, detail: "no index in this fixture", checkedAt: "2026-10-07" };
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
      snapshot: async () => ({ refreshedAt: "2026-10-07", entries: [] }),
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
  document.body.append(container);
  const caught = vi.fn();
  root = createRoot(container, { onCaughtError: caught, onUncaughtError: vi.fn() });
  await act(async () => root?.render(<GodviewOverlay />));
  await setView("godview");
  return container;
}

/** Re-render the stand-in deck, as a new fact reaching it would. */
async function nudgeDeck(): Promise<void> {
  await act(async () => {
    stand.tick += 1;
    for (const fn of stand.ticked) fn();
  });
  await settle();
}

const latest = (): GodviewMonitorFacts | undefined => markers.at(-1);
const statusIn = (host: ParentNode, selector: string): string | undefined =>
  host.querySelector(`${selector} > span[role="status"]`)?.textContent ?? undefined;

/** The monitor as mounted: its stage, its bar, and the view host's root. */
function monitorParts(host: HTMLElement) {
  return {
    stage: host.querySelector(".vf-godview-monitor-stage"),
    bar: host.querySelector(".vf-godview-header"),
    view: host.querySelector("[data-monitor-view-root]"),
  };
}

/** System control, toggled as the palette's act toggles it: the frame's run of
 * the door the overlay lends (`ChromeLayer`'s `runFrameAct`). */
async function toggleSystemControl(): Promise<void> {
  let ran = false;
  await act(async () => {
    ran = runSystemControl();
  });
  expect(ran, "Godview lends the palette no System control").toBe(true);
  await settle();
}

/** The SAME elements, by identity, and still in the document: nothing above the
 * failed piece remounted. */
function expectSameMonitor(host: HTMLElement, before: ReturnType<typeof monitorParts>): void {
  const after = monitorParts(host);
  for (const part of ["stage", "bar", "view"] as const) {
    expect(before[part], part).not.toBeNull();
    expect(after[part], part).toBe(before[part]);
    expect(after[part]?.isConnected, part).toBe(true);
  }
}

beforeEach(() => {
  stand.deckThrows = false;
  stand.panelThrows = false;
  stand.edgeThrows = false;
  stand.deckMounts = 0;
  stand.deckRenders = 0;
  stand.tick = 0;
  stand.ticked.clear();
  stand.door = fakeDoor();
  markers = [];
  localStorage.clear();
  for (const [name, value] of Object.entries(TOKENS)) {
    document.documentElement.style.setProperty(name, value);
  }
  vi.spyOn(console, "log").mockImplementation((line: unknown) => {
    if (typeof line === "string" && line.startsWith("GODVIEW_MONITOR ")) {
      markers.push(JSON.parse(line.slice("GODVIEW_MONITOR ".length)) as GodviewMonitorFacts);
    }
  });
  resetActiveViewForTest();
  resetGodviewFindDoorForTest();
  resetGodviewDeckDoorForTest();
  resetSystemControlDoorForTest();
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
  setHost({
    logger: {} as RendererLogger,
    platform: "darwin",
    view: {
      set: (view: FrameViewState["view"]) => Promise.resolve({ view }),
      onState: (handler: (state: FrameViewState) => void) => {
        publishView = handler;
        return () => undefined;
      },
    },
  } as unknown as FieldHost);
  disposeTerminalPool();
  configureTerminalPool({ transport: "routed", defaultShell: "/bin/zsh", home: "/home/tester" });
});

afterEach(() => {
  vi.useRealTimers();
  act(() => root?.unmount());
  container?.remove();
  root = null;
  container = null;
  board?.dispose();
  board = null;
  disposeTerminalPool();
  for (const name of Object.keys(TOKENS)) document.documentElement.style.removeProperty(name);
  vi.restoreAllMocks();
});

describe("the overlay's chrome cannot take down the monitor (M49)", () => {
  it("a throwing deck says Deck unavailable in its body; the monitor and its view stay, and the door goes with the deck (GT-D17)", async () => {
    const host = await mountOverlay();
    const before = monitorParts(host);
    expect(host.querySelector(".deck-stand-in")).not.toBeNull();
    expect(latest()?.localState).toBe("live");

    stand.deckThrows = true;
    await nudgeDeck();
    expect(statusIn(host, ".vf-godview-terminal-deck-body")).toBe("Deck unavailable");
    expect(host.querySelector(".deck-stand-in")).toBeNull();
    expectSameMonitor(host, before);
    // the deck built the door, and took it with it: the monitor stands on no-door
    expect(latest()?.localState).toBe("no-door");

    // An overlay render that hands the deck nothing new — System control
    // opening, the echo of the null door — is no reason to try it again: the
    // deck is not asked to render at all.
    const renders = stand.deckRenders;
    const toggle = host.querySelector<HTMLButtonElement>('button[aria-label="System control"]');
    await act(async () => toggle?.click());
    await settle();
    expect(document.getElementById("vf-godview-tweak-panel")).not.toBeNull();
    expect(stand.deckRenders).toBe(renders);
    expect(stand.deckMounts).toBe(1);
    // Godview closing and opening again is: the deck comes back with its door,
    // once, at the end of the boundary's first window at the latest
    stand.deckThrows = false;
    holdChromeClock();
    await setView("canvas");
    await setView("godview");
    await advanceChromeClock();
    await settle();
    expect(stand.deckMounts).toBe(2);
    expect(statusIn(host, ".vf-godview-terminal-deck-body")).toBeUndefined();
    expect(host.querySelector(".deck-stand-in")).not.toBeNull();
    expect(latest()?.localState).toBe("live");
  });

  it("a throwing System control says so; the monitor, its view and the deck stay, and closing it tries again", async () => {
    const host = await mountOverlay();
    const before = monitorParts(host);
    stand.panelThrows = true;
    const toggle = host.querySelector<HTMLButtonElement>('button[aria-label="System control"]');
    expect(toggle).not.toBeNull();
    await act(async () => toggle?.click());
    await settle();
    expect(statusIn(host, ".vf-godview")).toBe("System control unavailable");
    expect(document.getElementById("vf-godview-tweak-panel")).toBeNull();
    expectSameMonitor(host, before);
    expect(host.querySelector(".deck-stand-in")).not.toBeNull();
    expect(latest()?.localState).toBe("live");

    // closing the panel is a fact it is handed: it tries again (at the end of
    // the boundary's first window at the latest), and a closed panel draws nothing
    stand.panelThrows = false;
    holdChromeClock();
    await act(async () => toggle?.click());
    await settle();
    await advanceChromeClock();
    await settle();
    expect(statusIn(host, ".vf-godview")).toBeUndefined();
    await act(async () => toggle?.click());
    await settle();
    expect(document.getElementById("vf-godview-tweak-panel")).not.toBeNull();
  });

  it("lends the palette System control while Godview shows — the one verb, the same panel — and withdraws it when it closes (GV-D1)", async () => {
    const host = await mountOverlay();
    const door = getSystemControlDoor();
    expect(door).not.toBeNull();
    expect(document.getElementById("vf-godview-tweak-panel")).toBeNull();
    expect(host.querySelector(".vf-godview")?.getAttribute("data-godview-tuning-open")).toBe(
      "false",
    );
    await toggleSystemControl();
    const panel = document.getElementById("vf-godview-tweak-panel");
    expect(panel?.textContent).toContain("SYSTEM CONTROL");
    expect(host.querySelector(".vf-godview")?.getAttribute("data-godview-tuning-open")).toBe(
      "true",
    );
    // the door is the same object while Godview is open: a toggle republishes nothing
    expect(getSystemControlDoor()).toBe(door);
    await toggleSystemControl();
    expect(document.getElementById("vf-godview-tweak-panel")).toBeNull();
    // another view: the door goes, and a panel left open closes with Godview
    await toggleSystemControl();
    expect(document.getElementById("vf-godview-tweak-panel")).not.toBeNull();
    await setView("canvas");
    expect(getSystemControlDoor()).toBeNull();
    // with no door the frame's run is a no, never a throw
    expect(runSystemControl()).toBe(false);
    expect(document.getElementById("vf-godview-tweak-panel")).toBeNull();
    await setView("godview");
    expect(getSystemControlDoor()).not.toBeNull();
    expect(document.getElementById("vf-godview-tweak-panel")).toBeNull();
  });

  it("lends the frame's Peek its Live now while Godview shows, and withdraws it when it closes (P2 — Find left the stage)", async () => {
    const host = await mountOverlay();
    // no sheet of its own: the stage mounts no Find, and the bar has no FIND
    expect(host.querySelector(".vf-find-sheet")).toBeNull();
    expect(host.querySelector('button[aria-label="Find an agent by what was said"]')).toBeNull();
    await act(async () =>
      board?.publish([
        managedSummary({ runtimeRunId: "run-claude", kind: "claude", label: "Claude" }),
      ]),
    );
    await settle();
    const door = getGodviewFindDoor();
    expect(door).not.toBeNull();
    // the rows are made only while someone listens (the Peek open on Live now)
    expect(door?.rows()).toBeNull();
    const stop = door?.subscribeRows(() => undefined);
    await settle();
    expect(
      getGodviewFindDoor()
        ?.rows()
        ?.some((row) => row.agent?.provider.label === "Claude"),
    ).toBe(true);
    stop?.();
    await setView("canvas");
    expect(getGodviewFindDoor()).toBeNull();
  });

  it("says its terminals are up while Godview is the window's view, and nothing once it is not or is gone (round 3, L2 — the deck's door)", async () => {
    // before Godview has ever shown, nobody has spoken for the window
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container, { onCaughtError: vi.fn(), onUncaughtError: vi.fn() });
    await act(async () => root?.render(<GodviewOverlay />));
    expect(getGodviewDeck()).toBeNull();

    await setView("godview");
    // the deck is always up today: the state on the stage's root and the
    // door's word are the same fact
    const stage = container.querySelector(".vf-godview");
    expect(stage?.getAttribute("data-godview-deck")).toBe("up");
    expect(getGodviewDeck()).toBe("up");

    // another view: the stage stays mounted (sessions run on), the door is silent
    await setView("canvas");
    expect(container.querySelector(".vf-godview")).toBe(stage);
    expect(stage?.getAttribute("data-godview-open")).toBe("false");
    expect(getGodviewDeck()).toBeNull();

    await setView("godview");
    expect(getGodviewDeck()).toBe("up");

    // the overlay going away takes its word with it
    await act(async () => root?.unmount());
    root = null;
    expect(getGodviewDeck()).toBeNull();
  });

  it("a throwing deck edge says so in the lip's place; the monitor, its view and the deck stay", async () => {
    stand.edgeThrows = true;
    const host = await mountOverlay();
    expect(statusIn(host, ".vf-godview-terminal-deck")).toBe("Deck edge unavailable");
    expect(host.querySelector(".vf-godview-deck-lip")).toBeNull();
    const parts = monitorParts(host);
    expect(parts.stage).not.toBeNull();
    expect(parts.view?.isConnected).toBe(true);
    expect(host.querySelector(".deck-stand-in")).not.toBeNull();
    expect(latest()?.localState).toBe("live");
  });
});
