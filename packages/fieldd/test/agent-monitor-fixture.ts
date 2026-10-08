import type { AgentMonitorState, MonitorNotification } from "@vibecook/puppeteer-core";
import type {
  MonitorClock,
  MonitorRuntimeSource,
  MonitorScheduler,
} from "@vibecook/puppeteer-monitor";
import { createMemoryProjectIdentityStore } from "@vibecook/puppeteer-monitor";
import {
  AGENT_CATALOG,
  type AgentListResult,
  type AgentProfileSet,
  type AgentSessionSummary,
  type AgentsProfileSetsListResult,
  createAgentCatalogReaders,
  type TerminalInfo,
} from "@vibefield/contracts";
import {
  type AgentMonitorDevices,
  type AgentMonitorFold,
  type AgentMonitorProfiles,
  type AgentMonitorService,
  type AgentMonitorTerminals,
  createAgentMonitorService,
} from "../src/agent-monitor";

// MV-3a — the monitor service on a scripted daemon: the fold's rows and the
// runtime's states come from `agent-field-summary.ts`'s fixtures (puppeteer's
// real shapes, once), the floor's inventory, the roster and the profiles feed
// are hand-driven, and the clock and the tick are the test's. Shared by the
// service's tests, the board's and the differential's.

export const T0 = Date.parse("2026-09-13T10:00:00.000Z");
/** The clock's start: after every stamp the fixtures carry (`stateChangedAt`
 * 10:05, the blockers' 10:04:30) and inside core's 30 s freshness window of the
 * evidence, so a state is neither in the backend's future nor stale at first
 * sight — a fixture whose turn finished AFTER the clock's now reads as a turn
 * that finished unseen, and the unread ledger marks it on the next tick. */
export const NOW0 = T0 + 5 * 60_000 + 10_000;

/** The runtime's live state for a fold row: its mirror IS core's projection
 * (the passthrough carries it verbatim), with the three collections the
 * fixtures leave out and the backend's derivations never read. */
export function stateOf(summary: AgentSessionSummary): AgentMonitorState {
  const mirror = summary.monitor;
  if (mirror === undefined) throw new Error(`${summary.runtimeRunId} has no mirror to be a state`);
  return {
    modes: { execution: "native-tui" },
    subagentCount: 0,
    subagents: [],
    compaction: { active: false, count: 0 },
    // core's state always carries a usage aggregate; the fixture's mirror has
    // one only when a token count was asked for
    usage: { samples: [] },
    ...(mirror as unknown as Record<string, unknown>),
  } as unknown as AgentMonitorState;
}

export interface ScriptedRuntime {
  runtime: MonitorRuntimeSource;
  /** the all-runs snapshot `monitorStates()` answers */
  states: Map<string, AgentMonitorState>;
  push(state: AgentMonitorState): void;
  remove(runtimeRunId: string, runtimeEpoch?: number): void;
  notify(notification: MonitorNotification): void;
}

export function scriptedRuntime(initial: readonly AgentMonitorState[] = []): ScriptedRuntime {
  const states = new Map(initial.map((state) => [state.runtimeRunId, state]));
  const stateListeners = new Set<(state: AgentMonitorState) => void>();
  const removedListeners = new Set<
    (runtimeRunId: string, removal: { readonly runtimeEpoch: number }) => void
  >();
  const noticeListeners = new Set<(notification: MonitorNotification) => void>();
  return {
    states,
    runtime: {
      monitorStates: () => [...states.values()],
      onMonitorState(listener) {
        stateListeners.add(listener);
        return () => stateListeners.delete(listener);
      },
      onMonitorNotification(listener) {
        noticeListeners.add(listener);
        return () => noticeListeners.delete(listener);
      },
      onMonitorRemoved(listener) {
        removedListeners.add(listener);
        return () => removedListeners.delete(listener);
      },
    },
    push(state) {
      states.set(state.runtimeRunId, state);
      for (const listener of [...stateListeners]) listener(state);
    },
    remove(runtimeRunId, runtimeEpoch = 1) {
      states.delete(runtimeRunId);
      for (const listener of [...removedListeners]) listener(runtimeRunId, { runtimeEpoch });
    },
    notify(notification) {
      for (const listener of [...noticeListeners]) listener(notification);
    },
  };
}

export interface ManualClock {
  clock: MonitorClock;
  advance(ms: number): void;
  now(): number;
}

export function manualClock(start = T0): ManualClock {
  let now = start;
  const tasks: Array<{ at: number; task: () => void; cancelled: boolean }> = [];
  return {
    clock: {
      now: () => now,
      schedule(delayMs, task) {
        const entry = { at: now + delayMs, task, cancelled: false };
        tasks.push(entry);
        return () => {
          entry.cancelled = true;
        };
      },
    },
    advance(ms) {
      const target = now + ms;
      for (;;) {
        const due = tasks
          .filter((entry) => !entry.cancelled && entry.at <= target)
          .sort((left, right) => left.at - right.at)[0];
        if (!due) break;
        tasks.splice(tasks.indexOf(due), 1);
        now = Math.max(now, due.at);
        due.task();
      }
      now = target;
    },
    now: () => now,
  };
}

export interface ManualScheduler {
  scheduler: MonitorScheduler;
  /** runs every queued tick */
  flush(): void;
  pending(): number;
}

export function manualScheduler(): ManualScheduler {
  const queue: Array<{ task: () => void; cancelled: boolean }> = [];
  return {
    scheduler: (task) => {
      const entry = { task, cancelled: false };
      queue.push(entry);
      return () => {
        entry.cancelled = true;
      };
    },
    flush() {
      while (queue.length > 0) {
        const entry = queue.shift();
        if (entry && !entry.cancelled) entry.task();
      }
    },
    pending: () => queue.filter((entry) => !entry.cancelled).length,
  };
}

export interface ScriptedFold extends AgentMonitorFold {
  /** the fold's next publish: rows replaced whole, every subscriber told */
  publish(rows: readonly AgentSessionSummary[]): void;
}

export function scriptedFold(initial: readonly AgentSessionSummary[] = []): ScriptedFold {
  let current: AgentListResult = { sessions: [...initial] };
  const subscribers = new Set<(rows: AgentListResult) => void>();
  return {
    list: () => current,
    subscribe(emit) {
      subscribers.add(emit);
      return () => subscribers.delete(emit);
    },
    publish(rows) {
      current = { sessions: [...rows] };
      for (const emit of [...subscribers]) emit(current);
    },
  };
}

export interface ScriptedTerminals extends AgentMonitorTerminals {
  /** the floor's next inventory; `undefined` = not observed yet */
  observe(rows: readonly TerminalInfo[] | undefined): void;
  bind(sessionId: string, profileSet: string): void;
}

export function scriptedTerminals(initial?: readonly TerminalInfo[]): ScriptedTerminals {
  let current: readonly TerminalInfo[] | undefined = initial;
  const bindings = new Map<string, string>();
  const listeners = new Set<(rows: readonly TerminalInfo[]) => void>();
  return {
    list: () => current,
    onInventory(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    profileSetOf: (sessionId) => bindings.get(sessionId),
    observe(rows) {
      current = rows;
      if (rows !== undefined) for (const listener of [...listeners]) listener(rows);
    },
    bind(sessionId, profileSet) {
      bindings.set(sessionId, profileSet);
    },
  };
}

export interface ScriptedDevices extends AgentMonitorDevices {
  rename(next: { id: string; name?: string; platform?: string }): void;
}

export function scriptedDevices(
  initial: { id: string; name?: string; platform?: string } = {
    id: "this-device",
    name: "Studio",
    platform: "darwin",
  },
): ScriptedDevices {
  let current = initial;
  const listeners = new Set<() => void>();
  return {
    current: () => current,
    onChanged(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    rename(next) {
      current = next;
      for (const listener of [...listeners]) listener();
    },
  };
}

export interface ScriptedProfiles extends AgentMonitorProfiles {
  /** the feed's next frame */
  publish(frame: AgentsProfileSetsListResult): void;
  /** how many times `sets()` was asked */
  reads: number;
}

/** A profiles feed whose first read answers `initial` (undefined = the read
 * never lands, so the menu stays `reading`). */
export function scriptedProfiles(initial?: AgentsProfileSetsListResult): ScriptedProfiles {
  const subscribers = new Set<(frame: AgentsProfileSetsListResult) => void>();
  const feed: ScriptedProfiles = {
    reads: 0,
    sets() {
      feed.reads += 1;
      return initial === undefined ? new Promise(() => undefined) : Promise.resolve(initial);
    },
    subscribe(emit) {
      subscribers.add(emit);
      return () => subscribers.delete(emit);
    },
    publish(frame) {
      for (const emit of [...subscribers]) emit(frame);
    },
  };
  return feed;
}

export function profileSetsFrame(sets: readonly AgentProfileSet[]): AgentsProfileSetsListResult {
  return {
    sets: [...sets],
    signIn: ["claude"],
    identity: ["claude"],
    signOut: ["claude"],
    reading: false,
    routes: [],
  } as unknown as AgentsProfileSetsListResult;
}

/** The native set with one signed-in Claude, as the profiles door answers it. */
export function nativeSet(overrides: Partial<AgentProfileSet> = {}): AgentProfileSet {
  return {
    id: "native",
    kind: "native",
    label: "This Mac",
    default: true,
    createdAt: "2026-09-01T00:00:00.000Z",
    personas: [
      {
        profileId: "claude-native",
        provider: "claude",
        label: "Claude Code",
        kind: "native-default",
        createdAt: "2026-09-01T00:00:00.000Z",
        identity: { loggedIn: true, verifiedAt: "2026-09-13T09:00:00.000Z" },
      },
    ],
    plans: [],
    ...overrides,
  };
}

export function floorTerminal(overrides: Partial<TerminalInfo> = {}): TerminalInfo {
  return {
    sessionId: "pty-bare",
    pid: 4242,
    createdAt: T0 - 30_000,
    cwd: "/Users/me/notes",
    title: "zsh",
    cell: { cellInstanceId: 1, cellBootId: "cell-1", workloadClass: "interactive" },
    ...overrides,
  };
}

export interface TestMonitor {
  service: AgentMonitorService;
  runtime: ScriptedRuntime;
  fold: ScriptedFold;
  terminals: ScriptedTerminals;
  devices: ScriptedDevices;
  profiles: ScriptedProfiles;
  clock: ManualClock;
  scheduler: ManualScheduler;
  identity: ReturnType<typeof createMemoryProjectIdentityStore>;
  /** runs the queued tick and answers the rows */
  rows(): readonly import("@vibecook/puppeteer-view-sdk/model").MonitorAgentRow[];
  /** the row for a run, after the tick */
  row(runtimeRunId: string): import("@vibecook/puppeteer-view-sdk/model").MonitorAgentRow;
}

export async function testMonitor(
  input: {
    summaries?: readonly AgentSessionSummary[];
    /** states for the runtime; by default every summary's mirror */
    states?: readonly AgentMonitorState[];
    terminals?: readonly TerminalInfo[] | undefined;
    profiles?: AgentsProfileSetsListResult | undefined;
    devices?: { id: string; name?: string; platform?: string };
  } = {},
): Promise<TestMonitor> {
  const summaries = input.summaries ?? [];
  const states =
    input.states ?? summaries.filter((row) => row.monitor !== undefined).map((row) => stateOf(row));
  const runtime = scriptedRuntime(states);
  const fold = scriptedFold(summaries);
  const terminals = scriptedTerminals(input.terminals);
  const devices = scriptedDevices(input.devices);
  const profiles = scriptedProfiles(input.profiles);
  const clock = manualClock(NOW0);
  const scheduler = manualScheduler();
  const identity = createMemoryProjectIdentityStore();
  const service = createAgentMonitorService({
    runtime: runtime.runtime,
    fold,
    terminals,
    devices,
    profiles,
    catalog: createAgentCatalogReaders(AGENT_CATALOG),
    identity,
    clock: clock.clock,
    scheduler: scheduler.scheduler,
  });
  await service.ready;
  // the profiles' first read lands on a microtask
  await Promise.resolve();
  const rows = () => {
    scheduler.flush();
    return service.snapshot().rows;
  };
  return {
    service,
    runtime,
    fold,
    terminals,
    devices,
    profiles,
    clock,
    scheduler,
    identity,
    rows,
    row(runtimeRunId) {
      rows();
      const row = service.rowForRun(runtimeRunId);
      if (row === undefined)
        throw new Error(
          `no model row for ${runtimeRunId}; the model holds ${service
            .snapshot()
            .rows.map((held) => held.id)
            .join(", ")}`,
        );
      return row;
    },
  };
}
