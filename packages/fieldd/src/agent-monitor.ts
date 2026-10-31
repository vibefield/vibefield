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
import {
  createMonitorBackend,
  type MonitorBackend,
  type MonitorClock,
  type MonitorHistoryPort,
  type MonitorHostFacts,
  type MonitorHostPort,
  type MonitorHostProfileSet,
  type MonitorHostRun,
  type MonitorHostTerminal,
  type MonitorRuntimeSource,
  type MonitorScheduler,
  type ProjectIdentityStore,
  runtimeRunSource,
} from "@vibefield/puppeteer-monitor";
import type {
  DeviceOs,
  MonitorAgentRow,
  MonitorDeviceRef,
  MonitorModelChange,
  MonitorModelSnapshot,
  MonitorPastSnapshot,
} from "@vibefield/puppeteer-view-sdk/model";

// MV-3a (MV-D22, MV-D18) — THE MONITOR BACKEND, BESIDE THE RUNTIME.
//
// One backend per desktop computes every business fact about this desktop's
// agents once (`@vibefield/puppeteer-monitor`'s `createMonitorBackend`): the run
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
// ledger on disk (MV-D22; TL-D8's reversal stands).
//
// *Amended 2026-10-09 (docket v9, RULED by James: T4 (a), T5 (a), B-D6 (a)):*
// this said "and never a history door". The backend now READS the past through
// a host port (`history`: `index-activity.ts`, over rosettad's record) and
// answers it at a window's ask (`readPast`, the door `agent.recordedLanes`).
// It still records nothing and holds nothing: each ask is read through to
// rosettad and derived afresh, and only rosetta reads transcripts. It is not
// the removed `agent.history` (TL-D8's ledger in the fold, MV-D13), and the
// past never rides the model's rows.

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
  /** TL — the record, read at each `readPast` (`index-activity.ts`); absent:
   * the past is `unavailable` and views draw runtime state alone */
  history?: MonitorHistoryPort | undefined;
  /** test seams; the backend's own clock (Date.now + setTimeout) and one-macrotask scheduler by default */
  clock?: MonitorClock | undefined;
  scheduler?: MonitorScheduler | undefined;
  logger?: Logger | undefined;
}

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
   * L5, M20 — a screen is a window's model board while it is open: opening it
   * is an empty first report (its pane shows nothing yet), what it reports
   * shown clears unread marks, and closing it FORGETS the screen: what it
   * showed is shown no more. Q05 (James, 2026-10-27): the marks are fieldd's,
   * not the screen's. The backend's ledger lives as long as this service (the
   * daemon), so a turn that ends while no screen is open is marked, and
   * neither a reload (a new connection's screen) nor a closed Godview (the
   * board unsubscribed) drops a mark. Returns the close.
   *
   * Q06 — what a screen reports shown also acknowledges a crashed run's
   * failure, so the row leaves for every screen: that is the person's look,
   * and only a screen opened with `acknowledges` (this desktop's own window)
   * looks for the person. Any other screen's reports clear marks and
   * acknowledge nothing.
   */
  openScreen(screenId: string, options?: { acknowledges?: boolean }): () => void;
  /** What a screen shows in its active pane; false when no such screen is open. */
  reportShown(screenId: string, ids: readonly string[]): boolean;
  /** TL — the lanes' past for a window, read through to the record and joined
   * with the model now (`agent.recordedLanes`); never rejects. Undefined when
   * this desktop has no record source (no history port). */
  readPast(window: { sinceMs: number; untilMs: number }): Promise<MonitorPastSnapshot | undefined>;
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
 *  · the project's key is the rule the renderer's `projectKey` wrote
 *    (`agent-status.ts`, retired unused at item 125, 2026-10-31): the
 *    workspace's root, else its source path; the backend falls back to the
 *    live state's cwd, as the renderer fell back to the mirror's;
 *  · the row's ID is the backend's (M22): a run whose PTY the floor lists —
 *    a shell promoted to an agent, or born with it — carries the shell's id,
 *    so the body a window drew for the shell is the agent's; fieldd never
 *    assumes a row's id is its run id and asks `idOf` (`rowForRun`). The PTY
 *    stays listed among the host's terminals as long as the floor lists it
 *    (the README's host contract); the backend dedupes the one the run claims.
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

/** Q06 — a crashed run's failure, as a window draws it: a dead agent row whose
 * wait is the runtime's failure (puppeteer retains it until acknowledged, M3).
 * Its `since` tells one failure from the next (a run resumed, then failed
 * again); undefined for any other row. */
function failureSince(row: MonitorAgentRow | undefined): number | undefined {
  if (row === undefined || row.kind !== "agent" || row.alive) return undefined;
  return row.wait?.kind === "failure" ? row.wait.since : undefined;
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

  const backend: MonitorBackend = createMonitorBackend({
    runs: runtimeRunSource(opts.runtime),
    host,
    identity: opts.identity,
    ...(opts.history !== undefined ? { history: opts.history } : {}),
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

  const screens = new Set<string>();

  // Q06 (James, 2026-10-27, "B · Keep a failed body until you look") — a
  // crashed run keeps its row, the failure on it, until the person has SEEN
  // its pane: until an open screen reports shown its row, or the floor session
  // its pane is (the fold's join; a dead PTY is a bare terminal row again, and
  // this host keys a terminal row by its session). What a window reports
  // shown is its focused pane while the terminals are up and the row the
  // person pointed at, unless that row has failed (Q04; field-app's
  // `windowShown`), so that is the seeing. Only a screen that looks for the
  // person counts (`acknowledges`, this desktop's own window): a plugin's
  // screen, under the same `agent.observe`, acknowledges nothing. The failure
  // is then acknowledged (the backend's M3 command): puppeteer removes the run
  // and the row leaves the model for every screen. The fold's own row is
  // untouched — a dead pane keeps its resume verb (MF-1f). Asked at each report
  // and at each model change, since a run can fail in the pane already shown;
  // each failure once, by run and `since`.
  const looking = new Set<string>();
  const shownByScreen = new Map<string, ReadonlySet<string>>();
  const acknowledged = new Map<string, number>();
  const acknowledgeSeen = (): void => {
    if (disposed) return;
    const shown = new Set<string>();
    for (const [screenId, ids] of shownByScreen) {
      if (!screens.has(screenId)) shownByScreen.delete(screenId);
      else for (const id of ids) shown.add(id);
    }
    const failed = new Set<string>();
    for (const summary of rows.sessions) {
      const id = backend.idOf(summary.runtimeRunId);
      const since = failureSince(id === undefined ? undefined : index().get(id));
      if (id === undefined || since === undefined) continue;
      failed.add(summary.runtimeRunId);
      if (acknowledged.get(summary.runtimeRunId) === since) continue;
      const terminal = summary.terminal;
      const pane = terminal?.hosted === "local" ? terminal.runtimeSessionId : undefined;
      if (!shown.has(id) && (pane === undefined || !shown.has(pane))) continue;
      acknowledged.set(summary.runtimeRunId, since);
      if (!backend.command({ type: "acknowledge", id })) {
        logger.warn(
          "fieldd.monitor.failure_unacknowledged",
          "A failure a screen showed could not be acknowledged; its row stays",
          { runtimeRunId: summary.runtimeRunId },
        );
      }
    }
    for (const runtimeRunId of [...acknowledged.keys()]) {
      if (!failed.has(runtimeRunId)) acknowledged.delete(runtimeRunId);
    }
  };
  unsubscribe.push(backend.subscribe(() => acknowledgeSeen()));

  return {
    backend,
    ready: backend.ready,
    snapshot: () => backend.getSnapshot(),
    rowForRun(runtimeRunId) {
      // never assumed to be the run id: a promoted shell's run carries the shell's id (M22)
      const id = backend.idOf(runtimeRunId);
      return id === undefined ? undefined : index().get(id);
    },
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
    openScreen(screenId, options) {
      screens.add(screenId);
      if (options?.acknowledges === true) looking.add(screenId);
      // the first report opens the screen, an empty one too (M20); the marks
      // it finds are the ledger's, kept while no screen was open (Q05)
      backend.reportShown(screenId, []);
      let open = true;
      return () => {
        if (!open) return;
        open = false;
        screens.delete(screenId);
        looking.delete(screenId);
        if (!disposed) backend.forgetScreen(screenId);
      };
    },
    reportShown(screenId, ids) {
      if (disposed || !screens.has(screenId)) return false;
      if (looking.has(screenId)) shownByScreen.set(screenId, new Set(ids));
      backend.reportShown(screenId, ids);
      acknowledgeSeen();
      return true;
    },
    readPast: (window) => backend.readPast(window),
    dispose() {
      if (disposed) return;
      disposed = true;
      for (const off of unsubscribe) off();
      unsubscribe.length = 0;
      hostListeners.clear();
      screens.clear();
      looking.clear();
      backend.dispose();
    },
  };
}
