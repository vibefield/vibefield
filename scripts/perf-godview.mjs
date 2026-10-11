#!/usr/bin/env node
// THE PAIRED RUNNER (MV-0, step 6; L14 + L17; MV-3c: M24, M30, M31). Interleaves
// the arms — A (a base checkout, built) and B (a slice's checkout, built) —
// launching the real product in `--godview-perf-lab` mode once per arm per
// round, a fresh process each time, and judges every cell × metric by the
// PAIRED differences across rounds against an A/A null arm.
//
//   · A/B (two roots): every round launches A, B and A′ (A again), in the order
//     A B A′ on odd rounds and A′ B A on even ones, so B always sits between two
//     launches of its base. T = median(B − A) is the effect; T₀ = median(A′ − A)
//     is the null arm, read the same way, in the same session (L14).
//   · A/A (one root, the default: this checkout): A and B are the same build and
//     the run IS the null arm.
//
// MV-8: both arms default to model streams, computed offline in their own
// checkout by fieldd's backend (`perf:godview:model`). Only the renderer is
// measured. A pre-MV-3b checkout still reads fold corpora: choose it explicitly
// with `--source-a fold` (and `--source-b fold` for an old-tree A/A). Current
// players reject missing streams instead of falling back to the retired door.
//
// M33 — THE GATE READS TOTAL WORK. MV-2's run found per-view rows blind to a
// view in its own React root (the view host's legacy bridge) and to work the
// frame scheduler moved into rAF. So every cell carries Chromium's main-thread
// totals per second (task, script, layout, style — CDP `Performance.getMetrics`
// at the cell's start and end) and every React root's summed render time; the
// GATE rows are those totals, and the per-view rows (renders, commits, posts,
// latencies, rAF work) stay as context. Render time needs React's profiling
// build, so the runner builds every arm with `VF_REACT_PROFILING=1` first (M32:
// "A/B perf builds every arm first"; `--no-build` skips it, and a run whose
// renderer is untimed says so). `--synthetic-b root:<ms>` makes B
// the same build plus a synthetic load (a side React root committing per frame): the gate's negative control, which the
// summary must call worse.
//
// It waits for the load average to fall below 60 before the first launch (L17),
// records the load beside every launch, and never reads an absolute figure as a
// verdict: medians are the estimator, tails are weather (memory
// `loaded-host-measurement-discipline`), and the A/A is read PAIRED and judged
// by its own spread (memory `aa-control-read-paired`).
//
//   node scripts/perf-godview.mjs [--a <root>] [--b <root>] [--rounds 7]
//     [--recipes "n=10,duration=8000,seed=1;n=20,...;n=60,..."]
//     [--views swarm,list,rain,timeline] [--out <dir>] [--load-max 60]
//     [--label <text>] [--source-a fold|model] [--source-b fold|model]
//     [--window offscreen|shown] [--fps 60] [--scale 2] [--clock corpus|real]
//     [--no-build] [--synthetic-b root:2]
//
// Every root is built first with React's profiling client (`VF_REACT_PROFILING=1
// pnpm --filter @vibefield/desktop build:all` in that checkout); with
// `--no-build` both native executables and the JS hosts must already be built.
// Every arm runs the same window mode (M31: offscreen by
// default, never focused, never on top — proven: the swarm renders WebGPU
// there), the same clock, the same warm-up — and the summary says which views
// each arm's lab warmed, as its launches reported (`perf-godview-method.mjs`).

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import {
  assertLabBuilt,
  assertLabDeckProof,
  assertLabMembershipMatches,
  assertLabProfileProof,
  buildRoot,
  launchLab,
  log,
  modelStreams,
  WARMUP_RECIPE,
  waitForLoad,
} from "./godview-lab-arms.mjs";
import { warmedViews, warmupLine } from "./perf-godview-method.mjs";
import {
  cellMetrics,
  gateVerdict,
  judgeCell,
  MIN_ROUNDS,
  metricTable,
} from "./perf-godview-stats.mjs";

const argv = process.argv.slice(2);
const option = (name, fallback) => {
  const index = argv.indexOf(`--${name}`);
  return index === -1 ? fallback : (argv[index + 1] ?? fallback);
};

const repoRoot = resolve(new URL("..", import.meta.url).pathname);
const rootA = resolve(option("a", repoRoot));
const rootB = resolve(option("b", rootA));
const rounds = Math.max(1, Number(option("rounds", "7")));
const recipes = option(
  "recipes",
  "n=10,duration=8000,seed=1;n=20,duration=8000,seed=1;n=60,duration=8000,seed=1",
);
const views = option("views", "swarm,list,rain,timeline");
const loadMax = Number(option("load-max", "60"));
const windowMode = option("window", "offscreen") === "shown" ? "shown" : "offscreen";
const fps = Number(option("fps", "60"));
const scale = Number(option("scale", "2"));
const clock = option("clock", "corpus") === "real" ? "real" : "corpus";
const build = !argv.includes("--no-build");
const syntheticB = option("synthetic-b", "");
// a synthetic B is the same build, judged against its own A′ (the negative control)
const paired = rootA !== rootB || syntheticB !== "";
const label = option(
  "label",
  syntheticB !== "" ? `A/B (B = A + synthetic ${syntheticB})` : paired ? "A/B" : "A/A",
);
const sourceA = option("source-a", "model") === "model" ? "model" : "fold";
// B reads the model only when it is another build (after MV-3b); a synthetic B is A
const sourceB =
  option("source-b", rootA !== rootB ? "model" : sourceA) === "model" ? "model" : "fold";
const stamp = new Date().toISOString().replace(/[:.]/g, "-");
const outDir = resolve(
  option("out", join(repoRoot, ".vibefield", "perf", "godview", "paired", stamp)),
);
mkdirSync(outDir, { recursive: true });

/** The arms, each a root and a source; A′ is A's own build and source. */
const ARMS = {
  A: { root: rootA, source: sourceA, synthetic: "" },
  B: { root: rootB, source: sourceB, synthetic: syntheticB },
  ...(paired ? { "A′": { root: rootA, source: sourceA, synthetic: "" } } : {}),
};

function assertBuilt() {
  for (const { root } of Object.values(ARMS)) assertLabBuilt(root);
}

async function launch(arm, { root, source, modelDir, synthetic }, round) {
  const file = arm === "A′" ? "A2" : arm;
  const out = join(outDir, `${file}-r${round}.json`);
  const code = await launchLab({
    root,
    reportPath: out,
    env: {
      VF_GODVIEW_PERF_OUT: out,
      VF_GODVIEW_PERF_RECIPES: recipes,
      VF_GODVIEW_PERF_VIEWS: views,
      VF_GODVIEW_PERF_ARM: arm,
      VF_GODVIEW_PERF_ROUND: String(round),
      VF_GODVIEW_PERF_SOURCE: source,
      ...(modelDir !== undefined ? { VF_GODVIEW_PERF_MODEL_DIR: modelDir } : {}),
      VF_GODVIEW_PERF_WARMUP_RECIPE: WARMUP_RECIPE,
      VF_GODVIEW_PERF_CLOCK: clock,
      VF_GODVIEW_PERF_WINDOW: windowMode,
      VF_GODVIEW_PERF_FPS: String(fps),
      VF_GODVIEW_PERF_SCALE: String(scale),
      ...(synthetic !== "" ? { VF_GODVIEW_PERF_SYNTHETIC: synthetic } : {}),
    },
    logPath: join(outDir, `${file}-r${round}.log`),
    echo: "GODVIEW_PERF_LAB",
    prefix: `${arm} r${round}`,
  });
  if (code !== 0 || !existsSync(out)) {
    throw new Error(
      `arm ${arm} round ${round} exited ${code} (${out} ${existsSync(out) ? "written" : "missing"})`,
    );
  }
  const sample = JSON.parse(readFileSync(out, "utf8"));
  if (!Array.isArray(sample?.cells) || sample.cells.length === 0) {
    throw new Error(`arm ${arm} round ${round}: no measured cells (${out})`);
  }
  for (const [index, cell] of sample.cells.entries()) {
    const context = `arm ${arm} round ${round} cell ${index}`;
    assertLabDeckProof(cell?.deck?.start, `${context} start`);
    assertLabDeckProof(cell?.deck?.end, `${context} end`);
  }
  return sample;
}

/** The gate table's columns: the totals, the decisive frame rows, the components. */
const GATE_COLUMNS = [
  "task ms/s",
  "react render ms/s",
  "frame p50 ms",
  "loaf blocking ms",
  "script ms/s",
  "layout ms/s",
  "recalc style ms/s",
];

/** A frame is the window mode's: 1000/fps offscreen, the display's 8.3 ms shown. */
const frameMs = windowMode === "offscreen" ? 1000 / fps : 1000 / 120;
const METRICS = metricTable(frameMs);

/** `cell · metric` entries, one cell per group: `cell (metric, metric) · …` */
function byCell(entries) {
  const groups = new Map();
  for (const entry of entries) {
    const [cell, metric] = entry.split(" · ");
    groups.set(cell, [...(groups.get(cell) ?? []), metric]);
  }
  return [...groups].map(([cell, metrics]) => `${cell} (${metrics.join(", ")})`).join(" · ");
}

const fmt = (value, digits = 2) => (Number.isFinite(value) ? value.toFixed(digits) : "–");

async function main() {
  log(`godview paired perf · ${label} · rounds ${rounds} · out ${outDir}`);
  for (const [arm, { root, source, synthetic }] of Object.entries(ARMS))
    log(`${arm} ${root} (${source}${synthetic !== "" ? `, synthetic ${synthetic}` : ""})`);
  log(
    `window ${windowMode}${windowMode === "offscreen" ? ` @ ${fps} fps ×${scale}` : ""} · clock ${clock}`,
  );
  // every distinct root built once, with React's profiling client (M33)
  if (build) {
    const built = new Set();
    for (const [arm, { root }] of Object.entries(ARMS)) {
      if (built.has(root)) continue;
      built.add(root);
      await buildRoot(root, join(outDir, `build-${arm === "A′" ? "A" : arm}.log`));
    }
  }
  assertBuilt();
  // the model streams first, each in the root whose fieldd answers it
  const streams = new Map();
  for (const [arm, spec] of Object.entries(ARMS)) {
    if (spec.source !== "model" || streams.has(spec.root)) continue;
    const name = arm === "A′" ? "A" : arm;
    streams.set(
      spec.root,
      await modelStreams(
        spec.root,
        join(outDir, `model-streams-${name}`),
        `${recipes};${WARMUP_RECIPE}`,
        join(outDir, `model-streams-${name}.log`),
      ),
    );
  }
  for (const spec of Object.values(ARMS)) spec.modelDir = streams.get(spec.root);
  const loadAtStart = await waitForLoad(loadMax);
  log(`load ${loadAtStart.toFixed(1)} < ${loadMax}: starting`);
  const runs = Object.fromEntries(Object.keys(ARMS).map((arm) => [arm, []]));
  const loads = [];
  let membership;
  const profiles = new Set();
  for (let round = 1; round <= rounds; round += 1) {
    const order = !paired ? ["A", "B"] : round % 2 === 1 ? ["A", "B", "A′"] : ["A′", "B", "A"];
    for (const arm of order) {
      // Every arm starts under the same declared ceiling, even after a load spike.
      const load = await waitForLoad(loadMax);
      loads.push({ round, arm, load });
      log(`round ${round} arm ${arm} (load ${load.toFixed(1)})`);
      const sample = await launch(arm, ARMS[arm], round);
      assertLabProfileProof(sample.profile, `arm ${arm} round ${round}`, { seen: profiles });
      const proof = sample.cells.map((cell) => ({
        key: `${cell.view} × ${cell.corpus}`,
        view: cell.view,
        monitor: cell.monitor,
      }));
      membership ??= proof;
      assertLabMembershipMatches(membership, proof, `arm ${arm} round ${round}`);
      runs[arm].push(sample);
    }
  }

  // cells are keyed view × corpus; every run has the same set
  const keys = runs.A[0].cells.map((cell) => `${cell.view} × ${cell.corpus}`);
  // M33's instruments, as each launch said: the hook stood, CDP answered, React
  // timed — and what its lab's warm-up replayed through (the method law)
  const instruments = Object.fromEntries(
    Object.entries(runs).map(([arm, list]) => [
      arm,
      {
        reactHook: list.every((run) => run.reactHook === true),
        metered: list.every((run) => run.metered === true),
        timed: list.every((run) => run.cells.every((cell) => cell.report?.react?.timed === true)),
        swarmRenderers: [
          ...new Set(list.flatMap((run) => run.cells.map((cell) => cell.swarmRenderer))),
        ].filter((renderer) => renderer !== null),
        warmedViews: warmedViews(list),
      },
    ]),
  );
  const summary = {
    profiles: [...profiles],
    label,
    arms: Object.fromEntries(
      Object.entries(ARMS).map(([arm, { root, source, synthetic }]) => [
        arm,
        { root, source, synthetic },
      ]),
    ),
    instruments,
    rounds,
    window: { mode: windowMode, fps, scale },
    clock,
    warmupRecipe: WARMUP_RECIPE,
    // the ceiling every launch started under: the proof audit's quiet line
    loadMax,
    loads,
    startedAt: stamp,
    cells: [],
  };
  const md = [
    `# Godview paired perf — ${label}`,
    "",
    ...Object.entries(ARMS).map(
      ([arm, { root, source, synthetic }]) =>
        `- ${arm}: \`${root}\` (source: ${source}${synthetic !== "" ? `; synthetic load ${synthetic}` : ""})`,
    ),
    `- instruments: ${Object.entries(instruments)
      .map(
        ([arm, held]) =>
          `${arm} hook ${held.reactHook ? "yes" : "NO"} · CDP ${held.metered ? "yes" : "NO"} · React timed ${held.timed ? "yes" : "NO"} · swarm ${held.swarmRenderers.join("/") || "–"}`,
      )
      .join("; ")}`,
    `- rounds: ${rounds}, ${paired ? "A B A′ / A′ B A alternating" : "A,B"} per round, one Electron process per launch`,
    `- window: ${windowMode}${windowMode === "offscreen" ? ` (${fps} fps, scale ${scale}: frame p50 is pinned there; read rAF work, delivery work and LoAF)` : ""}; clock: ${clock}`,
    warmupLine(
      WARMUP_RECIPE,
      Object.fromEntries(Object.entries(instruments).map(([arm, held]) => [arm, held.warmedViews])),
    ),
    `- load average at launches (each waited below ${loadMax}; the proof audit reads each launch's end): ${loads.map((l) => `${l.arm}${l.round} ${l.load.toFixed(0)}`).join(" · ")}`,
    "- estimator: medians; paired diff T = median(B−A), z = |T| / (1.858·MAD/√R); tails are weather",
    paired
      ? "- null arm: T₀ = median(A′−A), the same build twice in the same session; `reading` names an effect past z > 4 and the metric's floor (M40, literally: 2 % of A for the totals and components, components also ≥ 1 ms/s), and `noisy` when the null arm itself clears that (a reading aid — the verdict is the lead's, L14)"
      : "- this run IS the null arm: T reads the instrument's own noise",
    "",
  ];
  for (const [index, key] of keys.entries()) {
    const read = (arm) => runs[arm].map((run) => cellMetrics(run.cells[index]));
    const rows = judgeCell(read("A"), read("B"), paired ? read("A′") : null, METRICS);
    summary.cells.push({ cell: key, rows });
  }
  // THE GATE (M33): the totals, every cell — before the per-cell tables
  const gate = gateVerdict(summary.cells, { paired, rounds });
  summary.gate = gate;
  md.push(
    `## The gate (M33: total work) — ${gate.verdict.toUpperCase()}`,
    "",
    ...(gate.verdict === "unread"
      ? [
          `**Unread: ${rounds} rounds — z is not read before ${MIN_ROUNDS} (M24).** The rows below are context only.`,
          "",
        ]
      : []),
    paired
      ? "Decisive rows (M33, M40): main-thread task ms/s (CDP) and every React root's render ms/s — the totals — plus frame p50 and the LoAF rows. The task total's components (script, layout, style) gate only when material (≥ 1 ms/s and > 2 %), and read `shifted` when they rose while the total fell. `worse` = M40 literally: z > 4 and T > 2 % of A (no null envelope, M177); `noisy` = the null arm itself clears that. A reading aid — the verdict is the lead's (L14)."
      : "An A/A run: no gate row should clear z > 4 and its floor (`null-ok`); one that does is the instrument's own noise (`null-moved`).",
    "",
    `| cell | ${GATE_COLUMNS.map((name) => `${name} A→B (z${paired ? ", z₀" : ""})`).join(" | ")} | reading |`,
    `|---|${GATE_COLUMNS.map(() => "---").join("|")}|---|`,
  );
  for (const { cell, rows } of summary.cells) {
    const byName = new Map(rows.map((row) => [row.metric, row]));
    const shown = GATE_COLUMNS.map((name) => {
      const row = byName.get(name);
      return row === undefined
        ? "–"
        : `${fmt(row.A, 1)}→${fmt(row.B, 1)} (${fmt(row.z, 1)}${paired ? `, ${fmt(row.z0, 1)}` : ""})`;
    });
    const readings = rows
      .filter((row) => row.gate && row.reading !== "")
      .map((row) => `${row.metric}: ${row.reading}`);
    md.push(`| ${cell} | ${shown.join(" | ")} | ${readings.join("; ")} |`);
  }
  md.push(
    "",
    ...(gate.worse.length > 0 ? [`- worse: ${byCell(gate.worse)}`] : []),
    ...(gate.noisy.length > 0 ? [`- noisy: ${byCell(gate.noisy)}`] : []),
    ...(gate.missing.length > 0 ? [`- unreadable: ${byCell(gate.missing)}`] : []),
    ...(gate.moved.length > 0 ? [`- the null moved: ${byCell(gate.moved)}`] : []),
    ...(gate.shifted.length > 0
      ? [
          `- shifted (a component rose while the task total fell; named, not a failure — M40): ${byCell(gate.shifted)}`,
        ]
      : []),
    "",
  );
  for (const { cell: key, rows } of summary.cells) {
    md.push(
      `## ${key}`,
      "",
      paired
        ? "| metric | A (median) | B (median) | T = med(B−A) | MAD | z | T₀ = med(A′−A) | z₀ | reading |"
        : "| metric | A (median) | B (median) | T = med(B−A) | MAD | z |",
      paired ? "|---|---|---|---|---|---|---|---|---|" : "|---|---|---|---|---|---|",
    );
    for (const row of rows) {
      md.push(
        paired
          ? `| ${row.gate ? "**gate** " : ""}${row.metric} | ${fmt(row.A)} | ${fmt(row.B)} | ${fmt(row.T)} | ${fmt(row.mad)} | ${fmt(row.z, 1)} | ${fmt(row.T0)} | ${fmt(row.z0, 1)} | ${row.reading} |`
          : `| ${row.gate ? "**gate** " : ""}${row.metric} | ${fmt(row.A)} | ${fmt(row.B)} | ${fmt(row.T)} | ${fmt(row.mad)} | ${fmt(row.z, 1)} |`,
      );
    }
    md.push("");
  }
  writeFileSync(join(outDir, "summary.json"), `${JSON.stringify(summary, null, 2)}\n`);
  writeFileSync(join(outDir, "summary.md"), `${md.join("\n")}\n`);
  log(`gate (M33): ${gate.verdict}`);
  log(`written ${join(outDir, "summary.md")}`);
}

main().catch((error) => {
  log(`perf-godview failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
