import type { FieldFromWorker, FieldToWorker } from "./field-door";
import { type MarkFade, markFade } from "./field-mark";
import { createGlassPass, type GlassPass } from "./glass-pass";
import { createSplash, type Splash, SplashUnavailable } from "./vibefield-splash.js";

// The field in a worker (DESIGN.md §8 "The boot splash"; track FG): the website's splash drawing
// into the boot's canvas through an OffscreenCanvas, so the boot's work on the main thread can't
// stall it. The website's loading-window.worker.js (vibefield-dotdev), typed, with the mark's fade
// (field-mark.ts), and since FG-3b the Setup Assistant's glass as a pass of its frames (glass-pass.ts).
//
// The vendored module runs as it is. It reads three things a worker lacks, so they stand in: a
// ResizeObserver the page feeds sizes to, document.hidden and its event, and the pixel ratio. It
// reads them only once a splash is created, so they are in place before the first message.

type Resized = (entries: { contentRect: { width: number; height: number } }[]) => void;
const observers = new Set<{ callback: Resized }>();
const visibility = new Set<() => void>();
const page = {
  document: {
    hidden: false,
    addEventListener(type: string, listener: () => void) {
      if (type === "visibilitychange") visibility.add(listener);
    },
    removeEventListener(_type: string, listener: () => void) {
      visibility.delete(listener);
    },
  },
  window: { devicePixelRatio: 1 },
};
Object.assign(globalThis, {
  ...page,
  ResizeObserver: class {
    constructor(readonly callback: Resized) {}
    observe() {
      observers.add(this);
    }
    unobserve() {
      observers.delete(this);
    }
    disconnect() {
      observers.delete(this);
    }
  },
});
if (typeof globalThis.requestAnimationFrame !== "function") {
  Object.assign(globalThis, {
    requestAnimationFrame: (callback: FrameRequestCallback) =>
      setTimeout(() => callback(performance.now()), 1000 / 60),
    cancelAnimationFrame: (id: number) => clearTimeout(id),
  });
}

const scope = globalThis as unknown as {
  onmessage: ((event: MessageEvent<FieldToWorker>) => void) | null;
  postMessage(message: FieldFromWorker): void;
};

const resize = ({ cssW, cssH, dpr }: { cssW: number; cssH: number; dpr: number }): void => {
  page.window.devicePixelRatio = dpr;
  for (const observer of observers)
    observer.callback([{ contentRect: { width: cssW, height: cssH } }]);
};

let splash: Splash | null = null;
let device: GPUDevice | null = null;
let mark: MarkFade | null = null;
let glass: GlassPass | null = null;

scope.onmessage = async ({ data }) => {
  if (data.type === "start") {
    try {
      if (!navigator.gpu)
        throw new SplashUnavailable("no-webgpu", "WebGPU is not available in a worker");
      // The page's power preference, so the field and the desk land on one GPU on a dual-GPU
      // machine.
      const adapter = await navigator.gpu.requestAdapter({ powerPreference: data.powerPreference });
      if (adapter === null) throw new SplashUnavailable("no-adapter", "no WebGPU adapter");
      device = await adapter.requestDevice();
      const { canvas } = data;
      // Before its first size, the splash reads the canvas's own size as CSS px.
      canvas.width = Math.max(1, Math.round(data.cssW));
      canvas.height = Math.max(1, Math.round(data.cssH));
      // The glass's pass is the splash's post, so it comes first; it draws nothing until the page
      // hands it a glass.
      glass = createGlassPass(device, navigator.gpu, {
        drawn: (drawn) => scope.postMessage({ type: "glass-drawn", drawn }),
        frame: () => splash?.redraw(),
        failed: (message) => scope.postMessage({ type: "glass-failed", message }),
      });
      splash = await createSplash(canvas, {
        fps: 60,
        reducedMotion: data.reducedMotion,
        transparent: true,
        budget: data.budget,
        device,
        post: glass,
      });
      resize(data);
      splash.start();
      mark = markFade(splash);
      scope.postMessage({ type: "ready" });
    } catch (error) {
      glass?.destroy();
      glass = null;
      device?.destroy();
      device = null;
      const message = String(error instanceof Error ? error.message : error);
      scope.postMessage(
        error instanceof SplashUnavailable
          ? { type: "unavailable", reason: error.reason, message }
          : { type: "error", message },
      );
    }
  } else if (data.type === "resize") {
    resize(data);
  } else if (data.type === "visibility") {
    page.document.hidden = data.hidden;
    for (const listener of visibility) listener();
  } else if (data.type === "mark") {
    mark?.to(data.to, data.ms);
  } else if (data.type === "reveal") {
    mark?.cancel();
    const opened = splash === null ? false : await splash.reveal(data.options);
    scope.postMessage({ type: "revealed", id: data.id, opened });
  } else if (data.type === "glass") {
    glass?.setLook(data.glass?.look ?? null);
    glass?.setPose(data.glass?.pose ?? null);
    splash?.redraw();
  } else if (data.type === "destroy") {
    mark?.cancel();
    mark = null;
    glass?.destroy();
    glass = null;
    splash?.destroy();
    splash = null;
    device?.destroy();
    device = null;
    scope.postMessage({ type: "destroyed" });
  }
};
