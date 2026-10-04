import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { loadavg } from "node:os";
import { dirname, join } from "node:path";
import { gunzipSync } from "node:zlib";
import type { FielddHandle, FielddSupervisor } from "@vibefield/fieldd-supervisor";
import { app, type BrowserWindow } from "electron";
import type { WindowRegistry } from "../main/window-policy";
import { type MetricTotals, metricTotals, parseSynthetic } from "./godview-lab-measures";
import {
  type LabWindow,
  labWindowOptions,
  leave,
  openLabWindow,
  page,
  pageMetrics,
  restoreLabWindow,
  selectView,
  sleep,
  swarmRenderer,
  teardownLab,
  untilPage,
} from "./godview-lab-window";

// THE GODVIEW PERF LAB (MV-0, step 6; `design-mv.md` §5 "per-view counters,
// under the same replay"). The product, Godview open, the real pair against an
// isolated root — and in place of the live `agent.subscribe` streams, the
// renderer's replay door fed by its player (`field-app/.../perf/lab-bridge.ts`,
// armed by `loadRenderer`'s `godviewPerf=1&godviewReplay=1`). For every corpus
// recipe and every view the lab: selects the view on the instrument bar (a DOM
// click, in-page), lets it settle, resets the probe, plays the corpus on its own
// timeline, waits for the end, and reads the probe's report beside Electron's
// own process metrics. One JSON file per launch; the paired runner
// (`scripts/perf-godview.mjs`) launches arms and judges.
//
//   VF_GODVIEW_PERF_OUT      the JSON file to write (default: a temp dir)
//   VF_GODVIEW_PERF_RECIPES  `n=10,duration=8000,seed=1;n=20,...` (default: 10/20/60 × 8 s)
//   VF_GODVIEW_PERF_VIEWS    `swarm,list,rain,timeline` (default: all four)
//   VF_GODVIEW_PERF_ARM      a label the runner stamps (A / B)
//   VF_GODVIEW_PERF_SETTLE_MS  settle after a view switch (default 1500)
//
// MV-3c (build-mv M30, M31, M32):
//
//   VF_GODVIEW_PERF_SOURCE   `fold` (default: the corpus, today's seam's input)
//                            or `model` (the B arm: each corpus's MODEL STREAM —
//                            what the window's one door answers for it — pushed
//                            into the page and played into the window adapter)
//   VF_GODVIEW_PERF_MODEL_DIR  where `<corpus>.model.jsonl.gz` streams are (model)
//   VF_GODVIEW_PERF_WARMUP_RECIPE  the discarded warm-up's corpus (default
//                            `n=10,duration=1500,seed=9,markerQuietMs=50`); under
//                            `model` its stream is played too, so the model path
//                            pays its first-use costs where nothing is measured
//   VF_GODVIEW_PERF_CLOCK    `corpus` (default, M31: the page's Date reads the
//                            corpus's wall time while a replay plays) or `real`
//   VF_GODVIEW_PERF_WINDOW   `offscreen` (default) or `shown` — never focused,
//                            never on top (`godview-lab-window.ts`)
//   VF_GODVIEW_PERF_FPS / _SCALE  the offscreen frame rate and scale (60 / 2)
//   VF_GODVIEW_PERF_WITNESS  `1`: a second window adapter in the page checks,
//                            after every cell, that its replica's rows are the
//                            stream's rows — the proof on a build whose window
//                            does not read the model yet; never in a gate run
//   VF_GODVIEW_PERF_SYNTHETIC  M33's negative controls, `view:<ms>` (a busy wait
//                            in every counted view render) and/or `root:<ms>`
//                            (a side React root committing once per frame with
//                            that much render work), e.g. `view:2,root:1`
//
// M33 — TOTAL WORK. Every cell also carries every React root's commits and
// summed render time (the probe's `react`, fed by the lab window's DevTools
// hook; timed when the renderer was built with `VF_REACT_PROFILING=1`) and
// Chromium's main-thread totals per second over the cell (`totals`: task,
// script, layout, style — CDP `Performance.getMetrics` at the window's start
// and end). Those totals are what the paired gate reads: a view in its own root,
// or work moved into rAF, is inside them.
//
// It asserts nothing about the numbers (L14: pairing is the gate), only that
// the machinery answered: the bridges installed, the player heard what it
// plays to (under `model`, a model reader — a build with none fails the run
// rather than measuring nothing), every frame was delivered, the mark landed.

const DEFAULT_RECIPES = [
  "n=10,duration=8000,seed=1",
  "n=20,duration=8000,seed=1",
  "n=60,duration=8000,seed=1",
];
const DEFAULT_VIEWS = ["swarm", "list", "rain", "timeline"];
export const DEFAULT_WARMUP_RECIPE = "n=10,duration=1500,seed=9,markerQuietMs=50";
/** Whole lines per `executeJavaScript`: a model stream of n=60 is ~23 MB. */
const PUSH_CHUNK_CHARS = 4_000_000;

export interface GodviewPerfCell {
  view: string;
  corpus: string;
  recipe: string;
  loaded: unknown;
  replay: unknown;
  report: unknown;
  memory: { rendererMB: number | null; gpuMB: number | null; processes: number };
  loadavg: number[];
  startedAt: number;
  /** MV-3c — what the swarm rendered with in this cell (`data-swarm-renderer`) */
  swarmRenderer: string | null;
  /** MV-3c — the witness's verdict after the cell (`VF_GODVIEW_PERF_WITNESS=1`) */
  witness?: unknown;
  /** M33 — Chromium's main-thread totals per second over the cell */
  totals: MetricTotals | null;
}

interface ModelLoaded {
  corpus: string;
  frames: number;
  marks: number;
  corpusFrames: number;
}

/** A corpus's model stream, pushed into the page's player in whole-line chunks. */
async function pushModelStream(
  win: BrowserWindow,
  dir: string,
  corpus: string,
): Promise<ModelLoaded> {
  // `modelStreamFileName` (field-app `perf/model-stream.ts`)
  const path = join(dir, `${corpus}.model.jsonl.gz`);
  if (!existsSync(path)) {
    throw new Error(`no model stream for ${corpus} at ${path} (pnpm perf:godview writes them)`);
  }
  const text = gunzipSync(readFileSync(path)).toString("utf8");
  let loaded: ModelLoaded | null = null;
  let start = 0;
  while (start < text.length) {
    let end = Math.min(text.length, start + PUSH_CHUNK_CHARS);
    if (end < text.length) {
      const newline = text.lastIndexOf("\n", end);
      end = newline > start ? newline + 1 : text.indexOf("\n", end) + 1 || text.length;
    }
    loaded = await page<ModelLoaded>(
      win,
      `window.__vfGodviewReplay.pushModel(${JSON.stringify(text.slice(start, end))})`,
    );
    start = end;
  }
  if (loaded === null) throw new Error(`the model stream for ${corpus} is empty`);
  return loaded;
}

/** Load a corpus in the page, and its model stream when the source asks. */
async function loadCorpus(
  win: BrowserWindow,
  recipe: string,
  source: { kind: "fold" | "model"; modelDir: string | undefined },
): Promise<{ corpus: string; frames: number; durationMs: number; model: ModelLoaded | null }> {
  const loaded = await page<{ corpus: string; frames: number; durationMs: number }>(
    win,
    `window.__vfGodviewReplay.load(${JSON.stringify(recipe)})`,
  );
  if (source.kind !== "model") return { ...loaded, model: null };
  if (source.modelDir === undefined)
    throw new Error("VF_GODVIEW_PERF_SOURCE=model needs VF_GODVIEW_PERF_MODEL_DIR");
  const model = await pushModelStream(win, source.modelDir, loaded.corpus);
  return { ...loaded, model };
}

async function untilEnded(win: BrowserWindow, what: string, timeoutMs: number): Promise<void> {
  await untilPage(
    win,
    what,
    `window.__vfGodviewReplay.state().phase === "ended" ? "ok" : window.__vfGodviewReplay.state().phase`,
    timeoutMs,
  );
}

export async function runGodviewPerfLab(opts: {
  handle: FielddHandle;
  supervisor: FielddSupervisor;
  root: string;
  registry: WindowRegistry;
  preloadPath: string;
  viteUrl: string;
  beforeExit: () => Promise<void>;
  onWindow?: (window: BrowserWindow) => void;
}): Promise<void> {
  const out =
    process.env["VF_GODVIEW_PERF_OUT"] ??
    join(app.getPath("temp"), `vf-godview-perf-${Date.now()}.json`);
  const recipes = (process.env["VF_GODVIEW_PERF_RECIPES"] ?? DEFAULT_RECIPES.join(";"))
    .split(";")
    .map((text) => text.trim())
    .filter((text) => text !== "");
  const views = (process.env["VF_GODVIEW_PERF_VIEWS"] ?? DEFAULT_VIEWS.join(","))
    .split(",")
    .map((text) => text.trim())
    .filter((text) => text !== "");
  const settleMs = Math.max(0, Number(process.env["VF_GODVIEW_PERF_SETTLE_MS"] ?? 1_500));
  const arm = process.env["VF_GODVIEW_PERF_ARM"] ?? "A";
  const source = {
    kind:
      process.env["VF_GODVIEW_PERF_SOURCE"] === "model" ? ("model" as const) : ("fold" as const),
    modelDir: process.env["VF_GODVIEW_PERF_MODEL_DIR"] || undefined,
  };
  const warmupRecipe = process.env["VF_GODVIEW_PERF_WARMUP_RECIPE"] || DEFAULT_WARMUP_RECIPE;
  const clock = process.env["VF_GODVIEW_PERF_CLOCK"] === "real" ? "real" : "corpus";
  const witness = process.env["VF_GODVIEW_PERF_WITNESS"] === "1";
  const synthetic = parseSynthetic(process.env["VF_GODVIEW_PERF_SYNTHETIC"]);
  const windowOptions = labWindowOptions();
  const say = (record: Record<string, unknown>): void => {
    process.stdout.write(`GODVIEW_PERF_LAB ${JSON.stringify(record)}\n`);
  };

  let code = 0;
  const cells: GodviewPerfCell[] = [];
  const startedAt = Date.now();
  let lab: LabWindow | null = null;
  try {
    lab = await openLabWindow({
      preloadPath: opts.preloadPath,
      viteUrl: opts.viteUrl,
      registry: opts.registry,
      options: windowOptions,
      onWindow: opts.onWindow,
    });
    const { win, monitor } = lab;
    await page(win, `window.__vfGodviewReplay.setClock(${JSON.stringify(clock)})`);
    say({
      kind: "open",
      arm,
      view: monitor.current()?.viewId ?? null,
      source: source.kind,
      clock,
      window: windowOptions,
      frameRate: lab.frameRate,
      focusEmulated: lab.focusEmulated,
      reactHook: lab.reactHook,
      metered: lab.metered,
      synthetic,
    });
    if (Object.keys(synthetic).length > 0) {
      await page(win, `window.__vfGodviewPerf.setSynthetic(${JSON.stringify(synthetic)})`);
    }
    if (witness) {
      const opened = await page<{ state: string }>(win, "window.__vfGodviewModelWitness.open()");
      say({ kind: "witness", arm, ...opened });
    }

    // A WARM-UP, discarded: the first trial's first cell carried 4.4 s of
    // long-frame blocking (two LoAFs, the longest 2.3 s) that no later cell saw
    // — first-use costs of the stage, the views' chunks and the JIT. One short
    // corpus through the default view pays them before anything is measured;
    // under `model`, through the model path.
    if (process.env["VF_GODVIEW_PERF_WARMUP"] !== "0") {
      const warm = await loadCorpus(win, warmupRecipe, source);
      await page(win, "window.__vfGodviewReplay.start()");
      await untilEnded(win, "the warm-up replay to end", warm.durationMs + 30_000);
      await page(win, "window.__vfGodviewReplay.stop()");
      await sleep(settleMs);
      say({ kind: "warmed", arm, corpus: warm.corpus, model: warm.model !== null });
    }

    for (const recipe of recipes) {
      const loaded = await loadCorpus(win, recipe, source);
      say({ kind: "loaded", arm, ...loaded });
      for (const view of views) {
        await selectView(win, monitor, view);
        await sleep(settleMs);
        await page(win, "window.__vfGodviewPerf.reset()");
        const metricsAtStart = await pageMetrics(win);
        const replayStart = await page<{
          phase: string;
          source: string;
          listeners: { model?: number } | null;
        }>(win, "window.__vfGodviewReplay.start()");
        if (source.kind === "model" && (replayStart.listeners?.model ?? 0) === 0) {
          throw new Error(
            "VF_GODVIEW_PERF_SOURCE=model, but nothing in this build reads the model door (listeners.model = 0); a build whose window does not read the model yet needs VF_GODVIEW_PERF_WITNESS=1",
          );
        }
        const cellStartedAt = Date.now();
        await untilEnded(
          win,
          `the ${loaded.corpus} replay to end on ${view}`,
          loaded.durationMs + 30_000,
        );
        // the marker's quiet tail is inside the corpus; a short settle lets the
        // last frame's work finish before the report is read
        await sleep(400);
        const metricsAtEnd = await pageMetrics(win);
        const report = await page<Record<string, unknown>>(win, "window.__vfGodviewPerf.report()");
        const replay = await page<Record<string, unknown>>(win, "window.__vfGodviewReplay.state()");
        const witnessed = witness
          ? await page<unknown>(win, "window.__vfGodviewModelWitness.check()")
          : undefined;
        const metrics = app.getAppMetrics();
        const renderer = metrics.find((metric) => metric.type === "Tab");
        const gpu = metrics.find((metric) => metric.type === "GPU");
        const cell: GodviewPerfCell = {
          view,
          corpus: loaded.corpus,
          recipe,
          loaded,
          replay,
          report,
          memory: {
            rendererMB: renderer ? renderer.memory.workingSetSize / 1_024 : null,
            gpuMB: gpu ? gpu.memory.workingSetSize / 1_024 : null,
            processes: metrics.length,
          },
          loadavg: loadavg(),
          startedAt: cellStartedAt,
          swarmRenderer: view === "swarm" ? await swarmRenderer(win) : null,
          ...(witnessed !== undefined ? { witness: witnessed } : {}),
          totals: metricTotals(metricsAtStart, metricsAtEnd),
        };
        cells.push(cell);
        const frames = (report["frames"] ?? {}) as Record<string, number>;
        const raf = (report["raf"] ?? {}) as { totalMs?: number };
        const work = (replay["work"] ?? {}) as { totalMs?: number };
        const react = (report["react"] ?? {}) as { commits?: number; renderMs?: number };
        say({
          kind: "cell",
          arm,
          view,
          corpus: loaded.corpus,
          source: replayStart.source,
          frameP50: frames["p50"],
          frameP95: frames["p95"],
          rafMs: raf.totalMs,
          workMs: work.totalMs,
          taskMsPerS: cell.totals?.taskMsPerS,
          scriptMsPerS: cell.totals?.scriptMsPerS,
          reactCommits: react.commits,
          reactRenderMs: react.renderMs,
          renders: (report["renders"] as Record<string, number> | undefined)?.[view] ?? 0,
          posts: report["postsTotal"],
          delivered: (replay as { delivered?: number }).delivered,
          skipped: (replay as { skipped?: number }).skipped,
          listeners: replayStart.listeners,
          ...(cell.swarmRenderer !== null ? { swarmRenderer: cell.swarmRenderer } : {}),
          ...(witnessed !== undefined ? { witness: witnessed } : {}),
        });
        await page(win, "window.__vfGodviewReplay.stop()");
      }
    }

    say({ kind: "restored", arm, view: await restoreLabWindow(lab) });
  } catch (error) {
    code = 1;
    say({ kind: "failed", arm, error: error instanceof Error ? error.message : String(error) });
  }

  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(
    out,
    `${JSON.stringify(
      {
        arm,
        startedAt,
        endedAt: Date.now(),
        recipes,
        views,
        settleMs,
        source: source.kind,
        clock,
        window: windowOptions,
        frameRate: lab?.frameRate ?? null,
        focusEmulated: lab?.focusEmulated ?? false,
        reactHook: lab?.reactHook ?? false,
        metered: lab?.metered ?? false,
        synthetic,
        witness,
        warmupRecipe,
        electron: process.versions["electron"],
        platform: process.platform,
        loadavg: loadavg(),
        cells,
      },
      null,
      2,
    )}\n`,
  );
  say({ kind: "done", arm, out, cells: cells.length, code });
  await teardownLab(opts);
  leave(code);
}
