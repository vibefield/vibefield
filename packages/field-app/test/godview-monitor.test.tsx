// @vitest-environment happy-dom
/**
 * The monitor stage, MOUNTED (GT-3m, re-fed at AR-3).
 *
 * The deck fixture beside this one stubs the bridge, the floor and the GPU
 * because the deck cannot have them here. This one stubs exactly ONE thing —
 * the door — and that is the point of GT-D13: a view is a pure function of its
 * props and the source behind the seam is the deck's door, so the real
 * registry, the real projection, the real classifier and the real matter
 * engine all run against rows shaped exactly as fieldd's fold sends them.
 *
 * What it holds:
 *   1. the stage mounts on the registry's default view with the fold's rows
 *      and the deck's unclaimed pane on it
 *   2. THE CLAIM — the local chip counts managed agents, in the DOM and in the
 *      marker, and nothing on the stage says "mock" any more
 *   3. PF6 — closing disposes: every interval cleared, the physics disposed
 *   4. select mounts an existing session; create opens an empty terminal
 *   5. with no door there are no rows and no invented ones
 *
 * AR-5 moved the views into `@vibecook/puppeteer-views`, and two things about
 * this fixture follow from that. The swarm PAINTS ON WEBGPU now, which happy-dom
 * does not have, so it draws its honest unavailable notice and its keyboard list
 * instead of DOM bubbles — the rows are still there to assert on, in
 * `.vf-monitor-swarm-list`, and anything that needs laid-out rows uses the list
 * view. And the physics engine belongs to the package, which resolves its own
 * matter-js copy, so the disposal claim below is made at the DRIVER — the seam
 * the stage actually owns — rather than by spying on an engine in this
 * workspace's copy that the package would never have called.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { SessionSummary } from "@vibecook/ghosttea-protocol";
import {
  type AccountUsagePort,
  type AgentMonitorProps,
  type AgentMonitorView,
  DEFAULT_MONITOR_VIEW_ID,
  type HistoryPort,
  monitorParameterDefaults,
  monitorViewFor,
} from "@vibecook/puppeteer-views";
import {
  createInlineSwarmPhysicsDriver,
  type SwarmPhysicsDriver,
} from "@vibecook/puppeteer-views/physics";
import type { AgentPersona, AgentProfileSet, TerminalInfo } from "@vibefield/contracts";
import { act, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { GodviewMonitorFacts } from "../src/development-console";
import { GodviewMonitor } from "../src/godview/GodviewMonitor";
import { usagePortOver } from "../src/godview/monitor/doors";
import type { AgentSessionSummary } from "../src/godview/monitor/facet-types";
import { GodviewAgentsProvider } from "../src/godview/monitor/GodviewAgentsProvider";
import { monitorHoldsKeys, takeLauncherKeys } from "../src/godview/monitor/launcher-keys";
import type { MonitorDoor, ProfileSetsPort } from "../src/godview/monitor/remote-door";
import { HERE_DEVICE_ID } from "../src/godview/monitor/spawn-menu";
import type { MonitorPaneFacts } from "../src/godview/monitor/useMonitorAgents";
import { setSwarmPhysicsDriverFactory } from "../src/godview/views/swarm/swarm-physics-driver";
import { managedSummary } from "./managed-session-fixture";
import { type ScriptedModelBoard, scriptedModelBoard, terminalInfoOf } from "./model-board-fixture";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/**
 * §2.5 and record §02's tint, stamped onto the document — because the palette is
 * supposed to READ them, and a test with no tokens would prove only that the
 * fallbacks work.
 *
 * The tint pair is the load-bearing half. A project's colour is no longer one of
 * §2.6's eight accents: main deals the project a sequence, and `--tint-l` /
 * `--tint-c` (godview.css's light theme) are the lightness and chroma every hue
 * is drawn at, so nothing is louder than anything else. The palette's fallback
 * for both is 0, which is black — deliberately, obviously wrong — so a fixture
 * that forgot them would read every project as the same colour.
 */
const TOKENS: Record<string, string> = {
  "--tint-l": "0.6",
  "--tint-c": "0.15",
  "--text-faint": "rgba(0, 0, 0, 0.35)",
  "--vf-green": "#30d158",
  "--vf-orange": "#ff9f0a",
  "--vf-card-deep": "#000000",
};

/** Three managed rows, as the fold sends them, and one pane no agent claims. */
const ROWS: readonly AgentSessionSummary[] = [
  managedSummary({
    runtimeRunId: "run-claude",
    kind: "claude",
    label: "Claude",
    status: "working",
    cwd: "/project/vibe-field",
    createdAt: "2026-09-12T10:00:00.000Z",
  }),
  managedSummary({
    runtimeRunId: "run-codex",
    kind: "codex",
    label: "Codex",
    status: "blocked",
    blocker: { kind: "permission", tool: "Bash" },
    cwd: "/project/voyager",
    createdAt: "2026-09-12T10:00:01.000Z",
  }),
  managedSummary({
    runtimeRunId: "run-grok",
    kind: "grok",
    label: "Grok",
    status: "idle",
    cwd: "/project/jabali",
    createdAt: "2026-09-12T10:00:02.000Z",
  }),
];
const pane = (id: string, cwd = "/project/scratch"): SessionSummary =>
  ({ id, exited: false, createdAtMs: 5, cwd, title: "zsh" }) as SessionSummary;
/** The deck's panes: the codex agent's PTY, and one unclaimed shell. */
const PANES: MonitorPaneFacts = {
  sessionIds: ["run-codex-pty", "pane-1"],
  activeSessionId: "pane-1",
  sessions: [pane("run-codex-pty", "/project/voyager"), pane("pane-1")],
};

const CHECKED_AT = "2026-09-13T00:00:00.000Z";

/**
 * The two ports AR-5 added to the door, as honest fakes.
 *
 * The find sheet and the usage column are the PACKAGE's, and they are tested
 * there. What this fixture owes them is a port that answers without inventing:
 * an index nobody can reach (`reachable: false`, and a search that says it was
 * not answered rather than that there were no matches) and a usage feed that
 * has nothing in it yet. The adapters that build the real ones over fieldd have
 * their own fixture (`godview-monitor-doors.test.ts`).
 */
function unreachableHistory(): HistoryPort {
  const status = { reachable: false, detail: "no index in this fixture", checkedAt: CHECKED_AT };
  return {
    status: async () => status,
    facts: async () => [],
    search: async () => ({ status, answered: false, hits: [], clipped: false }),
  };
}

function emptyUsage(): AccountUsagePort {
  return {
    snapshot: async () => ({ refreshedAt: CHECKED_AT, entries: [] }),
    subscribe: () => () => undefined,
  };
}

interface FakeDoor extends MonitorDoor {
  mountLocal: ReturnType<typeof vi.fn>;
  createTerminal: ReturnType<typeof vi.fn>;
  attach: ReturnType<typeof vi.fn>;
  /** Send the subscriber another frame. The fold pushes whole fields at its own
   * cadence and re-sends them for reasons that are none of the stage's
   * business, so a test that only ever delivers one frame cannot see what the
   * stage does with the second — which is where the once-guards live. */
  push(rows: readonly AgentSessionSummary[]): void;
}

/** MV-3b — the model board the window's rows come from (`model-board-fixture.ts`):
 * fieldd's real backend on the door's fold rows, with the deck's pane sessions
 * and the roster's PTYs as the floor's inventory (`syncBoard`). One per door,
 * disposed with the test; the fold stays on the door for the readers the model
 * does not serve (the marker, the find sheet). */
let board: ScriptedModelBoard | null = null;

/** fieldd's inventory as the deck's facts imply it: every pane's session, and
 * the roster's PTYs no pane shows (GT-6b). */
function floorOf(panes: MonitorPaneFacts): TerminalInfo[] {
  const listed = new Set((panes.sessions ?? []).map((session) => session.id));
  return [
    ...(panes.sessions ?? []).map((session) => terminalInfoOf(session)),
    ...(panes.floor ?? [])
      .filter((row) => !listed.has(row.sessionId))
      .map((row) =>
        terminalInfoOf(
          { id: row.sessionId, createdAtMs: 0, title: row.title } as unknown as SessionSummary,
          row.workloadClass,
        ),
      ),
  ];
}

/** What the daemon would know from the deck's facts: the floor, and which shells were born under a profile. */
function syncBoard(panes: MonitorPaneFacts): void {
  if (board === null) return;
  for (const [sessionId, set] of panes.profileSets ?? []) board.bind(sessionId, set);
  board.floor(floorOf(panes));
}

/** The board's open lands in a microtask and the replica publishes on the next
 * frame: let both arrive before reading the stage. */
async function settle(): Promise<void> {
  for (let round = 0; round < 3; round += 1) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    await act(async () => {
      await Promise.resolve();
    });
  }
}

function fakeDoor(rows: readonly AgentSessionSummary[] = ROWS): FakeDoor {
  let publish: ((rows: readonly AgentSessionSummary[]) => void) | null = null;
  board?.dispose();
  const held = scriptedModelBoard({ rows });
  board = held;
  return {
    model: held.port,
    observeMesh: vi.fn(({ onOpen }) => {
      onOpen({ devices: [] });
      return () => undefined;
    }),
    attach: vi.fn(async () => ({ state: "attached" as const, sessionId: "r", readWrite: true })),
    observe: vi.fn(({ onFrame }) => {
      publish = onFrame;
      onFrame(rows);
      return () => {
        publish = null;
      };
    }),
    push: (next) => {
      publish?.(next);
      held.publish(next);
    },
    createTerminal: vi.fn(async () => ({ state: "mounted" as const, sessionId: "born-1" })),
    mountLocal: vi.fn(async (sessionId: string) => ({ state: "mounted" as const, sessionId })),
    history: unreachableHistory(),
    usage: emptyUsage(),
  };
}

let root: Root | null = null;
let container: HTMLElement | null = null;
let markers: GodviewMonitorFacts[] = [];

/** Every interval this stage opened, and every one it closed. The PF6 claim is
 * literally the difference between these two sets. */
let openedIntervals: number[] = [];
let clearedIntervals: number[] = [];
let builtDrivers = 0;
let disposedDrivers = 0;

beforeEach(() => {
  markers = [];
  openedIntervals = [];
  clearedIntervals = [];
  builtDrivers = 0;
  disposedDrivers = 0;
  localStorage.clear();
  // GT-3c: happy-dom has no `Worker`, so the swarm simulates in-thread. The
  // stand-in is not a mock — it is the package's own inline driver, the same
  // host and the same world the worker runs — wrapped only to count the
  // lifecycle the stage is responsible for.
  setSwarmPhysicsDriverFactory((options) => {
    builtDrivers += 1;
    const driver: SwarmPhysicsDriver = createInlineSwarmPhysicsDriver(options);
    return {
      mode: driver.mode,
      post: (command, transfer) => driver.post(command, transfer),
      dispose: () => {
        disposedDrivers += 1;
        driver.dispose();
      },
    };
  });
  for (const [name, value] of Object.entries(TOKENS)) {
    document.documentElement.style.setProperty(name, value);
  }
  vi.spyOn(console, "log").mockImplementation((line: unknown) => {
    if (typeof line === "string" && line.startsWith("GODVIEW_MONITOR ")) {
      markers.push(JSON.parse(line.slice("GODVIEW_MONITOR ".length)) as GodviewMonitorFacts);
    }
  });
  const realSetInterval = window.setInterval.bind(window);
  const realClearInterval = window.clearInterval.bind(window);
  vi.spyOn(window, "setInterval").mockImplementation(((...args: Parameters<typeof setInterval>) => {
    const id = realSetInterval(...args) as unknown as number;
    openedIntervals.push(id);
    return id;
  }) as typeof window.setInterval);
  vi.spyOn(window, "clearInterval").mockImplementation(((id?: number) => {
    if (id !== undefined) clearedIntervals.push(id);
    realClearInterval(id);
  }) as typeof window.clearInterval);
});

afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  root = null;
  container = null;
  setSwarmPhysicsDriverFactory(undefined);
  board?.dispose();
  board = null;
  for (const name of Object.keys(TOKENS)) document.documentElement.style.removeProperty(name);
  vi.restoreAllMocks();
  // `restoreAllMocks` does not undo `stubGlobal`, and the inset row below stubs
  // ResizeObserver — left behind it would be a fixture every later row silently
  // inherited.
  vi.unstubAllGlobals();
});

async function mountMonitor(
  viewId: string = DEFAULT_MONITOR_VIEW_ID,
  door: MonitorDoor | null = fakeDoor(),
  panes: MonitorPaneFacts = PANES,
): Promise<HTMLElement> {
  const view = monitorViewFor(viewId);
  syncBoard(panes);
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root?.render(
      <GodviewAgentsProvider door={door}>
        <GodviewMonitor
          view={view}
          parameters={monitorParameterDefaults(view.parameterGroups)}
          door={door}
          panes={panes}
        />
      </GodviewAgentsProvider>,
    );
  });
  await settle();
  return container;
}

/** Re-render the SAME root with new facts — the deck republishing its panes,
 * which is what a select that moves a pane looks like from here. */
async function renderMonitor(
  viewId: string,
  door: MonitorDoor | null,
  panes: MonitorPaneFacts,
): Promise<void> {
  const view = monitorViewFor(viewId);
  syncBoard(panes);
  await act(async () => {
    root?.render(
      <GodviewAgentsProvider door={door}>
        <GodviewMonitor
          view={view}
          parameters={monitorParameterDefaults(view.parameterGroups)}
          door={door}
          panes={panes}
        />
      </GodviewAgentsProvider>,
    );
  });
  await settle();
}

const latest = (): GodviewMonitorFacts => markers[markers.length - 1] as GodviewMonitorFacts;
const ackText = (host: HTMLElement): string =>
  host.querySelector(".vf-monitor-ack")?.textContent ?? "";
/** The swarm's rows in the DOM. It paints its bodies on WebGPU, so this is the
 * keyboard list beside the canvas — the same rows, reachable without a pointer,
 * and the only DOM the swarm has to count. */
const swarmRows = (host: HTMLElement): HTMLButtonElement[] => [
  ...host.querySelectorAll<HTMLButtonElement>(".vf-monitor-swarm-list li button"),
];
/** The view buttons on the package's instrument bar, and the one that is on. */
const viewButtons = (host: HTMLElement): HTMLButtonElement[] => [
  ...host.querySelectorAll<HTMLButtonElement>(
    '[role="group"][aria-label="Monitor view"] button[aria-pressed]',
  ),
];
const pressedView = (host: HTMLElement): string | undefined =>
  viewButtons(host)
    .find((button) => button.getAttribute("aria-pressed") === "true")
    ?.getAttribute("aria-label") ?? undefined;

describe("the monitor stage", () => {
  // ---- the claims strip and the flow views (GT-6a) --------------------------
  //
  // The strip is VibeField's own chrome (AR-3's counts, GT-5c's degraded
  // sentence) and it is pinned 11px down the stage. `list.css` pins the
  // package's toolbar 11px down too, because the reference host has no claims
  // to make room for — so the two printed over each other on James's
  // 2026-09-13 pass. The fix publishes the strip's measured bottom and the
  // flow view's band starts from there; these rows hold that seam.
  //
  // Every rect in happy-dom is zero, so the geometry is FED here rather than
  // laid out. That is the honest shape for this claim anyway: what is under
  // test is the arithmetic and the wiring, and a layout engine would only be
  // deciding the inputs.
  function driveObservers(): Array<() => void> {
    const fire: Array<() => void> = [];
    class DrivenResizeObserver {
      constructor(private readonly callback: ResizeObserverCallback) {
        fire.push(() => this.callback([], this as unknown as ResizeObserver));
      }
      observe(): void {}
      unobserve(): void {}
      disconnect(): void {}
    }
    vi.stubGlobal("ResizeObserver", DrivenResizeObserver);
    return fire;
  }
  const rect = (top: number, bottom: number): DOMRect =>
    ({ top, bottom, left: 0, right: 900, width: 900, height: bottom - top }) as DOMRect;

  it("starts a flow view below the claims strip, never under it (GT-6a)", async () => {
    const fire = driveObservers();
    const host = await mountMonitor("list");
    const stage = host.querySelector<HTMLElement>(".vf-godview-monitor-stage");
    const claims = host.querySelector<HTMLElement>(".vf-monitor-claims");
    // The strip has something to say here — otherwise this row would prove
    // nothing about a collision that only happens when it does.
    expect(claims?.textContent ?? "").toContain("managed agent");
    stage!.getBoundingClientRect = () => rect(44, 400);
    claims!.getBoundingClientRect = () => rect(55, 64);
    act(() => {
      for (const publish of fire) publish();
    });
    // 64 − 44: the strip's bottom in the stage's own coordinates. The band
    // under it is the package's, added by the rule in `godview.css`, so this
    // number is a measurement and not a spacing decision.
    expect(stage?.style.getPropertyValue("--vf-monitor-claims-bottom")).toBe("20px");
  });

  it("gives a silent strip no room at all, so the package's own band stands", async () => {
    const fire = driveObservers();
    // No door: nobody has been asked yet, so there is no claim to make and
    // `remoteUnavailableClaim` stays quiet on `no-door` (GT-5c).
    const host = await mountMonitor("list", null);
    const stage = host.querySelector<HTMLElement>(".vf-godview-monitor-stage");
    const claims = host.querySelector<HTMLElement>(".vf-monitor-claims");
    // Silent, but not childless: the strip always carries its empty aria-live
    // span, which is why the publisher reads the strip's HEIGHT and not its
    // child count. The fed rect has none.
    expect(claims?.textContent).toBe("");
    expect(claims?.childElementCount).toBeGreaterThan(0);
    stage!.getBoundingClientRect = () => rect(44, 400);
    claims!.getBoundingClientRect = () => rect(55, 55);
    act(() => {
      for (const publish of fire) publish();
    });
    expect(stage?.style.getPropertyValue("--vf-monitor-claims-bottom")).toBe("0px");
  });

  it("mounts on the registry's default view with the fold's rows and the deck's pane on it", async () => {
    const host = await mountMonitor();
    expect(latest().viewId).toBe("swarm");
    // Three managed agents plus the unclaimed pane — and the marker separates
    // them, because "rows" and "agents" are different claims.
    expect(latest().agents).toBe(4);
    expect(latest().agentBacked).toBe(3);
    expect(latest().localAgents).toBe(3);
    expect(latest().terminals).toBe(1);
    expect(latest().localState).toBe("live");
    expect(swarmRows(host).length).toBe(4);
    // The bar is the header now, and it wears the chosen view rather than a
    // `<select>` — the one place the choice is readable off the screen.
    expect(pressedView(host)).toBe("SWARM view");
  });

  it("draws the model's rows before the full board's first frame, and the find sheet never reads the shim's monitor (M47)", async () => {
    // At 283cf3e9 the window held two subscriptions, and the model board's open
    // could reach it before the full board's first frame. The find sheet is
    // always mounted and computes its scope on every render; it read the legacy
    // shim's `monitor` on such a row, a sketch with no `session`, and threw in
    // render, which unmounted the whole window (build-mv M47). MV-3d: the full
    // board is no longer asked and the sheet's facts ride the model board's own
    // rows (`findAgentsOf`); a full board that never answers changes nothing.
    const door = fakeDoor();
    // the full board's listener stands, and no frame has come yet
    door.observe = vi.fn(() => () => undefined);
    const host = await mountMonitor(DEFAULT_MONITOR_VIEW_ID, door);
    expect(pressedView(host)).toBe("SWARM view");
    expect(latest().localAgents).toBe(3);
  });

  it("names every run of the fold on the marker — its pane, whose doing it is, drawn or not (AR-7)", async () => {
    // A name typed at a pane's prompt is a run like any other: its row joins
    // the pane its shell is (an INTERACTIVE cell's session, not the agent
    // cell's) and says `user-shell`. And an ended run must be told apart from
    // one that left: the stage drops a run that is not alive from its bodies,
    // so the counts cannot say whether the fold still HOLDS it — this can.
    const typed: AgentSessionSummary = {
      ...managedSummary({
        runtimeRunId: "run-typed",
        kind: "claude",
        label: "Claude",
        status: "idle",
        terminalSessionId: "pane-1",
      }),
      terminal: { hosted: "local", runtimeSessionId: "pane-1", workloadClass: "interactive" },
      spawnedBy: "user-shell",
    };
    const ended = managedSummary({
      runtimeRunId: "run-ended",
      alive: false,
      terminalSessionId: "pane-9",
    });
    const exited: AgentSessionSummary = {
      ...ended,
      continuation: { persisted: true, resumable: true, exited: true },
    };
    const quiet = managedSummary({
      runtimeRunId: "run-quiet",
      terminalSessionId: null,
      monitor: false,
    });
    const host = await mountMonitor(
      DEFAULT_MONITOR_VIEW_ID,
      fakeDoor([ROWS[0] as AgentSessionSummary, typed, exited, quiet]),
    );
    expect(latest().runs).toEqual([
      {
        run: "run-claude",
        provider: "claude",
        terminal: "run-claude-pty",
        spawnedBy: "app",
        status: "working",
        exited: false,
        observed: true,
        drawn: true,
      },
      {
        run: "run-typed",
        provider: "claude",
        terminal: "pane-1",
        spawnedBy: "user-shell",
        status: "idle",
        exited: false,
        observed: true,
        drawn: true,
      },
      {
        run: "run-ended",
        provider: "codex",
        terminal: "pane-9",
        spawnedBy: "app",
        status: "idle",
        exited: true,
        observed: true,
        drawn: false,
      },
      // no pane of this device hosts it, and nothing has spoken for it yet.
      // MV-3b: NOT drawn — a run with no mirror and no PTY is not alive by
      // fieldd's one liveness rule (ruled 2026-09-13; `hostRunFromSummary`),
      // which the backend now applies for the window too. The seam drew it as
      // a "starting" body from its own second copy of the rule; the marker
      // still names it, which is what this row is for.
      {
        run: "run-quiet",
        provider: "codex",
        spawnedBy: "app",
        status: "idle",
        exited: false,
        observed: false,
        drawn: false,
      },
    ]);
    // the typed run is a body, exactly as the spawned one is: two agents
    // drawn, and the pane it is in is no longer an unclaimed terminal row
    expect(latest().agentBacked).toBe(2);
    expect(latest().terminals).toBe(1);
    expect(
      swarmRows(host).filter((row) => row.dataset["agentBubbleSource"] === "agent").length,
    ).toBe(2);
  });

  it("says WEBGPU UNAVAILABLE rather than drawing an empty field on a device with no GPU", async () => {
    // The honest-states law where AR-5's port put it. happy-dom has no WebGPU,
    // and a swarm that answered that with a blank canvas would look exactly
    // like a field with nothing in it. The section says what painted, the
    // marker repeats it, and the rows are still reachable underneath.
    // The marker follows the attribute through a MutationObserver. happy-dom
    // (20.11) hands each observed node its report callback through a WeakRef
    // nothing else holds, so a collection mid-run silenced it (~2 in 10
    // whole-file runs, always green alone) — the observer's word is delivered by
    // hand, as in the spawn-bloom row below; the stage's reading of it is what
    // is under test.
    const observers = new Set<{ callback: MutationCallback }>();
    class HandDeliveredObserver {
      constructor(readonly callback: MutationCallback) {}
      observe(): void {
        observers.add(this);
      }
      disconnect(): void {
        observers.delete(this);
      }
      takeRecords(): MutationRecord[] {
        return [];
      }
    }
    vi.stubGlobal("MutationObserver", HandDeliveredObserver);
    const host = await mountMonitor();
    const swarm = host.querySelector(".vf-monitor-swarm");
    expect(swarm?.getAttribute("data-swarm-renderer")).toBe("unavailable");
    expect(swarm?.querySelector(".vf-monitor-empty")?.textContent).toContain("WEBGPU UNAVAILABLE");
    await act(async () => {
      for (const observer of [...observers]) {
        observer.callback([], observer as unknown as MutationObserver);
      }
    });
    expect(latest().swarmRenderer).toBe("unavailable");
    // …and the physics still ran: what is missing is the painter, not the world.
    expect(latest().swarmPhysics).toBe("inline");
  });

  it("WEARS THE CLAIM — the count of managed agents, in the DOM and in the marker; nothing says mock", async () => {
    // GT-D13's law was that invented rows say so. There are none: the chip now
    // counts what fieldd reports, and the word that used to disclose the mock
    // must be gone from the stage entirely — its presence would mean the
    // invented field is back.
    const host = await mountMonitor();
    const chip = host.querySelector(".vf-monitor-local-chip");
    expect(chip?.textContent).toBe("3 managed agents");
    expect(latest().localClaim).toBe("3 managed agents");
    expect(chip?.closest("[data-monitor-chrome]")).not.toBeNull();
    expect(host.textContent?.toLowerCase()).not.toContain("mock");
    expect(JSON.stringify(latest()).toLowerCase()).not.toContain("mock");
  });

  it("colors a row by its PROJECT's dealt tint, read from the live tokens (record §02)", async () => {
    // Read off the LIST view, which lays its rows out in the DOM: the swarm
    // resolves the same palette into numbers for the GPU, so there is no
    // element left there to carry a custom property.
    //
    // The claim is §02's rather than §2.6's: a row's colour is its PROJECT's,
    // dealt once and drawn at the theme's own lightness and chroma — so three
    // projects are three colours, and the pane no agent claims belongs to no
    // project and wears the ramp. A palette that resolved nothing would make
    // all four black, which is exactly what the tint fallback is for. Since
    // MV-4 the list is an SDK view and its row colour is its own property
    // (L18: `--mv-list-colour`, set from the row's `colour`).
    const host = await mountMonitor("list");
    const byProject = new Map<string, string>();
    for (const row of host.querySelectorAll<HTMLElement>(".vf-monitor-list-row")) {
      const project = row.querySelector(".vf-monitor-list-project")?.textContent ?? "";
      byProject.set(project, row.style.getPropertyValue("--mv-list-colour"));
    }
    const ramp = byProject.get("scratch");
    const dealt = ["vibe-field", "voyager", "jabali"].map((project) => {
      const color = byProject.get(project);
      expect(color, `${project} was never drawn`).toMatch(/^#[0-9a-f]{6}$/i);
      expect(color, `${project} wears the ramp instead of a dealt tint`).not.toBe(ramp);
      return color;
    });
    expect(new Set(dealt).size, "two projects were dealt the same hue").toBe(dealt.length);
    // The unclaimed terminal belongs to no project: the ramp, not a hue.
    expect(ramp).toBe(TOKENS["--text-faint"]);
  });

  it("renders every view in the registry against the same field", async () => {
    // The contract's real claim: a view is a pure function of its props, so
    // swapping one changes what is drawn and nothing else.
    for (const [viewId, selector] of [
      ["swarm", ".vf-monitor-swarm-list li button"],
      ["list", ".vf-monitor-list-row"],
      ["rain", ".vf-monitor-rain-agents button"],
    ] as const) {
      const host = await mountMonitor(viewId);
      expect(latest().viewId).toBe(viewId);
      expect(host.querySelectorAll(selector).length).toBe(4);
      act(() => root?.unmount());
      container?.remove();
      root = null;
    }
  });

  it("PF6: closing disposes — every timer cleared, the subscription closed, the physics driver disposed", async () => {
    await mountMonitor();
    // MV-3b: the clocks the seam ran here (the mesh poll, the 10 s now) are the
    // backend's now, so there is no interval to count on; the window's ONE model
    // subscription is what the stage holds open, and whatever it still opens
    // must close with it
    expect(board?.opened(), "the model board never opened").toBe(1);
    expect(board?.closed()).toBe(0);
    expect(clearedIntervals).not.toEqual(expect.arrayContaining(openedIntervals));
    expect(builtDrivers, "the swarm never started its physics").toBeGreaterThan(0);

    // the view lives in the bridge's own React root, which the host releases a
    // microtask after its own commit (one root never unmounts inside another's)
    await act(async () => {
      root?.unmount();
      await Promise.resolve();
    });
    root = null;

    // The whole PF6 claim for this stage, and it is stronger than the deck's:
    // the deck stays mounted and SILENCED, this is gone. Nothing is left
    // ticking, the board is closed, and the physics world was torn down rather
    // than left pumping.
    for (const id of openedIntervals) {
      expect(clearedIntervals, `interval ${id} survived the close`).toContain(id);
    }
    expect(board?.closed(), "the model subscription outlived the close").toBe(1);
    expect(disposedDrivers, "a physics driver outlived the close").toBe(builtDrivers);
  });

  it("keeps a live shell on the roster after a select takes its pane (GT-6b)", async () => {
    // JAMES'S 2026-09-13 SEQUENCE, headless. Two live sessions — a plain shell
    // in the deck's only pane, and a managed Codex run whose PTY no pane is
    // showing. He selected the agent; GT-D17's law mounted it in the ACTIVE
    // pane; the shell left the deck — and left the LIST with it, one row where
    // there had been two, while `terminal.list` and `terminal.sessions` both
    // still reported the shell alive. The floor's roster is what makes the row
    // survive the pane.
    const agent = managedSummary({
      runtimeRunId: "run-vfqa",
      terminalSessionId: "vfqa-agent-pty",
      kind: "codex",
      label: "Codex",
      status: "idle",
      cwd: "/private/tmp/vfqa-agent",
    });
    const door = fakeDoor([agent]);
    const floor: MonitorPaneFacts["floor"] = [
      { sessionId: "vfqa-shell", workloadClass: "interactive", title: "zsh" },
      { sessionId: "vfqa-agent-pty", workloadClass: "agent" },
    ];
    const before: MonitorPaneFacts = {
      sessionIds: ["vfqa-shell"],
      activeSessionId: "vfqa-shell",
      sessions: [pane("vfqa-shell", "/project/scratch")],
      floor,
    };
    const host = await mountMonitor("list", door, before);
    const rows = (): string[] =>
      [...host.querySelectorAll<HTMLElement>(".vf-monitor-list-row")].map(
        (element) => element.textContent ?? "",
      );
    expect(rows()).toHaveLength(2);

    const agentRow = [...host.querySelectorAll<HTMLButtonElement>(".vf-monitor-list-row")].find(
      (candidate) => candidate.textContent?.includes("vfqa-agent"),
    );
    expect(agentRow).toBeDefined();
    await act(async () => agentRow?.click());
    expect(door.mountLocal.mock.calls[0]?.[0]).toBe("vfqa-agent-pty");

    // …and the deck answers the way it did on the day: the one pane now shows
    // the agent's PTY, and the shell is in no pane at all. The floor still
    // holds both, so the monitor must too.
    await renderMonitor("list", door, {
      sessionIds: ["vfqa-agent-pty"],
      activeSessionId: "vfqa-agent-pty",
      sessions: [pane("vfqa-agent-pty", "/private/tmp/vfqa-agent")],
      floor,
    });
    expect(rows(), "the shell is alive on the floor and must still be listed").toHaveLength(2);
    expect(rows().some((text) => text.includes("zsh"))).toBe(true);
  });

  it("mounts a floor-only row through the door by the id the roster named (GT-6b)", async () => {
    // The row carries no pane summary — the UI roster has no cwd, no activity
    // and no birth time — so the only thing select can aim with is the floor
    // id. A row that listed but could not be mounted would be worse than no
    // row at all.
    const door = fakeDoor([]);
    const host = await mountMonitor("list", door, {
      sessionIds: ["paned"],
      activeSessionId: "paned",
      sessions: [pane("paned")],
      floor: [
        { sessionId: "paned", workloadClass: "interactive", title: "zsh" },
        { sessionId: "orphan", workloadClass: "interactive", title: "vim" },
      ],
    });
    const orphan = [...host.querySelectorAll<HTMLButtonElement>(".vf-monitor-list-row")].find(
      (candidate) => candidate.textContent?.includes("vim"),
    );
    expect(orphan, "a live PTY in no pane is a row").toBeDefined();
    // …and the paned session is NOT listed twice: the pane's own row stands.
    expect(host.querySelectorAll(".vf-monitor-list-row")).toHaveLength(2);
    await act(async () => orphan?.click());
    expect(door.mountLocal).toHaveBeenCalledTimes(1);
    expect(door.mountLocal.mock.calls[0]?.[0]).toBe("orphan");
  });

  it("select MOUNTS a managed agent's PTY through the door, and says so (AR-3)", async () => {
    const door = fakeDoor();
    const host = await mountMonitor("list", door);
    // the claude row: an agent whose PTY no pane is showing yet
    const row = [...host.querySelectorAll<HTMLButtonElement>(".vf-monitor-list-row")].find(
      (candidate) => candidate.textContent?.includes("vibe-field"),
    );
    expect(row).toBeDefined();

    await act(async () => row?.click());

    expect(door.mountLocal).toHaveBeenCalledTimes(1);
    expect(door.mountLocal.mock.calls[0]?.[0]).toBe("run-claude-pty");
    expect(door.attach).not.toHaveBeenCalled();
    expect(ackText(host)).toContain("mounted in the active pane");
  });

  it("AR-4: a row that names a replaced PTY the deck is showing hands that pane the new one through the door, once", async () => {
    // the codex run was resumed into a new PTY while the deck's pane still
    // shows the old one (`run-codex-pty`, in PANES): the monitor asks the
    // door to put the new PTY in that pane — with `replacing`, so the deck
    // targets the pane rather than the active one — and only once
    const resumed = managedSummary({
      runtimeRunId: "run-codex",
      terminalSessionId: "run-codex-pty-2",
      replaced: "run-codex-pty",
      cwd: "/project/voyager",
    });
    const door = fakeDoor([resumed]);
    const host = await mountMonitor("list", door);
    await settle();
    expect(door.mountLocal).toHaveBeenCalledTimes(1);
    expect(door.mountLocal.mock.calls[0]).toEqual([
      "run-codex-pty-2",
      { replacing: "run-codex-pty" },
    ]);
    expect(ackText(host)).toContain("resumed in its pane");

    // ONCE, and this is where that word is actually earned. The pane facts do
    // not move in this fixture — the deck still reports the OLD PTY — so every
    // later frame still satisfies the condition that triggered the hand-over,
    // and only the guard stops it happening again. The identical frame is the
    // republish case (the fold re-sends its whole field at its own cadence);
    // the second carries a real change, which gets past the damage gate and
    // leaves the guard alone to do the work.
    await act(async () => door.push([resumed]));
    await settle();
    await act(async () =>
      door.push([
        managedSummary({
          runtimeRunId: "run-codex",
          terminalSessionId: "run-codex-pty-2",
          replaced: "run-codex-pty",
          cwd: "/project/jabali",
        }),
      ]),
    );
    await settle();
    // the frame REACHED the stage — without this the assertion below would
    // pass for a door nobody was listening to
    expect(host.textContent).toContain("jabali");
    expect(door.mountLocal).toHaveBeenCalledTimes(1);
  });

  it("an agent already in the active pane is acknowledged, not re-mounted", async () => {
    const door = fakeDoor();
    const host = await mountMonitor("list", door, { ...PANES, activeSessionId: "run-codex-pty" });
    const row = [...host.querySelectorAll<HTMLButtonElement>(".vf-monitor-list-row")].find(
      (candidate) => candidate.textContent?.includes("voyager"),
    );
    await act(async () => row?.click());
    expect(door.mountLocal).not.toHaveBeenCalled();
    expect(ackText(host)).toContain("is in the active pane");
  });

  it("opens an empty terminal through the view action, without agent or profile controls", async () => {
    const door = fakeDoor();
    const host = await mountMonitor("list", door);
    expect(host.querySelector('select[aria-label="Agent provider"]')).toBeNull();
    expect(host.querySelector('select[aria-label="Agent persona"]')).toBeNull();
    expect(host.querySelector(".vf-godview-spawn")).toBeNull();
    await act(async () => host.querySelector<HTMLButtonElement>(".vf-monitor-list-new")?.click());
    expect(door.createTerminal).toHaveBeenCalledExactlyOnceWith();
    expect(ackText(host)).toContain("terminal opened in the active pane");
  });

  it("long-presses empty swarm space to open one terminal; releasing early cancels", async () => {
    const door = fakeDoor([]);
    const host = await mountMonitor("swarm", door);
    const swarm = host.querySelector<HTMLElement>(".vf-monitor-swarm")!;
    Object.defineProperty(swarm, "setPointerCapture", { value: vi.fn() });
    Object.defineProperty(swarm, "hasPointerCapture", { value: () => false });
    const press = (type: string) =>
      swarm.dispatchEvent(
        new PointerEvent(type, {
          bubbles: true,
          button: 0,
          pointerId: 1,
          clientX: 250,
          clientY: 150,
        }),
      );
    await act(async () => {
      press("pointerdown");
      press("pointerup");
      await new Promise((resolve) => setTimeout(resolve, 600));
    });
    expect(door.createTerminal).not.toHaveBeenCalled();
    await act(async () => {
      press("pointerdown");
      await new Promise((resolve) => setTimeout(resolve, 600));
      press("pointerup");
    });
    expect(door.createTerminal).toHaveBeenCalledExactlyOnceWith();
    expect(ackText(host)).toContain("terminal opened in the active pane");
  });

  it("surfaces a failed usage subscription and retries through the same product port", async () => {
    const door = fakeDoor();
    const batch = { generatedAt: CHECKED_AT, entries: [] };
    const unsubscribe = vi.fn();
    const subscribe = vi
      .fn()
      .mockRejectedValueOnce(new Error("usage stream unavailable"))
      .mockResolvedValue({ snapshot: batch, unsubscribe });
    door.usage = usagePortOver({ request: async () => batch, subscribe });
    const host = await mountMonitor("list", door);
    const column = host.querySelector(".vf-usage-column");
    const retry = [...host.querySelectorAll<HTMLButtonElement>("button")].find(
      (button) => button.textContent === "Usage unavailable · Retry",
    );
    expect(retry?.title).toBe("usage stream unavailable");
    await act(async () => retry?.click());
    expect(subscribe).toHaveBeenCalledTimes(2);
    expect(host.textContent).not.toContain("Usage unavailable · Retry");
    // Retry must preserve the column's existing readings and popup state.
    expect(host.querySelector(".vf-usage-column")).toBe(column);
    act(() => root?.unmount());
    root = null;
    expect(unsubscribe).toHaveBeenCalledOnce();
  });

  it("carries the deck's own words when a terminal cannot open, then rejects with them", async () => {
    // Asked as a view asks (`actions.createAt`), through the probe: a create
    // that opened nothing REJECTS after its words, so a view puts its pending
    // body away at once (SB-3); the views catch it at every call site.
    const door = fakeDoor();
    door.createTerminal.mockResolvedValueOnce({
      state: "failed",
      reason: "terminal capacity reached",
    });
    const host = await mountProbe(door);
    await expect(createAt()).rejects.toThrow(
      "terminal could not be opened — terminal capacity reached",
    );
    expect(ackText(host)).toBe("terminal could not be opened — terminal capacity reached");
    door.createTerminal.mockResolvedValueOnce({ state: "no-pane" });
    await expect(createAt()).rejects.toThrow(
      "no pane to open a terminal in — open one in the deck first",
    );
    expect(ackText(host)).toContain("no pane");
  });

  it("wears the package's instrument bar, with VibeField's own tools in its slots (AR-5)", async () => {
    // The header is the package's now. What is still OURS rides the two slots
    // it offers: the bridge notice leading and the two trailing sheets.
    // A test that only counted
    // the bar's own controls would pass for a bar with our tools dropped.
    const host = await mountMonitor("list", fakeDoor());
    const bar = host.querySelector(".vf-godview-header");
    expect(bar, "the instrument bar never mounted").not.toBeNull();
    expect(bar?.querySelector(".vf-godview-header-notice")).not.toBeNull();
    expect(bar?.querySelector('select[aria-label="Agent provider"]')).toBeNull();
    expect(bar?.querySelector(".vf-godview-spawn")).toBeNull();
    expect(
      bar?.querySelector('button[aria-label="Find an agent by what was said"]'),
    ).not.toBeNull();
    // AR-5b: `aria-controls` names an element that exists — the sheet returns
    // null while closed, so the control names it only while it is open
    expect(bar?.querySelector('button[aria-controls="vf-find-sheet"]')).toBeNull();
    expect(bar?.querySelector('button[aria-controls="vf-godview-tweak-panel"]')).not.toBeNull();
    // The bar owns the view marks and the theme switch, in that order.
    expect(viewButtons(host).map((button) => button.getAttribute("aria-label"))).toEqual([
      "SWARM view",
      "LIST view",
      "RAIN view",
      "TIMELINE view",
    ]);
    expect(pressedView(host)).toBe("LIST view");
    expect(bar?.querySelector('[role="switch"]')?.getAttribute("aria-checked")).toBe("false");
  });

  it("chooses the view with the bar's marks; its theme switch is retired (FC-D7)", async () => {
    const selected: string[] = [];
    const view = monitorViewFor("swarm");
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    await act(async () => {
      const door = fakeDoor();
      root?.render(
        <GodviewAgentsProvider door={door}>
          <GodviewMonitor
            view={view}
            parameters={monitorParameterDefaults(view.parameterGroups)}
            door={door}
            panes={PANES}
            onSelectView={(viewId) => selected.push(viewId)}
          />
        </GodviewAgentsProvider>,
      );
    });
    const list = viewButtons(container).find(
      (button) => button.getAttribute("aria-label") === "LIST view",
    );
    await act(async () => list?.click());
    expect(selected).toEqual(["list"]);

    // Godview follows the app's theme (One Frame FR-4): the views package still
    // draws its ☼◐ switch, pressing it changes nothing, and the host hides it —
    // with the tooltip host around it — until the package draws it only for a
    // host that hands it a handler (the ask on record).
    const themeSwitch = (): HTMLButtonElement | null =>
      container?.querySelector<HTMLButtonElement>('[role="switch"]') ?? null;
    const before = themeSwitch()?.getAttribute("aria-checked");
    await act(async () => themeSwitch()?.click());
    expect(themeSwitch()?.getAttribute("aria-checked")).toBe(before);
    const css = readFileSync(join(process.cwd(), "src/godview/godview.css"), "utf8");
    expect(css).toMatch(
      /\.vf-godview-header \.vf-godview-bar-tip-host:has\(> \.vf-godview-theme-switch\) \{\s*display: none;/,
    );
  });

  it("with NO door: no invented rows and terminal creation explains the missing connection", async () => {
    const host = await mountMonitor("list", null, { sessionIds: [] });
    expect(swarmRows(host).length).toBe(0);
    expect(latest().agents).toBe(0);
    expect(latest().localState).toBe("no-door");
    expect(latest().localClaim).toBeNull();
    expect(host.querySelector(".vf-monitor-local-chip")).toBeNull();
    expect(host.querySelector(".vf-godview-spawn")).toBeNull();
    // creation with no door: a probe row below asks it and reads its words
  });
});

// ---- AR-S5 — the profile tabs -------------------------------------------------
//
// The strip is the package's (`ProfileTabs`); what is VibeField's is what a tab
// DOES: which rows it keeps, what the counters count, what the chords pick,
// where a spawn lands, and the one sentence over an empty tab. The rows here
// say their profile the way fieldd does (`profileSet`), and the feed is the
// door's port, as the deck builds it over `agents.profileSets.subscribe`.

const TAB_AT = "2026-09-24T12:00:00.000Z";
const tabPersona = (profileId: string, provider: string): AgentPersona => ({
  profileId,
  provider,
  label: provider,
  kind: "managed",
  createdAt: TAB_AT,
});
const tabSet = (
  id: string,
  label: string,
  personas: AgentPersona[],
  extra: Partial<AgentProfileSet> = {},
): AgentProfileSet => ({
  id,
  kind: id === "native" ? "native" : "managed",
  label,
  default: false,
  createdAt: TAB_AT,
  personas,
  ...extra,
});
const NATIVE_SET = tabSet("native", "This Mac", [], { default: true });
const WORK_SET = tabSet("work", "Work", [tabPersona("w-claude", "claude")], { glyph: "briefcase" });
const EMPTY_SET = tabSet("empty", "Empty", [], { glyph: "flask" });
const TAB_SETS = [NATIVE_SET, WORK_SET, EMPTY_SET];
/** Claude and Codex under Work (Codex blocked), Grok in its own folder. */
const TAB_ROWS: readonly AgentSessionSummary[] = [
  managedSummary({
    runtimeRunId: "run-claude",
    kind: "claude",
    label: "Claude",
    status: "working",
    profileSet: "work",
    cwd: "/project/vibe-field",
  }),
  managedSummary({
    runtimeRunId: "run-codex",
    kind: "codex",
    label: "Codex",
    status: "blocked",
    blocker: { kind: "permission", tool: "Bash" },
    profileSet: "work",
    cwd: "/project/voyager",
  }),
  managedSummary({
    runtimeRunId: "run-grok",
    kind: "grok",
    label: "Grok",
    status: "idle",
    cwd: "/project/jabali",
  }),
];

interface TabDoor extends FakeDoor {
  pushSets(sets: readonly AgentProfileSet[]): void;
}

function tabDoor(sets: readonly AgentProfileSet[] = TAB_SETS): TabDoor {
  const door = fakeDoor(TAB_ROWS);
  // the backend reads the same feed (a row's `profileSet` is its word)
  board?.profiles(sets);
  let listener: ((next: readonly AgentProfileSet[]) => void) | null = null;
  const profiles: ProfileSetsPort = {
    subscribe: (next) => {
      listener = next;
      next(sets);
      return () => {
        listener = null;
      };
    },
  };
  return Object.assign(door, {
    profiles,
    pushSets: (next: readonly AgentProfileSet[]) => {
      listener?.(next);
      board?.profiles(next);
    },
  });
}

const tabButton = (host: HTMLElement, id: string): HTMLButtonElement | null =>
  host.querySelector<HTMLButtonElement>(`[data-profile-tab="${id}"]`);
const chosenTab = (host: HTMLElement): string | null | undefined =>
  host.querySelector('[role="tab"][aria-selected="true"]')?.getAttribute("data-profile-tab");
const counters = (host: HTMLElement): string[] =>
  [...host.querySelectorAll('[aria-label="Agent status"] .vf-godview-bar-num')].map(
    (node) => node.textContent ?? "",
  );
const listRows = (host: HTMLElement): { project: string; receded: boolean }[] =>
  [...host.querySelectorAll<HTMLButtonElement>(".vf-monitor-list-row")].map((row) => ({
    project: row.querySelector("strong")?.textContent ?? "",
    receded: row.classList.contains("is-receded"),
  }));

describe("the profile tabs (AR-S5)", () => {
  it("draws no strip while This Mac is the only profile, and All first once a profile exists", async () => {
    const door = tabDoor([NATIVE_SET]);
    const host = await mountMonitor("list", door);
    expect(host.querySelector('[role="tablist"]')).toBeNull();
    await act(async () => door.pushSets(TAB_SETS));
    const tabs = [...host.querySelectorAll('[role="tab"]')].map((tab) =>
      tab.getAttribute("data-profile-tab"),
    );
    expect(tabs).toEqual(["all", "native", "work", "empty"]);
    expect(chosenTab(host)).toBe("all");
    // the one dot: Codex is blocked under Work
    expect(tabButton(host, "work")?.getAttribute("aria-label")).toBe("Work, a session is blocked");
    expect(tabButton(host, "native")?.getAttribute("aria-label")).toBe("This Mac");
    // centred between two spacers, before the view marks
    const bar = host.querySelector(".vf-godview-header");
    expect(bar?.querySelectorAll(":scope > .vf-godview-bar-spacer").length).toBe(2);
  });

  it("keeps the chosen profile's sessions, recedes every other row in place, and counts what it shows", async () => {
    const host = await mountMonitor("list", tabDoor());
    const everything = counters(host);
    await act(async () => tabButton(host, "work")?.click());
    expect(chosenTab(host)).toBe("work");
    expect(counters(host)).toEqual(["1", "1", "0"]);
    const rows = listRows(host);
    expect(rows.filter((row) => !row.receded).map((row) => row.project)).toEqual([
      "voyager",
      "vibe-field",
    ]);
    // Grok (This Mac) and the unclaimed pane stay on the stage, receded, below
    expect(rows.filter((row) => row.receded).length).toBe(2);
    expect(rows.slice(-2).every((row) => row.receded)).toBe(true);
    expect(latest().profileTab).toBe("work");
    expect(latest().shownAgents).toBe(2);

    await act(async () => tabButton(host, "all")?.click());
    expect(counters(host)).toEqual(everything);
    expect(listRows(host).some((row) => row.receded)).toBe(false);
    expect(latest().profileTab).toBe("all");
  });

  it("chooses with ⌥0…⌥n, and lets any digit without a tab through", async () => {
    const host = await mountMonitor("list", tabDoor());
    const press = (code: string): KeyboardEvent => {
      const event = new KeyboardEvent("keydown", {
        code,
        altKey: true,
        bubbles: true,
        cancelable: true,
      });
      window.dispatchEvent(event);
      return event;
    };
    await act(async () => {
      press("Digit2");
    });
    expect(chosenTab(host)).toBe("work");
    await act(async () => {
      press("Digit1");
    });
    expect(chosenTab(host)).toBe("native");
    await act(async () => {
      press("Digit0");
    });
    expect(chosenTab(host)).toBe("all");
    let passed: KeyboardEvent | undefined;
    await act(async () => {
      passed = press("Digit7");
    });
    expect(passed?.defaultPrevented).toBe(false);
    expect(chosenTab(host)).toBe("all");
  });

  it("yields ⌥0…⌥n to the empty pane launcher only for keys routed into its pane (QL-D2)", async () => {
    const host = await mountMonitor("list", tabDoor());
    // the pane whose launcher owns the keys, with its terminal's textarea
    const pane = document.createElement("div");
    const textarea = document.createElement("textarea");
    pane.append(textarea);
    document.body.append(pane);
    const press = (code: string, at: EventTarget): KeyboardEvent => {
      const event = new KeyboardEvent("keydown", {
        code,
        altKey: true,
        bubbles: true,
        cancelable: true,
      });
      at.dispatchEvent(event);
      return event;
    };
    const giveBack = takeLauncherKeys((target) => pane.contains(target));
    let passed: KeyboardEvent | undefined;
    try {
      await act(async () => {
        passed = press("Digit2", textarea);
      });
      // untouched: the launcher's own listener decides what ⌥2 means there
      expect(passed?.defaultPrevented).toBe(false);
      expect(chosenTab(host)).toBe("all");
      // the focus in the monitor (or anywhere outside that pane): the strip's
      await act(async () => {
        passed = press("Digit2", host);
      });
      expect(passed?.defaultPrevented).toBe(true);
      expect(chosenTab(host)).toBe("work");
      await act(async () => {
        passed = press("Digit0", window);
      });
      expect(passed?.defaultPrevented).toBe(true);
      expect(chosenTab(host)).toBe("all");
    } finally {
      giveBack();
      pane.remove();
    }
    await act(async () => {
      passed = press("Digit2", window);
    });
    expect(passed?.defaultPrevented).toBe(true);
    expect(chosenTab(host)).toBe("work");
  });

  it("yields every key to a spawn bloom that has the keyboard — ⌥2 switches no tab, ⌘F opens no sheet (SB-3)", async () => {
    const host = await mountMonitor("list", tabDoor());
    const stage = host.querySelector<HTMLElement>('section[aria-label^="Agent monitor"]');
    // the bloom's menu as the views mark it while it holds the keys (P1b)
    const menu = document.createElement("div");
    menu.setAttribute("data-bloom-holds-keys", "true");
    menu.tabIndex = -1;
    const bud = document.createElement("div");
    bud.setAttribute("role", "menuitem");
    menu.appendChild(bud);
    stage?.appendChild(menu);
    const press = (init: KeyboardEventInit, at: EventTarget): KeyboardEvent => {
      const event = new KeyboardEvent("keydown", { bubbles: true, cancelable: true, ...init });
      at.dispatchEvent(event);
      return event;
    };
    let passed: KeyboardEvent | undefined;
    try {
      await act(async () => {
        passed = press({ code: "Digit2", key: "2", altKey: true }, bud);
      });
      expect(passed?.defaultPrevented).toBe(false);
      expect(chosenTab(host)).toBe("all");
      await act(async () => {
        passed = press({ code: "KeyF", key: "f", metaKey: true }, bud);
      });
      expect(passed?.defaultPrevented).toBe(false);
      // the find sheet did not open (it would hold the keys if it had)
      expect(monitorHoldsKeys()).toBe(false);
    } finally {
      menu.remove();
    }
    // the same key anywhere else is the strip's, as before
    await act(async () => {
      passed = press({ code: "Digit2", key: "2", altKey: true }, window);
    });
    expect(passed?.defaultPrevented).toBe(true);
    expect(chosenTab(host)).toBe("work");
  });

  it("holds the keys while a spawn bloom is open, so the deck's launchers stand aside for its ⎋ (SB-3)", async () => {
    // The stage reads the bloom's state through a MutationObserver. happy-dom
    // (20.11) hands each observed node its report callback through a WeakRef
    // nothing else holds, so a collection mid-file silences the observer — the
    // observer's word is delivered by hand here, and the stage's own reading of
    // it (and what it does about it) is what is under test.
    const observers = new Set<{ callback: MutationCallback }>();
    class HandDeliveredObserver {
      constructor(readonly callback: MutationCallback) {}
      observe(): void {
        observers.add(this);
      }
      disconnect(): void {
        observers.delete(this);
      }
      takeRecords(): MutationRecord[] {
        return [];
      }
    }
    vi.stubGlobal("MutationObserver", HandDeliveredObserver);
    const deliver = async (): Promise<void> => {
      await act(async () => {
        for (const observer of [...observers]) {
          observer.callback([], observer as unknown as MutationObserver);
        }
      });
    };
    const host = await mountMonitor("list", tabDoor());
    const stage = host.querySelector<HTMLElement>('section[aria-label^="Agent monitor"]');
    const bloom = document.createElement("div");
    bloom.className = "vf-bloom";
    bloom.setAttribute("data-bloom-state", "idle");
    stage?.appendChild(bloom);
    await deliver();
    expect(monitorHoldsKeys()).toBe(false);
    bloom.setAttribute("data-bloom-state", "open");
    await deliver();
    expect(monitorHoldsKeys()).toBe(true);
    bloom.setAttribute("data-bloom-state", "committed");
    await deliver();
    expect(monitorHoldsKeys()).toBe(false);
    bloom.remove();
  });

  it("holds the keys over a fresh pane's launcher while the find sheet is up (QL-D2's other half)", async () => {
    await mountMonitor("list", tabDoor());
    const find = (): void => {
      window.dispatchEvent(
        new KeyboardEvent("keydown", { code: "KeyF", key: "f", metaKey: true, bubbles: true }),
      );
    };
    expect(monitorHoldsKeys()).toBe(false);
    await act(async () => find());
    expect(monitorHoldsKeys()).toBe(true);
    await act(async () => find());
    expect(monitorHoldsKeys()).toBe(false);
  });

  it("keeps a shell born under Work in the Work tab, and an unbound one recedes (SB-3)", async () => {
    const panes: MonitorPaneFacts = {
      sessionIds: ["work-shell", "bare-shell"],
      activeSessionId: "bare-shell",
      sessions: [
        pane("work-shell", "/project/work-shell"),
        pane("bare-shell", "/project/bare-shell"),
      ],
      // the pool's record, fieldd's words
      profileSets: new Map([["work-shell", "work"]]),
    };
    const host = await mountMonitor("list", tabDoor(), panes);
    await act(async () => tabButton(host, "work")?.click());
    const rows = listRows(host);
    expect(rows.find((row) => row.project === "work-shell")?.receded).toBe(false);
    expect(rows.find((row) => row.project === "bare-shell")?.receded).toBe(true);
    await act(async () => tabButton(host, "native")?.click());
    expect(listRows(host).find((row) => row.project === "work-shell")?.receded).toBe(true);
  });

  it("creates a terminal under the profile the menu chose, never the selected tab's (SB-3)", async () => {
    const door = tabDoor();
    door.createTerminal.mockImplementation(async (request?: { profileSet?: string }) => ({
      state: "mounted" as const,
      sessionId: "born-1",
      ...(request?.profileSet !== undefined ? { profileSet: request.profileSet } : {}),
    }));
    const host = await mountMonitor("list", door);
    for (const id of ["all", "work", "native", "empty"]) {
      await act(async () => tabButton(host, id)?.click());
      // ＋ TERMINAL opens the spawn bloom's tree (SB-D11); the tab chooses nothing
      await act(async () => host.querySelector<HTMLButtonElement>(".vf-monitor-list-new")?.click());
      await act(async () =>
        host.querySelector<HTMLElement>('[role="menu"] [data-bloom-bud-id="work"]')?.click(),
      );
      expect(door.createTerminal.mock.calls.at(-1)).toEqual([{ profileSet: "work" }]);
      expect(ackText(host)).toBe("terminal opened under Work in the active pane");
    }
    expect(door.createTerminal).toHaveBeenCalledTimes(4);
  });

  it("says so over the stage when a tab has no sessions, and a profile deleted while chosen falls back to All", async () => {
    const door = tabDoor();
    const host = await mountMonitor("list", door);
    await act(async () => tabButton(host, "empty")?.click());
    const empty = host.querySelector(".vf-monitor-profile-empty");
    expect(empty?.textContent).toContain("No sessions under Empty");
    expect(empty?.textContent).toContain("This tab shows sessions using this profile.");
    expect(empty?.querySelector('[data-profile-glyph="flask"]')).not.toBeNull();
    expect(host.querySelector(".vf-monitor-list")?.classList.contains("is-all-receded")).toBe(true);
    expect(counters(host)).toEqual(["0", "0", "0"]);

    await act(async () => door.pushSets([NATIVE_SET, WORK_SET]));
    expect(chosenTab(host)).toBe("all");
    expect(host.querySelector(".vf-monitor-profile-empty")).toBeNull();
    expect(listRows(host).some((row) => row.receded)).toBe(false);
  });
});

// ---- SB-3 — the spawn menu, and the create it asks for ---------------------------
//
// The bloom's own surface (P1b) is not in this pin, so these rows read what the
// stage hands a view through a PROBE — a view that records its props — and
// drive `createAt(position, target)` exactly as the bloom and the list's menu
// will: the menu from the tabs' feed, the create under the chosen set, and
// every outcome said, a refusal in fieldd's own words.

let probed: AgentMonitorProps | null = null;
function Probe(props: AgentMonitorProps): ReactElement {
  probed = props;
  return <div className="probe-view" />;
}
// A legacy view of its own: since MV-4 the list is an SDK view, so a probe
// spread from its registry entry would mount the list itself, never the probe.
const PROBE_VIEW: AgentMonitorView = {
  id: "probe",
  label: "PROBE",
  parameterGroups: [],
  Component: Probe,
};

async function mountProbe(
  door: MonitorDoor | null,
  panes: MonitorPaneFacts = PANES,
): Promise<HTMLElement> {
  probed = null;
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await renderProbe(door, panes);
  return container;
}

async function renderProbe(door: MonitorDoor | null, panes: MonitorPaneFacts): Promise<void> {
  syncBoard(panes);
  await act(async () => {
    root?.render(
      <GodviewAgentsProvider door={door}>
        <GodviewMonitor
          view={PROBE_VIEW}
          parameters={monitorParameterDefaults(PROBE_VIEW.parameterGroups)}
          door={door}
          panes={panes}
        />
      </GodviewAgentsProvider>,
    );
  });
  await settle();
}

/** A feed that has not answered yet, and answers when told. */
function slowTabDoor(): TabDoor {
  const door = fakeDoor(TAB_ROWS);
  let listener: ((next: readonly AgentProfileSet[]) => void) | null = null;
  return Object.assign(door, {
    profiles: {
      subscribe: (next: (sets: readonly AgentProfileSet[]) => void) => {
        listener = next;
        return () => {
          listener = null;
        };
      },
    },
    pushSets: (next: readonly AgentProfileSet[]) => {
      listener?.(next);
      board?.profiles(next);
    },
  });
}

/** A view's `createAt`, inside `act`: a rejection is caught there and thrown
 * after it, so the words it said are committed before the caller reads them. */
const createAt = async (
  position?: { x: number; y: number },
  target?: { deviceId?: string; profileSet?: string },
): Promise<void> => {
  let failure: unknown;
  await act(async () => {
    try {
      await probed?.actions.createAt(position, target);
    } catch (cause) {
      failure = cause;
    }
  });
  if (failure !== undefined) throw failure;
};

describe("the spawn menu and the create it asks for (SB-3)", () => {
  it("offers no menu without a profiles feed — a hold creates at once, as before", async () => {
    await mountProbe(fakeDoor());
    expect(probed).not.toBeNull();
    expect(probed?.spawnMenu).toBeUndefined();
  });

  it("offers this desktop, reading until the feed answers, then its profiles — the same menu object until it changes", async () => {
    const door = slowTabDoor();
    await mountProbe(door);
    expect(probed?.spawnMenu?.devices).toEqual([
      { id: HERE_DEVICE_ID, label: "This desktop", self: true, state: "reading" },
    ]);
    await act(async () => door.pushSets(TAB_SETS));
    const menu = probed?.spawnMenu;
    expect(menu?.devices[0]?.state).toBe("ready");
    expect(menu?.devices[0]?.profiles?.map((profile) => profile.id)).toEqual([
      "native",
      "work",
      "empty",
    ]);
    // Codex is blocked under Work (the tabs' orange dot), Claude signed in there
    expect(menu?.devices[0]?.profiles?.[1]).toMatchObject({
      label: "Work",
      glyph: "briefcase",
      blocked: true,
      signedIn: ["Claude Code"],
    });
    await act(async () => door.pushSets([...TAB_SETS]));
    expect(probed?.spawnMenu).toBe(menu);
  });

  it("opens a terminal under the chosen profile, says so, and keeps the release point as the spawn hint", async () => {
    const door = tabDoor();
    door.createTerminal.mockResolvedValue({
      state: "mounted",
      sessionId: "born-1",
      profileSet: "work",
    });
    const host = await mountProbe(door);
    await createAt({ x: 120.5, y: 80.25 }, { deviceId: HERE_DEVICE_ID, profileSet: "work" });
    expect(door.createTerminal).toHaveBeenCalledExactlyOnceWith({ profileSet: "work" });
    expect(ackText(host)).toBe("terminal opened under Work in the active pane");
    // the deck republishes its panes with the new shell in the active one
    await renderProbe(door, {
      sessionIds: ["born-1"],
      activeSessionId: "born-1",
      sessions: [pane("born-1", "/project/born")],
      profileSets: new Map([["born-1", "work"]]),
    });
    const born = probed?.agents.find((agent) => agent.id === "born-1");
    // the views match the body drawn at the release point by this, so it is
    // the position as given — never rounded
    expect(born?.spawnHint).toEqual({ x: 120.5, y: 80.25 });
    expect(born?.profileSet).toBe("work");
  });

  it("stamps the release point on the first NEW terminal row, before the door answers — never on a row it had", async () => {
    const door = tabDoor();
    let answer!: (outcome: unknown) => void;
    door.createTerminal.mockImplementation(
      () =>
        new Promise((resolve) => {
          answer = resolve;
        }),
    );
    await mountProbe(door, {
      sessionIds: ["old-shell"],
      activeSessionId: "old-shell",
      sessions: [pane("old-shell")],
    });
    const row = (id: string) => probed?.agents.find((agent) => agent.id === id);
    let creating: void | Promise<void>;
    await act(async () => {
      creating = probed?.actions.createAt({ x: 321.25, y: 123.75 }, { profileSet: "work" });
    });
    // the new shell reaches the stage (the deck's panes) before the door answers
    await renderProbe(door, {
      sessionIds: ["old-shell", "born-1"],
      activeSessionId: "born-1",
      sessions: [pane("old-shell"), pane("born-1", "/project/born")],
    });
    // as given, unrounded: the views match it to half a pixel
    expect(row("born-1")?.spawnHint).toEqual({ x: 321.25, y: 123.75 });
    expect(row("old-shell")?.spawnHint).toBeUndefined();
    await act(async () => {
      answer({ state: "mounted", sessionId: "born-1", profileSet: "work" });
      await creating;
    });
    expect(row("born-1")?.spawnHint).toEqual({ x: 321.25, y: 123.75 });
  });

  it("takes a first appearance through the roster too, and the door's answer corrects a claim that was another's", async () => {
    const door = tabDoor();
    let answer!: (outcome: unknown) => void;
    door.createTerminal.mockImplementation(
      () =>
        new Promise((resolve) => {
          answer = resolve;
        }),
    );
    await mountProbe(door, { sessionIds: [] });
    const row = (id: string) => probed?.agents.find((agent) => agent.id === id);
    let creating: void | Promise<void>;
    await act(async () => {
      creating = probed?.actions.createAt({ x: 10.5, y: 20.5 });
    });
    // another window's shell reaches the roster first, and takes the point…
    const stranger = { sessionId: "stranger", workloadClass: "interactive" as const };
    await renderProbe(door, { sessionIds: [], floor: [stranger] });
    expect(row("stranger")?.spawnHint).toEqual({ x: 10.5, y: 20.5 });
    // …until the door names the session it made
    await act(async () => {
      answer({ state: "mounted", sessionId: "born-2" });
      await creating;
    });
    await renderProbe(door, {
      sessionIds: ["born-2"],
      activeSessionId: "born-2",
      sessions: [pane("born-2")],
      floor: [stranger],
    });
    expect(row("stranger")?.spawnHint).toBeUndefined();
    expect(row("born-2")?.spawnHint).toEqual({ x: 10.5, y: 20.5 });
  });

  it("carries fieldd's own words when a profile birth is refused", async () => {
    const door = tabDoor();
    door.createTerminal.mockResolvedValue({
      state: "failed",
      reason: "that profile no longer exists",
    });
    const host = await mountProbe(door);
    const sentence = "terminal could not be opened under Work — that profile no longer exists";
    await expect(createAt({ x: 10, y: 10 }, { profileSet: "work" })).rejects.toThrow(sentence);
    expect(ackText(host)).toBe(sentence);
  });

  it("says, then rejects, when there is no deck to open a terminal in", async () => {
    const host = await mountProbe(null, { sessionIds: [] });
    const sentence = "no terminal can be opened yet — the deck has no connection";
    await expect(createAt({ x: 10, y: 10 })).rejects.toThrow(sentence);
    expect(ackText(host)).toBe(sentence);
  });

  it("keeps the shell an older daemon births unbound, and says it is not under the profile", async () => {
    const door = tabDoor();
    door.createTerminal.mockResolvedValue({ state: "mounted", sessionId: "born-1" });
    const host = await mountProbe(door);
    await createAt({ x: 10, y: 10 }, { profileSet: "work" });
    expect(ackText(host)).toBe(
      "terminal opened, but not under Work — this VibeField daemon cannot open terminals under a profile yet",
    );
  });

  it("says the plain sentence on a desktop with one profile, which is no choice", async () => {
    const door = tabDoor([NATIVE_SET]);
    door.createTerminal.mockResolvedValue({
      state: "mounted",
      sessionId: "born-1",
      profileSet: "native",
    });
    const host = await mountProbe(door);
    await createAt({ x: 10, y: 10 }, { deviceId: HERE_DEVICE_ID, profileSet: "native" });
    expect(door.createTerminal).toHaveBeenCalledExactlyOnceWith({ profileSet: "native" });
    expect(ackText(host)).toBe("terminal opened in the active pane");
  });

  it("asks no other desktop for a terminal, and a create with no target is unbound", async () => {
    const door = tabDoor();
    const host = await mountProbe(door);
    await expect(
      createAt({ x: 10, y: 10 }, { deviceId: "mini", profileSet: "work" }),
    ).rejects.toThrow("that desktop cannot take a terminal from here yet");
    expect(door.createTerminal).not.toHaveBeenCalled();
    expect(ackText(host)).toBe("that desktop cannot take a terminal from here yet");
    // the hub while this desktop's profiles are still being read, a host with no menu
    await createAt({ x: 10, y: 10 });
    expect(door.createTerminal).toHaveBeenCalledExactlyOnceWith();
    expect(ackText(host)).toBe("terminal opened in the active pane");
  });
});

// ---- SB-3 — the spawn bloom, driven ---------------------------------------------
//
// happy-dom is the one place the bloom can be driven at pointer level (the views
// package's own tests are static markup and pure reducers): the real stage, the
// real swarm and list views, the real bloom, and a door whose create answers
// under the profile it was asked for. The ground is empty — no rows — so every
// press lands on it; the field is sized by hand (happy-dom lays nothing out).

/** A door with the tabs' three profiles (This Mac the default) and no rows. */
function bloomDoor(sets: readonly AgentProfileSet[] = TAB_SETS): TabDoor {
  const door = fakeDoor([]);
  door.createTerminal.mockImplementation(async (request?: { profileSet?: string }) => ({
    state: "mounted" as const,
    sessionId: "born-1",
    ...(request?.profileSet !== undefined ? { profileSet: request.profileSet } : {}),
  }));
  let listener: ((next: readonly AgentProfileSet[]) => void) | null = null;
  return Object.assign(door, {
    profiles: {
      subscribe: (next: (value: readonly AgentProfileSet[]) => void) => {
        listener = next;
        next(sets);
        return () => {
          listener = null;
        };
      },
    },
    pushSets: (next: readonly AgentProfileSet[]) => listener?.(next),
  });
}

const NO_PANES: MonitorPaneFacts = { sessionIds: [] };
const HOLD_AT = { x: 640, y: 420 };
const wait = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

async function mountBloom(
  door: TabDoor,
  view = "swarm",
): Promise<{ host: HTMLElement; field: HTMLElement }> {
  const host = await mountMonitor(view, door, NO_PANES);
  const field = host.querySelector<HTMLElement>(".vf-monitor-swarm") as HTMLElement;
  if (field !== null) {
    // what a laid-out stage would say; the bloom's geometry reads the field's size
    Object.defineProperty(field, "clientWidth", { value: 1280, configurable: true });
    Object.defineProperty(field, "clientHeight", { value: 720, configurable: true });
    Object.defineProperty(field, "setPointerCapture", { value: vi.fn() });
    Object.defineProperty(field, "hasPointerCapture", { value: () => false });
    Object.defineProperty(field, "releasePointerCapture", { value: vi.fn() });
  }
  return { host, field };
}

const pointer = (
  field: HTMLElement,
  type: "pointerdown" | "pointermove" | "pointerup",
  at: { x: number; y: number },
  button = 0,
): void => {
  field.dispatchEvent(
    new PointerEvent(type, {
      bubbles: true,
      button,
      buttons: type === "pointerup" ? 0 : button === 0 ? 1 : 2,
      pointerId: 1,
      clientX: at.x,
      clientY: at.y,
    }),
  );
};
const bloomOf = (host: HTMLElement): HTMLElement | null => host.querySelector(".vf-bloom");
const budOf = (host: HTMLElement, kind: string, id: string): HTMLElement | null =>
  host.querySelector<HTMLElement>(`[data-bloom-bud-kind="${kind}"][data-bloom-bud-id="${id}"]`);
/** A bud's centre in the field, from the geometry it was drawn with. */
const centreOf = (bud: HTMLElement | null): { x: number; y: number } => {
  if (bud === null) throw new Error("no such bud");
  const px = (name: string): number => Number.parseFloat(bud.style.getPropertyValue(name));
  const d = px("--vf-bloom-d");
  return { x: px("--vf-bloom-tx") + d / 2, y: px("--vf-bloom-ty") + d / 2 };
};

/** Press on the empty ground and hold past 520 ms; then wait out the new
 * ring's 90 ms, when a hand still moving would pick the wrong bud. */
async function holdOpen(host: HTMLElement, field: HTMLElement): Promise<void> {
  await act(async () => {
    pointer(field, "pointermove", HOLD_AT);
    pointer(field, "pointerdown", HOLD_AT);
    await wait(650);
  });
  expect(bloomOf(host)?.getAttribute("data-bloom-state")).toBe("open");
  await act(async () => {
    await wait(120);
  });
}

describe("the spawn bloom, driven (SB-3)", () => {
  it("blooms this desktop's profiles on a long press, and letting go on Work opens a terminal under it", async () => {
    const door = bloomDoor();
    const { host, field } = await mountBloom(door);
    await holdOpen(host, field);
    expect(
      [...host.querySelectorAll('[data-bloom-bud-kind="profile"]')].map((bud) =>
        bud.getAttribute("data-bloom-bud-id"),
      ),
    ).toEqual(["native", "work", "empty"]);
    const work = centreOf(budOf(host, "profile", "work"));
    await act(async () => {
      pointer(field, "pointermove", { x: (HOLD_AT.x + work.x) / 2, y: (HOLD_AT.y + work.y) / 2 });
      pointer(field, "pointermove", work);
      await wait(40);
    });
    expect(bloomOf(host)?.getAttribute("data-bloom-target")).toBe("profile:work");
    await act(async () => {
      pointer(field, "pointerup", work);
      await wait(20);
    });
    expect(door.createTerminal).toHaveBeenCalledExactlyOnceWith({ profileSet: "work" });
    expect(ackText(host)).toBe("terminal opened under Work in the active pane");
    expect(bloomOf(host)?.getAttribute("data-bloom-state")).toBe("committed");
  });

  it("opens the desktop's default on the hub, and nothing on open ground", async () => {
    const door = bloomDoor();
    const { host, field } = await mountBloom(door);
    await holdOpen(host, field);
    await act(async () => {
      pointer(field, "pointerup", HOLD_AT);
      await wait(20);
    });
    // This Mac is the tabs' default: the hub is this desktop under it
    expect(door.createTerminal).toHaveBeenCalledExactlyOnceWith({ profileSet: "native" });
    await act(async () => {
      await wait(700);
    });
    await holdOpen(host, field);
    const away = { x: HOLD_AT.x, y: HOLD_AT.y + 260 };
    await act(async () => {
      pointer(field, "pointermove", { x: HOLD_AT.x, y: HOLD_AT.y + 130 });
      pointer(field, "pointermove", away);
      await wait(40);
    });
    expect(bloomOf(host)?.getAttribute("data-bloom-target")).toBe("none");
    await act(async () => {
      pointer(field, "pointerup", away);
      await wait(20);
    });
    expect(door.createTerminal).toHaveBeenCalledTimes(1);
    expect(bloomOf(host)?.getAttribute("data-bloom-state")).toBe("cancelled");
  });

  it("holds the bloom open on a secondary click, and a click on a profile commits it", async () => {
    const door = bloomDoor();
    const { host, field } = await mountBloom(door);
    await act(async () => {
      field.dispatchEvent(
        new MouseEvent("contextmenu", {
          bubbles: true,
          cancelable: true,
          button: 2,
          clientX: HOLD_AT.x,
          clientY: HOLD_AT.y,
        }),
      );
      await wait(120);
    });
    expect(bloomOf(host)?.getAttribute("data-bloom-state")).toBe("open");
    expect(bloomOf(host)?.getAttribute("data-bloom-mode")).toBe("sticky");
    const empty = centreOf(budOf(host, "profile", "empty"));
    await act(async () => {
      pointer(field, "pointermove", empty);
      await wait(40);
      pointer(field, "pointerdown", empty);
      await wait(20);
    });
    expect(door.createTerminal).toHaveBeenCalledExactlyOnceWith({ profileSet: "empty" });
  });

  it("opens for the keys from the swarm's hidden ＋ New terminal…, and ↵ commits the focused profile", async () => {
    const door = bloomDoor();
    const { host } = await mountBloom(door);
    const newTerminal = host.querySelector<HTMLButtonElement>("[data-swarm-new-terminal]");
    expect(newTerminal?.textContent).toContain("New terminal");
    await act(async () => {
      newTerminal?.click();
      await wait(120);
    });
    expect(bloomOf(host)?.getAttribute("data-bloom-mode")).toBe("keys");
    const menu = host.querySelector<HTMLElement>(".vf-bloom-menu");
    const key = (name: string): void => {
      menu?.dispatchEvent(
        new KeyboardEvent("keydown", { key: name, bubbles: true, cancelable: true }),
      );
    };
    await act(async () => {
      key("ArrowRight");
      await wait(20);
    });
    const aimed = bloomOf(host)?.getAttribute("data-bloom-target");
    await act(async () => {
      key("Enter");
      await wait(20);
    });
    expect(aimed).toMatch(/^profile:/);
    expect(door.createTerminal).toHaveBeenCalledExactlyOnceWith({
      profileSet: aimed?.slice("profile:".length),
    });
  });

  it("creates at once under a desktop's only profile — one profile is no choice", async () => {
    const door = bloomDoor([NATIVE_SET]);
    const { host, field } = await mountBloom(door);
    await act(async () => {
      pointer(field, "pointermove", HOLD_AT);
      pointer(field, "pointerdown", HOLD_AT);
      await wait(650);
    });
    expect(bloomOf(host)?.getAttribute("data-bloom-state") ?? "idle").not.toBe("open");
    expect(door.createTerminal).toHaveBeenCalledExactlyOnceWith({ profileSet: "native" });
    expect(ackText(host)).toBe("terminal opened in the active pane");
  });

  it("keeps ⌥2 from the profile tabs while a keys bloom has the keyboard", async () => {
    const door = bloomDoor();
    const { host } = await mountBloom(door);
    expect(chosenTab(host)).toBe("all");
    await act(async () => {
      host.querySelector<HTMLButtonElement>("[data-swarm-new-terminal]")?.click();
      await wait(120);
    });
    const menu = host.querySelector<HTMLElement>(".vf-bloom-menu");
    expect(menu?.getAttribute("data-bloom-holds-keys")).toBe("true");
    const alt2 = new KeyboardEvent("keydown", {
      code: "Digit2",
      key: "2",
      altKey: true,
      bubbles: true,
      cancelable: true,
    });
    await act(async () => {
      (document.activeElement ?? menu)?.dispatchEvent(alt2);
      await wait(20);
    });
    // the strip's capture listener yielded it: whatever the bloom made of it,
    // the chosen tab is still All
    expect(chosenTab(host)).toBe("all");
  });

  it("says fieldd's words for a failed ＋ TERMINAL, and the views catch its rejection", async () => {
    // no profiles feed: no menu, the list's ＋ creates at once, as before
    const door = fakeDoor([]);
    door.createTerminal.mockResolvedValueOnce({
      state: "failed",
      reason: "terminal capacity reached",
    });
    const host = await mountMonitor("list", door, NO_PANES);
    await act(async () => {
      host.querySelector<HTMLButtonElement>(".vf-monitor-list-new")?.click();
      await wait(20);
    });
    expect(door.createTerminal).toHaveBeenCalledExactlyOnceWith();
    expect(ackText(host)).toBe("terminal could not be opened — terminal capacity reached");
  });

  it("offers the same tree under the list's ＋ TERMINAL, in two steps", async () => {
    const door = bloomDoor();
    const { host } = await mountBloom(door, "list");
    await act(async () => host.querySelector<HTMLButtonElement>(".vf-monitor-list-new")?.click());
    const menu = host.querySelector('[role="menu"][aria-label="New terminal"]');
    expect(menu).not.toBeNull();
    expect(door.createTerminal).not.toHaveBeenCalled();
    await act(async () =>
      menu
        ?.querySelector<HTMLElement>('[data-bloom-bud-kind="profile"][data-bloom-bud-id="work"]')
        ?.click(),
    );
    expect(door.createTerminal).toHaveBeenCalledExactlyOnceWith({ profileSet: "work" });
    expect(ackText(host)).toBe("terminal opened under Work in the active pane");
  });
});
