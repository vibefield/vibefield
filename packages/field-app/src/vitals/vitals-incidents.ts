import { VITALS } from "@vibefield/contracts/registries";
import { type VitalsIncidentSummaryV1, VitalsIncidentV1 } from "@vibefield/contracts/vitals";
import { modelFromSnapshot, type VitalsModel } from "./vitals-model";
import { clockWords, durationWords, rowName } from "./vitals-words";

// The wire's shapes a fixture adapter needs, said from here (ui-system-boundaries.test.ts).
export type { VitalsIncidentSummaryV1, VitalsIncidentV1 };

// VT-4b (track VT, 2026-11-24; DESIGN.md §8 "Vitals", Incidents; §9 "Vitals' words") — THE WINDOW'S INCIDENTS, PURE:
// the kept incidents' summaries fieldd's census carries, the few main read whole for the window, and their words. No
// DOM and no clock. An incident older than the lanes is drawn from the minute kept with it (`incidentModel`).

export interface VitalsIncidentsState {
  /** every kept incident's summary, newest first */
  list: readonly VitalsIncidentSummaryV1[];
  /** incidents main read whole for the window, by id: the newest few opened */
  wholes: ReadonlyMap<string, VitalsIncidentV1>;
  /** ids main could not read */
  missing: ReadonlySet<string>;
}

export const EMPTY_INCIDENTS: VitalsIncidentsState = {
  list: [],
  wholes: new Map(),
  missing: new Set(),
};

/** How many whole incidents the window keeps: one is read at a time, so a few is plenty. */
export const INCIDENT_WHOLES_MAX = 4;

/** The list again, from the census. A whole whose summary moved on (it completed, or it ended) is dropped, so the
 * window reads it again; one no longer kept is dropped with it. */
export function withIncidentList(
  state: VitalsIncidentsState,
  list: readonly VitalsIncidentSummaryV1[],
): VitalsIncidentsState {
  const byId = new Map(list.map((summary) => [summary.id, summary]));
  const wholes = new Map<string, VitalsIncidentV1>();
  for (const [id, whole] of state.wholes) {
    const summary = byId.get(id);
    if (
      summary !== undefined &&
      summary.complete === whole.complete &&
      summary.endedAt === whole.endedAt
    )
      wholes.set(id, whole);
  }
  const missing = new Set([...state.missing].filter((id) => byId.has(id)));
  return { list, wholes, missing };
}

/** One incident whole, as main read it; null when it does not parse. */
export function withIncidentWhole(
  state: VitalsIncidentsState,
  raw: unknown,
): VitalsIncidentsState | null {
  const parsed = VitalsIncidentV1.safeParse(raw);
  if (!parsed.success) return null;
  const wholes = new Map(state.wholes);
  wholes.delete(parsed.data.id);
  wholes.set(parsed.data.id, parsed.data);
  while (wholes.size > INCIDENT_WHOLES_MAX) {
    const oldest = wholes.keys().next().value;
    if (oldest === undefined) break;
    wholes.delete(oldest);
  }
  const missing = new Set(state.missing);
  missing.delete(parsed.data.id);
  return { ...state, wholes, missing };
}

export function withIncidentMissing(
  state: VitalsIncidentsState,
  id: string | undefined,
): VitalsIncidentsState {
  // only a listed one is said missing: an id the list does not hold has nothing to show, and the set stays bounded
  if (id === undefined || !state.list.some((summary) => summary.id === id)) return state;
  return { ...state, missing: new Set([...state.missing, id]) };
}

/** Whether the lanes' readings reach the moment: if not, the incident is drawn from its own. */
export function liveHolds(live: VitalsModel, at: number): boolean {
  const first = live.samples[0]?.time;
  const last = live.samples.at(-1)?.time;
  return first !== undefined && last !== undefined && at >= first && at <= last;
}

/** The window's model over an incident's own minute: its readings and the processes they name, under the recorder's
 * state as it stands now. */
export function incidentModel(live: VitalsModel, whole: VitalsIncidentV1): VitalsModel {
  return modelFromSnapshot({
    v: 1,
    state: live.state,
    ...(live.detail !== null ? { detail: live.detail } : {}),
    intervalMs: whole.intervalMs,
    memory: whole.memory,
    processes: whole.processes,
    samples: whole.samples,
    observer: { meterCpu: live.meterCpu },
  });
}

/** The span an incident's own minute covers. */
export function incidentSpan(summary: VitalsIncidentSummaryV1): { from: number; to: number } {
  return {
    from: summary.at - VITALS.INCIDENT_SPAN_MS,
    to: summary.at + VITALS.INCIDENT_SPAN_MS,
  };
}

// -- the words (DESIGN.md §9 "Vitals' words", Incidents) ---------------------------------------------------------

export const INCIDENT_WORDS = {
  list: "Incidents",
  kept: "Drawn from the minute kept with it.",
} as const;

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** The button's words. */
export function incidentCountWords(count: number): string {
  return count === 1 ? "1 incident" : `${count} incidents`;
}

/** Its moment, in the person's own zone: "22 Nov 14:02:10". */
export function incidentWhenWords(at: number): string {
  const date = new Date(at);
  return `${date.getDate()} ${MONTHS[date.getMonth()] ?? ""} ${clockWords(at)}`;
}

/** A duration an incident lasted: whole seconds where it is whole (a held loop ends on a reading), else as the Loop
 * lane says one. */
function lastedWords(ms: number): string {
  return ms % 1_000 === 0 ? `${ms / 1_000} s` : durationWords(ms);
}

/** What happened, in one phrase a kind, then how where it was said. */
export function incidentWhatWords(summary: VitalsIncidentSummaryV1): string {
  const detail = summary.detail ?? {};
  const lasted =
    summary.endedAt !== undefined && summary.endedAt > summary.at
      ? ` · for ${lastedWords(summary.endedAt - summary.at)}`
      : "";
  const error =
    detail.errorName !== undefined && detail.message !== undefined
      ? ` · ${detail.errorName}: ${detail.message}`
      : detail.errorName !== undefined
        ? ` · ${detail.errorName}`
        : detail.message !== undefined
          ? ` · ${detail.message}`
          : "";
  switch (summary.kind) {
    case "crash":
      return `ended on an error nobody caught${error}`;
    case "exit": {
      const how =
        detail.reason !== undefined
          ? ` · ${detail.reason}`
          : detail.signal !== undefined
            ? ` · ${detail.signal}`
            : detail.code !== undefined
              ? ` · code ${detail.code}`
              : "";
      return `exited unexpectedly${how}`;
    }
    case "error":
      return `met an error nobody caught${error}`;
    case "unresponsive":
      return `stopped responding${lasted}`;
    case "loop-held":
      return `held its loop near 100%${lasted}`;
    default:
      return "had an incident";
  }
}

/** Who: the process's row name, as the list names it. */
export function incidentWhoWords(summary: VitalsIncidentSummaryV1): string {
  return rowName(summary.subject);
}

/** The one line over the lanes while an incident is opened. */
export function incidentLineWords(summary: VitalsIncidentSummaryV1): string {
  return `${incidentWhoWords(summary)} ${incidentWhatWords(summary)}`;
}

/** Its hue (§2.5): a death or an error is a failure, a hang needs attention. */
export function incidentTone(kind: string): "failure" | "attention" {
  return kind === "crash" || kind === "exit" || kind === "error" ? "failure" : "attention";
}
