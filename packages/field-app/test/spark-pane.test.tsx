// @vitest-environment happy-dom
/**
 * SP-1d — THE THREAD'S PANE (DESIGN.md §8 "Chat's thread"; VF-PM's Q4, 2026-10-31): the spark's own floor session,
 * mounted in Chat's thread as the bare `TerminalSurface` on the window's terminal pool — read-write, in the deck's own
 * look, never claiming the pool. Its surface is `active` exactly while it holds the keyboard, so it takes the
 * session's size (DS-D5) on a press in it or Send's paste, and never at mount (critique finding 1). The runtime under
 * it is a double that records every call; the `TerminalSurface` above it is the real upstream component, because the
 * seat's rules are upstream's (`focusTakesGeometry`, `pressTakesGeometry`).
 */

import { AGENT_CATALOG, type AgentFieldRow, type SparkSummary } from "@vibefield/contracts";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ComposerPort } from "../src/chat/ChatComposer";
import type { FieldHost } from "../src/host";
import { setHost } from "../src/host";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/** Every call the pool's runtime received, in order. */
let runtimeCalls: { verb: string; args: readonly unknown[] }[] = [];
let sessions: unknown[] = [];
/** The floor's own refusal of a read of its sessions, while it gives one. */
let listRefusal: string | null = null;
/** Why the runtime's render backend will not warm, while it will not. */
let warmRefusal: string | null = null;
/** The routed activation each session's input is in, as the runtime would answer it. */
const activations = new Map<string, { inputAllowed: boolean }>();
const activationListeners = new Set<() => void>();

const SESSION = {
  id: "pty-vela",
  handle: "handle-vela",
  executable: "/bin/zsh",
  cols: 80,
  rows: 24,
  exited: false,
  readWrite: true,
  title: null,
  cwd: null,
  bellCount: 0,
  pid: 42,
  createdAtMs: 0,
  exitCode: null,
  exitSignal: null,
  requestedTermination: null,
  exitOutcome: null,
};

// The REAL `TerminalSurface` and `GhostteaProvider`; a FAKE runtime underneath.
vi.mock("@vibecook/ghosttea-react", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  const record =
    (verb: string) =>
    (...args: unknown[]): undefined => {
      runtimeCalls.push({ verb, args });
      return undefined;
    };
  return {
    ...actual,
    waitForGhostteaRendererPorts: () => new Promise(() => undefined),
    createGhostteaTerminalRuntime: () => ({
      connect: () => Promise.resolve(),
      dispose: record("dispose"),
      rendererBackend: "test",
      listSessions: () => {
        runtimeCalls.push({ verb: "listSessions", args: [] });
        return listRefusal === null
          ? Promise.resolve(sessions)
          : Promise.reject(new Error(listRefusal));
      },
      sessionMetadata: () => SESSION,
      mount: (...args: unknown[]) => {
        runtimeCalls.push({ verb: "mount", args });
        return { resize: record("mount.resize"), dispose: record("mount.dispose") };
      },
      resize: record("resize"),
      claimResizeControl: record("claimResizeControl"),
      takeResizeControl: record("takeResizeControl"),
      releaseResizeControl: record("releaseResizeControl"),
      setViewInputPolicy: record("setViewInputPolicy"),
      setFocused: record("setFocused"),
      setTheme: record("setTheme"),
      setSelection: record("setSelection"),
      sendKey: record("sendKey"),
      sendText: record("sendText"),
      paste: record("paste"),
      sendMouse: record("sendMouse"),
      scroll: record("scroll"),
      scrollTo: record("scrollTo"),
      interrupt: record("interrupt"),
      terminate: record("terminate"),
      unregisterSession: record("unregisterSession"),
      registerSession: record("registerSession"),
      copySelection: async () => "",
      setVisible: record("setVisible"),
      setEffects: record("setEffects"),
      scrollbar: () => undefined,
      isMouseTracking: () => false,
      routedActivation: (sessionId: string) => activations.get(sessionId),
      addEventListener: (type: string, listener: () => void) => {
        if (type === "routed-activation-state") activationListeners.add(listener);
      },
      removeEventListener: (type: string, listener: () => void) => {
        if (type === "routed-activation-state") activationListeners.delete(listener);
      },
      startPerformanceMeasurement: () =>
        warmRefusal === null ? Promise.resolve() : Promise.reject(new Error(warmRefusal)),
      finishPerformanceMeasurement: () => Promise.resolve({ backend: "test" }),
    }),
  };
});

vi.mock("@vibecook/ghosttea-react/terminal-render.worker.js?worker", () => ({
  default: class {},
}));

const pool = await import("../src/terminal/pool");
const { NO_TERMINALS } = await import("../src/terminal/terminal-words");
const { SparkPane } = await import("../src/chat/SparkPane");
const { sparkPaneOf, SPARK_WAKE_WAIT_MS } = await import("../src/chat/thread-pane-door");
const { godviewTerminalTheme, terminalGroundStyle } = await import("../src/godview/deck-theme");
const { getDeckAppearance } = await import("../src/godview/deck-appearance");
const { godviewThemeFor } = await import("../src/godview/godview-theme");
const { getAppTheme } = await import("../src/theme");
const { FielddProvider } = await import("@vibefield/fieldd-client/react");
const { ChatView } = await import("../src/chat/ChatView");
const { startSparksFeed } = await import("../src/chat/sparks-feed");

type PoolClient = Parameters<typeof pool.openTerminalPool>[0];
/** The floor's sessions as fieldd's roster lists them (`terminal.roster`). */
let rosterItems: unknown[] = [];
const fieldd = {
  status: "ready",
  onStatusChange: () => () => undefined,
  request: (method: string) =>
    Promise.resolve(
      method === "terminal.roster"
        ? { items: rosterItems }
        : { ticket: { token: "t", controlSocket: "c", frameSocket: "f" } },
    ),
} as unknown as PoolClient;

let root: Root | null = null;
let container: HTMLElement | null = null;

class InertResizeObserver {
  observe(): void {}
  disconnect(): void {}
  unobserve(): void {}
}

async function settle(): Promise<void> {
  for (let index = 0; index < 12; index += 1) await Promise.resolve();
}

beforeEach(() => {
  runtimeCalls = [];
  sessions = [SESSION];
  rosterItems = [];
  listRefusal = null;
  warmRefusal = null;
  activations.clear();
  activationListeners.clear();
  pool.disposeTerminalPool();
  pool.configureTerminalPool({
    transport: "routed",
    defaultShell: "/bin/zsh",
    home: "/Users/test",
  });
  (globalThis as { ResizeObserver?: unknown }).ResizeObserver = InertResizeObserver;
  setHost({
    platform: "darwin",
    logger: { child: () => ({ info: () => undefined, error: () => undefined }) },
    terminal: {
      connect: () => Promise.resolve({ defaultShell: "/bin/zsh", home: "/Users/test" }),
      onStatus: () => () => undefined,
    },
  } as unknown as FieldHost);
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  root = null;
  container = null;
  vi.useRealTimers();
  pool.disposeTerminalPool();
});

interface Mount {
  sessionId?: string | null;
  active?: boolean;
  onKeyboard?: () => void;
}

function draw({ sessionId = "pty-vela", active = true, onKeyboard }: Mount = {}) {
  return createElement(
    FielddProvider,
    { client: fieldd as never },
    createElement(SparkPane, {
      spark: "sp-vela0001",
      name: "Vela",
      sessionId,
      active,
      ...(onKeyboard === undefined ? {} : { onKeyboard }),
    }),
  );
}

/** Mount the pane on Vela's floor session, and let the pool warm and the floor answer. */
async function mountPane(options: Mount = {}): Promise<void> {
  await act(async () => {
    root?.render(draw(options));
    await settle();
  });
  await act(async () => {
    await settle();
  });
}

const pane = (): HTMLElement => {
  const element = container?.querySelector<HTMLElement>(".vf-chat-pane");
  if (element === null || element === undefined) throw new Error("no pane mounted");
  return element;
};
const input = (): HTMLTextAreaElement => {
  const element = container?.querySelector<HTMLTextAreaElement>(".terminal-input");
  if (element === null || element === undefined) throw new Error("no surface mounted");
  return element;
};
const calls = (verb: string): typeof runtimeCalls =>
  runtimeCalls.filter((call) => call.verb === verb);

describe("the thread's pane is the spark's own floor session, read-write (SP-1d)", () => {
  it("mounts the session's surface on the window's runtime, warming the pool and never claiming it", async () => {
    await mountPane();
    expect(pane().getAttribute("data-pane-state")).toBe("live");
    // It really did attach: a pane that never mounted would pass every assertion below by doing nothing.
    expect(calls("mount")).toHaveLength(1);
    // The sign-in terminal's rule: the deck stays the only consumer that opens and restores panes.
    expect(pool.terminalPoolSnapshot().claimed).toBe(false);
    expect(pool.terminalPoolSnapshot().runtime).not.toBeNull();
    // It takes input: Return is James's, in this pane.
    expect(input().readOnly).toBe(false);
    expect(calls("setViewInputPolicy").every((call) => call.args[1] !== false)).toBe(true);
  });

  it("is drawn in the deck's own look: the session is handed the theme the deck hands it, on the terminal's ground", async () => {
    await mountPane();
    const appearance = getDeckAppearance();
    const theme = godviewTerminalTheme(
      appearance,
      godviewThemeFor(getAppTheme().resolved, appearance),
    );
    const themes = calls("setTheme");
    expect(themes.length).toBeGreaterThan(0);
    for (const call of themes) expect(call.args[1]).toEqual(theme);
    // the well is painted in that theme's own ground, projected as the deck sheet's is
    const ground = terminalGroundStyle(theme);
    expect(pane().style.getPropertyValue("--vf-godview-terminal-bg")).toBe(
      ground["--vf-godview-terminal-bg"],
    );
  });

  it("declares live demand while Chat is the view, none under another view's cover, and none once it goes", async () => {
    await mountPane();
    expect(pool.terminalSessionDemand("pty-vela")).toBe("live");
    await mountPane({ active: false });
    expect(pool.terminalSessionDemand("pty-vela")).toBe("none");
    await act(async () => {
      root?.render(null);
      await settle();
    });
    expect(pool.terminalPoolViewCount()).toBe(0);
  });
});

describe("the pane takes the session's size when it takes the keyboard, never at mount (DS-D5; critique 1)", () => {
  it("at mount: the caret stays where it was, and only an empty seat is claimed", async () => {
    const before = document.activeElement;
    await mountPane();
    expect(document.activeElement).toBe(before);
    expect(document.activeElement).not.toBe(input());
    expect(calls("claimResizeControl")).toHaveLength(1);
    expect(calls("takeResizeControl")).toEqual([]);
  });

  it("mounted under another view's cover it claims no seat, and claims the empty one once Chat shows it", async () => {
    await mountPane({ active: false });
    expect(pane().getAttribute("data-pane-state")).toBe("live");
    expect(calls("mount")).toHaveLength(1);
    expect(calls("claimResizeControl")).toEqual([]);
    expect(calls("resize")).toEqual([]);
    await mountPane({ active: true });
    expect(calls("claimResizeControl")).toHaveLength(1);
    expect(calls("takeResizeControl")).toEqual([]);
    // hidden again, it keeps the seat it holds: no release until the pane goes
    const releases = calls("releaseResizeControl").length;
    await mountPane({ active: false });
    expect(calls("releaseResizeControl")).toHaveLength(releases);
    expect(calls("mount")).toHaveLength(1);
  });

  it("takes the seat once on a press in the pane", async () => {
    await mountPane();
    await act(async () => {
      input().dispatchEvent(
        new PointerEvent("pointerdown", { bubbles: true, pointerId: 1, button: 0 }),
      );
      await settle();
    });
    expect(document.activeElement).toBe(input());
    const takes = calls("takeResizeControl");
    expect(takes).toHaveLength(1);
    expect(takes[0]?.args[0]).toBe("handle-vela");
    expect(takes[0]?.args.slice(2)).toEqual([80, 24]);
  });

  it("takes the seat once on Send's paste, which pastes through the surface's own road and presses no Return", async () => {
    activations.set("pty-vela", { inputAllowed: true });
    await mountPane();
    const door = sparkPaneOf("sp-vela0001")?.door;
    expect(door).toBeTruthy();
    let taken = false;
    await act(async () => {
      taken = door?.paste("look at the failing test") ?? false;
      await settle();
    });
    expect(taken).toBe(true);
    expect(document.activeElement).toBe(input());
    expect(calls("takeResizeControl")).toHaveLength(1);
    expect(calls("paste").map((call) => call.args.at(-1))).toContain("look at the failing test");
    expect(calls("sendKey")).toEqual([]);
    // the seat is taken BEFORE the text lands, so the paste goes in at the thread's own grid (DESIGN.md §8 "Chat's
    // composer": "The pane takes the keyboard just before the paste … so it takes the session's size")
    const verbs = runtimeCalls.map((call) => call.verb);
    expect(verbs.indexOf("takeResizeControl")).toBeGreaterThanOrEqual(0);
    expect(verbs.indexOf("takeResizeControl")).toBeLessThan(verbs.indexOf("paste"));
  });

  it("says when it takes the keyboard — a press in it, or Send's paste — and never at mount (the thread's hello leaves)", async () => {
    activations.set("pty-vela", { inputAllowed: true });
    const onKeyboard = vi.fn();
    await mountPane({ onKeyboard });
    expect(onKeyboard).not.toHaveBeenCalled();
    await act(async () => {
      input().dispatchEvent(
        new PointerEvent("pointerdown", { bubbles: true, pointerId: 1, button: 0 }),
      );
      await settle();
    });
    expect(onKeyboard).toHaveBeenCalledTimes(1);

    // a pane that has not held it yet, taken by Send's paste
    act(() => root?.unmount());
    root = container === null ? null : createRoot(container);
    const pasted = vi.fn();
    await mountPane({ onKeyboard: pasted });
    expect(pasted).not.toHaveBeenCalled();
    await act(async () => {
      sparkPaneOf("sp-vela0001")?.door?.paste("look at the failing test");
      await settle();
    });
    expect(pasted).toHaveBeenCalledTimes(1);
  });

  it("gives the keyboard back when focus leaves the pane, and keeps the seat until another pane takes it", async () => {
    await mountPane();
    const elsewhere = document.createElement("button");
    document.body.appendChild(elsewhere);
    await act(async () => {
      input().dispatchEvent(
        new PointerEvent("pointerdown", { bubbles: true, pointerId: 1, button: 0 }),
      );
      await settle();
    });
    await act(async () => {
      elsewhere.focus();
      await settle();
    });
    expect(document.activeElement).toBe(elsewhere);
    // one take, and no second for the leave: the seat moves only when another pane takes it (LWW)
    expect(calls("takeResizeControl")).toHaveLength(1);
    expect(calls("setFocused").at(-1)?.args[2]).toBe(false);
    elsewhere.remove();
  });
});

describe("the pane's door, for Send (thread-pane-door.ts)", () => {
  it("hands nothing over while the session's routed input is closed, and waits for it to open", async () => {
    await mountPane();
    const report = sparkPaneOf("sp-vela0001");
    expect(report?.state).toBe("live");
    expect(report?.door?.paste("hello")).toBe(false);
    expect(calls("paste")).toEqual([]);
    const opened = report?.door?.whenInputOpen(1_500);
    activations.set("pty-vela", { inputAllowed: true });
    for (const listener of activationListeners) listener();
    await expect(opened).resolves.toBe(true);
  });

  it("is published only while Chat is the view, and withdrawn when the pane goes", async () => {
    await mountPane({ active: false });
    expect(sparkPaneOf("sp-vela0001")).toBeNull();
    await mountPane();
    expect(sparkPaneOf("sp-vela0001")?.state).toBe("live");
    await act(async () => {
      root?.render(null);
      await settle();
    });
    expect(sparkPaneOf("sp-vela0001")).toBeNull();
  });
});

describe("when there is no pane to draw, its place says why, never a blank", () => {
  it("an awake spark whose terminal fieldd has not named yet is being found, never off the floor, for 20 s", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    await mountPane({ sessionId: null });
    expect(pane().getAttribute("data-pane-state")).toBe("finding");
    expect(pane().textContent).toBe("Finding Vela's pane…");
    expect(sparkPaneOf("sp-vela0001")).toEqual({ state: "finding", door: null });
    await act(async () => {
      vi.advanceTimersByTime(SPARK_WAKE_WAIT_MS - 1);
      await settle();
    });
    expect(pane().getAttribute("data-pane-state")).toBe("finding");
    await act(async () => {
      vi.advanceTimersByTime(1);
      await settle();
    });
    expect(pane().getAttribute("data-pane-state")).toBe("gone");
    expect(pane().textContent).toBe("Vela's terminal is not on this desktop's floor.");
    expect(sparkPaneOf("sp-vela0001")?.state).toBe("gone");
  });

  it("a terminal named later mounts, its 20 s counted afresh", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    await mountPane({ sessionId: null });
    await act(async () => {
      vi.advanceTimersByTime(SPARK_WAKE_WAIT_MS - 1_000);
      await settle();
    });
    await mountPane({ sessionId: "pty-vela" });
    expect(pane().getAttribute("data-pane-state")).toBe("live");
  });

  it("a session the floor does not hold is not on this desktop's floor once the floor answers, and asks for no demand", async () => {
    sessions = [];
    await mountPane();
    // the pool's join asks the floor a few times over ~100 ms before it answers "no such session" (an inventory that
    // lags a birth): no 20 s wait
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 250));
    });
    expect(pane().getAttribute("data-pane-state")).toBe("gone");
    expect(pane().textContent).toBe("Vela's terminal is not on this desktop's floor.");
    expect(calls("mount")).toEqual([]);
    expect(pool.terminalPoolViewCount()).toBe(0);
  });

  it("a session the floor lists later, once its sessions are read again, mounts", async () => {
    sessions = [];
    await mountPane();
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 250));
    });
    expect(pane().getAttribute("data-pane-state")).toBe("gone");
    // the deck reads the floor's sessions again, and the spark's terminal is there now
    sessions = [SESSION];
    rosterItems = [{ sessionId: "pty-vela", workloadClass: "agent", health: "live" }];
    await act(async () => {
      await pool.refreshTerminalRoster();
      await settle();
    });
    await act(async () => {
      await settle();
    });
    expect(pane().getAttribute("data-pane-state")).toBe("live");
    expect(calls("mount")).toHaveLength(1);
  });

  it("a floor that does not answer is a fault in its own words, never off the floor, and is asked again", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    listRefusal = "studio did not answer in 5 s";
    await mountPane();
    // the pool's join tries a few times over ~100 ms before it gives the floor's own refusal
    await act(async () => {
      await vi.advanceTimersByTimeAsync(200);
    });
    expect(pane().getAttribute("data-pane-state")).toBe("fault");
    expect(pane().textContent).toBe("Couldn't find Vela's pane: studio did not answer in 5 s");
    expect(sparkPaneOf("sp-vela0001")).toEqual({
      state: "fault",
      reason: "studio did not answer in 5 s",
      door: null,
    });
    // a floor that did not answer never lapses into "not on this desktop's floor"
    await act(async () => {
      await vi.advanceTimersByTimeAsync(SPARK_WAKE_WAIT_MS);
    });
    expect(pane().getAttribute("data-pane-state")).toBe("fault");
    // the floor answers again, and its sessions are read again: the pane is drawn
    listRefusal = null;
    rosterItems = [{ sessionId: "pty-vela", workloadClass: "agent", health: "live" }];
    await act(async () => {
      await pool.refreshTerminalRoster();
      await vi.advanceTimersByTimeAsync(50);
    });
    expect(pane().getAttribute("data-pane-state")).toBe("live");
  });

  it("a window whose terminals could not start says so in the pool's own words, never off the floor", async () => {
    warmRefusal = "no GPU adapter";
    await mountPane();
    await act(async () => {
      await settle();
    });
    expect(pool.terminalPoolSnapshot().phase).toBe("spent");
    expect(pane().getAttribute("data-pane-state")).toBe("fault");
    expect(pane().textContent).toBe("Couldn't find Vela's pane: no GPU adapter");
  });

  it("a window with no terminals says the Peek's words, and touches no runtime", async () => {
    pool.disposeTerminalPool();
    expect(pool.terminalPoolConfigured()).toBe(false);
    await mountPane();
    expect(pane().getAttribute("data-pane-state")).toBe("no-terminals");
    expect(pane().textContent).toBe(NO_TERMINALS);
    expect(sparkPaneOf("sp-vela0001")).toEqual({ state: "no-terminals", door: null });
    expect(runtimeCalls).toEqual([]);
  });
});

describe("Chat hands the pane's keyboard to the thread's hello (ChatView; DESIGN.md §8 \"Chat's thread\")", () => {
  const AT = "2026-10-31T05:00:00.000Z";
  const AGENT = AGENT_CATALOG[0];
  /** Vela just hatched: awake on the floor session this file's runtime holds, her run up and idle, no turn taken. */
  const VELA: SparkSummary = {
    id: "sp-vela0001",
    name: "Vela",
    face: { seed: 7 },
    agent: AGENT.id,
    profiles: ["native"],
    thinksUnder: "native",
    folder: "/f/vela",
    createdAt: AT,
    updatedAt: AT,
    session: { runtimeRunId: "run-Vela", terminalSessionId: "pty-vela", live: true },
  };
  const OWN: AgentFieldRow = {
    runtimeRunId: "run-Vela",
    revision: 1,
    kind: AGENT.id,
    label: AGENT.label,
    tier: "managed",
    device: "dev-1",
    status: "idle",
    statusSince: AT,
    stateChangedAt: AT,
    createdAt: AT,
    alive: true,
    blockers: [],
    spark: VELA.id,
    terminal: { hosted: "local", runtimeSessionId: "pty-vela" },
  };
  const PORT: ComposerPort = {
    providers: async () => [],
    profileSets: async () => [],
    models: async () => {
      throw new Error("no picker here");
    },
  };
  let stopFeed: (() => void) | null = null;
  afterEach(() => {
    stopFeed?.();
    stopFeed = null;
  });

  const hello = (): Element | null => container?.querySelector(".vf-chat-hello") ?? null;
  /** Type into the draft as the browser leaves it: the text in the editor, the caret at its end, an input event. */
  function typeText(text: string): void {
    act(() => {
      const field = container?.querySelector<HTMLElement>(".vf-chat-input");
      if (field === null || field === undefined) throw new Error("no draft");
      field.focus();
      field.textContent = "";
      const node = document.createTextNode(text);
      field.append(node);
      const range = document.createRange();
      range.setStart(node, node.length);
      range.collapse(true);
      window.getSelection()?.removeAllRanges();
      window.getSelection()?.addRange(range);
      field.dispatchEvent(new Event("input", { bubbles: true }));
    });
  }

  it("a press in the pane takes the hello away for the window's life: an emptied draft does not bring it back", async () => {
    stopFeed = startSparksFeed({
      list: async () => [VELA],
      watch: async (onFrame) => {
        onFrame({ revision: 1, rows: [OWN] }, "snapshot");
        return () => undefined;
      },
      watchNeeds: async (onItems) => {
        onItems([]);
        return () => undefined;
      },
      open: async () => VELA,
    });
    await act(async () => {
      root?.render(
        createElement(
          FielddProvider,
          { client: fieldd as never },
          createElement(ChatView, {
            active: true,
            surface: null,
            onSurfaceChange: () => undefined,
            port: PORT,
          }),
        ),
      );
      await settle();
    });
    await act(async () => {
      await settle();
    });
    expect(pane().getAttribute("data-pane-state")).toBe("live");
    expect(hello()).not.toBeNull();
    await act(async () => {
      input().dispatchEvent(
        new PointerEvent("pointerdown", { bubbles: true, pointerId: 1, button: 0 }),
      );
      await settle();
    });
    expect(hello()).toBeNull();
    // the keyboard back in the draft, a character typed and taken away: the hello stays gone
    typeText("h");
    typeText("");
    expect(container?.querySelector(".vf-chat-input")?.textContent).toBe("");
    expect(hello()).toBeNull();
  });
});
