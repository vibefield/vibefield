import type {
  MonitorReplicaAttachment,
  MonitorReplicaLocal,
} from "@vibecook/puppeteer-monitor/replica";
import type { MonitorActivity, MonitorAgentRow } from "@vibecook/puppeteer-view-sdk/model";
import type { HeldModelRow } from "./model-board";
import type { MonitorPaneFacts } from "./useMonitorAgents";

/**
 * MV-3b — WHAT ONLY THIS WINDOW KNOWS, as the replica joins it (`setLocal`).
 *
 * The backend computes every row once; a window holds its panes, the pane the
 * person is working in, the row they last pointed at, the places they asked
 * terminals to be born, and what each pane's terminal is doing (M28). Nothing
 * here derives a business fact: it maps the deck's facts, keyed by floor
 * session, onto the model's ids through the board rows the fold kept beside
 * the model (`HeldModelRow`), and hands the replica the join.
 *
 * THE JOINS, read off this desktop's board rows and never guessed:
 *   · a bare terminal's row stands for the floor session its board row names
 *     (`terminal.runtimeSessionId`, G3);
 *   · a run's row stands for the PTY its desk row names (`terminal`, hosted
 *     locally) — the pane join the fold has always made (AR-3);
 *   · a peer's row stands for the local replica an attach put in a pane here
 *     (`links`, DS-4), while that pane still shows it.
 */

/** This desktop's rows' joins, from the fold's held rows. */
export interface BoardJoins {
  /** floor session → the model id of the row standing for it */
  readonly rowBySession: ReadonlyMap<string, string>;
  /** model id → the floor session a pane mounts for it */
  readonly sessionByRow: ReadonlyMap<string, string>;
  /** model id → the run it was dealt to (agent rows) */
  readonly runByRow: ReadonlyMap<string, string>;
  /** run → the model id it was dealt (agent rows) */
  readonly rowByRun: ReadonlyMap<string, string>;
  /** AR-4 — a run resumed into a new PTY: the row, the PTY it replaced, the new one */
  readonly replacements: readonly { rowId: string; old: string; next: string }[];
  /** the terminal rows' ids, in the board's order */
  readonly terminalRows: readonly string[];
}

const NO_JOINS: BoardJoins = Object.freeze({
  rowBySession: new Map<string, string>(),
  sessionByRow: new Map<string, string>(),
  runByRow: new Map<string, string>(),
  rowByRun: new Map<string, string>(),
  replacements: Object.freeze([]),
  terminalRows: Object.freeze([]),
});

/** A board row is a terminal's when it is of the terminal kind and carries no status of its own. */
export function isTerminalBoardRow(
  board: HeldModelRow["board"],
): board is Extract<HeldModelRow["board"], { kind: "terminal" }> {
  return board.kind === "terminal" && !("status" in board);
}

export function boardJoins(held: readonly HeldModelRow[], here: string | undefined): BoardJoins {
  if (here === undefined) return NO_JOINS;
  const rowBySession = new Map<string, string>();
  const sessionByRow = new Map<string, string>();
  const runByRow = new Map<string, string>();
  const rowByRun = new Map<string, string>();
  const replacements: { rowId: string; old: string; next: string }[] = [];
  const terminalRows: string[] = [];
  for (const entry of held) {
    if (entry.device !== here) continue;
    const { board, row } = entry;
    if (isTerminalBoardRow(board)) {
      terminalRows.push(row.id);
      const session = board.terminal.runtimeSessionId ?? row.id;
      rowBySession.set(session, row.id);
      sessionByRow.set(row.id, session);
      continue;
    }
    runByRow.set(row.id, board.runtimeRunId);
    rowByRun.set(board.runtimeRunId, row.id);
    const terminal = board.terminal;
    if (terminal?.hosted !== "local") continue;
    const session = terminal.runtimeSessionId;
    if (session === undefined || session === "") continue;
    rowBySession.set(session, row.id);
    sessionByRow.set(row.id, session);
    if (terminal.replaced !== undefined) {
      replacements.push({ rowId: row.id, old: terminal.replaced, next: session });
    }
  }
  return { rowBySession, sessionByRow, runByRow, rowByRun, replacements, terminalRows };
}

/** A key over the joins, so a React memo recomputes them only when a join moved. */
export function boardJoinsKey(held: readonly HeldModelRow[], here: string | undefined): string {
  if (here === undefined) return "";
  const parts: string[] = [];
  for (const entry of held) {
    if (entry.device !== here) continue;
    const { board, row } = entry;
    const terminal = isTerminalBoardRow(board) ? board.terminal : board.terminal;
    parts.push(
      [
        row.id,
        isTerminalBoardRow(board) ? "t" : board.runtimeRunId,
        terminal?.hosted ?? "",
        terminal?.runtimeSessionId ?? "",
        terminal?.replaced ?? "",
      ].join("\u0001"),
    );
  }
  return parts.join("\u0002");
}

export interface WindowLocalInput {
  readonly joins: BoardJoins;
  /** which rows are terminals, by id: the model's word */
  readonly kindOf: (id: string) => MonitorAgentRow["kind"] | undefined;
  readonly panes: MonitorPaneFacts;
  /** DS-4 — a peer row's local replica, by row id, from the attach that put it there */
  readonly links: ReadonlyMap<string, string>;
  /** the row the person last pointed at, mounted nowhere yet */
  readonly previewSelectedId: string | undefined;
  /** SB-3 — where each terminal was asked for, by FLOOR SESSION (the door's answer, or a claim) */
  readonly spawnHints: ReadonlyMap<string, { x: number; y: number }>;
  readonly receded: ((row: MonitorAgentRow) => boolean) | undefined;
  readonly visible: (row: MonitorAgentRow) => boolean;
}

/** The pane join for a floor session: the row standing for it here, or the peer row attached as it. */
function rowOfSession(input: WindowLocalInput, sessionId: string): string | undefined {
  const own = input.joins.rowBySession.get(sessionId);
  if (own !== undefined) return own;
  for (const [rowId, local] of input.links) if (local === sessionId) return rowId;
  return undefined;
}

export function windowLocal(input: WindowLocalInput): MonitorReplicaLocal {
  const { panes } = input;
  // The deck owns pane colours and keeps them while this monitor is closed. A
  // session wears its active pane's colour, or its first pane's when none of
  // its panes is active (record §02).
  const paneIds = panes.paneIds ?? [];
  const bySession = new Map<string, string[]>();
  paneIds.forEach((paneId, index) => {
    const sessionId = panes.sessionIds[index];
    if (sessionId === undefined) return;
    const list = bySession.get(sessionId) ?? [];
    list.push(paneId);
    bySession.set(sessionId, list);
  });
  const attachments = new Map<string, MonitorReplicaAttachment>();
  for (const [sessionId, ids] of bySession) {
    const rowId = rowOfSession(input, sessionId);
    if (rowId === undefined) continue;
    const activeIndex = panes.activePaneId === undefined ? -1 : ids.indexOf(panes.activePaneId);
    const primaryPaneId = ids[activeIndex >= 0 ? activeIndex : 0] as string;
    const colour = panes.paneColors?.get(primaryPaneId);
    attachments.set(rowId, {
      panes: ids.length,
      ...(colour !== undefined ? { colour } : {}),
    });
  }
  // The pane the person is working in, and the row they pointed at (a weaker
  // claim, kept apart in the seam; the replica's one word for both is `active`).
  const activeIds = new Set<string>();
  if (panes.activeSessionId !== undefined) {
    const rowId = rowOfSession(input, panes.activeSessionId);
    if (rowId !== undefined) activeIds.add(rowId);
  }
  if (input.previewSelectedId !== undefined) activeIds.add(input.previewSelectedId);
  // Spawn hints by the row the session stands for; a row not on the board yet
  // is keyed by the session, which is the id a bare terminal's row carries.
  const spawnHints = new Map<string, { x: number; y: number }>();
  for (const [sessionId, hint] of input.spawnHints) {
    const rowId = input.joins.rowBySession.get(sessionId) ?? sessionId;
    if (input.kindOf(rowId) === "agent") continue;
    spawnHints.set(rowId, hint);
  }
  // M28 — a terminal's activity as its pane hears it; agents' rows are the runtime's
  const activity = new Map<string, MonitorActivity>();
  for (const session of panes.sessions ?? []) {
    const kind = session.activity?.kind;
    if (kind === undefined) continue;
    const rowId = input.joins.rowBySession.get(session.id);
    if (rowId === undefined || input.kindOf(rowId) !== "terminal") continue;
    activity.set(rowId, { kind });
  }
  return {
    attachments,
    activeIds,
    spawnHints,
    activity,
    visible: input.visible,
    ...(input.receded !== undefined ? { receded: input.receded } : {}),
  };
}

/** A key over the deck's pane facts the join reads, so the join is rebuilt only
 * when one of them moved (the deck republishes at ghosttea's cadence). */
export function paneFactsKey(panes: MonitorPaneFacts): string {
  return [
    panes.sessionIds.join("\u0000"),
    (panes.paneIds ?? []).join("\u0000"),
    (panes.paneIds ?? []).map((id) => panes.paneColors?.get(id) ?? "").join("\u0000"),
    panes.activePaneId ?? "",
    panes.activeSessionId ?? "",
    (panes.sessions ?? [])
      .map((session) => `${session.id}:${session.exited ? 1 : 0}:${session.activity?.kind ?? ""}`)
      .join("\u0000"),
  ].join("\u0001");
}
