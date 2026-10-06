import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { gzipSync } from "node:zlib";
import type { FielddHandle, FielddSupervisor } from "@vibefield/fieldd-supervisor";
import type { BrowserWindow } from "electron";
import type { WindowRegistry } from "../main/window-policy";
import {
  type LabDeckState,
  type LabMonitorState,
  labMonitorMembership,
  singlePaneLabDeck,
} from "./godview-lab-readiness";
import {
  cdp,
  type LabSource,
  type LabWindow,
  labWindowOptions,
  leave,
  loadCorpus,
  openLabWindow,
  page,
  restoreLabWindow,
  selectView,
  sleep,
  swarmRenderer,
  teardownLab,
  untilEnded,
  waitForLabDeck,
} from "./godview-lab-window";

// THE GODVIEW CAPTURE TOOL (MV-3c; build-mv M30, M31, M32) — the Electron half
// of `pnpm capture:godview`. The product with Godview open over the replay
// door, in the lab's one window (`godview-lab-window.ts`: offscreen by default,
// never focused), captured by the COMPOSITOR (`webContents.capturePage`, which
// draws the WebGPU swarm — a canvas readback is blank, M32) at FIXED FRAMES of
// a replayed corpus: for each theme × view × frame, the corpus replays from its
// start up to that frame (`start({ untilT })`) with the page's `Date.now`
// frozen at the corpus's wall for that frame (ages and recency cannot move
// between two captures), the timezone pinned to UTC and the locale to en-US
// over CDP (the timeline prints local time), the stage's ambient animations
// off and reduced motion emulated. Each capture is written as a PNG (to look
// at) and as the raw BGRA bitmap, gzipped (what the diff reads), with a
// manifest. A capture is the MONITOR'S REGION (the instrument bar, the stage and
// the view: `MONITOR_REGION`), and the whole window beside it as a PNG to look
// at. The Node runner launches arms and diffs them (`scripts/capture-godview.mjs`).
//
// Reached through the perf lab's mode (`--godview-perf-lab`, `VF_GODVIEW_LAB=capture`):
//
//   VF_GODVIEW_CAPTURE_OUT     the directory to write (required)
//   VF_GODVIEW_CAPTURE_RECIPE  the corpus (default `n=20,duration=8000,seed=1`)
//   VF_GODVIEW_CAPTURE_FRAMES  corpus ms after its first frame (default `2500,7900`)
//   VF_GODVIEW_CAPTURE_THEMES  `dark,light` (default both)
//   VF_GODVIEW_CAPTURE_SETTLE_MS  the wait after a replay ends (default 1500)
//   VF_GODVIEW_CAPTURE_MOTION  `reduce` (default) or `normal`
//   VF_GODVIEW_PERF_VIEWS / _SOURCE / _MODEL_DIR / _WINDOW / _SCALE  as the perf lab

const DEFAULT_VIEWS = ["swarm", "list", "rain", "timeline"];

export interface GodviewCapture {
  name: string;
  view: string;
  theme: string;
  t: number;
  wall: number;
  width: number;
  height: number;
  /** the page's device pixel ratio, and the captured region in CSS px */
  dpr: number;
  region: { x: number; y: number; width: number; height: number };
  /** distinct colours on a sampled grid, and the share of pixels off the
   * modal colour: a blank capture compares equal to a blank one (memory
   * `webgpu-canvas-readback-is-blank`), so the diff refuses one */
  content: { colours: number; offModal: number };
  swarmRenderer: string | null;
  delivered: number;
  deck: LabDeckState;
  monitor: LabMonitorState;
}

/** A capture's content, sampled on a grid of the BGRA bitmap. */
export function bitmapContent(
  bitmap: Uint8Array,
  width: number,
  height: number,
): { colours: number; offModal: number } {
  const counts = new Map<number, number>();
  let samples = 0;
  const step = Math.max(1, Math.floor(Math.min(width, height) / 160));
  for (let y = 0; y < height; y += step) {
    for (let x = 0; x < width; x += step) {
      const at = (y * width + x) * 4;
      const colour =
        ((bitmap[at] ?? 0) << 16) | ((bitmap[at + 1] ?? 0) << 8) | (bitmap[at + 2] ?? 0);
      counts.set(colour, (counts.get(colour) ?? 0) + 1);
      samples += 1;
    }
  }
  const modal = Math.max(0, ...counts.values());
  return { colours: counts.size, offModal: samples === 0 ? 0 : 1 - modal / samples };
}

/** The monitor's region: the window's full width from its top to the bottom
 * of Godview's monitor stage — the instrument bar, the stage, the view. The
 * deck below it (a terminal's blinking cursor) and the composer's animated
 * avatar are not the views', and the first A/A trial read exactly them. */
const MONITOR_REGION = `(() => {
  const stage = document.querySelector(".vf-godview .vf-godview-monitor-stage");
  if (stage === null) return null;
  const bottom = Math.round(stage.getBoundingClientRect().bottom);
  return { x: 0, y: 0, width: Math.round(window.innerWidth), height: bottom, dpr: window.devicePixelRatio };
})()`;

async function capture(win: BrowserWindow, dir: string, name: string) {
  const region = await page<{
    x: number;
    y: number;
    width: number;
    height: number;
    dpr: number;
  } | null>(win, MONITOR_REGION);
  if (region === null) throw new Error("no Godview monitor stage to capture");
  const { dpr, ...rect } = region;
  const image = await win.webContents.capturePage(rect);
  const { width, height } = image.getSize();
  const bitmap = image.toBitmap();
  writeFileSync(join(dir, `${name}.png`), image.toPNG());
  writeFileSync(join(dir, `${name}.bgra.gz`), gzipSync(bitmap));
  // the whole window too, to look at (never diffed)
  writeFileSync(join(dir, `${name}.window.png`), (await win.webContents.capturePage()).toPNG());
  return { width, height, dpr, region: rect, content: bitmapContent(bitmap, width, height) };
}

const list = (text: string | undefined, fallback: string[]): string[] =>
  (text ?? fallback.join(","))
    .split(",")
    .map((piece) => piece.trim())
    .filter((piece) => piece !== "");

export async function runGodviewCapture(opts: {
  handle: FielddHandle;
  supervisor: FielddSupervisor;
  root: string;
  registry: WindowRegistry;
  preloadPath: string;
  viteUrl: string;
  beforeExit: () => Promise<void>;
  onWindow?: (window: BrowserWindow) => void;
}): Promise<void> {
  const out = process.env["VF_GODVIEW_CAPTURE_OUT"];
  const recipe = process.env["VF_GODVIEW_CAPTURE_RECIPE"] || "n=20,duration=8000,seed=1";
  const frames = list(process.env["VF_GODVIEW_CAPTURE_FRAMES"], ["2500", "7900"]).map(Number);
  const themes = list(process.env["VF_GODVIEW_CAPTURE_THEMES"], ["dark", "light"]);
  const views = list(process.env["VF_GODVIEW_PERF_VIEWS"], DEFAULT_VIEWS);
  const settleMs = Math.max(0, Number(process.env["VF_GODVIEW_CAPTURE_SETTLE_MS"] ?? 1_500));
  const motion = process.env["VF_GODVIEW_CAPTURE_MOTION"] === "normal" ? "normal" : "reduce";
  const source: LabSource = {
    kind: process.env["VF_GODVIEW_PERF_SOURCE"] === "fold" ? "fold" : "model",
    modelDir: process.env["VF_GODVIEW_PERF_MODEL_DIR"] || undefined,
  };
  const windowOptions = labWindowOptions();
  const say = (record: Record<string, unknown>): void => {
    process.stdout.write(`GODVIEW_CAPTURE ${JSON.stringify(record)}\n`);
  };

  let code = 0;
  const captures: GodviewCapture[] = [];
  let lab: LabWindow | null = null;
  let pinned = { timezone: false, locale: false, motion: false };
  try {
    if (out === undefined || out === "") throw new Error("VF_GODVIEW_CAPTURE_OUT is required");
    if (frames.some((t) => !Number.isFinite(t) || t < 0)) {
      throw new Error(`VF_GODVIEW_CAPTURE_FRAMES must be corpus ms: ${frames.join(",")}`);
    }
    mkdirSync(out, { recursive: true });
    lab = await openLabWindow({
      preloadPath: opts.preloadPath,
      viteUrl: opts.viteUrl,
      registry: opts.registry,
      options: windowOptions,
      onWindow: opts.onWindow,
    });
    await waitForLabDeck(lab);
    const { win, monitor } = lab;
    // what a capture holds still (M32): the zone, the locale, the motion
    pinned = {
      timezone: (await cdp(win, "Emulation.setTimezoneOverride", { timezoneId: "UTC" })) !== null,
      locale: (await cdp(win, "Emulation.setLocaleOverride", { locale: "en-US" })) !== null,
      motion:
        motion === "normal" ||
        (await cdp(win, "Emulation.setEmulatedMedia", {
          features: [{ name: "prefers-reduced-motion", value: "reduce" }],
        })) !== null,
    };
    await page(win, "window.__vfGodviewCapture.setAnimations(false)");
    // the capture freezes the page's clock itself, per frame
    await page(win, `window.__vfGodviewReplay.setClock("real")`);
    const loaded = await loadCorpus(win, recipe, source);
    say({ kind: "open", source: source.kind, window: windowOptions, pinned, motion, ...loaded });

    for (const theme of themes) {
      await page(win, `window.__vfGodviewCapture.setTheme(${JSON.stringify(theme)})`);
      await sleep(settleMs);
      for (const view of views) {
        await selectView(win, monitor, view);
        await sleep(settleMs);
        for (const t of frames) {
          const wall = await page<number | null>(win, `window.__vfGodviewReplay.wallAt(${t})`);
          if (wall === null) throw new Error("the player has no corpus loaded");
          await page(win, `window.__vfGodviewCapture.freezeClock(${wall})`);
          await page(win, `window.__vfGodviewReplay.start({ untilT: ${t} })`);
          await untilEnded(win, `the replay to reach ${t} ms on ${view}`, t + 30_000);
          await sleep(settleMs);
          const state = await page<{ delivered: number }>(win, "window.__vfGodviewReplay.state()");
          const name = `${view}-${theme}-t${t}`;
          const deck = singlePaneLabDeck(lab.deck.current());
          const membership = labMonitorMembership(monitor.current(), view);
          const shot = await capture(win, out, name);
          const record: GodviewCapture = {
            name,
            view,
            theme,
            t,
            wall,
            ...shot,
            swarmRenderer: view === "swarm" ? await swarmRenderer(win) : null,
            delivered: state.delivered,
            deck,
            monitor: membership,
          };
          captures.push(record);
          say({ kind: "capture", ...record });
          await page(win, "window.__vfGodviewReplay.stop()");
        }
      }
    }
    await page(win, "window.__vfGodviewCapture.restoreClock()");
    await page(win, `window.__vfGodviewCapture.setTheme("auto")`);
    say({ kind: "restored", view: await restoreLabWindow(lab) });
  } catch (error) {
    code = 1;
    say({ kind: "failed", error: error instanceof Error ? error.message : String(error) });
  }

  if (out !== undefined && out !== "") {
    writeFileSync(
      join(out, "manifest.json"),
      `${JSON.stringify(
        {
          recipe,
          frames,
          themes,
          views,
          settleMs,
          motion,
          source: source.kind,
          window: windowOptions,
          pinned,
          electron: process.versions["electron"],
          platform: process.platform,
          captures,
        },
        null,
        2,
      )}\n`,
    );
  }
  say({ kind: "done", out, captures: captures.length, code });
  await teardownLab(opts);
  leave(code);
}
