// PF-21 (2026-11-23) — the run ledger: what each run has run and used so far, kept across a resume and a restart.
// The file's own rules (a clock never runs backward, a figure that is no amount is left out, a file that does not
// parse costs the figures and nothing else) and the pure sums the runtime makes with it.
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AgentMonitorMirror } from "@vibefield/contracts";
import { afterEach, describe, expect, it } from "vitest";
import {
  carriedFrom,
  combineCoverage,
  ownUsage,
  RUN_LEDGER_MAX_RUNS,
  RunLedger,
  recordedRanMs,
  runTotals,
} from "../src/agent-run-ledger";

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function ledgerAt(now: () => Date = () => new Date("2026-11-23T10:00:00.000Z")): {
  ledger: RunLedger;
  path: string;
} {
  const root = mkdtempSync(join(tmpdir(), "vf-run-ledger-"));
  roots.push(root);
  const path = join(root, "agents", "run-ledger.json");
  return { ledger: new RunLedger({ path, now }), path };
}

function mirror(usage: Record<string, unknown> | undefined): AgentMonitorMirror {
  return {
    schemaVersion: 3,
    runtimeEpoch: 1,
    revision: 1,
    runtimeRunId: "run-1",
    status: "idle",
    statusSince: "2026-11-23T09:00:00.000Z",
    blockers: [],
    alive: true,
    ...(usage !== undefined ? { usage } : {}),
  } as AgentMonitorMirror;
}

const BORN = "2026-11-23T09:00:00.000Z";
const at = (iso: string): number => Date.parse(iso);

describe("PF-21 — a run's totals", () => {
  it("is the run's own time and count when it carries nothing", () => {
    expect(
      runTotals({
        carried: undefined,
        createdAt: BORN,
        untilMs: at("2026-11-23T09:30:00.000Z"),
        own: { usd: 1.25, coverage: "complete", tokens: 500 },
      }),
    ).toEqual({ ranMs: 30 * 60_000, usd: 1.25, coverage: "complete", tokens: 500 });
  });

  it("goes on from what the run carried in: the clock, the cost and the tokens", () => {
    expect(
      runTotals({
        carried: { ranMs: 2 * 3_600_000, usd: 10, tokens: 2_000_000 },
        createdAt: BORN,
        untilMs: at("2026-11-23T09:05:00.000Z"),
        own: { usd: 0.5, coverage: "complete", tokens: 100 },
      }),
    ).toEqual({
      ranMs: 2 * 3_600_000 + 5 * 60_000,
      usd: 10.5,
      coverage: "complete",
      tokens: 2_000_100,
    });
  });

  it("has the carried figures before the run has counted anything", () => {
    expect(
      runTotals({
        carried: { ranMs: 60_000, usd: 4.5, coverage: "partial", tokens: 900 },
        createdAt: BORN,
        untilMs: at(BORN),
        own: {},
      }),
    ).toEqual({ ranMs: 60_000, usd: 4.5, coverage: "partial", tokens: 900 });
  });

  it("says a floor when either half went unpriced, and no cost at all when neither names one", () => {
    const base = { createdAt: BORN, untilMs: at(BORN) };
    expect(
      runTotals({ ...base, carried: { usd: 3 }, own: { usd: 1, coverage: "partial" } }).coverage,
    ).toBe("partial");
    expect(
      runTotals({
        ...base,
        carried: { usd: 3, coverage: "partial" },
        own: { usd: 1, coverage: "complete" },
      }).coverage,
    ).toBe("partial");
    expect(runTotals({ ...base, carried: { ranMs: 5 }, own: { tokens: 7 } })).toEqual({
      ranMs: 5,
      tokens: 7,
    });
  });

  it("counts no time before a birth it cannot read or one the clock has not reached", () => {
    expect(
      runTotals({ carried: { ranMs: 9 }, createdAt: "not a time", untilMs: 5_000, own: {} }).ranMs,
    ).toBe(9);
    expect(
      runTotals({ carried: undefined, createdAt: BORN, untilMs: at(BORN) - 5_000, own: {} }).ranMs,
    ).toBe(0);
    // a carried figure that is no amount carries nothing
    expect(
      runTotals({
        carried: { ranMs: -4, usd: Number.NaN, tokens: -1 },
        createdAt: BORN,
        untilMs: at(BORN),
        own: {},
      }),
    ).toEqual({ ranMs: 0 });
  });

  it("reads a mirror's own count, and nothing a mirror does not say", () => {
    expect(ownUsage(undefined)).toEqual({});
    expect(ownUsage(mirror(undefined))).toEqual({});
    expect(
      ownUsage(mirror({ costUsd: 1.5, costCoverage: "complete", cumulativeTokens: 40 })),
    ).toEqual({ usd: 1.5, coverage: "complete", tokens: 40 });
    // tokens no price reached: the whole is a floor
    expect(ownUsage(mirror({ cumulativeTokens: 40 }))).toEqual({ coverage: "partial", tokens: 40 });
    expect(ownUsage(mirror({ costUsd: 2, costCoverage: "unavailable" }))).toEqual({
      usd: 2,
      coverage: "partial",
    });
    expect(ownUsage(mirror({ costUsd: Number.NaN, cumulativeTokens: -3 }))).toEqual({});
  });

  it("joins two coverages", () => {
    expect(combineCoverage(undefined, undefined)).toBeUndefined();
    expect(combineCoverage("complete", undefined)).toBe("complete");
    expect(combineCoverage(undefined, "partial")).toBe("partial");
    expect(combineCoverage("complete", "complete")).toBe("complete");
    expect(combineCoverage("complete", "partial")).toBe("partial");
  });

  it("hands a line on as what the next run carries", () => {
    expect(carriedFrom({ ranMs: 7, usd: 2, coverage: "complete", tokens: 3 })).toEqual({
      ranMs: 7,
      usd: 2,
      coverage: "complete",
      tokens: 3,
    });
    expect(carriedFrom({ ranMs: 7 })).toEqual({ ranMs: 7 });
  });
});

describe("PF-21 — what a record alone can say of its session's time", () => {
  it("is its carried time plus birth to an exit fieldd saw", () => {
    expect(
      recordedRanMs({
        createdAt: BORN,
        carried: { ranMs: 60_000 },
        exited: { at: "2026-11-23T09:10:00.000Z", reason: "exited" },
      }),
    ).toBe(60_000 + 10 * 60_000);
  });

  it("says nothing with no exit, or with an exit a later boot stamped", () => {
    expect(recordedRanMs({ createdAt: BORN })).toBeUndefined();
    expect(
      recordedRanMs({
        createdAt: BORN,
        exited: { at: "2026-11-24T09:00:00.000Z", reason: "unknown" },
      }),
    ).toBeUndefined();
    expect(
      recordedRanMs({
        createdAt: BORN,
        exited: { at: "2026-11-23T08:00:00.000Z", reason: "exited" },
      }),
    ).toBeUndefined();
  });
});

describe("PF-21 — the run ledger's file", () => {
  it("keeps a run's line across a daemon: written 0600, read back by the next", () => {
    const { ledger, path } = ledgerAt();
    expect(ledger.read("run-1")).toBeUndefined();
    ledger.note("run-1", { ranMs: 90_000, usd: 1.5, coverage: "complete", tokens: 400 });
    ledger.note("run-2", { ranMs: 5_000 });
    ledger.flush();
    if (process.platform !== "win32") expect(statSync(path).mode & 0o777).toBe(0o600);
    const next = new RunLedger({ path });
    next.load();
    expect(next.read("run-1")).toEqual({
      ranMs: 90_000,
      usd: 1.5,
      coverage: "complete",
      tokens: 400,
      asOf: "2026-11-23T10:00:00.000Z",
    });
    expect(next.read("run-2")).toEqual({ ranMs: 5_000, asOf: "2026-11-23T10:00:00.000Z" });
    expect(next.size).toBe(2);
  });

  it("never runs a clock backward, and keeps a figure the next totals do not say", () => {
    const { ledger } = ledgerAt();
    ledger.note("run-1", { ranMs: 90_000, usd: 1.5, coverage: "complete", tokens: 400 });
    ledger.note("run-1", { ranMs: 30_000 });
    expect(ledger.read("run-1")).toMatchObject({
      ranMs: 90_000,
      usd: 1.5,
      coverage: "complete",
      tokens: 400,
    });
    // a correction of a figure is taken as said
    ledger.note("run-1", { ranMs: 120_000, usd: 1.2, coverage: "partial", tokens: 410 });
    expect(ledger.read("run-1")).toMatchObject({
      ranMs: 120_000,
      usd: 1.2,
      coverage: "partial",
      tokens: 410,
    });
    // a line that names no time is no line
    ledger.note("run-9", { ranMs: Number.NaN });
    ledger.note("", { ranMs: 5 });
    expect(ledger.read("run-9")).toBeUndefined();
    expect(ledger.size).toBe(1);
  });

  it("writes nothing while no line moved", () => {
    const { ledger, path } = ledgerAt();
    ledger.note("run-1", { ranMs: 10 });
    ledger.flush();
    const first = readFileSync(path, "utf8");
    writeFileSync(path, "tampered", { mode: 0o600 });
    ledger.note("run-1", { ranMs: 10 });
    ledger.flush();
    expect(readFileSync(path, "utf8")).toBe("tampered");
    ledger.note("run-1", { ranMs: 11 });
    ledger.flush();
    expect(JSON.parse(readFileSync(path, "utf8"))).toMatchObject({
      v: 1,
      runs: { "run-1": { ranMs: 11 } },
    });
    expect(first).toContain('"run-1"');
  });

  it("reads a file that does not parse as empty, and a line that is no figure as no line", () => {
    const { ledger, path } = ledgerAt();
    ledger.note("seed", { ranMs: 1 });
    ledger.flush();
    writeFileSync(path, "{ not json", { mode: 0o600 });
    const broken = new RunLedger({ path });
    broken.load();
    expect(broken.size).toBe(0);
    writeFileSync(
      path,
      JSON.stringify({
        v: 1,
        runs: {
          good: {
            ranMs: 7.9,
            usd: 2,
            coverage: "complete",
            tokens: 3,
            asOf: "2026-11-23T09:00:00Z",
            later: 1,
          },
          noTime: { usd: 2 },
          badFigures: { ranMs: 4, usd: -1, tokens: "many", coverage: "complete" },
          notAnObject: 5,
        },
      }),
      { mode: 0o600 },
    );
    const tolerant = new RunLedger({ path });
    tolerant.load();
    expect(tolerant.read("good")).toEqual({
      ranMs: 7,
      usd: 2,
      coverage: "complete",
      tokens: 3,
      asOf: "2026-11-23T09:00:00Z",
    });
    expect(tolerant.read("noTime")).toBeUndefined();
    expect(tolerant.read("badFigures")).toEqual({ ranMs: 4, asOf: "" });
    expect(tolerant.read("notAnObject")).toBeUndefined();
    // another version's file is not read
    writeFileSync(path, JSON.stringify({ v: 2, runs: { good: { ranMs: 7 } } }), { mode: 0o600 });
    const other = new RunLedger({ path });
    other.load();
    expect(other.size).toBe(0);
  });

  it("forgets a run, and bounds its lines by dropping the oldest", () => {
    let tick = 0;
    const { ledger, path } = ledgerAt(
      () => new Date(Date.parse("2026-11-23T10:00:00.000Z") + tick++),
    );
    for (let n = 0; n < RUN_LEDGER_MAX_RUNS + 3; n += 1) ledger.note(`run-${n}`, { ranMs: n + 1 });
    ledger.flush();
    expect(ledger.size).toBe(RUN_LEDGER_MAX_RUNS);
    expect(ledger.read("run-0")).toBeUndefined();
    expect(ledger.read("run-2")).toBeUndefined();
    expect(ledger.read("run-3")).toBeDefined();
    ledger.forget("run-3");
    ledger.flush();
    const next = new RunLedger({ path });
    next.load();
    expect(next.read("run-3")).toBeUndefined();
    expect(next.size).toBe(RUN_LEDGER_MAX_RUNS - 1);
  });
});
