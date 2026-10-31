import { readFileSync } from "node:fs";
import { LoggingHealthV1 } from "@vibefield/contracts/logging";
import { describe, expect, it } from "vitest";
import {
  type LoggingHealthLike,
  loggingCensus,
  PhysicalSoakTrace,
  type ResourceProbeFailure,
  runResourceProbe,
  type SoakDiagnostic,
} from "../src/testing/plugin-runtime-diagnostics";
import { evaluatePhysicalSoak } from "../src/testing/plugin-runtime-soak";

const health = (rejected = 0, bootId = "boot-a"): LoggingHealthLike => ({
  bootId,
  instanceId: "renderer-a",
  queue: { records: 0, bytes: 0 },
  counters: { rejected },
});

describe("physical soak log attribution", () => {
  it("accepts the tolerant logging contract while excluding unknown counter payloads", () => {
    const fixture = JSON.parse(
      readFileSync(
        new URL("../../contracts/fixtures/logging-health.valid.json", import.meta.url),
        "utf8",
      ),
    );
    const input = LoggingHealthV1.parse({
      ...fixture,
      counters: { ...fixture.counters, futureCounter: { detail: "private payload" } },
    });
    expect(input.counters.futureCounter).toEqual({ detail: "private payload" });
    const result = loggingCensus([{ source: "fieldd", health: input }]);
    expect(result).toMatchObject({ queueRecords: 2, queueBytes: 640, unexplainedDrops: 5 });
    expect(JSON.stringify(result)).not.toMatch(/futureCounter|private payload/u);
  });

  it("identifies one rejection without reporting it as a new loss on every later sample", () => {
    const clean = loggingCensus([{ source: "renderer", health: health() }]);
    const first = loggingCensus([{ source: "renderer", health: health(1) }], clean);
    const later = loggingCensus([{ source: "renderer", health: health(1) }], first);
    expect(first.changes).toEqual([
      { source: "renderer", counter: "rejected", previous: 0, current: 1, delta: 1 },
    ]);
    expect(later.changes).toEqual([]);
    expect(later.unexplainedDrops).toBe(1);
    const verdict = evaluatePhysicalSoak(
      [clean, first, later].map((row, cycle) => ({
        cycle,
        elapsedMs: cycle * 1_000,
        exact: { unexplainedLogDrops: row.unexplainedDrops },
        series: {},
      })),
      { warmupSamples: 0, minimumGradedSamples: 3, exactZero: ["unexplainedLogDrops"] },
    );
    expect(verdict.verdict).toBe("fail");
    expect(verdict.failures.map((failure) => failure.sample)).toEqual([1, 2]);
  });

  it("keeps counter resets and new daemon identities separate from loss deltas", () => {
    const previous = loggingCensus([{ source: "fieldd", health: health(2) }]);
    const restarted = loggingCensus([{ source: "fieldd", health: health(1, "boot-b") }], previous);
    expect(restarted.changes).toEqual([
      { source: "fieldd", counter: "rejected", previous: null, current: 1, delta: null },
    ]);
    const reset = loggingCensus([{ source: "fieldd", health: health(0, "boot-b") }], restarted);
    expect(reset.changes[0]).toMatchObject({ previous: 1, current: 0, delta: null });
  });

  it("projects only named counters and identities, and makes missing streams visible", () => {
    const input = {
      ...health(1),
      counters: { rejected: 1, droppedInfo: 2, emergencyFallbacks: 4, unrelated: 99 },
      queue: { records: 3, bytes: 48, arbitrary: "private payload" },
      rawMessage: "private payload",
    };
    const result = loggingCensus([
      { source: "desktop", health: input },
      { source: "fieldd", health: undefined },
      { source: "pluginService", health: health() },
    ]);
    expect(result).toMatchObject({ queueRecords: 3, queueBytes: 48, unexplainedDrops: 7 });
    expect(result.streams[1]).toMatchObject({ source: "fieldd", available: false });
    expect(result.streams[2]).toMatchObject({ source: "pluginService", available: true });
    expect(JSON.stringify(result)).not.toMatch(/private payload|unrelated|arbitrary|rawMessage/u);
  });
});

describe("physical soak resource probes", () => {
  it("kills a stalled probe child and records its deadline without exposing command output", async () => {
    const failures: ResourceProbeFailure[] = [];
    await expect(
      runResourceProbe(
        process.execPath,
        ["-e", "process.on('SIGTERM', () => {}); setInterval(() => {}, 1000)"],
        {
          timeoutMs: 250,
          onFailure: (failure) => failures.push(failure),
        },
      ),
    ).rejects.toThrow(/exceeded 250ms/u);
    expect(failures).toHaveLength(1);
    expect(failures[0]).toMatchObject({
      command: process.execPath,
      timedOut: true,
      signal: "SIGKILL",
      timeoutMs: 250,
    });
    expect(failures[0]!.pid).not.toBeNull();
    expect(() => process.kill(failures[0]!.pid!, 0)).toThrow();
  });

  it("keeps a failed required measurement unavailable and a successful one usable", async () => {
    const failures: ResourceProbeFailure[] = [];
    const failed = await runResourceProbe(
      process.execPath,
      ["-e", "process.stderr.write('private payload'); process.exit(7)"],
      {
        onFailure: (failure) => failures.push(failure),
      },
    );
    expect(failed).toBeNull();
    expect(failures[0]).toMatchObject({ code: 7, timedOut: false });
    expect(JSON.stringify(failures)).not.toContain("private payload");
    const verdict = evaluatePhysicalSoak(
      [
        {
          cycle: 0,
          elapsedMs: 1_000,
          exact: {},
          series: { fds: failed === null ? null : Number(failed) },
        },
      ],
      {
        warmupSamples: 0,
        minimumGradedSamples: 1,
        plateau: {
          fds: {
            required: true,
            maximumAboveBaseline: 0,
            maximumGrowth: 0,
            maximumSlopePerHour: 0,
          },
        },
      },
    );
    expect(verdict.verdict).toBe("fail");
    expect(verdict.failures).toContainEqual(
      expect.objectContaining({ kind: "missing-series", metric: "fds" }),
    );
    expect(await runResourceProbe(process.execPath, ["-e", "process.stdout.write('42')"])).toBe(
      "42",
    );
  });
});

describe("physical soak phase and power evidence", () => {
  it("emits the in-flight phase before it completes and retains both clock readings across suspension", () => {
    const events: SoakDiagnostic[] = [];
    let now = { monotonicMs: 0, wallTimeMs: 1_000_000 };
    const trace = new PhysicalSoakTrace(
      (event) => events.push(event),
      () => now,
    );
    now = { monotonicMs: 100, wallTimeMs: 1_000_100 };
    trace.mark(4, "os-resources");
    expect(events.at(-1)).toMatchObject({
      kind: "phase",
      cycle: 4,
      phase: "os-resources",
      previous: { phase: "setup", durationMs: 100 },
    });
    trace.event("suspend");
    now = { monotonicMs: 3_600_100, wallTimeMs: 4_600_100 };
    trace.event("resume");
    trace.event("operation-failed");
    trace.end("fail");
    expect(
      events.filter((event) => event.kind === "suspend" || event.kind === "resume"),
    ).toMatchObject([
      { phase: "os-resources", cycle: 4, monotonicMs: 100, wallTimeMs: 1_000_100 },
      { phase: "os-resources", cycle: 4, monotonicMs: 3_600_100, wallTimeMs: 4_600_100 },
    ]);
    expect(events.at(-1)).toMatchObject({
      kind: "end",
      outcome: "fail",
      phaseDurationMs: 3_600_000,
    });
  });
});
