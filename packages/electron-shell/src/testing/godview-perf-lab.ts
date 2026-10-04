import { mkdirSync, writeFileSync } from "node:fs";
import { loadavg } from "node:os";
import { dirname, join } from "node:path";
import type { FielddHandle, FielddSupervisor } from "@vibefield/fieldd-supervisor";
import { app, type BrowserWindow } from "electron";
import type { WindowRegistry } from "../main/window-policy";
import { createMainWindow, loadRenderer } from "../main/windows";

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
// It asserts nothing about the numbers (L14: pairing is the gate), only that
// the machinery answered: the bridges installed, the player heard a fold
// listener, every frame was delivered, the mark landed.

const DEFAULT_RECIPES = [
  "n=10,duration=8000,seed=1",
  "n=20,duration=8000,seed=1",
  "n=60,duration=8000,seed=1",
];
const DEFAULT_VIEWS = ["swarm", "list", "rain", "timeline"];
const VIEW_LABELS: Readonly<Record<string, string>> = {
  swarm: "SWARM",
  list: "LIST",
  rain: "RAIN",
  timeline: "TIMELINE",
};

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

function consoleText(arg: unknown): string {
  if (typeof arg === "string") return arg;
  if (arg !== null && typeof arg === "object" && "message" in arg) {
    return String((arg as { message: unknown }).message);
  }
  return "";
}

/** A running tail of one marker channel (the perf lab's shape, kept separate on
 * purpose: a lab's steering must not couple to a smoke row's timeouts). */
class MarkerTail<T> {
  #latest: T | null = null;
  readonly #waiters = new Set<() => void>();

  constructor(win: BrowserWindow, prefix: string) {
    win.webContents.on("console-message", (...args: unknown[]) => {
      for (const arg of args) {
        const text = consoleText(arg);
        if (!text.startsWith(prefix)) continue;
        try {
          this.#latest = JSON.parse(text.slice(prefix.length)) as T;
        } catch {
          continue;
        }
        for (const waiter of [...this.#waiters]) waiter();
      }
    });
  }

  current(): T | null {
    return this.#latest;
  }

  async until(predicate: (value: T) => boolean, what: string, timeoutMs: number): Promise<T> {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const latest = this.#latest;
      if (latest !== null && predicate(latest)) return latest;
      if (Date.now() >= deadline)
        throw new Error(`timed out after ${timeoutMs}ms waiting for ${what}`);
      await new Promise<void>((resolve) => {
        const waiter = (): void => {
          this.#waiters.delete(waiter);
          resolve();
        };
        this.#waiters.add(waiter);
        setTimeout(waiter, 200);
      });
    }
  }
}

/** ⌘2 (Ctrl+2 elsewhere): the road a person takes to Godview (One Frame FR-1),
 * as the smoke presses it. */
function pressGodviewKey(win: BrowserWindow): void {
  const modifiers: ("meta" | "control")[] = [process.platform === "darwin" ? "meta" : "control"];
  win.webContents.sendInputEvent({ type: "keyDown", keyCode: "2", modifiers });
  win.webContents.sendInputEvent({ type: "keyUp", keyCode: "2", modifiers });
}

async function page<T>(win: BrowserWindow, expression: string): Promise<T> {
  return (await win.webContents.executeJavaScript(expression, true)) as T;
}

async function untilPage(
  win: BrowserWindow,
  what: string,
  expression: string,
  timeoutMs: number,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let seen = "";
  while (Date.now() < deadline) {
    const answer = await page<string>(win, expression);
    if (answer === "ok") return;
    seen = answer;
    await sleep(100);
  }
  throw new Error(`${what} did not happen within ${timeoutMs}ms (${seen})`);
}

/** `app.exit`, with `process.exit` behind it on a short fuse (the perf lab's). */
function leave(code: number): void {
  const fuse = setTimeout(() => process.exit(code), 5_000);
  fuse.unref();
  try {
    app.exit(code);
  } catch {
    process.exit(code);
  }
}

interface MonitorFacts {
  viewId: string;
  agents: number;
}

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
  const say = (record: Record<string, unknown>): void => {
    process.stdout.write(`GODVIEW_PERF_LAB ${JSON.stringify(record)}\n`);
  };

  let code = 0;
  const cells: GodviewPerfCell[] = [];
  const startedAt = Date.now();
  try {
    const win = createMainWindow({
      mode: "godview-perf-lab",
      preloadPath: opts.preloadPath,
      show: true,
    });
    opts.registry.adopt(win);
    // Above everything, like the perf lab: a measurement taken behind another
    // window is a measurement of Chromium's occlusion policy.
    win.setAlwaysOnTop(true, "floating");
    opts.onWindow?.(win);

    const canvas = new MarkerTail<Record<string, unknown>>(win, "CANVAS_READY ");
    const bridge = new MarkerTail<{ installed: boolean }>(win, "GODVIEW_PERF_LAB ");
    const monitor = new MarkerTail<MonitorFacts>(win, "GODVIEW_MONITOR ");

    await loadRenderer(win, "godview-perf-lab", opts.viteUrl);
    await canvas.until(() => true, "the renderer to report CANVAS_READY", 90_000);
    await bridge.until((value) => value.installed, "the lab bridges to install", 30_000);
    win.focus();
    win.webContents.focus();
    await page(win, "localStorage.clear()");

    // Godview, as a person opens it; the monitor stage mounts the default view
    pressGodviewKey(win);
    await monitor.until(() => true, "the monitor stage to mount", 60_000);
    say({ kind: "open", arm, view: monitor.current()?.viewId ?? null });
    await page(win, `window.__vfGodviewPerf.observeStage(".vf-godview-monitor-stage")`);

    // A WARM-UP, discarded: the first trial's first cell carried 4.4 s of
    // long-frame blocking (two LoAFs, the longest 2.3 s) that no later cell saw
    // — first-use costs of the stage, the views' chunks and the JIT. One short
    // corpus through the default view pays them before anything is measured.
    if (process.env["VF_GODVIEW_PERF_WARMUP"] !== "0") {
      const warm = await page<{ durationMs: number }>(
        win,
        `window.__vfGodviewReplay.load("n=10,duration=1500,seed=9,markerQuietMs=50")`,
      );
      await page(win, "window.__vfGodviewReplay.start()");
      await untilPage(
        win,
        "the warm-up replay to end",
        `window.__vfGodviewReplay.state().phase === "ended" ? "ok" : window.__vfGodviewReplay.state().phase`,
        warm.durationMs + 30_000,
      );
      await page(win, "window.__vfGodviewReplay.stop()");
      await sleep(settleMs);
      say({ kind: "warmed", arm });
    }

    for (const recipe of recipes) {
      const loaded = await page<{ corpus: string; frames: number; durationMs: number }>(
        win,
        `window.__vfGodviewReplay.load(${JSON.stringify(recipe)})`,
      );
      say({ kind: "loaded", arm, ...loaded });
      for (const view of views) {
        const label = VIEW_LABELS[view] ?? view.toUpperCase();
        // the instrument bar's own button, clicked in-page (CDP-synthesized, never OS input)
        await untilPage(
          win,
          `the ${view} view to be selected`,
          `(() => {
            const button = document.querySelector('[role="group"][aria-label="Monitor view"] button[aria-label="${label} view"]');
            if (!button) return "no button for ${label}";
            if (button.getAttribute("aria-pressed") === "true") return "ok";
            button.click();
            return "clicked";
          })()`,
          15_000,
        );
        await monitor.until(
          (value) => value.viewId === view,
          `the monitor to report ${view}`,
          15_000,
        );
        await sleep(settleMs);
        await page(win, "window.__vfGodviewPerf.reset()");
        const replayStart = await page<{ phase: string; listeners: unknown }>(
          win,
          "window.__vfGodviewReplay.start()",
        );
        const cellStartedAt = Date.now();
        await untilPage(
          win,
          `the ${loaded.corpus} replay to end on ${view}`,
          `window.__vfGodviewReplay.state().phase === "ended" ? "ok" : window.__vfGodviewReplay.state().phase`,
          loaded.durationMs + 30_000,
        );
        // the marker's quiet tail is inside the corpus; a short settle lets the
        // last frame's work finish before the report is read
        await sleep(400);
        const report = await page<Record<string, unknown>>(win, "window.__vfGodviewPerf.report()");
        const replay = await page<Record<string, unknown>>(win, "window.__vfGodviewReplay.state()");
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
        };
        cells.push(cell);
        const frames = (report["frames"] ?? {}) as Record<string, number>;
        say({
          kind: "cell",
          arm,
          view,
          corpus: loaded.corpus,
          frameP50: frames["p50"],
          frameP95: frames["p95"],
          renders: (report["renders"] as Record<string, number> | undefined)?.[view] ?? 0,
          posts: report["postsTotal"],
          delivered: (replay as { delivered?: number }).delivered,
          listeners: replayStart.listeners,
        });
        await page(win, "window.__vfGodviewReplay.stop()");
      }
    }

    // LEAVE THE PRODUCT AS FOUND. The monitor persists the selected view in the
    // renderer's localStorage (`deck-appearance.ts`), which every smoke-like
    // launch of this checkout shares: the first run of this lab left its last
    // cell's view behind and the godview smoke then opened on "timeline"
    // instead of the default swarm. So the default view is selected again,
    // and the storage this lab cleared at its start is cleared at its end.
    await untilPage(
      win,
      "the default (swarm) view to be selected again",
      `(() => {
        const button = document.querySelector('[role="group"][aria-label="Monitor view"] button[aria-label="SWARM view"]');
        if (!button) return "no swarm button";
        if (button.getAttribute("aria-pressed") === "true") return "ok";
        button.click();
        return "clicked";
      })()`,
      15_000,
    );
    await monitor.until((value) => value.viewId === "swarm", "the monitor to report swarm", 15_000);
    await sleep(300);
    await page(win, "localStorage.clear()");
    await sleep(300);
    say({ kind: "restored", arm, view: monitor.current()?.viewId ?? null });
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
  await opts.beforeExit().catch(() => undefined);
  leave(code);
}
