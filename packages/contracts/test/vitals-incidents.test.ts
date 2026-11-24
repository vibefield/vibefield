import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { METHODS } from "../src/methods";
import { LAYOUT, VITALS } from "../src/registries";
// the subpath's own entry: incidents ride `vitals.ts`, which re-exports them
import {
  VITALS_INCIDENT_ID,
  VITALS_INCIDENT_KINDS,
  VitalsDeltaV1,
  VitalsIncidentReportParams,
  VitalsIncidentSummaryV1,
  VitalsIncidentV1,
  VitalsSnapshotV1,
  vitalsIncidentId,
} from "../src/vitals";

// VT-4b (track VT, 2026-11-24; VT-D11 A) — incidents' contract: the kinds, the bounds, the record, the doors.

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), "..", "fixtures");
const fixture = (name: string): unknown => JSON.parse(readFileSync(join(FIXTURES, name), "utf8"));

describe("VT-4b — incidents' bounds (VT-D11 A)", () => {
  it("keeps the newest 50 for 14 days, with the half minute on each side of the moment", () => {
    expect(VITALS.INCIDENTS_MAX).toBe(50);
    expect(VITALS.INCIDENT_KEEP_MS).toBe(14 * 24 * 60 * 60 * 1_000);
    expect(VITALS.INCIDENT_SPAN_MS).toBe(30_000);
    // a minute at one reading a second fits, with room for a replay's overlap
    expect(VITALS.INCIDENT_SAMPLES_MAX).toBeGreaterThan(
      (2 * VITALS.INCIDENT_SPAN_MS) / VITALS.SAMPLE_INTERVAL_MS,
    );
  });

  it("calls a loop held at 95% for five readings in a row, as integers the floor's twin can carry", () => {
    expect(VITALS.LOOP_HELD_PERCENT).toBe(95);
    expect(VITALS.LOOP_HELD_SAMPLES).toBe(5);
    for (const value of Object.values(VITALS)) expect(Number.isInteger(value)).toBe(true);
  });

  it("keeps them in a folder of fieldd's own under the data root", () => {
    expect(LAYOUT.VITALS_INCIDENTS_DIR).toEqual(["fieldd", "vitals", "incidents"]);
  });
});

describe("VT-4b — the record", () => {
  it("is a death or a hang, from a closed list; CPU and memory limits are not kinds yet (VT-D6)", () => {
    expect([...VITALS_INCIDENT_KINDS]).toEqual([
      "crash",
      "exit",
      "error",
      "unresponsive",
      "loop-held",
    ]);
  });

  it("reads a whole incident: its subject by census identity, its detail, the minute's readings", () => {
    const incident = VitalsIncidentV1.parse(fixture("vitals-incident.valid.json"));
    expect(incident.kind).toBe("loop-held");
    expect(incident.subject).toEqual({
      group: "fieldd",
      role: "fieldd",
      pid: 4001,
      key: "4001:1795477990000",
    });
    expect(incident.detail?.peak).toBe(0.9871);
    expect(incident.samples.map((sample) => sample.time)).toEqual([1795478511000, 1795478512000]);
    expect(incident.processes).toHaveLength(2);
  });

  it("reads one still waiting for its half minute after, and keeps a newer field (tolerant reader)", () => {
    const incident = VitalsIncidentV1.parse(fixture("vitals-incident.pending.json"));
    expect(incident.complete).toBe(false);
    expect(incident.samples).toEqual([]);
    expect((incident as Record<string, unknown>)["aNewerField"]).toBe("kept by a tolerant reader");
  });

  it("takes a kind it does not know on read, so a newer fieldd's list is still shown", () => {
    const summary = VitalsIncidentSummaryV1.parse({
      id: "mwtxk4b4-0a1b2c3d",
      kind: "budget-broken",
      at: 1795478530000,
      subject: { group: "fieldd", role: "fieldd" },
      complete: true,
    });
    expect(summary.kind).toBe("budget-broken");
  });

  it("carries no field that could hold an argument, a folder, an environment or output", () => {
    const keys = new Set<string>();
    const walk = (value: unknown): void => {
      if (Array.isArray(value)) for (const item of value) walk(item);
      else if (typeof value === "object" && value !== null)
        for (const [key, inner] of Object.entries(value)) {
          keys.add(key);
          walk(inner);
        }
    };
    walk(fixture("vitals-incident.valid.json"));
    for (const banned of ["argv", "args", "cwd", "env", "command", "title", "stack", "output"])
      expect(keys.has(banned), banned).toBe(false);
  });

  it("bounds an error's words and the readings kept", () => {
    const base = fixture("vitals-incident.pending.json") as Record<string, unknown>;
    expect(
      VitalsIncidentV1.safeParse({
        ...base,
        detail: { message: "x".repeat(VITALS.INCIDENT_MESSAGE_MAX + 1) },
      }).success,
    ).toBe(false);
    const sample = { seq: 1, time: 1, points: [] };
    expect(
      VitalsIncidentV1.safeParse({
        ...base,
        samples: Array.from({ length: VITALS.INCIDENT_SAMPLES_MAX + 1 }, () => sample),
      }).success,
    ).toBe(false);
  });

  it("names an incident by its moment and eight hex digits, safe as a file's name", () => {
    const id = vitalsIncidentId(1795478530000, "0a1b2c3d");
    expect(id).toBe("mwtxk4b4-0a1b2c3d");
    expect(VITALS_INCIDENT_ID.test(id)).toBe(true);
    for (const bad of ["../etc", "a/b-0a1b2c3d", "mwtxk4b4-0A1B2C3D", "", "x-1"])
      expect(VITALS_INCIDENT_ID.test(bad), bad).toBe(false);
  });
});

describe("VT-4b — the doors", () => {
  it("rides the census's snapshot and deltas as summaries, bounded, and a fieldd before them says none", () => {
    const delta = VitalsDeltaV1.parse(fixture("vitals-delta.incidents.json"));
    expect(delta.incidents?.map((incident) => incident.kind)).toEqual(["exit", "unresponsive"]);
    const snapshot = VitalsSnapshotV1.parse(fixture("vitals-snapshot.valid.json"));
    expect(snapshot.incidents).toBeUndefined();
    const summary = delta.incidents?.[0];
    expect(
      VitalsDeltaV1.safeParse({
        incidents: Array.from({ length: VITALS.INCIDENTS_MAX + 1 }, () => summary),
      }).success,
    ).toBe(false);
  });

  it("takes main's report of a process gone or not responding, and nothing else", () => {
    expect(
      VitalsIncidentReportParams.parse(fixture("vitals-incident-report-params.valid.json")).detail,
    ).toEqual({ reason: "crashed", code: 11 });
    expect(
      VitalsIncidentReportParams.parse(fixture("vitals-incident-report-params.unresponsive.json"))
        .kind,
    ).toBe("unresponsive");
    for (const kind of ["crash", "loop-held", "anything"])
      expect(
        VitalsIncidentReportParams.safeParse({ kind, role: "window", at: 1 }).success,
        kind,
      ).toBe(false);
  });

  it("reads one under vitals.read and reports under vitals.report, both local", () => {
    const row = (method: string) => METHODS.find((m) => m.method === method);
    expect(row("vitals.incidents.get")).toMatchObject({
      surface: "product",
      scope: "vitals.read",
      idempotent: true,
      locality: "local",
    });
    expect(row("vitals.incident.report")).toMatchObject({
      surface: "product",
      scope: "vitals.report",
      idempotent: false,
      locality: "local",
    });
  });
});
