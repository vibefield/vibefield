import type { SessionSummary } from "@vibecook/ghosttea-protocol";
import type { AgentMonitorState, MonitorNotification } from "@vibecook/puppeteer-core";
import {
  createMemoryProjectIdentityStore,
  type MonitorRuntimeSource,
  type MonitorScheduler,
} from "@vibecook/puppeteer-monitor";
import {
  AGENT_CATALOG,
  AGENT_FIELD,
  type AgentDeskRow,
  type AgentListResult,
  type AgentModelBoardRow,
  type AgentModelMeshDevice,
  type AgentModelMeshFrame,
  type AgentModelMeshOpen,
  type AgentProfileSet,
  type AgentSessionSummary,
  type AgentsProfileSetsListResult,
  createAgentCatalogReaders,
  type RowsDeviceState,
  type TerminalInfo,
} from "@vibefield/contracts";
import { projectDeskRow } from "../../fieldd/src/agent-field";
import { ModelProjection } from "../../fieldd/src/agent-model-board";
import {
  type AgentMonitorFold,
  type AgentMonitorProfiles,
  type AgentMonitorService,
  type AgentMonitorTerminals,
  createAgentMonitorService,
} from "../../fieldd/src/agent-monitor";
import type { ModelBoardPort } from "../src/godview/monitor/remote-door";

/**
 * MV-3b — THE MODEL BOARD, STOOD UP IN A TEST: fieldd's hosted backend
 * (`agent-monitor.ts`) and its board projection (`agent-model-board.ts`), the
 * real ones, on scripted sources — the fold's rows, the floor's inventory, the
 * profiles feed — answering a fake door's model port exactly as the daemon
 * answers a window's: the open (this desktop first, then each peer's desk cut
 * with its model row), then one frame per change on this desktop's chain.
 *
 * A test that used to hand the fold rows to a fake `observe` hands the same
 * rows here (`publish`) and gets the backend's rows for them; the pane
 * sessions a test gives the deck are the floor's PTYs (`floor`). Peers are
 * other desktops' backends, each on its own fold (`peer`).
 *
 * Synchronous on purpose: the backend's tick is a manual scheduler flushed in
 * `publish`, and the board's frames are cut by the projection directly rather
 * than through `RevisionedSubscription`'s timer, so a frame reaches the window
 * inside the `act` that published it.
 */

export interface ScriptedPeer {
  device: string;
  name?: string;
  platform?: string;
  state?: RowsDeviceState;
  rows: readonly AgentSessionSummary[];
}

export interface ScriptedModelBoard {
  /** the door's model port, with a count of the boards opened and closed */
  port: ModelBoardPort;
  opened(): number;
  closed(): number;
  /** the reports the window made (`agent.reportShown`), in order */
  reports: string[][];
  /** the fold's next publish: this desktop's rows replaced whole, their mirrors as the runtime's states */
  publish(rows: readonly AgentSessionSummary[]): void;
  /** the floor's inventory: every live PTY (the deck's pane sessions, as PTYs) */
  floor(terminals: readonly TerminalInfo[]): void;
  /** SB-2 — a shell born under an Agent Profile: fieldd's binding for its PTY */
  bind(sessionId: string, profileSet: string): void;
  /** the Agent Profiles feed's next frame */
  profiles(sets: readonly AgentProfileSet[]): void;
  /** another desktop's board: its rows through its own backend, as its desk cut */
  peer(peer: ScriptedPeer): void;
  /** a desktop that left the board: the next open lists it no more */
  removePeer(device: string): void;
  /** a per-device frame to the live board (a state change, a peer's reset) */
  push(frame: AgentModelMeshFrame): void;
  /** the live board fails: the daemon refused the replay (S4) */
  fail(error: unknown): void;
  /** this desktop's model rows, after the tick */
  rows(): readonly AgentModelBoardRow[];
  service: AgentMonitorService;
  dispose(): void;
}

const HERE = "this-device";

/** The runtime's live state for a fold row: its mirror IS core's projection. */
export function stateOf(summary: AgentSessionSummary): AgentMonitorState {
  const mirror = summary.monitor;
  if (mirror === undefined) throw new Error(`${summary.runtimeRunId} has no mirror to be a state`);
  return {
    modes: { execution: "native-tui" },
    subagentCount: 0,
    subagents: [],
    compaction: { active: false, count: 0 },
    usage: { samples: [] },
    ...(mirror as unknown as Record<string, unknown>),
  } as unknown as AgentMonitorState;
}

/** A pane's session as the floor's inventory lists its PTY. */
export function terminalInfoOf(session: SessionSummary, workloadClass?: string): TerminalInfo {
  return {
    sessionId: session.id,
    createdAt: session.createdAtMs,
    ...(session.cwd ? { cwd: session.cwd } : {}),
    ...(session.title ? { title: session.title } : {}),
    cell: {
      cellInstanceId: 1,
      cellBootId: "cell-1",
      ...(workloadClass !== undefined ? { workloadClass } : {}),
    },
  } as TerminalInfo;
}

interface ScriptedRuntime {
  runtime: MonitorRuntimeSource;
  states: Map<string, AgentMonitorState>;
  set(rows: readonly AgentSessionSummary[]): void;
}

function scriptedRuntime(): ScriptedRuntime {
  const states = new Map<string, AgentMonitorState>();
  /** each run's last stamped revision, and the mirror it stamped */
  const revisions = new Map<string, { revision: number; body: string }>();
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
    // the fold's rows' mirrors become the runtime's states: a row that lost its
    // mirror, or left the fold, is a run the runtime removed
    set(rows) {
      const next = new Map<string, AgentMonitorState>();
      for (const row of rows) {
        if (row.monitor === undefined) continue;
        const base = stateOf(row);
        // the runtime stamps every change with a newer revision, and the store
        // takes nothing older (`isNewerMonitorRevision`): a fixture's mirror
        // re-sent CHANGED is stamped past the one before, as the runtime would
        const body = JSON.stringify(row.monitor);
        const held = revisions.get(row.runtimeRunId);
        const revision =
          held === undefined
            ? base.revision
            : held.body === body
              ? held.revision
              : Math.max(base.revision, held.revision + 1);
        revisions.set(row.runtimeRunId, { revision, body });
        next.set(row.runtimeRunId, revision === base.revision ? base : { ...base, revision });
      }
      for (const [runtimeRunId, state] of next) {
        const before = states.get(runtimeRunId);
        states.set(runtimeRunId, state);
        if (before !== state) for (const listener of [...stateListeners]) listener(state);
      }
      for (const runtimeRunId of [...states.keys()]) {
        if (next.has(runtimeRunId)) continue;
        states.delete(runtimeRunId);
        for (const listener of [...removedListeners]) listener(runtimeRunId, { runtimeEpoch: 1 });
      }
    },
  };
}

interface ScriptedFold extends AgentMonitorFold {
  publish(rows: readonly AgentSessionSummary[]): void;
}

function scriptedFold(): ScriptedFold {
  let current: AgentListResult = { sessions: [] };
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

interface ScriptedTerminals extends AgentMonitorTerminals {
  observe(rows: readonly TerminalInfo[]): void;
  bind(sessionId: string, profileSet: string): void;
}

function scriptedTerminals(): ScriptedTerminals {
  let current: readonly TerminalInfo[] | undefined;
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
      for (const listener of [...listeners]) listener(rows);
    },
    bind(sessionId, profileSet) {
      bindings.set(sessionId, profileSet);
    },
  };
}

interface ScriptedProfiles extends AgentMonitorProfiles {
  publish(sets: readonly AgentProfileSet[]): void;
}

function profileSetsFrame(sets: readonly AgentProfileSet[]): AgentsProfileSetsListResult {
  return {
    sets: [...sets],
    signIn: [],
    identity: [],
    signOut: [],
    reading: false,
    routes: [],
  } as unknown as AgentsProfileSetsListResult;
}

/** A profiles feed whose first read answers the initial sets at once (undefined: never — the menu stays `reading`). */
function scriptedProfiles(initial: readonly AgentProfileSet[] | undefined): ScriptedProfiles {
  const subscribers = new Set<(frame: AgentsProfileSetsListResult) => void>();
  return {
    sets: () =>
      initial === undefined
        ? new Promise<AgentsProfileSetsListResult>(() => undefined)
        : Promise.resolve(profileSetsFrame(initial)),
    subscribe(emit) {
      subscribers.add(emit);
      return () => subscribers.delete(emit);
    },
    publish(sets) {
      for (const emit of [...subscribers]) emit(profileSetsFrame(sets));
    },
  };
}

function manualScheduler(): { scheduler: MonitorScheduler; flush(): void } {
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
  };
}

interface HostedDesktop {
  service: AgentMonitorService;
  fold: ScriptedFold;
  runtime: ScriptedRuntime;
  terminals: ScriptedTerminals;
  profiles: ScriptedProfiles;
  flush(): void;
  dispose(): void;
}

function hostDesktop(
  device: { id: string; name?: string; platform?: string },
  profiles: readonly AgentProfileSet[] | undefined,
): HostedDesktop {
  const runtime = scriptedRuntime();
  const fold = scriptedFold();
  const terminals = scriptedTerminals();
  const feed = scriptedProfiles(profiles);
  const tick = manualScheduler();
  const service = createAgentMonitorService({
    runtime: runtime.runtime,
    fold,
    terminals,
    devices: { current: () => device, onChanged: () => () => undefined },
    profiles: feed,
    catalog: createAgentCatalogReaders(AGENT_CATALOG),
    identity: createMemoryProjectIdentityStore(),
    scheduler: tick.scheduler,
  });
  return {
    service,
    fold,
    runtime,
    terminals,
    profiles: feed,
    flush: () => tick.flush(),
    dispose: () => service.dispose(),
  };
}

export interface ScriptedModelBoardOptions {
  /** this desktop's fold rows at the open */
  rows?: readonly AgentSessionSummary[];
  /** the floor's PTYs at the open (the deck's pane sessions) */
  terminals?: readonly TerminalInfo[];
  /** the Agent Profiles the feed answers at once; undefined keeps the menu `reading` */
  profiles?: readonly AgentProfileSet[] | undefined;
  /** which shells were born under which Agent Profile (SB-2 bindings) */
  bindings?: ReadonlyMap<string, string>;
  device?: { id: string; name?: string; platform?: string };
  /** what the first `subscribe` does: answer the board, or throw this */
  refuse?: unknown;
  /** the n-th open's script, by position: throw this (a refusal, a lost ask),
   * or run this before answering (a peer gone, a peer back); null answers */
  opens?: ReadonlyArray<ScriptedOpen>;
}

export type ScriptedOpen = { throws: unknown } | { before: () => void } | null;

export function scriptedModelBoard(options: ScriptedModelBoardOptions = {}): ScriptedModelBoard {
  const device = options.device ?? { id: HERE, name: "This Mac", platform: "darwin" };
  const here = hostDesktop(device, options.profiles);
  for (const [sessionId, set] of options.bindings ?? []) here.terminals.bind(sessionId, set);
  if (options.terminals !== undefined) here.terminals.observe(options.terminals);
  here.fold.publish(options.rows ?? []);
  here.runtime.set(options.rows ?? []);
  here.flush();
  const projection = new ModelProjection();
  const epoch = "here.1";
  const sources = {
    fold: { list: () => here.fold.list(), subscribe: () => () => undefined },
    monitor: here.service,
  };
  projection.apply(sources);
  const peers = new Map<
    string,
    { hosted: HostedDesktop; state: RowsDeviceState; revision: number }
  >();
  let sink: ((payload: unknown, kind?: "snapshot" | "delta") => void) | null = null;
  let onReplayFailed: ((error: unknown) => void) | undefined;
  let opened = 0;
  let closed = 0;
  const reports: string[][] = [];
  const asOf = new Date().toISOString();

  const peerRows = (device: string): AgentDeskRow[] => {
    const held = peers.get(device);
    if (held === undefined) return [];
    held.hosted.flush();
    return held.hosted.fold.list().sessions.map(
      (summary, index) =>
        ({
          ...projectDeskRow(
            summary,
            AGENT_FIELD.DESK_TEXT_CHARS,
            held.hosted.service.rowForRun(summary.runtimeRunId),
          ),
          revision: index + 1,
        }) as AgentDeskRow,
    );
  };
  const open = (): AgentModelMeshOpen => {
    const snapshot = projection.snapshot();
    const devices: AgentModelMeshDevice[] = [
      { device: device.id, state: "live", asOf, snapshot: { ...snapshot, epoch } },
    ];
    for (const [peerDevice, held] of peers) {
      devices.push({
        device: peerDevice,
        state: held.state,
        asOf,
        snapshot: { epoch: `${peerDevice}.1`, revision: held.revision, rows: peerRows(peerDevice) },
      });
    }
    return { devices };
  };
  /** this desktop's board moved: cut the delta and send it on the chain */
  const emit = (): void => {
    here.flush();
    const delta = projection.apply(sources);
    if (delta === null || sink === null) return;
    sink({ device: device.id, delta: { ...delta, epoch } }, "delta");
  };
  // the backend's own changes (the 30 s step, recency) move the board too
  const offModel = here.service.subscribe(() => emit());

  const port: ModelBoardPort = {
    subscribe: async (onFrame, opts) => {
      opened += 1;
      if (options.refuse !== undefined && opened === 1) throw options.refuse;
      const script = options.opens?.[opened - 1];
      if (script !== null && script !== undefined) {
        if ("throws" in script) throw script.throws;
        script.before();
      }
      await here.service.ready;
      sink = onFrame;
      onReplayFailed = opts?.onReplayFailed;
      const mine = onFrame;
      return {
        snapshot: open(),
        unsubscribe: () => {
          closed += 1;
          if (sink === mine) sink = null;
        },
      };
    },
    reportShown: async (ids) => {
      reports.push([...ids]);
      return { reported: true };
    },
  };

  return {
    port,
    opened: () => opened,
    closed: () => closed,
    reports,
    service: here.service,
    publish(rows) {
      here.fold.publish(rows);
      here.runtime.set(rows);
      emit();
    },
    floor(terminals) {
      here.terminals.observe(terminals);
      emit();
    },
    bind(sessionId, profileSet) {
      here.terminals.bind(sessionId, profileSet);
      // a binding is read when the inventory is folded: re-announce the floor
      const listed = here.terminals.list();
      if (listed !== undefined) here.terminals.observe(listed);
      emit();
    },
    profiles(sets) {
      here.profiles.publish(sets);
      emit();
    },
    peer(peer) {
      let held = peers.get(peer.device);
      if (held === undefined) {
        held = {
          hosted: hostDesktop(
            { id: peer.device, name: peer.name ?? peer.device, platform: peer.platform ?? "linux" },
            [],
          ),
          state: peer.state ?? "live",
          revision: 0,
        };
        peers.set(peer.device, held);
      }
      held.state = peer.state ?? held.state;
      held.hosted.fold.publish(peer.rows);
      held.hosted.runtime.set(peer.rows);
      held.hosted.flush();
      held.revision += 1;
      sink?.(
        {
          device: peer.device,
          snapshot: {
            epoch: `${peer.device}.1`,
            revision: held.revision,
            rows: peerRows(peer.device),
          },
        },
        "delta",
      );
    },
    removePeer(device) {
      const held = peers.get(device);
      if (held === undefined) return;
      held.hosted.dispose();
      peers.delete(device);
    },
    push(frame) {
      sink?.(frame, "delta");
    },
    fail(error) {
      const failed = onReplayFailed;
      sink = null;
      failed?.(error);
    },
    rows() {
      here.flush();
      projection.apply(sources);
      return projection.snapshot().rows;
    },
    dispose() {
      offModel();
      sink = null;
      here.dispose();
      for (const held of peers.values()) held.hosted.dispose();
      peers.clear();
    },
  };
}
