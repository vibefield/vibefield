#!/usr/bin/env node
// THE PAIRED RUNNER (MV-0, step 6; L14 + L17). Interleaves two arms — A (a base
// checkout, built) and B (a slice's checkout, built) — launching the real
// product in `--godview-perf-lab` mode once per arm per round, fresh process
// each time, and judges every cell × metric by the PAIRED differences across
// rounds against an A/A null arm. With one root given (the default: this
// checkout) both arms are the same build and the run IS the A/A.
//
// It waits for the load average to fall below 60 before the first launch (L17),
// records the load beside every launch, and never reads an absolute figure as a
// verdict: medians are the estimator, tails are weather (memory
// `loaded-host-measurement-discipline`), and the A/A is read PAIRED and judged
// by its own spread (memory `aa-control-read-paired`).
//
//   node scripts/perf-godview.mjs [--a <root>] [--b <root>] [--rounds 3]
//     [--recipes "n=10,duration=8000,seed=1;n=20,...;n=60,..."]
//     [--views swarm,list,rain,timeline] [--out <dir>] [--load-max 60]
//     [--label <text>]
//
// Each root must already be built (`pnpm --filter @vibefield/desktop build:all`
// in that checkout); the runner says so and stops when the testing bundle is
// missing. Launch carries the two Chromium switches the lab needs on a busy
// desktop (memory `smoke-window-occlusion-backgrounding`), and the lab's main
// appends them too.

import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { loadavg } from "node:os";
import { join, resolve } from "node:path";

const argv = process.argv.slice(2);
const option = (name, fallback) => {
  const index = argv.indexOf(`--${name}`);
  return index === -1 ? fallback : (argv[index + 1] ?? fallback);
};

const repoRoot = resolve(new URL("..", import.meta.url).pathname);
const rootA = resolve(option("a", repoRoot));
const rootB = resolve(option("b", rootA));
const rounds = Math.max(1, Number(option("rounds", "3")));
const recipes = option(
  "recipes",
  "n=10,duration=8000,seed=1;n=20,duration=8000,seed=1;n=60,duration=8000,seed=1",
);
const views = option("views", "swarm,list,rain,timeline");
const loadMax = Number(option("load-max", "60"));
const label = option("label", rootA === rootB ? "A/A" : "A/B");
const stamp = new Date().toISOString().replace(/[:.]/g, "-");
const outDir = resolve(
  option("out", join(repoRoot, ".vibefield", "perf", "godview", "paired", stamp)),
);
mkdirSync(outDir, { recursive: true });

const log = (line) => process.stdout.write(`${line}\n`);

for (const [arm, root] of [
  ["A", rootA],
  ["B", rootB],
]) {
  const bundle = join(root, "packages", "electron-shell", "dist", "testing", "smoke.cjs");
  if (!existsSync(bundle)) {
    log(
      `arm ${arm}: ${root} is not built (${bundle} missing) — run pnpm --filter @vibefield/desktop build:all there`,
    );
    process.exit(2);
  }
}

const sleep = (ms) => new Promise((done) => setTimeout(done, ms));

async function waitForLoad() {
  for (;;) {
    const [one] = loadavg();
    if (one < loadMax) return one;
    log(`load ${one.toFixed(1)} ≥ ${loadMax}: waiting (L17)`);
    await sleep(15_000);
  }
}

function launch(arm, root, round) {
  const out = join(outDir, `${arm}-r${round}.json`);
  return new Promise((done, fail) => {
    const child = spawn(
      "pnpm",
      [
        "exec",
        "electron",
        ".",
        "--godview-perf-lab",
        "--disable-renderer-backgrounding",
        "--disable-backgrounding-occluded-windows",
      ],
      {
        cwd: join(root, "apps", "desktop"),
        env: {
          ...process.env,
          TMPDIR: "/tmp",
          VF_GODVIEW_PERF_OUT: out,
          VF_GODVIEW_PERF_RECIPES: recipes,
          VF_GODVIEW_PERF_VIEWS: views,
          VF_GODVIEW_PERF_ARM: arm,
          VF_GODVIEW_PERF_ROUND: String(round),
        },
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    const lines = [];
    child.stdout.on("data", (chunk) => {
      for (const line of String(chunk).split("\n")) {
        if (line.startsWith("GODVIEW_PERF_LAB")) log(`  ${arm} r${round}: ${line.slice(0, 160)}`);
        lines.push(line);
      }
    });
    child.stderr.on("data", (chunk) => lines.push(String(chunk)));
    child.on("error", fail);
    child.on("exit", (code) => {
      writeFileSync(join(outDir, `${arm}-r${round}.log`), lines.join("\n"));
      if (code !== 0 || !existsSync(out)) {
        fail(
          new Error(
            `arm ${arm} round ${round} exited ${code} (${out} ${existsSync(out) ? "written" : "missing"})`,
          ),
        );
        return;
      }
      done(JSON.parse(readFileSync(out, "utf8")));
    });
  });
}

// ── the statistics (memory `aa-control-read-paired`, K-H's rule) ─────────────

const median = (values) => {
  const sorted = [...values].sort((a, b) => a - b);
  if (sorted.length === 0) return Number.NaN;
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
};
const mad = (values, centre) => median(values.map((value) => Math.abs(value - centre)));

/** T = median of paired diffs, MAD, z = |T| / (1.858·MAD/√R). */
function paired(a, b) {
  const diffs = a.map((value, index) => b[index] - value).filter((d) => Number.isFinite(d));
  if (diffs.length === 0) return { T: Number.NaN, mad: Number.NaN, z: Number.NaN, R: 0 };
  const T = median(diffs);
  const spread = mad(diffs, T);
  const z =
    spread === 0
      ? T === 0
        ? 0
        : Number.POSITIVE_INFINITY
      : Math.abs(T) / ((1.858 * spread) / Math.sqrt(diffs.length));
  return { T, mad: spread, z, R: diffs.length };
}

/** The metrics read out of one cell's report, flat. */
function metrics(cell) {
  const r = cell.report;
  const mark = r.marks.find((m) => m.name === "status-flip");
  const latency = (key) => (mark && mark[key] !== null ? mark[key] - mark.at : Number.NaN);
  const view = cell.view;
  return {
    "frame p50 ms": r.frames.p50,
    "frame p95 ms": r.frames.p95,
    fps: r.frames.fps,
    "loaf count": r.loaf.count,
    "loaf blocking ms": r.loaf.blockingMs,
    "view renders": r.renders[view] ?? 0,
    "view commits": r.commits[view] ?? 0,
    "worker posts": r.postsTotal,
    "updateAgents posts": r.posts.updateAgents ?? 0,
    "canvas2d calls": r.canvas2d.calls,
    "gpu submits": r.gpu.submits,
    "dom mutations": r.dom.mutations,
    "mark→render ms": latency("firstRenderAfter"),
    "mark→commit ms": latency("firstCommitAfter"),
    "mark→mutation ms": latency("firstMutationAfter"),
    "mark→draw2d ms": latency("firstDraw2dAfter"),
    "mark→gpu ms": latency("firstGpuAfter"),
    "mark→frame ms": latency("nextFrameAfter"),
    "js heap MB":
      r.memory.usedJSHeapSize === null ? Number.NaN : r.memory.usedJSHeapSize / 1_048_576,
    "renderer MB": cell.memory?.rendererMB ?? Number.NaN,
    "gpu MB": cell.memory?.gpuMB ?? Number.NaN,
  };
}

const fmt = (value, digits = 2) => (Number.isFinite(value) ? value.toFixed(digits) : "–");

async function main() {
  log(`godview paired perf · ${label} · rounds ${rounds} · out ${outDir}`);
  log(`A ${rootA}\nB ${rootB}`);
  const loadAtStart = await waitForLoad();
  log(`load ${loadAtStart.toFixed(1)} < ${loadMax}: starting`);
  const runs = { A: [], B: [] };
  const loads = [];
  for (let round = 1; round <= rounds; round += 1) {
    for (const [arm, root] of [
      ["A", rootA],
      ["B", rootB],
    ]) {
      const load = loadavg()[0];
      loads.push({ round, arm, load });
      log(`round ${round} arm ${arm} (load ${load.toFixed(1)})`);
      runs[arm].push(await launch(arm, root, round));
    }
  }

  // cells are keyed view × corpus; every run has the same set
  const keys = runs.A[0].cells.map((cell) => `${cell.view} × ${cell.corpus}`);
  const summary = { label, rootA, rootB, rounds, loads, startedAt: stamp, cells: [] };
  const md = [
    `# Godview paired perf — ${label}`,
    "",
    `- A: \`${rootA}\``,
    `- B: \`${rootB}\``,
    `- rounds: ${rounds}, interleaved A,B per round, one Electron process per launch`,
    `- load average at launches: ${loads.map((l) => `${l.arm}${l.round} ${l.load.toFixed(0)}`).join(" · ")}`,
    `- estimator: medians; paired diff T = median(B−A), z = |T| / (1.858·MAD/√R); tails are weather`,
    "",
  ];
  for (const [index, key] of keys.entries()) {
    const a = runs.A.map((run) => metrics(run.cells[index]));
    const b = runs.B.map((run) => metrics(run.cells[index]));
    const names = Object.keys(a[0]);
    const rows = names.map((name) => {
      const av = a.map((m) => m[name]);
      const bv = b.map((m) => m[name]);
      const p = paired(av, bv);
      return { metric: name, A: median(av), B: median(bv), ...p };
    });
    summary.cells.push({ cell: key, rows });
    md.push(
      `## ${key}`,
      "",
      "| metric | A (median) | B (median) | T = med(B−A) | MAD | z |",
      "|---|---|---|---|---|---|",
    );
    for (const row of rows) {
      md.push(
        `| ${row.metric} | ${fmt(row.A)} | ${fmt(row.B)} | ${fmt(row.T)} | ${fmt(row.mad)} | ${fmt(row.z, 1)} |`,
      );
    }
    md.push("");
  }
  writeFileSync(join(outDir, "summary.json"), `${JSON.stringify(summary, null, 2)}\n`);
  writeFileSync(join(outDir, "summary.md"), `${md.join("\n")}\n`);
  log(`written ${join(outDir, "summary.md")}`);
}

main().catch((error) => {
  log(`perf-godview failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
