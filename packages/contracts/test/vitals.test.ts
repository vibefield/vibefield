import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { METHODS } from "../src/methods";
import { PLUGIN_CAPABILITY_ELIGIBILITY } from "../src/plugins";
import { SCOPES, TAILNET_SCOPES, VITALS } from "../src/registries";
import {
  NativeVitalsReading,
  NativeVitalsSnapshot,
  NativeVitalsSubscribeParams,
  NativeVitalsWatchSetParams,
  VITALS_GROUPS,
  VITALS_ROLES,
  VitalsDeltaV1,
  VitalsQueryResult,
  VitalsRosterSetParams,
  VitalsSnapshotV1,
  vitalsKey,
} from "../src/vitals";

// VT-1 (track VT, 2026-11-24) — the vitals census's contract: the floor's wire, fieldd's door, and the bounds both
// are held to. fixtures.test.ts parses every fixture by its prefix, and fixture_parity.rs reads the floor's half in
// Rust.

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), "..", "fixtures");
const fixture = (name: string): unknown => JSON.parse(readFileSync(join(FIXTURES, name), "utf8"));
const record = (name: string) => fixture(name) as Record<string, unknown>;

describe("VITALS — the census's bounds (first values)", () => {
  it("reads once a second and keeps five minutes on the floor, thirty in fieldd", () => {
    expect(VITALS.SAMPLE_INTERVAL_MS).toBe(1_000);
    expect(VITALS.FLOOR_RING_SAMPLES * VITALS.SAMPLE_INTERVAL_MS).toBe(5 * 60_000);
    expect(VITALS.RECORDER_RING_SAMPLES * VITALS.SAMPLE_INTERVAL_MS).toBe(30 * 60_000);
    expect(VITALS.SNAPSHOT_SAMPLES * VITALS.SAMPLE_INTERVAL_MS).toBe(5 * 60_000);
  });

  it("keeps every bound inside the one that holds it", () => {
    // a backfill is a part of the floor's ring; a snapshot a part of the recorder's
    expect(VITALS.FLOOR_BACKFILL_MAX).toBeLessThanOrEqual(VITALS.FLOOR_RING_SAMPLES);
    expect(VITALS.SNAPSHOT_SAMPLES).toBeLessThanOrEqual(VITALS.RECORDER_RING_SAMPLES);
    // the watch list and the shell's roster both fit a sample beside the floor's own rows
    expect(VITALS.WATCH_MAX).toBeLessThan(VITALS.FLOOR_ROWS_MAX);
    expect(VITALS.ROSTER_MAX).toBeLessThan(VITALS.WATCH_MAX);
  });

  it("budgets one reading at half a percent of a core", () => {
    expect(VITALS.METER_BUDGET_US / (VITALS.SAMPLE_INTERVAL_MS * 1_000)).toBe(0.005);
  });
});

describe("the vitals doors are local, and the shell's alone", () => {
  const rows = METHODS.filter((m) => m.method.includes("vitals."));

  it("names five methods: three on fieldd's door, two on the floor's", () => {
    expect(rows.map((m) => `${m.surface} ${m.method}`).sort()).toEqual([
      "mgmt native.vitals.subscribe",
      "mgmt native.vitals.watch.set",
      "product vitals.query",
      "product vitals.roster.set",
      "product vitals.subscribe",
    ]);
    for (const row of rows) expect(row.locality, row.method).toBe("local");
    // each door is a subscription, so its later frames are `<door>.delta`, derived from the row
    for (const door of ["vitals.subscribe", "native.vitals.subscribe"])
      expect(rows.find((row) => row.method === door)?.subscription, door).toBe(true);
  });

  it("reads under vitals.read and names the shell's processes under vitals.report", () => {
    const scopeOf = (method: string) => rows.find((m) => m.method === method)?.scope;
    expect(scopeOf("vitals.subscribe")).toBe("vitals.read");
    expect(scopeOf("vitals.query")).toBe("vitals.read");
    expect(scopeOf("vitals.roster.set")).toBe("vitals.report");
  });

  it("keeps both scopes from every phone, peer and plugin", () => {
    for (const scope of ["vitals.read", "vitals.report"] as const) {
      expect(SCOPES).toContain(scope);
      expect(TAILNET_SCOPES).not.toContain(scope);
      expect(PLUGIN_CAPABILITY_ELIGIBILITY).not.toHaveProperty([scope]);
    }
  });
});

describe("the floor's wire", () => {
  it("reads a running snapshot: the floor, a child it named, a watched pid with its tree", () => {
    const snapshot = NativeVitalsSnapshot.parse(fixture("native-vitals-snapshot.valid.json"));
    expect(snapshot.state).toBe("running");
    const rows = snapshot.samples[0]?.rows ?? [];
    expect(rows.map((row) => row.origin)).toEqual(["floor", "child", "watched"]);
    expect(rows[1]?.child).toBe("terminal-cell");
    expect(rows[2]?.tree).toEqual({
      processes: 7,
      cpuUs: 44_100_000,
      footprintBytes: 1_288_490_188,
    });
  });

  it("keeps a figure the platform does not offer null, and refuses it missing", () => {
    const row = record("native-vitals-snapshot.valid.json") as {
      samples: { rows: Record<string, unknown>[] }[];
    };
    const watched = row.samples[0]?.rows[2] ?? {};
    expect(NativeVitalsReading.parse(watched).wakeups).toBeNull();
    const { footprintBytes: _dropped, ...withoutFootprint } = watched;
    expect(NativeVitalsReading.safeParse(withoutFootprint).success).toBe(false);
  });

  it("reads an unavailable meter as a state with its reason and no sample", () => {
    const snapshot = NativeVitalsSnapshot.parse(fixture("native-vitals-snapshot.unavailable.json"));
    expect(snapshot.state).toBe("unavailable");
    expect(snapshot.detail).toMatch(/platform/);
    expect(snapshot.samples).toEqual([]);
  });

  it("bounds the snapshot's backfill, a sample's rows and the watch list", () => {
    const snapshot = record("native-vitals-snapshot.valid.json");
    const sample = (snapshot.samples as unknown[])[0];
    const many = Array.from({ length: VITALS.FLOOR_BACKFILL_MAX + 1 }, () => sample);
    expect(NativeVitalsSnapshot.safeParse({ ...snapshot, samples: many }).success).toBe(false);

    const watch = (count: number) => ({
      watch: Array.from({ length: count }, (_, index) => ({ pid: index + 1, tree: false })),
    });
    expect(NativeVitalsWatchSetParams.safeParse(watch(VITALS.WATCH_MAX)).success).toBe(true);
    expect(NativeVitalsWatchSetParams.safeParse(watch(VITALS.WATCH_MAX + 1)).success).toBe(false);
    expect(NativeVitalsWatchSetParams.safeParse({ watch: [{ pid: 0, tree: false }] }).success).toBe(
      false,
    );
  });

  it("asks for the newest alone, or for everything after a cursor", () => {
    expect(NativeVitalsSubscribeParams.parse({})).toEqual({});
    expect(NativeVitalsSubscribeParams.parse({ sinceSeq: 0 }).sinceSeq).toBe(0);
    expect(NativeVitalsSubscribeParams.safeParse({ sinceSeq: -1 }).success).toBe(false);
  });
});

describe("fieldd's door", () => {
  it("names a process by pid and start, so a reused pid is a new row", () => {
    expect(vitalsKey(4001, 1_795_477_990_000)).toBe("4001:1795477990000");
    const snapshot = VitalsSnapshotV1.parse(fixture("vitals-snapshot.valid.json"));
    for (const process of snapshot.processes)
      expect(process.key).toBe(vitalsKey(process.pid, process.startedAt));
  });

  it("draws only processes it named: every point's key is in the roster", () => {
    const snapshot = VitalsSnapshotV1.parse(fixture("vitals-snapshot.valid.json"));
    const named = new Set(snapshot.processes.map((process) => process.key));
    for (const sample of snapshot.samples)
      for (const point of sample.points) expect(named.has(point.key), point.key).toBe(true);
  });

  it("groups and roles come from the closed lists, and a newer word still parses", () => {
    const snapshot = VitalsSnapshotV1.parse(fixture("vitals-snapshot.valid.json"));
    for (const process of snapshot.processes) {
      expect(VITALS_GROUPS as readonly string[]).toContain(process.group);
      expect(VITALS_ROLES as readonly string[]).toContain(process.role);
    }
    const newer = { ...record("vitals-snapshot.valid.json"), state: "paused" };
    expect(VitalsSnapshotV1.parse(newer).state).toBe("paused");
  });

  it("says an agent's row is the process and everything under it", () => {
    const snapshot = VitalsSnapshotV1.parse(fixture("vitals-snapshot.valid.json"));
    const agent = snapshot.processes.find((process) => process.group === "agents");
    expect(agent).toMatchObject({ role: "terminal", label: "Claude Code", tree: true });
    const point = snapshot.samples[0]?.points.find((p) => p.key === agent?.key);
    expect(point?.processes).toBe(8);
    // what the platform did not say is null, never 0
    expect(point?.wakeupsPerSec).toBeNull();
  });

  it("waits honestly: no process and no sample, with the reason", () => {
    const waiting = VitalsSnapshotV1.parse(fixture("vitals-snapshot.waiting.json"));
    expect(waiting).toMatchObject({ state: "waiting", processes: [], samples: [] });
    expect(waiting.detail).toBeDefined();
  });

  it("reads a delta: who arrived, who left, one second of everyone; or a state alone", () => {
    const delta = VitalsDeltaV1.parse(fixture("vitals-delta.valid.json"));
    expect(delta.processes?.[0]?.role).toBe("flows-host");
    expect(delta.gone).toEqual(["4110:1795478001456"]);
    expect(delta.sample?.points).toHaveLength(2);
    const state = VitalsDeltaV1.parse(fixture("vitals-delta.state.json"));
    expect(state).toEqual({ state: "unavailable", detail: "the meter stopped after a fault" });
  });

  it("answers a query in steps, null where a process was not alive", () => {
    const result = VitalsQueryResult.parse(fixture("vitals-query-result.valid.json"));
    for (const series of result.series) {
      expect(series.cpuMean).toHaveLength(result.times.length);
      expect(series.cpuPeak).toHaveLength(result.times.length);
      expect(series.memPeak).toHaveLength(result.times.length);
    }
    expect(result.series[1]?.cpuMean.slice(0, 2)).toEqual([null, null]);
    // a peak is never under its mean
    const first = result.series[0];
    first?.cpuMean.forEach((mean, index) => {
      expect(first.cpuPeak[index] ?? 0).toBeGreaterThanOrEqual(mean ?? 0);
    });
  });

  it("takes the shell's roster from its closed roles, and no more than its bound", () => {
    const roster = VitalsRosterSetParams.parse(fixture("vitals-roster-set-params.valid.json"));
    expect(roster.processes.map((entry) => entry.role)).toContain("vitals-window");
    const unknown = { processes: [{ pid: 12, role: "helper" }] };
    expect(VitalsRosterSetParams.safeParse(unknown).success).toBe(false);
    const many = {
      processes: Array.from({ length: VITALS.ROSTER_MAX + 1 }, (_, index) => ({
        pid: index + 1,
        role: "utility",
      })),
    };
    expect(VitalsRosterSetParams.safeParse(many).success).toBe(false);
  });

  it("carries no field that could hold an argument, a folder or an environment", () => {
    // VT-D4: a row is a pid, a role, a label fieldd composed, and numbers
    const forbidden = /arg|cwd|path|env|command|cmd|title|exe/i;
    for (const name of ["native-vitals-snapshot.valid.json", "vitals-snapshot.valid.json"]) {
      const keys = new Set<string>();
      const walk = (value: unknown): void => {
        if (Array.isArray(value)) value.forEach(walk);
        else if (value !== null && typeof value === "object")
          for (const [key, inner] of Object.entries(value)) {
            keys.add(key);
            walk(inner);
          }
      };
      walk(fixture(name));
      for (const key of keys) expect(key, `${name}: ${key}`).not.toMatch(forbidden);
    }
  });
});
