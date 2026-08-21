// THE PER-PR MICROBENCH (spec §19.3: "Worker microbench (no Electron,
// vitest/Node): the pure-JS stages ... over the corpus, per PR in CI").
//
//   pnpm perf:terminal:bench
//
// It is a vitest file so CI can run it with the same runner as everything else
// and so a REGRESSION can fail rather than merely print. The assertions are
// deliberately loose ceilings, not the budget: §18's budgets are hypotheses
// until the baseline exists, and a per-PR gate that fails on a 15% move on a
// loaded shared runner is a gate that gets disabled. What it catches is an
// ORDER-OF-MAGNITUDE regression — an accidental O(n^2), a per-frame allocation
// storm, a decode that started copying.
import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, it } from "vitest";
import { formatReport, runBench } from "../src/bench";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../../..");
const CORPUS = join(ROOT, "fixtures", "terminal-perf", "trf1");

/** Ceilings, per frame, on a 100x30 grid. Chosen an order of magnitude above the
 * measured baseline so host load never reds the gate; the BASELINE, not this
 * number, is what a change is compared against. */
const DECODE_P99_CEILING_US = 2_000;
const APPLY_P99_CEILING_US = 4_000;

it("decodes and applies the TRF1 corpus within an order of magnitude of baseline", () => {
  const report = runBench(CORPUS, { runs: 5, warmupRuns: 2, nullArm: true });
  const text = formatReport(report);
  console.log(`\n${text}\n`);

  // The artifact a CI job uploads and a PR comment quotes.
  const out = process.env["TERMINAL_PERF_OUT"];
  if (out !== undefined) {
    writeFileSync(out, `${JSON.stringify(report)}\n`);
  }

  expect(report.traces.length).toBeGreaterThan(0);
  for (const trace of report.traces) {
    expect(trace.frames, `${trace.name} has no frames`).toBeGreaterThan(0);
    // Every frame must have been APPLIED: a corpus that decodes into stale or
    // resync is a corpus recorded with holes, and its timings would be of the
    // early-return path rather than of apply.
    expect(trace.classes.stale, `${trace.name} decoded stale frames`).toBe(0);
    expect(trace.classes.resync, `${trace.name} needed a resync`).toBe(0);
    expect(trace.decodeUs.p99, `${trace.name} decode p99`).toBeLessThan(DECODE_P99_CEILING_US);
    expect(trace.applyUs.p99, `${trace.name} apply p99`).toBeLessThan(APPLY_P99_CEILING_US);
  }

  // The null arm must be far below the real work, or the numbers above are
  // measuring the harness.
  expect(report.nullArmUs?.p50 ?? 0).toBeLessThan(report.corpus.decodeUs.p50);
});
