/**
 * A paired run of `perf-godview.mjs`, written to disk the way the runner and the
 * lab write one (MV-8b): every launch's report (`A-r1.json` … `A2-r7.json`) and
 * the summary the runner judges from them, with the shipping estimator. The
 * proof audit and the pooled reader are tested against these, and each test
 * then breaks exactly one thing.
 */
import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

type Metrics = Record<string, number>;
interface Stats {
  cellMetrics(cell: unknown): Metrics;
  metricTable(frameMs: number): unknown;
  judgeCell(a: Metrics[], b: Metrics[], a2: Metrics[] | null, table: unknown): unknown[];
  gateVerdict(cells: unknown[], options: { paired: boolean; rounds: number }): unknown;
}

const scripts = join(import.meta.dirname, "..", "..", "..", "scripts");
/** A script beside the runner, by name (a computed specifier: plain ESM outside the types). */
export const script = <T>(name: string): Promise<T> =>
  import(/* @vite-ignore */ pathToFileURL(join(scripts, name)).href) as Promise<T>;

export const RECIPE = "n=10,duration=8000,seed=1,markerAgent=3,bareTerminals=0";
export const VIEWS = ["swarm", "list"] as const;
const HEALTHY_DECK = {
  active: true,
  panes: 1,
  sessions: 1,
  poolPhase: "open",
  rosterState: "observed",
  rendererBackend: "webgpu",
};
/** What RECIPE declares: 10 here, no bare terminals, round(10 / 4) = 3 on one peer. */
const MEMBERSHIP = {
  agents: 13,
  localAgents: 10,
  terminals: 0,
  remoteSessions: 3,
  remoteHosts: 1,
  shownAgents: 13,
};

export const reportName = (arm: string, round: number): string =>
  `${arm === "A′" ? "A2" : arm}-r${round}.json`;

/** One measured cell, in the lab's shape; `task` and `render` set its totals. */
function labCell(view: string, task: number, render: number) {
  return {
    view,
    corpus: "n10-8s-s1",
    recipe: RECIPE,
    replay: {
      phase: "ended",
      source: "model",
      delivered: 120,
      skipped: 40,
      listeners: { fold: 0, mesh: 0, devices: 1, model: 1 },
      model: { frames: 60 },
      work: { totalMs: 80, p95: 0.4 },
    },
    report: {
      windowMs: 8_000,
      frames: { p50: 16.7, p95: 16.8, fps: 60 },
      loaf: { count: 0, blockingMs: 0 },
      raf: { totalMs: 2, perFrame: { p95: 0.1 } },
      canvas2d: { calls: 0 },
      gpu: { submits: 0 },
      dom: { mutations: 300 },
      marks: [],
      memory: { usedJSHeapSize: 100 * 1_048_576 },
      react: {
        hooked: true,
        timed: true,
        commits: 900,
        renderMs: render * 8,
        roots: [
          { label: "div#root", commits: 500 },
          { label: `div.mv-${view}`, commits: 400 },
        ],
      },
    },
    memory: { rendererMB: 500, gpuMB: 200 },
    totals: {
      seconds: 8,
      taskMsPerS: task,
      scriptMsPerS: task * 0.8,
      layoutMsPerS: 2,
      recalcStyleMsPerS: 1,
    },
    swarmRenderer: view === "swarm" ? "webgpu" : null,
    deck: { start: HEALTHY_DECK, end: HEALTHY_DECK },
    monitor: { viewId: view, ...MEMBERSHIP },
  };
}

/** A deterministic wobble per round (a loaded host's). */
const WOBBLE = [3, -4, 1, 6, -2, -5, 2, -1, 4, -3, 0, 5, -2, 1];

export interface RunOptions {
  rounds?: number;
  /** B's task total over A's, ms/s. */
  shift?: number;
  /** A′'s task total over A's, ms/s: the null arm moving (a NOISY cohort) */
  nullShift?: number;
  /** where the profile ids start: two cohorts must not share one */
  profileSeed?: string;
  /** the first round's index into the wobble (a repeat measures other rounds) */
  wobbleFrom?: number;
}

/** Write a complete paired run to `dir`; returns the summary the runner would write. */
export async function writeRun(dir: string, options: RunOptions = {}): Promise<unknown> {
  const stats = await script<Stats>("perf-godview-stats.mjs");
  const rounds = options.rounds ?? 7;
  const shift = options.shift ?? -20;
  const seed = options.profileSeed ?? "cohort";
  mkdirSync(dir, { recursive: true });
  const runs: Record<string, { cells: ReturnType<typeof labCell>[] }[]> = {
    A: [],
    B: [],
    "A′": [],
  };
  const profiles: string[] = [];
  const loads: { round: number; arm: string; load: number }[] = [];
  for (let round = 1; round <= rounds; round += 1) {
    const wobble = WOBBLE[((options.wobbleFrom ?? 0) + round - 1) % WOBBLE.length] ?? 0;
    for (const arm of round % 2 === 1 ? ["A", "B", "A′"] : ["A′", "B", "A"]) {
      const offset =
        arm === "B" ? shift : arm === "A′" ? (options.nullShift ?? 0) + (round % 2) * 0.5 : 0;
      const task = 300 + wobble + offset;
      const render = 40 + wobble / 4 + (arm === "B" ? shift / 10 : 0);
      const id = createHash("sha256").update(`${seed}:${arm}:${round}`).digest("hex");
      profiles.push(id);
      loads.push({ round, arm, load: 4 });
      const report = {
        arm,
        startedAt: 1_000 * round,
        endedAt: 1_000 * round + 500,
        recipes: [RECIPE],
        views: [...VIEWS],
        settleMs: 1_500,
        source: "model",
        clock: "corpus",
        window: { mode: "offscreen", fps: 60, scale: 2 },
        profile: { kind: "isolated-chromium-v1", id },
        metered: true,
        reactHook: true,
        synthetic: {},
        warmupRecipe: "n=10,duration=1500,seed=9,markerQuietMs=50",
        warmedViews: [...VIEWS],
        cells: VIEWS.map((view) => labCell(view, task, render)),
      };
      runs[arm]?.push(report);
      writeFileSync(join(dir, reportName(arm, round)), `${JSON.stringify(report, null, 2)}\n`);
    }
  }
  const keys = VIEWS.map((view) => `${view} × n10-8s-s1`);
  const table = stats.metricTable(1000 / 60);
  const cells = keys.map((cell, index) => {
    const read = (arm: string): Metrics[] =>
      (runs[arm] ?? []).map((run) => stats.cellMetrics(run.cells[index]));
    return { cell, rows: stats.judgeCell(read("A"), read("B"), read("A′"), table) };
  });
  const instruments = {
    reactHook: true,
    metered: true,
    timed: true,
    swarmRenderers: ["webgpu"],
    warmedViews: [...VIEWS],
  };
  const summary = {
    profiles,
    label: "A/B",
    arms: {
      A: { root: "/arms/a", source: "model", synthetic: "" },
      B: { root: "/arms/b", source: "model", synthetic: "" },
      "A′": { root: "/arms/a", source: "model", synthetic: "" },
    },
    instruments: { A: instruments, B: instruments, "A′": instruments },
    rounds,
    window: { mode: "offscreen", fps: 60, scale: 2 },
    clock: "corpus",
    warmupRecipe: "n=10,duration=1500,seed=9,markerQuietMs=50",
    loads,
    startedAt: "2026-10-07T00-00-00-000Z",
    cells,
    gate: stats.gateVerdict(cells, { paired: true, rounds }),
  };
  writeFileSync(join(dir, "summary.json"), `${JSON.stringify(summary, null, 2)}\n`);
  return summary;
}
