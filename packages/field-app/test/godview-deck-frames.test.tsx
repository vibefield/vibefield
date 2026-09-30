// @vitest-environment happy-dom
/**
 * THE DECK WEARS THE RECORD'S FRAME (GT-6).
 *
 * The frame itself is `@vibecook/puppeteer-views`' since PU-14 and is tested
 * upstream; what is under test here is everything VibeField owns at that seam:
 * which pane gets which agent's facts, what the three verbs actually do, where
 * a remote device's name comes from, and that the deck element is marked so the
 * package's own stylesheet applies at all.
 *
 * The library is stubbed the way `godview-deck.test.tsx` stubs it, with ONE
 * deliberate difference: this fixture's workspace RENDERS pane elements, because
 * a frame is a portal into one. Everything else — the routed floor, the shell
 * policy, the host — is the same fixture floor, and the fold arrives through the
 * provider the overlay mounts in production.
 */

import {
  monitorParameterDefaults,
  monitorViewFor,
  useMonitorPalette,
} from "@vibecook/puppeteer-views";
import { FielddRpcError } from "@vibefield/fieldd-client";
import {
  act,
  type ComponentType,
  type CSSProperties,
  type ReactElement,
  useMemo,
  useState,
} from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentSessionSummary } from "../src/godview/monitor/facet-types";
import type { MonitorDoor } from "../src/godview/monitor/remote-door";
import { type MonitorPaneFacts, useMonitorAgents } from "../src/godview/monitor/useMonitorAgents";
import type { FieldHost } from "../src/host";
import { setHost } from "../src/host";
import type { RendererLogger } from "../src/logging";
import { setRendererLogger } from "../src/logging";
import { managedSummary } from "./managed-session-fixture";
import { bornSummary, routedTicket } from "./routed-terminal-fixture";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/** One pane the fixture workspace lays out, and the session it shows. */
interface StubSession {
  id: string;
  exited: boolean;
  exitOutcome: "completed" | "crashed" | null;
  cwd: string | null;
  cols: number;
  rows: number;
  activity: { kind: string };
}
interface StubPane {
  id: string;
  session: StubSession;
}

function stubSession(id: string, overrides: Partial<StubSession> = {}): StubSession {
  return {
    id,
    exited: false,
    exitOutcome: null,
    cwd: "/home/tester/vibe-field",
    cols: 80,
    rows: 24,
    activity: { kind: "shell-idle" },
    ...overrides,
  };
}

/** The workspace's state, mutable from the test and from the deck's own door. */
const workspace = {
  panes: [] as StubPane[],
  activePaneId: "",
  /** Every session the deck asked the workspace to show, in order. */
  mounts: [] as string[],
  /** Ghosttea's concurrent-birth fence, closed: `createSessionInActivePane`
   * answers `undefined` without asking the override at all. */
  fenced: false,
  /** The live context's `mountSession`, so a test can land a birth the way
   * ghosttea lands what `createSplitSession` answers. */
  mount: (_summary: { id: string; cwd?: string | null }): void => undefined,
  refresh: (): void => undefined,
};

/**
 * Ghosttea's workspace, as much of it as a frame needs: the panes as real
 * elements carrying the class and the `data-pane-id` the mounter looks for, the
 * context published through the sidebar slot (the only seam an embedder gets),
 * and the two verbs the deck drives it with. The context object is memoized on
 * a version counter because the deck republishes on identity — a fresh one per
 * render would be an infinite loop, which is exactly what the real library
 * avoids by memoizing its own.
 */
function WorkspaceStub({
  sidebar: Sidebar,
  decoratePane,
  paneVisibility,
}: {
  sidebar: ComponentType<{ workspace: unknown }>;
  paneVisibility?: Readonly<Record<string, boolean>>;
  decoratePane?: (
    session: StubSession,
    paneId: string,
  ) => { color?: string; label?: string } | undefined;
}): ReactElement {
  const [version, setVersion] = useState(0);
  const context = useMemo(
    () => ({
      panes: workspace.panes,
      sessions: workspace.panes.map((pane) => pane.session),
      activePaneId: workspace.activePaneId,
      activeSession: workspace.panes.find((pane) => pane.id === workspace.activePaneId)?.session,
      replaceSession: (expectedId: string, summary: StubSession) => {
        const targets = workspace.panes.filter((pane) => pane.session.id === expectedId);
        if (targets.length === 0) return false;
        for (const pane of targets) pane.session = stubSession(summary.id, summary);
        workspace.mounts.push(summary.id);
        setVersion((current) => current + 1);
        return true;
      },
      createSessionInActivePane: async () => {
        const active = workspace.panes.find((pane) => pane.id === workspace.activePaneId)!;
        const create = workspaceProps["createSplitSession"] as (
          session: StubSession,
          axis: "horizontal" | "vertical",
        ) => Promise<StubSession>;
        // Ghosttea's own shape (its Workspace.js): the override is called
        // first and synchronously, and its throw is caught and answered
        // `undefined` — the swallow SB-3's door has to see through.
        if (workspace.fenced) return undefined;
        try {
          const born = await create(active.session, "horizontal");
          workspace.mount(born);
          return born;
        } catch {
          return undefined;
        }
      },
      mountSession: (summary: { id: string; cwd?: string | null; exited?: boolean }) => {
        workspace.mounts.push(summary.id);
        const pane = workspace.panes.find((entry) => entry.id === workspace.activePaneId);
        if (pane !== undefined) {
          pane.session = stubSession(summary.id, {
            cwd: summary.cwd ?? null,
            exited: summary.exited === true,
          });
        }
        setVersion((current) => current + 1);
      },
      activateSession: (sessionId: string) => {
        const pane = workspace.panes.find((entry) => entry.session.id === sessionId);
        if (pane !== undefined) workspace.activePaneId = pane.id;
        setVersion((current) => current + 1);
      },
    }),
    [version],
  );
  workspace.mount = context.mountSession;
  workspace.refresh = () => setVersion((current) => current + 1);
  return (
    <>
      <Sidebar workspace={context} />
      {/* Fullscreen measures the library's terminal stage. */}
      <div className="ghostty-window terminal-host">
        {workspace.panes.map((pane) => {
          // The accent layer is ghosttea's, and the library draws it only for a
          // pane the host DEALT a colour — through this very prop. Hard-coding
          // it on every stub pane was more generous than the library, and since
          // PU-14b it is also a visible difference: the frame's line and glow
          // take the project colour under `[data-pane-accent]` and the
          // terminal's ink without it.
          const face = decoratePane?.(pane.session, pane.id);
          return (
            <div
              key={pane.id}
              className={`ghostty-pane${pane.id === workspace.activePaneId ? " is-active" : ""}`}
              data-pane-id={pane.id}
              data-workspace-visible={paneVisibility?.[pane.id] !== false}
              {...(face?.color !== undefined ? { "data-pane-accent": "" } : {})}
              style={
                face?.color !== undefined
                  ? ({ "--ghostty-pane-color": face.color } as CSSProperties)
                  : undefined
              }
            />
          );
        })}
      </div>
    </>
  );
}

vi.mock("@vibecook/ghosttea-react", () => ({
  // QL-2: the deck hands the launch ghosttea's fixed cell metrics.
  CELL_WIDTH: 7.83,
  LINE_HEIGHT: 19,
  ORIGIN_X: 2,
  ORIGIN_Y: 2,
  createGhostteaTerminalRuntime: () => ({
    addEventListener: (type: string, listener: EventListener) =>
      runtimeEvents.addEventListener(type, listener),
    removeEventListener: (type: string, listener: EventListener) =>
      runtimeEvents.removeEventListener(type, listener),
    rendererBackend: "test",
    dispose: () => undefined,
    connect: () => Promise.resolve(),
    startPerformanceMeasurement: () => Promise.resolve(),
    finishPerformanceMeasurement: () => Promise.resolve({ backend: "test" }),
    listSessions: () => Promise.resolve(workspace.panes.map((pane) => ({ id: pane.session.id }))),
    createSession: () => Promise.resolve({ id: "s-created" }),
    registerSession: () => undefined,
    listRemoteHosts: () => Promise.resolve([]),
    openRemoteSession: (deviceId: string, remoteSessionId: string) =>
      Promise.resolve({
        id: `replica-${deviceId}-${remoteSessionId}`,
        cwd: "/Users/peer/src/truffle",
        exited: false,
        readWrite: true,
      }),
    terminate: () => undefined,
    sessionCreatedHere: (id: string) => runtimeBirths.has(id),
    sessionHasInput: (id: string) => usedSessions.has(id),
    remoteSession: (id: string) => (remoteSessions.has(id) ? {} : undefined),
  }),
  waitForGhostteaRendererPorts: () => new Promise(() => undefined),
  GhostteaProvider: ({ children }: { children: unknown }) => children,
}));

vi.mock("@vibecook/ghosttea-react/terminal-render.worker.js?worker", () => ({
  default: class {},
}));

vi.mock("@vibecook/ghosttea-react/workspace", () => ({
  GhostteaWorkspace: (props: Record<string, unknown>) => {
    // The props the deck hands the library, kept so a test can ask its birth
    // doors the way the workspace asks them.
    workspaceProps = props;
    return (
      <WorkspaceStub
        sidebar={props["sidebar"] as ComponentType<{ workspace: unknown }>}
        paneVisibility={props["paneVisibility"] as Readonly<Record<string, boolean>>}
        decoratePane={
          props["decoratePane"] as (
            session: StubSession,
            paneId: string,
          ) => { color?: string; label?: string } | undefined
        }
      />
    );
  },
  GHOSTTY_COLOR_THEMES: [],
  isGhostteaShaderEffect: () => false,
  TERMINAL_THEMES: {
    daylight: {
      background: [0.925, 0.91, 0.86, 1],
      foreground: [0.12, 0.12, 0.12, 1],
      cursor: [0.12, 0.12, 0.12, 1],
      selection: [0.3, 0.3, 0.3, 1],
      selectionForeground: [1, 1, 1, 1],
    },
    midnight: {
      background: [0.157, 0.173, 0.204, 1],
      foreground: [1, 1, 1, 1],
      cursor: [1, 1, 1, 1],
      selection: [0.3, 0.3, 0.3, 1],
      selectionForeground: [1, 1, 1, 1],
    },
  },
}));

const { configureTerminalPool, disposeTerminalPool, retryTerminalPool, terminalPoolSnapshot } =
  await import("../src/terminal/pool");
const { GodviewDeck } = await import("../src/godview/GodviewDeck");
const { GodviewMonitor } = await import("../src/godview/GodviewMonitor");
const { GodviewAgentsProvider } = await import("../src/godview/monitor/GodviewAgentsProvider");
const { launcherOwnsKeyEvent, launcherOwnsKeys, resetLauncherKeys, setMonitorHoldsKeys } =
  await import("../src/godview/monitor/launcher-keys");
type RemoteSessionDoor = import("../src/godview/monitor/remote-door").RemoteSessionDoor;

let root: Root | null = null;
let container: HTMLElement | null = null;
let requests: Array<{ method: string; params: unknown }> = [];
/** What `agent.interrupt` answers with — or, when it is an Error, throws. */
let interruptAnswer: unknown = { accepted: true };
let terminateAnswer: Promise<unknown> | undefined;
let createAnswer: Promise<unknown> | undefined;
/** SB-2's fieldd answers a bound create with the set it applied; an older one
 * ignores the field and births unbound (`false`). */
let bindsProfiles = true;
/** SB-3 — what `agents.profileSets.subscribe` answers; null: no feed (the
 * subscription is refused, as a fixture without one always was). */
let profileSetsFeed: unknown[] | null = null;
/** Agents the fixture's `agent.providers` lists beside Claude. */
let extraProviders: unknown[] = [];
let spawnGate: Promise<void> | undefined;
let rosterRows: Array<{ sessionId: string; workloadClass: string; health: string }> = [];
const runtimeBirths = new Set<string>();
const runtimeEvents = new EventTarget();
const usedSessions = new Set<string>();
const remoteSessions = new Set<string>();
let deckDoor: RemoteSessionDoor | null = null;
/** What the fold's `observe` is currently answering with. */
let foldRows: readonly AgentSessionSummary[] = [];
let foldFrame: ((rows: readonly AgentSessionSummary[]) => void) | null = null;
/** The props the deck handed the workspace — its birth doors live there. */
let workspaceProps: Record<string, unknown> = {};
/** Every renderer log line the deck wrote, with its level. */
let logged: Array<{ level: "info" | "error"; event: string; message: string }> = [];

const fieldd = {
  request: (method: string, params?: unknown): Promise<unknown> => {
    requests.push({ method, params });
    if (method === "terminal.roster") return Promise.resolve({ items: rosterRows });
    if (method === "terminal.terminate")
      return terminateAnswer ?? Promise.resolve({ terminated: true });
    if (method === "terminal.openTicket") {
      return Promise.resolve(routedTicket((params as { sessionId: string }).sessionId));
    }
    if (method === "terminal.create") {
      if (createAnswer) return createAnswer;
      const profileSet = (params as { profileSet?: string } | undefined)?.profileSet;
      return Promise.resolve({
        sessionId: "born-1",
        // A shell that has not drawn its first prompt has announced no OSC 7,
        // so the floor reports no cwd — which is the case `fallbackCwd` is for.
        // (ERRATA 2026-09-25, GT-8b: a ghosttea 0.12.0 floor reports the spawn
        // directory from creation, so this `cwd: null` is an older floor's.)
        session: bornSummary("born-1", { cwd: null }),
        ...routedTicket("born-1"),
        ...(profileSet !== undefined && bindsProfiles ? { profileSet } : {}),
      });
    }
    if (method === "agent.interrupt") {
      return interruptAnswer instanceof Error
        ? Promise.reject(interruptAnswer)
        : Promise.resolve(interruptAnswer);
    }
    if (method === "agent.resume") {
      const resumed = managedSummary({
        runtimeRunId: "run-2",
        terminalSessionId: "pty-resumed",
        kind: "codex",
        label: "Codex",
      });
      return Promise.resolve({
        session: resumed,
        terminal: {
          sessionId: "pty-resumed",
          session: bornSummary("pty-resumed", { cwd: "/home/tester/rosetta" }),
          ...routedTicket("pty-resumed"),
        },
      });
    }
    // QL-1 — the empty pane launcher's doors.
    if (method === "agent.providers") {
      return Promise.resolve({ providers: [...LAUNCHER_PROVIDERS, ...extraProviders] });
    }
    if (method === "agent.spawn") {
      const spawned = managedSummary({
        runtimeRunId: "run-launched",
        terminalSessionId: "pty-launched",
      });
      return (spawnGate ?? Promise.resolve()).then(() => ({
        session: spawned,
        terminal: {
          sessionId: "pty-launched",
          session: bornSummary("pty-launched", { cwd: "/home/tester/vibe-field" }),
          ...routedTicket("pty-launched"),
        },
      }));
    }
    if (method === "index.recent") return Promise.resolve({ rows: [] });
    if (method === "index.status") return Promise.reject(new Error("no status in this fixture"));
    return Promise.reject(new Error(`unexpected method ${method}`));
  },
  subscribe: (method: string): Promise<unknown> => {
    if (method === "agents.profileSets.subscribe" && profileSetsFeed !== null) {
      return Promise.resolve({
        subId: "profile-sets",
        snapshot: { sets: profileSetsFeed, signIn: [], identity: [], signOut: [], reading: false },
        unsubscribe: () => undefined,
      });
    }
    return Promise.reject(new Error(`unexpected subscription ${method}`));
  },
};

/** QL-1: one agent the launcher can start, as `agent.providers` answers it. */
const LAUNCHER_PROVIDERS = [
  {
    id: "claude",
    label: "Claude Code",
    available: true,
    resumable: true,
    personas: [],
    status: "supported",
    offers: { spawn: true, resume: true },
  },
];

vi.mock("@vibefield/fieldd-client/react", () => ({
  useFielddClient: () => fieldd,
}));

/** The fold, as the overlay feeds it: the deck's own door would carry it in
 * production, and a fake one carries it here — the routing is ours, the
 * transport is not this fixture's subject. */
function foldDoor(): MonitorDoor {
  return {
    listHosts: vi.fn(async () => []),
    attach: vi.fn(async () => ({ state: "no-pane" as const })),
    observe: ({ onFrame }) => {
      foldFrame = onFrame;
      onFrame(foldRows);
      return () => {
        foldFrame = null;
      };
    },
    createTerminal: vi.fn(async () => ({ state: "no-pane" as const })),
    mountLocal: vi.fn(async (sessionId: string) => ({ state: "mounted" as const, sessionId })),
    history: {
      status: async () => ({ reachable: false, detail: "no index", checkedAt: "2026-09-13" }),
      facts: async () => [],
      search: async () => ({
        status: { reachable: false, detail: "no index", checkedAt: "2026-09-13" },
        answered: false,
        hits: [],
        clipped: false,
      }),
    },
    usage: {
      snapshot: async () => ({ refreshedAt: "2026-09-13", entries: [] }),
      subscribe: () => () => undefined,
    },
  };
}

function installHost(): void {
  // RECORDED, not silenced: the difference between "fieldd refused this state"
  // and "fieldd could not be reached" is a log level and an event name, and
  // that difference is the whole of the GT-6 review's M1.
  const record = (level: "info" | "error") => (event: string, message: string) =>
    logged.push({ level, event, message });
  setRendererLogger({
    child: () =>
      ({
        trace: () => undefined,
        debug: () => undefined,
        info: record("info"),
        warn: () => undefined,
        error: record("error"),
        fatal: () => undefined,
      }) as unknown as RendererLogger,
  } as unknown as RendererLogger);
  setHost({
    logger: {} as RendererLogger,
    getConnection: () => Promise.resolve({ port: 1, token: "t" }),
    onPrepareClose: () => () => undefined,
    completeClose: () => undefined,
    platform: "darwin",
    godview: { set: () => Promise.resolve({ open: false }), onState: () => () => undefined },
  } as unknown as FieldHost);
}

async function settle(): Promise<void> {
  // Theme facts follow DOM mutations through a MutationObserver task.
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
  for (let i = 0; i < 6; i++) {
    await act(async () => {
      await Promise.resolve();
    });
  }
}

function PaneLinks({ panes }: { panes: MonitorPaneFacts }): ReactElement {
  const palette = useMonitorPalette();
  const { agents } = useMonitorAgents({ palette, panes });
  return (
    <div>
      {agents.map((agent) => (
        <output
          key={agent.id}
          data-session={agent.session?.id ?? agent.floorSessionId}
          data-visual-id={agent.visualId}
          data-pane-color={agent.attachment?.color}
          data-palette-lightness={palette.tint.l}
        />
      ))}
    </div>
  );
}

function DeckScene(): ReactElement {
  const [panes, setPanes] = useState<MonitorPaneFacts>({ sessionIds: [] });
  return (
    <>
      <GodviewDeck
        active
        theme="light"
        onPanes={setPanes}
        onRemoteDoor={(next) => {
          deckDoor = next;
        }}
      />
      <PaneLinks panes={panes} />
    </>
  );
}

async function mountDeck(): Promise<HTMLElement> {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root?.render(
      <GodviewAgentsProvider door={foldDoor()}>
        <DeckScene />
      </GodviewAgentsProvider>,
    );
  });
  await settle();
  return container as HTMLElement;
}

/** One frame, by the session it names (`data-vf-pane-frame` is the package's
 * own hook for exactly this). */
const frameFor = (host: HTMLElement, sessionId: string): HTMLElement | null =>
  host.querySelector<HTMLElement>(`[data-vf-pane-frame="${sessionId}"]`);
const paneOf = (host: HTMLElement, paneId: string): HTMLElement | null =>
  host.querySelector<HTMLElement>(`.ghostty-pane[data-pane-id="${paneId}"]`);
const verb = (frame: HTMLElement | null, kind: string): HTMLButtonElement | null =>
  frame?.querySelector<HTMLButtonElement>(`.vf-pane-verb.is-${kind}`) ?? null;

beforeEach(() => {
  workspaceProps = {};
  logged = [];
  requests = [];
  deckDoor = null;
  foldRows = [];
  foldFrame = null;
  interruptAnswer = { accepted: true };
  terminateAnswer = undefined;
  createAnswer = undefined;
  bindsProfiles = true;
  profileSetsFeed = null;
  extraProviders = [];
  spawnGate = undefined;
  rosterRows = [];
  runtimeBirths.clear();
  usedSessions.clear();
  remoteSessions.clear();
  workspace.panes = [{ id: "pane-1", session: stubSession("pty-1") }];
  workspace.activePaneId = "pane-1";
  workspace.mounts = [];
  workspace.fenced = false;
  localStorage.clear();
  document.documentElement.style.setProperty("--tint-l", "0.6");
  document.documentElement.style.setProperty("--tint-c", "0.15");
  disposeTerminalPool();
  configureTerminalPool({ transport: "routed", defaultShell: "/bin/zsh", home: "/home/tester" });
  installHost();
});

afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  root = null;
  container = null;
  document.documentElement.style.removeProperty("--tint-l");
  document.documentElement.style.removeProperty("--tint-c");
  document.documentElement.classList.remove("godview-test-dark");
  vi.restoreAllMocks();
});

describe("the deck's pane frames", () => {
  it("opens an empty terminal through the same product birth door as a split", async () => {
    await mountDeck();
    let outcome: unknown;
    await act(async () => {
      outcome = await deckDoor?.createTerminal();
    });
    expect(outcome).toEqual({ state: "mounted", sessionId: "born-1" });
    expect(requests.filter((request) => request.method === "terminal.create")).toHaveLength(1);
    expect(requests.some((request) => request.method === "agent.spawn")).toBe(false);
    expect(workspace.mounts).toContain("born-1");
  });

  it("shares each pane's colour with Swarm across duplicate sessions, replacement and pane closure", async () => {
    workspace.panes = [
      { id: "pane-1", session: stubSession("pty-1") },
      { id: "pane-2", session: stubSession("pty-2") },
    ];
    const host = await mountDeck();
    const colour = (id: string) => paneOf(host, id)?.style.getPropertyValue("--ghostty-pane-color");
    const ring = (id: string) =>
      host.querySelector(`output[data-session="${id}"]`)?.getAttribute("data-pane-color");
    const first = colour("pane-1");
    const second = colour("pane-2");
    expect(first).toBeTruthy();
    expect(second).toBeTruthy();
    expect(first).not.toBe(second);
    expect(frameFor(host, "pty-1")?.style.getPropertyValue("--pane-color")).toBe(first);
    expect(ring("pty-1")).toBe(first);
    expect(ring("pty-2")).toBe(second);
    expect(workspaceProps["splitSizing"]).toBe("equal");

    await act(async () => {
      workspace.activePaneId = "pane-2";
      workspace.mount(stubSession("pty-1"));
    });
    await settle();
    expect(colour("pane-1")).toBe(first);
    expect(colour("pane-2")).toBe(second);
    expect(ring("pty-1")).toBe(second);
    expect(
      paneOf(host, "pane-2")
        ?.querySelector<HTMLElement>("[data-vf-pane-frame]")
        ?.style.getPropertyValue("--pane-color"),
    ).toBe(second);

    await act(async () => {
      workspace.panes = workspace.panes.filter((pane) => pane.id !== "pane-1");
      workspace.panes.push({ id: "pane-3", session: stubSession("pty-3") });
      workspace.refresh();
    });
    await settle();
    expect(colour("pane-2")).toBe(second);
    expect(colour("pane-3")).toBeTruthy();
    expect(colour("pane-3")).not.toBe(first);
    expect(ring("pty-3")).toBe(colour("pane-3"));

    // The theme changes the tint, but both surfaces must move together even
    // though no pane/session identity changed (the deck's publication gate).
    await act(async () => {
      document.documentElement.style.setProperty("--tint-l", "0.74");
      document.documentElement.classList.add("godview-test-dark");
    });
    await vi.waitFor(
      async () => {
        await settle();
        // Wait for the observer-driven palette publication before reading pane styles.
        expect(host.querySelector("output")?.getAttribute("data-palette-lightness")).toBe("0.74");
        expect(colour("pane-2")).not.toBe(second);
      },
      { timeout: 3_000 },
    );
    expect(ring("pty-1")).toBe(colour("pane-2"));
    expect(frameFor(host, "pty-3")?.style.getPropertyValue("--pane-color")).toBe(colour("pane-3"));
  });

  it("marks the deck so the package's pane rules apply, and frames every pane", async () => {
    workspace.panes = [
      { id: "pane-1", session: stubSession("pty-1") },
      { id: "pane-2", session: stubSession("pty-2", { cwd: "/home/tester/rosetta" }) },
    ];
    const host = await mountDeck();
    expect(host.querySelector(".vf-deck-zoom")?.classList.contains("vf-deck-framed")).toBe(true);
    expect(frameFor(host, "pty-1")).not.toBeNull();
    expect(frameFor(host, "pty-2")).not.toBeNull();
    // The frame is drawn INSIDE ghosttea's own pane element, which is what
    // makes the record's safe areas and the pane's clipping apply to it.
    expect(paneOf(host, "pane-1")?.contains(frameFor(host, "pty-1"))).toBe(true);
  });

  it("draws nothing over the deck but the panes' own frames (GT-6a, record §07)", async () => {
    // The frame arrived in GT-6 while two older chips were still hanging in the
    // deck's corners — `zoom pane` at the top-left, the two-step `kill session`
    // at the top-right — which is exactly where the frame puts the readout and
    // the badge. James's 2026-09-13 pass photographed the collision. §07 names a
    // pane's whole chrome (badge · readout · meter · figure · the pointer's
    // verbs) and neither chip is in it, so this row is the boundary: the deck
    // layer owns the workspace, and every control a user can click belongs to a
    // frame.
    foldRows = [
      managedSummary({ runtimeRunId: "run-1", terminalSessionId: "pty-1", status: "working" }),
    ];
    const host = await mountDeck();
    expect(
      host.querySelector(".vf-godview-zoom"),
      "the zoom chip is the frame's verb now",
    ).toBeNull();
    expect(host.querySelector(".vf-godview-kill"), "the kill chip has no §07 home").toBeNull();
    const zoomHost = host.querySelector<HTMLElement>(".vf-deck-zoom");
    const frame = frameFor(host, "pty-1");
    expect(frame).not.toBeNull();
    // Counted, not just checked for absence: a button that belongs to no frame
    // is chrome over the pane whatever it is called, and the assertion has to
    // fail on the NEXT one as surely as it would have failed on those two.
    const strays = [...(zoomHost?.querySelectorAll("button") ?? [])].filter(
      (button) => frame?.contains(button) !== true,
    );
    expect(strays.map((button) => button.className)).toEqual([]);
    // …and the verbs a working agent's frame does draw are the record's three,
    // so "no chrome" has not quietly become "no affordances".
    expect(verb(frame, "stop")).not.toBeNull();
    expect(verb(frame, "zoom")).not.toBeNull();
  });

  it("gives a shell pane its folder and fullscreen, without agent controls", async () => {
    const host = await mountDeck();
    const frame = frameFor(host, "pty-1");
    expect(frame?.querySelector(".vf-pane-name")?.textContent).toBe("vibe-field");
    expect(frame?.querySelector(".vf-pane-mark")).toBeNull();
    expect(frame?.querySelector(".vf-pane-readout")).toBeNull();
    expect(verb(frame, "zoom")).not.toBeNull();
    expect(verb(frame, "stop")).toBeNull();
    expect(verb(frame, "resume")).toBeNull();
    expect(frame?.querySelector(".vf-pane-meter")).toBeNull();
  });

  it("names the agent in a managed pane and gives it the stop verb", async () => {
    foldRows = [
      managedSummary({
        runtimeRunId: "run-1",
        terminalSessionId: "pty-1",
        kind: "claude",
        label: "Claude",
        status: "working",
        cwd: "/home/tester/vibe-field",
        model: { id: "claude-opus-5", displayName: "Opus 5" },
        contextPercent: 86,
      }),
    ];
    const host = await mountDeck();
    const frame = frameFor(host, "pty-1");
    expect(frame?.querySelector(".vf-pane-mark")).not.toBeNull();
    expect(frame?.querySelector(".vf-pane-readout")?.textContent).toContain("Opus 5");
    expect(frame?.querySelector(".vf-pane-figure")?.textContent).toBe("86%");
    expect(frame?.classList.contains("is-hot")).toBe(true);
    expect(verb(frame, "stop")).not.toBeNull();
    expect(verb(frame, "resume")).toBeNull();
  });

  it("stops the turn through agent.interrupt, with the run id the fold named", async () => {
    foldRows = [
      managedSummary({
        runtimeRunId: "run-42",
        terminalSessionId: "pty-1",
        kind: "claude",
        label: "Claude",
        status: "working",
      }),
    ];
    const host = await mountDeck();
    await act(async () => verb(frameFor(host, "pty-1"), "stop")?.click());
    await settle();
    expect(requests.filter((call) => call.method === "agent.interrupt")).toEqual([
      { method: "agent.interrupt", params: { runtimeRunId: "run-42" } },
    ]);
    // Delivered: the square goes hollow until the run leaves `working`.
    expect(frameFor(host, "pty-1")?.classList.contains("is-stopping")).toBe(true);
  });

  it("keeps the square solid when the daemon refuses the interrupt", async () => {
    interruptAnswer = { accepted: false, reason: "the run is not alive" };
    foldRows = [
      managedSummary({
        runtimeRunId: "run-43",
        terminalSessionId: "pty-1",
        status: "working",
      }),
    ];
    const host = await mountDeck();
    await act(async () => verb(frameFor(host, "pty-1"), "stop")?.click());
    await settle();
    expect(requests.some((call) => call.method === "agent.interrupt")).toBe(true);
    expect(frameFor(host, "pty-1")?.classList.contains("is-stopping")).toBe(false);
  });

  it("reads a THROWN refusal as the state it is, not as a daemon it could not reach", async () => {
    // fieldd refuses the two states a deck actually meets by THROWING: a run
    // whose process has ended (`PRECONDITION_FAILED`, `details.state:
    // "not-alive"`) and one it does not know (`NOT_FOUND`). Only the floor's
    // own refusal comes back as `{accepted: false}`
    // (`fieldd/src/agent-runtime.ts:755–789`). Before GT-6's review the catch
    // logged "could not reach fieldd" at ERROR on a perfectly healthy daemon.
    const rpc = Object.assign(
      new Error(
        "the session is not running under this daemon; interrupt is for a live, observed run",
      ),
      { name: "FielddRpcError", kind: "PRECONDITION_FAILED", details: { state: "not-alive" } },
    );
    interruptAnswer = rpc;
    foldRows = [
      managedSummary({ runtimeRunId: "run-44", terminalSessionId: "pty-1", status: "working" }),
    ];
    const host = await mountDeck();
    await act(async () => verb(frameFor(host, "pty-1"), "stop")?.click());
    await settle();
    expect(requests.filter((call) => call.method === "agent.interrupt")).toEqual([
      { method: "agent.interrupt", params: { runtimeRunId: "run-44" } },
    ]);
    // Not delivered, and said as a refusal: the square goes solid again rather
    // than blinking at a turn nobody is stopping.
    expect(frameFor(host, "pty-1")?.classList.contains("is-stopping")).toBe(false);
    // And said at the right level, in the daemon's own word for the state.
    expect(logged.filter((line) => line.event === "renderer.godview.interrupt_failed")).toEqual([]);
    expect(
      logged.filter((line) => line.event === "renderer.godview.interrupt_refused"),
    ).toHaveLength(1);
    expect(logged.find((line) => line.event === "renderer.godview.interrupt_refused")?.level).toBe(
      "info",
    );
  });

  it("refuses a shape the contract does not admit, rather than reading a stray field", async () => {
    // The answer is PARSED now (the contract row exists): a body with no
    // discriminant is not a delivery, whatever else it carries.
    interruptAnswer = { ok: true, accepted: "yes" };
    // An unreadable ANSWER is a different fact from a refused state: the parse
    // throws, nothing names a state, and the error path is the honest one.
    foldRows = [
      managedSummary({ runtimeRunId: "run-45", terminalSessionId: "pty-1", status: "working" }),
    ];
    const host = await mountDeck();
    await act(async () => verb(frameFor(host, "pty-1"), "stop")?.click());
    await settle();
    expect(frameFor(host, "pty-1")?.classList.contains("is-stopping")).toBe(false);
    expect(
      logged.filter((line) => line.event === "renderer.godview.interrupt_failed"),
    ).toHaveLength(1);
  });

  it("returns a completed agent to a fresh shell and launcher in the same background pane", async () => {
    workspace.panes = [
      { id: "pane-1", session: stubSession("pty-1") },
      { id: "pane-2", session: stubSession("working-shell") },
      { id: "mirror", session: stubSession("pty-1") },
    ];
    workspace.activePaneId = "pane-2";
    foldRows = [managedSummary({ terminalSessionId: "pty-1", alive: false })];
    const host = await mountDeck();
    // A SessionEnd hook alone cannot replace a PTY that has not actually exited.
    expect(requests.filter((call) => call.method === "terminal.create")).toHaveLength(0);
    await act(async () => {
      for (const pane of workspace.panes) {
        if (pane.session.id === "pty-1")
          pane.session = stubSession("pty-1", { exited: true, exitOutcome: "completed" });
      }
      workspace.refresh();
    });
    await settle();
    expect(workspace.panes.map((pane) => [pane.id, pane.session.id])).toEqual([
      ["pane-1", "born-1"],
      ["pane-2", "working-shell"],
      ["mirror", "born-1"],
    ]);
    expect(workspace.activePaneId).toBe("pane-2");
    expect(requests.filter((call) => call.method === "terminal.create")).toEqual([
      {
        method: "terminal.create",
        params: { cwd: "/project/vibe-field", workloadClass: "interactive" },
      },
    ]);
    expect(requests.filter((call) => call.method === "terminal.terminate")).toEqual([
      { method: "terminal.terminate", params: { sessionId: "pty-1" } },
    ]);
    expect(frameFor(host, "pty-1")).toBeNull();
    expect(verb(frameFor(host, "born-1"), "resume")).toBeNull();
    expect(paneOf(host, "pane-1")?.querySelector(".vf-pane-launcher")).not.toBeNull();
    expect(foldRows).toHaveLength(1); // Session history was not deleted.
  });

  it.each(["shell", "remote", "crash"])("does not reset a %s on exit", async (kind) => {
    workspace.panes = [
      {
        id: "pane-1",
        session: stubSession("pty-1", {
          exited: true,
          exitOutcome: kind === "crash" ? "crashed" : "completed",
        }),
      },
    ];
    if (kind !== "shell") foldRows = [managedSummary({ terminalSessionId: "pty-1", alive: false })];
    if (kind === "remote") remoteSessions.add("pty-1");
    await mountDeck();
    expect(workspace.panes[0]?.session.id).toBe("pty-1");
    expect(requests.filter((call) => call.method === "terminal.create")).toHaveLength(0);
    expect(requests.filter((call) => call.method === "terminal.terminate")).toHaveLength(0);
  });

  it("retains the ended pane if a fresh shell cannot be created", async () => {
    workspace.panes = [
      {
        id: "pane-1",
        session: stubSession("pty-1", {
          exited: true,
          exitOutcome: "completed",
        }),
      },
    ];
    foldRows = [managedSummary({ terminalSessionId: "pty-1", alive: false })];
    createAnswer = Promise.reject(new Error("floor unavailable"));
    await mountDeck();
    expect(workspace.panes[0]?.session.id).toBe("pty-1");
    expect(requests.filter((call) => call.method === "terminal.create")).toHaveLength(1);
    expect(requests.filter((call) => call.method === "terminal.terminate")).toHaveLength(0);
    expect(logged.some((line) => line.event === "renderer.godview.agent_exit_shell_failed")).toBe(
      true,
    );
  });

  it.each(["closed", "reassigned", "unmounted"])(
    "releases a late replacement when its pane was %s",
    async (change) => {
      let finish!: (value: unknown) => void;
      createAnswer = new Promise((resolve) => {
        finish = resolve;
      });
      workspace.panes = [
        { id: "pane-1", session: stubSession("pty-1", { exited: true, exitOutcome: "completed" }) },
        { id: "pane-2", session: stubSession("working-shell") },
      ];
      workspace.activePaneId = "pane-2";
      foldRows = [managedSummary({ terminalSessionId: "pty-1", alive: false })];
      await mountDeck();
      expect(requests.filter((call) => call.method === "terminal.create")).toHaveLength(1);
      await act(async () => {
        if (change === "unmounted") {
          root?.unmount();
          root = null;
        } else {
          workspace.panes =
            change === "closed"
              ? workspace.panes.slice(1)
              : [{ id: "pane-1", session: stubSession("other-agent") }, workspace.panes[1]!];
          workspace.refresh();
        }
      });
      await act(async () =>
        finish({
          sessionId: "born-1",
          session: bornSummary("born-1"),
          ...routedTicket("born-1"),
        }),
      );
      await settle();
      expect(workspace.mounts).toEqual([]);
      expect(workspace.activePaneId).toBe("pane-2");
      expect(requests.filter((call) => call.method === "terminal.terminate")).toEqual([
        { method: "terminal.terminate", params: { sessionId: "born-1" } },
      ]);
    },
  );

  it("resumes an ended run with unknown exit outcome and hands its pane the new terminal", async () => {
    workspace.panes = [{ id: "pane-1", session: stubSession("pty-1", { exited: true }) }];
    foldRows = [
      managedSummary({
        runtimeRunId: "run-1",
        terminalSessionId: "pty-1",
        kind: "codex",
        label: "Codex",
        alive: false,
      }),
    ];
    const host = await mountDeck();
    const frame = frameFor(host, "pty-1");
    expect(verb(frame, "resume")).not.toBeNull();
    expect(verb(frame, "stop")).toBeNull();

    await act(async () => verb(frame, "resume")?.click());
    await settle();
    expect(requests.filter((call) => call.method === "agent.resume")).toEqual([
      { method: "agent.resume", params: { runtimeRunId: "run-1" } },
    ]);
    // The new PTY lands in the pane the verb was pressed in (AR-4b's hand-over).
    expect(workspace.mounts).toEqual(["pty-resumed"]);
    expect(workspace.panes[0]?.session.id).toBe("pty-resumed");
  });

  it("re-reads the floor's roster when a pane changes hands (GT-6b)", async () => {
    // The sweep that keeps a displaced PTY reachable. A pane being taken over
    // is exactly when a live session can end up in no pane, so that — and not
    // a timer — is what makes the deck ask the floor what is still alive. The
    // ask is a READ: GT-D10 removed the adopt sweep because it PLACED unseen
    // sessions in panes, and listing one as a row takes no such authority.
    workspace.panes = [{ id: "pane-1", session: stubSession("pty-1", { exited: true }) }];
    foldRows = [
      managedSummary({
        runtimeRunId: "run-1",
        terminalSessionId: "pty-1",
        kind: "codex",
        label: "Codex",
        alive: false,
      }),
    ];
    const host = await mountDeck();
    const asks = (): number => requests.filter((call) => call.method === "terminal.roster").length;
    const atMount = asks();

    await act(async () => verb(frameFor(host, "pty-1"), "resume")?.click());
    await settle();

    expect(workspace.panes[0]?.session.id, "the pane changed hands").toBe("pty-resumed");
    expect(asks(), "the floor is asked what is still alive").toBeGreaterThan(atMount);
  });

  it("reaps the first shell born by the runtime when its attachment is replaced", async () => {
    runtimeBirths.add("pty-1");
    await mountDeck();
    await act(async () => {
      workspace.mount(stubSession("replacement"));
    });
    await settle();
    expect(requests.filter((r) => r.method === "terminal.terminate")).toEqual([
      { method: "terminal.terminate", params: { sessionId: "pty-1" } },
    ]);
  });

  it("reaps an empty shell when another bubble takes its final attachment, before the door replies", async () => {
    const host = await mountDeck();
    await act(async () => {
      await deckDoor?.createTerminal();
    });
    await settle();
    rosterRows = [{ sessionId: "born-1", workloadClass: "interactive", health: "live" }];
    let accept!: (result: unknown) => void;
    terminateAnswer = new Promise((resolve) => {
      accept = resolve;
    });
    expect(host.querySelector('output[data-session="born-1"]')).not.toBeNull();

    await act(async () => {
      workspace.mount(stubSession("replacement"));
    });
    await settle();
    expect(requests.filter((r) => r.method === "terminal.terminate")).toEqual([
      { method: "terminal.terminate", params: { sessionId: "born-1" } },
    ]);
    expect(host.querySelector('output[data-session="born-1"]')).toBeNull();
    expect(host.querySelector('output[data-session="replacement"]')).not.toBeNull();
    await act(async () => {
      accept({ terminated: true });
    });
    await settle();
    expect(host.querySelector('output[data-session="born-1"]')).toBeNull();
  });

  it("keeps an empty shell while mirrored, then reaps it when the last pane closes", async () => {
    await mountDeck();
    await act(async () => {
      await deckDoor?.createTerminal();
    });
    await settle();
    await act(async () => {
      workspace.panes = [...workspace.panes, { id: "mirror", session: stubSession("born-1") }];
      workspace.refresh();
    });
    await settle();
    await act(async () => {
      workspace.mount(stubSession("replacement"));
    });
    await settle();
    expect(requests.filter((r) => r.method === "terminal.terminate")).toEqual([]);
    await act(async () => {
      workspace.panes = workspace.panes.filter((pane) => pane.id !== "mirror");
      workspace.refresh();
    });
    await settle();
    expect(requests.filter((r) => r.method === "terminal.terminate")).toHaveLength(1);
  });

  it("cleans a shell closed during startup when native idle metadata arrives after detach", async () => {
    runtimeBirths.add("pty-1");
    workspace.panes[0]!.session.activity = { kind: "foreground-job" };
    await mountDeck();
    await act(async () => {
      workspace.mount(stubSession("replacement"));
    });
    await settle();
    expect(requests.filter((call) => call.method === "terminal.terminate")).toEqual([]);
    await act(async () => {
      runtimeEvents.dispatchEvent(
        new CustomEvent("session-metadata", { detail: stubSession("pty-1") }),
      );
    });
    await settle();
    expect(requests.filter((call) => call.method === "terminal.terminate")).toEqual([
      { method: "terminal.terminate", params: { sessionId: "pty-1" } },
    ]);
  });

  it.each(["input", "foreground", "agent", "remote"])(
    "retains a detached shell with %s evidence",
    async (kind) => {
      await mountDeck();
      await act(async () => {
        await deckDoor?.createTerminal();
      });
      await settle();
      if (kind === "input") usedSessions.add("born-1");
      if (kind === "remote") remoteSessions.add("born-1");
      if (kind === "foreground") {
        await act(async () => {
          workspace.panes[0]!.session = stubSession("born-1", {
            activity: { kind: "foreground-job" },
          });
          workspace.refresh();
        });
        await settle();
      }
      if (kind === "agent") {
        await act(async () => {
          foldFrame?.([managedSummary({ terminalSessionId: "born-1" })]);
        });
        await settle();
      }
      await act(async () => {
        workspace.mount(stubSession("replacement"));
      });
      await settle();
      expect(requests.filter((r) => r.method === "terminal.terminate")).toEqual([]);
    },
  );

  it("restores the detached bubble if the termination door refuses", async () => {
    const host = await mountDeck();
    await act(async () => {
      await deckDoor?.createTerminal();
    });
    await settle();
    rosterRows = [{ sessionId: "born-1", workloadClass: "interactive", health: "live" }];
    let refuse!: (cause: unknown) => void;
    terminateAnswer = new Promise((_resolve, reject) => {
      refuse = reject;
    });
    await act(async () => {
      workspace.mount(stubSession("replacement"));
    });
    await settle();
    expect(host.querySelector('output[data-session="born-1"]')).toBeNull();
    await act(async () => {
      refuse(new Error("denied"));
    });
    await settle();
    expect(host.querySelector('output[data-session="born-1"]')).not.toBeNull();
    expect(logged.some((line) => line.event === "renderer.godview.unused_pane_close_failed")).toBe(
      true,
    );
  });

  it("names a fresh split by the folder the deck opened it in, not 'terminal' (PU-14b)", async () => {
    workspace.panes = [
      { id: "pane-1", session: stubSession("pty-1", { cwd: "/home/tester/rosetta" }) },
    ];
    const host = await mountDeck();
    const split = workspaceProps["createSplitSession"] as (
      session: StubSession,
    ) => Promise<{ id: string; cwd: string | null }>;
    expect(typeof split).toBe("function");

    // Ghosttea's own birth door, asked as the workspace asks it and mounted as
    // the workspace mounts what comes back.
    await act(async () => {
      const born = await split(workspace.panes[0]?.session as StubSession);
      expect(born.cwd).toBeNull();
      workspace.mount(born);
    });
    await settle();

    // The floor says nothing about this shell's folder — a shell before its
    // first prompt has announced no OSC 7 — so the badge would read `terminal`
    // if the deck did not remember the folder it asked for the split in.
    // ERRATA (2026-09-25, GT-8b): a ghosttea 0.12.0 floor does say. A local
    // session reports its spawn directory from creation, so this stub's `cwd:
    // null` is the older floor, and the remembered folder is now the fallback
    // for a floor that says nothing rather than the only source.
    expect(frameFor(host, "born-1")?.querySelector(".vf-pane-name")?.textContent).toBe("rosetta");
  });

  it("zooms through the deck's own morph, never ghosttea's remount", async () => {
    workspace.panes = [
      { id: "pane-1", session: stubSession("pty-1") },
      { id: "pane-2", session: stubSession("pty-2") },
    ];
    const host = await mountDeck();
    // happy-dom has no layout engine; supply the stage and pane geometry.
    const stage = host.querySelector<HTMLElement>(".terminal-host")!;
    const pane = paneOf(host, "pane-1")!;
    vi.spyOn(stage, "getBoundingClientRect").mockReturnValue(new DOMRect(0, 0, 1000, 600));
    vi.spyOn(pane, "getBoundingClientRect").mockReturnValue(new DOMRect(0, 0, 500, 600));
    const zoomHost = host.querySelector<HTMLElement>(".vf-deck-zoom");
    expect(zoomHost?.dataset["zoomPhase"]).toBe("idle");
    const otherPane = paneOf(host, "pane-2");
    expect(otherPane?.getAttribute("data-workspace-visible")).toBe("true");
    const zoomVerb = verb(frameFor(host, "pty-1"), "zoom");
    expect(zoomVerb).not.toBeNull();
    await act(async () => zoomVerb?.click());
    expect(zoomHost?.dataset["zoomPhase"]).not.toBe("idle");
    expect(paneOf(host, "pane-1")?.hasAttribute("data-vf-zoom-pane")).toBe(true);
    // The configured workspace zoom route and the button share this controller.
    expect(workspaceProps["onTogglePaneZoom"]).toBeTypeOf("function");
    await act(async () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve())));
    await act(async () => {
      pane.dispatchEvent(Object.assign(new Event("transitionend"), { propertyName: "width" }));
    });
    expect(zoomHost?.dataset["zoomPhase"]).toBe("zoomed");
    expect(paneOf(host, "pane-1")?.getAttribute("data-workspace-visible")).toBe("true");
    expect(paneOf(host, "pane-2")).toBe(otherPane);
    expect(otherPane?.getAttribute("data-workspace-visible")).toBe("false");
  });

  it("says where a peer's session lives, from the attach that put it there", async () => {
    const host = await mountDeck();
    const paneColor = paneOf(host, "pane-1")?.style.getPropertyValue("--ghostty-pane-color");
    expect(deckDoor).not.toBeNull();
    await act(async () => {
      await deckDoor?.attach({
        deviceId: "mini",
        deviceName: "mini",
        remoteSessionId: "s1",
      });
    });
    await settle();
    const frame = frameFor(host, "replica-mini-s1");
    expect(frame).not.toBeNull();
    expect(frame?.style.getPropertyValue("--pane-color")).toBe(paneColor);
    expect(frame?.querySelector(".vf-pane-badge-name")?.getAttribute("title")).toContain("on mini");
    expect(frame?.querySelector(".vf-pane-os")).not.toBeNull();
  });

  it("follows the fold: a frame gains its agent when the daemon's next frame names it", async () => {
    const host = await mountDeck();
    expect(frameFor(host, "pty-1")?.querySelector(".vf-pane-mark")).toBeNull();
    await act(async () => {
      foldFrame?.([
        managedSummary({
          runtimeRunId: "run-1",
          terminalSessionId: "pty-1",
          kind: "claude",
          label: "Claude",
          status: "working",
        }),
      ]);
    });
    await settle();
    expect(frameFor(host, "pty-1")?.querySelector(".vf-pane-mark")).not.toBeNull();
  });
});

describe("the empty pane launcher (QL-1)", () => {
  const launcherFor = (host: HTMLElement, sessionId: string): HTMLElement | null =>
    host.querySelector<HTMLElement>(`[data-vf-pane-launcher="${sessionId}"]`);
  const pressIn = (target: Element | null, code: string): KeyboardEvent => {
    const event = new KeyboardEvent("keydown", {
      code,
      key: code === "Enter" ? "Enter" : "",
      altKey: true,
      bubbles: true,
      cancelable: true,
    });
    target?.dispatchEvent(event);
    return event;
  };

  afterEach(() => {
    resetLauncherKeys();
  });

  it("draws on a shell the deck's new-pane door opened, and never on a restored one", async () => {
    const host = await mountDeck();
    // pty-1 was claimed, not born here: no receipt, no launcher
    expect(launcherFor(host, "pty-1")).toBeNull();
    await act(async () => {
      await deckDoor?.createTerminal();
    });
    await settle();
    expect(launcherFor(host, "born-1")?.querySelector(".vf-pane-launcher")).not.toBeNull();
    // the focused pane's launcher owns ⌥0–⌥9, so the tab strip yields (QL-D2)
    expect(launcherOwnsKeys()).toBe(true);
    // the agents came from agent.providers, listed with their keys
    expect(
      [...host.querySelectorAll(".vf-pane-launcher-agent .vf-pane-launcher-nm")].map(
        (name) => name.textContent,
      ),
    ).toEqual(["Claude Code"]);
  });

  it("never draws on a split born under a runtime a pool retry replaced — its input history went with it", async () => {
    const host = await mountDeck();
    await act(async () => {
      await deckDoor?.createTerminal();
    });
    await settle();
    expect(launcherFor(host, "born-1")).not.toBeNull();
    // typed into, so the launcher goes and the reaper will never close it
    usedSessions.add("born-1");
    workspace.refresh();
    await settle();
    expect(launcherFor(host, "born-1")).toBeNull();
    // the pool's recovery door: a replacement runtime, which remembers no input
    await act(async () => retryTerminalPool(["born-1"]));
    usedSessions.clear();
    workspace.refresh();
    await settle();
    expect(launcherFor(host, "born-1")).toBeNull();
    expect(launcherOwnsKeys()).toBe(false);
    // ⌥1 over it is the shell's, so no agent replaces (and leaks) the used shell
    await act(async () => {
      pressIn(paneOf(host, "pane-1"), "Digit1");
    });
    await settle();
    expect(requests.filter((call) => call.method === "agent.spawn")).toEqual([]);
  });

  it("never draws on a peer's pane — attached from the mesh, or a replica the runtime says is remote", async () => {
    const host = await mountDeck();
    await act(async () => {
      await deckDoor?.attach({ deviceId: "mini", deviceName: "mini", remoteSessionId: "s1" });
    });
    await settle();
    // the replica is framed (so its pane is there) and shows no launcher
    expect(frameFor(host, "replica-mini-s1")).not.toBeNull();
    expect(launcherFor(host, "replica-mini-s1")).toBeNull();
    expect(launcherOwnsKeys()).toBe(false);
  });

  it("never draws on a remote replica even with a birth receipt", async () => {
    runtimeBirths.add("pty-1");
    remoteSessions.add("pty-1");
    const host = await mountDeck();
    expect(frameFor(host, "pty-1")).not.toBeNull();
    expect(launcherFor(host, "pty-1")).toBeNull();
    expect(launcherOwnsKeys()).toBe(false);
  });

  it("draws on the workspace's first shell, which ghosttea's own receipt names", async () => {
    runtimeBirths.add("pty-1");
    const host = await mountDeck();
    expect(launcherFor(host, "pty-1")).not.toBeNull();
  });

  it.each(["input", "agent", "exited"])("draws on no fresh shell with %s", async (kind) => {
    runtimeBirths.add("pty-1");
    if (kind === "input") usedSessions.add("pty-1");
    if (kind === "exited") {
      workspace.panes = [{ id: "pane-1", session: stubSession("pty-1", { exited: true }) }];
    }
    if (kind === "agent") foldRows = [managedSummary({ terminalSessionId: "pty-1" })];
    const host = await mountDeck();
    expect(launcherFor(host, "pty-1")).toBeNull();
    expect(launcherOwnsKeys()).toBe(false);
  });

  it("claims only the keys routed into a pane that shows a launcher — the monitor and the other panes keep theirs", async () => {
    runtimeBirths.add("pty-1");
    workspace.panes = [
      { id: "pane-1", session: stubSession("pty-1") },
      { id: "pane-2", session: stubSession("pty-2") },
    ];
    const host = await mountDeck();
    expect(launcherFor(host, "pty-1")).not.toBeNull();
    const textarea = document.createElement("textarea");
    paneOf(host, "pane-1")?.append(textarea);
    expect(launcherOwnsKeyEvent({ target: textarea })).toBe(true);
    expect(launcherOwnsKeyEvent({ target: paneOf(host, "pane-2") })).toBe(false);
    expect(launcherOwnsKeyEvent({ target: document.body })).toBe(false);
    // another pane selected: pane-1's launcher rests, and a key that still
    // reaches pane-1 is still its launcher's (it takes the keys of the pane
    // that holds them); pane-2's keys stay the strip's
    workspace.activePaneId = "pane-2";
    workspace.refresh();
    await settle();
    expect(
      launcherFor(host, "pty-1")?.querySelector(".vf-pane-launcher.is-resting"),
    ).not.toBeNull();
    expect(launcherOwnsKeyEvent({ target: textarea })).toBe(true);
    expect(launcherOwnsKeyEvent({ target: paneOf(host, "pane-2") })).toBe(false);
    // put away (⎋ in its pane): its pane's keys are the shell's and the strip's again
    await act(async () => {
      pressIn(textarea, "Escape");
    });
    await settle();
    expect(launcherFor(host, "pty-1")).toBeNull();
    expect(launcherOwnsKeyEvent({ target: textarea })).toBe(false);
  });

  it("opens its field on ⌥↵ and asks index.recent for the pane's own folder", async () => {
    runtimeBirths.add("pty-1");
    const host = await mountDeck();
    await act(async () => {
      pressIn(paneOf(host, "pane-1"), "Enter");
    });
    await settle();
    expect(launcherFor(host, "pty-1")?.querySelector(".vf-pane-launcher.is-open")).not.toBeNull();
    expect(requests.filter((call) => call.method === "index.recent")).toEqual([
      {
        method: "index.recent",
        params: { cwd: "/home/tester/vibe-field", scope: "here", limit: 100 },
      },
    ]);
  });

  it("never hands a launch or a list the floor's raw cwd — another host's OSC 7 URL is no folder here", async () => {
    // this Mac's name, learned from one of its own shells
    localStorage.setItem("vf-godview-device-host-v1", "this-mac");
    runtimeBirths.add("pty-1");
    // a local shell that announced a folder on ANOTHER machine (an ssh session)
    workspace.panes = [
      { id: "pane-1", session: stubSession("pty-1", { cwd: "file://other-mac/Users/peer/src" }) },
    ];
    const host = await mountDeck();
    await act(async () => {
      pressIn(paneOf(host, "pane-1"), "Enter");
    });
    await settle();
    expect(requests.filter((call) => call.method === "index.recent")).toEqual([
      { method: "index.recent", params: { scope: "here", limit: 100 } },
    ]);
    await act(async () => {
      pressIn(paneOf(host, "pane-1"), "Escape");
    });
    await settle();
    await act(async () => {
      pressIn(paneOf(host, "pane-1"), "Digit1");
    });
    await settle();
    expect(requests.filter((call) => call.method === "agent.spawn")).toEqual([
      { method: "agent.spawn", params: { provider: "claude" } },
    ]);
  });

  it("yields ⎋ to a monitor sheet over the stage — the find sheet's Escape is the sheet's", async () => {
    runtimeBirths.add("pty-1");
    const host = await mountDeck();
    expect(launcherOwnsKeys()).toBe(true);
    await act(async () => setMonitorHoldsKeys(true));
    await settle();
    expect(launcherOwnsKeys()).toBe(false);
    let escaped: KeyboardEvent | undefined;
    await act(async () => {
      escaped = pressIn(paneOf(host, "pane-1"), "Escape");
    });
    await settle();
    expect(escaped?.defaultPrevented).toBe(false);
    // under the sheet the launcher is not drawn (a key into its pane would be
    // its, selected or not); it was not put away by a key it never saw
    expect(launcherFor(host, "pty-1")).toBeNull();
    await act(async () => setMonitorHoldsKeys(false));
    await settle();
    expect(launcherOwnsKeys()).toBe(true);
    expect(launcherFor(host, "pty-1")?.querySelector(".vf-pane-launcher")).not.toBeNull();
  });

  it("selects a resting pane when its launcher is clicked — the portal's pointer never reaches ghosttea's pane", async () => {
    runtimeBirths.add("pty-1");
    workspace.panes = [
      { id: "pane-1", session: stubSession("pty-1") },
      { id: "pane-2", session: stubSession("pty-2") },
    ];
    workspace.activePaneId = "pane-2";
    const host = await mountDeck();
    const resting = launcherFor(host, "pty-1");
    expect(resting?.querySelector(".vf-pane-launcher.is-resting")).not.toBeNull();
    await act(async () => {
      const field = resting?.querySelector<HTMLElement>(".vf-pane-launcher-field");
      field?.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, cancelable: true }));
      field?.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true }));
      field?.click();
    });
    await settle();
    expect(workspace.activePaneId).toBe("pane-1");
    expect(launcherFor(host, "pty-1")?.querySelector(".vf-pane-launcher.is-resting")).toBeNull();
  });

  it("lands a launch in the launcher's OWN pane when the fresh shell is mirrored in another", async () => {
    runtimeBirths.add("pty-1");
    workspace.panes = [
      { id: "pane-1", session: stubSession("pty-1") },
      { id: "pane-2", session: stubSession("pty-1") },
    ];
    workspace.activePaneId = "pane-2";
    const host = await mountDeck();
    await act(async () => {
      pressIn(paneOf(host, "pane-2"), "Digit1");
    });
    await settle();
    expect(requests.filter((call) => call.method === "agent.spawn")).toHaveLength(1);
    expect(requests.filter((call) => call.method === "terminal.terminate")).toEqual([]);
    expect(
      host.querySelector('[data-session="pty-launched"]')?.getAttribute("data-visual-id"),
    ).toBe("pty-launched");
    // pane-2's launcher was used, so pane-2 takes the agent; pane-1 keeps the shell
    expect(workspace.panes.map((pane) => [pane.id, pane.session.id])).toEqual([
      ["pane-1", "pty-1"],
      ["pane-2", "pty-launched"],
    ]);
  });

  it("launches on ⌥1 into THIS pane, in its folder, and the reaper closes the shell it replaced", async () => {
    runtimeBirths.add("pty-1");
    const host = await mountDeck();
    await act(async () => {
      pressIn(paneOf(host, "pane-1"), "Digit1");
    });
    await settle();
    // a launch sends no profile (QL-D3 as revised): fieldd resolves the default
    expect(requests.filter((call) => call.method === "agent.spawn")).toEqual([
      { method: "agent.spawn", params: { provider: "claude", cwd: "/home/tester/vibe-field" } },
    ]);
    expect(workspace.panes[0]?.session.id).toBe("pty-launched");
    expect(requests.filter((call) => call.method === "terminal.terminate")).toEqual([
      { method: "terminal.terminate", params: { sessionId: "pty-1" } },
    ]);
    expect(
      host.querySelector('[data-session="pty-launched"]')?.getAttribute("data-visual-id"),
    ).toBe("pty-1");
    expect(launcherFor(host, "pty-1")).toBeNull();
    expect(launcherOwnsKeys()).toBe(false);
  });
  it("launches during shell startup without stranding its shell or changing the bubble identity", async () => {
    runtimeBirths.add("pty-1");
    workspace.panes[0]!.session.activity = { kind: "foreground-job" };
    const host = await mountDeck();
    expect(launcherFor(host, "pty-1")).not.toBeNull();
    await act(async () => {
      pressIn(paneOf(host, "pane-1"), "Digit1");
    });
    await settle();
    expect(workspace.panes[0]?.session.id).toBe("pty-launched");
    expect(requests.filter((call) => call.method === "terminal.terminate")).toEqual([
      { method: "terminal.terminate", params: { sessionId: "pty-1" } },
    ]);
    expect(
      host.querySelector('[data-session="pty-launched"]')?.getAttribute("data-visual-id"),
    ).toBe("pty-1");
  });
  it("keeps a shell that receives input while a click launch is in flight", async () => {
    runtimeBirths.add("pty-1");
    let accept!: () => void;
    spawnGate = new Promise<void>((resolve) => {
      accept = resolve;
    });
    const host = await mountDeck();
    await act(async () => {
      launcherFor(host, "pty-1")
        ?.querySelector<HTMLButtonElement>(".vf-pane-launcher-agent")
        ?.click();
    });
    expect(requests.filter((call) => call.method === "agent.spawn")).toHaveLength(1);
    usedSessions.add("pty-1");
    await act(async () => {
      accept();
    });
    await settle();
    expect(workspace.panes[0]?.session.id).toBe("pty-launched");
    expect(requests.filter((call) => call.method === "terminal.terminate")).toEqual([]);
    expect(
      host.querySelector('[data-session="pty-launched"]')?.getAttribute("data-visual-id"),
    ).toBe("pty-launched");
  });

  it("restores distinct bubbles when the audited shell release is refused", async () => {
    runtimeBirths.add("pty-1");
    let refuse!: (cause: Error) => void;
    terminateAnswer = new Promise((_resolve, reject) => {
      refuse = reject;
    });
    const host = await mountDeck();
    await act(async () => {
      pressIn(paneOf(host, "pane-1"), "Digit1");
    });
    await settle();
    expect(
      host.querySelector('[data-session="pty-launched"]')?.getAttribute("data-visual-id"),
    ).toBe("pty-1");
    await act(async () => {
      refuse(new Error("termination refused"));
    });
    await settle();
    expect(
      host.querySelector('[data-session="pty-launched"]')?.getAttribute("data-visual-id"),
    ).toBe("pty-launched");
  });

  it("names the profile a pane was born under — New · Under Work — marks an agent it holds no sign-in for, and launches under it (SB-3)", async () => {
    const at = "2026-09-30T00:00:00.000Z";
    profileSetsFeed = [
      {
        id: "native",
        kind: "native",
        label: "This Mac",
        default: false,
        createdAt: at,
        personas: [],
      },
      {
        id: "work",
        kind: "managed",
        label: "Work",
        glyph: "briefcase",
        default: true,
        createdAt: at,
        personas: [
          {
            profileId: "w-claude",
            provider: "claude",
            label: "Claude",
            kind: "managed",
            createdAt: at,
          },
        ],
      },
    ];
    extraProviders = [
      {
        id: "codex",
        label: "Codex",
        available: true,
        resumable: true,
        personas: [],
        status: "supported",
        offers: { spawn: true, resume: true, personas: true },
      },
    ];
    const host = await mountDeck();
    await act(async () => {
      await deckDoor?.createTerminal({ profileSet: "work" });
    });
    await settle();
    const launcher = launcherFor(host, "born-1");
    expect(launcher, "a bound birth is a fresh shell like any other").not.toBeNull();
    expect(launcher?.querySelector(".vf-pane-launcher-cap-under")?.textContent).toContain(
      "Under Work",
    );
    expect(launcher?.querySelector('[data-profile-glyph="briefcase"]')).not.toBeNull();
    expect(launcher?.querySelector('[title="Codex · no sign-in"]')).not.toBeNull();
    await act(async () => {
      pressIn(paneOf(host, "pane-1"), "Digit1");
    });
    await settle();
    expect(requests.filter((call) => call.method === "agent.spawn")).toEqual([
      {
        method: "agent.spawn",
        params: { provider: "claude", cwd: "/home/tester/vibe-field", profileSet: "work" },
      },
    ]);
  });

  it("keeps the plain caption in a pane born under no profile, even with profiles to name (SB-3)", async () => {
    runtimeBirths.add("pty-1");
    const at = "2026-09-30T00:00:00.000Z";
    profileSetsFeed = [
      {
        id: "native",
        kind: "native",
        label: "This Mac",
        default: true,
        createdAt: at,
        personas: [],
      },
      { id: "work", kind: "managed", label: "Work", default: false, createdAt: at, personas: [] },
    ];
    const host = await mountDeck();
    await settle();
    const launcher = launcherFor(host, "pty-1");
    expect(launcher).not.toBeNull();
    expect(launcher?.querySelector(".vf-pane-launcher-cap-under")).toBeNull();
    expect(launcher?.querySelector("[data-profile-glyph]")).toBeNull();
  });
});

// ---- SB-3 — births under an Agent Profile --------------------------------------
//
// The spawn bloom's choice reaches the floor through the deck's ONE birth door:
// the door's ask rides a ref into ghosttea's synchronous call of the override,
// a split and the agent-exit shell are born under the set of the shell they
// follow, and a refusal is fieldd's answer to one birth — never the pool's fault.

/** The params of every `terminal.create` the deck sent, in order. */
const creates = (): Array<Record<string, unknown>> =>
  requests
    .filter((call) => call.method === "terminal.create")
    .map((call) => call.params as Record<string, unknown>);
const splitDoor = (): ((session: StubSession, axis: string) => Promise<unknown>) =>
  workspaceProps["createSplitSession"] as (session: StubSession, axis: string) => Promise<unknown>;

describe("births under an Agent Profile (SB-3)", () => {
  it("opens a terminal under the asked profile through the same birth door, and names the set fieldd applied", async () => {
    await mountDeck();
    let outcome: unknown;
    await act(async () => {
      outcome = await deckDoor?.createTerminal({ profileSet: "work" });
    });
    expect(outcome).toEqual({ state: "mounted", sessionId: "born-1", profileSet: "work" });
    expect(creates()).toEqual([
      { cwd: "/home/tester/vibe-field", workloadClass: "interactive", profileSet: "work" },
    ]);
    expect(workspace.mounts).toContain("born-1");
  });

  it("keeps the shell an older fieldd births unbound, and answers without a set", async () => {
    bindsProfiles = false;
    await mountDeck();
    let outcome: unknown;
    await act(async () => {
      outcome = await deckDoor?.createTerminal({ profileSet: "work" });
    });
    expect(outcome).toEqual({ state: "mounted", sessionId: "born-1" });
    expect(requests.filter((call) => call.method === "terminal.terminate")).toEqual([]);
  });

  it("gives a ⌘D split the set of the shell it splits; an unbound shell's split and the door's plain create get none", async () => {
    await mountDeck();
    await act(async () => {
      await deckDoor?.createTerminal({ profileSet: "work" });
    });
    await act(async () => {
      await splitDoor()(stubSession("born-1"), "vertical");
    });
    await act(async () => {
      await splitDoor()(stubSession("pty-1"), "vertical");
    });
    // the door's own ask is the whole answer, even from a bound pane
    await act(async () => {
      await deckDoor?.createTerminal();
    });
    expect(creates().map((params) => params["profileSet"])).toEqual([
      "work",
      "work",
      undefined,
      undefined,
    ]);
  });

  it("keeps an unbound pane unbound after its agent exits, even one whose run was under a profile", async () => {
    // the pane's shell was born under none; the agent ran under Work (the
    // default set, QL-D3) — the run never decides the pane's binding
    foldRows = [managedSummary({ terminalSessionId: "pty-1", alive: false, profileSet: "work" })];
    await mountDeck();
    await act(async () => {
      workspace.panes[0]!.session = stubSession("pty-1", {
        exited: true,
        exitOutcome: "completed",
      });
      workspace.refresh();
    });
    await settle();
    expect(creates()).toEqual([{ cwd: "/project/vibe-field", workloadClass: "interactive" }]);
    const paneMeta = workspaceProps["paneMeta"] as (session: unknown, paneId: string) => unknown;
    expect(paneMeta(stubSession("pty-1"), "pane-1")).not.toHaveProperty("profileSet");
  });

  it("keeps a Work pane Work — its ⌘D split, its agent-exit shell and its meta — whatever its agent ran under", async () => {
    await mountDeck();
    // the pane's shell is born under Work…
    await act(async () => {
      await deckDoor?.createTerminal({ profileSet: "work" });
    });
    await settle();
    // …and an agent that ran under This Mac takes its place in the pane
    await act(async () => {
      foldFrame?.([
        managedSummary({ terminalSessionId: "agent-pty", alive: true, profileSet: "native" }),
      ]);
      workspace.panes[0]!.session = stubSession("agent-pty");
      workspace.refresh();
    });
    await settle();
    const paneMeta = workspaceProps["paneMeta"] as (session: unknown, paneId: string) => unknown;
    expect(paneMeta(stubSession("agent-pty"), "pane-1")).toMatchObject({ profileSet: "work" });
    // ⌘D copies the SOURCE pane's set, not the agent's run's
    await act(async () => {
      await splitDoor()(stubSession("agent-pty"), "vertical");
    });
    // the agent exits: its pane returns to a shell under the pane's own set
    await act(async () => {
      foldFrame?.([
        managedSummary({ terminalSessionId: "agent-pty", alive: false, profileSet: "native" }),
      ]);
      workspace.panes[0]!.session = stubSession("agent-pty", {
        exited: true,
        exitOutcome: "completed",
      });
      workspace.refresh();
    });
    await settle();
    expect(creates().map((params) => params["profileSet"])).toEqual(["work", "work", "work"]);
  });

  it("hands the door fieldd's own words for a refused birth and faults nothing — the next birth goes through", async () => {
    const host = await mountDeck();
    const phase = terminalPoolSnapshot().phase;
    createAnswer = Promise.reject(
      new FielddRpcError(
        "NOT_FOUND",
        "that profile no longer exists",
        false,
        { set: "work" },
        -32004,
      ),
    );
    let outcome: unknown;
    await act(async () => {
      outcome = await deckDoor?.createTerminal({ profileSet: "work" });
    });
    await settle();
    // defect 2: not "the workspace could not open a terminal"
    expect(outcome).toEqual({ state: "failed", reason: "that profile no longer exists" });
    // defect 1: the deck is not faulted for an answer
    expect(host.querySelector(".vf-godview-deck-fault")).toBeNull();
    expect(terminalPoolSnapshot().fault).toBeNull();
    expect(terminalPoolSnapshot().phase).toBe(phase);
    expect(workspace.panes[0]?.session.id).toBe("pty-1");
    createAnswer = undefined;
    await act(async () => {
      outcome = await deckDoor?.createTerminal({ profileSet: "work" });
    });
    expect(outcome).toEqual({ state: "mounted", sessionId: "born-1", profileSet: "work" });
  });

  it("still faults the pool when fieldd could not be reached at all", async () => {
    const host = await mountDeck();
    // the client's own error for a request that never reached fieldd: no wire code
    createAnswer = Promise.reject(new FielddRpcError("UNAVAILABLE", "connection closed", true));
    await act(async () => {
      await deckDoor?.createTerminal({ profileSet: "work" });
    });
    await settle();
    expect(terminalPoolSnapshot().fault).toEqual({ plane: "fieldd", message: "connection closed" });
    expect(host.querySelector(".vf-godview-deck-fault")).not.toBeNull();
  });

  it("drops the ask of a birth ghosttea fenced, so the next split does not take it", async () => {
    await mountDeck();
    workspace.fenced = true;
    let outcome: unknown;
    await act(async () => {
      outcome = await deckDoor?.createTerminal({ profileSet: "work" });
    });
    expect(outcome).toEqual({ state: "failed", reason: "the workspace could not open a terminal" });
    workspace.fenced = false;
    await act(async () => {
      await splitDoor()(stubSession("pty-1"), "vertical");
    });
    expect(creates().map((params) => params["profileSet"])).toEqual([undefined]);
  });

  it("carries a let-go on Work from the swarm's bloom through the deck's own door to terminal.create {profileSet}, and says so", async () => {
    const at = "2026-09-30T00:00:00.000Z";
    profileSetsFeed = [
      {
        id: "native",
        kind: "native",
        label: "This Mac",
        default: true,
        createdAt: at,
        personas: [],
      },
      { id: "work", kind: "managed", label: "Work", default: false, createdAt: at, personas: [] },
    ];
    /** The overlay's composition: the deck hands its door to the monitor. */
    function Overlay(): ReactElement {
      const [door, setDoor] = useState<MonitorDoor | null>(null);
      const [panes, setPanes] = useState<MonitorPaneFacts>({ sessionIds: [] });
      const view = monitorViewFor("swarm");
      return (
        <>
          <GodviewDeck
            active
            theme="light"
            onPanes={setPanes}
            onRemoteDoor={(next) => {
              deckDoor = next;
              setDoor(next);
            }}
          />
          <GodviewMonitor
            view={view}
            parameters={monitorParameterDefaults(view.parameterGroups)}
            door={door}
            panes={panes}
          />
        </>
      );
    }
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    await act(async () => {
      root?.render(
        <GodviewAgentsProvider door={foldDoor()}>
          <Overlay />
        </GodviewAgentsProvider>,
      );
    });
    await settle();
    const field = container.querySelector<HTMLElement>(".vf-monitor-swarm");
    if (field === null) throw new Error("the monitor's swarm never mounted");
    Object.defineProperty(field, "clientWidth", { value: 1280, configurable: true });
    Object.defineProperty(field, "clientHeight", { value: 720, configurable: true });
    Object.defineProperty(field, "setPointerCapture", { value: vi.fn() });
    Object.defineProperty(field, "hasPointerCapture", { value: () => false });
    Object.defineProperty(field, "releasePointerCapture", { value: vi.fn() });
    const pointer = (type: string, x: number, y: number): void => {
      field.dispatchEvent(
        new PointerEvent(type, {
          bubbles: true,
          button: 0,
          buttons: type === "pointerup" ? 0 : 1,
          pointerId: 1,
          clientX: x,
          clientY: y,
        }),
      );
    };
    await act(async () => {
      pointer("pointermove", 640, 420);
      pointer("pointerdown", 640, 420);
      await new Promise((resolve) => setTimeout(resolve, 650));
    });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 120));
    });
    const bud = container.querySelector<HTMLElement>(
      '[data-bloom-bud-kind="profile"][data-bloom-bud-id="work"]',
    );
    if (bud === null) throw new Error("the hold bloomed no Work bud");
    const px = (name: string): number => Number.parseFloat(bud.style.getPropertyValue(name));
    const work = {
      x: px("--vf-bloom-tx") + px("--vf-bloom-d") / 2,
      y: px("--vf-bloom-ty") + px("--vf-bloom-d") / 2,
    };
    await act(async () => {
      pointer("pointermove", work.x, work.y);
      await new Promise((resolve) => setTimeout(resolve, 40));
      pointer("pointerup", work.x, work.y);
    });
    await settle();
    expect(creates()).toEqual([
      { cwd: "/home/tester/vibe-field", workloadClass: "interactive", profileSet: "work" },
    ]);
    expect(workspace.mounts).toContain("born-1");
    expect(container.querySelector(".vf-monitor-ack")?.textContent).toBe(
      "terminal opened under Work in the active pane",
    );
  });
});
