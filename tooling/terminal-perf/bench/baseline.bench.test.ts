// THE EXISTING-PATH BASELINE (TP-S0a deliverable 4).
//
//   TERMINAL_PERF_RESULTS=<dir> pnpm perf:terminal:bench
//
// Writes `RESULTS.md` + `baseline.jsonl` into the results home. Without the env
// var it still runs and prints, so the numbers are visible on every bench run
// and only the PUBLICATION is deliberate.
import { mkdirSync, writeFileSync } from "node:fs";
import { cpus, loadavg, totalmem } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, it } from "vitest";
import { formatReport, runBench } from "../src/bench";
import { formatScenarios, runScenarios, SCENARIOS } from "../src/scenarios";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../../..");
const CORPUS = join(ROOT, "fixtures", "terminal-perf", "trf1");

it("publishes the existing-path baseline", () => {
  const startedAt = new Date();
  const loadAtStart = loadavg();
  const stages = runBench(CORPUS, { runs: 5, warmupRuns: 2, nullArm: true });
  const scenarios = runScenarios(CORPUS, { runs: 3, warmupRuns: 2, rotations: 3 });
  const loadAtEnd = loadavg();

  const stageText = formatReport(stages);
  const scenarioText = formatScenarios(scenarios);
  console.log(`\n${stageText}\n\n${scenarioText}\n`);

  expect(scenarios.length).toBe(SCENARIOS.length);
  for (const scenario of scenarios) expect(scenario.frames).toBeGreaterThan(0);

  const home = process.env["TERMINAL_PERF_RESULTS"];
  if (home === undefined) return;
  mkdirSync(home, { recursive: true });

  const host = {
    platform: process.platform,
    arch: process.arch,
    cpus: cpus().length,
    cpuModel: cpus()[0]?.model ?? "unknown",
    memoryGiB: Math.round((totalmem() / 1024 ** 3) * 10) / 10,
    node: process.version,
    loadAvgAtStart: loadAtStart.map((value) => Math.round(value * 100) / 100),
    loadAvgAtEnd: loadAtEnd.map((value) => Math.round(value * 100) / 100),
  };

  const lines = [
    JSON.stringify({ kind: "run", startedAt: startedAt.toISOString(), host }),
    ...stages.traces.map((trace) => JSON.stringify({ kind: "trace", ...trace })),
    JSON.stringify({ kind: "corpus", ...stages.corpus, nullArmUs: stages.nullArmUs }),
    ...scenarios.map((scenario) => JSON.stringify({ kind: "scenario", ...scenario })),
  ];
  writeFileSync(join(home, "baseline.jsonl"), `${lines.join("\n")}\n`);
  writeFileSync(join(home, "baseline-report.txt"), `${stageText}\n\n${scenarioText}\n`);
  writeFileSync(join(home, "host.json"), `${JSON.stringify(host, null, 2)}\n`);
}, 900_000);
