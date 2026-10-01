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
import { classifyRemoteStatus, type MonitorMeshRecord, remoteDetail } from "./mesh-rows";
import { remoteRowId } from "./remote-door";
import type { MonitorAgent, MonitorDeviceFacet } from "./types";

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
  /** SB-3 — where a create in flight asked for it, when this row is its first
   * appearance (a new shell can reach the stage through the roster first). */
  spawnHint?: { x: number; y: number };
}

export type { MonitorMeshRecord } from "./mesh-rows";

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
  /** DS-3 — other desktops' runs, off the mesh board. Empty is the honest
   * answer on a desktop alone — there are no placeholder peers. */
  mesh?: readonly MonitorMeshRecord[];
  /** DS-3 — this desktop, as the roster names it: every local row carries it
   * as its `device`. Absent until the roster (or the board) has said which
   * desktop this is; the rows then carry none rather than a guess. */
  here?: MonitorDeviceFacet;
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
    ...(record.spawnHint !== undefined ? { spawnHint: record.spawnHint } : {}),
  };
}

/**
 * DS-3 — another desktop's run as a monitor citizen, off the mesh board.
 *
 * Everything here is what its OWNER said, and what the owner did not send is
 * absent rather than guessed: no `session` (no local terminal exists until the
 * row is attached), no `cwd` (only the folder's NAME crosses — EL7 B1 — kept
 * under `remote.cwdLabel` where nothing will try to spawn in it), no mirror and
 * no usage ledger (a mirror never crosses desktops; the desk row is the
 * board's whole account of a run). It is an AGENT row — the owner's fold
 * derived its status, so it can be blocked, and the counters count it — and
 * it belongs to no project this desktop has dealt a colour, so it wears the
 * ramp. A desktop that is not `live` greys its rows and keeps them (DS-L8).
 *
 * Undefined for a run its owner says is not alive.
 */
export function monitorAgentFromMesh(
  record: MonitorMeshRecord,
  colours: MonitorColours,
): MonitorAgent | undefined {
  const { row, device, state } = record;
  const status = classifyRemoteStatus(row);
  if (status === undefined) return undefined;
  const live = state === "live";
  const folder = row.project?.name;
  const createdAtMs = Date.parse(row.createdAt);
  const branch = row.project?.branch ?? undefined;
  const model = row.model?.displayName || row.model?.id;
  return {
    id: remoteRowId(device.id, row.runtimeRunId),
    createdAtMs: Number.isFinite(createdAtMs) ? createdAtMs : 0,
    tier: "remote",
    status,
    project: folder ?? providerLabel(row),
    // The desktop's NAME leads the line, as the PJ design's second line does
    // ("another desktop's name", §6.0): at the pinned views (a4b5290) an agent
    // body and an agent's list row draw no host of their own, so this line is
    // the only text that says where the run lives. pu-device's views draw the
    // OS mark and the name on the body; at that pin move the prefix goes.
    detail: `${device.name} · ${remoteDetail(row, status)}`,
    color: colours.neutral,
    ...(live ? {} : { stale: true }),
    active: false,
    remote: {
      deviceId: device.id,
      deviceName: device.name,
      // the run's PTY on ITS floor when the owner named one, the run otherwise
      remoteSessionId: row.terminal?.runtimeSessionId ?? row.runtimeRunId,
      // DS-4 — honest `false` until the terminal path across desktops lands
      // (forwarded tickets, the egress route, the take): nothing here can open
      // another desktop's terminal yet, and nothing may say this host lets
      // anyone type before a window could.
      attachable: false,
      hostWritable: false,
      cwdLabel: folder ?? null,
      ...(record.localSessionId !== undefined ? { localSessionId: record.localSessionId } : {}),
    },
    device,
    agent: {
      provider: { id: row.kind, label: providerLabel(row) },
      kind: row.kind,
      tier: row.tier,
      runtimeRunId: row.runtimeRunId,
      ...(row.profileId !== undefined ? { profileId: row.profileId } : {}),
      ...(model ? { model } : {}),
      ...(branch ? { branch } : {}),
      // no evidence clock crosses desktops: unknown while the desktop answers,
      // stale once it does not
      recency: live ? "unknown" : "stale",
      remoteRow: row,
    },
  };
}

/**
 * The one projection every view consumes: managed agents first in launch order,
 * then the terminals no agent has claimed, then other desktops' runs off the
 * mesh board (DS-3). Pure, so the seam is testable without a renderer.
 *
 * The remotes come LAST and as their own segment because the order on this
 * stage is a claim about locality — another desktop's run is a guest, and the
 * list view's own ordering rules run over the result anyway. Every row says
 * which desktop it lives on (`device`): this one's when the roster has named
 * it (`input.here`), the board's owner on a remote row.
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
    const terminal = agent.agent?.summary?.terminal;
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
  const remotes = (input.mesh ?? [])
    .map((record) => monitorAgentFromMesh(record, input.colours))
    .filter((agent): agent is MonitorAgent => agent !== undefined);
  // this desktop's rows say so (DS-3); a remote row already carries its owner
  const here = input.here;
  const placed = (agent: MonitorAgent): MonitorAgent =>
    here === undefined || agent.remote !== undefined ? agent : { ...agent, device: here };

  const visuals = new Set<string>();
  return [...agents, ...terminals, ...floor, ...remotes]
    .map((agent) => {
      // A pane shows a LOCAL session: the row's own, or, for a peer's row, the
      // replica the attach put there. The same question, asked of the id that
      // exists.
      const localId =
        agent.session?.id ??
        agent.remote?.localSessionId ??
        agent.agent?.summary?.terminal?.runtimeSessionId ??
        agent.floorSessionId;
      const attachment = localId === undefined ? undefined : input.attachments?.get(localId);
      const mounted = localId !== undefined && input.activeSessionId === localId;
      return {
        ...placed(agent),
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
  // DS-3: a ring acts on the ACTIVE pane, so it cycles the runs a pane here can
  // take — another desktop's run joins the rings when DS-4 makes it attachable
  const matching = agents.filter(
    (agent) =>
      agent.agent &&
      agent.status === status &&
      (agent.remote === undefined || agent.remote.attachable),
  );
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
