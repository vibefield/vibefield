import { rmSync } from "node:fs";
import { app, type BrowserWindow } from "electron";
import type { WindowRegistry } from "../main/window-policy";
import { createMainWindow, loadRenderer } from "../main/windows";
import type { PageMetrics } from "./godview-lab-measures";
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
// window per process: Electron 43 dies when an offscreen window is destroyed
// and another opens (M32), so a tool reloads the one it has.
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

/** What the swarm says it renders with (`data-swarm-renderer`), when it is mounted. */
export async function swarmRenderer(win: BrowserWindow): Promise<string | null> {
  return await page<string | null>(
    win,
    `document.querySelector("[data-swarm-renderer]")?.getAttribute("data-swarm-renderer") ?? null`,
  );
}

/** One CDP command, bounded: a debugger another tool holds, or a page that
 * does not answer, yields null and the caller says what it went without. */
async function cdp<T>(
  win: BrowserWindow,
  method: string,
  params: Record<string, unknown> = {},
): Promise<T | null> {
  try {
    if (!win.webContents.debugger.isAttached()) win.webContents.debugger.attach("1.3");
    return await Promise.race([
      win.webContents.debugger.sendCommand(method, params) as Promise<T>,
      sleep(5_000).then(() => null),
    ]);
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
  win: BrowserWindow;
  monitor: MarkerTail<MonitorFacts>;
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
  options: LabWindowOptions;
  onWindow?: ((window: BrowserWindow) => void) | undefined;
}): Promise<LabWindow> {
  const { options } = opts;
  const offscreen = options.mode === "offscreen";
  const win = createMainWindow({
    mode: "godview-perf-lab",
    preloadPath: opts.preloadPath,
    show: false,
    ...(offscreen ? { offscreen: { deviceScaleFactor: options.scale } } : {}),
  });
  opts.registry.adopt(win);
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
    win,
    monitor,
    options,
    focusEmulated,
    frameRate: offscreen ? win.webContents.getFrameRate() : null,
    reactHook,
    metered,
  };
}

/**
 * Stop what this launch started and leave: the pair through its supervisor
 * (stop-owned — an adopted daemon survives, the ownership law), then the
 * evidence, then the root this run created (an injected `FIELDD_DATA_DIR` is
 * someone else's). The smoke's own teardown; mv0-vf's lab skipped the first
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
