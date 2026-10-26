import {
  AGENT_FIELD,
  type AgentListResult,
  type AgentModelBoardRow,
  type AgentModelDelta,
  type AgentModelSnapshot,
  type AgentSessionSummary,
  type AgentSessionTerminal,
} from "@vibefield/contracts";
import type { MonitorAgentRow } from "@vibefield/puppeteer-view-sdk/model";
import {
  type ProjectedDeskRow,
  type ProjectedTerminalRow,
  projectDeskRow,
  projectModelTerminalRow,
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
// never receive this board (the door refuses them; their upstream is the desk
// cut, `agent-field.ts`), so a terminal's directory stays on its device.
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
  return projectDeskRow(item.summary, chars, item.row, "window") as ProjectedDeskRow;
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
