import type { AgentView, MonitorModel } from "@vibecook/puppeteer-view-sdk/model";
import type { RowsDeviceState } from "@vibefield/contracts";
import { type HeldModelRow, isTerminalBoardRow } from "./model-board";
import type { MonitorPaneFacts } from "./useMonitorAgents";

/**
 * THE WINDOW'S ROWS (MV-3b, MV-8): the replica's model rows, with this
 * window's membership, order and standing. Business facts stay the backend's:
 *
 *   · a PEER's greying is its desktop's STANDING on the board (DS-L8), never
 *     the owner's evidence clock — no evidence clock crosses desktops, and the
 *     seam drew a peer `stale` exactly when its desktop was not `live`
 *     (`monitorAgentFromMesh`); the owner's `stale` is overwritten here;
 *   · a PEER runs under no Agent Profile of this device's (`agentProfileSet`):
 *     the owner's set id is dropped, so a peer's `native` agents never light
 *     under This Mac in the spawn bloom (SB-D8) and recede under a chosen tab;
 *   · the swarm's SPATIAL identity (`visualId`): the body the deck transferred
 *     across a launcher hand-off (`terminalVisualIds`: a launched agent keeps
 *     the fresh shell's body, GT-5c), else the one the row wore last time, else
 *     the floor session it stands for, else its id — the seam's rule, and its
 *     one rule over it: one body per visual identity, the earlier row wins;
 *   · the ORDER the seam drew: this desktop's agents by birth, then the panes'
 *     terminals in pane order, then the floor's, then other desktops' runs as
 *     their boards list them. The rain claims columns in display order, so the
 *     order is a thing a person sees.
 *
 * A TERMINAL's status is NOT decided here (M36): the replica's join reads it
 * off the activity this window supplies (M28), by the backend's one classifier,
 * on its own clock — so a shell running a foreground job reads `working` as it
 * did when the seam classified the pane's summary, and the window keeps no
 * second copy of the rule.
 *
 * Identity is kept (MV-D21): the same model and the same facts give the same
 * list, a row nothing patched is the replica's own object, and a patched row is
 * the same object while its patch is. Pure; nothing here dials.
 */

export interface WindowRowFacts {
  /** each desktop's standing on the board (DS-L8), by device id */
  readonly standing: ReadonlyMap<string, RowsDeviceState>;
  /** the ids in the order the stage draws them (`rowOrder`) */
  readonly order: readonly string[];
  /** the floor session each of this desktop's rows stands for (`BoardJoins.sessionByRow`) */
  readonly sessionByRow: ReadonlyMap<string, string>;
  /** the deck's visual ids, by floor session (a launcher hand-off's transfer) */
  readonly visualIds: ReadonlyMap<string, string> | undefined;
}

export interface WindowRows {
  /** every row of the model, patched and ordered for this window; the same list while nothing moved */
  rowsFor(model: MonitorModel, facts: WindowRowFacts): readonly AgentView[];
}

interface Patched {
  readonly stale: boolean;
  readonly visualId: string;
  readonly row: AgentView;
}

function sameList<T>(left: readonly T[], right: readonly T[]): boolean {
  return left.length === right.length && left.every((item, index) => item === right[index]);
}

export function createWindowRows(): WindowRows {
  const patched = new WeakMap<AgentView, Patched>();
  /** every row's visual id last time: the seam's carry-forward (`previousVisualIds`) */
  let previousVisual: ReadonlyMap<string, string> = new Map();
  let lastModel: MonitorModel | undefined;
  let lastFacts: WindowRowFacts | undefined;
  let last: readonly AgentView[] = Object.freeze([]);
  return {
    rowsFor(model, facts) {
      if (model === lastModel && facts === lastFacts) return last;
      // the stage's order: the facts' ids first, then whatever the model holds beyond them
      const ordered: AgentView[] = [];
      const placed = new Set<string>();
      for (const id of facts.order) {
        const row = model.byId.get(id);
        if (row === undefined || placed.has(id)) continue;
        placed.add(id);
        ordered.push(row);
      }
      for (const row of model.agents) if (!placed.has(row.id)) ordered.push(row);
      const rows: AgentView[] = [];
      const bodies = new Set<string>();
      const visuals = new Map<string, string>();
      for (const row of ordered) {
        const session = row.device.self ? facts.sessionByRow.get(row.id) : undefined;
        const visualId =
          (session === undefined ? undefined : facts.visualIds?.get(session)) ??
          previousVisual.get(row.id) ??
          session ??
          row.id;
        visuals.set(row.id, visualId);
        // one body per visual identity: during a launcher hand-off the managed
        // row takes over the shell's body while the shell's row is still here
        if (bodies.has(visualId)) continue;
        bodies.add(visualId);
        const stale = row.device.self ? row.stale : facts.standing.get(row.device.id) !== "live";
        if (
          row.stale === stale &&
          (row.device.self || row.profileSet === undefined) &&
          (row.visualId ?? row.id) === visualId
        ) {
          rows.push(row);
          continue;
        }
        const held = patched.get(row);
        if (held?.stale === stale && held.visualId === visualId) {
          rows.push(held.row);
          continue;
        }
        const { profileSet, visualId: _previous, ...rest } = row;
        const made: AgentView = Object.freeze({
          ...rest,
          stale,
          ...(row.device.self && profileSet !== undefined ? { profileSet } : {}),
          ...(visualId !== row.id ? { visualId } : {}),
        });
        patched.set(row, { stale, visualId, row: made });
        rows.push(made);
      }
      // the seam carried forward only the rows it drew
      previousVisual = new Map(rows.map((row) => [row.id, visuals.get(row.id) ?? row.id]));
      // the replica's own list while every row is its own; the last list while nothing moved
      last = sameList(rows, model.agents)
        ? model.agents
        : sameList(rows, last)
          ? last
          : Object.freeze(rows);
      lastModel = model;
      lastFacts = facts;
      return last;
    },
  };
}

/**
 * M59 — each drawn row's spatial identity, for the replica's local join
 * (`setLocal({ visualIds })`): the visual id the window rows gave a row, kept
 * only where it is not the row's own id, since a view reads `visualId ?? id`.
 */
export function visualIdsOf(rows: readonly AgentView[]): ReadonlyMap<string, string> {
  const ids = new Map<string, string>();
  for (const row of rows) {
    if (row.visualId !== undefined && row.visualId !== row.id) ids.set(row.id, row.visualId);
  }
  return ids;
}

/** The same entries, so a window can keep handing the join the SAME map while no body moved (M64). */
export function sameVisualIds(
  left: ReadonlyMap<string, string>,
  right: ReadonlyMap<string, string>,
): boolean {
  if (left === right) return true;
  if (left.size !== right.size) return false;
  for (const [id, visualId] of right) if (left.get(id) !== visualId) return false;
  return true;
}

/**
 * The ids in the order the seam drew its rows: this desktop's agents by birth
 * (the model's own order among agents), then its terminals — the panes' in pane
 * order, the floor's in roster order, the rest by birth — then other desktops'
 * rows as their boards listed them (the fold holds them in that order).
 */
export function rowOrder(
  held: readonly HeldModelRow[],
  here: string | undefined,
  panes: MonitorPaneFacts,
): readonly string[] {
  const agents: HeldModelRow[] = [];
  const terminals: HeldModelRow[] = [];
  const peers: string[] = [];
  for (const entry of held) {
    if (entry.device !== here) {
      peers.push(entry.row.id);
      continue;
    }
    if (isTerminalBoardRow(entry.board)) terminals.push(entry);
    else agents.push(entry);
  }
  agents.sort((left, right) => left.row.createdAt - right.row.createdAt);
  const paneRank = new Map<string, number>();
  panes.sessionIds.forEach((sessionId, index) => {
    if (!paneRank.has(sessionId)) paneRank.set(sessionId, index);
  });
  const floorRank = new Map<string, number>();
  (panes.floor ?? []).forEach((row, index) => {
    if (!floorRank.has(row.sessionId)) floorRank.set(row.sessionId, index);
  });
  const rank = (entry: HeldModelRow): [number, number] => {
    const session = isTerminalBoardRow(entry.board)
      ? (entry.board.terminal.runtimeSessionId ?? entry.row.id)
      : entry.row.id;
    const pane = paneRank.get(session);
    if (pane !== undefined) return [0, pane];
    const floor = floorRank.get(session);
    if (floor !== undefined) return [1, floor];
    return [2, entry.row.createdAt];
  };
  terminals.sort((left, right) => {
    const [groupL, withinL] = rank(left);
    const [groupR, withinR] = rank(right);
    return groupL - groupR || withinL - withinR;
  });
  return [
    ...agents.map((entry) => entry.row.id),
    ...terminals.map((entry) => entry.row.id),
    ...peers,
  ];
}

interface RowOrderFact {
  readonly id: string;
  readonly device: string;
  readonly createdAt: number;
  readonly terminal: string | undefined;
}

function orderTerminal(entry: HeldModelRow): string | undefined {
  return isTerminalBoardRow(entry.board)
    ? (entry.board.terminal.runtimeSessionId ?? entry.row.id)
    : undefined;
}

/** Ordering changes with membership, birth, desktop and pane/floor order,
 * never a token tick. Keep copies of those facts so a republished or mutated
 * input cannot make the cache overlook a hand-off or a reordered pane. */
export function createRowOrder(): typeof rowOrder {
  let facts: readonly RowOrderFact[] | undefined;
  let lastHere: string | undefined;
  let paneIds: readonly string[] = [];
  let floorIds: readonly string[] = [];
  let last: readonly string[] = Object.freeze([]);
  return (held, here, panes) => {
    const floor = panes.floor ?? [];
    const previous = facts;
    if (
      previous !== undefined &&
      here === lastHere &&
      held.length === previous.length &&
      held.every((entry, index) => {
        const was = previous[index];
        return (
          was !== undefined &&
          was.id === entry.row.id &&
          was.device === entry.device &&
          was.createdAt === entry.row.createdAt &&
          was.terminal === orderTerminal(entry)
        );
      }) &&
      sameList(panes.sessionIds, paneIds) &&
      floor.length === floorIds.length &&
      floor.every((entry, index) => entry.sessionId === floorIds[index])
    ) {
      return last;
    }
    const next = rowOrder(held, here, panes);
    if (!sameList(next, last)) last = Object.freeze(next);
    facts = held.map((entry) => ({
      id: entry.row.id,
      device: entry.device,
      createdAt: entry.row.createdAt,
      terminal: orderTerminal(entry),
    }));
    lastHere = here;
    paneIds = [...panes.sessionIds];
    floorIds = floor.map((entry) => entry.sessionId);
    return last;
  };
}

/** The desktop a row lives on: a peer's own, else this one (`here`). */
export function deviceOfRow(row: AgentView, here: string | undefined): string | undefined {
  return row.device.self ? here : row.device.id;
}

/**
 * DS-3 — the chosen desktop's rows (all of them for null): the device filter
 * NARROWS what the views are handed and nothing else; the claims count every
 * row. The same list when nothing is dropped.
 */
export function narrowToDevice(
  rows: readonly AgentView[],
  device: string | null,
  here: string | undefined,
): readonly AgentView[] {
  if (device === null) return rows;
  const kept = rows.filter((row) => deviceOfRow(row, here) === device);
  return kept.length === rows.length ? rows : kept;
}
