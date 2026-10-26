// @vitest-environment happy-dom
/**
 * TV-8 (RULED 2026-10-11) — an ended lane opens its session in History: THE
 * JOIN. The view's half is puppeteer's (`dce6adb`: the optional fourth command
 * `openEnded`, read by its PRESENCE as a view mounts) and the host's half is
 * `openEndedLane` (`godview-open-ended-lane.test.tsx`). What only the STAGE can
 * show is that it hands the one to the other (`GodviewMonitor`'s `commands`):
 *
 * - from the FIRST render, before any past exists — with no door at all, and
 *   with a door whose past has not answered — so the view that mounts then is
 *   lent the command;
 * - as the module's OWN function: never a wrapper, never a placeholder — the
 *   prop is `openEndedLane` itself, and a call from the mounted view does what
 *   that function does (a refusal said before the past, the door asked after);
 * - on ONE commands object for the stage's life: model publishes, the past
 *   arriving and the past read again hand the view host the same object, and
 *   the view is never mounted twice (M195);
 * - and the real timeline view, mounted in the stage, offers an ended run as a
 *   control that opens it — the two halves meeting in one tree.
 *
 * Read at the prop the stage hands the view host (`viewHost.commands`, the
 * SDK's own host passed through) and at what the SDK's slot then gives the
 * mounted view. Times are NOW-relative: the past is read over a wall-clock day.
 */

import {
  AgentRecordedLanesResult,
  type FrameView,
  type FrameViewState,
} from "@vibefield/contracts";
import type { MonitorViewCommands } from "@vibefield/puppeteer-view-sdk";
import { createRecordingView, type RecordingView } from "@vibefield/puppeteer-view-sdk/testing";
import {
  type AccountUsagePort,
  type HistoryPort,
  type MonitorViewEntry,
  monitorParameterDefaults,
  monitorViewFor,
} from "@vibefield/puppeteer-views";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getStatusNotice, resetStatusLineForTest, statusLineSaid } from "../src/frame/status-line";
import { resetActiveViewForTest, subscribeActiveView } from "../src/frame/view-state";
import { GodviewMonitor } from "../src/godview/GodviewMonitor";
import type { AgentSessionSummary } from "../src/godview/monitor/facet-types";
import { GodviewAgentsProvider } from "../src/godview/monitor/GodviewAgentsProvider";
import {
  HISTORY_LEFT_DEBOUNCE_MS,
  type RecordedLanesPort,
} from "../src/godview/monitor/monitor-history";
import {
  openEndedLane,
  type RecordedSessionRow,
  resetOpenEndedLaneForTest,
} from "../src/godview/monitor/open-ended-lane";
import type { MonitorDoor } from "../src/godview/monitor/remote-door";
import { getHistoryOpenAt, resetHistoryOpenAtForTest } from "../src/history/open-at";
import { type FieldHost, setHost } from "../src/host";
import type { RendererLogger } from "../src/logging";
import { nextTask } from "./chrome-clock-fixture";
import { managedSummary } from "./managed-session-fixture";
import { type ScriptedModelBoard, scriptedModelBoard } from "./model-board-fixture";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/** Every `commands` object the stage hands the view host, in render order; the
 * host itself is the SDK's, passed through. */
const viewHost = vi.hoisted(() => ({ commands: [] as unknown[] }));
vi.mock("@vibefield/puppeteer-view-sdk/host", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@vibefield/puppeteer-view-sdk/host")>();
  return {
    ...actual,
    MonitorViewHost: (props: Parameters<typeof actual.MonitorViewHost>[0]) => {
      viewHost.commands.push(props.commands);
      return <actual.MonitorViewHost {...props} />;
    },
  };
});

/** The tint pair the palette reads (its fallback for both is 0, which is black). */
const TOKENS: Record<string, string> = { "--tint-l": "0.6", "--tint-c": "0.15" };

const HOUR = 60 * 60_000;
const NOW = Date.now();
const GONE = {
  id: "ended-lane:gone",
  text: "Could not open — this run is no longer in the timeline",
};

const claudeSaying = (reply: string): AgentSessionSummary =>
  managedSummary({
    runtimeRunId: "run-claude",
    kind: "claude",
    label: "Claude",
    status: "working",
    cwd: "/project/vibe-field",
    lastAssistantText: reply,
  });

const lane = (native: string, hoursAgo: number) => ({
  id: `past:claude:${native}`,
  provider: { id: "claude", label: "Claude Code" },
  project: { name: "billing-api", seq: 3 },
  device: { id: "this-device", name: "This Mac", os: "mac" },
  startedAt: NOW - (hoursAgo + 1) * HOUR,
  endedAt: NOW - hoursAgo * HOUR,
  spans: [{ kind: "bounds", from: NOW - (hoursAgo + 1) * HOUR, to: NOW - hoursAgo * HOUR }],
});

/** `agent.recordedLanes`' answer for the day: these runs ended in it. */
const pastOf = (...ended: ReturnType<typeof lane>[]): AgentRecordedLanesResult =>
  AgentRecordedLanesResult.parse({
    sinceMs: NOW - 24 * HOUR,
    untilMs: NOW,
    readAt: NOW,
    fidelity: "bounds",
    state: "complete",
    live: [],
    ended,
  });

/** The door's past: `read` answered by the row, the lookup's asks kept. */
interface FakePast extends RecordedLanesPort {
  reads: number;
  asks: string[][];
}

function pastPort(
  read: () => Promise<AgentRecordedLanesResult>,
  rows: readonly RecordedSessionRow[] = [],
): FakePast {
  const port: FakePast = {
    reads: 0,
    asks: [],
    read: () => {
      port.reads += 1;
      return read();
    },
    sessions: (nativeSessionIds) => {
      port.asks.push([...nativeSessionIds]);
      return Promise.resolve(rows);
    },
  };
  return port;
}

const CHECKED_AT = "2026-09-13T00:00:00.000Z";
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

let board: ScriptedModelBoard | null = null;
let root: Root | null = null;
let container: HTMLElement | null = null;
let stopView: (() => void) | undefined;
let publishView: ((state: FrameViewState) => void) | null = null;
/** What the frame asked the shell for, with the place History held at that moment. */
let viewAsked: Array<{ view: FrameView; place: ReturnType<typeof getHistoryOpenAt> }> = [];

/** The window is in `view`, as the shell says it. */
function frameIn(view: FrameView): void {
  publishView?.({ view } as FrameViewState);
}

/** A door over fieldd's real backend on these rows, with this past. */
function doorWith(pastLanes: RecordedLanesPort | undefined): MonitorDoor {
  board?.dispose();
  board = scriptedModelBoard({ rows: [claudeSaying("zero")] });
  return {
    model: board.port,
    attach: vi.fn(async () => ({ state: "attached" as const, sessionId: "r", readWrite: true })),
    createTerminal: vi.fn(async () => ({ state: "mounted" as const, sessionId: "born-1" })),
    mountLocal: vi.fn(async (sessionId: string) => ({ state: "mounted" as const, sessionId })),
    transcripts: unreachableHistory(),
    usage: emptyUsage(),
    ...(pastLanes === undefined ? {} : { pastLanes }),
  };
}

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

/** A view that declares the past, and remembers what the stage's slot gave it. */
function pastProbe(): { recording: RecordingView; entry: MonitorViewEntry } {
  const recording = createRecordingView("opens-probe", {
    manifest: { capabilities: { optional: ["history"] } },
  });
  return {
    recording,
    entry: {
      id: "opens-probe",
      label: "OPENS",
      mark: recording.view.manifest.mark,
      parameterGroups: [],
      view: recording.view,
    },
  };
}

async function mountStage(entry: MonitorViewEntry, door: MonitorDoor | null): Promise<HTMLElement> {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root?.render(
      <GodviewAgentsProvider door={door}>
        <GodviewMonitor
          view={entry}
          parameters={monitorParameterDefaults(entry.parameterGroups)}
          door={door}
        />
      </GodviewAgentsProvider>,
    );
  });
  await settle();
  return container;
}

/** The commands the SDK's slot gave the view at its one mount. */
const lentTo = (recording: RecordingView): MonitorViewCommands => {
  expect(recording.mounts).toBe(1);
  return recording.commands[0] as MonitorViewCommands;
};

beforeEach(() => {
  viewHost.commands.length = 0;
  viewAsked = [];
  resetActiveViewForTest();
  resetHistoryOpenAtForTest();
  resetStatusLineForTest();
  resetOpenEndedLaneForTest();
  for (const [name, value] of Object.entries(TOKENS)) {
    document.documentElement.style.setProperty(name, value);
  }
  // the monitor's marker line is the smoke's, not this file's
  vi.spyOn(console, "log").mockImplementation(() => undefined);
  publishView = null;
  setHost({
    logger: {} as RendererLogger,
    getConnection: () => Promise.resolve({ port: 1, token: "t" }),
    onPrepareClose: () => () => undefined,
    completeClose: () => undefined,
    platform: "darwin",
    view: {
      set: (next: FrameView) => {
        viewAsked.push({ view: next, place: getHistoryOpenAt() });
        return Promise.resolve({ view: next } as FrameViewState);
      },
      onState: (handler: (state: FrameViewState) => void) => {
        publishView = handler;
        return () => {
          publishView = null;
        };
      },
    },
  } as FieldHost);
  // the frame's own readers attach the mirror in the product; here the test does —
  // and the window is in Godview, where an ended lane is pressed
  stopView = subscribeActiveView(() => undefined);
  frameIn("godview");
});

afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  root = null;
  container = null;
  board?.dispose();
  board = null;
  stopView?.();
  resetStatusLineForTest();
  resetOpenEndedLaneForTest();
  for (const name of Object.keys(TOKENS)) document.documentElement.style.removeProperty(name);
  vi.restoreAllMocks();
});

describe("TV-8 — the stage lends its views the host's fourth command from the first render", () => {
  it("with no door at all: the first commands the view host is handed carry `openEndedLane` itself, and the view that mounts is lent the command", async () => {
    const { recording, entry } = pastProbe();
    await mountStage(entry, null);
    const first = viewHost.commands[0] as { openEnded?: unknown };
    expect(first.openEnded).toBe(openEndedLane);
    // the SDK's slot read its presence as the view mounted: a control, not an absence
    expect(typeof lentTo(recording).openEnded).toBe("function");
    // and no past exists here, nor ever will
    expect(recording.lastInput?.capabilities.history).toBeUndefined();
  });

  it("with a door whose past has not answered: the same, before any past is lent", async () => {
    const port = pastPort(() => new Promise<AgentRecordedLanesResult>(() => undefined));
    const { recording, entry } = pastProbe();
    await mountStage(entry, doorWith(port));
    expect(port.reads).toBe(1);
    expect(recording.inputs.every((input) => input.capabilities.history === undefined)).toBe(true);
    expect((viewHost.commands[0] as { openEnded?: unknown }).openEnded).toBe(openEndedLane);
    expect(typeof lentTo(recording).openEnded).toBe("function");
  });

  it("a view that declares no past is lent it too: the command is the host's to have, whatever the view draws", async () => {
    const recording = createRecordingView("plain-probe");
    const port = pastPort(async () => pastOf(lane("nat-late", 1)));
    await mountStage(
      {
        id: "plain-probe",
        label: "PLAIN",
        mark: recording.view.manifest.mark,
        parameterGroups: [],
        view: recording.view,
      },
      doorWith(port),
    );
    expect(port.reads).toBe(0);
    expect(typeof lentTo(recording).openEnded).toBe("function");
  });
});

describe("TV-8 — one commands object for the stage's life (M195)", () => {
  it("publishes that move the rows, the past arriving, and the past read again and moved hand the view host the SAME commands, `openEnded` the module's function each time — and the view is mounted once", async () => {
    let release: (answer: AgentRecordedLanesResult) => void = () => undefined;
    let reads = 0;
    const port = pastPort(() => {
      reads += 1;
      // the first read waits for the row; the next one finds a second run ended
      return reads === 1
        ? new Promise<AgentRecordedLanesResult>((resolve) => {
            release = resolve;
          })
        : Promise.resolve(pastOf(lane("nat-early", 3), lane("nat-late", 1)));
    });
    const { recording, entry } = pastProbe();
    const door = doorWith(port);
    await mountStage(entry, door);
    const first = viewHost.commands[0];
    const lent = lentTo(recording);

    // 1. two publishes that move the rows, before any past
    for (const reply of ["one", "two"]) {
      await act(async () => board?.publish([claudeSaying(reply)]));
      await settle();
    }
    // 2. the past arrives
    await act(async () => release(pastOf(lane("nat-late", 1))));
    await settle();
    expect(recording.lastInput?.capabilities.history?.ended.map((ended) => ended.id)).toEqual([
      "past:claude:nat-late",
    ]);
    // 3. and two more publishes with the past lent
    const before = viewHost.commands.length;
    const updates = recording.updates;
    for (const reply of ["three", "four"]) {
      await act(async () => board?.publish([claudeSaying(reply)]));
      await settle();
    }
    // the publishes rendered the stage and reached the view…
    expect(viewHost.commands.length - before).toBeGreaterThanOrEqual(2);
    expect(recording.updates - updates).toBeGreaterThanOrEqual(2);
    // 4. the row leaves: the past is read again within its second, and it has moved
    const lentBefore = recording.lastInput?.capabilities.history;
    await act(async () => board?.publish([]));
    await settle();
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, HISTORY_LEFT_DEBOUNCE_MS + 100));
    });
    await settle();
    expect(port.reads).toBe(2);
    expect(recording.lastInput?.capabilities.history).not.toBe(lentBefore);
    expect(recording.lastInput?.capabilities.history?.ended).toHaveLength(2);
    // …and every render handed the host the object it had: nothing rebuilt
    expect(viewHost.commands.every((commands) => commands === first)).toBe(true);
    expect((first as { openEnded?: unknown }).openEnded).toBe(openEndedLane);
    // the view kept the commands it mounted with, and was never mounted again
    expect(recording.mounts).toBe(1);
    expect(recording.unmounts).toBe(0);
    expect(recording.commands).toEqual([lent]);
  });
});

describe("TV-8 — the command the view is lent is the host's own, never a placeholder", () => {
  it("called before any past is lent it refuses as `openEndedLane` does, said on the status line, and nothing throws at the view", async () => {
    const port = pastPort(() => new Promise<AgentRecordedLanesResult>(() => undefined));
    const { recording, entry } = pastProbe();
    await mountStage(entry, doorWith(port));
    const openEnded = lentTo(recording).openEnded as (id: string) => void;
    expect(() => openEnded("past:claude:nat-late")).not.toThrow();
    expect(getStatusNotice()).toEqual(GONE);
    expect(port.asks).toEqual([]);
    expect(getHistoryOpenAt()).toBeNull();
    expect(viewAsked).toEqual([]);
  });

  it("called for a lane the stage lends: the door the past was read by is asked for the lane's native id, and History opens on rosetta's session — the place, then the view", async () => {
    const port = pastPort(
      async () => pastOf(lane("nat-early", 3), lane("nat-late", 1)),
      [{ sessionId: "ses-late", nativeSessionId: "nat-late", rootSessionId: "ses-late" }],
    );
    const { recording, entry } = pastProbe();
    await mountStage(entry, doorWith(port));
    expect(recording.lastInput?.capabilities.history?.ended).toHaveLength(2);
    // the view mounted BEFORE the past answered, and is lent the command all the same
    const openEnded = lentTo(recording).openEnded as (id: string) => void;
    await act(async () => openEnded("past:claude:nat-late"));
    await settle();
    expect(port.asks).toEqual([["nat-late"]]);
    expect(getHistoryOpenAt()).toEqual({ sessionId: "ses-late", timelineId: null });
    expect(viewAsked).toEqual([
      { view: "history", place: { sessionId: "ses-late", timelineId: null } },
    ]);
    expect(statusLineSaid()).toEqual([]);
  });
});

describe("TV-8 — the real timeline, mounted in the stage: the two halves meet", () => {
  it("an ended run in the reader's list is a button that says it opens in History, and pressing it opens that run's session", async () => {
    const port = pastPort(
      async () => pastOf(lane("nat-only", 1)),
      [{ sessionId: "ses-only", nativeSessionId: "nat-only", rootSessionId: "ses-only" }],
    );
    const host = await mountStage(monitorViewFor("timeline"), doorWith(port));
    const items = [...host.querySelectorAll(".vf-monitor-timeline-agents li")];
    const ended = items.filter((item) => (item.textContent ?? "").endsWith(", opens in History"));
    // one ended run lent, one control for it; the live row beside it says no such thing
    expect(ended).toHaveLength(1);
    expect(items.length).toBeGreaterThan(ended.length);
    const button = ended[0]?.querySelector("button");
    expect(button).toBeInstanceOf(HTMLButtonElement);
    await act(async () => button?.click());
    await settle();
    expect(port.asks).toEqual([["nat-only"]]);
    expect(getHistoryOpenAt()).toEqual({ sessionId: "ses-only", timelineId: null });
    expect(viewAsked.map((asked) => asked.view)).toEqual(["history"]);
    expect(statusLineSaid()).toEqual([]);
  });
});
