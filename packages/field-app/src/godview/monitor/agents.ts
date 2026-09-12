import type { SessionSummary } from "@vibecook/ghosttea-protocol";
import {
  type AgentVisualStatus,
  agentAccentSlot,
  agentDetail,
  classifyAgentStatus,
  classifyTerminalStatus,
  projectLabel,
  providerLabel,
} from "./agent-status";
import type { AgentSessionSummary } from "./facet-types";
import { folderName } from "./folder-name";
import { type RemoteSessionRow, remoteRowId } from "./remote-door";
import type { MonitorAgent, PaneAttachment } from "./types";

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
}

/** A peer's session, and where it landed here if it has (GT-D17). */
export interface MonitorRemoteRecord {
  row: RemoteSessionRow;
  /** The local replica's id, when this row is currently showing in a pane. */
  localSessionId?: string;
  /** The pane's color, when it is. Populated from the attach that put it there,
   * which is what makes `PaneAttachment` mean "a pane is showing this". */
  paneColor?: string;
}

export interface AssembleMonitorAgentsInput {
  /** The fold's rows (AR-3). */
  managed: readonly MonitorManagedRecord[];
  terminals: readonly MonitorTerminalRecord[];
  /** The mesh's half of the field. Empty is the honest answer with no floor
   * serving — there are no placeholder peers and no invented hosts. */
  remotes?: readonly MonitorRemoteRecord[];
  /** §2.6's accents, already resolved from the live tokens. Passed IN rather
   * than read here so this whole module stays a pure function — the reference's
   * property, kept, and the reason its tests need no renderer. */
  accents: readonly string[];
  /** Live summaries, so a terminal placeholder reflects current activity rather than launch state. */
  sessions?: ReadonlyMap<string, SessionSummary>;
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
}

function accentFor(id: string, accents: readonly string[]): string {
  return accents.length === 0 ? "" : (accents[agentAccentSlot(id, accents.length)] as string);
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

/** A managed row's monitor id: the floor session id when the fold names one
 * (the id the pane showing it carries — the deck↔monitor join), else the run. */
export function managedRowId(summary: AgentSessionSummary): string {
  return summary.terminal?.runtimeSessionId ?? summary.runtimeRunId;
}

/** Undefined for a session that has stopped being worth showing at all. */
export function monitorAgentFromManaged(
  record: MonitorManagedRecord,
  accents: readonly string[],
): MonitorAgent | undefined {
  const { summary, session } = record;
  if (session?.exited) return undefined;
  const status = classifyAgentStatus(summary);
  if (!status) return undefined;
  const monitor = summary.monitor;
  const observedCwd = monitor?.environment?.cwd;
  // The presence of the OBSERVATION decides, not the truthiness of the branch:
  // a git value of null authoritatively means "not in a repo", which is an
  // answer, and falling through to the workspace's branch would overwrite it.
  const git = monitor?.environment?.git;
  const branch = git !== undefined ? (git?.branch ?? undefined) : summary.workspace?.branch;
  const cwd = observedCwd || summary.workspace?.sourcePath || summary.workspace?.root || undefined;
  const model = monitor?.model;
  const context = monitor?.context;
  const id = managedRowId(summary);
  return {
    id,
    ...(session !== undefined ? { session } : {}),
    createdAtMs: session?.createdAtMs ?? Date.parse(summary.createdAt),
    status,
    project: projectLabel(summary),
    detail: agentDetail(summary, status),
    // accent by the RUN, which survives the pane: the same run keeps its
    // color whichever pane shows it, and across a fieldd restart (AR-4)
    color: accentFor(summary.runtimeRunId, accents),
    active: false,
    ...(cwd ? { cwd } : {}),
    agent: {
      kind: summary.kind,
      provider: providerLabel(summary),
      tier: summary.tier,
      runtimeRunId: summary.runtimeRunId,
      ...(summary.profileId !== undefined ? { profileId: summary.profileId } : {}),
      ...(model ? { model: model.displayName || model.id } : {}),
      ...(branch ? { branch } : {}),
      ...(context
        ? {
            contextWindow: {
              usedTokens: context.usedTokens,
              capacityTokens: context.capacityTokens,
              usedPercent: context.usedPercent,
              ...(model ? { modelId: model.id } : {}),
              updatedAt: summary.stateChangedAt,
            },
          }
        : {}),
      summary,
    },
  };
}

export function monitorAgentFromTerminal(
  record: MonitorTerminalRecord,
  accents: readonly string[],
): MonitorAgent {
  const { session, cwd, spawnHint } = record;
  const path = cwd ?? session.cwd ?? undefined;
  return {
    id: session.id,
    session,
    createdAtMs: session.createdAtMs,
    status: classifyTerminalStatus(session.activity),
    project: folderName(path, "terminal"),
    detail: path || "Unassigned terminal",
    color: accentFor(session.id, accents),
    active: false,
    ...(path ? { cwd: path } : {}),
    ...(spawnHint ? { spawnHint } : {}),
  };
}

/**
 * A peer's session as a monitor citizen (GT-D17).
 *
 * Everything here comes from what the peer reported, and the two fields it did
 * NOT report are absent rather than guessed: there is no `session` (no local
 * session exists until this row is attached) and no `cwd` (the peer's path is a
 * label, kept under `remote.cwdLabel` where nothing will try to spawn in it).
 *
 * The status classifier is the unclaimed terminal's, deliberately: a peer sends
 * terminal activity, not agent state, so a remote row can be working or idle
 * and never `waiting` — that word means an agent is asking for something, and
 * no agent has spoken here.
 */
export function monitorAgentFromRemote(
  record: MonitorRemoteRecord,
  accents: readonly string[],
): MonitorAgent {
  const { host, session } = record.row;
  const id = remoteRowId(host.deviceId, session.sessionId);
  return {
    id,
    createdAtMs: session.createdAtMs,
    status: classifyTerminalStatus(session.activity),
    project: folderName(session.cwdLabel, session.title || "remote"),
    // The host is in the detail as well as in the facet, because the detail is
    // what the swarm puts in a tooltip and the list prints as its own column: a
    // path with no machine attached to it is exactly the confusion GT-3's
    // finding warned of. (The rain does NOT read this — it builds its column
    // from `rainDataString`, which until GT-5c read `project` alone and drew a
    // peer's session as a local terminal. Fixed there, not by widening this.)
    detail: session.cwdLabel ? `${host.deviceName} · ${session.cwdLabel}` : host.deviceName,
    // Accent by the QUALIFIED id, so the same session id on two peers is two
    // colors and one peer's session keeps its color across refreshes.
    color: accentFor(id, accents),
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
      monitorAgentFromManaged(withPaneSummary(record, input.sessions), input.accents),
    )
    .filter((agent): agent is MonitorAgent => agent !== undefined)
    .sort((left, right) => left.createdAtMs - right.createdAtMs);
  const claimed = new Set(agents.map((agent) => agent.id));
  const terminals = input.terminals
    .filter((terminal) => !claimed.has(terminal.session.id))
    .map((terminal) =>
      monitorAgentFromTerminal(
        { ...terminal, session: input.sessions?.get(terminal.session.id) ?? terminal.session },
        input.accents,
      ),
    );
  const remotes = (input.remotes ?? []).map((record) => {
    const agent = monitorAgentFromRemote(record, input.accents);
    // A remote row's pane link comes from the attach that made it, not from the
    // `attachments` map (which is keyed by local session ids the projection
    // cannot know a peer's row by). `paneColor` present IS the pane fact:
    // the source only carries it while a pane is actually showing the replica.
    if (record.paneColor === undefined) return agent;
    return { ...agent, attachment: { primary: record.paneColor, mirrors: [] } };
  });

  return [...agents, ...terminals, ...remotes].map((agent) => {
    const attachment = agent.session ? input.attachments?.get(agent.session.id) : undefined;
    // A remote row is "active" when the pane the user is in shows ITS replica —
    // the same question as for a local row, asked of the id that exists.
    const activeId = agent.session?.id ?? agent.remote?.localSessionId;
    const mounted = activeId !== undefined && input.activeSessionId === activeId;
    return {
      ...agent,
      active: mounted || input.previewSelectedId === agent.id,
      ...(attachment ? { attachment } : {}),
    };
  });
}

/** Agent-backed only: the status shortcuts navigate agents, not bare terminals. */
export function nextMonitorAgentForStatus(
  agents: readonly MonitorAgent[],
  status: AgentVisualStatus,
  currentSessionId: string | undefined,
): MonitorAgent | undefined {
  const matching = agents.filter((agent) => agent.agent && agent.status === status);
  if (matching.length === 0) return undefined;
  const currentIndex = matching.findIndex((agent) => agent.session?.id === currentSessionId);
  return matching[(currentIndex + 1) % matching.length];
}

export function monitorAgentCounts(
  agents: readonly MonitorAgent[],
): Record<AgentVisualStatus, number> {
  const counts: Record<AgentVisualStatus, number> = { idle: 0, working: 0, waiting: 0 };
  for (const agent of agents) {
    if (agent.agent) counts[agent.status] += 1;
  }
  return counts;
}
