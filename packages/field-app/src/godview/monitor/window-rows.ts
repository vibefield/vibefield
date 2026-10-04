import type { AgentView, MonitorModel } from "@vibecook/puppeteer-view-sdk/model";
import type { MonitorAgent as ViewsMonitorAgent } from "@vibecook/puppeteer-views";
import { type LegacyShimOptions, toMonitorAgents } from "@vibecook/puppeteer-views/legacy";
import type { RowsDeviceState } from "@vibefield/contracts";
import type { HeldModelRow } from "./model-board";
import type { MonitorPaneFacts } from "./useMonitorAgents";
import { isTerminalBoardRow } from "./window-local";

/**
 * MV-3b (L9, M4, M9) — THE WINDOW'S ROWS: the legacy shim's rows for the
 * replica's model, in VibeField's words, with the facts the shim cannot know
 * because they are this WINDOW's and not the model's:
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
 * list, a row nothing patched is the shim's own object, and a patched row is
 * the same object while its patch is. Pure; nothing here dials.
 */

/** VibeField's shim words (M4, M9): the reply-first line; peers carry no core facts. */
export const VIBEFIELD_SHIM: LegacyShimOptions = Object.freeze({
  detail: "reply-first",
  peerMonitor: "omit",
});

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
  rowsFor(model: MonitorModel, facts: WindowRowFacts): readonly ViewsMonitorAgent[];
}

interface Patched {
  readonly key: string;
  readonly row: ViewsMonitorAgent;
}

function sameList<T>(left: readonly T[], right: readonly T[]): boolean {
  return left.length === right.length && left.every((item, index) => item === right[index]);
}

/** The patch a row needs, as a key: nothing (the shim's row stands), or what moved. */
function patchKey(shim: ViewsMonitorAgent, facts: WindowRowFacts, visualId: string): string {
  const parts: string[] = [];
  if (shim.remote !== undefined) {
    const live = facts.standing.get(shim.remote.deviceId) === "live";
    parts.push(live ? "peer:live" : "peer:greyed");
  }
  if (visualId !== shim.id) parts.push(`visual:${visualId}`);
  return parts.join("\u0001");
}

function patch(shim: ViewsMonitorAgent, key: string): ViewsMonitorAgent {
  let row: ViewsMonitorAgent = shim;
  for (const part of key.split("\u0001")) {
    if (part === "peer:live" || part === "peer:greyed") {
      const { profileSet: _owners, stale: _owner, ...rest } = row;
      row = part === "peer:greyed" ? { ...rest, stale: true } : rest;
    } else if (part.startsWith("visual:")) {
      row = { ...row, visualId: part.slice("visual:".length) };
    }
  }
  return Object.freeze(row);
}

export function createWindowRows(): WindowRows {
  const patched = new WeakMap<ViewsMonitorAgent, Patched>();
  /** every row's visual id last time: the seam's carry-forward (`previousVisualIds`) */
  let previousVisual: ReadonlyMap<string, string> = new Map();
  let lastModel: MonitorModel | undefined;
  let lastFacts: WindowRowFacts | undefined;
  let last: readonly ViewsMonitorAgent[] = Object.freeze([]);
  return {
    rowsFor(model, facts) {
      if (model === lastModel && facts === lastFacts) return last;
      const shim = toMonitorAgents(model, VIBEFIELD_SHIM);
      const shimById = new Map<string, ViewsMonitorAgent>();
      for (const row of shim) shimById.set(row.id, row);
      // the stage's order: the facts' ids first, then whatever the model holds beyond them
      const ordered: ViewsMonitorAgent[] = [];
      const placed = new Set<string>();
      for (const id of facts.order) {
        const row = shimById.get(id);
        if (row === undefined || placed.has(id)) continue;
        placed.add(id);
        ordered.push(row);
      }
      for (const row of shim) if (!placed.has(row.id)) ordered.push(row);
      const rows: ViewsMonitorAgent[] = [];
      const bodies = new Set<string>();
      const visuals = new Map<string, string>();
      for (const row of ordered) {
        const session = row.remote === undefined ? facts.sessionByRow.get(row.id) : undefined;
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
        const key = patchKey(row, facts, visualId);
        if (key === "") {
          rows.push(row);
          continue;
        }
        const held = patched.get(row);
        if (held?.key === key) {
          rows.push(held.row);
          continue;
        }
        const made = patch(row, key);
        patched.set(row, { key, row: made });
        rows.push(made);
      }
      // the seam carried forward only the rows it drew
      previousVisual = new Map(rows.map((row) => [row.id, visuals.get(row.id) ?? row.id]));
      // the shim's own list while every row is its own; the last list while nothing moved
      last = sameList(rows, shim) ? shim : sameList(rows, last) ? last : Object.freeze(rows);
      lastModel = model;
      lastFacts = facts;
      return last;
    },
  };
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

/** The desktop a row lives on: a peer's own, else this one (`here`). */
export function deviceOfRow(row: ViewsMonitorAgent, here: string | undefined): string | undefined {
  return row.remote?.deviceId ?? here;
}

/**
 * DS-3 — the chosen desktop's rows (all of them for null): the device filter
 * NARROWS what the views are handed and nothing else; the claims count every
 * row. The same list when nothing is dropped.
 */
export function narrowToDevice(
  rows: readonly ViewsMonitorAgent[],
  device: string | null,
  here: string | undefined,
): readonly ViewsMonitorAgent[] {
  if (device === null) return rows;
  const kept = rows.filter((row) => deviceOfRow(row, here) === device);
  return kept.length === rows.length ? rows : kept;
}
