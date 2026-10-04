import {
  createMonitorBackend,
  type MonitorBackend,
  type MonitorClock,
  type MonitorHostFacts,
  type MonitorHostPort,
  type MonitorHostProfileSet,
  type MonitorHostRun,
  type MonitorHostTerminal,
  type MonitorRuntimeSource,
  type MonitorScheduler,
  type ProjectIdentityStore,
  runtimeRunSource,
} from "@vibecook/puppeteer-monitor";
import type {
  DeviceOs,
  MonitorAgentRow,
  MonitorDeviceRef,
  MonitorModelChange,
  MonitorModelSnapshot,
} from "@vibecook/puppeteer-view-sdk/model";
import type {
  AgentCatalogReaders,
  AgentListResult,
  AgentProfileSet,
  AgentSessionSummary,
  AgentSessionTerminal,
  AgentsProfileSetsListResult,
  TerminalInfo,
} from "@vibefield/contracts";
import { createNoopLogger, type Logger } from "@vibefield/logging";

// MV-3a (MV-D22, MV-D18) — THE MONITOR BACKEND, BESIDE THE RUNTIME.
//
// One backend per desktop computes every business fact about this desktop's
// agents once (`@vibecook/puppeteer-monitor`'s `createMonitorBackend`): the run
// table from puppeteer's push bus, recency, the ten-minute cost window, unread,
// project identity, the spawn menu. Until now each window derived all of that
// again from the fold's `full` rows, and fieldd a third time for peers and the
// phone (design-mv §1.1). This module is fieldd's HOST half of the backend —
// what only the daemon knows and the runtime does not:
//
//   · the per-run facts, read off the fold's own rows (`AgentSessionSummary`):
//     the PTY join, the project's root, the profile, the continuation's
//     pending and exit, liveness as fieldd knows it;
//   · the bare terminals, from the floor's inventory (every live PTY, with the
//     Agent Profile its shell was born under — the terminal bindings record);
//   · this device (the roster's name and platform) and the Agent Profiles with
//     their sign-ins (the spawn menu's devices and profiles);
//   · the project identity store (`project-identity.ts`, L4).
//
// Nothing here derives a fact a view draws: that is the backend's, in
// puppeteer's words, so both hosts' Godviews say the same thing from the same
// states. The model this emits is cut per audience by the board
// (`agent-field.ts`) and carried by the one door (`agent.subscribe`); the
// backend holds live state only — in memory for the daemon's lifetime, never a
// ledger on disk and never a history door (MV-D22; TL-D8 stands).

/** The fold, as the backend's host reads it: the rows now, and every publish. */
export interface AgentMonitorFold {
  list(): AgentListResult;
  subscribe(emit: (rows: AgentListResult) => void): () => void;
}

/** The floor's inventory: undefined before the first observation (the floor has
 * not said what it holds; `terminal.list` refuses then, and so does this). */
export interface AgentMonitorTerminals {
  list(): readonly TerminalInfo[] | undefined;
  onInventory(listener: (rows: readonly TerminalInfo[]) => void): () => void;
  /** SB-2 — the Agent Profile the shell was born under, from the bindings record */
  profileSetOf(sessionId: string): string | undefined;
}

/** This device, read per facts: DeviceService swaps its fallback id for the mesh
 * identity on its first sync, so the id is never pinned here (the landing
 * review, S6). */
export interface AgentMonitorDevices {
  current(): { id: string; name?: string | undefined; platform?: string | undefined };
  onChanged(listener: () => void): () => void;
}

/** The Agent Profiles feed (`agents.profileSets.subscribe`'s frames). */
export interface AgentMonitorProfiles {
  sets(): Promise<AgentsProfileSetsListResult>;
  subscribe(emit: (frame: AgentsProfileSetsListResult) => void): () => void;
}

export interface AgentMonitorServiceOptions {
  /** puppeteer's runtime: its push bus and the all-runs snapshot it grew for the backend */
  runtime: MonitorRuntimeSource;
  fold: AgentMonitorFold;
  terminals: AgentMonitorTerminals;
  devices: AgentMonitorDevices;
  profiles: AgentMonitorProfiles;
  /** the catalog's label for a persona's provider (AC-D4: ours, never the adapter's) */
  catalog: Pick<AgentCatalogReaders, "entry">;
  identity: ProjectIdentityStore;
  /** test seams; the backend's own clock (Date.now + setTimeout) and one-macrotask scheduler by default */
  clock?: MonitorClock | undefined;
  scheduler?: MonitorScheduler | undefined;
  logger?: Logger | undefined;
}

/** The backend as mv1-fix (M22) extends it; both members are absent at pin
 * 1afaff7 and read behind a check until the pin moves: `idOf` says which model
 * row a run is (see `hostRunFromSummary`'s terminalIdentity), `forgetScreen`
 * ends a screen's lifetime (M20) where today's backend only clears its report. */
type MonitorBackendWithFixes = MonitorBackend & {
  idOf?: (runtimeRunId: string) => string | undefined;
  forgetScreen?: (screenId: string) => void;
};

export interface AgentMonitorService {
  readonly backend: MonitorBackend;
  /** Resolves once the runtime's all-runs listing has been merged. */
  readonly ready: Promise<void>;
  snapshot(): MonitorModelSnapshot;
  /** The model row a managed run is drawn by, joined by its runtimeRunId. */
  rowForRun(runtimeRunId: string): MonitorAgentRow | undefined;
  /** The bare terminals' rows: this desktop's PTYs no agent speaks for (L8). */
  terminalRows(): readonly MonitorAgentRow[];
  /** The pane join for a floor session the model names: its cell and class, as
   * the inventory last listed them; undefined for one it does not list. */
  terminalJoin(
    sessionId: string,
  ): Pick<AgentSessionTerminal, "cellBootId" | "workloadClass"> | undefined;
  /**
   * Every model change, with whether it is URGENT (L12): a row's status,
   * liveness, wait or pending moved, or a row arrived or left. Everything else
   * (usage, cost, activity, a reply line, recency, unread) coalesces to the
   * reader's floor.
   */
  subscribe(listener: (change: MonitorModelChange, urgent: boolean) => void): () => void;
  /**
   * L5, M20 — a screen is a window's model board while it is open: what it
   * reports shown clears unread marks; closing it FORGETS the screen (the
   * backend accrues no unread while no screen is registered, so a closed
   * Godview marks nothing — today's single-window behaviour). Returns the close.
   */
  openScreen(screenId: string): () => void;
  /** What a screen shows in its active pane; false when no such screen is open. */
  reportShown(screenId: string, ids: readonly string[]): boolean;
  dispose(): void;
}

/** The SDK's OS mark for a Node platform word; anything else is no mark. */
export function deviceOsOf(platform: string | undefined): DeviceOs | undefined {
  switch (platform) {
    case "darwin":
      return "mac";
    case "win32":
      return "windows";
    case "linux":
      return "linux";
    case "ios":
      return "ios";
    case "android":
      return "android";
    default:
      return undefined;
  }
}

function epochMs(iso: string | undefined): number | undefined {
  if (iso === undefined) return undefined;
  const ms = Date.parse(iso);
  return Number.isFinite(ms) ? ms : undefined;
}

/**
 * One fold row as the backend's host record. Pure; every rule here is the
 * fold's own, read once:
 *
 *  · liveness is fieldd's (ruled 2026-09-13; `projectFieldRow`): a record
 *    stamped with an exit is not alive however fresh its mirror (`alive:
 *    false` outranks the runtime's word); with no mirror the PTY decides;
 *    with a mirror the backend reads the runtime's live state itself;
 *  · the PTY join is `terminal.runtimeSessionId` for a LOCAL terminal — and
 *    an EXITED run claims none: its shell outlives it (a `user-shell` run,
 *    AR-7), so the pane is a bare terminal again, which is what the stage
 *    drew for it before (a dead run was no row; its pane was a terminal);
 *  · AR-4's `replaced` names the PTY the run took the place of, so the old
 *    pane is not a phantom terminal during the hand-over;
 *  · the project's key is the renderer's own rule (`agent-status.ts`
 *    `projectKey`): the workspace's root, else its source path; the backend
 *    falls back to the live state's cwd, as the renderer fell back to the
 *    mirror's;
 *  · `terminalIdentity` is the run id — INTERIM. The backend carries a
 *    promoted shell's row id forward (its PTY's id) and keeps that map
 *    private, so fieldd could not join a row back to its run; naming the run
 *    as its PTY's identity makes every agent row's id its runtimeRunId
 *    (`managedRowId`, today's action identity) at the cost of the body's
 *    continuity on promotion. The ask for `MonitorBackend.idOf` is with the
 *    lead; when it lands this line goes and `rowForRun` reads the map.
 */
export function hostRunFromSummary(summary: AgentSessionSummary): MonitorHostRun {
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
    terminalIdentity: summary.runtimeRunId,
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

/** A floor PTY as the backend's host record. `createdAt` 0 is the floor's
 * "unknown" (a roster row with no birth time), the backend's own convention. */
export function hostTerminalFrom(
  info: TerminalInfo,
  profileSet: string | undefined,
): MonitorHostTerminal {
  const workloadClass = info.cell?.workloadClass;
  return {
    sessionId: info.sessionId,
    createdAt: info.createdAt ?? 0,
    ...(info.cwd !== undefined && info.cwd !== "" ? { cwd: info.cwd } : {}),
    ...(info.title !== undefined && info.title !== "" ? { title: info.title } : {}),
    ...(profileSet !== undefined ? { profileSet } : {}),
    ...(workloadClass !== undefined ? { workloadClass } : {}),
  };
}

/** An Agent Profile as the backend's host record: the set, its sign-ins with
 * the catalog's label for each provider (the spawn menu's `signedIn` words). */
export function hostProfileSetFrom(
  set: AgentProfileSet,
  catalog: Pick<AgentCatalogReaders, "entry">,
): MonitorHostProfileSet {
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

/** This desktop, as every row of the model carries it. */
export function deviceRefFrom(device: {
  id: string;
  name?: string | undefined;
  platform?: string | undefined;
}): MonitorDeviceRef {
  const os = deviceOsOf(device.platform);
  return {
    id: device.id,
    name: device.name !== undefined && device.name !== "" ? device.name : device.id,
    ...(os !== undefined ? { os } : {}),
    self: true,
  };
}

/** The facts the backend's host port answers, from the daemon's own sources. */
export function hostFactsFrom(input: {
  rows: AgentListResult;
  terminals: readonly TerminalInfo[] | undefined;
  profileSetOf: (sessionId: string) => string | undefined;
  device: { id: string; name?: string | undefined; platform?: string | undefined };
  profileSets: AgentsProfileSetsListResult | null;
  catalog: Pick<AgentCatalogReaders, "entry">;
}): MonitorHostFacts {
  return {
    device: deviceRefFrom(input.device),
    runs: input.rows.sessions.map(hostRunFromSummary),
    terminals: (input.terminals ?? []).map((info) =>
      hostTerminalFrom(info, input.profileSetOf(info.sessionId)),
    ),
    profileSets:
      input.profileSets === null
        ? null
        : input.profileSets.sets.map((set) => hostProfileSetFrom(set, input.catalog)),
  };
}

/** What a person waits on, moved: the facts the window must see at once (L12). */
export function isUrgentChange(
  previous: ReadonlyMap<string, MonitorAgentRow>,
  change: MonitorModelChange,
): boolean {
  if (change.removed.length > 0) return true;
  for (const row of change.upserts) {
    const before = previous.get(row.id);
    if (before === undefined) return true;
    if (
      before.status !== row.status ||
      before.alive !== row.alive ||
      before.pending !== row.pending ||
      before.wait?.kind !== row.wait?.kind ||
      before.wait?.since !== row.wait?.since ||
      before.wait?.count !== row.wait?.count
    )
      return true;
  }
  return false;
}

/**
 * The backend, hosted. Built once per daemon, after the device roster and the
 * terminal floor exist; disposed with the daemon. Every source is pull-with-
 * notify: a fold publish, an inventory, a profiles frame or a roster change
 * marks the facts dirty and wakes the backend's tick, which reads them whole.
 */
export function createAgentMonitorService(opts: AgentMonitorServiceOptions): AgentMonitorService {
  const logger = (opts.logger ?? createNoopLogger()).child({ component: "agent.monitor" });
  let rows: AgentListResult = opts.fold.list();
  let profileSets: AgentsProfileSetsListResult | null = null;
  let facts: MonitorHostFacts | null = null;
  const hostListeners = new Set<() => void>();
  const wake = (): void => {
    facts = null;
    for (const listener of [...hostListeners]) listener();
  };
  const host: MonitorHostPort = {
    getFacts() {
      if (facts === null) {
        facts = hostFactsFrom({
          rows,
          terminals: opts.terminals.list(),
          profileSetOf: (sessionId) => opts.terminals.profileSetOf(sessionId),
          device: opts.devices.current(),
          profileSets,
          catalog: opts.catalog,
        });
      }
      return facts;
    },
    subscribe(listener) {
      hostListeners.add(listener);
      return () => hostListeners.delete(listener);
    },
  };
  const unsubscribe: Array<() => void> = [
    opts.fold.subscribe((next) => {
      rows = next;
      wake();
    }),
    opts.terminals.onInventory(() => wake()),
    opts.devices.onChanged(() => wake()),
    opts.profiles.subscribe((frame) => {
      profileSets = frame;
      wake();
    }),
  ];
  let disposed = false;
  // the first profiles frame: the feed publishes on change only, so the menu
  // would read `reading` until a profile moved
  void opts.profiles.sets().then(
    (frame) => {
      if (disposed || profileSets !== null) return;
      profileSets = frame;
      wake();
    },
    (error: unknown) => {
      logger.warn("fieldd.monitor.profiles_unread", "The Agent Profiles could not be read", {
        error: error instanceof Error ? error.message : String(error),
      });
    },
  );

  const backend: MonitorBackendWithFixes = createMonitorBackend({
    runs: runtimeRunSource(opts.runtime),
    host,
    identity: opts.identity,
    // Windows route their own verbs through their doors (`mountLocal`, the
    // birth path); a command reaching this sink is a wiring fault, said once.
    sink: {
      select: (target) =>
        logger.warn("fieldd.monitor.command_unrouted", "A select reached fieldd's sink", {
          id: target.id,
        }),
      create: (request) =>
        logger.warn("fieldd.monitor.command_unrouted", "A create reached fieldd's sink", {
          device: request.device.id,
        }),
    },
    // M15 — VibeField's reading: the current epoch alone; a resumed
    // conversation does not add up across epochs.
    cost: { acrossEpochs: "current" },
    // M17 — an agent row before its first state shows as "starting" (`observed:
    // false`); the backend's own default at pin 1afaff7. When `unobservedAgents`
    // lands (mv2-pu), VibeField passes 'row' here explicitly.
    // M21 — NO replyMaxLength: this desktop's own window reads the row's text
    // as core bounded it, as it read the full mirror; the desk cut bounds the
    // text for PEERS at `AGENT_FIELD.DESK_TEXT_CHARS` (`agent-field.ts`).
    ...(opts.clock !== undefined ? { clock: opts.clock } : {}),
    ...(opts.scheduler !== undefined ? { scheduler: opts.scheduler } : {}),
    onError: (error) =>
      logger.warn("fieldd.monitor.backend_error", "The monitor backend reported an error", {
        error: error instanceof Error ? error.message : String(error),
      }),
  });

  // the model's rows by id, rebuilt only when the snapshot moved
  let indexedFor: MonitorModelSnapshot | null = null;
  let byId = new Map<string, MonitorAgentRow>();
  const index = (): ReadonlyMap<string, MonitorAgentRow> => {
    const snapshot = backend.getSnapshot();
    if (indexedFor !== snapshot) {
      byId = new Map(snapshot.rows.map((row) => [row.id, row]));
      indexedFor = snapshot;
    }
    return byId;
  };
  const idOf = (runtimeRunId: string): string => backend.idOf?.(runtimeRunId) ?? runtimeRunId;

  const screens = new Set<string>();

  return {
    backend,
    ready: backend.ready,
    snapshot: () => backend.getSnapshot(),
    rowForRun: (runtimeRunId) => index().get(idOf(runtimeRunId)),
    terminalRows: () => backend.getSnapshot().rows.filter((row) => row.kind === "terminal"),
    terminalJoin(sessionId) {
      const info = opts.terminals.list()?.find((row) => row.sessionId === sessionId);
      if (info === undefined) return undefined;
      const cell = info.cell;
      return {
        ...(cell?.cellBootId !== undefined ? { cellBootId: cell.cellBootId } : {}),
        ...(cell?.workloadClass !== undefined ? { workloadClass: cell.workloadClass } : {}),
      };
    },
    subscribe(listener) {
      // the rows as the listener last saw them, so urgency is judged against
      // what this subscriber holds and not against another's
      let held = new Map(index());
      return backend.subscribe((change) => {
        const urgent = isUrgentChange(held, change);
        held = new Map(index());
        listener(change, urgent);
      });
    },
    openScreen(screenId) {
      screens.add(screenId);
      // the registration itself, for a backend that stamps first-sight on it
      // (M20); today's backend learns of a screen only from its first report
      if (backend.forgetScreen !== undefined) backend.reportShown(screenId, []);
      let open = true;
      return () => {
        if (!open) return;
        open = false;
        screens.delete(screenId);
        if (disposed) return;
        if (backend.forgetScreen !== undefined) backend.forgetScreen(screenId);
        else backend.reportShown(screenId, []);
      };
    },
    reportShown(screenId, ids) {
      if (disposed || !screens.has(screenId)) return false;
      backend.reportShown(screenId, ids);
      return true;
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      for (const off of unsubscribe) off();
      unsubscribe.length = 0;
      hostListeners.clear();
      screens.clear();
      backend.dispose();
    },
  };
}
