import type { SessionSummary } from "@vibecook/ghosttea-protocol";
import type { AgentMonitorState, MonitorNotification } from "@vibecook/puppeteer-core";
import {
  createMemoryProjectIdentityStore,
  createMonitorBackend,
  type MonitorBackend,
  type MonitorHostFacts,
  type MonitorHostProfileSet,
  type MonitorHostRun,
  type MonitorHostTerminal,
  type MonitorRuntimeSource,
  type MonitorScheduler,
  runtimeRunSource,
} from "@vibecook/puppeteer-monitor";
import type { DeviceOs, MonitorAgentRow } from "@vibecook/puppeteer-view-sdk/model";
import {
  AGENT_CATALOG,
  AGENT_FIELD,
  type AgentDeskTerminalRow,
  type AgentModelBoardRow,
  type AgentModelDeskRow,
  type AgentModelLocalFacts,
  type AgentModelMeshDevice,
  type AgentModelMeshOpen,
  type AgentProfileSet,
  type AgentSessionSummary,
  createAgentCatalogReaders,
  type RowsDeviceState,
  type MonitorAgentRow as WireMonitorRow,
} from "@vibefield/contracts";
import type { ModelBoardPort } from "../godview/monitor/remote-door";

/**
 * MV-3b — THE CATALOG'S MODEL BOARD: a fixture door's `model` port.
 *
 * Since MV-3b the Godview monitor draws the backend's rows through a replica
 * fed by the door's model port (`model-replica.ts`), so a fixture door with the
 * fold alone mounts an empty stage. This module stands the model board up in
 * the browser for the catalog (`docs/UI_SYSTEM.md`: the catalog mounts the
 * shipping view with a FIXTURE ADAPTER): puppeteer's real backend
 * (`@vibecook/puppeteer-monitor`, browser-safe) over the fixture's own fold rows,
 * one backend per desktop drawn, each cut to the board the window reads.
 *
 * FIXTURE-GRADE COPY (M37). What this is NOT: fieldd. The daemon hosts the
 * backend in `agent-monitor.ts` and cuts the board in `agent-model-board.ts` /
 * `agent-field.ts`; those are Node-only and the catalog may not import them (the
 * workspace taxonomy keeps `@vibefield/fieldd` test-only here). The three
 * mappings below are the catalog's COPIES of fieldd's rules, each naming its
 * source, and `test/godview-catalog-model-fixture.test.ts` runs them and fieldd's
 * real mapping over the same fixture rows and asserts the model rows are equal,
 * so a drift fails a test rather than waiting for an eye. The product's truth is
 * `test/godview-model-differential.test.tsx`, which drives fieldd's own backend.
 * The clean end (a shared browser-safe home for fieldd's pure helpers) is a
 * taxonomy question for James, not this lane's.
 */

export interface CatalogDesktop {
  id: string;
  name: string;
  /** `process.platform`'s word (`darwin` · `linux` · `win32`), as the roster says it */
  platform: string;
}

export interface CatalogPeer {
  device: CatalogDesktop;
  state: RowsDeviceState;
  /** the peer's fold rows, as ITS daemon would hold them; empty for a desktop with no board */
  rows: readonly AgentSessionSummary[];
}

export interface CatalogModelBoardOptions {
  device: CatalogDesktop;
  /** this desktop's fold rows */
  rows: readonly AgentSessionSummary[];
  /** the Agent Profiles the feed answers; undefined keeps the menu `reading` */
  profiles?: readonly AgentProfileSet[] | undefined;
  /** other desktops on the board, each on its own backend */
  peers?: readonly CatalogPeer[] | undefined;
}

export interface CatalogModelBoard {
  /** the fixture door's `model` */
  port: ModelBoardPort;
  /** SB-3 — a bare terminal born here: listed on the floor, bound to its profile */
  born(session: SessionSummary, profileSet?: string): void;
  dispose(): void;
}

// ── the catalog's readings of fieldd's rules ─────────────────────────────────

/** `agent-monitor.ts` `deviceOsOf`: the roster's platform as the SDK's OS word. */
function deviceOsOf(platform: string): DeviceOs | undefined {
  if (platform === "darwin") return "mac";
  if (platform === "linux") return "linux";
  if (platform === "win32") return "windows";
  return undefined;
}

function epochMs(iso: string | undefined): number | undefined {
  if (iso === undefined) return undefined;
  const ms = Date.parse(iso);
  return Number.isFinite(ms) ? ms : undefined;
}

/** `agent-monitor.ts` `hostRunFromSummary`: one fold row as the backend's host record. */
function hostRunOf(summary: AgentSessionSummary): MonitorHostRun {
  const exited = summary.continuation?.exited === true;
  const terminal = summary.terminal;
  const pty = terminal?.hosted === "local" ? terminal.runtimeSessionId : undefined;
  const alive = exited
    ? false
    : summary.monitor === undefined
      ? terminal !== undefined && terminal.hosted !== "none"
      : undefined;
  const projectKey = summary.workspace?.root || summary.workspace?.sourcePath || undefined;
  const workspace = summary.workspace;
  return {
    runtimeRunId: summary.runtimeRunId,
    createdAt: epochMs(summary.createdAt) ?? 0,
    provider: {
      id: summary.kind,
      label: summary.label.trim() === "" ? summary.kind : summary.label,
    },
    ...(pty !== undefined && !exited ? { terminalSessionId: pty } : {}),
    ...(terminal?.replaced !== undefined ? { replacedTerminalSessionId: terminal.replaced } : {}),
    ...(projectKey !== undefined ? { projectKey } : {}),
    ...(workspace !== undefined
      ? {
          workspace: {
            ...(workspace.root !== undefined ? { root: workspace.root } : {}),
            ...(workspace.sourcePath !== undefined ? { sourcePath: workspace.sourcePath } : {}),
            ...(workspace.branch !== undefined ? { branch: workspace.branch } : {}),
          },
        }
      : {}),
    ...(summary.profileId !== undefined ? { profileId: summary.profileId } : {}),
    ...(summary.profileSet !== undefined ? { profileSet: summary.profileSet } : {}),
    tier: summary.tier,
    ...(summary.continuation?.pending !== undefined
      ? { pending: summary.continuation.pending }
      : {}),
    ...(alive !== undefined ? { alive } : {}),
    nativeSessionId: summary.sessionId,
  };
}

/** `agent-monitor.ts` `hostTerminalFrom`: a floor PTY as the backend's host record.
 * fieldd's inventory knows a PTY's cwd and title but not its activity (M28: that is
 * the window's join), so none travels here either. */
function hostTerminalOf(
  session: SessionSummary,
  profileSet: string | undefined,
): MonitorHostTerminal {
  return {
    sessionId: session.id,
    createdAt: session.createdAtMs,
    ...(session.cwd ? { cwd: session.cwd } : {}),
    ...(session.title ? { title: session.title } : {}),
    ...(profileSet !== undefined ? { profileSet } : {}),
  };
}

const catalog = createAgentCatalogReaders(AGENT_CATALOG);

/** `agent-monitor.ts` `hostProfileSetFrom`: an Agent Profile as the backend's host record. */
function hostProfileSetOf(set: AgentProfileSet): MonitorHostProfileSet {
  return {
    id: set.id,
    label: set.label,
    kind: set.kind,
    ...(set.glyph !== undefined ? { glyph: set.glyph } : {}),
    isDefault: set.default,
    personas: set.personas.map((persona) => ({
      profileId: persona.profileId,
      providerLabel: catalog.entry(persona.provider)?.label ?? persona.provider,
      ...(persona.identity?.loggedIn !== undefined ? { loggedIn: persona.identity.loggedIn } : {}),
    })),
  };
}

/** A fold row's mirror as the runtime's state: the mirror IS core's projection (the test fixture's `stateOf`). */
function stateOf(summary: AgentSessionSummary): AgentMonitorState | undefined {
  const mirror = summary.monitor;
  if (mirror === undefined) return undefined;
  return {
    modes: { execution: "native-tui" },
    subagentCount: 0,
    subagents: [],
    compaction: { active: false, count: 0 },
    usage: { samples: [] },
    ...(mirror as unknown as Record<string, unknown>),
  } as unknown as AgentMonitorState;
}

// ── one desktop's backend ────────────────────────────────────────────────────

interface HostedDesktop {
  backend: MonitorBackend;
  /** runs a pending tick now: the rows are current after it */
  flush(): void;
  publish(rows: readonly AgentSessionSummary[]): void;
  born(session: SessionSummary, profileSet: string | undefined): void;
  rows(): readonly AgentSessionSummary[];
  dispose(): void;
}

function hostDesktop(
  device: CatalogDesktop,
  initial: readonly AgentSessionSummary[],
  profiles: readonly AgentProfileSet[] | undefined,
): HostedDesktop {
  let rows = initial;
  const terminals: SessionSummary[] = [];
  const bindings = new Map<string, string>();

  // the runtime: every mirror a state, re-sent on each publish
  const states = new Map<string, AgentMonitorState>();
  const stateListeners = new Set<(state: AgentMonitorState) => void>();
  const removedListeners = new Set<
    (id: string, removal: { readonly runtimeEpoch: number }) => void
  >();
  const runtime: MonitorRuntimeSource = {
    monitorStates: () => [...states.values()],
    onMonitorState(listener) {
      stateListeners.add(listener);
      return () => stateListeners.delete(listener);
    },
    onMonitorNotification(_listener: (notification: MonitorNotification) => void) {
      return () => undefined;
    },
    onMonitorRemoved(listener) {
      removedListeners.add(listener);
      return () => removedListeners.delete(listener);
    },
  };
  const setStates = (): void => {
    const next = new Map<string, AgentMonitorState>();
    for (const row of rows) {
      const state = stateOf(row);
      if (state !== undefined) next.set(row.runtimeRunId, state);
    }
    for (const [id, state] of next) {
      states.set(id, state);
      for (const listener of [...stateListeners]) listener(state);
    }
    for (const id of [...states.keys()]) {
      if (next.has(id)) continue;
      states.delete(id);
      for (const listener of [...removedListeners]) listener(id, { runtimeEpoch: 1 });
    }
  };
  setStates();

  // the host: pull with notify
  let facts: MonitorHostFacts | null = null;
  const hostListeners = new Set<() => void>();
  const wake = (): void => {
    facts = null;
    for (const listener of [...hostListeners]) listener();
  };
  // The tick: one emission per microtask turn (the backend's default is a
  // macrotask), and `flush()` runs a pending tick NOW — the backend's `ready`
  // only schedules its first recompute, and the board is read right after it.
  let pending: (() => void) | null = null;
  const run = (): void => {
    const task = pending;
    pending = null;
    task?.();
  };
  const scheduler: MonitorScheduler = (task) => {
    pending = task;
    queueMicrotask(run);
    return () => {
      if (pending === task) pending = null;
    };
  };

  const os = deviceOsOf(device.platform);
  const backend = createMonitorBackend({
    runs: runtimeRunSource(runtime),
    host: {
      getFacts() {
        facts ??= {
          device: {
            id: device.id,
            name: device.name,
            ...(os !== undefined ? { os } : {}),
            self: true,
          },
          runs: rows.map(hostRunOf),
          terminals: terminals.map((session) => hostTerminalOf(session, bindings.get(session.id))),
          profileSets: profiles === undefined ? null : profiles.map(hostProfileSetOf),
        };
        return facts;
      },
      subscribe(listener) {
        hostListeners.add(listener);
        return () => hostListeners.delete(listener);
      },
    },
    identity: createMemoryProjectIdentityStore(),
    // the catalog's verbs are the door's (`createTerminal`, `mountLocal`); nothing reaches this sink
    sink: { select: () => undefined, create: () => undefined },
    // VibeField's readings, as fieldd passes them (M15, M17)
    cost: { acrossEpochs: "current" },
    unobservedAgents: "row",
    scheduler,
  });

  return {
    backend,
    flush: run,
    publish(next) {
      rows = next;
      setStates();
      wake();
    },
    born(session, profileSet) {
      terminals.push(session);
      if (profileSet !== undefined) bindings.set(session.id, profileSet);
      wake();
    },
    rows: () => rows,
    dispose: () => backend.dispose(),
  };
}

// ── the board's cut ──────────────────────────────────────────────────────────

/** `agent-field.ts` `boundText`: a text at most `chars` code points long, the last one an ellipsis. */
function boundText(text: string, chars: number): string {
  if (text.length <= chars) return text;
  const long = text.length > chars * 2;
  const points = Array.from(long ? text.slice(0, chars * 2) : text);
  if (!long && points.length <= chars) return text;
  return `${points.slice(0, chars - 1).join("")}…`;
}

/**
 * `agent-field.ts` `windowMonitorRow` / `peerMonitorRow`: the SDK's row as the wire
 * carries it. `device.self` is the reader's fact and never travels (the window's
 * fold joins it back); this desktop's own row is otherwise whole, and a PEER's
 * carries no colour sequence (M16) with every text bounded at the desk's bound
 * (M21). The shapes mirror field for field (fieldd parses real backend rows
 * through the contract).
 */
function wireRowOf(row: MonitorAgentRow, peer: boolean): WireMonitorRow {
  const { self: _self, ...device } = row.device;
  if (!peer) return { ...row, device } as unknown as WireMonitorRow;
  const chars = AGENT_FIELD.DESK_TEXT_CHARS;
  const { seq: _seq, ...project } = row.project;
  const bound = (text: string | undefined): string | undefined =>
    text === undefined ? undefined : boundText(text, chars);
  const { activity, wait, reply } = row;
  return {
    ...row,
    device,
    project,
    detail: boundText(row.detail, chars),
    ...(activity !== undefined
      ? {
          activity: {
            ...activity,
            ...(activity.line !== undefined ? { line: boundText(activity.line, chars) } : {}),
          },
        }
      : {}),
    ...(wait !== undefined
      ? {
          wait: {
            ...wait,
            ...(wait.header !== undefined ? { header: bound(wait.header) } : {}),
            ...(wait.question !== undefined ? { question: bound(wait.question) } : {}),
            ...(wait.detail !== undefined ? { detail: bound(wait.detail) } : {}),
          },
        }
      : {}),
    ...(reply !== undefined ? { reply: { ...reply, text: boundText(reply.text, chars) } } : {}),
  } as unknown as WireMonitorRow;
}

/** `agent-field.ts` `localFactsOf` (MV-3d): the fold's facts this desktop's window reads
 * beside the model — the chrome's (the find sheet's join and clocks, the marker's, the pane
 * frame's) — on this desktop's rows only, never a peer's. */
function localFactsOf(summary: AgentSessionSummary): AgentModelLocalFacts {
  const monitor = summary.monitor;
  const cwd =
    monitor?.environment?.cwd || summary.workspace?.sourcePath || summary.workspace?.root || "";
  const startedAt = monitor?.session?.startedAt;
  const lastEvidenceAt = monitor?.freshness?.lastEvidenceAt;
  const contextSource = (monitor?.context as { percentageSource?: unknown } | undefined)
    ?.percentageSource;
  return {
    nativeSessionId: summary.sessionId,
    ...(cwd !== "" ? { cwd } : {}),
    ...(summary.spawnedBy !== undefined ? { spawnedBy: summary.spawnedBy } : {}),
    ...(summary.continuation?.exited === true ? { exited: true } : {}),
    ...(monitor !== undefined
      ? {
          mirror: {
            alive: monitor.alive,
            ...(startedAt !== undefined ? { startedAt } : {}),
            ...(lastEvidenceAt !== undefined ? { lastEvidenceAt } : {}),
            ...(typeof contextSource === "string" ? { contextSource } : {}),
          },
        }
      : {}),
  };
}

/** `agent-field.ts` `projectDeskRow`, as far as the window reads a board row: the key, the
 * PTY join, the model row, and (this desktop's rows) the chrome's facts; the rest only
 * parses. */
function boardRowsOf(
  desk: HostedDesktop,
  device: CatalogDesktop,
  peer: boolean,
): AgentModelBoardRow[] {
  desk.flush();
  const snapshot = desk.backend.getSnapshot();
  const byId = new Map(snapshot.rows.map((row) => [row.id, row] as const));
  const claimed = new Set<string>();
  const rows: AgentModelBoardRow[] = [];
  for (const summary of desk.rows()) {
    const id = desk.backend.idOf(summary.runtimeRunId);
    const row = id === undefined ? undefined : byId.get(id);
    if (id === undefined || row === undefined) continue;
    claimed.add(id);
    const monitorRow = wireRowOf(row, peer);
    const since = summary.monitor?.statusSince ?? summary.stateChangedAt ?? summary.createdAt;
    const desk_: AgentModelDeskRow = {
      runtimeRunId: summary.runtimeRunId,
      revision: snapshot.revision,
      kind: summary.kind,
      label: summary.label,
      tier: summary.tier,
      device: device.id,
      ...(summary.profileId !== undefined ? { profileId: summary.profileId } : {}),
      status: summary.status,
      statusSince: since,
      stateChangedAt: summary.stateChangedAt ?? summary.createdAt,
      createdAt: summary.createdAt,
      alive: row.alive,
      ...(summary.continuation?.pending !== undefined
        ? { pending: summary.continuation.pending }
        : {}),
      blockers: [],
      project: {
        name: row.project.name,
        ...(row.project.branch !== undefined ? { branch: row.project.branch } : {}),
      },
      ...(summary.terminal !== undefined ? { terminal: summary.terminal } : {}),
      monitorRow,
      ...(peer ? {} : { local: localFactsOf(summary) }),
    };
    rows.push(desk_);
  }
  for (const row of snapshot.rows) {
    if (row.kind !== "terminal" || claimed.has(row.id)) continue;
    const terminal: AgentDeskTerminalRow = {
      runtimeRunId: row.id,
      revision: snapshot.revision,
      kind: "terminal",
      device: device.id,
      terminal: { hosted: "local", runtimeSessionId: row.id },
      monitorRow: wireRowOf(row, peer),
    };
    rows.push(terminal);
  }
  return rows;
}

// ── the board ────────────────────────────────────────────────────────────────

export function catalogModelBoard(options: CatalogModelBoardOptions): CatalogModelBoard {
  const here = hostDesktop(options.device, options.rows, options.profiles);
  const peers = (options.peers ?? []).map((peer) => ({
    ...peer,
    hosted: peer.rows.length === 0 ? null : hostDesktop(peer.device, peer.rows, undefined),
  }));
  const revisions = new Map<string, number>();
  const revision = (device: string): number => {
    const next = (revisions.get(device) ?? 0) + 1;
    revisions.set(device, next);
    return next;
  };
  let sink: ((payload: unknown, kind?: "snapshot" | "delta") => void) | null = null;
  let screen: string | null = null;
  let opened = 0;

  const deviceOpen = (
    desk: HostedDesktop | null,
    device: CatalogDesktop,
    state: RowsDeviceState,
    peer: boolean,
  ): AgentModelMeshDevice => ({
    device: device.id,
    state,
    asOf: new Date().toISOString(),
    ...(desk === null
      ? {}
      : {
          snapshot: {
            epoch: `${device.id}.catalog`,
            revision: revision(device.id),
            rows: boardRowsOf(desk, device, peer),
          },
        }),
  });
  /** a desktop's board moved: its rows again, whole (the fold replaces that desktop's) */
  const push = (desk: HostedDesktop, device: CatalogDesktop, peer: boolean): void => {
    if (sink === null) return;
    sink(
      {
        device: device.id,
        snapshot: {
          epoch: `${device.id}.catalog`,
          revision: revision(device.id),
          rows: boardRowsOf(desk, device, peer),
        },
      },
      "delta",
    );
  };
  const offChanges = [
    here.backend.subscribe(() => push(here, options.device, false)),
    ...peers.flatMap((peer) =>
      peer.hosted === null
        ? []
        : [peer.hosted.backend.subscribe(() => push(peer.hosted!, peer.device, true))],
    ),
  ];

  const port: ModelBoardPort = {
    subscribe: async (onFrame) => {
      opened += 1;
      await here.backend.ready;
      for (const peer of peers) if (peer.hosted !== null) await peer.hosted.backend.ready;
      sink = onFrame;
      const mine = onFrame;
      // L5 — the board is this window's screen: opened with it, forgotten with it
      const mineScreen = `catalog-screen-${opened}`;
      here.backend.reportShown(mineScreen, []);
      screen = mineScreen;
      const open: AgentModelMeshOpen = {
        devices: [
          deviceOpen(here, options.device, "live", false),
          ...peers.map((peer) => deviceOpen(peer.hosted, peer.device, peer.state, true)),
        ],
      };
      return {
        snapshot: open,
        unsubscribe: () => {
          if (sink === mine) sink = null;
          if (screen === mineScreen) screen = null;
          here.backend.forgetScreen(mineScreen);
        },
      };
    },
    reportShown: async (ids) => {
      if (screen === null) return { reported: false };
      here.backend.reportShown(screen, ids);
      return { reported: true };
    },
  };

  return {
    port,
    born: (session, profileSet) => here.born(session, profileSet),
    dispose() {
      for (const off of offChanges) off();
      sink = null;
      here.dispose();
      for (const peer of peers) peer.hosted?.dispose();
    },
  };
}
