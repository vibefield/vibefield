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
 *   3. PF6 — closing disposes: every interval cleared, the view unmounted
 *   4. select mounts an existing session; create opens an empty terminal
 *   5. with no door there are no rows and no invented ones
 *
 * AR-5 moved the views into `@vibecook/puppeteer-views`, and two things about
 * this fixture follow from that. The swarm PAINTS ON WEBGPU now, which happy-dom
 * does not have, so it draws its honest unavailable notice and its keyboard list
 * instead of DOM bubbles — the rows are still there to assert on, in
 * `.vf-monitor-swarm-list`, and anything that needs laid-out rows uses the list
 * view. Since MV-5 the swarm is an SDK view that brings its own physics worker
 * (MV-D7): happy-dom has no `Worker`, so its driver runs the same host in this
 * thread and the view SAYS so (`report`: `physics: "inline"`), which is what
 * the stage reads — never the view's DOM, and never a driver of its own.
 */

import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { SessionSummary } from "@vibecook/ghosttea-protocol";
import {
  MONITOR_SKIN,
  type MonitorCreateAnswer,
  type MonitorViewCommands,
  type MonitorViewInput,
  type StageGeometry,
} from "@vibecook/puppeteer-view-sdk";
import { createRecordingView, type RecordingView } from "@vibecook/puppeteer-view-sdk/testing";
import {
  type AccountUsagePort,
  CHROME_RETRY_FIRST_MS,
  DEFAULT_MONITOR_VIEW_ID,
  type HistoryPort,
  MONITOR_VIEWS,
  type MonitorViewEntry,
  monitorParameterDefaults,
  monitorViewFor,
} from "@vibecook/puppeteer-views";
import {
  FRAME_HEADER_FLOATS,
  FRAME_STRIDE,
  frameFloatsFor,
  type SwarmAgentSpec,
  type SwarmObstacleRect,
  SwarmPhysics,
} from "@vibecook/puppeteer-views/physics";
import {
  type AgentPersona,
  type AgentProfileSet,
  AgentRecordedLanesResult,
  type TerminalInfo,
} from "@vibefield/contracts";
import { act, Profiler } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { GodviewMonitorFacts } from "../src/development-console";
import { publishGodviewDeck, resetGodviewDeckDoorForTest } from "../src/frame/deck-door";
import { getGodviewFindDoor, resetGodviewFindDoorForTest } from "../src/frame/find-door";
import { GodviewMonitor } from "../src/godview/GodviewMonitor";
import { usagePortOver } from "../src/godview/monitor/doors";
import type { AgentSessionSummary } from "../src/godview/monitor/facet-types";
import {
  GodviewAgentsProvider,
  useMonitorFeed,
} from "../src/godview/monitor/GodviewAgentsProvider";
import { monitorHoldsKeys } from "../src/godview/monitor/launcher-keys";
import type { RecordedLanesPort } from "../src/godview/monitor/monitor-history";
import type { MonitorDoor, ProfileSetsPort } from "../src/godview/monitor/remote-door";
import { HERE_DEVICE_ID } from "../src/godview/monitor/spawn-menu";
import type { MonitorPaneFacts } from "../src/godview/monitor/useMonitorAgents";
import { advanceChromeClock, holdChromeClock, nextTask } from "./chrome-clock-fixture";
import { managedSummary } from "./managed-session-fixture";
import { type ScriptedModelBoard, scriptedModelBoard, terminalInfoOf } from "./model-board-fixture";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/** M49 — the claims strip's own mark (size 8; the bar's device chip draws at 10
 * and 11), passed through unless a row makes it throw. Each try is counted. */
const stripMark = vi.hoisted(() => ({ throws: false, tries: 0 }));
vi.mock("../src/godview/os-marks", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/godview/os-marks")>();
  return {
    ...actual,
    OsMark: (props: Parameters<typeof actual.OsMark>[0]) => {
      if (props.size === 8) {
        stripMark.tries += 1;
        if (stripMark.throws) throw new Error("the strip's mark lost its glyph");
      }
      return <actual.OsMark {...props} />;
    },
  };
});

/** M195 — every render of the head the monitor asks for, counted; the head
 * itself is the shipping view, passed through unless a row makes it throw
 * (M49: its boundary). */
const head = vi.hoisted(() => ({ renders: 0, throws: false }));
vi.mock("../src/godview/GodviewHeadView", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/godview/GodviewHeadView")>();
  return {
    ...actual,
    GodviewHeadView: (props: Parameters<typeof actual.GodviewHeadView>[0]) => {
      head.renders += 1;
      if (head.throws) throw new Error("the head lost a view's mark");
      return <actual.GodviewHeadView {...props} />;
    },
  };
});

/** TL — every `capabilities` object the stage hands the view host, in render
 * order; the host itself is the SDK's, passed through. The SDK's slot keeps a
 * view's capabilities while their members are the same objects, so only the
 * prop shows whether the STAGE rebuilt what it lends. */
const viewHost = vi.hoisted(() => ({ handed: [] as unknown[] }));
vi.mock("@vibecook/puppeteer-view-sdk/host", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@vibecook/puppeteer-view-sdk/host")>();
  return {
    ...actual,
    MonitorViewHost: (props: Parameters<typeof actual.MonitorViewHost>[0]) => {
      viewHost.handed.push(props.capabilities);
      return <actual.MonitorViewHost {...props} />;
    },
  };
});

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
 * disposed with the test; chrome-local facts ride the same model board. */
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
      await nextTask();
    });
    await act(async () => {
      await Promise.resolve();
    });
  }
}

function fakeDoor(rows: readonly AgentSessionSummary[] = ROWS): FakeDoor {
  board?.dispose();
  const held = scriptedModelBoard({ rows });
  board = held;
  return {
    model: held.port,
    attach: vi.fn(async () => ({ state: "attached" as const, sessionId: "r", readWrite: true })),
    push: (next) => {
      held.publish(next);
    },
    createTerminal: vi.fn(async () => ({ state: "mounted" as const, sessionId: "born-1" })),
    mountLocal: vi.fn(async (sessionId: string) => ({ state: "mounted" as const, sessionId })),
    transcripts: unreachableHistory(),
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

beforeEach(() => {
  markers = [];
  viewHost.handed.length = 0;
  head.throws = false;
  openedIntervals = [];
  clearedIntervals = [];
  localStorage.clear();
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
  board?.dispose();
  board = null;
  resetGodviewFindDoorForTest();
  resetGodviewDeckDoorForTest();
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
          publishesFind
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
          publishesFind
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
/** The view circles on the head (GV-D1), and the one that is on. */
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
  // sentence) and it was pinned 11px down the stage. `list.css` pins the
  // package's toolbar 11px down too, because the reference host has no claims
  // to make room for — so the two printed over each other on James's
  // 2026-09-13 pass. The fix publishes the strip's measured bottom and the
  // flow view's band starts from there; these rows hold that seam. Since GV-D1
  // the stage begins at the window's top, under the head, and the strip at the
  // head's reserve (56): a view's top inset is never less than the reserve. Since MV-4
  // the list reads it as the stage's top inset (M58) — the view host hands it
  // the measurement and the list's own stylesheet adds its band — so the rows
  // read the list's own property; the variable stays for the timeline.
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
    stage!.getBoundingClientRect = () => rect(0, 440);
    claims!.getBoundingClientRect = () => rect(56, 65);
    act(() => {
      for (const publish of fire) publish();
    });
    await settle();
    // 65 − 0: the strip's bottom in the stage's own coordinates — the strip
    // stands at the head's reserve (GV-D1). The band under it is the list's own
    // (its stylesheet's 11px past the inset), so this number is a measurement
    // and not a spacing decision. It reaches the list as `stage.insets.top` —
    // no host rule names the list (W5).
    const list = host.querySelector<HTMLElement>(".vf-monitor-list");
    expect(list?.style.getPropertyValue("--mv-list-inset-top")).toBe("65px");
    // no host variable on the stage at all: a view reads geometry from its
    // input, never a property the host writes (L18, MV-D19)
    expect(stage?.getAttribute("style")).toBeNull();
  });

  it("starts the timeline AT the claims strip's bottom, through the stage alone — 11px higher than the old host rule (GT-6a, M63)", async () => {
    // NAMED VISIBLE CHANGE (M63): `godview.css` padded the timeline by the
    // strip's bottom PLUS the list's 11px band. The ported timeline clears the
    // strip itself from `stage.insets.top` and starts at it, as puppeteer's
    // Godview draws it; no host rule names it (W5).
    const fire = driveObservers();
    const host = await mountMonitor("timeline");
    const stage = host.querySelector<HTMLElement>(".vf-godview-monitor-stage");
    const claims = host.querySelector<HTMLElement>(".vf-monitor-claims");
    expect(claims?.textContent ?? "").toContain("managed agent");
    stage!.getBoundingClientRect = () => rect(0, 440);
    claims!.getBoundingClientRect = () => rect(56, 65);
    act(() => {
      for (const publish of fire) publish();
    });
    await settle();
    const timeline = host.querySelector<HTMLElement>(".vf-monitor-timeline");
    expect(timeline?.closest(".mv-timeline")).not.toBeNull();
    expect(timeline?.style.getPropertyValue("--mv-timeline-inset-top")).toBe("65px");
    // the timeline's own stylesheet starts it at the inset; nothing of the
    // host's pads it (the old rule computed the strip's bottom + 11px)
    expect(timeline?.style.paddingTop ?? "").toBe("");
  });

  /** The stage a view is handed once the monitor has measured its chrome: the
   * stage at the window's top, 8 in (the cover's edge), the usage column and a
   * speaking claims strip at the head's reserve. */
  async function measuredStage(): Promise<StageGeometry | undefined> {
    const fire = driveObservers();
    const recording = createRecordingView("obstacle-probe");
    const entry: MonitorViewEntry = {
      id: "obstacle-probe",
      label: "OBSTACLES",
      parameterGroups: [],
      mark: recording.view.manifest.mark,
      view: recording.view,
    };
    const door = fakeDoor();
    syncBoard(PANES);
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    await act(async () => {
      root?.render(
        <GodviewAgentsProvider door={door}>
          <GodviewMonitor view={entry} parameters={{}} door={door} panes={PANES} publishesFind />
        </GodviewAgentsProvider>,
      );
    });
    await settle();
    const host = container;
    const stage = host.querySelector<HTMLElement>(".vf-godview-monitor-stage");
    const chrome = host.querySelector<HTMLElement>(".vf-monitor-chrome");
    const claims = host.querySelector<HTMLElement>(".vf-monitor-claims");
    const box = (left: number, top: number, width: number, height: number): DOMRect =>
      ({
        left,
        top,
        width,
        height,
        right: left + width,
        bottom: top + height,
      }) as DOMRect;
    stage!.getBoundingClientRect = () => box(8, 0, 900, 396);
    chrome!.getBoundingClientRect = () => box(21.5, 56.25, 46, 334);
    claims!.getBoundingClientRect = () => box(80, 56, 300, 9.5);
    act(() => {
      for (const publish of fire) publish();
    });
    await settle();
    return recording.lastInput?.stage;
  }

  it("hands a view the chrome's rectangles as the stage's obstacles, unrounded, as the swarm measured them — the head's reserve first (MV-D19, GV-D1)", async () => {
    // Before MV-5 the swarm read the chrome's elements off the host's DOM and
    // steered its bodies around their rects, in its own coordinates. Now the
    // host measures and hands them over: the usage column and the claims strip,
    // in the stage's coordinates (the view's root fills the stage), with the
    // fractions a layout gives — so the bodies steer exactly as they did.
    // GV-D1: the stage runs under the head, and the swarm reads obstacles and
    // never the top inset, so the head's reserve — the band across the stage's
    // top, its own width and 56 tall — is the first of them: its bodies keep
    // below the head as they kept below the bar.
    expect(await measuredStage()).toEqual({
      width: 900,
      height: 396,
      // the insets stay whole pixels: the list's band arithmetic (M58)
      insets: { top: 66, right: 0, bottom: 0, left: 60 },
      obstacles: [
        { x: 0, y: 0, width: 900, height: 56 },
        { x: 13.5, y: 56.25, width: 46, height: 334 },
        { x: 72, y: 56, width: 300, height: 9.5 },
      ],
    });
  });

  it("keeps the swarm's bodies below the head's reserve: on the stage as handed, every body settles under y 56, where without the reserve the same crowd stands in it (GV-D1)", async () => {
    // The swarm steers by `stage.obstacles` alone (the SDK: insets are
    // advisory), so the 56 a flow view reads as its top inset reaches the swarm
    // only as this rectangle. Its own physics is driven here — the package's
    // world, as the view's driver hosts it — on exactly the stage the monitor
    // handed over: a crowd too big for the room under the reserve, and one body
    // born inside the reserve (a hold's spawn hint, as the bloom places one).
    const stage = await measuredStage();
    expect(stage?.obstacles[0]).toEqual({ x: 0, y: 0, width: 900, height: 56 });
    const crowd: SwarmAgentSpec[] = [
      { id: "born-in-the-reserve", radius: 34, spawnHint: { x: 450, y: 20 } },
      ...Array.from({ length: 22 }, (_, index) => ({ id: `body-${index}`, radius: 44 })),
    ];
    const settleCrowd = (
      obstacles: readonly SwarmObstacleRect[],
    ): { id: string; top: number }[] => {
      let seed = 7;
      const physics = new SwarmPhysics({
        // the swarm's own defaults (`swarm-parameters.ts`)
        parameters: { gravityPull: 0.0002, restitution: 0, frictionAir: 0.2, physicsHz: 30 },
        bounds: { width: stage?.width ?? 0, height: stage?.height ?? 0 },
        obstacles,
        agents: crowd,
        random: () => {
          seed = (seed * 1664525 + 1013904223) % 4294967296;
          return seed / 4294967296;
        },
      });
      // twenty seconds at the swarm's own rate: long past settling
      let now = 0;
      physics.seed(now);
      for (let frame = 0; frame < 600; frame += 1) {
        now += 1000 / 30;
        physics.advance(now);
      }
      const ids = physics.ids();
      const frame = new Float32Array(frameFloatsFor(ids.length));
      physics.writeFrame(frame);
      const tops = ids.map((id, index) => {
        const at = FRAME_HEADER_FLOATS + index * FRAME_STRIDE;
        return { id, top: (frame[at + 1] ?? 0) - (frame[at + 2] ?? 0) };
      });
      physics.dispose();
      return tops;
    };
    const held = settleCrowd(stage?.obstacles ?? []);
    expect(held.length).toBe(crowd.length);
    for (const body of held) {
      expect(
        body.top,
        `${body.id} stands at ${body.top}, inside the head's reserve`,
      ).toBeGreaterThanOrEqual(56);
    }
    // …and it is the reserve that holds them: the same crowd on the same stage
    // without that one rectangle stands inside the top 56
    const loose = settleCrowd(stage?.obstacles.slice(1) ?? []);
    expect(loose.some((body) => body.top < 56)).toBe(true);
  });

  it("keeps the stage it holds when a tick measures the same: the monitor renders nothing, and a real resize still reaches the view (M176 item 1)", async () => {
    // The column, the strip and the stage are each observed, and every tick
    // measured a fresh stage object: the monitor rendered again for each one,
    // though the view host's slot already kept the view's stage. The SDK's own
    // rule (`keepStage`) keeps the held stage when the size, the insets and the
    // obstacles measure the same, so an equal tick renders nothing at all.
    const fire = driveObservers();
    const recording = createRecordingView("stage-keeper");
    const entry: MonitorViewEntry = {
      id: "stage-keeper",
      label: "KEEPER",
      parameterGroups: [],
      mark: recording.view.manifest.mark,
      view: recording.view,
    };
    const door = fakeDoor();
    syncBoard(PANES);
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    let renders = 0;
    await act(async () => {
      root?.render(
        <GodviewAgentsProvider door={door}>
          <Profiler id="godview-monitor" onRender={() => (renders += 1)}>
            <GodviewMonitor view={entry} parameters={{}} door={door} panes={PANES} />
          </Profiler>
        </GodviewAgentsProvider>,
      );
    });
    await settle();
    const host = container;
    let width = 900;
    const box = (left: number, top: number, w: number, height: number): DOMRect =>
      ({ left, top, width: w, height, right: left + w, bottom: top + height }) as DOMRect;
    host.querySelector<HTMLElement>(".vf-godview-monitor-stage")!.getBoundingClientRect = () =>
      box(8, 0, width, 396);
    host.querySelector<HTMLElement>(".vf-monitor-chrome")!.getBoundingClientRect = () =>
      box(21, 56, 46, 334);
    host.querySelector<HTMLElement>(".vf-monitor-claims")!.getBoundingClientRect = () =>
      box(80, 56, 300, 9);
    const tick = async (): Promise<void> => {
      act(() => {
        for (const publish of fire) publish();
      });
      await settle();
    };
    // the measured stage arrives, and what it sets off (the view's report) lands
    await tick();
    await settle();
    const held = recording.lastInput?.stage;
    expect(held?.width).toBe(900);
    const updates = recording.updates;
    const rendered = renders;
    // ten ticks that measure the same: the stage it holds. React may call the
    // monitor once more to confirm an unchanged state (its two fibers) and then
    // skips everything under it; a fresh object every tick rendered ten times.
    for (let n = 0; n < 10; n += 1) await tick();
    expect(renders - rendered).toBeLessThanOrEqual(1);
    expect(recording.lastInput?.stage).toBe(held);
    expect(recording.updates).toBe(updates);
    // a stage that grows is a new stage: the monitor renders, and the view hears it
    width = 960;
    await tick();
    expect(renders).toBeGreaterThan(rendered);
    expect(recording.lastInput?.stage?.width).toBe(960);
    expect(recording.updates).toBeGreaterThan(updates);
  });

  it("gives a silent strip no room of its own: the top inset is the head's reserve, and the package's own band stands past it (GV-D1)", async () => {
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
    stage!.getBoundingClientRect = () => rect(0, 440);
    claims!.getBoundingClientRect = () => rect(56, 56);
    act(() => {
      for (const publish of fire) publish();
    });
    await settle();
    // 56: the head's foot at 48, plus 8 — where it was 0 under the bar
    expect(
      host
        .querySelector<HTMLElement>(".vf-monitor-list")
        ?.style.getPropertyValue("--mv-list-inset-top"),
    ).toBe("56px");
  });

  it("renders the head only when one of its own inputs moves: twenty publishes render it not once, nor does a status that moves, and the view changing does (M195)", async () => {
    // The monitor renders on every model publish (about once a frame while
    // agents work). The bar the head replaced was a row of tips, each with its
    // own handlers, so rendered inline it was rebuilt with every publish, and
    // each view the registry gained cost one more tip per frame (spend: ab2's
    // timeline n10 React render, +0.71 ms/s). The head is a row of circles with
    // their own handlers, held the same way: its inputs are the registry's
    // views, the view's id, the deck's state and one stable select. The bar
    // also rendered for a count; the head holds no counter (FC-D18), so a
    // status that moves is nothing to it either.
    const recording = createRecordingView("head-quiet");
    const entry: MonitorViewEntry = {
      id: "head-quiet",
      label: "QUIET",
      parameterGroups: [],
      mark: recording.view.manifest.mark,
      view: recording.view,
    };
    const door = fakeDoor();
    syncBoard(PANES);
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    await act(async () => {
      root?.render(
        <GodviewAgentsProvider door={door}>
          <GodviewMonitor view={entry} parameters={{}} door={door} panes={PANES} />
        </GodviewAgentsProvider>,
      );
    });
    await settle();
    const claude = (overrides: Partial<Parameters<typeof managedSummary>[0]>) =>
      managedSummary({
        runtimeRunId: "run-claude",
        kind: "claude",
        label: "Claude",
        status: "working",
        cwd: "/project/vibe-field",
        createdAt: "2026-09-12T10:00:00.000Z",
        ...overrides,
      });
    expect(head.renders).toBeGreaterThan(0);
    const renders = head.renders;
    const updates = recording.updates;
    // twenty publishes that move a reply: the window's rows move, the head's inputs do not
    for (let n = 0; n < 20; n += 1) {
      await act(async () =>
        door.push([claude({ lastAssistantText: `reply ${n}` }), ...ROWS.slice(1)]),
      );
      await settle();
    }
    expect(recording.updates - updates).toBeGreaterThanOrEqual(20);
    expect(head.renders - renders).toBe(0);
    // a status that moves was the bar's counters'; the head has none
    await act(async () => door.push([claude({ status: "idle" }), ...ROWS.slice(1)]));
    await settle();
    expect(head.renders - renders).toBe(0);
    // the view changing is the head's: it renders, and the ring moves with it
    const list = monitorViewFor("list");
    await act(async () => {
      root?.render(
        <GodviewAgentsProvider door={door}>
          <GodviewMonitor
            view={list}
            parameters={monitorParameterDefaults(list.parameterGroups)}
            door={door}
            panes={PANES}
          />
        </GodviewAgentsProvider>,
      );
    });
    await settle();
    expect(head.renders).toBeGreaterThan(renders);
    expect(pressedView(container)).toBe("LIST view");
  });

  it("names no ported view in a host stylesheet (W5), and defines every skin name the views read (L18)", () => {
    // List and rain carry their own stylesheets since MV-4, the swarm (and its
    // spawn bloom) since MV-5, the timeline since MV-6, spend since MV-7 (L18):
    // no VibeField rule may name their classes or their root classes — swept
    // over every stylesheet of this package and the design kit.
    const stylesheets = (dir: string): string[] =>
      readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
        entry.isDirectory()
          ? stylesheets(join(dir, entry.name))
          : entry.name.endsWith(".css")
            ? [join(dir, entry.name)]
            : [],
      );
    const sheets = [
      ...stylesheets(join(process.cwd(), "src")),
      ...stylesheets(join(process.cwd(), "../design-kit/src")),
    ];
    expect(sheets.some((path) => path.endsWith("godview/godview.css"))).toBe(true);
    expect(sheets.some((path) => path.endsWith("design-kit/src/tokens.css"))).toBe(true);
    for (const path of sheets) {
      const css = readFileSync(path, "utf8");
      for (const name of [
        /vf-monitor-list/,
        /vf-monitor-rain/,
        /vf-rain/,
        /\.mv-list\b/,
        /\.mv-rain\b/,
        /vf-monitor-swarm/,
        /vf-swarm/,
        /vf-bloom/,
        /\.mv-swarm\b/,
        /vf-monitor-timeline/,
        /\.mv-timeline\b/,
        /vf-monitor-spend/,
        /\.mv-spend\b/,
        /--vf-monitor-flow-band/,
      ]) {
        expect(css, `${path} names ${name}`).not.toMatch(name);
      }
    }
    // Every name of the skin (the SDK's MONITOR_SKIN) is defined on the stage
    // in BOTH themes — Godview's skin blocks — or once for all in the tokens.
    const godview = readFileSync(join(process.cwd(), "src/godview/godview.css"), "utf8");
    const tokens = readFileSync(join(process.cwd(), "../design-kit/src/tokens.css"), "utf8");
    const block = (scheme: string): string => {
      const start = godview.indexOf(`.vf-godview.theme-${scheme},`);
      expect(start, `godview.css has the ${scheme} skin block`).toBeGreaterThanOrEqual(0);
      return godview.slice(start, godview.indexOf("}", start));
    };
    const defines = (css: string, name: string): boolean =>
      new RegExp(`^\\s*${name}\\s*:`, "m").test(css);
    for (const name of MONITOR_SKIN) {
      const themed = defines(block("light"), name) && defines(block("dark"), name);
      expect(themed || defines(tokens, name), `${name} is defined on the stage`).toBe(true);
    }
    // M178: the sans the spend view sets its words in is a skin name since
    // MV-7, defined once on :root in the token sheet (the loop above holds it)
    expect(MONITOR_SKIN).toContain("--vf-font-sans");
    // MV-7: spend paints with the palette's swarm inks, the timeline's ground
    // and the stage (`useMonitorPalette` reads them from these names), so each
    // is defined here too: in both skin blocks, or once in the tokens
    for (const name of [
      "--text-main",
      "--vf-orange",
      "--vf-godview-rain-green",
      "--vf-select",
      "--monitor-bg",
      "--vf-card-deep",
    ]) {
      const themed = defines(block("light"), name) && defines(block("dark"), name);
      expect(themed || defines(tokens, name), `${name} is defined for the palette`).toBe(true);
    }
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

  it("draws each manifest's mark and says its keys through the shipping head (MV-D6, MV-D8, GV-D1)", async () => {
    const host = await mountMonitor("list");
    const group = host.querySelector('[role="group"][aria-label="Monitor view"]');
    for (const entry of MONITOR_VIEWS) {
      const mark = group?.querySelector(`[aria-label="${entry.label} view"] svg`);
      expect(mark?.getAttribute("viewBox")).toBe(entry.view.manifest.mark.viewBox);
      expect(
        [...(mark?.querySelectorAll("path") ?? [])].map((path) => path.getAttribute("d")),
      ).toEqual(entry.view.manifest.mark.paths);
      expect(mark?.classList.contains("is-filled")).toBe(true);
    }
    const swarm = monitorViewFor("swarm");
    // the circle's label is where a view's focus keys are said (M177), as the
    // bar's tooltip was
    await act(async () => {
      const control = group?.querySelector<HTMLButtonElement>(
        `button[aria-label="${swarm.label} view"]`,
      );
      expect(control).not.toBeNull();
      control?.focus();
    });
    const said = host.querySelector('.vf-stories [role="tooltip"]');
    expect(said?.firstChild?.textContent).toBe("Swarm");
    const keys = said?.querySelector("kbd");
    expect(keys?.textContent).toBe("⎋ ↵ → ←");
    expect(keys?.getAttribute("aria-label")).toBe(
      `while focused: ${swarm.view.manifest.keys?.map((key) => `${key.key}, ${key.label}`).join("; ")}`,
    );
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
    // This door exposes only the model board; no second full-board reader exists.
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

  it("refreshes marker facts from chrome and drawn membership independently", async () => {
    const door = fakeDoor();
    await mountMonitor("list", door);
    const run = (): NonNullable<GodviewMonitorFacts["runs"]>[number] | undefined =>
      latest().runs?.find((entry) => entry.run === "run-codex");
    expect(run()).toMatchObject({ spawnedBy: "app", status: "blocked", drawn: true });
    // Provenance belongs to chrome, so this can change without a new model row.
    act(() => {
      door.push(
        ROWS.map((row) =>
          row.runtimeRunId === "run-codex" ? { ...row, spawnedBy: "user-shell" } : row,
        ),
      );
    });
    await settle();
    expect(run()).toMatchObject({ spawnedBy: "user-shell", status: "blocked", drawn: true });
    // The pane's exit changes the window's cut, not the run's marker facts.
    await renderMonitor("list", door, {
      ...PANES,
      sessions: (PANES.sessions ?? []).map((session) =>
        session.id === "run-codex-pty" ? { ...session, exited: true } : session,
      ),
    });
    expect(run()).toMatchObject({ spawnedBy: "user-shell", status: "blocked", drawn: false });
    await renderMonitor("list", door, PANES);
    expect(run()).toMatchObject({ spawnedBy: "user-shell", status: "blocked", drawn: true });
  });

  it("says WEBGPU UNAVAILABLE rather than drawing an empty field on a device with no GPU", async () => {
    // The honest-states law where AR-5's port put it. happy-dom has no WebGPU,
    // and a swarm that answered that with a blank canvas would look exactly
    // like a field with nothing in it. The view says so on its stage and to its
    // host (MV-5: its `report`, which the slot mirrors on ITS element — W5: the
    // stage never reads the view's DOM), the marker repeats it, and the rows
    // are still reachable underneath.
    const host = await mountMonitor();
    const swarm = host.querySelector(".vf-monitor-swarm");
    expect(swarm?.querySelector('.vf-monitor-swarm-empty[role="status"]')?.textContent).toContain(
      "WEBGPU UNAVAILABLE",
    );
    expect(swarm?.querySelectorAll(".vf-monitor-swarm-list li button").length).toBe(4);
    expect(latest().swarmRenderer).toBe("unavailable");
    expect(
      host.querySelector("[data-monitor-view-slot]")?.getAttribute("data-monitor-view-renderer"),
    ).toBe("unavailable");
    // …and the physics still ran, in this thread (no Worker here): what is
    // missing is the painter, not the world.
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
    expect(chip?.closest(".vf-monitor-claims")).not.toBeNull();
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

  it("PF6: closing disposes — every timer cleared, the subscription closed, the view and its physics gone", async () => {
    const host = await mountMonitor();
    // MV-3b: the clocks the seam ran here (the mesh poll, the 10 s now) are the
    // backend's now, so there is no interval to count on; the window's ONE model
    // subscription is what the stage holds open, and whatever it still opens
    // must close with it
    expect(board?.opened(), "the model board never opened").toBe(1);
    expect(board?.closed()).toBe(0);
    expect(clearedIntervals).not.toEqual(expect.arrayContaining(openedIntervals));
    // the swarm's physics runs, by the view's own word (MV-D7: its driver is its own)
    expect(latest().swarmPhysics, "the swarm never started its physics").toBe("inline");

    // the view lives in its own React root, which the host releases a microtask
    // after its own commit (one root never unmounts inside another's)
    await act(async () => {
      root?.unmount();
      await Promise.resolve();
    });
    root = null;

    // The whole PF6 claim for this stage, and it is stronger than the deck's:
    // the deck stays mounted and SILENCED, this is gone. Nothing is left
    // ticking, the board is closed, and the view was unmounted — its physics go
    // with it (the view's own disposal, held by its suite in puppeteer).
    for (const id of openedIntervals) {
      expect(clearedIntervals, `interval ${id} survived the close`).toContain(id);
    }
    expect(board?.closed(), "the model subscription outlived the close").toBe(1);
    expect(host.querySelector("[data-monitor-view-root]"), "a view outlived the close").toBeNull();
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

  it("says how the deck's rule placed it: a new pane, its own pane focused, or the active one (GV-D4)", async () => {
    // The door answers how the session was placed (`deck-placement.ts`), and
    // the stage's words follow — never "mounted" for a session that was only
    // focused where it already was.
    const door = fakeDoor();
    const host = await mountMonitor("list", door);
    const pick = async (placement: "beside" | "focus" | "replace"): Promise<string> => {
      door.mountLocal.mockResolvedValueOnce({
        state: "mounted",
        sessionId: "run-claude-pty",
        placement,
      });
      const row = [...host.querySelectorAll<HTMLButtonElement>(".vf-monitor-list-row")].find(
        (candidate) => candidate.textContent?.includes("vibe-field"),
      );
      await act(async () => row?.click());
      return ackText(host);
    };
    // fewer than three panes: beside the focused one
    expect(await pick("beside")).toBe("vibe-field opened in a new pane");
    // already in a pane: focused where it is, nothing mounted
    expect(await pick("focus")).toBe("vibe-field is in the active pane");
    // three or more: the focused pane's place
    expect(await pick("replace")).toBe("vibe-field mounted in the active pane");
    expect(door.mountLocal).toHaveBeenCalledTimes(3);

    // …and a new terminal says the same two places
    door.createTerminal.mockResolvedValueOnce({
      state: "mounted",
      sessionId: "born-2",
      placement: "beside",
    });
    await act(async () => host.querySelector<HTMLButtonElement>(".vf-monitor-list-new")?.click());
    expect(ackText(host)).toBe("terminal opened in a new pane");
    door.createTerminal.mockResolvedValueOnce({
      state: "mounted",
      sessionId: "born-3",
      placement: "replace",
    });
    await act(async () => host.querySelector<HTMLButtonElement>(".vf-monitor-list-new")?.click());
    expect(ackText(host)).toBe("terminal opened in the active pane");
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

  it("carries the deck's own refusal words while the SDK answers that nothing opened", async () => {
    // The host rejects after its acknowledgement; the SDK resolves that as
    // opened:false so a view puts its pending body away at once (SB-3, M59).
    const door = fakeDoor();
    door.createTerminal.mockResolvedValueOnce({
      state: "failed",
      reason: "terminal capacity reached",
    });
    const host = await mountProbe(door);
    await expect(createAt()).resolves.toEqual({ opened: false });
    expect(ackText(host)).toBe("terminal could not be opened — terminal capacity reached");
    door.createTerminal.mockResolvedValueOnce({ state: "no-pane" });
    await expect(createAt()).resolves.toEqual({ opened: false });
    expect(ackText(host)).toContain("no pane");
  });

  it("wears the head where the instrument bar stood, and nothing the bar held beside the views (GV-D1)", async () => {
    // The head is the monitor host's own chrome since GV-D1: a row of circles
    // in the head's slot, over the stage. The package's instrument bar is not
    // mounted at all, and what it held beside the views is gone or moved: the
    // counters (FC-D18), the ☼◐ switch (FC-D7), the spacer for the window's
    // lights, the bridge notice's empty slot, and System control — the
    // palette's act now, never a button here.
    const host = await mountMonitor("list", fakeDoor());
    expect(host.querySelector(".vf-godview-header")).toBeNull();
    const slot = host.querySelector(".vf-stories-slot");
    expect(slot?.querySelector(".vf-stories"), "the head never mounted").not.toBeNull();
    // the slot stands before the stage, as the bar did: the stage is its sibling
    expect(slot?.nextElementSibling?.classList.contains("vf-godview-monitor-stage")).toBe(true);
    expect(host.querySelector('[role="group"][aria-label="Agent status"]')).toBeNull();
    expect(host.querySelector('[role="switch"]')).toBeNull();
    expect(host.querySelector(".vf-godview-native-controls-space")).toBeNull();
    expect(host.querySelector(".vf-godview-header-notice")).toBeNull();
    expect(host.querySelector('button[aria-label="System control"]')).toBeNull();
    expect(host.querySelector('button[aria-controls="vf-godview-tweak-panel"]')).toBeNull();
    expect(host.querySelector('select[aria-label="Agent provider"]')).toBeNull();
    expect(host.querySelector(".vf-godview-spawn")).toBeNull();
    // P2 (PK2 (a)): search is the frame's button at the head's right end
    expect(host.querySelector('button[aria-label="Find an agent by what was said"]')).toBeNull();
    expect(host.querySelector('button[aria-controls="vf-find-sheet"]')).toBeNull();
    // The head holds the view circles and nothing else: the registry's five,
    // spend after the timeline since MV-7.
    expect(viewButtons(host).map((button) => button.getAttribute("aria-label"))).toEqual([
      "SWARM view",
      "LIST view",
      "RAIN view",
      "TIMELINE view",
      "SPEND view",
    ]);
    expect(slot?.querySelectorAll("button").length).toBe(5);
    expect(pressedView(host)).toBe("LIST view");
    // GV-D11: the head reads the deck's door — no state said, or "up" or "away", it stands;
    // "maximized", it steps away; and back
    expect(slot?.querySelector(".vf-stories")?.getAttribute("data-deck")).toBe("up");
    act(() => publishGodviewDeck("away"));
    expect(slot?.querySelector(".vf-stories")?.getAttribute("data-deck")).toBe("up");
    act(() => publishGodviewDeck("maximized"));
    expect(slot?.querySelector(".vf-stories")?.getAttribute("data-deck")).toBe("maximized");
    act(() => publishGodviewDeck("up"));
    expect(slot?.querySelector(".vf-stories")?.getAttribute("data-deck")).toBe("up");
  });

  it("a head that throws says Monitor views unavailable where the row stood; the stage and its view stay (M49, M192)", async () => {
    head.throws = true;
    const recording = createRecordingView("head-survivor");
    const entry: MonitorViewEntry = {
      id: recording.view.manifest.id,
      label: recording.view.manifest.label,
      mark: recording.view.manifest.mark,
      parameterGroups: [],
      view: recording.view,
    };
    const door = fakeDoor();
    syncBoard(PANES);
    container = document.createElement("div");
    document.body.appendChild(container);
    const uncaught = vi.fn();
    root = createRoot(container, { onUncaughtError: uncaught, onCaughtError: vi.fn() });
    await act(async () => {
      root?.render(
        <GodviewAgentsProvider door={door}>
          <GodviewMonitor view={entry} parameters={{}} door={door} panes={PANES} />
        </GodviewAgentsProvider>,
      );
    });
    await settle();
    expect(uncaught).not.toHaveBeenCalled();
    const status = container.querySelector('.vf-stories-slot > span[role="status"]');
    expect(status?.textContent).toBe("Monitor views unavailable");
    expect(container.querySelector(".vf-stories")).toBeNull();
    // the monitor's stage, its chrome and its view are all there
    expect(container.querySelector(".vf-godview-monitor-stage")).not.toBeNull();
    expect(container.querySelector(".vf-monitor-claims")).not.toBeNull();
    expect([recording.mounts, recording.unmounts]).toEqual([1, 0]);
    // it reads only the window's own state, so no publish tries it again (M192)
    head.throws = false;
    const tries = head.renders;
    await act(async () =>
      door.push([managedSummary({ runtimeRunId: "after-the-head", cwd: "/project/after" })]),
    );
    await settle();
    expect(head.renders).toBe(tries);
    expect(container.querySelector('.vf-stories-slot > span[role="status"]')).not.toBeNull();
  });

  it("chooses the view with the head's circles; there is no theme switch (FC-D7)", async () => {
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

    // Godview follows the app's theme (One Frame FR-4). The ☼◐ switch was the
    // package's bar's, hidden by a host rule while the bar stood; the bar left
    // VibeField (GV-D1), so there is no switch to hide and no rule hiding one.
    expect(container?.querySelector('[role="switch"]')).toBeNull();
    const css = readFileSync(join(process.cwd(), "src/godview/godview.css"), "utf8");
    expect(css).not.toContain("vf-godview-header");
    expect(css).not.toContain("vf-godview-theme-switch");
    expect(css).not.toContain("vf-godview-bar-");
    expect(css).not.toContain("vf-godview-native-controls-space");
    expect(css).not.toContain('aria-label="Agent status"');
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

// ---- AR-S5 — the profile filter ------------------------------------------------
//
// Chosen in search's Live now since P2 (GV-D3), through the door the stage
// publishes (`find-door.ts`) — the bar's strip and its ⌥0–⌥9 retired (PK4).
// What is VibeField's is what a choice DOES: which rows it keeps, what the
// counters count, where a spawn lands, and the one sentence over an empty
// profile. The rows here
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

/** GV-D3 (P2): a profile is chosen in search's Live now, through the door the
 * stage publishes — the scope row's dropdown calls exactly this. */
const chooseProfile = async (id: string): Promise<void> => {
  await act(async () => getGodviewFindDoor()?.setProfile(id === "all" ? null : id));
};
const chosenTab = (_host?: HTMLElement): string => getGodviewFindDoor()?.filters.profile ?? "all";
const listRows = (host: HTMLElement): { project: string; receded: boolean }[] =>
  [...host.querySelectorAll<HTMLButtonElement>(".vf-monitor-list-row")].map((row) => ({
    project: row.querySelector("strong")?.textContent ?? "",
    receded: row.classList.contains("is-receded"),
  }));

/** A view that says, through its `report`, that it holds the keys — the spawn bloom's word since MV-5 (MV-D8). */
async function mountReporting(door: MonitorDoor): Promise<{
  host: HTMLElement;
  holdKeys(held: boolean): Promise<void>;
}> {
  const recording = createRecordingView("keys-probe");
  const entry: MonitorViewEntry = {
    id: "keys-probe",
    label: "KEYS",
    parameterGroups: [],
    mark: recording.view.manifest.mark,
    view: recording.view,
  };
  syncBoard(PANES);
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root?.render(
      <GodviewAgentsProvider door={door}>
        <GodviewMonitor view={entry} parameters={{}} door={door} panes={PANES} publishesFind />
      </GodviewAgentsProvider>,
    );
  });
  await settle();
  const host = container;
  return {
    host,
    holdKeys: async (held) => {
      await act(async () => recording.commands[0]?.report({ keysHeld: held }));
    },
  };
}

describe("the profile filter (AR-S5; in search's Live now since P2, GV-D3)", () => {
  it("offers no profile while This Mac is the only one, and every profile once one exists — never in the head", async () => {
    const door = tabDoor([NATIVE_SET]);
    const host = await mountMonitor("list", door);
    expect(getGodviewFindDoor()?.filters.profiles).toEqual([]);
    await act(async () => door.pushSets(TAB_SETS));
    expect(getGodviewFindDoor()?.filters.profiles.map((profile) => profile.id)).toEqual([
      "native",
      "work",
      "empty",
    ]);
    expect(chosenTab(host)).toBe("all");
    // the one dot: Codex is blocked under Work
    const work = getGodviewFindDoor()?.filters.profiles.find((profile) => profile.id === "work");
    expect(work?.blocked).toBe(true);
    // the head carries no strip and no chip: the view circles, and nothing else
    const slot = host.querySelector(".vf-stories-slot");
    expect(slot).not.toBeNull();
    expect(host.querySelector('[role="tablist"]')).toBeNull();
    expect(host.querySelector(".vf-device-filter")).toBeNull();
    expect(slot?.querySelectorAll("button").length).toBe(viewButtons(host).length);
  });

  it("keeps the chosen profile's sessions, recedes every other row in place, and the marker counts what it shows", async () => {
    // (The bar's counters counted the shown rows too, until the bar left
    // VibeField — GV-D1; the marker is the count that is left.)
    const host = await mountMonitor("list", tabDoor());
    const everything = latest().shownAgents;
    await chooseProfile("work");
    expect(chosenTab(host)).toBe("work");
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

    await chooseProfile("all");
    expect(latest().shownAgents).toBe(everything);
    expect(everything).toBeGreaterThan(2);
    expect(listRows(host).some((row) => row.receded)).toBe(false);
    expect(latest().profileTab).toBe("all");
  });

  it("binds ⌥0–⌥9 no more (docket PK4 (a)): every ⌥digit reaches the pane, and chooses nothing", async () => {
    const host = await mountMonitor("list", tabDoor());
    const pane = document.createElement("div");
    const textarea = document.createElement("textarea");
    pane.append(textarea);
    document.body.append(pane);
    try {
      for (const at of [window, host, textarea] as EventTarget[]) {
        for (let digit = 0; digit <= 9; digit += 1) {
          const event = new KeyboardEvent("keydown", {
            code: `Digit${digit}`,
            key: String(digit),
            altKey: true,
            bubbles: true,
            cancelable: true,
          });
          await act(async () => {
            at.dispatchEvent(event);
          });
          expect(event.defaultPrevented, `⌥${digit} was taken`).toBe(false);
          expect(chosenTab(host)).toBe("all");
        }
      }
    } finally {
      pane.remove();
    }
  });

  it("takes neither ⌥2 nor ⌘F, whether a view holds the keys or not — the stage binds no key (P2)", async () => {
    // ⌘F is the frame's Peek (a product chord, peek.test.tsx), ⌥0–⌥9 retired
    // (PK4): the stage hears neither, and mounts no sheet of its own.
    const { host, holdKeys } = await mountReporting(tabDoor());
    const press = (init: KeyboardEventInit): KeyboardEvent => {
      const event = new KeyboardEvent("keydown", { bubbles: true, cancelable: true, ...init });
      window.dispatchEvent(event);
      return event;
    };
    for (const held of [true, false]) {
      await holdKeys(held);
      let passed: KeyboardEvent | undefined;
      await act(async () => {
        passed = press({ code: "Digit2", key: "2", altKey: true });
      });
      expect(passed?.defaultPrevented).toBe(false);
      await act(async () => {
        passed = press({ code: "KeyF", key: "f", metaKey: true });
      });
      expect(passed?.defaultPrevented).toBe(false);
      expect(host.querySelector(".vf-find-sheet")).toBeNull();
      expect(chosenTab(host)).toBe("all");
    }
  });

  it("holds the keys while the view holds them, so the deck's launchers stand aside (SB-3)", async () => {
    const { holdKeys } = await mountReporting(tabDoor());
    expect(monitorHoldsKeys()).toBe(false);
    await holdKeys(true);
    expect(monitorHoldsKeys()).toBe(true);
    await holdKeys(false);
    expect(monitorHoldsKeys()).toBe(false);
    // a view that holds them when the stage closes gives them back with it
    await holdKeys(true);
    expect(monitorHoldsKeys()).toBe(true);
    act(() => root?.unmount());
    root = null;
    expect(monitorHoldsKeys()).toBe(false);
  });

  it("holds no keys for ⌘F: the sheet that held them left with P2", async () => {
    await mountMonitor("list", tabDoor());
    await act(async () => {
      window.dispatchEvent(
        new KeyboardEvent("keydown", { code: "KeyF", key: "f", metaKey: true, bubbles: true }),
      );
    });
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
    await chooseProfile("work");
    const rows = listRows(host);
    expect(rows.find((row) => row.project === "work-shell")?.receded).toBe(false);
    expect(rows.find((row) => row.project === "bare-shell")?.receded).toBe(true);
    await chooseProfile("native");
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
      await chooseProfile(id);
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
    await chooseProfile("empty");
    const empty = host.querySelector(".vf-monitor-profile-empty");
    expect(empty?.textContent).toContain("No sessions under Empty");
    expect(empty?.textContent).toContain(
      "Only this profile's sessions show — the search button's × shows them all again.",
    );
    expect(empty?.querySelector('[data-profile-glyph="flask"]')).not.toBeNull();
    expect(host.querySelector(".vf-monitor-list")?.classList.contains("is-all-receded")).toBe(true);
    expect(latest().shownAgents).toBe(0);

    await act(async () => door.pushSets([NATIVE_SET, WORK_SET]));
    expect(chosenTab(host)).toBe("all");
    expect(host.querySelector(".vf-monitor-profile-empty")).toBeNull();
    expect(listRows(host).some((row) => row.receded)).toBe(false);
  });
});

// ---- P2 — the find door: Live now's rows, the stage's keys --------------------

describe("the find door (P2): Live now's rows made only while the Peek listens, held by content", () => {
  const blockedClaude = (): AgentSessionSummary =>
    managedSummary({
      runtimeRunId: "run-claude",
      kind: "claude",
      label: "Claude",
      status: "blocked",
      blocker: { kind: "permission", tool: "Bash" },
      profileSet: "work",
      cwd: "/project/vibe-field",
    });

  it("makes no rows for a closed Peek, the same rows while nothing they say moved, new rows when one does — and keeps the door itself across publishes", async () => {
    const door = tabDoor();
    await mountMonitor("list", door);
    const find = getGodviewFindDoor();
    if (find === null) throw new Error("the stage published no find door");
    // nobody listens: the find join is not made
    expect(find.rows()).toBeNull();
    let heard = 0;
    let stop: (() => void) | undefined;
    await act(async () => {
      stop = find.subscribeRows(() => {
        heard += 1;
      });
    });
    await settle();
    const first = getGodviewFindDoor()?.rows() ?? null;
    expect(first?.filter((row) => row.agent !== undefined).map((row) => row.project)).toEqual(
      expect.arrayContaining(["vibe-field", "voyager", "jabali"]),
    );
    expect(heard).toBeGreaterThan(0);
    // the same rows published again: the same array, nobody told
    const told = heard;
    await act(async () => door.push(TAB_ROWS));
    await settle();
    expect(getGodviewFindDoor()?.rows()).toBe(first);
    expect(heard).toBe(told);
    // a status moves: new rows, told — and the door is the same object throughout
    await act(async () => door.push([blockedClaude(), ...TAB_ROWS.slice(1)]));
    await settle();
    const next = getGodviewFindDoor()?.rows() ?? null;
    expect(next).not.toBe(first);
    expect(next?.find((row) => row.project === "vibe-field")?.status).toBe("blocked");
    expect(heard).toBeGreaterThan(told);
    expect(getGodviewFindDoor()).toBe(find);
    // the last listener gone: no rows again
    await act(async () => stop?.());
    await settle();
    expect(getGodviewFindDoor()?.rows()).toBeNull();
  });

  it("holds the keys for the Peek over the stage (QL-D2), and says when the mounted view holds them (SB-3)", async () => {
    const { holdKeys } = await mountReporting(tabDoor());
    const find = getGodviewFindDoor();
    if (find === null) throw new Error("the stage published no find door");
    expect(monitorHoldsKeys()).toBe(false);
    const release = find.holdKeys();
    expect(monitorHoldsKeys()).toBe(true);
    release();
    release();
    expect(monitorHoldsKeys()).toBe(false);
    expect(find.viewHoldsKeys()).toBe(false);
    await holdKeys(true);
    expect(getGodviewFindDoor()?.viewHoldsKeys()).toBe(true);
    await holdKeys(false);
    expect(getGodviewFindDoor()?.viewHoldsKeys()).toBe(false);
  });
});

// ---- SB-3 — the spawn menu, and the create it asks for ---------------------------
//
// These rows record the real SDK input and commands, and drive the same
// create command as the bloom and list menu: the menu from the tabs' feed, the create under the chosen set, and
// every outcome said, a refusal in fieldd's own words.

let probed: MonitorViewInput | null = null;
let probeCommands: MonitorViewCommands | undefined;
const probeView = createRecordingView("probe", {
  onMount: (_root, input, commands) => {
    probed = input;
    probeCommands = commands;
  },
  onUpdate: (input) => {
    probed = input;
  },
});
const PROBE_VIEW: MonitorViewEntry = {
  id: "probe",
  label: "PROBE",
  mark: probeView.view.manifest.mark,
  parameterGroups: [],
  view: probeView.view,
};

async function mountProbe(
  door: MonitorDoor | null,
  panes: MonitorPaneFacts = PANES,
): Promise<HTMLElement> {
  probed = null;
  probeCommands = undefined;
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
          publishesFind
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

/** The SDK's create answer, after the host's acknowledgement has committed. */
const createAt = async (
  position?: { x: number; y: number },
  target?: { deviceId?: string; profileSet?: string },
): Promise<MonitorCreateAnswer> => {
  if (probeCommands === undefined) throw new Error("probe is not mounted");
  let answer!: MonitorCreateAnswer;
  await act(async () => {
    answer = await probeCommands!.create(position, target);
  });
  return answer;
};

describe("the spawn menu and the create it asks for (SB-3)", () => {
  it("offers no menu without a profiles feed — a hold creates at once, as before", async () => {
    await mountProbe(fakeDoor());
    expect(probed).not.toBeNull();
    expect(probed?.capabilities.spawn).toBeUndefined();
  });

  it("offers this desktop, reading until the feed answers, then its profiles — the same menu object until it changes", async () => {
    const door = slowTabDoor();
    await mountProbe(door);
    expect(probed?.capabilities.spawn?.devices).toEqual([
      { id: HERE_DEVICE_ID, label: "This desktop", self: true, state: "reading" },
    ]);
    await act(async () => door.pushSets(TAB_SETS));
    const menu = probed?.capabilities.spawn;
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
    expect(probed?.capabilities.spawn).toBe(menu);
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
    const born = probed?.model.agents.find((agent) => agent.id === "born-1");
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
    const row = (id: string) => probed?.model.agents.find((agent) => agent.id === id);
    let creating: Promise<MonitorCreateAnswer> | undefined;
    await act(async () => {
      creating = probeCommands?.create({ x: 321.25, y: 123.75 }, { profileSet: "work" });
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
    const row = (id: string) => probed?.model.agents.find((agent) => agent.id === id);
    let creating: Promise<MonitorCreateAnswer> | undefined;
    await act(async () => {
      creating = probeCommands?.create({ x: 10.5, y: 20.5 });
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
    await expect(createAt({ x: 10, y: 10 }, { profileSet: "work" })).resolves.toEqual({
      opened: false,
    });
    expect(ackText(host)).toBe(sentence);
  });

  it("refuses with an acknowledgement when there is no deck to open a terminal in", async () => {
    const host = await mountProbe(null, { sessionIds: [] });
    const sentence = "no terminal can be opened yet — the deck has no connection";
    await expect(createAt({ x: 10, y: 10 })).resolves.toEqual({ opened: false });
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
    ).resolves.toEqual({ opened: false });
    expect(door.createTerminal).not.toHaveBeenCalled();
    expect(ackText(host)).toBe("that desktop cannot take a terminal from here yet");
    // the hub while this desktop's profiles are still being read, a host with no menu
    await createAt({ x: 10, y: 10 });
    expect(door.createTerminal).toHaveBeenCalledExactlyOnceWith();
    expect(ackText(host)).toBe("terminal opened in the active pane");
  });
});

// ---- TL — the record's past on the stage ----------------------------------------
//
// `godview-monitor-history.test.tsx` holds the hook: when it reads, what it
// keeps, how it narrows and recedes. These rows hold what only the mounted
// STAGE can show: the two facts its marker states of the past it lends
// (`history`, `endedLanes`) — read off the lent object, never off the view's
// DOM (MV-5's rule), so a smoke can tell a host that lent nothing from a view
// that drew nothing.

const pastProbeView = createRecordingView("past-probe", {
  manifest: { capabilities: { optional: ["history"] } },
});
const PAST_PROBE: MonitorViewEntry = {
  id: "past-probe",
  label: "PAST",
  mark: pastProbeView.view.manifest.mark,
  parameterGroups: [],
  view: pastProbeView.view,
};

const PAST_AT = Date.UTC(2026, 9, 9, 12);
const PAST_HOUR = 60 * 60_000;
const pastLane = (id: string, hoursAgo: number) => ({
  id,
  provider: { id: "claude", label: "Claude Code" },
  project: { name: "billing-api", seq: 3 },
  device: { id: "this-device", name: "This Mac", os: "mac" },
  startedAt: PAST_AT - (hoursAgo + 1) * PAST_HOUR,
  endedAt: PAST_AT - hoursAgo * PAST_HOUR,
  spans: [
    {
      kind: "bounds",
      from: PAST_AT - (hoursAgo + 1) * PAST_HOUR,
      to: PAST_AT - hoursAgo * PAST_HOUR,
    },
  ],
});
/** Two runs that ended in the day, as `agent.recordedLanes` answers them. */
const PAST = AgentRecordedLanesResult.parse({
  sinceMs: PAST_AT - 24 * PAST_HOUR,
  untilMs: PAST_AT,
  readAt: PAST_AT,
  fidelity: "bounds",
  state: "complete",
  live: [],
  ended: [pastLane("past:claude:nat-early", 3), pastLane("past:claude:nat-late", 1)],
});

/** A door's `pastLanes` answering what the row hands it, its asks counted. */
function pastPort(
  answer: () => Promise<AgentRecordedLanesResult>,
): RecordedLanesPort & { asks: number } {
  const port = {
    asks: 0,
    read: () => {
      port.asks += 1;
      return answer();
    },
    // TV-8's lookup is `godview-open-ended-lane.test.tsx`'s; nothing here opens a lane
    sessions: () => Promise.resolve([]),
  };
  return port;
}

async function mountPastProbe(door: MonitorDoor): Promise<HTMLElement> {
  syncBoard(PANES);
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root?.render(
      <GodviewAgentsProvider door={door}>
        <GodviewMonitor view={PAST_PROBE} parameters={{}} door={door} panes={PANES} />
      </GodviewAgentsProvider>,
    );
  });
  await settle();
  return container;
}

describe("the record's past on the stage (TL): what the marker says of it", () => {
  it("says `absent` and no ended lanes for a view that declares no history, and never asks the door", async () => {
    const port = pastPort(async () => PAST);
    await mountProbe(Object.assign(fakeDoor(), { pastLanes: port }));
    expect(port.asks).toBe(0);
    expect(latest()).toMatchObject({ viewId: "probe", history: "absent", endedLanes: 0 });
    expect(probed?.capabilities.history).toBeUndefined();
  });

  it("says `absent` until the door answers, then the lent past's own state and how many runs ended in it", async () => {
    let release: (answer: AgentRecordedLanesResult) => void = () => undefined;
    const waiting = new Promise<AgentRecordedLanesResult>((resolve) => {
      release = resolve;
    });
    const port = pastPort(() => waiting);
    await mountPastProbe(Object.assign(fakeDoor(), { pastLanes: port }));
    expect(port.asks).toBe(1);
    expect(latest()).toMatchObject({ viewId: "past-probe", history: "absent", endedLanes: 0 });
    await act(async () => release(PAST));
    await settle();
    expect(latest()).toMatchObject({ viewId: "past-probe", history: "complete", endedLanes: 2 });
    // the marker counts what the view was lent, not what it drew
    expect(pastProbeView.lastInput?.capabilities.history?.ended.map((lane) => lane.id)).toEqual([
      "past:claude:nat-early",
      "past:claude:nat-late",
    ]);
  });

  it("a desktop that keeps no record (the door's NOT_FOUND `no-record`) stays `absent`", async () => {
    const port = pastPort(() =>
      Promise.reject({
        rpc: {
          data: { kind: "NOT_FOUND", details: { service: "agent.monitor", state: "no-record" } },
        },
      }),
    );
    await mountPastProbe(Object.assign(fakeDoor(), { pastLanes: port }));
    expect(port.asks).toBe(1);
    expect(latest()).toMatchObject({ viewId: "past-probe", history: "absent", endedLanes: 0 });
    expect(pastProbeView.lastInput?.capabilities.history).toBeUndefined();
  });

  it("a record that cannot be read now says `unavailable` with no lanes; one read in part says `partial` with its lanes", async () => {
    const starting = pastPort(async () => ({
      ...PAST,
      state: "unavailable" as const,
      detail: "The agent index is starting",
      ended: [],
    }));
    await mountPastProbe(Object.assign(fakeDoor(), { pastLanes: starting }));
    expect(latest()).toMatchObject({ history: "unavailable", endedLanes: 0 });
    act(() => root?.unmount());
    container?.remove();
    const inPart = pastPort(async () => ({
      ...PAST,
      state: "partial" as const,
      detail: "The agent index's turns could not be read; these are its sessions' bounds.",
    }));
    await mountPastProbe(Object.assign(fakeDoor(), { pastLanes: inPart }));
    expect(latest()).toMatchObject({ history: "partial", endedLanes: 2 });
  });
});

// ---- TL — this desktop's mark on the stage ---------------------------------------
//
// The hook's rows (`godview-monitor-history.test.tsx`) hand it `here` as a prop.
// What only the stage can show is that `here` REALLY can come after the past:
// it is the roster's own row, else the board's first desktop
// (`useMonitorAgents`), each learned by an ask of its own, and nothing orders
// them before `agent.recordedLanes`' answer.

describe("the record's past on the stage (TL): this desktop's mark when its id comes after the past", () => {
  it("the past answers before the board opens: its lanes are unmarked, and marked the moment the board says which desktop is here — one read", async () => {
    let openBoard: () => void = () => undefined;
    const held = new Promise<void>((resolve) => {
      openBoard = resolve;
    });
    const base = fakeDoor();
    const port = pastPort(async () => PAST);
    const door: MonitorDoor = {
      ...base,
      pastLanes: port,
      // no roster on this door, and the board's open waits: nothing has said which desktop is here
      model: {
        ...base.model!,
        subscribe: async (onFrame, opts) => {
          await held;
          return base.model!.subscribe(onFrame, opts);
        },
      },
    };
    await mountPastProbe(door);
    const selves = () =>
      pastProbeView.lastInput?.capabilities.history?.ended.map((lane) => lane.device.self);
    expect(latest()).toMatchObject({ history: "complete", endedLanes: 2 });
    expect(selves()).toEqual([false, false]);
    await act(async () => openBoard());
    await settle();
    // both runs ended on this desktop (`PAST`'s lanes are `this-device`'s, the board's own id)
    expect(selves()).toEqual([true, true]);
    expect(port.asks).toBe(1);
  });
});

// ---- TL — one capabilities object across model publishes ------------------------
//
// The view redraws for a new `capabilities.history` (TIMELINE SHAPES v2 item 5),
// so a host that rebuilt what it lends on each model publish would cost every
// frame. The hook's own identity rows (`godview-monitor-history.test.tsx`: a
// re-read that moves nothing, the narrowing memo) cannot see the stage's half:
// `useMonitorAgents`' capabilities memo, which holds the spawn menu while the
// rows under it move, and the stage's memo that joins the past to it. Read at
// the prop the stage hands the view host (`viewHost.handed`), and again at the
// view's own input.

describe("the record's past on the stage (TL): one capabilities object across model publishes", () => {
  it("hands the view host the SAME capabilities — the spawn menu and the past with it — across two publishes that move the rows and not the past", async () => {
    const port = pastPort(async () => PAST);
    const door = Object.assign(tabDoor(), { pastLanes: port });
    await mountPastProbe(door);
    const lent = viewHost.handed.at(-1) as MonitorViewInput["capabilities"];
    // both halves are lent: the memo under test is not the empty object's
    expect(lent.spawn?.devices[0]?.state).toBe("ready");
    expect(lent.history?.ended).toHaveLength(2);
    expect(pastProbeView.lastInput?.capabilities).toBe(lent);
    const claudeSaying = (reply: string): AgentSessionSummary =>
      managedSummary({
        runtimeRunId: "run-claude",
        kind: "claude",
        label: "Claude",
        status: "working",
        profileSet: "work",
        cwd: "/project/vibe-field",
        lastAssistantText: reply,
      });
    const renders = viewHost.handed.length;
    const updates = pastProbeView.updates;
    const modelBefore = pastProbeView.lastInput?.model;
    for (const reply of ["one", "two"]) {
      await act(async () => door.push([claudeSaying(reply), ...TAB_ROWS.slice(1)]));
      await settle();
    }
    // the publishes rendered the stage and reached the view, whose model moved…
    const handed = viewHost.handed.slice(renders);
    expect(handed.length).toBeGreaterThanOrEqual(2);
    expect(pastProbeView.updates - updates).toBeGreaterThanOrEqual(2);
    expect(pastProbeView.lastInput?.model).not.toBe(modelBefore);
    // …and every render handed the host the object it had: nothing rebuilt
    expect(handed.every((capabilities) => capabilities === lent)).toBe(true);
    expect(pastProbeView.lastInput?.capabilities).toBe(lent);
    expect(pastProbeView.lastInput?.capabilities.history).toBe(lent.history);
    // and the door was read once: a publish is not an ask
    expect(port.asks).toBe(1);
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
/** A bud's centre in the field, from the geometry it was drawn with: the view's own
 * properties, `--mv-swarm-bloom-*` since MV-5 (L18; `--vf-bloom-*` before). */
const centreOf = (bud: HTMLElement | null): { x: number; y: number } => {
  if (bud === null) throw new Error("no such bud");
  const px = (name: string): number => Number.parseFloat(bud.style.getPropertyValue(name));
  const d = px("--mv-swarm-bloom-d");
  return { x: px("--mv-swarm-bloom-tx") + d / 2, y: px("--mv-swarm-bloom-ty") + d / 2 };
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

  it("chooses no profile on ⌥2 while a keys bloom has the keyboard (the stage binds no ⌥digit)", async () => {
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
    // whatever the bloom made of it, the chosen profile is still every profile
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

  it("puts the list's ＋ TERMINAL menu away when the window loses focus — W2's focus dismissal, named in MV-4", async () => {
    // The ported menu touches nothing outside its view (MV-W2): a press
    // elsewhere is heard as the focus leaving the menu, never through a
    // document listener. So the window losing focus — the browser blurs the
    // focused row with no element to go to — puts it away too, where the old
    // menu stayed open. Only VibeField opens this menu (its profiles feed
    // offers the choice), so only VibeField can see the change.
    const door = bloomDoor();
    const { host } = await mountBloom(door, "list");
    const menu = (): Element | null =>
      host.querySelector('[role="menu"][aria-label="New terminal"]');
    await act(async () => host.querySelector<HTMLButtonElement>(".vf-monitor-list-new")?.click());
    expect(menu()).not.toBeNull();
    const focused = document.activeElement;
    expect(focused === null ? false : menu()?.contains(focused)).toBe(true);
    await act(async () => {
      // what the browser does to the focused element when its window loses focus
      focused?.dispatchEvent(new FocusEvent("blur", { relatedTarget: null }));
      focused?.dispatchEvent(new FocusEvent("focusout", { bubbles: true, relatedTarget: null }));
      window.dispatchEvent(new FocusEvent("blur"));
    });
    expect(menu()).toBeNull();
    expect(door.createTerminal).not.toHaveBeenCalled();
  });
});

// ---- MV-W4 — the motion a view may make ------------------------------------
//
// A ported view's loop stops while the viewer asks for reduced motion, or
// while the stage's animations switch is off (GT-3p: the value the overlay
// hands `GodviewStage` from the lab's kill switch, and the catalog hands it
// off). The rain reads both off its input's theme and draws once per change
// instead (its own suite, puppeteer's `RainView.test.tsx`); what this stage
// owes it is the theme, from the view's first input. A recording view stands
// in for the rain: it keeps every input the view host hands it.

describe("MV-W4 — the motion a ported view may make", () => {
  function recordingEntry(): { entry: MonitorViewEntry; recording: RecordingView } {
    const recording = createRecordingView("motion-probe");
    return {
      recording,
      entry: {
        id: "motion-probe",
        label: "MOTION",
        mark: recording.view.manifest.mark,
        parameterGroups: [],
        view: recording.view,
      },
    };
  }

  async function renderUnder(
    entry: MonitorViewEntry,
    door: MonitorDoor,
    animations?: boolean,
  ): Promise<void> {
    await act(async () => {
      root?.render(
        <GodviewAgentsProvider door={door}>
          <GodviewMonitor
            view={entry}
            parameters={{}}
            door={door}
            panes={PANES}
            {...(animations !== undefined ? { animations } : {})}
          />
        </GodviewAgentsProvider>,
      );
    });
    await settle();
  }

  async function mountUnder(entry: MonitorViewEntry, animations?: boolean): Promise<MonitorDoor> {
    const door = fakeDoor();
    syncBoard(PANES);
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    await renderUnder(entry, door, animations);
    return door;
  }

  /** A media query the test answers, and changes. */
  function reducedMotionQuery(matches: boolean): { set(next: boolean): void } {
    const listeners = new Set<() => void>();
    const query = {
      get matches() {
        return matches;
      },
      media: "(prefers-reduced-motion: reduce)",
      addEventListener: (_type: string, listener: () => void) => listeners.add(listener),
      removeEventListener: (_type: string, listener: () => void) => listeners.delete(listener),
    };
    vi.stubGlobal("matchMedia", (media: string) =>
      media === query.media
        ? query
        : { matches: false, media, addEventListener() {}, removeEventListener() {} },
    );
    return {
      set(next) {
        matches = next;
        for (const listener of [...listeners]) listener();
      },
    };
  }

  it("hands the view a still theme from its first input while the stage's switch is off, and a moving one when it comes back on", async () => {
    reducedMotionQuery(false);
    const { entry, recording } = recordingEntry();
    const door = await mountUnder(entry, false);
    expect(recording.mounts).toBe(1);
    // the switch was off before the view mounted: its loop never starts
    expect(recording.inputs[0]?.theme).toMatchObject({ animations: false, reducedMotion: false });
    expect(recording.inputs.every((input) => input.theme.animations === false)).toBe(true);
    // the lab turns the switch back on while the stage stands
    await renderUnder(entry, door, true);
    expect(recording.mounts).toBe(1);
    expect(recording.lastInput?.theme).toMatchObject({ animations: true, reducedMotion: false });
  });

  it("moves by default: a host that hands no switch keeps today's motion", async () => {
    reducedMotionQuery(false);
    const { entry, recording } = recordingEntry();
    await mountUnder(entry);
    expect(recording.inputs[0]?.theme).toMatchObject({ animations: true, reducedMotion: false });
  });

  it("NAMED (MV-W4): the swarm holds still under reduced motion and moves again when it is let go — where the old swarm ran regardless", async () => {
    const query = reducedMotionQuery(true);
    const host = await mountMonitor("swarm");
    const swarm = (): Element | null => host.querySelector(".vf-monitor-swarm");
    expect(swarm()?.classList.contains("is-still")).toBe(true);
    await act(async () => query.set(false));
    await settle();
    expect(swarm()?.classList.contains("is-still")).toBe(false);
    await act(async () => query.set(true));
    await settle();
    expect(swarm()?.classList.contains("is-still")).toBe(true);
  });

  it("NAMED (MV-W4): the swarm holds still while the stage's animations switch is off", async () => {
    reducedMotionQuery(false);
    const entry = monitorViewFor("swarm");
    const door = await mountUnder(entry, false);
    const swarm = (): Element | null => container?.querySelector(".vf-monitor-swarm") ?? null;
    expect(swarm()?.classList.contains("is-still")).toBe(true);
    await renderUnder(entry, door, true);
    expect(swarm()?.classList.contains("is-still")).toBe(false);
  });

  it("hands the view the viewer's reduced motion, live: a change reaches it with nothing else moving", async () => {
    const query = reducedMotionQuery(true);
    const { entry, recording } = recordingEntry();
    await mountUnder(entry);
    expect(recording.inputs[0]?.theme).toMatchObject({ animations: true, reducedMotion: true });
    await act(async () => query.set(false));
    await settle();
    expect(recording.lastInput?.theme).toMatchObject({ animations: true, reducedMotion: false });
    await act(async () => query.set(true));
    await settle();
    expect(recording.lastInput?.theme).toMatchObject({ reducedMotion: true });
  });
});

// ---- M59 — VibeField's two swarm items ---------------------------------------
//
// The swarm keys a body by `visualId ?? id`, a window-local fact: a launcher's
// agent takes the fresh shell's body (the deck's `terminalVisualIds`), so the
// person sees one body across the handoff. VibeField hands it through the
// replica's local join, computed once per published model and the SAME map
// while no body moved (M64). And a create answers: the slot reads the host's
// fulfilment as opened and its rejection as a refusal (SB §2.6), so a birth
// waits for its row and gives up at once when nothing opened.

describe("M59 — the body a row continues, and a create that answers", () => {
  /** Every `setLocal` the window's replica was handed, read off the feed itself. */
  let joins: { visualIds?: ReadonlyMap<string, string> | undefined }[] = [];
  function JoinSpy(): null {
    const feed = useMonitorFeed();
    if (feed !== null && !vi.isMockFunction(feed.replica.setLocal)) {
      const setLocal = feed.replica.setLocal.bind(feed.replica);
      vi.spyOn(feed.replica, "setLocal").mockImplementation((local) => {
        joins.push(local);
        setLocal(local);
      });
    }
    return null;
  }

  async function renderSpied(
    entry: MonitorViewEntry,
    door: MonitorDoor | null,
    panes: MonitorPaneFacts,
  ): Promise<void> {
    syncBoard(panes);
    await act(async () => {
      root?.render(
        <GodviewAgentsProvider door={door}>
          <JoinSpy />
          <GodviewMonitor view={entry} parameters={{}} door={door} panes={panes} />
        </GodviewAgentsProvider>,
      );
    });
    await settle();
  }

  async function mountSpied(
    door: MonitorDoor | null,
    panes: MonitorPaneFacts = PANES,
  ): Promise<{ recording: RecordingView; entry: MonitorViewEntry }> {
    joins = [];
    const recording = createRecordingView("spatial-probe");
    const entry: MonitorViewEntry = {
      id: "spatial-probe",
      label: "SPATIAL",
      parameterGroups: [],
      mark: recording.view.manifest.mark,
      view: recording.view,
    };
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    await renderSpied(entry, door, panes);
    return { recording, entry };
  }

  const rowOf = (recording: RecordingView, id: string) => recording.lastInput?.model.byId.get(id);

  it("hands the view the shell's body for a launcher's agent, through the replica's join, and the same map while no body moved", async () => {
    const door = fakeDoor();
    const { recording, entry } = await mountSpied(door);
    // a managed agent's body is its pane's session; an unclaimed shell is its own row
    expect(rowOf(recording, "run-codex")?.visualId).toBe("run-codex-pty");
    expect(rowOf(recording, "pane-1")).toBeDefined();
    expect(rowOf(recording, "pane-1")?.visualId).toBeUndefined();
    const before = joins.at(-1)?.visualIds;
    expect(before?.get("run-codex")).toBe("run-codex-pty");

    // a state-only publish: the claude run goes idle, no body moves
    const calls = joins.length;
    const models = recording.inputs.length;
    door.push([
      managedSummary({
        runtimeRunId: "run-claude",
        kind: "claude",
        label: "Claude",
        status: "idle",
        cwd: "/project/vibe-field",
        createdAt: "2026-09-12T10:00:00.000Z",
      }),
      ...ROWS.slice(1),
    ]);
    await settle();
    expect(rowOf(recording, "run-claude")?.status).toBe("idle");
    expect(recording.inputs.length).toBeGreaterThan(models);
    // No window fact changed: the model still reaches the view, but the
    // replica is not handed identical local facts on every state/usage tick.
    expect(joins).toHaveLength(calls);
    expect(joins.at(-1)?.visualIds).toBe(before);

    // the launcher hands the shell's pane to the codex agent: the agent keeps the shell's body,
    // and the shell's own row speaks for no second body
    const handoff: MonitorPaneFacts = {
      ...PANES,
      terminalVisualIds: new Map([["run-codex-pty", "pane-1"]]),
    };
    await renderSpied(entry, door, handoff);
    expect(joins.at(-1)?.visualIds?.get("run-codex")).toBe("pane-1");
    expect(rowOf(recording, "run-codex")?.visualId).toBe("pane-1");
    expect(rowOf(recording, "pane-1")).toBeUndefined();
    expect(recording.mounts).toBe(1);
  });

  it("answers a view's create with the host's own outcome: opened, or refused at once", async () => {
    const door = fakeDoor();
    const { recording } = await mountSpied(door);
    const commands = recording.commands[0];
    if (commands === undefined) throw new Error("the view was handed no commands");
    let answer: { opened: boolean } | undefined;
    await act(async () => {
      answer = await commands.create({ x: 40, y: 50 });
    });
    expect(door.createTerminal).toHaveBeenCalledExactlyOnceWith();
    expect(answer).toEqual({ opened: true });

    door.createTerminal.mockResolvedValueOnce({
      state: "failed",
      reason: "terminal capacity reached",
    });
    await act(async () => {
      answer = await commands.create({ x: 40, y: 50 });
    });
    expect(answer).toEqual({ opened: false });
    expect(ackText(container as HTMLElement)).toBe(
      "terminal could not be opened — terminal capacity reached",
    );

    door.createTerminal.mockResolvedValueOnce({ state: "no-pane" });
    await act(async () => {
      answer = await commands.create();
    });
    expect(answer).toEqual({ opened: false });
  });

  it("refuses a create with no deck, in its own words", async () => {
    const { recording } = await mountSpied(null);
    let answer: { opened: boolean } | undefined;
    await act(async () => {
      answer = await recording.commands[0]?.create();
    });
    expect(answer).toEqual({ opened: false });
    expect(ackText(container as HTMLElement)).toBe(
      "no terminal can be opened yet — the deck has no connection",
    );
  });
});

// M49 / MV-8: the shipping chrome boundaries, with a real usage reader that
// throws in render. The model feed and mounted SDK view must survive it. A piece
// that heals waits for its boundary's window (the backoff): those rows hold the
// clock (`chrome-clock-fixture.ts`).
describe("a chrome read cannot take down the monitor", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("names the failed piece, keeps delivering the model, and heals on new facts", async () => {
    let broken = true;
    const failure = new Error("usage fixture lost its entries");
    const base = fakeDoor();
    const door: FakeDoor = {
      ...base,
      usage: {
        ...emptyUsage(),
        snapshot: async () => ({
          refreshedAt: CHECKED_AT,
          get entries() {
            if (broken) throw failure;
            return [];
          },
        }),
      },
    };
    const recording = createRecordingView("chrome-survivor");
    const entry: MonitorViewEntry = {
      id: recording.view.manifest.id,
      label: recording.view.manifest.label,
      mark: recording.view.manifest.mark,
      parameterGroups: [],
      view: recording.view,
    };
    syncBoard(PANES);
    container = document.createElement("div");
    document.body.appendChild(container);
    const uncaught = vi.fn();
    const caught = vi.fn();
    root = createRoot(container, { onUncaughtError: uncaught, onCaughtError: caught });
    await act(async () => {
      root?.render(
        <GodviewAgentsProvider door={door}>
          <GodviewMonitor view={entry} parameters={{}} door={door} panes={PANES} />
        </GodviewAgentsProvider>,
      );
    });
    await settle();
    expect(caught.mock.calls.some(([error]) => error === failure)).toBe(true);
    expect(uncaught).not.toHaveBeenCalled();
    expect(container.textContent).toContain("Usage unavailable");
    expect(container.querySelector(".vf-stories")).not.toBeNull();
    expect(recording.mounts).toBe(1);
    expect(recording.unmounts).toBe(0);
    const stage = recording.roots[0];
    expect(stage?.isConnected).toBe(true);
    const before = recording.updates;
    await act(async () =>
      door.push([managedSummary({ runtimeRunId: "surviving-run", cwd: "/project/survives" })]),
    );
    await settle();
    expect(recording.updates).toBeGreaterThan(before);
    expect(recording.lastInput?.model.agents.some((row) => row.project.name === "survives")).toBe(
      true,
    );
    expect(recording.roots[0]).toBe(stage);
    expect(recording.unmounts).toBe(0);
    expect(container.textContent).toContain("Usage unavailable");
    broken = false;
    // A model publish is not a fact the column reads: it stays down (M176)…
    await act(async () => door.push(ROWS));
    await settle();
    expect(container.textContent).toContain("Usage unavailable");
    // …until the door hands it a new port, which is one: tried at the end of the
    // boundary's first window at the latest.
    holdChromeClock();
    const healed: FakeDoor = { ...door, usage: { ...door.usage } };
    await act(async () => {
      root?.render(
        <GodviewAgentsProvider door={healed}>
          <GodviewMonitor view={entry} parameters={{}} door={healed} panes={PANES} />
        </GodviewAgentsProvider>,
      );
    });
    await settle();
    await advanceChromeClock();
    await settle();
    expect(container.textContent).not.toContain("Usage unavailable");
    expect(container.querySelector(".vf-usage-column")).not.toBeNull();
    expect(recording.mounts).toBe(1);
    expect(recording.unmounts).toBe(0);
    expect(uncaught).not.toHaveBeenCalled();
  });

  it("keeps a failed column down through 50 model publishes; new ports try it again at most once per window (M176, the backoff)", async () => {
    // The whole row on the held clock: the failure, the publishes and every new
    // port fall where the row puts them, never where the host's speed does.
    holdChromeClock();
    const failure = new Error("usage fixture lost its entries");
    // Each mount of the column asks its port for one snapshot: the count of
    // asks is the count of tries, and each try that reads the entries throws.
    let asked = 0;
    const brokenUsage = (): AccountUsagePort => ({
      subscribe: () => () => undefined,
      snapshot: async () => {
        asked += 1;
        return {
          refreshedAt: CHECKED_AT,
          get entries(): never {
            throw failure;
          },
        };
      },
    });
    const door: FakeDoor = { ...fakeDoor(), usage: brokenUsage() };
    const recording = createRecordingView("usage-under-publishes");
    const entry: MonitorViewEntry = {
      id: recording.view.manifest.id,
      label: recording.view.manifest.label,
      mark: recording.view.manifest.mark,
      parameterGroups: [],
      view: recording.view,
    };
    syncBoard(PANES);
    container = document.createElement("div");
    document.body.appendChild(container);
    const caught = vi.fn();
    const throws = (): number => caught.mock.calls.filter(([error]) => error === failure).length;
    root = createRoot(container, { onUncaughtError: vi.fn(), onCaughtError: caught });
    const renderWith = (held: FakeDoor): Promise<void> =>
      act(async () => {
        root?.render(
          <GodviewAgentsProvider door={held}>
            <GodviewMonitor view={entry} parameters={{}} door={held} panes={PANES} />
          </GodviewAgentsProvider>,
        );
      });
    await renderWith(door);
    await settle();
    expect([throws(), asked]).toEqual([1, 1]);
    expect(container.textContent).toContain("Usage unavailable");

    // Fifty publishes, each moving a row the view is handed.
    const updates = recording.updates;
    for (let publish = 0; publish < 50; publish += 1) {
      await act(async () =>
        door.push([
          managedSummary({
            runtimeRunId: "run-claude",
            kind: "claude",
            label: "Claude",
            status: publish % 2 === 0 ? "idle" : "working",
            cwd: "/project/vibe-field",
            createdAt: "2026-09-12T10:00:00.000Z",
          }),
          ...ROWS.slice(1),
        ]),
      );
      await settle();
    }
    expect(recording.updates - updates).toBeGreaterThanOrEqual(50);
    expect([throws(), asked]).toEqual([1, 1]);
    expect(container.textContent).toContain("Usage unavailable");

    // A new port is a new key, but inside the first window it waits…
    await renderWith({ ...door, usage: brokenUsage() });
    await settle();
    expect([throws(), asked]).toEqual([1, 1]);
    // …and the window's end tries it once, which fails the same way.
    await advanceChromeClock(CHROME_RETRY_FIRST_MS);
    await settle();
    expect([throws(), asked]).toEqual([2, 2]);

    // Three new ports inside the next window are one try, at its end, with the
    // port standing then. The column fails only after its first render (its
    // snapshot answers later), so each try renders, and a try that renders ends
    // the boundary's episode: the next window starts again at the first, 1 s,
    // where a piece that threw in the try's own render would double it.
    for (let port = 0; port < 3; port += 1) {
      await renderWith({ ...door, usage: brokenUsage() });
      await settle();
    }
    expect([throws(), asked]).toEqual([2, 2]);
    await advanceChromeClock(CHROME_RETRY_FIRST_MS / 2);
    await settle();
    expect([throws(), asked]).toEqual([2, 2]);
    await advanceChromeClock(CHROME_RETRY_FIRST_MS / 2);
    await settle();
    expect([throws(), asked]).toEqual([3, 3]);

    // One failure the whole time: one "unavailable", and the view never remounted.
    expect(container.querySelectorAll('.vf-monitor-chrome > span[role="status"]')).toHaveLength(1);
    expect(container.textContent).toContain("Usage unavailable");
    expect([recording.mounts, recording.unmounts]).toEqual([1, 0]);
  });

  it("a claim that throws says Agent counts unavailable inside the strip: the strip stays measured, the acknowledgement keeps its voice, and only a fact it states tries again", async () => {
    // The stage's chrome is measured: drive its observer by hand (happy-dom lays nothing out).
    const observed: Array<() => void> = [];
    vi.stubGlobal(
      "ResizeObserver",
      class {
        constructor(private readonly callback: ResizeObserverCallback) {
          observed.push(() => this.callback([], this as unknown as ResizeObserver));
        }
        observe(): void {}
        unobserve(): void {}
        disconnect(): void {}
      },
    );
    stripMark.throws = false;
    stripMark.tries = 0;
    const door = fakeDoor();
    // a desktop beside this one: the remote claim draws its mark
    const peerRows = (label: string) => [
      managedSummary({ runtimeRunId: "run-studio", kind: "codex", label, cwd: "/studio/x" }),
    ];
    board?.peer({ device: "studio", name: "Studio", platform: "darwin", rows: peerRows("Codex") });
    const recording = createRecordingView("claims-survivor");
    const entry: MonitorViewEntry = {
      id: recording.view.manifest.id,
      label: recording.view.manifest.label,
      mark: recording.view.manifest.mark,
      parameterGroups: [],
      view: recording.view,
    };
    syncBoard(PANES);
    container = document.createElement("div");
    document.body.appendChild(container);
    const uncaught = vi.fn();
    root = createRoot(container, { onUncaughtError: uncaught, onCaughtError: vi.fn() });
    await act(async () => {
      root?.render(
        <GodviewAgentsProvider door={door}>
          <GodviewMonitor view={entry} parameters={{}} door={door} panes={PANES} />
        </GodviewAgentsProvider>,
      );
    });
    await settle();
    const strip = container.querySelector<HTMLElement>(".vf-monitor-claims");
    expect(strip?.querySelector(".vf-monitor-remote-chip")?.textContent).toContain("1 agent on");

    // the strip's facts move (the peer's row) and its mark throws
    stripMark.throws = true;
    await act(async () =>
      board?.peer({
        device: "studio",
        name: "Studio",
        platform: "darwin",
        rows: peerRows("Codex·"),
      }),
    );
    await settle();
    expect(uncaught).not.toHaveBeenCalled();
    const status = container.querySelector('.vf-monitor-claims > span[role="status"]');
    expect(status?.textContent).toBe("Agent counts unavailable");
    expect(container.querySelector(".vf-monitor-claims")).toBe(strip);
    expect(strip?.querySelector(".vf-monitor-ack")).not.toBeNull();
    expect(container.querySelector(".vf-stories")).not.toBeNull();
    expect([recording.mounts, recording.unmounts]).toEqual([1, 0]);

    // The failure changes the strip's size, and the stage republishes its
    // geometry: that echo is no fact the claims state, so they are not tried.
    const tries = stripMark.tries;
    act(() => {
      for (const publish of observed) publish();
    });
    await settle();
    expect(stripMark.tries).toBe(tries);
    expect(container.querySelector('.vf-monitor-claims > span[role="status"]')).toBe(status);

    // a fact they state is: the claims come back, at the end of the boundary's
    // first window at the latest
    stripMark.throws = false;
    holdChromeClock();
    await act(async () =>
      board?.peer({
        device: "studio",
        name: "Studio",
        platform: "darwin",
        rows: peerRows("Codex"),
      }),
    );
    await settle();
    await advanceChromeClock();
    await settle();
    expect(container.querySelector('.vf-monitor-claims > span[role="status"]')).toBeNull();
    expect(strip?.querySelector(".vf-monitor-remote-chip")?.textContent).toContain("1 agent on");
    expect([recording.mounts, recording.unmounts]).toEqual([1, 0]);
  });
});
