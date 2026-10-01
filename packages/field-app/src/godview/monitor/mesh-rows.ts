import type { AgentVisualStatus } from "@vibecook/puppeteer-views";
import type { AgentFieldRow, RowsDeviceState } from "@vibefield/contracts";
import { blockerTool } from "./agent-status";
import { deviceFacet, type RosterView } from "./devices";
import type { MeshFieldSnapshot } from "./mesh-field";
import type { MonitorDeviceFacet } from "./types";

/**
 * DS-3 — ANOTHER DESKTOP'S RUNS, as the stage takes them.
 *
 * The mesh board hands this window each desktop's rows as their OWNER sent
 * them: field rows, which on the desk board also carry the reply line, the
 * blocker's question and the cost (`AgentDeskRow`'s extras). The board
 * validates the field facts; the desk's three are read here TOLERANTLY — a
 * desktop on an older daemon, or a field board, simply has none, and a row
 * never fails for a fact it did not send. Pure; nothing here dials.
 */

/** Another desktop's run, and where it lives. */
export interface MonitorMeshRecord {
  row: AgentFieldRow;
  device: MonitorDeviceFacet;
  /** the desktop's standing on the board: anything but `live` greys the row,
   * which keeps its place and its last facts (DS-L8) */
  state: RowsDeviceState;
  /** the local replica, when this row is showing in a pane here (DS-4) */
  localSessionId?: string;
}

const textAt = (value: unknown): string | undefined =>
  typeof value === "string" && value.trim() !== "" ? value.trim() : undefined;

/** The run's latest reply line, when the owner's desk row carried one. */
export function deskReply(row: AgentFieldRow): string | undefined {
  const message = (row as Record<string, unknown>)["lastAssistantMessage"];
  if (typeof message !== "object" || message === null) return undefined;
  return textAt((message as Record<string, unknown>)["text"]);
}

/** What a question blocker asks, in the run's own words (desk rows only). */
export function deskQuestion(blocker: Readonly<Record<string, unknown>>): string | undefined {
  return textAt(blocker["question"]);
}

/** The cost puppeteer estimated for the observed work (desk rows only). */
export function deskCost(row: AgentFieldRow): number | undefined {
  const cost = (row.usage as Record<string, unknown> | undefined)?.["costUsd"];
  return typeof cost === "number" && Number.isFinite(cost) ? cost : undefined;
}

/**
 * What another desktop's run is doing, from its owner's row — fieldd's one
 * derived status, read the way the fold's own rows are (`classifyAgentStatus`):
 * a run its owner says is not alive is no row; a pending one is idle.
 */
export function classifyRemoteStatus(row: AgentFieldRow): AgentVisualStatus | undefined {
  if (!row.alive) return undefined;
  if (row.pending !== undefined) return "idle";
  switch (row.status) {
    case "blocked":
      return "blocked";
    case "idle":
      return "idle";
    default:
      return "working";
  }
}

/** One line under the project, as `agentDetail` writes it for a local run:
 * what a blocked run is asking — its question when the desk carried one, else
 * the blocker's kind and tool — else its latest reply line, else its status. */
export function remoteDetail(row: AgentFieldRow, status: AgentVisualStatus): string {
  if (row.pending === "resume-when-idle") return "unobserved · resumes when idle";
  if (status === "blocked") {
    const blocker = row.blockers[0] as Readonly<Record<string, unknown>> | undefined;
    if (blocker === undefined) return "blocked";
    const question = deskQuestion(blocker);
    if (question !== undefined) return question;
    const kind = typeof blocker["kind"] === "string" ? blocker["kind"] : "blocked";
    const tool = blockerTool(blocker);
    return tool === undefined ? kind : `${kind} · ${tool}`;
  }
  return deskReply(row) ?? status;
}

/**
 * Which desktop is HERE: the roster's own row when the roster has answered,
 * else the board's first entry — fieldd lists the answering desktop first
 * (`AgentMeshOpen`). Undefined only before either has said.
 */
export function meshHere(field: MeshFieldSnapshot, roster: RosterView): string | undefined {
  if (roster.here !== undefined) return roster.here;
  for (const device of field.devices.keys()) return device;
  return undefined;
}

/** Every run the board holds for desktops OTHER than this one, each with its
 * device and that device's standing. This desktop's own runs stay the fold's
 * (the full rows, `GodviewAgentsProvider`); its board entry is not drawn twice. */
export function meshRecords(
  field: MeshFieldSnapshot,
  roster: RosterView,
): readonly MonitorMeshRecord[] {
  const here = meshHere(field, roster);
  const records: MonitorMeshRecord[] = [];
  for (const entry of field.devices.values()) {
    if (entry.device === here || entry.board === undefined) continue;
    const device = deviceFacet(entry.device, roster.byId, here);
    for (const row of entry.board.rows.values()) {
      records.push({ row, device, state: entry.state });
    }
  }
  return records;
}
