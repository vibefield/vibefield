import { getRendererLogger } from "../../logging";
import { markFade } from "./field-mark";
import type { GlassState } from "./glass-look";
import type { Splash, SplashRevealOptions } from "./vibefield-splash.js";

// The field's door (DESIGN.md §2.1, §8 "The boot splash"; track FG): the website's loading window
// (vibefield-dotdev lib/loading-window.js), ported. The field runs in a worker when it can
// (field-worker.ts), so the boot's own work on the main thread — the workspace's import, the
// document's warm-up — can't stall it, and on the main thread otherwise. Without WebGPU it doesn't
// run at all: the boot keeps the field's ground, its mark as a still, then the field's still
// (FieldLayer). One change from the website's door: the PAGE's navigator.gpu is read first, since a
// smoke's `--smoke-no-webgpu` takes it from each document and a worker would still find its own.
// `?field=still` and `?field=main` force the still and the main thread (the website's `?splash=`).
// Since FG-3b the door carries the Setup Assistant's glass to the field (FG-D24, glass-pass.ts): what
// to draw goes in, and whether the field draws it comes out, so the browser can stand its own down.

/** The website's desktop budget (lib/loading-window.js BUDGET.desktop): the device pixels the
 * field's backing store stops at, so it leaves the GPU room for the desk composing behind it. */
export const FIELD_BUDGET = 3.2e6;

/** The website's: a desktop asks for the GPU the desk draws on. */
const POWER: GPUPowerPreference = "high-performance";

/** The reveal's options as they cross to a worker: numbers only, its pace the splash's own (t²). */
export type FieldRevealOptions = Omit<SplashRevealOptions, "ease">;

/** The tear (DESIGN.md §6; the website's `SPLASH` and `REVEAL_LOOK`, components/experience.tsx and
 * lib/loading-window.js): the field opens from its centre over 1.9s, its mark gone in the first
 * quarter, the light on its walls held back and the edge torn by the noise. */
export const TEAR = { duration: 1900, markFade: 0.24, rim: 0.5, tear: 0.3 } as const;

/** The website's daylight on the tear's walls (REVEAL_LOOK.ink): the sun's warm white, display
 * encoded. */
export const DAYLIGHT: readonly [number, number, number] = [1, 0.955, 0.87];

/** The tear as the theme lights it (FG-D11 A): daylight by day; by night no ink, so the splash
 * keeps the look's own centre light. */
export function tearLook(dark: boolean): FieldRevealOptions {
  return dark ? { ...TEAR } : { ...TEAR, ink: DAYLIGHT };
}

export interface FieldDoor {
  readonly mode: "worker" | "main" | "still";
  /** Why the field is its still: "forced", "no-webgpu", "no-adapter" or "error". */
  readonly reason?: string;
  /** The field's mark: 1 shown … 0 gone, over `ms` on plain `ease` (at once for 0). */
  mark(to: number, ms: number): void;
  /** The website's reveal, opening the field from its centre: true once the window is open. */
  reveal(options?: FieldRevealOptions): Promise<boolean>;
  /** The Setup Assistant's glass, drawn by the field in its own frame (FG-3b); null draws none. */
  glass(glass: GlassState | null): void;
  destroy(): void;
}

export type FieldToWorker =
  | {
      type: "start";
      canvas: OffscreenCanvas;
      cssW: number;
      cssH: number;
      dpr: number;
      reducedMotion: boolean;
      budget: number;
      powerPreference: GPUPowerPreference;
    }
  | { type: "resize"; cssW: number; cssH: number; dpr: number }
  | { type: "visibility"; hidden: boolean }
  | { type: "mark"; to: number; ms: number }
  | { type: "reveal"; id: number; options: FieldRevealOptions }
  | { type: "glass"; glass: GlassState | null }
  | { type: "destroy" };

export type FieldFromWorker =
  | { type: "ready" }
  | { type: "unavailable"; reason: string; message: string }
  | { type: "error"; message: string }
  | { type: "revealed"; id: number; opened: boolean }
  | { type: "glass-drawn"; drawn: boolean }
  | { type: "glass-failed"; message: string }
  | { type: "destroyed" };

type SplashModule = typeof import("./vibefield-splash.js");
type GlassModule = typeof import("./glass-pass");

/** What the door reaches for, each the page's own unless a test hands it one. */
export interface FieldDoorEnv {
  readonly search?: string;
  readonly gpu?: GPU | undefined;
  readonly worker?: () => Worker;
  readonly splash?: () => Promise<SplashModule>;
  readonly glass?: () => Promise<GlassModule>;
}

interface Settings {
  readonly reducedMotion: boolean;
  readonly budget: number;
  readonly powerPreference: GPUPowerPreference;
}

export type FieldPlan =
  | { readonly still: "forced" | "no-webgpu" }
  | { readonly gpu: GPU; readonly mainThread: boolean };

/** What the door will try, read at once, so a window that can't run the field paints its still from
 * the first frame: `?field=still`, or no WebGPU on the page. */
export function fieldPlan(env: Pick<FieldDoorEnv, "search" | "gpu"> = {}): FieldPlan {
  const forced = new URLSearchParams(env.search ?? location.search).get("field");
  if (forced === "still") return { still: "forced" };
  const gpu = "gpu" in env ? env.gpu : navigator.gpu;
  if (gpu === undefined) return { still: "no-webgpu" };
  return { gpu, mainThread: forced === "main" };
}

/** Open the field in `container`, its canvas placed before `before` (the still mark, which stays
 * over the canvas while it fades in). Never rejects: a field that can't start is the still.
 * `onGlass` hears whether the field draws the Setup Assistant's glass (FG-3b). */
export async function openFieldDoor(
  container: HTMLElement,
  before: Element | null,
  { reducedMotion, onGlass }: { reducedMotion: boolean; onGlass?: (drawn: boolean) => void },
  env: FieldDoorEnv = {},
): Promise<FieldDoor> {
  const settings: Settings = { reducedMotion, budget: FIELD_BUDGET, powerPreference: POWER };
  const plan = fieldPlan(env);
  if ("still" in plan) return still(plan.still);
  const place = (): HTMLCanvasElement => {
    const canvas = document.createElement("canvas");
    canvas.className = "vf-field-canvas";
    canvas.setAttribute("aria-hidden", "true");
    container.insertBefore(canvas, before);
    return canvas;
  };
  if (
    !plan.mainThread &&
    typeof Worker !== "undefined" &&
    typeof OffscreenCanvas !== "undefined" &&
    "transferControlToOffscreen" in HTMLCanvasElement.prototype
  ) {
    const canvas = place();
    try {
      return await inWorker(canvas, settings, env, onGlass);
    } catch (error) {
      canvas.remove();
      log().info("renderer.boot.field_main_thread", "The field runs on the main thread", {
        reason: error instanceof FieldUnavailable ? error.reason : "error",
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }
  return onMainThread(place(), settings, plan.gpu, env, onGlass);
}

const log = () => getRendererLogger().child({ component: "boot.field" });

/** The glass's pass couldn't be made, so the browser keeps drawing the glass (FG-3b). */
const glassFailed = (message: string): void =>
  log().warn("renderer.boot.field_glass", "The field can't draw the Setup Assistant's glass", {
    message,
  });

class FieldUnavailable extends Error {
  constructor(
    readonly reason: string,
    message: string,
  ) {
    super(message);
  }
}

function still(reason: string): FieldDoor {
  return { mode: "still", reason, mark() {}, reveal: async () => false, glass() {}, destroy() {} };
}

async function inWorker(
  canvas: HTMLCanvasElement,
  settings: Settings,
  env: FieldDoorEnv,
  onGlass?: (drawn: boolean) => void,
): Promise<FieldDoor> {
  const worker =
    env.worker?.() ?? new Worker(new URL("./field-worker.ts", import.meta.url), { type: "module" });
  const post = (message: FieldToWorker, transfer: Transferable[] = []): void =>
    worker.postMessage(message, transfer);
  const size = () => ({
    cssW: canvas.clientWidth || innerWidth,
    cssH: canvas.clientHeight || innerHeight,
    dpr: devicePixelRatio || 1,
  });
  const reveals = new Map<number, (opened: boolean) => void>();
  const started = new Promise<void>((resolve, reject) => {
    worker.onerror = (event) => reject(new Error(event.message || "The field's worker failed"));
    worker.onmessage = ({ data }: MessageEvent<FieldFromWorker>) => {
      if (data.type === "ready") resolve();
      else if (data.type === "unavailable") reject(new FieldUnavailable(data.reason, data.message));
      else if (data.type === "error") reject(new Error(data.message));
      else if (data.type === "revealed") {
        reveals.get(data.id)?.(data.opened);
        reveals.delete(data.id);
      } else if (data.type === "glass-drawn") onGlass?.(data.drawn);
      else if (data.type === "glass-failed") glassFailed(data.message);
    };
  });
  const offscreen = canvas.transferControlToOffscreen();
  post({ type: "start", canvas: offscreen, ...size(), ...settings }, [offscreen]);
  try {
    await started;
  } catch (error) {
    worker.terminate();
    throw error;
  }
  const observer = new ResizeObserver(() => post({ type: "resize", ...size() }));
  observer.observe(canvas);
  const onVisibility = (): void => post({ type: "visibility", hidden: document.hidden });
  document.addEventListener("visibilitychange", onVisibility);
  let gone = false;
  let next = 0;
  return {
    mode: "worker",
    mark(to, ms) {
      if (!gone) post({ type: "mark", to, ms });
    },
    reveal(options = {}) {
      if (gone) return Promise.resolve(false);
      const id = ++next;
      return new Promise((resolve) => {
        reveals.set(id, resolve);
        post({ type: "reveal", id, options });
      });
    },
    glass(state) {
      if (!gone) post({ type: "glass", glass: state });
    },
    destroy() {
      if (gone) return;
      gone = true;
      for (const resolve of reveals.values()) resolve(false);
      reveals.clear();
      observer.disconnect();
      document.removeEventListener("visibilitychange", onVisibility);
      post({ type: "destroy" });
      // Give the worker a moment to release its GPU device, then end it.
      setTimeout(() => worker.terminate(), 250);
      canvas.remove();
    },
  };
}

async function onMainThread(
  canvas: HTMLCanvasElement,
  settings: Settings,
  gpu: GPU,
  env: FieldDoorEnv,
  onGlass?: (drawn: boolean) => void,
): Promise<FieldDoor> {
  let device: GPUDevice | null = null;
  let module: SplashModule | null = null;
  try {
    const [splashModule, { createGlassPass }] = await Promise.all([
      env.splash?.() ?? import("./vibefield-splash.js"),
      env.glass?.() ?? import("./glass-pass"),
    ]);
    module = splashModule;
    const { createSplash, SplashUnavailable } = module;
    const adapter = await gpu.requestAdapter({ powerPreference: settings.powerPreference });
    if (adapter === null) throw new SplashUnavailable("no-adapter", "no WebGPU adapter");
    device = await adapter.requestDevice();
    // The glass's pass is the splash's post, so it comes first. It asks for a frame only once it
    // has a look, which comes through the door, so after the splash is made.
    let drawing: Splash | null = null;
    const glass = createGlassPass(device, gpu, {
      drawn: (drawn) => onGlass?.(drawn),
      frame: () => drawing?.redraw(),
      failed: glassFailed,
    });
    const splash = await createSplash(canvas, {
      fps: 60,
      reducedMotion: settings.reducedMotion,
      transparent: true,
      budget: settings.budget,
      device,
      post: glass,
    });
    drawing = splash;
    splash.start();
    const mark = markFade(splash);
    const owned = device;
    let gone = false;
    return {
      mode: "main",
      mark(to, ms) {
        if (!gone) mark.to(to, ms);
      },
      reveal(options = {}) {
        if (gone) return Promise.resolve(false);
        mark.cancel();
        return splash.reveal(options);
      },
      glass(state) {
        if (gone) return;
        glass.setLook(state?.look ?? null);
        glass.setPose(state?.pose ?? null);
        splash.redraw();
      },
      destroy() {
        if (gone) return;
        gone = true;
        mark.cancel();
        glass.destroy();
        splash.destroy();
        owned.destroy();
        canvas.remove();
      },
    };
  } catch (error) {
    device?.destroy();
    canvas.remove();
    // Any failure to start leaves the still: SplashUnavailable says why, anything else is logged.
    if (module !== null && error instanceof module.SplashUnavailable) return still(error.reason);
    log().warn("renderer.boot.field_still", "The field fell back to its still", {
      message: error instanceof Error ? error.message : String(error),
    });
    return still("error");
  }
}
