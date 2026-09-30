import type { SessionSummary } from "@vibecook/ghosttea-protocol";
import {
  type AgentMonitorState,
  classifyMonitorRecency,
  type MonitorContextState,
} from "@vibecook/puppeteer-core";
import {
  type PaneAttachment,
  type ProjectTint,
  projectTint,
  type UsageHistory,
} from "@vibecook/puppeteer-views";
import {
  type AgentVisualStatus,
  agentDetail,
  classifyAgentStatus,
  classifyTerminalStatus,
  projectKey,
  projectLabel,
  providerLabel,
} from "./agent-status";
import type { AgentSessionSummary } from "./facet-types";
import { folderName } from "./folder-name";
import { type RemoteSessionRow, remoteRowId } from "./remote-door";
import type { MonitorAgent } from "./types";

/** A managed session as fieldd's fold reports it (AR-3), and the floor
 * summary of its PTY when the deck holds one (a pane is showing it). */
export interface MonitorManagedRecord {
  summary: AgentSessionSummary;
  session?: SessionSummary;
}

/** A terminal the user opened that no agent has claimed. */
export interface MonitorTerminalRecord {
  session: SessionSummary;
  cwd?: string;
  spawnHint?: { x: number; y: number };
  /** SB-3 — the Agent Profile its shell was born under, in fieldd's words. */
  profileSet?: string;
}

/**
 * A LIVE PTY ON THE FLOOR THAT NO PANE IS SHOWING (GT-6b).
 *
 * The deck's panes were the only source of terminal rows until James's
 * 2026-09-13 pass: he selected a managed agent, GT-D17's law mounted it in the
 * ACTIVE pane, the shell that pane was showing left the deck — and left the
 * roster with it, while `terminal.list` and `terminal.sessions` both still
 * reported it alive. A PTY the floor holds must stay reachable; that is the
 * whole of "view and control any active terminal session".
 *
 * It is a SEPARATE record from `MonitorTerminalRecord` because the facts are
 * different and must not be invented into the same shape. This row comes from
 * `terminal.roster` — the UI's projection (TP-D4): id, class, health and a
 * title, with no placement and, deliberately, no cwd and no activity. The
 * transport-facing `terminal.list` has those and is exactly what a UI may not
 * read (TP-L-C), so the row says less rather than claiming more.
 */
export interface MonitorFloorRecord {
  sessionId: string;
  /** The floor's own word for what the PTY is for (`interactive` · `agent`). */
  workloadClass: "agent" | "interactive";
  /** The floor's title for the session, when it has one. */
  title?: string;
  /** SB-3 — the Agent Profile its shell was born under, in fieldd's words. */
  profileSet?: string;
}

/** A peer's session, and where it landed here if it has (GT-D17). */
export interface MonitorRemoteRecord {
  row: RemoteSessionRow;
  /** The local replica's id, when this row is currently showing in a pane. */
  localSessionId?: string;
}

/** The theme's tint for project colours and the ramp for rows with no project (record §02). */
export interface MonitorColours {
  tint: ProjectTint;
  neutral: string;
}

export interface AssembleMonitorAgentsInput {
  /** The fold's rows (AR-3). */
  managed: readonly MonitorManagedRecord[];
  terminals: readonly MonitorTerminalRecord[];
  /** GT-6b — live PTYs the floor lists that no pane is showing. Additive: a
   * roster that could not be read means no rows from here and never fewer
   * pane rows, so a floor the deck cannot ask still shows what it can see. */
  floor?: readonly MonitorFloorRecord[];
  /** The mesh's half of the field. Empty is the honest answer with no floor
   * serving — there are no placeholder peers and no invented hosts. */
  remotes?: readonly MonitorRemoteRecord[];
  /** SB-3 — which shells were born under which Agent Profile (session id →
   * set id): the pool's record, fieldd's words — its create answers and its
   * roster. A terminal row carries its shell's; a shell under none carries none. */
  profileSets?: ReadonlyMap<string, string>;
  /** The live tokens' tint and ramp, passed IN rather than read here so this
   * whole module stays a pure function — the reference's property, kept, and
   * the reason its tests need no renderer. */
  colours: MonitorColours;
  /** Project key → the sequence it was dealt (`project-ledger.ts`); a project
   * with no sequence yet, or a row with no project, wears the ramp. */
  projectSeqs: ReadonlyMap<string, number>;
  /** The UI's usage ledger, by row id (`usage-ledger` in the package). */
  usage?: ReadonlyMap<string, UsageHistory>;
  /** Live summaries, so a terminal placeholder reflects current activity rather than launch state. */
  sessions?: ReadonlyMap<string, SessionSummary>;
  visualIds?: ReadonlyMap<string, string> | undefined;
  previousVisualIds?: ReadonlyMap<string, string> | undefined;
  /** The panes showing each session, by session id — the deck's facts (record §02). */
  attachments?: ReadonlyMap<string, PaneAttachment>;
  /** The session showing in the pane the user is working in — the DECK's fact. */
  activeSessionId?: string;
  /**
   * The row the preview is highlighting, by row id.
   *
   * Separate from `activeSessionId` because it is a weaker claim: a row the
   * user pointed at that no pane is showing yet (a managed session whose PTY
   * has not been mounted here, a peer's session before its attach).
   */
  previewSelectedId?: string;
  nowMs?: number;
}

/** The record with the deck's summary of its PTY joined in, when a pane holds
 * one: `sessions` is keyed by the floor's session id, which the fold names as
 * the row's `terminal.runtimeSessionId`. */
function withPaneSummary(
  record: MonitorManagedRecord,
  sessions: ReadonlyMap<string, SessionSummary> | undefined,
): MonitorManagedRecord {
  if (record.session !== undefined) return record;
  const id = record.summary.terminal?.runtimeSessionId;
  const session = id === undefined ? undefined : sessions?.get(id);
  return session === undefined ? record : { ...record, session };
}

/**
 * A managed row's monitor id: the RUN.
 *
 * `runtimeRunId` is the one identity a run keeps through everything that can
 * happen to it — a resume-when-idle that swaps the PTY under it (AR-4), an exit
 * that leaves it hosting none, a fieldd restart that gives it a new epoch. The
 * floor session id is none of those: it is the PTY, and a row keyed by it
 * became a DIFFERENT row the moment the run was resumed — which the swarm reads
 * as a different row. The chrome reads that as a preview highlight pointing at
 * nothing. Spatial continuity now has its own `visualId`, so a shell can grow
 * into an agent without changing runtime/action identity.
 *
 * The pane join is a SEPARATE field and stays one: `agent.session?.id`, and the
 * fold's own `terminal.runtimeSessionId`, are what the deck↔monitor join and
 * the active-pane comparison read. Nothing joins on this id.
 */
export function managedRowId(summary: AgentSessionSummary): string {
  return summary.runtimeRunId;
}

/** The project's dealt tint, or the ramp for a row that has no project or
 * whose project has not been dealt yet (record §02, D3). */
function projectColour(
  summary: AgentSessionSummary,
  colours: MonitorColours,
  projectSeqs: ReadonlyMap<string, number>,
): string {
  const key = projectKey(summary);
  const seq = key === undefined ? undefined : projectSeqs.get(key);
  return seq === undefined ? colours.neutral : projectTint(seq, colours.tint);
}

/** Undefined for a session that has stopped being worth showing at all. */
export function monitorAgentFromManaged(
  record: MonitorManagedRecord,
  input: Pick<AssembleMonitorAgentsInput, "colours" | "projectSeqs" | "nowMs">,
  usage?: UsageHistory,
): MonitorAgent | undefined {
  const { summary, session } = record;
  if (session?.exited) return undefined;
  const status = classifyAgentStatus(summary);
  if (!status) return undefined;
  // The mirror is Core's projection carried verbatim (the passthrough, pinned
  // against Core's generation by `agent-monitor-pin.test.ts`); the views read
  // it as Core's type, and this is the one seam that says so.
  const monitor = summary.monitor as AgentMonitorState | undefined;
  const observedCwd = monitor?.environment?.cwd;
  // The presence of the OBSERVATION decides, not the truthiness of the branch:
  // a git value of null authoritatively means "not in a repo", which is an
  // answer, and falling through to the workspace's branch would overwrite it.
  const git = monitor?.environment?.git;
  const branch = git !== undefined ? (git?.branch ?? undefined) : summary.workspace?.branch;
  const cwd = observedCwd || summary.workspace?.sourcePath || summary.workspace?.root || undefined;
  const model = monitor?.model;
  const context = monitor?.context as MonitorContextState | undefined;
  const recency = classifyMonitorRecency(
    monitor?.freshness?.lastEvidenceAt,
    input.nowMs ?? Number.NaN,
  ).recency;
  const id = managedRowId(summary);
  return {
    id,
    ...(session !== undefined ? { session } : {}),
    createdAtMs: session?.createdAtMs ?? Date.parse(summary.createdAt),
    tier: summary.tier,
    status,
    project: projectLabel(summary),
    detail: agentDetail(summary, status),
    color: projectColour(summary, input.colours, input.projectSeqs),
    ...(recency === "stale" ? { stale: true } : {}),
    active: false,
    ...(cwd ? { cwd } : {}),
    agent: {
      provider: { id: summary.kind, label: providerLabel(summary) },
      kind: summary.kind,
      tier: summary.tier,
      runtimeRunId: summary.runtimeRunId,
      ...(summary.profileId !== undefined ? { profileId: summary.profileId } : {}),
      ...(summary.profileSet !== undefined ? { profileSet: summary.profileSet } : {}),
      ...(model ? { model: model.displayName || model.id } : {}),
      ...(branch ? { branch } : {}),
      ...(context ? { contextWindow: context } : {}),
      ...(monitor ? { monitor } : {}),
      ...(usage ? { usage } : {}),
      recency,
      // the fold's native id (the find sheet's join key), whatever its basis
      nativeSessionId: summary.sessionId,
      summary,
    },
  };
}

/** A terminal no agent has claimed belongs to no project, so it wears the ramp. */
export function monitorAgentFromTerminal(
  record: MonitorTerminalRecord,
  colours: MonitorColours,
): MonitorAgent {
  const { session, cwd, spawnHint, profileSet } = record;
  const path = cwd ?? session.cwd ?? undefined;
  return {
    id: session.id,
    session,
    createdAtMs: session.createdAtMs,
    status: classifyTerminalStatus(session.activity),
    project: folderName(path, "terminal"),
    detail: path || "Unassigned terminal",
    color: colours.neutral,
    active: false,
    ...(path ? { cwd: path } : {}),
    ...(spawnHint ? { spawnHint } : {}),
    ...(profileSet !== undefined ? { profileSet } : {}),
  };
}

/**
 * A live PTY the floor lists and no pane is showing (GT-6b).
 *
 * Everything a richer row draws — the cwd, the project, what the terminal is
 * doing — is absent here rather than guessed, because the UI's roster carries
 * none of it. What the row DOES carry is the one thing that makes it useful:
 * the session id, under `floorSessionId`, so the monitor's own select can
 * mount it in a pane. It is VibeField's field beside the package's shape
 * (AR-D13a), not a `session`: the package's `session` means "the host holds
 * this terminal's summary", which here it does not.
 *
 * `createdAtMs` is 0 and means UNKNOWN. The roster is id · class · health ·
 * title and no birth time; a view only ever orders by this number, so these
 * rows fall in the floor's own order among their peers rather than claiming a
 * moment they were born.
 */
export function monitorAgentFromFloor(
  record: MonitorFloorRecord,
  colours: MonitorColours,
): MonitorAgent {
  return {
    id: record.sessionId,
    floorSessionId: record.sessionId,
    createdAtMs: 0,
    // No activity is reported for a session no pane is watching, and the
    // classifier's answer for "nothing reported" is the honest one: a terminal
    // that is not doing anything anyone can see. It is never `blocked` — that
    // word means an agent is asking for something, and no agent has spoken.
    status: classifyTerminalStatus(undefined),
    project: folderName(undefined, record.title || "terminal"),
    detail:
      record.workloadClass === "agent" ? "agent PTY · in no pane" : "on the floor · in no pane",
    color: colours.neutral,
    active: false,
    ...(record.profileSet !== undefined ? { profileSet: record.profileSet } : {}),
  };
}

/**
 * A peer's session as a monitor citizen (GT-D17).
 *
 * Everything here comes from what the peer reported, and the two fields it did
 * NOT report are absent rather than guessed: there is no `session` (no local
 * session exists until this row is attached) and no `cwd` (the peer's path is a
 * label, kept under `remote.cwdLabel` where nothing will try to spawn in it).
 * It belongs to no project this device has dealt a colour, so it wears the ramp.
 *
 * The status classifier is the unclaimed terminal's, deliberately: a peer sends
 * terminal activity, not agent state, so a remote row can be working or idle
 * and never `blocked` — that word means an agent is asking for something, and
 * no agent has spoken here.
 */
export function monitorAgentFromRemote(
  record: MonitorRemoteRecord,
  colours: MonitorColours,
): MonitorAgent {
  const { host, session } = record.row;
  const id = remoteRowId(host.deviceId, session.sessionId);
  return {
    id,
    createdAtMs: session.createdAtMs,
    tier: "remote",
    status: classifyTerminalStatus(session.activity),
    project: folderName(session.cwdLabel, session.title || "remote"),
    // The host is in the detail as well as in the facet, because the detail is
    // what the swarm puts in a tooltip and the list prints as its own column: a
    // path with no machine attached to it is exactly the confusion GT-3's
    // finding warned of.
    detail: session.cwdLabel ? `${host.deviceName} · ${session.cwdLabel}` : host.deviceName,
    color: colours.neutral,
    active: false,
    remote: {
      deviceId: host.deviceId,
      deviceName: host.deviceName,
      remoteSessionId: session.sessionId,
      attachable: session.attachable,
      // Renamed on the way in, deliberately: what the peer advertises is one
      // boolean for the whole HOST, and carrying it under a per-viewer name is
      // how the views came to draw it as one.
      hostWritable: session.readWrite,
      cwdLabel: session.cwdLabel,
      ...(record.localSessionId !== undefined ? { localSessionId: record.localSessionId } : {}),
    },
  };
}

/**
 * The one projection every view consumes: managed agents first in launch order,
 * then the terminals no agent has claimed, then the mesh's own (GT-D17). Pure,
 * so the seam is testable without a renderer.
 *
 * The remotes come LAST and as their own segment because the order on this
 * stage is a claim about locality — a peer's session is a guest, and the list
 * view's own ordering rules run over the result anyway.
 */
export function assembleMonitorAgents(input: AssembleMonitorAgentsInput): readonly MonitorAgent[] {
  const agents = input.managed
    .map((record) =>
      monitorAgentFromManaged(
        withPaneSummary(record, input.sessions),
        input,
        input.usage?.get(managedRowId(record.summary)),
      ),
    )
    .filter((agent): agent is MonitorAgent => agent !== undefined)
    .sort((left, right) => left.createdAtMs - right.createdAtMs);
  // The PTYs the fold has spoken for, by the id the FLOOR knows them by — not
  // by the rows' ids, which are runs (`managedRowId`). Two ids per row, and the
  // second is the AR-4 one: a resumed run names the PTY it took the place of,
  // and the pane is still showing that PTY until the hand-over lands. Without
  // it the old session comes back as a phantom unclaimed terminal — a bubble
  // for a shell nobody opened, in the gap between the resume and the remount.
  const claimed = new Set<string>();
  for (const agent of agents) {
    const terminal = agent.agent?.summary.terminal;
    if (terminal?.runtimeSessionId !== undefined) claimed.add(terminal.runtimeSessionId);
    if (terminal?.replaced !== undefined) claimed.add(terminal.replaced);
  }
  // SB-3: a terminal row carries the Agent Profile its shell was born under,
  // from the pool's record (fieldd's words), never inferred here.
  const bornUnder = (sessionId: string): { profileSet?: string } => {
    const profileSet = input.profileSets?.get(sessionId);
    return profileSet === undefined ? {} : { profileSet };
  };
  const terminals = input.terminals
    .filter((terminal) => !claimed.has(terminal.session.id))
    .map((terminal) =>
      monitorAgentFromTerminal(
        {
          ...terminal,
          session: input.sessions?.get(terminal.session.id) ?? terminal.session,
          ...bornUnder(terminal.session.id),
        },
        input.colours,
      ),
    );
  // The floor's own, last: every live PTY the roster names that is neither in
  // a pane (the rows above already stand for those) nor spoken for by the
  // fold. Ordered after them because a row you can see is a stronger fact
  // than a row you are told about; the list view's own rules re-order anyway.
  const paned = new Set(input.terminals.map((terminal) => terminal.session.id));
  for (const agent of agents) {
    const session = agent.session?.id;
    if (session !== undefined) paned.add(session);
  }
  const floor = (input.floor ?? [])
    .filter((row) => !paned.has(row.sessionId) && !claimed.has(row.sessionId))
    .map((row) => monitorAgentFromFloor({ ...row, ...bornUnder(row.sessionId) }, input.colours));
  const remotes = (input.remotes ?? []).map((record) =>
    monitorAgentFromRemote(record, input.colours),
  );

  const visuals = new Set<string>();
  return [...agents, ...terminals, ...floor, ...remotes]
    .map((agent) => {
      // A pane shows a LOCAL session: the row's own, or, for a peer's row, the
      // replica the attach put there. The same question, asked of the id that
      // exists.
      const localId =
        agent.session?.id ??
        agent.remote?.localSessionId ??
        agent.agent?.summary.terminal?.runtimeSessionId ??
        agent.floorSessionId;
      const attachment = localId === undefined ? undefined : input.attachments?.get(localId);
      const mounted = localId !== undefined && input.activeSessionId === localId;
      return {
        ...agent,
        visualId:
          (localId === undefined ? undefined : input.visualIds?.get(localId)) ??
          input.previousVisualIds?.get(agent.id) ??
          (agent.remote ? agent.id : localId) ??
          agent.id,
        active: mounted || input.previewSelectedId === agent.id,
        ...(attachment ? { attachment } : {}),
      };
    })
    .filter((agent) => {
      // During a launcher handoff the managed row takes over the same body while
      // the old shell's final attachment/roster removal is still committing.
      if (visuals.has(agent.visualId)) return false;
      visuals.add(agent.visualId);
      return true;
    });
}

/** Agent-backed only: the status shortcuts navigate agents, not bare terminals.
 * `currentId` is the current ROW's id (the run): a managed row with no pane
 * has no session, and matching on a session id of undefined kept returning
 * the same second row instead of cycling (AR-5b). */
export function nextMonitorAgentForStatus(
  agents: readonly MonitorAgent[],
  status: AgentVisualStatus,
  currentId: string | undefined,
): MonitorAgent | undefined {
  const matching = agents.filter((agent) => agent.agent && agent.status === status);
  if (matching.length === 0) return undefined;
  const currentIndex =
    currentId === undefined ? -1 : matching.findIndex((agent) => agent.id === currentId);
  return matching[(currentIndex + 1) % matching.length];
}

export function monitorAgentCounts(
  agents: readonly MonitorAgent[],
): Record<AgentVisualStatus, number> {
  const counts: Record<AgentVisualStatus, number> = { idle: 0, working: 0, blocked: 0 };
  for (const agent of agents) {
    if (agent.agent) counts[agent.status] += 1;
  }
  return counts;
}
