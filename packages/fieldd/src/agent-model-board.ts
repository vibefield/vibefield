import {
  AGENT_FIELD,
  type AgentListResult,
  type AgentModelBoardRow,
  type AgentModelDelta,
  type AgentModelSnapshot,
  type AgentRemoteDelta,
  type AgentRemoteRow,
  type AgentRemoteSnapshot,
  type AgentSessionSummary,
  type AgentSessionTerminal,
} from "@vibefield/contracts";
import type { MonitorAgentRow } from "@vibefield/puppeteer-view-sdk/model";
import {
  attachableRows,
  type ProjectedDeskRow,
  type ProjectedRemoteRow,
  type ProjectedTerminalRow,
  projectDeskRow,
  projectModelTerminalRow,
  projectRemoteRow,
  projectRemoteTerminalRow,
  remoteUrgentMs,
} from "./agent-field";
import type { AgentMonitorService } from "./agent-monitor";
import {
  projectRows,
  RevisionedSubscription,
  type RowsProjection,
  snapshotDeltaView,
} from "./projection";

// MV-3a (MV-D18, L8, L12, M16, M21) — THE MODEL BOARD: this desktop's own
// windows' cut of the model, through the one door (`agent.subscribe
// {projection: "model"}`).
//
// What a window's replica needs is ONE revision chain of the model's rows for
// this desktop: every run's row whole (the colour sequence dealt here, the
// texts as core bounded them) and every bare terminal as a row of its own kind
// (`AgentDeskTerminalRow`). The run rows ride as desk rows — the field half
// for the deck's pane join and for any reader that knows only field rows, the
// model's row beside it — and the terminal rows are the model's alone. Peers
// never receive this board (the door refuses them; their upstream is the
// remote cut below, PG-2), so the chrome's paths and the colour sequences stay
// on their device.
//
// Two sources move it: the fold's publish (the field half) and the backend's
// changes (the model half). Both signal the same subscription, and the
// projection decides what moved by the rows' JSON — a fold publish whose model
// rows did not change emits nothing. The floor is the fold's own 16 ms
// (`AGENT_FIELD.FULL_TICK_MS`, L12), and an URGENT model change — a status, a
// liveness, a wait, a birth or a death — goes out ahead of it when the floor has
// already elapsed (the leading edge in `RevisionedSubscription`).

/** One item of the board: a run (its fold row and, once assembled, its model
 * row) or a bare terminal (the model's row alone). */
type ModelItem =
  | { kind: "agent"; summary: AgentSessionSummary; row: MonitorAgentRow | undefined }
  | {
      kind: "terminal";
      row: MonitorAgentRow;
      join: Pick<AgentSessionTerminal, "cellBootId" | "workloadClass">;
    };

type ProjectedModelRow = ProjectedDeskRow | ProjectedTerminalRow;

/** The sources the board reads: the fold's rows, the backend's. */
export interface ModelBoardSources {
  fold: {
    list(): AgentListResult;
    subscribe(emit: (rows: AgentListResult) => void): () => void;
  };
  monitor: Pick<AgentMonitorService, "rowForRun" | "terminalRows" | "subscribe" | "terminalJoin">;
}

function itemsOf(sources: ModelBoardSources): ModelItem[] {
  const items: ModelItem[] = sources.fold.list().sessions.map((summary) => ({
    kind: "agent",
    summary,
    row: sources.monitor.rowForRun(summary.runtimeRunId),
  }));
  for (const row of sources.monitor.terminalRows())
    items.push({ kind: "terminal", row, join: sources.monitor.terminalJoin(row.id) ?? {} });
  return items;
}

function projectItem(item: ModelItem, chars: number): ProjectedModelRow {
  if (item.kind === "terminal") return projectModelTerminalRow(item.row, item.join);
  return projectDeskRow(item.summary, chars, item.row) as ProjectedDeskRow;
}

/** The model board's rows as a keyed table with the revisions that make deltas
 * possible (`projection.ts`'s machinery; one per reader). */
export class ModelProjection {
  readonly #rows: RowsProjection<ModelItem, ProjectedModelRow, AgentModelBoardRow>;

  constructor(chars: number = AGENT_FIELD.DESK_TEXT_CHARS) {
    this.#rows = projectRows({
      project: (item: ModelItem) => projectItem(item, chars),
      keyOf: (row: ProjectedModelRow) => row.runtimeRunId,
      stamp: (row: ProjectedModelRow, revision: number): AgentModelBoardRow =>
        ({ ...row, revision }) as AgentModelBoardRow,
    });
  }

  snapshot(): { revision: number; rows: AgentModelBoardRow[] } {
    const table = this.#rows.snapshot();
    return { revision: table.revision, rows: table.rows };
  }

  get revision(): number {
    return this.#rows.revision;
  }

  apply(sources: ModelBoardSources): AgentModelDelta | null {
    const change = this.#rows.apply(itemsOf(sources));
    if (change === null) return null;
    return {
      since: change.since,
      revision: change.revision,
      upserts: change.upserts,
      removed: change.removed,
    };
  }
}

export interface ModelSubscriptionOptions extends ModelBoardSources {
  emit: (delta: AgentModelDelta) => void;
  /** DS-L3 — this subscription's revision chain (the daemon mints it) */
  epoch?: string | undefined;
  /** the floor; `AGENT_FIELD.FULL_TICK_MS` by default (L12) */
  minIntervalMs?: number | undefined;
  heartbeatMs?: number | undefined;
  /** the bound on the desk half's own texts (never on the model row, M21) */
  chars?: number | undefined;
  onError?: ((error: unknown) => void) | undefined;
}

export interface ModelSubscription {
  snapshot: AgentModelSnapshot;
  dispose: () => void;
}

/** One `agent.subscribe {projection: "model"}` subscriber: a snapshot now,
 * then deltas at the fold's tick, urgent model changes on the leading edge. */
export function createModelSubscription(opts: ModelSubscriptionOptions): ModelSubscription {
  const projection = new ModelProjection(opts.chars);
  const sources: ModelBoardSources = { fold: opts.fold, monitor: opts.monitor };
  projection.apply(sources);
  const subscriber = new RevisionedSubscription({
    view: snapshotDeltaView<AgentModelBoardRow>({
      table: () => projection.snapshot(),
      apply: () => projection.apply(sources),
      revision: () => projection.revision,
      ...(opts.epoch !== undefined ? { epoch: opts.epoch } : {}),
    }),
    subscribe: (onChange) => {
      const offFold = opts.fold.subscribe(() => onChange());
      const offModel = opts.monitor.subscribe((_change, urgent) => onChange(urgent));
      return () => {
        offFold();
        offModel();
      };
    },
    emit: (frame) => opts.emit(frame as AgentModelDelta),
    minIntervalMs: opts.minIntervalMs ?? AGENT_FIELD.FULL_TICK_MS,
    ...(opts.heartbeatMs !== undefined ? { heartbeatMs: opts.heartbeatMs } : {}),
    ...(opts.onError !== undefined ? { onError: opts.onError } : {}),
  });
  return {
    snapshot: subscriber.snapshot as AgentModelSnapshot,
    dispose: () => subscriber.dispose(),
  };
}

// PG-2 (PG-L1, PG-D1 (a), PG-D5 (a), PG-D8 (a)) — THE REMOTE CUT: the same
// model, cut for every OTHER screen (`agent.subscribe {projection: "remote"}`).
// A peer daemon asks it at the local scope for its windows' mesh board, and the
// phone's home serves it at the mesh scope. The items are the model board's,
// each cut by its owner as a peer reads it (`projectRemoteRow`,
// `projectRemoteTerminalRow`): no `local`, no colour sequence, texts bounded, a
// terminal's directory by its folder. A run the backend has not assembled yet
// has no model row and no remote row; it joins the board when it has one.
//
// Three things the local cut does not do, because its readers are elsewhere:
//   · the terminal gate (F-M4) shapes every frame at send time — the join and
//     the model's attach promise withheld while this device's doors are down
//     (`attachableRows`) — and a flip of the gate re-presents the board
//     (PG-1d's `represent`, the daemon's watcher);
//   · its urgent edge is `remoteUrgentMs(floor)`: a peer window's 100 ms floor
//     is its own edge, and the phone's 1 s board sends an urgent change after
//     `AGENT_FIELD.REMOTE_URGENT_MS`;
//   · a lost frame is repaired by a mid-stream snapshot (`resets`), which every
//     reader of the rows protocol takes.

/** An item the remote cut has a row for: a bare terminal, or a run the backend
 * has assembled. */
type RemoteItem =
  | { kind: "agent"; summary: AgentSessionSummary; row: MonitorAgentRow }
  | Extract<ModelItem, { kind: "terminal" }>;

function remoteItemsOf(sources: ModelBoardSources): RemoteItem[] {
  return itemsOf(sources).filter((item): item is RemoteItem => item.row !== undefined);
}

function projectRemoteItem(item: RemoteItem, chars: number): ProjectedRemoteRow {
  if (item.kind === "terminal") return projectRemoteTerminalRow(item.row, item.join, chars);
  return projectRemoteRow(item.summary, item.row, chars);
}

/** The remote cut's rows as a keyed table (one per reader, as the local's). */
export class RemoteProjection {
  readonly #rows: RowsProjection<RemoteItem, ProjectedRemoteRow, AgentRemoteRow>;

  constructor(chars: number = AGENT_FIELD.DESK_TEXT_CHARS) {
    this.#rows = projectRows({
      project: (item: RemoteItem) => projectRemoteItem(item, chars),
      keyOf: (row: ProjectedRemoteRow) => row.runtimeRunId,
      stamp: (row: ProjectedRemoteRow, revision: number): AgentRemoteRow => ({ ...row, revision }),
    });
  }

  snapshot(): { revision: number; rows: AgentRemoteRow[] } {
    const table = this.#rows.snapshot();
    return { revision: table.revision, rows: table.rows };
  }

  get revision(): number {
    return this.#rows.revision;
  }

  apply(sources: ModelBoardSources): AgentRemoteDelta | null {
    const change = this.#rows.apply(remoteItemsOf(sources));
    if (change === null) return null;
    return {
      since: change.since,
      revision: change.revision,
      upserts: change.upserts,
      removed: change.removed,
    };
  }
}

export interface RemoteSubscriptionOptions extends ModelBoardSources {
  /** one frame: a delta, or a snapshot that replaces the reader's copy at the
   * board's current revision (a re-present on a gate flip, or a repair) */
  emit: (frame: AgentRemoteDelta | AgentRemoteSnapshot, kind: "delta" | "snapshot") => void;
  /** DS-L3 — this subscription's revision chain (the daemon mints it) */
  epoch?: string | undefined;
  /** the floor the caller is served at (`boardFloor`); a peer window's by default */
  minIntervalMs?: number | undefined;
  heartbeatMs?: number | undefined;
  /** TM-2 (F-M4) — are this device's terminal doors published on the tailnet?
   * Read at each frame; absent: they are (a caller with no tailnet question) */
  terminalPublished?: (() => boolean) | undefined;
  /** the bound on every text the cut carries (M21) */
  chars?: number | undefined;
  onError?: ((error: unknown) => void) | undefined;
}

export interface RemoteSubscription {
  snapshot: AgentRemoteSnapshot;
  /** PG-1d — the next frame re-presents the board as a snapshot at its current
   * revision: what a reader must hear when the gate that shapes the rows moved */
  represent: () => void;
  dispose: () => void;
}

/** One `agent.subscribe {projection: "remote"}` subscriber: a snapshot now, then
 * deltas at the caller's floor, urgent model changes at the remote edge. */
export function createRemoteSubscription(opts: RemoteSubscriptionOptions): RemoteSubscription {
  const projection = new RemoteProjection(opts.chars);
  const sources: ModelBoardSources = { fold: opts.fold, monitor: opts.monitor };
  const published = (): boolean => opts.terminalPublished?.() ?? true;
  const floor = opts.minIntervalMs ?? AGENT_FIELD.REMOTE_MIN_INTERVAL_MS;
  projection.apply(sources);
  const subscriber = new RevisionedSubscription({
    view: snapshotDeltaView<AgentRemoteRow>({
      table: () => projection.snapshot(),
      apply: () => projection.apply(sources),
      revision: () => projection.revision,
      ...(opts.epoch !== undefined ? { epoch: opts.epoch } : {}),
      present: (rows) => attachableRows(rows, published()),
      resets: true,
    }),
    subscribe: (onChange) => {
      const offFold = opts.fold.subscribe(() => onChange());
      const offModel = opts.monitor.subscribe((_change, urgent) => onChange(urgent));
      return () => {
        offFold();
        offModel();
      };
    },
    emit: (frame, kind) => opts.emit(frame as AgentRemoteDelta | AgentRemoteSnapshot, kind),
    minIntervalMs: floor,
    urgentIntervalMs: remoteUrgentMs(floor),
    ...(opts.heartbeatMs !== undefined ? { heartbeatMs: opts.heartbeatMs } : {}),
    ...(opts.onError !== undefined ? { onError: opts.onError } : {}),
  });
  return {
    snapshot: subscriber.snapshot as AgentRemoteSnapshot,
    represent: () => subscriber.resnapshot(),
    dispose: () => subscriber.dispose(),
  };
}
