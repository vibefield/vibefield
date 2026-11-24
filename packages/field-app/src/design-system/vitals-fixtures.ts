import type { VitalsLogLine } from "../vitals/vitals-feed";
import {
  EMPTY_INCIDENTS,
  type VitalsIncidentSummaryV1,
  type VitalsIncidentsState,
  type VitalsIncidentV1,
} from "../vitals/vitals-incidents";
import {
  modelFromSnapshot,
  type VitalsModel,
  type VitalsProcessV1,
  type VitalsSampleV1,
  type VitalsSnapshotV1,
} from "../vitals/vitals-model";

// VT-2 (track VT, 2026-11-24) — the Vitals plates' fixture readings (docs/UI_SYSTEM.md): five minutes of a pair at
// work, made by arithmetic alone so every run draws the same page. What it stands in for is what a host supplies:
// fieldd's snapshot and the kept log lines. The view, its words and its CSS are the product's.

const MB = 1024 * 1024;
/** 2026-11-24 14:07:00 local in the plate's own telling; a fixed instant, never the clock */
export const VITALS_FIXTURE_END = 1_795_500_420_000;
const INTERVAL = 1_000;
const COUNT = 300;

interface Actor {
  pid: number;
  group: VitalsProcessV1["group"];
  role: VitalsProcessV1["role"];
  label?: string;
  tree?: true;
  /** resting CPU, as a share of one core, and resting memory */
  cpu: number;
  mem: number;
  /** the second it began, counted from the window's start; absent: before it */
  born?: number;
  processes?: number;
}

const ACTORS: readonly Actor[] = [
  { pid: 4101, group: "shell", role: "main", cpu: 0.012, mem: 182 * MB },
  { pid: 4133, group: "shell", role: "window", cpu: 0.06, mem: 611 * MB },
  { pid: 4127, group: "shell", role: "gpu", cpu: 0.035, mem: 264 * MB },
  { pid: 4140, group: "shell", role: "utility", cpu: 0.002, mem: 48 * MB },
  { pid: 4212, group: "fieldd", role: "fieldd", cpu: 0.03, mem: 318 * MB },
  { pid: 4230, group: "fieldd", role: "files-host", cpu: 0.004, mem: 96 * MB },
  { pid: 4231, group: "fieldd", role: "transcripts-host", cpu: 0.003, mem: 72 * MB },
  { pid: 4244, group: "fieldd", role: "rosettad", cpu: 0.008, mem: 140 * MB },
  { pid: 3980, group: "floor", role: "field-native", cpu: 0.006, mem: 38 * MB },
  { pid: 4302, group: "floor", role: "terminal-cell", cpu: 0.004, mem: 22 * MB },
  { pid: 4318, group: "floor", role: "terminal-cell", cpu: 0.003, mem: 21 * MB, born: 96 },
  { pid: 4020, group: "floor", role: "mesh-sidecar", cpu: 0.002, mem: 31 * MB },
  {
    pid: 4303,
    group: "agents",
    role: "terminal",
    tree: true,
    cpu: 0.42,
    mem: 1_240 * MB,
    processes: 8,
  },
  {
    pid: 4319,
    group: "agents",
    role: "terminal",
    tree: true,
    cpu: 0.18,
    mem: 520 * MB,
    born: 96,
    processes: 3,
  },
  { pid: 4410, group: "observer", role: "vitals-window", cpu: 0.011, mem: 88 * MB },
];

/** A repeatable wobble in [-1, 1]: no randomness, so a plate is the same pixels every run. */
function wobble(seed: number, second: number): number {
  const x = Math.sin(seed * 12.9898 + second * 0.731) * 43_758.5453;
  return (x - Math.floor(x)) * 2 - 1;
}

/** fieldd's bad ten seconds, three and a half minutes in: the peak the plate's span is picked around. */
const PEAK = { from: 206, to: 216 } as const;

function keyOf(actor: Actor, start: number): string {
  return `${actor.pid}:${start + (actor.born ?? -600) * INTERVAL}`;
}

export function vitalsFixtureSnapshot(): VitalsSnapshotV1 {
  const start = VITALS_FIXTURE_END - (COUNT - 1) * INTERVAL;
  const processes: VitalsProcessV1[] = ACTORS.map((actor) => ({
    key: keyOf(actor, start),
    pid: actor.pid,
    startedAt: start + (actor.born ?? -600) * INTERVAL,
    group: actor.group,
    role: actor.role,
    ...(actor.label === undefined ? {} : { label: actor.label }),
    ...(actor.tree === undefined ? {} : { tree: true }),
  }));
  const samples: VitalsSampleV1[] = [];
  for (let second = 0; second < COUNT; second++) {
    const points: VitalsSampleV1["points"] = [];
    for (const actor of ACTORS) {
      if (actor.born !== undefined && second < actor.born) continue;
      const first = second === (actor.born ?? -1);
      let cpu = Math.max(0, actor.cpu * (1 + 0.45 * wobble(actor.pid, second)));
      let mem =
        actor.mem * (1 + 0.004 * wobble(actor.pid + 7, second)) + second * actor.mem * 0.0001;
      if (actor.role === "fieldd" && second >= PEAK.from && second <= PEAK.to) {
        cpu = 0.94 + 0.05 * wobble(1, second);
        mem += 120 * MB;
      }
      if (actor.role === "window" && second % 61 < 3) cpu += 0.3;
      const peak = second >= PEAK.from && second <= PEAK.to;
      points.push({
        key: keyOf(actor, start),
        cpu: first ? null : Math.round(cpu * 10_000) / 10_000,
        memBytes: Math.round(mem),
        diskReadBps: null,
        diskWriteBps: null,
        wakeupsPerSec: null,
        powerMw: null,
        ...(actor.processes === undefined ? {} : { processes: actor.processes }),
        // VT-3: fieldd says its own loop, its collections and its slowest request; in its bad ten seconds the
        // loop is held and one request waits out the index's rebuild
        ...(actor.role === "fieldd"
          ? {
              own: {
                loopBusy: peak
                  ? Math.round((0.95 + 0.04 * wobble(3, second)) * 10_000) / 10_000
                  : Math.round(Math.max(0, 0.04 * (1 + 0.6 * wobble(5, second))) * 10_000) / 10_000,
                gcMs: peak ? 38.5 : second % 9 === 0 ? 2.4 : 0,
                gcMaxMs: peak ? 26 : second % 9 === 0 ? 2.4 : 0,
                ...(peak
                  ? { slow: { method: "index.catalog.subscribe", ms: 2_210 } }
                  : second % 4 === 0
                    ? { slow: { method: "terminal.list", ms: 6.2 } }
                    : {}),
              },
            }
          : // VT-3b: the Vitals window is open in every plate, so Main says its own loop too
            actor.role === "main"
            ? {
                own: {
                  loopBusy:
                    Math.round(Math.max(0, 0.02 * (1 + 0.5 * wobble(9, second))) * 10_000) / 10_000,
                },
              }
            : // VT-3c: the desk's window says its long frames, in the second its CPU rises and in no other
              actor.role === "window" && second % 61 === 1
              ? { own: { longFrames: 3, longFrameMaxMs: 182 } }
              : {}),
      });
    }
    samples.push({ seq: second + 1, time: start + second * INTERVAL, points });
  }
  return {
    v: 1,
    state: "recording",
    intervalMs: INTERVAL,
    memory: "footprint",
    processes,
    samples,
    observer: { meterCpu: 0.0011 },
  };
}

export function vitalsFixtureModel(): VitalsModel {
  return modelFromSnapshot(vitalsFixtureSnapshot());
}

/** The plates' log lines: a quiet daemon pair, and fieldd's ten bad seconds said in its own log. */
export function vitalsFixtureLogs(): VitalsLogLine[] {
  const start = VITALS_FIXTURE_END - (COUNT - 1) * INTERVAL;
  const lines: VitalsLogLine[] = [];
  const add = (
    second: number,
    ms: number,
    severity: string,
    service: string,
    msg: string,
  ): void => {
    lines.push({
      id: `fixture:${lines.length}`,
      origin: service === "desktop" || service === "renderer" ? "shell" : "fieldd",
      time: start + second * INTERVAL + ms,
      severity,
      service,
      component: service,
      pid: service === "fieldd" ? 4212 : service === "field-native" ? 3980 : 4101,
      msg,
    });
  };
  for (let second = 4; second < COUNT; second += 23) {
    add(second, 120, "INFO", "fieldd", "workspace git observer refreshed 3 repositories");
  }
  for (let second = 11; second < COUNT; second += 47) {
    add(second, 640, "INFO", "field-native", "terminal cell reported its frame cursor");
  }
  add(96, 30, "INFO", "field-native", "terminal cell started");
  add(96, 410, "INFO", "desktop", "A terminal pane was attached to its cell");
  add(205, 880, "INFO", "fieldd", "agent index rebuild started for 2 roots");
  add(207, 310, "WARN", "fieldd", "event loop was blocked for 1840 ms");
  add(209, 902, "WARN", "fieldd", "a product request waited 2210 ms: index.catalog.subscribe");
  add(212, 44, "ERROR", "fieldd", "transcripts host did not answer its heartbeat in 5000 ms");
  add(216, 500, "INFO", "fieldd", "agent index rebuild finished in 10620 ms");
  add(217, 120, "INFO", "fieldd", "transcripts host answered again");
  return lines.sort((a, b) => a.time - b.time);
}

/** The model while the floor's meter has said nothing yet, and on a computer it cannot measure. */
export function vitalsFixtureWaiting(): VitalsModel {
  return modelFromSnapshot({
    v: 1,
    state: "waiting",
    intervalMs: INTERVAL,
    memory: "footprint",
    processes: [],
    samples: [],
    observer: { meterCpu: 0 },
  });
}

/** VT-2b — the model while the recorder is off: fieldd's own snapshot of that state, which names nobody. */
export function vitalsFixtureOff(): VitalsModel {
  return modelFromSnapshot({
    v: 1,
    state: "off",
    intervalMs: INTERVAL,
    memory: "footprint",
    processes: [],
    samples: [],
    observer: { meterCpu: 0 },
  });
}

export function vitalsFixtureUnavailable(): VitalsModel {
  return modelFromSnapshot({
    v: 1,
    state: "unavailable",
    detail: "The floor has no process reading on this platform yet.",
    intervalMs: INTERVAL,
    memory: "resident",
    processes: [],
    samples: [],
    observer: { meterCpu: 0 },
  });
}

// -- VT-4b: incidents ----------------------------------------------------------------------------------------------

/** The plates' kept incidents: fieldd's held loop in its bad ten seconds and the desk's window that stopped
 * responding, both inside the lanes, and rosettad's exit two days before, read whole from the minute kept with it. */
export const VITALS_FIXTURE_OLD_INCIDENT = "mwrfpleo-0b0e0d0a";

export function vitalsFixtureIncidents(): VitalsIncidentsState {
  const start = VITALS_FIXTURE_END - (COUNT - 1) * INTERVAL;
  const at = (second: number): number => start + second * INTERVAL;
  const oldAt = VITALS_FIXTURE_END - 2 * 24 * 60 * 60 * 1_000;
  const snapshot = vitalsFixtureSnapshot();
  const fieldd = snapshot.processes.find((process) => process.role === "fieldd");
  const desk = snapshot.processes.find((process) => process.role === "window");
  const rosettad = snapshot.processes.find((process) => process.role === "rosettad");
  const list: VitalsIncidentSummaryV1[] = [
    {
      id: "mwtxk1q8-5c1e0a9b",
      kind: "loop-held",
      // the first held reading covers the second before it
      at: at(PEAK.from - 1),
      endedAt: at(PEAK.to),
      subject: {
        group: "fieldd",
        role: "fieldd",
        pid: 4212,
        ...(fieldd ? { key: fieldd.key } : {}),
      },
      detail: { peak: 0.99 },
      complete: true,
    },
    {
      id: "mwtxj0c0-77aa00ff",
      kind: "unresponsive",
      at: at(150) + 300,
      endedAt: at(150) + 4_500,
      subject: { group: "shell", role: "window", pid: 4133, ...(desk ? { key: desk.key } : {}) },
      complete: true,
    },
    {
      id: VITALS_FIXTURE_OLD_INCIDENT,
      kind: "exit",
      at: oldAt,
      subject: {
        group: "fieldd",
        role: "rosettad",
        pid: 4244,
        ...(rosettad ? { key: rosettad.key } : {}),
      },
      detail: { code: 101 },
      complete: true,
    },
  ];
  // the old one's minute: thirty seconds of the plate's readings on each side, moved to its own moment
  const shift = oldAt - at(130);
  const kept = snapshot.samples.slice(100, 161).map((sample) => ({
    ...sample,
    time: sample.time + shift,
  }));
  const keys = new Set(kept.flatMap((sample) => sample.points.map((point) => point.key)));
  const old = list[2] as VitalsIncidentSummaryV1;
  const whole: VitalsIncidentV1 = {
    ...old,
    v: 1,
    intervalMs: INTERVAL,
    memory: "footprint",
    processes: snapshot.processes.filter((process) => keys.has(process.key)),
    samples: kept,
  };
  return { ...EMPTY_INCIDENTS, list, wholes: new Map([[whole.id, whole]]) };
}
