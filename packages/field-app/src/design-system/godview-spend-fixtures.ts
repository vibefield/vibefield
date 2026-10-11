import type { AgentView } from "@vibecook/puppeteer-view-sdk/model";
import { type SpendAfternoon, spendAfternoon, spendRows } from "@vibecook/puppeteer-views";
import type {
  AgentModelBoardRow,
  AgentModelMeshDevice,
  AgentModelMeshOpen,
  MonitorAgentRow as WireMonitorRow,
} from "@vibefield/contracts";
import type { ModelBoardPort, MonitorDoor } from "../godview/monitor/remote-door";
import { NO_HISTORY, NO_USAGE, THIS_MAC } from "./godview-profiles-fixtures";

// MV-7 — the catalog's spend view on a fixture door: the views package's own
// afternoon (`spendAfternoon` · `spendRows`: the rows a replica hands the view,
// each priced row with its ten-minute series) said as the model board says rows,
// this desktop's own and a peer's, so the specimen drives the shipping path
// whole — door, the window's replica, the view. Each second the board says the
// afternoon again as of then, as the views package's lab does, so the lines
// keep climbing toward now. What the window joins (a row's colour from its
// project's sequence, its pane, the receded mark, `device.self`) is the
// window's and never rides the wire, so a catalog with no deck shows no pane.
// Examples, not anyone's sessions: nothing spawns, and nothing here prices.

/** The board says the afternoon again this often, as the lab ticks. */
const SPEND_TICK_MS = 1_000;

const iso = (ms: number): string => new Date(ms).toISOString();

/** A row as the wire carries it (the contract's row): no reader-relative
 * `self` and no window join; a peer's row carries no colour sequence (M16). */
function wireRowOf(row: AgentView, device: string, peer: boolean): WireMonitorRow {
  const {
    colour: _colour,
    active: _active,
    receded: _receded,
    attachment: _attachment,
    spawnHint: _spawnHint,
    visualId: _visualId,
    device: owner,
    project,
    ...facts
  } = row;
  const { seq, ...named } = project;
  return {
    ...facts,
    device: peer
      ? { id: device, name: owner.name, ...(owner.os === undefined ? {} : { os: owner.os }) }
      : { id: device, name: THIS_MAC.name, os: "mac" },
    project: peer || seq === undefined ? named : { ...named, seq },
  } as unknown as WireMonitorRow;
}

/** One row as its desktop's model board lists it: a run's desk row, or a bare terminal's. */
function boardRowOf(
  row: AgentView,
  device: string,
  peer: boolean,
  revision: number,
): AgentModelBoardRow {
  const monitorRow = wireRowOf(row, device, peer);
  if (row.kind === "terminal") {
    return {
      runtimeRunId: row.id,
      revision,
      kind: "terminal",
      device,
      terminal: { hosted: "local", runtimeSessionId: row.id },
      monitorRow,
    } as AgentModelBoardRow;
  }
  const provider = row.provider;
  if (provider === undefined) throw new Error(`the spend fixture's run ${row.id} names no agent`);
  return {
    runtimeRunId: row.id,
    revision,
    kind: provider.id,
    label: provider.label,
    tier: row.tier ?? (peer ? "remote" : "managed"),
    device,
    status: row.status,
    statusSince: iso(row.statusSince),
    stateChangedAt: iso(row.statusSince),
    createdAt: iso(row.createdAt),
    alive: row.alive,
    blockers: [],
    project: {
      name: row.project.name,
      ...(row.project.branch === undefined ? {} : { branch: row.project.branch }),
    },
    monitorRow,
  } as AgentModelBoardRow;
}

/** Every desktop's board as of `nowMs`: this one first (the answering desktop
 * leads the open, as fieldd lists itself), then each peer the afternoon has. */
export function spendBoards(
  afternoon: SpendAfternoon,
  nowMs: number,
  revision: number,
): AgentModelMeshDevice[] {
  const here: AgentView[] = [];
  const peers = new Map<string, AgentView[]>();
  for (const row of spendRows(afternoon, nowMs)) {
    if (row.device.self) here.push(row);
    else peers.set(row.device.id, [...(peers.get(row.device.id) ?? []), row]);
  }
  const asOf = iso(nowMs);
  const board = (device: string, rows: readonly AgentView[], peer: boolean) => ({
    device,
    state: "live" as const,
    asOf,
    snapshot: {
      epoch: `${device}.spend`,
      revision,
      rows: rows.map((row) => boardRowOf(row, device, peer, revision)),
    },
  });
  return [
    board(THIS_MAC.id, here, false),
    ...[...peers].map(([device, rows]) => board(device, rows, true)),
  ];
}

/** A door with the afternoon's boards in it, and no deck. */
export function spendDoor(originMs: number = Date.now()): MonitorDoor {
  const afternoon = spendAfternoon(originMs);
  let revision = 0;
  const model: ModelBoardPort = {
    subscribe: async (onFrame) => {
      revision += 1;
      const open: AgentModelMeshOpen = { devices: spendBoards(afternoon, Date.now(), revision) };
      const timer = setInterval(() => {
        revision += 1;
        for (const { device, snapshot } of spendBoards(afternoon, Date.now(), revision)) {
          onFrame({ device, snapshot }, "delta");
        }
      }, SPEND_TICK_MS);
      return { snapshot: open, unsubscribe: () => clearInterval(timer) };
    },
    // nothing here is a backend: a shown row stays as the afternoon says it
    reportShown: async () => ({ reported: false }),
  };
  return {
    model,
    attach: async () => ({ state: "no-pane" }),
    createTerminal: async () => ({ state: "no-pane" }),
    mountLocal: async () => ({ state: "no-pane" }),
    transcripts: NO_HISTORY,
    usage: NO_USAGE,
  };
}
