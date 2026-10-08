#!/usr/bin/env node
// THE POOLED READER (MV-8b, M176 item 3; build-mv M155, M172–M175) — a NOISY
// R7 earns ONE complete repeat, and the cohort qualifies only when the fresh
// repeat passes on its own AND every sample of both cohorts, pooled, passes: R14,
// read by the shipping estimator (`perf-godview-stats.mjs`), nothing excluded.
//
//   node scripts/perf-godview-pool.mjs <first run dir> <repeat run dir> [--out <file>]
//
// Before anything is pooled, each cohort's recorded summary is reproduced, row
// for row and verdict for verdict, from its own reports (a summary today's
// reader cannot reproduce is not read); the two cohorts must have measured the
// same thing (arms and sources, window, clock, warm-up, instruments, recipes,
// views, cells, and every report's monitor membership); and no Chromium profile
// may appear twice across both cohorts' launches (M155). Pairing stays within a
// round: A[i], B[i] and A′[i] of the pool are always one round's three launches.
//
// Only a NOISY first cohort earns a repeat (M155): a `worse` one has failed, and
// a `pass` needs none. Exit 0 only when the repeat's fresh verdict AND the
// pooled verdict are `pass`.
// Ported from the continuation's pool-vf-isolated-r14.mjs, minus its
// protocol-v2 archive adapter (readiness-adapter.json, corpus-input-audit.json),
// which only historical arms needed.

import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  assertLabMembershipMatches,
  assertLabMonitorProof,
  assertLabProfileProof,
} from "./godview-lab-arms.mjs";
import { reportFile } from "./perf-godview-proof.mjs";
import { cellMetrics, gateVerdict, judgeCell, metricTable } from "./perf-godview-stats.mjs";

const STATS = fileURLToPath(new URL("./perf-godview-stats.mjs", import.meta.url));
const SAME = ["arms", "window", "clock", "warmupRecipe", "instruments"];

const readJson = (path) => JSON.parse(readFileSync(path, "utf8"));
const sha256 = (path) => createHash("sha256").update(readFileSync(path)).digest("hex");
/** The summary's own JSON shape: what `JSON.stringify` wrote (NaN → null, -0 → 0). */
const normal = (value) => JSON.parse(JSON.stringify(value));

/** The frame the runner judged its rows by: offscreen at its fps, shown at 120 Hz. */
const frameMsOf = (summary) =>
  summary.window?.mode === "offscreen" ? 1000 / summary.window.fps : 1000 / 120;

/** Every cell of `runs` (per arm, round order) judged paired, A′ as the null arm. */
function judge(keys, runs, table) {
  return keys.map((cell, index) => ({
    cell,
    rows: judgeCell(
      ...["A", "B", "A′"].map((arm) => runs[arm].map((run) => cellMetrics(run.cells[index]))),
      table,
    ),
  }));
}

/** One cohort, read and reproduced: throws when its summary is not its reports'. */
function readCohort(directory, profiles, membership) {
  const dir = resolve(directory);
  const summary = readJson(join(dir, "summary.json"));
  if (JSON.stringify(Object.keys(summary.arms ?? {})) !== JSON.stringify(["A", "B", "A′"])) {
    throw new Error(`${dir}: a pooled cohort is a paired run (A, B, A′)`);
  }
  if (Object.values(summary.arms).some((arm) => arm.synthetic !== "")) {
    throw new Error(`${dir}: a synthetic arm is a negative control, never a cohort`);
  }
  const keys = summary.cells.map((cell) => cell.cell);
  const runs = { A: [], B: [], "A′": [] };
  const reports = [];
  for (let round = 1; round <= summary.rounds; round += 1) {
    for (const arm of round % 2 === 1 ? ["A", "B", "A′"] : ["A′", "B", "A"]) {
      const path = join(dir, reportFile(arm, round));
      const report = readJson(path);
      if (report.arm !== arm) throw new Error(`${path}: names arm ${report.arm}`);
      assertLabProfileProof(report.profile, path, { seen: profiles });
      const cells = report.cells.map((cell) => ({
        key: `${cell.view} × ${cell.corpus}`,
        view: cell.view,
        monitor: assertLabMonitorProof(cell.monitor, cell.view, path),
      }));
      membership.reference ??= cells;
      assertLabMembershipMatches(membership.reference, cells, path);
      runs[arm].push(report);
      reports.push({ path, sha256: sha256(path), profile: report.profile.id });
    }
  }
  const table = metricTable(frameMsOf(summary));
  const cells = judge(keys, runs, table);
  if (JSON.stringify(normal(cells)) !== JSON.stringify(summary.cells)) {
    throw new Error(`${dir}: its summary's rows do not reproduce from its reports`);
  }
  const gate = gateVerdict(cells, { paired: true, rounds: summary.rounds });
  if (JSON.stringify(normal(gate)) !== JSON.stringify(summary.gate)) {
    throw new Error(`${dir}: its summary's verdict does not reproduce from its reports`);
  }
  const recipes = JSON.stringify(runs.A[0]?.recipes);
  const views = JSON.stringify(runs.A[0]?.views);
  for (const report of [...runs.A, ...runs.B, ...runs["A′"]]) {
    if (JSON.stringify(report.recipes) !== recipes || JSON.stringify(report.views) !== views) {
      throw new Error(`${dir}: its launches did not all run the same recipes and views`);
    }
  }
  return { dir, summary, keys, runs, reports, recipes, views, table };
}

/** Pool two complete cohorts of the same run (the first, and its one repeat). */
export function poolRuns(firstDirectory, repeatDirectory) {
  const [first, repeat] = [firstDirectory, repeatDirectory].map((dir) => resolve(dir));
  if (first === repeat) throw new Error("a cohort cannot corroborate itself");
  const profiles = new Set();
  const membership = {};
  const cohorts = [first, repeat].map((dir) => readCohort(dir, profiles, membership));
  const [a, b] = cohorts;
  if (a.summary.gate.verdict !== "noisy") {
    throw new Error(
      `${a.dir}: read ${a.summary.gate.verdict}; only a NOISY cohort earns one repeat (M155)`,
    );
  }
  for (const key of SAME) {
    if (JSON.stringify(a.summary[key]) !== JSON.stringify(b.summary[key])) {
      throw new Error(`the cohorts differ in ${key}: not the same measurement`);
    }
  }
  if (a.recipes !== b.recipes || a.views !== b.views) {
    throw new Error("the cohorts ran different recipes or views");
  }
  if (JSON.stringify(a.keys) !== JSON.stringify(b.keys)) {
    throw new Error("the cohorts measured different cells");
  }
  const all = { A: [], B: [], "A′": [] };
  for (const cohort of cohorts) {
    for (const arm of Object.keys(all)) all[arm].push(...cohort.runs[arm]);
  }
  const rounds = a.summary.rounds + b.summary.rounds;
  const cells = judge(a.keys, all, a.table);
  const gate = gateVerdict(cells, { paired: true, rounds });
  return {
    statsSha256: sha256(STATS),
    first: {
      dir: a.dir,
      verdict: a.summary.gate.verdict,
      summarySha256: sha256(join(a.dir, "summary.json")),
    },
    repeat: {
      dir: b.dir,
      verdict: b.summary.gate.verdict,
      summarySha256: sha256(join(b.dir, "summary.json")),
    },
    rounds,
    launches: a.reports.length + b.reports.length,
    profiles: profiles.size,
    reports: [...a.reports, ...b.reports],
    gate,
    cells,
    qualifies: b.summary.gate.verdict === "pass" && gate.verdict === "pass",
  };
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const argv = process.argv.slice(2);
  const out = argv.includes("--out") ? argv[argv.indexOf("--out") + 1] : undefined;
  const [first, repeat] = argv.filter(
    (arg, index) => !arg.startsWith("--") && argv[index - 1] !== "--out",
  );
  if (first === undefined || repeat === undefined) {
    process.stderr.write(
      "usage: node scripts/perf-godview-pool.mjs <first> <repeat> [--out <file>]\n",
    );
    process.exit(2);
  }
  try {
    const pooled = poolRuns(first, repeat);
    if (out !== undefined) writeFileSync(out, `${JSON.stringify(pooled, null, 2)}\n`);
    const { first: one, repeat: two, rounds, launches, profiles, gate, qualifies } = pooled;
    process.stdout.write(
      `${JSON.stringify({ first: one.verdict, repeat: two.verdict, pooled: gate.verdict, rounds, launches, profiles, worse: gate.worse, noisy: gate.noisy, missing: gate.missing, shifted: gate.shifted, qualifies })}\n`,
    );
    process.exit(qualifies ? 0 : 1);
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exit(1);
  }
}
