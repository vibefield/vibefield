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
  cwd: string | null;
  cols: number;
  rows: number;
}
interface StubPane {
  id: string;
  session: StubSession;
}

function stubSession(id: string, overrides: Partial<StubSession> = {}): StubSession {
  return { id, exited: false, cwd: "/home/tester/vibe-field", cols: 80, rows: 24, ...overrides };
}

/** The workspace's state, mutable from the test and from the deck's own door. */
const workspace = {
  panes: [] as StubPane[],
  activePaneId: "",
  /** Every session the deck asked the workspace to show, in order. */
  mounts: [] as string[],
  /** The live context's `mountSession`, so a test can land a birth the way
   * ghosttea lands what `createSplitSession` answers. */
  mount: (_summary: { id: string; cwd?: string | null }) => undefined as void,
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
}: {
  sidebar: ComponentType<{ workspace: unknown }>;
  decoratePane?: (session: StubSession) => { color?: string; label?: string } | undefined;
}): ReactElement {
  const [version, setVersion] = useState(0);
  const context = useMemo(
    () => ({
      panes: workspace.panes,
      sessions: workspace.panes.map((pane) => pane.session),
      activePaneId: workspace.activePaneId,
      activeSession: workspace.panes.find((pane) => pane.id === workspace.activePaneId)?.session,
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
  return (
    <>
      <Sidebar workspace={context} />
      {/* `.ghostty-window` is the library's own wrapper, and the deck's zoom
          measures the gesture against it — so the stub renders it too. */}
      <div className="ghostty-window">
        {workspace.panes.map((pane) => {
          // The accent layer is ghosttea's, and the library draws it only for a
          // pane the host DEALT a colour — through this very prop. Hard-coding
          // it on every stub pane was more generous than the library, and since
          // PU-14b it is also a visible difference: the frame's line and glow
          // take the project colour under `[data-pane-accent]` and the
          // terminal's ink without it.
          const face = decoratePane?.(pane.session);
          return (
            <div
              key={pane.id}
              className={`ghostty-pane${pane.id === workspace.activePaneId ? " is-active" : ""}`}
              data-pane-id={pane.id}
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
  createGhostteaTerminalRuntime: () => ({
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
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
        decoratePane={
          props["decoratePane"] as (
            session: StubSession,
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

const { configureTerminalPool, disposeTerminalPool } = await import("../src/terminal/pool");
const { GodviewDeck } = await import("../src/godview/GodviewDeck");
const { GodviewAgentsProvider } = await import("../src/godview/monitor/GodviewAgentsProvider");
type RemoteSessionDoor = import("../src/godview/monitor/remote-door").RemoteSessionDoor;

let root: Root | null = null;
let container: HTMLElement | null = null;
let requests: Array<{ method: string; params: unknown }> = [];
/** What `agent.interrupt` answers with — or, when it is an Error, throws. */
let interruptAnswer: unknown = { accepted: true };
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
    if (method === "terminal.roster") return Promise.resolve({ items: [] });
    if (method === "terminal.openTicket") {
      return Promise.resolve(routedTicket((params as { sessionId: string }).sessionId));
    }
    if (method === "terminal.create") {
      return Promise.resolve({
        sessionId: "born-1",
        // A shell that has not drawn its first prompt has announced no OSC 7,
        // so the floor reports no cwd — which is the case `fallbackCwd` is for.
        // (ERRATA 2026-09-25, GT-8b: a ghosttea 0.12.0 floor reports the spawn
        // directory from creation, so this `cwd: null` is an older floor's.)
        session: bornSummary("born-1", { cwd: null }),
        ...routedTicket("born-1"),
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
    return Promise.reject(new Error(`unexpected method ${method}`));
  },
};

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
    providers: vi.fn(async () => []),
    spawn: vi.fn(async () => ({ state: "no-pane" as const })),
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
  for (let i = 0; i < 6; i++) {
    await act(async () => {
      await Promise.resolve();
    });
  }
}

async function mountDeck(): Promise<HTMLElement> {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root?.render(
      <GodviewAgentsProvider door={foldDoor()}>
        <GodviewDeck
          active
          theme="light"
          onRemoteDoor={(next) => {
            deckDoor = next;
          }}
        />
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
  workspace.panes = [{ id: "pane-1", session: stubSession("pty-1") }];
  workspace.activePaneId = "pane-1";
  workspace.mounts = [];
  localStorage.clear();
  disposeTerminalPool();
  configureTerminalPool({ transport: "routed", defaultShell: "/bin/zsh", home: "/home/tester" });
  installHost();
});

afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  root = null;
  container = null;
  vi.restoreAllMocks();
});

describe("the deck's pane frames", () => {
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

  it("gives a shell pane the bare badge — the folder, and no readout, mark or verb", async () => {
    const host = await mountDeck();
    const frame = frameFor(host, "pty-1");
    expect(frame?.querySelector(".vf-pane-name")?.textContent).toBe("vibe-field");
    expect(frame?.querySelector(".vf-pane-mark")).toBeNull();
    expect(frame?.querySelector(".vf-pane-readout")).toBeNull();
    expect(frame?.querySelector(".vf-pane-verb")).toBeNull();
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

  it("resumes an ended run and hands its pane the new terminal", async () => {
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
    // A shell pane has no verbs at all (the package's rule: no agent, nothing
    // to act on), so the zoom is pressed on a managed one.
    foldRows = [
      managedSummary({ runtimeRunId: "run-1", terminalSessionId: "pty-1", status: "idle" }),
    ];
    const host = await mountDeck();
    const zoomHost = host.querySelector<HTMLElement>(".vf-deck-zoom");
    expect(zoomHost?.dataset["zoomPhase"]).toBe("idle");
    const zoomVerb = verb(frameFor(host, "pty-1"), "zoom");
    expect(zoomVerb).not.toBeNull();
    await act(async () => zoomVerb?.click());
    expect(zoomHost?.dataset["zoomPhase"]).not.toBe("idle");
    expect(paneOf(host, "pane-1")?.hasAttribute("data-vf-zoom-pane")).toBe(true);
  });

  it("says where a peer's session lives, from the attach that put it there", async () => {
    const host = await mountDeck();
    expect(deckDoor).not.toBeNull();
    await act(async () => {
      await deckDoor?.attach({
        deviceId: "mini",
        deviceName: "mini",
        remoteSessionId: "s1",
        color: "oklch(0.66 0.13 60)",
      });
    });
    await settle();
    const frame = frameFor(host, "replica-mini-s1");
    expect(frame).not.toBeNull();
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
