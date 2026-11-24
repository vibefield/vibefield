import { z } from "zod";
import { VITALS } from "./registries";
import { VitalsProcessV1, VitalsSampleV1 } from "./vitals";

// VT-4b (track VT, 2026-11-24; VT-D11 A, DESIGN.md §8 "Vitals", Incidents) — INCIDENTS: a bad moment of one of
// VibeField's own processes, kept by fieldd on this device with the minute around it. An incident is a death or a
// hang, and nothing else yet: a process that ended on an error nobody caught, one that exited when nothing asked it
// to, an error a process lived through, a page that stopped responding, or a loop held near 100% for several
// readings. A broken CPU or memory budget is not one until those budgets are measured (VT-D6).
//
// Who it was is a process as the census names it: a group, a role, a label fieldd composed, a pid. Never its
// arguments, folder, environment or output, and never a terminal's process: group `agents` is never the subject of
// an incident (VT-D4). What it was is a kind from the closed list and a bounded detail (an exit code, a signal,
// Chromium's reason, an error's name and its bounded message).
//
// The readings around it ride the incident whole (`VitalsIncidentV1`), so it can be read after the recorder's ring
// has moved on. The census's own schemas are referenced lazily: `vitals.ts` re-exports this file, so the two modules
// load each other, and a reference made at load would read a schema not yet defined.

const unixMs = () => z.number().int().nonnegative();

/** What happened, from a closed list (the writers'). A reader takes any word and says one it does not know as an
 * incident of no known kind.
 *  - `crash` — a process ended on an error nobody caught (fieldd's crash note, read by the next fieldd).
 *  - `exit` — a process exited when nothing asked it to: a failure code, a signal, Chromium's reason.
 *  - `error` — an error nobody caught that the process lived through (Electron main shows its own dialog and goes on).
 *  - `unresponsive` — a page stopped responding; `endedAt` is when it answered again.
 *  - `loop-held` — a process's loop was busy at or over `VITALS.LOOP_HELD_PERCENT` for `VITALS.LOOP_HELD_SAMPLES`
 *    readings in a row; `endedAt` is when it let go. One incident an episode. */
export const VITALS_INCIDENT_KINDS = [
  "crash",
  "exit",
  "error",
  "unresponsive",
  "loop-held",
] as const;
export const VitalsIncidentKind = z.enum(VITALS_INCIDENT_KINDS);
export type VitalsIncidentKind = z.infer<typeof VitalsIncidentKind>;

/** An incident's id, which is also its file's name: a base-36 moment and eight hex digits. */
export const VITALS_INCIDENT_ID = /^[0-9a-z]{1,16}-[0-9a-f]{8}$/;
export const VitalsIncidentId = z.string().regex(VITALS_INCIDENT_ID);

/** Who: the process as the census names it. `pid` is left out where the reporter could not say it (a Chromium child
 * whose pid was gone with it); `key` is the census's row (`<pid>:<startedAt>`) where the recorder held one. */
export const VitalsIncidentSubjectV1 = z
  .object({
    group: z.string().min(1).max(32),
    role: z.string().min(1).max(32),
    label: z.string().min(1).max(VITALS.LABEL_MAX).optional(),
    pid: z.number().int().min(1).optional(),
    key: z.string().min(3).max(48).optional(),
  })
  .passthrough();
export type VitalsIncidentSubjectV1 = z.infer<typeof VitalsIncidentSubjectV1>;

/** What is known of how, each part only where it was said. `message` is an error's own words, bounded; `peak` is a
 * held loop's highest share. */
export const VitalsIncidentDetailV1 = z
  .object({
    code: z.number().int().optional(),
    signal: z.string().min(1).max(32).optional(),
    reason: z.string().min(1).max(64).optional(),
    errorName: z.string().min(1).max(128).optional(),
    message: z.string().min(1).max(VITALS.INCIDENT_MESSAGE_MAX).optional(),
    peak: z.number().min(0).max(1).optional(),
  })
  .passthrough();
export type VitalsIncidentDetailV1 = z.infer<typeof VitalsIncidentDetailV1>;

/** One incident as a list says it. `at` is its moment (unix ms, the wall clock a log record's `time` reads);
 * `endedAt` where it lasted and ended; `complete` once the half minute after it was recorded, or nothing more of it
 * will be. */
export const VitalsIncidentSummaryV1 = z
  .object({
    id: VitalsIncidentId,
    kind: z.string().min(1).max(32),
    at: unixMs(),
    endedAt: unixMs().optional(),
    subject: VitalsIncidentSubjectV1,
    detail: VitalsIncidentDetailV1.optional(),
    complete: z.boolean(),
  })
  .passthrough();
export type VitalsIncidentSummaryV1 = z.infer<typeof VitalsIncidentSummaryV1>;

/** One incident whole, as fieldd keeps it on disk and `vitals.incidents.get` answers: its summary, and the readings
 * of `VITALS.INCIDENT_SPAN_MS` on each side of its moment, oldest first, with every process they name. */
export const VitalsIncidentV1 = VitalsIncidentSummaryV1.extend({
  v: z.literal(1),
  intervalMs: z.number().int().min(1),
  memory: z.enum(["footprint", "resident"]),
  processes: z.array(z.lazy(() => VitalsProcessV1)).max(VITALS.FLOOR_ROWS_MAX),
  samples: z.array(z.lazy(() => VitalsSampleV1)).max(VITALS.INCIDENT_SAMPLES_MAX),
}).passthrough();
export type VitalsIncidentV1 = z.infer<typeof VitalsIncidentV1>;

/** `vitals.incidents.get` (scope `vitals.read`, the callers of `vitals.subscribe`). */
export const VitalsIncidentGetParams = z.object({ id: VitalsIncidentId }).passthrough();
export type VitalsIncidentGetParams = z.infer<typeof VitalsIncidentGetParams>;

/** What Electron main says it saw. `responsive` is not an incident: it ends the open `unresponsive` one of the same
 * role (and pid, where said). */
export const VITALS_INCIDENT_REPORTS = ["exit", "error", "unresponsive", "responsive"] as const;
export const VitalsIncidentReportKind = z.enum(VITALS_INCIDENT_REPORTS);
export type VitalsIncidentReportKind = z.infer<typeof VitalsIncidentReportKind>;

/** `vitals.incident.report` (scope `vitals.report`, Electron main alone) — one of the shell's own processes died or
 * stopped responding, or main met an error nobody caught. The subject is named by the role main's roster already uses
 * (`VitalsRole`); fieldd sets its group. `at` is when main saw it, which may be before fieldd could be told. */
export const VitalsIncidentReportParams = z
  .object({
    kind: VitalsIncidentReportKind,
    role: z.string().min(1).max(32),
    label: z.string().min(1).max(VITALS.LABEL_MAX).optional(),
    pid: z.number().int().min(1).optional(),
    at: unixMs(),
    detail: VitalsIncidentDetailV1.optional(),
  })
  .passthrough();
export type VitalsIncidentReportParams = z.infer<typeof VitalsIncidentReportParams>;

/** `accepted` is false when nothing was kept: the recorder is off, a `responsive` matched no open incident, or the
 * subject was not one of VibeField's own. */
export const VitalsIncidentReportResult = z
  .object({ accepted: z.boolean(), id: VitalsIncidentId.optional() })
  .passthrough();
export type VitalsIncidentReportResult = z.infer<typeof VitalsIncidentReportResult>;

/** A new incident's id: its moment in base 36 and eight hex digits the caller supplies. */
export function vitalsIncidentId(at: number, hex8: string): string {
  return `${Math.max(0, Math.floor(at)).toString(36)}-${hex8}`;
}
