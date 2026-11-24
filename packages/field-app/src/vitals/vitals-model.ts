import { VITALS } from "@vibefield/contracts/registries";
import type {
  VitalsDeltaV1,
  VitalsOwnV1,
  VitalsPointV1,
  VitalsProcessV1,
  VitalsSampleV1,
  VitalsSnapshotV1,
} from "@vibefield/contracts/vitals";

// The wire's shapes a fixture adapter needs, said from here: the catalog composes this view through its own
// modules, never through another package's internal path (ui-system-boundaries.test.ts).
export type { VitalsOwnV1, VitalsProcessV1, VitalsSampleV1, VitalsSnapshotV1 };

// VT-2 (track VT, 2026-11-24; DESIGN.md §8 "Vitals") — THE VITALS WINDOW'S MODEL, PURE: fieldd's snapshot and its
// deltas folded into what the window draws. No DOM, no clock and no colour: rows, sums and series are numbers, and a
// figure that was not measured is `null`, which the view draws as a gap and never as zero.

/** The groups in the order the window lists them. `agents` is the person's own work under the terminals: listed, and
 * never added into VibeField's total (VT-D4). A group this build does not know is listed last, under its own name. */
export const VITALS_GROUP_ORDER = ["shell", "fieldd", "floor", "agents", "observer"] as const;

/** The groups whose processes are VibeField's own cost: every group but the person's terminals. */
export function countsAsVibeField(group: string): boolean {
  return group !== "agents";
}

export interface VitalsModel {
  state: string;
  detail: string | null;
  intervalMs: number;
  memory: "footprint" | "resident";
  /** every process a kept sample names, by key */
  processes: ReadonlyMap<string, VitalsProcessV1>;
  /** oldest first, at most `VITALS.SNAPSHOT_SAMPLES` */
  samples: readonly VitalsSampleV1[];
  /** what the floor's reading cost, as a share of one core */
  meterCpu: number;
}

export const EMPTY_VITALS: VitalsModel = {
  state: "connecting",
  detail: null,
  intervalMs: VITALS.SAMPLE_INTERVAL_MS,
  memory: "footprint",
  processes: new Map(),
  samples: [],
  meterCpu: 0,
};

export function modelFromSnapshot(snapshot: VitalsSnapshotV1): VitalsModel {
  return {
    state: snapshot.state,
    detail: snapshot.detail ?? null,
    intervalMs: snapshot.intervalMs,
    memory: snapshot.memory,
    processes: new Map(snapshot.processes.map((process) => [process.key, process])),
    samples: snapshot.samples.slice(-VITALS.SNAPSHOT_SAMPLES),
    meterCpu: snapshot.observer.meterCpu,
  };
}

/** One delta folded in. A process that ended keeps its name while a kept sample still draws it, and is forgotten
 * when the last such sample leaves the window. */
export function applyDelta(model: VitalsModel, delta: VitalsDeltaV1): VitalsModel {
  let { state, detail } = model;
  if (delta.state !== undefined) {
    state = delta.state;
    detail = delta.detail ?? null;
  }
  if (delta.sample === undefined && delta.processes === undefined) {
    return state === model.state && detail === model.detail ? model : { ...model, state, detail };
  }
  const processes = new Map(model.processes);
  for (const process of delta.processes ?? []) processes.set(process.key, process);
  let samples = model.samples;
  if (delta.sample !== undefined) {
    samples = [...model.samples, delta.sample].slice(-VITALS.SNAPSHOT_SAMPLES);
    const drawn = new Set<string>();
    for (const sample of samples) for (const point of sample.points) drawn.add(point.key);
    for (const key of processes.keys()) if (!drawn.has(key)) processes.delete(key);
  }
  return { ...model, state, detail, processes, samples };
}

/** The sample the window reads its figures from: the one at `time`, or the newest at or before it; with no time,
 * the newest. `null` while there is none. */
export function sampleAt(model: VitalsModel, time: number | null): VitalsSampleV1 | null {
  if (model.samples.length === 0) return null;
  if (time === null) return model.samples.at(-1) ?? null;
  let found: VitalsSampleV1 | null = null;
  for (const sample of model.samples) {
    if (sample.time > time) break;
    found = sample;
  }
  return found ?? model.samples[0] ?? null;
}

export interface VitalsRow {
  key: string;
  process: VitalsProcessV1;
  point: VitalsPointV1;
}

export interface VitalsGroupRows {
  group: string;
  rows: VitalsRow[];
  /** the group's sum at the sample; `cpu` null when no row has a rate yet */
  cpu: number | null;
  memBytes: number;
}

/** The processes alive at `sample`, by group in the window's order, each group's rows by role as the roster lists
 * them and then by pid, so a row never moves while its neighbours' numbers change. */
export function groupRows(model: VitalsModel, sample: VitalsSampleV1 | null): VitalsGroupRows[] {
  if (sample === null) return [];
  const byGroup = new Map<string, VitalsRow[]>();
  for (const point of sample.points) {
    const process = model.processes.get(point.key);
    if (process === undefined) continue;
    const rows = byGroup.get(process.group) ?? [];
    rows.push({ key: point.key, process, point });
    byGroup.set(process.group, rows);
  }
  const known: readonly string[] = VITALS_GROUP_ORDER;
  const order = [...byGroup.keys()].sort((a, b) => {
    const [ia, ib] = [known.indexOf(a), known.indexOf(b)];
    if (ia !== ib) return (ia < 0 ? known.length : ia) - (ib < 0 ? known.length : ib);
    return a.localeCompare(b);
  });
  return order.map((group) => {
    const rows = (byGroup.get(group) ?? []).sort(
      (a, b) =>
        roleRank(a.process.role) - roleRank(b.process.role) ||
        a.process.role.localeCompare(b.process.role) ||
        a.process.pid - b.process.pid,
    );
    return { group, rows, cpu: sumCpu(rows.map((row) => row.point)), memBytes: sumMem(rows) };
  });
}

/** The roles in the order a group lists them: the process a group is named for first, then what it started. */
const ROLE_ORDER: readonly string[] = [
  "main",
  "window",
  "gpu",
  "browser-pane",
  "utility",
  "studio-window",
  "fieldd",
  "files-host",
  "transcripts-host",
  "flows-host",
  "rosettad",
  "plugin-process",
  "field-native",
  "terminal-cell",
  "mesh-sidecar",
  "freeway-host",
  "terminal",
  "vitals-window",
  "other",
];

function roleRank(role: string): number {
  const index = ROLE_ORDER.indexOf(role);
  return index < 0 ? ROLE_ORDER.length : index;
}

function sumCpu(points: readonly VitalsPointV1[]): number | null {
  let sum: number | null = null;
  for (const point of points) if (point.cpu !== null) sum = (sum ?? 0) + point.cpu;
  return sum;
}

function sumMem(rows: readonly VitalsRow[]): number {
  return rows.reduce((sum, row) => sum + row.point.memBytes, 0);
}

/** All of VibeField at one sample: every group but the person's terminals. */
export function vibeFieldTotal(groups: readonly VitalsGroupRows[]): {
  cpu: number | null;
  memBytes: number;
} {
  let cpu: number | null = null;
  let memBytes = 0;
  for (const group of groups) {
    if (!countsAsVibeField(group.group)) continue;
    if (group.cpu !== null) cpu = (cpu ?? 0) + group.cpu;
    memBytes += group.memBytes;
  }
  return { cpu, memBytes };
}

export interface VitalsSeries {
  /** unix ms, one per kept sample */
  times: number[];
  /** as long as `times`; null where nothing was measured */
  values: (number | null)[];
}

type Measure = "cpu" | "memBytes";

/** Every process over the window, by key, in one pass over the samples. */
export function processSeries(model: VitalsModel, measure: Measure): Map<string, VitalsSeries> {
  const times = model.samples.map((sample) => sample.time);
  const byKey = new Map<string, VitalsSeries>();
  model.samples.forEach((sample, index) => {
    for (const point of sample.points) {
      let series = byKey.get(point.key);
      if (series === undefined) {
        series = { times, values: new Array<number | null>(times.length).fill(null) };
        byKey.set(point.key, series);
      }
      series.values[index] = point[measure];
    }
  });
  return byKey;
}

/** VT-3 — each process that says how busy its own loop was, over the window: its busy share at each sample, null
 * where it said none. A process that never says its own has no series, and with none the Loop lane does not stand. */
export function loopSeries(model: VitalsModel): Map<string, VitalsSeries> {
  const times = model.samples.map((sample) => sample.time);
  const byKey = new Map<string, VitalsSeries>();
  model.samples.forEach((sample, index) => {
    for (const point of sample.points) {
      const busy = point.own?.loopBusy;
      if (busy === undefined) continue;
      let series = byKey.get(point.key);
      if (series === undefined) {
        series = { times, values: new Array<number | null>(times.length).fill(null) };
        byKey.set(point.key, series);
      }
      series.values[index] = busy;
    }
  });
  return byKey;
}

/** What one process said of itself in one sample, or null where it said nothing. */
export function ownAt(sample: VitalsSampleV1 | null, key: string): VitalsOwnV1 | null {
  return sample?.points.find((point) => point.key === key)?.own ?? null;
}

/** One group over the window: the sum of its processes at each sample, null where none of them was measured. */
export function groupSeries(model: VitalsModel, group: string, measure: Measure): VitalsSeries {
  return {
    times: model.samples.map((sample) => sample.time),
    values: model.samples.map((sample) => {
      let sum: number | null = null;
      for (const point of sample.points) {
        if (model.processes.get(point.key)?.group !== group) continue;
        const value = point[measure];
        if (value !== null) sum = (sum ?? 0) + value;
      }
      return sum;
    }),
  };
}

/** The largest value any of the series reaches, or `floor` when they reach less: a lane's scale never collapses
 * onto a flat line, and never cuts a peak. */
export function seriesPeak(series: readonly VitalsSeries[], floor: number): number {
  let peak = floor;
  for (const one of series)
    for (const value of one.values) if (value !== null && value > peak) peak = value;
  return peak;
}
