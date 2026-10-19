import { existsSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { gunzipSync } from "node:zlib";
import { app, type BrowserWindow } from "electron";
import type { WindowRegistry } from "../main/window-policy";
import { createMainWindow, loadRenderer } from "../main/windows";
import { askGodviewDeckUp, sayingDeckAsk } from "./godview-deck-up";
import type { HeapSample, PageMetrics } from "./godview-lab-measures";
import { type LabProfile, labProfileProof } from "./godview-lab-profile";
import {
  type LabDeckState,
  labDeckReady,
  labDeckSeen,
  labDeckTimeout,
} from "./godview-lab-readiness";
import { REACT_COMMIT_HOOK_SOURCE } from "./react-commit-hook";

// THE GODVIEW LAB'S WINDOW (MV-3c; build-mv M31, M32) — what the perf lab and
// the capture tool share: one product window with Godview open over the replay
// door, driven from inside over `executeJavaScript`, and NEVER one that takes
// the person's focus (M31: no `focus()`, no always-on-top, no OS input).
//
//   offscreen (the default)  offscreen rendering (`webPreferences.offscreen`):
//       never shown, the Dock icon hidden, a fixed frame rate
//       (`setFrameRate`), the device scale factor set where offscreen pages
//       read it (M32: `--force-device-scale-factor` does not reach them).
//       Electron's offscreen `capturePage` draws the WebGPU swarm (M32), and
//       the lab proves the swarm renders WebGPU here (`swarmRenderer`, M31).
//       Frame p50 is then pinned at the frame rate (M32): read rAF work, the
//       deliveries' work and LoAF.
//   shown  the fallback M31 names: shown INACTIVE, behind what the person is
//       doing, with the two Chromium switches the launcher passes.
//
// Either way the page's focus is EMULATED over CDP (`Emulation.setFocusEmulationEnabled`),
// so ⌘2 and the instrument bar's keys behave as in a focused window. One
// window per perf/capture process: M32 found an Electron 43 crash after an
// offscreen window was destroyed and another opened, so those tools reload
// their window. The worker lifecycle probe deliberately exercises that path
// and multiple product realms; extra live windows register as auxiliaries.
//
// M33 — TOTAL WORK. The same CDP session installs the React commit hook before
// any page script runs (`react-commit-hook.ts`: every root's commits and render
// time) and enables Chromium's own `Performance` metrics, which a tool samples
// at a window's start and end (`pageMetrics`, `metricTotals`): the renderer
// main thread's task, script, layout and style time, whatever root or loop
// spent it.

export type LabWindowMode = "offscreen" | "shown";

export interface LabWindowOptions {
  mode: LabWindowMode;
  /** offscreen frame rate (default 60: asked for 120, an offscreen page here
   * reported `getFrameRate()` 120 and still drew every 16.7 ms — 60 is what
   * the mode delivers, so it is what a tool declares) */
  fps: number;
  /** offscreen device scale factor (default 2, a Retina display's) */
  scale: number;
}

export function labWindowOptions(env: NodeJS.ProcessEnv = process.env): LabWindowOptions {
  const number = (value: string | undefined, fallback: number): number => {
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
  };
  return {
    mode: env["VF_GODVIEW_PERF_WINDOW"] === "shown" ? "shown" : "offscreen",
    fps: number(env["VF_GODVIEW_PERF_FPS"], 60),
    scale: number(env["VF_GODVIEW_PERF_SCALE"], 2),
  };
}

export const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

function consoleText(arg: unknown): string {
  if (typeof arg === "string") return arg;
  if (arg !== null && typeof arg === "object" && "message" in arg) {
    return String((arg as { message: unknown }).message);
  }
  return "";
}

/** A running tail of one marker channel (the perf lab's shape, kept separate on
 * purpose: a lab's steering must not couple to a smoke row's timeouts). */
export class MarkerTail<T> {
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

  /** `seen`, when given, is what a timeout adds to its error: the latest
   * value in the caller's words (null when the marker never came). */
  async until(
    predicate: (value: T) => boolean,
    what: string,
    timeoutMs: number,
    seen?: (latest: T | null) => string,
  ): Promise<T> {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const latest = this.#latest;
      if (latest !== null && predicate(latest)) return latest;
      if (Date.now() >= deadline)
        throw new Error(
          `timed out after ${timeoutMs}ms waiting for ${what}${seen ? ` — ${seen(latest)}` : ""}`,
        );
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
 * as the smoke presses it — a page-level event, never OS input. */
export function pressGodviewKey(win: BrowserWindow): void {
  const modifiers: ("meta" | "control")[] = [process.platform === "darwin" ? "meta" : "control"];
  win.webContents.sendInputEvent({ type: "keyDown", keyCode: "2", modifiers });
  win.webContents.sendInputEvent({ type: "keyUp", keyCode: "2", modifiers });
}

export async function page<T>(win: BrowserWindow, expression: string): Promise<T> {
  return (await win.webContents.executeJavaScript(expression, true)) as T;
}

export async function untilPage(
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
export function leave(code: number): void {
  const fuse = setTimeout(() => process.exit(code), 5_000);
  fuse.unref();
  try {
    app.exit(code);
  } catch {
    process.exit(code);
  }
}

export interface MonitorFacts {
  viewId: string;
  agents: number;
}

export const VIEW_LABELS: Readonly<Record<string, string>> = {
  swarm: "SWARM",
  list: "LIST",
  rain: "RAIN",
  timeline: "TIMELINE",
};

/** The instrument bar's own button, clicked in-page (never OS input), and the
 * monitor's word that it took. */
export async function selectView(
  win: BrowserWindow,
  monitor: MarkerTail<MonitorFacts>,
  view: string,
): Promise<void> {
  const label = VIEW_LABELS[view] ?? view.toUpperCase();
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
  await monitor.until((value) => value.viewId === view, `the monitor to report ${view}`, 15_000);
}

/** What the swarm says it renders with, when it is mounted: its report, which the view
 * host's slot mirrors on ITS element since MV-5 (`data-monitor-view-renderer`, W5 — the
 * view's own DOM is never read). */
export async function swarmRenderer(win: BrowserWindow): Promise<string | null> {
  return await page<string | null>(
    win,
    `document.querySelector('[data-monitor-view-slot][data-monitor-view="swarm"]')?.getAttribute("data-monitor-view-renderer") ?? null`,
  );
}

/** One CDP command, bounded: a debugger another tool holds, or a page that
 * does not answer, yields null and the caller says what it went without. */
export async function cdp<T>(
  win: BrowserWindow,
  method: string,
  params: Record<string, unknown> = {},
  timeoutMs = 5_000,
): Promise<T | null> {
  try {
    if (!win.webContents.debugger.isAttached()) win.webContents.debugger.attach("1.3");
    return await Promise.race([
      win.webContents.debugger.sendCommand(method, params) as Promise<T>,
      sleep(timeoutMs).then(() => null),
    ]);
  } catch {
    return null;
  }
}

/** `performance.memory` as the page has it (Chromium's own; null without it). */
const PAGE_HEAP = `(() => {
  const memory = performance.memory;
  return memory ? { usedJSHeapSize: memory.usedJSHeapSize, totalJSHeapSize: memory.totalJSHeapSize } : null;
})()`;

/**
 * The page's JS heap after a forced collection (MV lab debts), or null when
 * none could be forced or the page did not answer after it — the caller keeps
 * the reading it had and says so; a launch is never failed for this.
 *
 * Read at whatever phase the collector was in, the heap row was that phase: on
 * 2026-10-11 one read `worse` while the same build against itself ran from
 * −26 to +20 MB. `HeapProfiler.collectGarbage` is a full collection of the
 * page's main isolate and needs no domain enabled; it answers when the
 * collection is done. It is a pause on the main thread, so a caller measuring
 * anything calls this only once its window has closed. A few hundred MB under
 * a loaded host can outlast `cdp`'s 5 s, hence the longer bound.
 */
export async function collectedHeap(win: BrowserWindow): Promise<HeapSample | null> {
  if ((await cdp(win, "HeapProfiler.collectGarbage", {}, 20_000)) === null) return null;
  // `performance.memory` answers from a cache it refreshes at most every 50 ms,
  // and the probe's report read it moments before the collection
  await sleep(100);
  try {
    return await page<HeapSample | null>(win, PAGE_HEAP);
  } catch {
    return null;
  }
}

export async function pageMetrics(win: BrowserWindow): Promise<PageMetrics | null> {
  const answer = await cdp<{ metrics: { name: string; value: number }[] }>(
    win,
    "Performance.getMetrics",
  );
  if (answer === null) return null;
  const read = (name: string): number =>
    answer.metrics.find((metric) => metric.name === name)?.value ?? Number.NaN;
  return {
    at: read("Timestamp"),
    task: read("TaskDuration"),
    script: read("ScriptDuration"),
    layout: read("LayoutDuration"),
    recalcStyle: read("RecalcStyleDuration"),
  };
}

export interface LabWindow {
  profile: LabProfile;
  win: BrowserWindow;
  monitor: MarkerTail<MonitorFacts>;
  deck: MarkerTail<LabDeckState>;
  options: LabWindowOptions;
  focusEmulated: boolean;
  /** what the offscreen page reports drawing at (`getFrameRate`); null shown */
  frameRate: number | null;
  /** M33 — the React commit hook went in before the page's scripts (the page says so) */
  reactHook: boolean;
  /** M33 — Chromium's `Performance` metrics answer */
  metered: boolean;
}

/**
 * The product window in the lab's mode, the renderer loaded with the lab's
 * switches (`loadRenderer`'s `godviewPerf=1&godviewReplay=1`), the bridges
 * installed, the renderer's storage cleared, and Godview open on its monitor.
 */
export async function openLabWindow(opts: {
  preloadPath: string;
  viteUrl: string;
  registry: WindowRegistry;
  /** Extra product realms in the worker lifecycle probe, never another primary. */
  role?: "primary" | "auxiliary";
  options: LabWindowOptions;
  onWindow?: ((window: BrowserWindow) => void) | undefined;
}): Promise<LabWindow> {
  const requestedProfile = app.commandLine.getSwitchValue("user-data-dir");
  const profilePaths = {
    userData: app.getPath("userData"),
    sessionData: app.getPath("sessionData"),
  };
  labProfileProof(requestedProfile, profilePaths);
  const { options } = opts;
  const offscreen = options.mode === "offscreen";
  const win = createMainWindow({
    mode: "godview-perf-lab",
    preloadPath: opts.preloadPath,
    show: false,
    ...(offscreen ? { offscreen: { deviceScaleFactor: options.scale } } : {}),
  });
  const startup: string[] = [];
  const remember = (message: string): void => {
    startup.push(message.slice(0, 1_000));
    if (startup.length > 20) startup.shift();
  };
  const consoleMessage = (...args: unknown[]): void => {
    for (const arg of args) {
      const text = consoleText(arg);
      if (text) remember(text);
    }
  };
  win.webContents.on("console-message", consoleMessage);
  try {
    const profile = labProfileProof(requestedProfile, {
      ...profilePaths,
      storagePath: win.webContents.session.getStoragePath(),
    });
    if (opts.role === "auxiliary") opts.registry.adoptAuxiliary(win);
    else opts.registry.adopt(win);
    win.webContents.setBackgroundThrottling(false);
    if (offscreen) {
      app.dock?.hide();
      win.webContents.setFrameRate(options.fps);
    } else {
      win.showInactive();
    }
    opts.onWindow?.(win);

    const canvas = new MarkerTail<Record<string, unknown>>(win, "CANVAS_READY ");
    const bridge = new MarkerTail<{ installed: boolean }>(win, "GODVIEW_PERF_LAB ");
    const monitor = new MarkerTail<MonitorFacts>(win, "GODVIEW_MONITOR ");
    const deck = new MarkerTail<LabDeckState>(win, "GODVIEW_DECK ");

    // A blank first document, so CDP answers before the product loads: a command
    // sent before the first navigation is never answered (the first offscreen
    // trial hung there, no renderer spawned). The hook then precedes every page
    // script of every document this window loads — with the Page domain enabled
    // first: registered without it, the script never ran in the product's
    // document (a trial read it registered and the page without it).
    await win.loadURL("about:blank");
    await cdp(win, "Page.enable");
    await cdp(win, "Page.addScriptToEvaluateOnNewDocument", { source: REACT_COMMIT_HOOK_SOURCE });
    await loadRenderer(win, "godview-perf-lab", opts.viteUrl);
    // asked again once the page exists: the rate set on a window that has not
    // navigated yet did not hold (the first offscreen trial drew at 60)
    if (offscreen) win.webContents.setFrameRate(options.fps);
    // the page believes it has focus; the person keeps theirs (M31)
    const focusEmulated =
      (await cdp(win, "Emulation.setFocusEmulationEnabled", { enabled: true })) !== null;
    const metered = (await cdp(win, "Performance.enable", { timeDomain: "timeTicks" })) !== null;
    await canvas.until(() => true, "the renderer to report CANVAS_READY", 90_000);
    await bridge.until((value) => value.installed, "the lab bridges to install", 30_000);
    await page(win, "localStorage.clear()");
    // the page's word, not the command's: the hook is ours and it is standing
    const reactHook = await page<boolean>(win, `typeof window.__vfReactCommits === "object"`);

    // Godview, as a person opens it; the monitor stage mounts the default view
    pressGodviewKey(win);
    await monitor.until(() => true, "the monitor stage to mount", 60_000);
    await page(win, `window.__vfGodviewPerf.observeStage(".vf-godview-monitor-stage")`);
    return {
      profile,
      win,
      monitor,
      deck,
      options,
      focusEmulated,
      frameRate: offscreen ? win.webContents.getFrameRate() : null,
      reactHook,
      metered,
    };
  } catch (error) {
    if (!win.isDestroyed()) win.destroy();
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(
      `${message}${startup.length ? `\nRenderer startup:\n${startup.join("\n")}` : ""}`,
      { cause: error },
    );
  } finally {
    if (!win.isDestroyed() && !win.webContents.isDestroyed())
      win.webContents.removeListener("console-message", consoleMessage);
  }
}

/** Perf and capture measure a fresh single-window host, so wait before replay
 * shifts its clock. The worker lifecycle probe opens auxiliary realms and has
 * its own worker-readiness contract; it does not measure a terminal workload.
 * A wait that fails says what it saw — the deck's last state (bounded) and the
 * readiness conditions that state still lacked: a launch was lost to this wait
 * on 2026-10-10 with a bare "timed out" and no reason to read. Since W7 the
 * terminals start away, so the wait first asks for them as a first call would
 * (`godview-deck-up.ts`; nothing to ask before W7), and a wait that fails after
 * the deck's `up()` threw says so. */
export async function waitForLabDeck(lab: LabWindow): Promise<void> {
  await askGodviewDeckUp(lab.win);
  await sayingDeckAsk(
    lab.win,
    lab.deck.until(
      (state) => {
        if (state.error !== undefined) {
          throw new Error(`Terminal deck: ${state.error} — the deck said ${labDeckSeen(state)}`);
        }
        return labDeckReady(state);
      },
      "the terminal deck to open a pane with an observed roster and WebGPU",
      60_000,
      labDeckTimeout,
    ),
  );
}

/** Whole lines per `executeJavaScript`: a model stream of n=60 is ~23 MB. */
const PUSH_CHUNK_CHARS = 4_000_000;

export interface ModelLoaded {
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

/** What a lab replays: the corpus itself (`fold`, today's seam's input) or its
 * model stream (`model`, the window's one door's answer — MV-3c). */
export interface LabSource {
  kind: "fold" | "model";
  modelDir: string | undefined;
}

/** Load a corpus in the page, and its model stream when the source asks. */
export async function loadCorpus(
  win: BrowserWindow,
  recipe: string,
  source: LabSource,
): Promise<{ corpus: string; frames: number; durationMs: number; model: ModelLoaded | null }> {
  const loaded = await page<{ corpus: string; frames: number; durationMs: number }>(
    win,
    `window.__vfGodviewReplay.load(${JSON.stringify(recipe)})`,
  );
  if (source.kind !== "model")
    throw new Error("fold replay retired in MV-8; run the pre-MV arm with its own checkout");
  if (source.modelDir === undefined)
    throw new Error("VF_GODVIEW_PERF_SOURCE=model needs VF_GODVIEW_PERF_MODEL_DIR");
  const model = await pushModelStream(win, source.modelDir, loaded.corpus);
  return { ...loaded, model };
}

export async function untilEnded(
  win: BrowserWindow,
  what: string,
  timeoutMs: number,
): Promise<void> {
  await untilPage(
    win,
    what,
    `window.__vfGodviewReplay.state().phase === "ended" ? "ok" : window.__vfGodviewReplay.state().phase`,
    timeoutMs,
  );
}

/**
 * Stop what this launch started and leave: the pair through its supervisor
 * (stop-owned — an adopted fieldd survives, the ownership law; a spawned
 * one's stop ends the floor its record names, one it adopted included), then
 * the evidence, then the root this run created (an injected `FIELDD_DATA_DIR`
 * is someone else's). The smoke's own teardown; mv0-vf's lab skipped the first
 * and the last, and each launch left a fieldd, a field-native and two
 * terminal hosts running over a root nobody removed.
 */
export async function teardownLab(opts: {
  supervisor: { dispose(): Promise<void> };
  root: string;
  beforeExit: () => Promise<void>;
}): Promise<void> {
  await opts.supervisor.dispose().catch(() => undefined);
  await opts.beforeExit().catch(() => undefined);
  if (!process.env["FIELDD_DATA_DIR"]) rmSync(opts.root, { recursive: true, force: true });
}

/** Leave the product as found: the default view selected again and the
 * renderer storage this lab cleared at its start cleared at its end (the
 * monitor persists the selected view, and every smoke-like launch of this
 * checkout shares that storage — mv0-vf's finding). */
export async function restoreLabWindow(lab: LabWindow): Promise<string | null> {
  await selectView(lab.win, lab.monitor, "swarm");
  await sleep(300);
  await page(lab.win, "localStorage.clear()");
  await sleep(300);
  return lab.monitor.current()?.viewId ?? null;
}
