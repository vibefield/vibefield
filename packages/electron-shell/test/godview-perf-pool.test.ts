/**
 * THE POOLED READER (MV-8b, M176 item 3; build-mv M155, M172) —
 * `scripts/perf-godview-pool.mjs`: a NOISY R7's one repeat qualifies only when
 * it passes fresh AND both cohorts' samples, pooled, pass. Each cohort's
 * summary must reproduce from its reports, the cohorts must have measured the
 * same thing, and no profile may serve two launches. The cohorts here are
 * written by `godview-perf-runs.ts` the way the runner writes them.
 */
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { reportName, script, writeRun } from "./godview-perf-runs";

interface Gate {
  verdict: string;
  better: string[];
  worse: string[];
}
interface Pooled {
  rounds: number;
  launches: number;
  profiles: number;
  first: { verdict: string };
  repeat: { verdict: string };
  gate: Gate;
  qualifies: boolean;
}
interface Pool {
  poolRuns(first: string, repeat: string): Pooled;
}

let pool: Pool;
beforeAll(async () => {
  pool = await script<Pool>("perf-godview-pool.mjs");
});

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});
function scratch(): string {
  const dir = mkdtempSync(join(tmpdir(), "vf-perf-pool-"));
  dirs.push(dir);
  return dir;
}

/** Two cohorts of the same run: distinct profiles, the repeat on later rounds.
 * The first is NOISY by default (its null arm moved 10 ms/s), the one verdict
 * that earns a repeat. */
async function cohorts(first = {}, repeat = {}): Promise<[string, string]> {
  const one = scratch();
  const two = scratch();
  await writeRun(one, { profileSeed: "first", nullShift: 10, ...first });
  await writeRun(two, { profileSeed: "repeat", wobbleFrom: 7, ...repeat });
  return [one, two];
}

describe("the pooled reader", () => {
  it("pools every sample of both cohorts into one R14 verdict, read by the shipping estimator", async () => {
    const [one, two] = await cohorts();
    const pooled = pool.poolRuns(one, two);
    expect([pooled.rounds, pooled.launches, pooled.profiles]).toEqual([14, 42, 42]);
    expect([pooled.first.verdict, pooled.repeat.verdict, pooled.gate.verdict]).toEqual([
      "noisy",
      "pass",
      "pass",
    ]);
    expect(pooled.gate.better).toContain("swarm × n10-8s-s1 · task ms/s");
    expect(pooled.qualifies).toBe(true);
  });

  it("does not qualify a repeat that is NOISY again: the pool still reads its null moving", async () => {
    const [one, two] = await cohorts({}, { nullShift: 10 });
    const pooled = pool.poolRuns(one, two);
    expect([pooled.first.verdict, pooled.repeat.verdict, pooled.gate.verdict]).toEqual([
      "noisy",
      "noisy",
      "noisy",
    ]);
    expect(pooled.qualifies).toBe(false);
  });

  it.each([
    ["pass", {}],
    ["worse", { shift: 40 }],
  ])(
    "refuses a first cohort that read %s: only NOISY earns a repeat (M155)",
    async (_verdict, first) => {
      const [one, two] = await cohorts({ nullShift: 0, ...first });
      expect(() => pool.poolRuns(one, two)).toThrow(/only a NOISY cohort earns one repeat/);
    },
  );

  it("refuses a cohort corroborating itself", async () => {
    const [one] = await cohorts();
    expect(() => pool.poolRuns(one, one)).toThrow(/cannot corroborate itself/);
  });

  it("refuses a summary that does not reproduce from its reports", async () => {
    const [one, two] = await cohorts();
    const path = join(two, reportName("B", 3));
    const report = JSON.parse(readFileSync(path, "utf8"));
    report.cells[0].totals.taskMsPerS += 50;
    writeFileSync(path, JSON.stringify(report));
    expect(() => pool.poolRuns(one, two)).toThrow(/do not reproduce/);
  });

  it("refuses a profile that served a launch in each cohort", async () => {
    const [one, two] = await cohorts({}, { profileSeed: "first" });
    expect(() => pool.poolRuns(one, two)).toThrow(/profile reused/);
  });

  it("refuses cohorts that measured different things", async () => {
    const [one, two] = await cohorts();
    const path = join(two, "summary.json");
    const summary = JSON.parse(readFileSync(path, "utf8"));
    summary.clock = "real";
    writeFileSync(path, JSON.stringify(summary));
    expect(() => pool.poolRuns(one, two)).toThrow(/differ in clock/);
  });

  it("refuses a negative control as a cohort", async () => {
    const [one, two] = await cohorts();
    const path = join(one, "summary.json");
    const summary = JSON.parse(readFileSync(path, "utf8"));
    summary.arms.B.synthetic = "root:2";
    writeFileSync(path, JSON.stringify(summary));
    expect(() => pool.poolRuns(one, two)).toThrow(/negative control/);
  });
});
