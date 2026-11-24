import { z } from "zod";
import { VITALS } from "./registries";

// VT-1 (track VT, 2026-11-24; `draft/thinking-vitals.md`, DESIGN.md §8 "Vitals") — how every process of VibeField is
// doing. Three kinds of evidence, kept apart and joined by time (LOG-1: health and metrics are their own class, never
// log records):
//
//   the census    every process measured one way, from outside, by the floor (this file's `NativeVitals*`);
//   own vitals    what only a process can say of itself: its frames, its loop delay (VT-3);
//   incidents     a broken budget or a death, frozen with the minute around it (VT-4).
//
// Two wires. The FLOOR's (mgmt surface, `native.vitals.*`) carries raw cumulative readings by pid and knows no name:
// field-native measures, and nothing else. FIELDD's (product surface, `vitals.*`) names each process, turns counters
// into rates and keeps the window a viewer draws. Both are local for ever and answer the shell alone (LOG-25's rule,
// taken whole): no plugin, agent, phone or peer reads them.
//
// What is never here (VT-D4, LOG-16…18): a process's arguments, its folder, its environment or its output. A row is
// a pid, a role from a closed list, a label fieldd composed from what it already shows, and numbers.

// Each call makes its own schema. A schema object used twice is written once in the JSON Schema bundle and
// referenced by a nested property path the second time, which the Rust generator cannot resolve.
const count = () => z.number().int().nonnegative();
const pid = () => z.number().int().min(1);
/** Unix ms. A reading's clock is the wall clock, the one a log record's `time` reads (the join). */
const unixMs = () => z.number().int().nonnegative();
const key = () => z.string().min(3).max(48);

// ---------------------------------------------------------------------------------------------------------------
// The floor's wire (mgmt). Generated into Rust; pinned by the `native-vitals-*` fixtures on both sides.
// ---------------------------------------------------------------------------------------------------------------

/** Why the floor measures a row. `floor` is field-native itself; `child` is a process the floor started (a terminal
 * cell, the mesh sidecar, the freeway host); `watched` is a pid fieldd asked for (`native.vitals.watch.set`). */
export const NativeVitalsOrigin = z.enum(["floor", "child", "watched"]);
export type NativeVitalsOrigin = z.infer<typeof NativeVitalsOrigin>;

/** What a `child` row is, read by the floor from its own child's executable name against a closed list. No name
 * crosses the wire: a child the list does not know is `other`. */
export const NativeVitalsChild = z.enum(["terminal-cell", "mesh-sidecar", "freeway-host", "other"]);
export type NativeVitalsChild = z.infer<typeof NativeVitalsChild>;

/** A watched pid's descendants, summed: an agent under a terminal starts processes of its own, and its cost is the
 * tree's. `cpuUs` only rises while the root lives: the floor adds each living descendant's growth since the last
 * reading, so a descendant that exits takes nothing back. A descendant that lives for less than one interval is
 * never seen, and its time is not in the sum. */
export const NativeVitalsTree = z
  .object({
    processes: count(),
    cpuUs: count(),
    footprintBytes: count(),
  })
  .passthrough();
export type NativeVitalsTree = z.infer<typeof NativeVitalsTree>;

/** One process at one reading. Every counter is cumulative since the process began, as the OS keeps it, so a reader
 * that missed a reading still computes a true rate. A figure this platform does not offer is null, never 0.
 *  - `startedAt` — when the process began (unix ms). With `pid` it is the row's identity: a pid the OS reuses
 *    begins a new row.
 *  - `cpuUserUs` / `cpuSystemUs` — CPU time, microseconds.
 *  - `footprintBytes` — macOS's physical footprint, the figure Activity Monitor shows as Memory. null where the
 *    platform has none; a reader then falls back to `residentBytes`, and says which it shows.
 *  - `diskReadBytes` / `diskWrittenBytes` — bytes this process caused to be read from and written to storage.
 *  - `wakeups` — times the process woke a sleeping core (idle and interrupt wake-ups together).
 *  - `energyNj` — energy billed to the process, nanojoules. */
export const NativeVitalsReading = z
  .object({
    pid: pid(),
    startedAt: unixMs(),
    origin: NativeVitalsOrigin,
    child: NativeVitalsChild.optional(),
    cpuUserUs: count(),
    cpuSystemUs: count(),
    residentBytes: count(),
    footprintBytes: count().nullable(),
    diskReadBytes: count().nullable(),
    diskWrittenBytes: count().nullable(),
    wakeups: count().nullable(),
    energyNj: count().nullable(),
    tree: NativeVitalsTree.optional(),
  })
  .passthrough();
export type NativeVitalsReading = z.infer<typeof NativeVitalsReading>;

/** Every row at one moment. `seq` counts up from 1 within one floor boot, so a reader sees a gap; `time` is the
 * floor's wall clock when the reading began; `tookUs` is what the reading itself cost, the observer's own price. */
export const NativeVitalsSample = z
  .object({
    seq: z.number().int().min(1),
    time: unixMs(),
    tookUs: count(),
    rows: z.array(NativeVitalsReading).max(VITALS.FLOOR_ROWS_MAX),
  })
  .passthrough();
export type NativeVitalsSample = z.infer<typeof NativeVitalsSample>;

/** `running` — the meter reads every interval. `unavailable` — this platform has no reading the floor trusts, or
 * the meter stopped; `detail` says which, in the floor's own sentence. */
export const NativeVitalsState = z.enum(["running", "unavailable"]);
export type NativeVitalsState = z.infer<typeof NativeVitalsState>;

/** `native.vitals.subscribe`'s params. `sinceSeq` asks for the samples after it, for a fieldd that comes back to a
 * floor that kept measuring; absent, the snapshot carries the newest only. */
export const NativeVitalsSubscribeParams = z
  .object({ sinceSeq: z.number().int().nonnegative().optional() })
  .passthrough();
export type NativeVitalsSubscribeParams = z.infer<typeof NativeVitalsSubscribeParams>;

/** What the floor holds as a subscription opens: its state, its pace, and the samples asked for, oldest first, at
 * most `VITALS.FLOOR_BACKFILL_MAX` of them (the newest are kept when more were asked). `oldestSeq` is the oldest
 * sample still in the floor's ring, so a reader knows what a gap lost. Each later sample arrives as the
 * subscription's own frame, `native.vitals.delta`, whose payload is one `NativeVitalsSample`. */
export const NativeVitalsSnapshot = z
  .object({
    // 1, spelled as a bounded integer and not `z.literal(1)`: this shape rides the Rust bundle (mgmt.ts's rule)
    v: z.number().int().min(1).max(1),
    bootId: z.string(),
    state: NativeVitalsState,
    detail: z.string().max(240).optional(),
    intervalMs: z.number().int().min(1),
    oldestSeq: z.number().int().nonnegative(),
    samples: z.array(NativeVitalsSample).max(VITALS.FLOOR_BACKFILL_MAX),
  })
  .passthrough();
export type NativeVitalsSnapshot = z.infer<typeof NativeVitalsSnapshot>;

export const NativeVitalsSubscribeResult = z
  .object({ subId: z.string(), snapshot: NativeVitalsSnapshot })
  .passthrough();
export type NativeVitalsSubscribeResult = z.infer<typeof NativeVitalsSubscribeResult>;

/** One pid fieldd asks the floor to measure. `tree` asks for its descendants' sum beside it. */
export const NativeVitalsWatchEntry = z.object({ pid: pid(), tree: z.boolean() }).passthrough();
export type NativeVitalsWatchEntry = z.infer<typeof NativeVitalsWatchEntry>;

/** `native.vitals.watch.set`'s params: the whole list, replacing the last one (a desired state, never a diff). The
 * floor's own process and its children are measured without being asked. */
export const NativeVitalsWatchSetParams = z
  .object({ watch: z.array(NativeVitalsWatchEntry).max(VITALS.WATCH_MAX) })
  .passthrough();
export type NativeVitalsWatchSetParams = z.infer<typeof NativeVitalsWatchSetParams>;

export const NativeVitalsWatchSetResult = z.object({ watching: count() }).passthrough();
export type NativeVitalsWatchSetResult = z.infer<typeof NativeVitalsWatchSetResult>;

// ---------------------------------------------------------------------------------------------------------------
// fieldd's wire (product, local, scope `vitals.read`; the roster is `vitals.report`). TS-only: no Rust reader.
// ---------------------------------------------------------------------------------------------------------------

/** Whose a process is. `agents` are the person's own work under the terminals: shown, and never the subject of an
 * incident (VT-D4). `observer` is what Vitals itself costs. An open word on the wire: a reader shows a group it
 * does not know under its own name. */
export const VITALS_GROUPS = ["shell", "fieldd", "floor", "agents", "observer"] as const;
export const VitalsGroup = z.enum(VITALS_GROUPS);
export type VitalsGroup = z.infer<typeof VitalsGroup>;

/** What a process is, from a closed list its owner writes. */
export const VITALS_ROLES = [
  // the shell (Electron's processes, named by main: `vitals.roster.set`)
  "main",
  "window",
  "gpu",
  "utility",
  "browser-pane",
  "studio-window",
  "vitals-window",
  // fieldd and what it starts
  "fieldd",
  "files-host",
  "transcripts-host",
  "flows-host",
  "rosettad",
  "plugin-process",
  // the floor and what it starts
  "field-native",
  "terminal-cell",
  "mesh-sidecar",
  "freeway-host",
  // a terminal's own process and everything under it
  "terminal",
  "other",
] as const;
export const VitalsRole = z.enum(VITALS_ROLES);
export type VitalsRole = z.infer<typeof VitalsRole>;

/** A process as a viewer names it. `key` is `<pid>:<startedAt>`, stable for the process's life. `label` is the name
 * a row shows where the role alone does not say it (an agent's catalog label, a plugin's name): composed by fieldd
 * from what the product already shows, never read from the process. `tree` says the row's figures are the process
 * and everything under it. */
export const VitalsProcessV1 = z
  .object({
    key: key(),
    pid: pid(),
    startedAt: unixMs(),
    group: z.string().min(1).max(32),
    role: z.string().min(1).max(32),
    label: z.string().min(1).max(VITALS.LABEL_MAX).optional(),
    tree: z.boolean().optional(),
  })
  .passthrough();
export type VitalsProcessV1 = z.infer<typeof VitalsProcessV1>;

/** A process over one interval, as rates.
 *  - `cpu` — its share of one core: 1 is one core held for the whole interval, 2.5 two and a half. null on a
 *    process's first reading: a rate needs two.
 *  - `memBytes` — its footprint, or its resident size where the platform has no footprint (`VitalsSnapshotV1.memory`
 *    says which this device reports).
 *  - `diskReadBps` / `diskWriteBps` — bytes a second.
 *  - `wakeupsPerSec`, `powerMw` — null where the platform does not say.
 *  - `processes` — for a tree row, how many processes the figures cover. */
export const VitalsPointV1 = z
  .object({
    key: key(),
    cpu: z.number().nonnegative().nullable(),
    memBytes: count(),
    diskReadBps: z.number().nonnegative().nullable(),
    diskWriteBps: z.number().nonnegative().nullable(),
    wakeupsPerSec: z.number().nonnegative().nullable(),
    powerMw: z.number().nonnegative().nullable(),
    processes: z.number().int().min(1).optional(),
  })
  .passthrough();
export type VitalsPointV1 = z.infer<typeof VitalsPointV1>;

/** One second of every process. `seq` is the recorder's own, counting up within one fieldd boot. */
export const VitalsSampleV1 = z
  .object({
    seq: z.number().int().min(1),
    time: unixMs(),
    points: z.array(VitalsPointV1).max(VITALS.FLOOR_ROWS_MAX),
  })
  .passthrough();
export type VitalsSampleV1 = z.infer<typeof VitalsSampleV1>;

/** `recording` — samples arrive. `waiting` — the floor's meter is not answering yet (a floor before VT-1, or the
 * link down): nothing is drawn as zero. `unavailable` — the floor says it cannot measure here. `off` — the person
 * turned the recorder off. */
export const VitalsState = z.enum(["recording", "waiting", "unavailable", "off"]);
export type VitalsState = z.infer<typeof VitalsState>;

/** `vitals.subscribe`'s snapshot: the newest `VITALS.SNAPSHOT_SAMPLES` samples, oldest first, and every process
 * they name. A process the newest sample does not name has ended. `observer` is what measuring cost over the
 * snapshot's span: the floor's reading time as a share of one core. */
export const VitalsSnapshotV1 = z
  .object({
    v: z.literal(1),
    state: z.string().min(1).max(32),
    detail: z.string().max(240).optional(),
    intervalMs: z.number().int().min(1),
    memory: z.enum(["footprint", "resident"]),
    processes: z.array(VitalsProcessV1).max(VITALS.FLOOR_ROWS_MAX),
    samples: z.array(VitalsSampleV1).max(VITALS.SNAPSHOT_SAMPLES),
    observer: z.object({ meterCpu: z.number().nonnegative() }).passthrough(),
  })
  .passthrough();
export type VitalsSnapshotV1 = z.infer<typeof VitalsSnapshotV1>;

/** A subscription's later frames. A sample names only keys the snapshot or an earlier `processes` introduced;
 * `gone` are keys whose process ended. A state change arrives alone. */
export const VitalsDeltaV1 = z
  .object({
    state: z.string().min(1).max(32).optional(),
    detail: z.string().max(240).optional(),
    processes: z.array(VitalsProcessV1).max(VITALS.FLOOR_ROWS_MAX).optional(),
    gone: z.array(key()).max(VITALS.FLOOR_ROWS_MAX).optional(),
    sample: VitalsSampleV1.optional(),
  })
  .passthrough();
export type VitalsDeltaV1 = z.infer<typeof VitalsDeltaV1>;

export const VitalsSubscribeResult = z
  .object({ subId: z.string(), snapshot: VitalsSnapshotV1 })
  .passthrough();
export type VitalsSubscribeResult = z.infer<typeof VitalsSubscribeResult>;

/** `vitals.query` — a span of the recorder's ring, folded to at most `VITALS.QUERY_MAX_POINTS` steps a series. Each
 * step keeps the span's mean and its peak, so a spike survives a wide view. */
export const VitalsQueryParams = z
  .object({
    from: unixMs(),
    to: unixMs(),
    keys: z.array(key()).max(VITALS.FLOOR_ROWS_MAX).optional(),
  })
  .passthrough();
export type VitalsQueryParams = z.infer<typeof VitalsQueryParams>;

/** One process over the queried span. Every array is as long as `VitalsQueryResult.times`; a step in which the
 * process was not alive is null. */
export const VitalsSeriesV1 = z
  .object({
    key: key(),
    cpuMean: z.array(z.number().nonnegative().nullable()).max(VITALS.QUERY_MAX_POINTS),
    cpuPeak: z.array(z.number().nonnegative().nullable()).max(VITALS.QUERY_MAX_POINTS),
    memPeak: z.array(count().nullable()).max(VITALS.QUERY_MAX_POINTS),
  })
  .passthrough();
export type VitalsSeriesV1 = z.infer<typeof VitalsSeriesV1>;

export const VitalsQueryResult = z
  .object({
    v: z.literal(1),
    stepMs: z.number().int().min(1),
    times: z.array(unixMs()).max(VITALS.QUERY_MAX_POINTS),
    processes: z.array(VitalsProcessV1).max(VITALS.QUERY_PROCESSES_MAX),
    series: z.array(VitalsSeriesV1).max(VITALS.QUERY_PROCESSES_MAX),
  })
  .passthrough();
export type VitalsQueryResult = z.infer<typeof VitalsQueryResult>;

/** One of the shell's own processes, as Electron main names it. */
export const VitalsRosterEntry = z
  .object({
    pid: pid(),
    role: VitalsRole,
    label: z.string().min(1).max(VITALS.LABEL_MAX).optional(),
  })
  .passthrough();
export type VitalsRosterEntry = z.infer<typeof VitalsRosterEntry>;

/** `vitals.roster.set` (scope `vitals.report`, Electron main alone) — the shell's processes, the whole list, sent
 * when it changes and never on a timer. fieldd asks the floor to measure each; a pid it cannot find is dropped at
 * the next reading. */
export const VitalsRosterSetParams = z
  .object({ processes: z.array(VitalsRosterEntry).max(VITALS.ROSTER_MAX) })
  .passthrough();
export type VitalsRosterSetParams = z.infer<typeof VitalsRosterSetParams>;

export const VitalsRosterSetResult = z.object({ accepted: count() }).passthrough();
export type VitalsRosterSetResult = z.infer<typeof VitalsRosterSetResult>;

/** A process's identity on fieldd's wire. */
export function vitalsKey(pid: number, startedAt: number): string {
  return `${pid}:${startedAt}`;
}
