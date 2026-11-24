import { DiagnosticLogDeltaV1, DiagnosticLogSnapshotV1 } from "@vibefield/contracts/diagnostics";
import { VitalsDeltaV1, VitalsSnapshotV1 } from "@vibefield/contracts/vitals";
import type { VitalsCapturesDoor } from "./vitals-captures-door";
import {
  EMPTY_INCIDENTS,
  type VitalsIncidentsState,
  withIncidentList,
  withIncidentMissing,
  withIncidentWhole,
} from "./vitals-incidents";
import { applyDelta, EMPTY_VITALS, modelFromSnapshot, type VitalsModel } from "./vitals-model";

// VT-2 (track VT, 2026-11-24) — THE VITALS WINDOW'S FEED, PURE. The window holds no daemon token and asks for
// nothing: Electron main relays fieldd's vitals door and the log doors over one port, and this folds what arrives.
// A frame that does not parse is dropped and counted, never guessed at (the tolerant reader).

/** Where a log line was read: fieldd's door (the daemons') or Electron main's own (the shell's). */
export type VitalsLogOrigin = "fieldd" | "shell";

export type VitalsFeedEvent =
  | { kind: "vitals"; event: "snapshot" | "delta"; payload: unknown }
  | { kind: "vitals"; event: "down" }
  | { kind: "logs"; origin: VitalsLogOrigin; event: "snapshot" | "delta"; payload: unknown }
  | { kind: "logs"; origin: VitalsLogOrigin; event: "down" }
  // VT-4b — one incident whole, read by main for the window, or the id it could not read
  | { kind: "incident"; event: "snapshot"; payload: unknown }
  | { kind: "incident"; event: "down"; id?: string };

/** The door the window's host hands the view: one stream, and a way to stop hearing it. */
export interface VitalsDoor {
  subscribe(handler: (event: VitalsFeedEvent) => void): () => void;
  /** VT-5 — the armed captures' door; absent where the host offers none (a plate, an older preload) */
  captures?: VitalsCapturesDoor;
  /** VT-4b — ask main for one incident whole; its answer arrives on the stream. Absent, nothing is asked. */
  openIncident?(id: string): void;
}

export interface VitalsLogLine {
  /** the producer's instance and its sequence: one line, however often it is sent */
  id: string;
  origin: VitalsLogOrigin;
  time: number;
  severity: string;
  service: string;
  component: string;
  pid: number;
  msg: string;
}

/** The lines the window keeps, newest last. A span on the lanes reads from these, so it reaches as far back as
 * they do and no further. */
export const VITALS_LOG_LINES_MAX = 2_000;

export interface VitalsFeedState {
  model: VitalsModel;
  logs: readonly VitalsLogLine[];
  /** frames dropped because they did not parse */
  rejected: number;
  /** VT-4b — the kept incidents, and the few read whole */
  incidents: VitalsIncidentsState;
}

export const EMPTY_FEED: VitalsFeedState = {
  model: EMPTY_VITALS,
  logs: [],
  rejected: 0,
  incidents: EMPTY_INCIDENTS,
};

interface RecordLike {
  time: number;
  severity: string;
  service: string;
  component: string;
  pid: number;
  msg: string;
  instanceId: string;
  seq: number;
}

function lineOf(origin: VitalsLogOrigin, record: RecordLike): VitalsLogLine {
  return {
    id: `${origin}:${record.instanceId}:${record.seq}`,
    origin,
    time: record.time,
    severity: record.severity,
    service: record.service,
    component: record.component,
    pid: record.pid,
    msg: record.msg,
  };
}

function mergeLines(
  kept: readonly VitalsLogLine[],
  origin: VitalsLogOrigin,
  records: readonly RecordLike[],
  replace: boolean,
): readonly VitalsLogLine[] {
  const base = replace ? kept.filter((line) => line.origin !== origin) : kept;
  if (records.length === 0) return base;
  const seen = new Set(base.map((line) => line.id));
  const merged = [...base];
  for (const record of records) {
    const line = lineOf(origin, record);
    if (seen.has(line.id)) continue;
    seen.add(line.id);
    merged.push(line);
  }
  // two producers' clocks interleave, so the lines are ordered by their own time; a tie keeps arrival order
  merged.sort((a, b) => a.time - b.time);
  return merged.length > VITALS_LOG_LINES_MAX ? merged.slice(-VITALS_LOG_LINES_MAX) : merged;
}

export function reduceFeed(state: VitalsFeedState, event: VitalsFeedEvent): VitalsFeedState {
  const reject = (): VitalsFeedState => ({ ...state, rejected: state.rejected + 1 });
  if (event.kind === "incident") {
    if (event.event === "down")
      return { ...state, incidents: withIncidentMissing(state.incidents, event.id) };
    const incidents = withIncidentWhole(state.incidents, event.payload);
    return incidents === null ? reject() : { ...state, incidents };
  }
  if (event.kind === "vitals") {
    if (event.event === "down") {
      // what was measured stays drawn; the state line says the door is shut
      return { ...state, model: { ...state.model, state: "unreachable", detail: null } };
    }
    if (event.event === "snapshot") {
      const parsed = VitalsSnapshotV1.safeParse(event.payload);
      return parsed.success
        ? {
            ...state,
            model: modelFromSnapshot(parsed.data),
            // VT-4b — a fieldd before incidents carries none, and none are shown
            incidents: withIncidentList(state.incidents, parsed.data.incidents ?? []),
          }
        : reject();
    }
    const parsed = VitalsDeltaV1.safeParse(event.payload);
    if (!parsed.success) return reject();
    const incidents = parsed.data.incidents;
    return {
      ...state,
      model: applyDelta(state.model, parsed.data),
      ...(incidents !== undefined
        ? { incidents: withIncidentList(state.incidents, incidents) }
        : {}),
    };
  }
  if (event.event === "down") return state;
  if (event.event === "snapshot") {
    const parsed = DiagnosticLogSnapshotV1.safeParse(event.payload);
    if (!parsed.success) return reject();
    return { ...state, logs: mergeLines(state.logs, event.origin, parsed.data.records, true) };
  }
  const parsed = DiagnosticLogDeltaV1.safeParse(event.payload);
  if (!parsed.success) return reject();
  return { ...state, logs: mergeLines(state.logs, event.origin, parsed.data.records, false) };
}

/** The severities the window marks; every other line is an ordinary one. */
export function lineTone(severity: string): "error" | "warning" | "plain" {
  if (severity === "ERROR" || severity === "FATAL") return "error";
  if (severity === "WARN") return "warning";
  return "plain";
}
