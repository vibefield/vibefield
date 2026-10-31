/**
 * Track FG — the field's door (DESIGN.md §8 "The boot splash"): the website's loading window, ported. The PAGE's
 * WebGPU is read first (a smoke's `--smoke-no-webgpu` takes it per document, and a worker would still find its own),
 * then the worker runs the field, then the main thread, then the still. happy-dom has neither WebGPU nor a worker,
 * so every branch runs on fakes the door is handed. Since FG-3b the door carries the Setup Assistant's glass to the
 * field and the field's word on it back (FG-D24).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  DAYLIGHT,
  FIELD_BUDGET,
  type FieldFromWorker,
  type FieldToWorker,
  fieldPlan,
  openFieldDoor,
  TEAR,
  tearLook,
} from "../src/boot/splash/field-door";
import { ease, markFade } from "../src/boot/splash/field-mark";
import type { GlassState } from "../src/boot/splash/glass-look";
import type * as GlassModule from "../src/boot/splash/glass-pass";
import type * as SplashModule from "../src/boot/splash/vibefield-splash.js";
import { getRendererLogger, type RendererLogger, setRendererLogger } from "../src/logging";

/** A worker that answers the door's messages as `answer` says, a microtask later. */
class FakeWorker {
  readonly sent: { message: FieldToWorker; transfer: Transferable[] }[] = [];
  onmessage: ((event: MessageEvent<FieldFromWorker>) => void) | null = null;
  onerror: ((event: ErrorEvent) => void) | null = null;
  terminated = false;
  constructor(private readonly answer: (message: FieldToWorker) => FieldFromWorker | null) {}
  postMessage(message: FieldToWorker, transfer: Transferable[] = []): void {
    this.sent.push({ message, transfer });
    const reply = this.answer(message);
    if (reply !== null) {
      queueMicrotask(() => this.onmessage?.({ data: reply } as MessageEvent<FieldFromWorker>));
    }
  }
  terminate(): void {
    this.terminated = true;
  }
  last(): FieldToWorker | undefined {
    return this.sent.at(-1)?.message;
  }
}

function fakeGpu(adapter = true) {
  const device = { destroyed: 0 };
  const requested: unknown[] = [];
  const gpu = {
    async requestAdapter(options: unknown) {
      requested.push(options);
      if (!adapter) return null;
      return {
        async requestDevice() {
          return {
            destroy() {
              device.destroyed++;
            },
          };
        },
      };
    },
  } as unknown as GPU;
  return { gpu, device, requested };
}

/** The vendored module's shape, with its own SplashUnavailable, as the door imports it. */
function fakeSplash(fail?: Error) {
  class SplashUnavailable extends Error {
    constructor(
      readonly reason: string,
      message: string,
    ) {
      super(message);
    }
  }
  const calls = {
    created: [] as unknown[],
    started: 0,
    setReveal: [] as [number, unknown][],
    reveals: [] as unknown[],
    redrawn: 0,
    destroyed: 0,
  };
  const module = {
    SplashUnavailable,
    async createSplash(_canvas: unknown, options: unknown) {
      calls.created.push(options);
      if (fail !== undefined) throw fail;
      return {
        start() {
          calls.started++;
        },
        stop() {},
        setReveal(front: number, look: unknown) {
          calls.setReveal.push([front, look]);
        },
        async reveal(options: unknown) {
          calls.reveals.push(options);
          return true;
        },
        redraw() {
          calls.redrawn++;
        },
        destroy() {
          calls.destroyed++;
        },
      };
    },
  } as unknown as typeof SplashModule;
  return { module, calls };
}

/** The glass's pass as the door makes it on the main thread: what it is handed, and the hooks it was given. */
function fakeGlass() {
  const calls = {
    looks: [] as unknown[],
    poses: [] as unknown[],
    destroyed: 0,
    hooks: null as GlassModule.GlassPassHooks | null,
  };
  const pass = {
    setLook: (look: unknown) => void calls.looks.push(look),
    setPose: (pose: unknown) => void calls.poses.push(pose),
    encode() {},
    destroy() {
      calls.destroyed++;
    },
  };
  const module = {
    createGlassPass(_device: unknown, _gpu: unknown, hooks: GlassModule.GlassPassHooks) {
      calls.hooks = hooks;
      return pass;
    },
  } as unknown as typeof GlassModule;
  return { module, pass, calls };
}

/** A glass on the field, as glass-look.ts reads it. */
const GLASS: GlassState = {
  look: { tint: [1, 1, 1, 0.55], blur: 32, saturate: 1.12, grain: 0.03, radius: 32, shadows: [] },
  pose: { x: 600, y: 400, w: 880, h: 640, fit: 0.75, frost: 1, rise: 1 },
};

/** The field's container with its still mark, as FieldLayer draws them. */
function stage(): { container: HTMLDivElement; mark: HTMLDivElement } {
  const container = document.createElement("div");
  const mark = document.createElement("div");
  mark.className = "vf-field-mark";
  container.append(mark);
  document.body.append(container);
  return { container, mark };
}

const OFFSCREEN = { offscreen: true } as unknown as OffscreenCanvas;
const proto = HTMLCanvasElement.prototype as unknown as Record<string, unknown>;
const QUIET = getRendererLogger();

beforeEach(() => {
  // What the door asks of a page before it reaches for a worker.
  vi.stubGlobal("Worker", FakeWorker);
  vi.stubGlobal("OffscreenCanvas", class {});
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      disconnect() {}
    },
  );
  proto.transferControlToOffscreen = () => OFFSCREEN;
});

afterEach(() => {
  setRendererLogger(QUIET);
  delete proto.transferControlToOffscreen;
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.useRealTimers();
  document.body.innerHTML = "";
});

describe("the field's plan, read at once", () => {
  it("is the still for ?field=still and for a page without WebGPU; ?field=main skips the worker", () => {
    const { gpu } = fakeGpu();
    expect(fieldPlan({ search: "?field=still", gpu })).toEqual({ still: "forced" });
    expect(fieldPlan({ search: "", gpu: undefined })).toEqual({ still: "no-webgpu" });
    expect(fieldPlan({ search: "?field=main", gpu })).toEqual({ gpu, mainThread: true });
    expect(fieldPlan({ search: "", gpu })).toEqual({ gpu, mainThread: false });
  });

  it("reads the page's own WebGPU — happy-dom has none, so the still", () => {
    expect(fieldPlan({ search: "" })).toEqual({ still: "no-webgpu" });
  });
});

describe("the field's door", () => {
  it("opens nothing where the plan is the still", async () => {
    const { container, mark } = stage();
    const door = await openFieldDoor(
      container,
      mark,
      { reducedMotion: false },
      { search: "?field=still" },
    );
    expect(door.mode).toBe("still");
    expect(door.reason).toBe("forced");
    expect(container.querySelector("canvas")).toBeNull();
    expect(await door.reveal()).toBe(false);
    // the browser draws the glass over the still
    door.glass(GLASS);
  });

  it("runs the field in a worker: the website's budget and power, the page's size, its canvas under the still mark", async () => {
    const worker = new FakeWorker((m) =>
      m.type === "start"
        ? { type: "ready" }
        : m.type === "reveal"
          ? { type: "revealed", id: m.id, opened: true }
          : null,
    );
    const { container, mark } = stage();
    const door = await openFieldDoor(
      container,
      mark,
      { reducedMotion: true },
      { search: "", gpu: fakeGpu().gpu, worker: () => worker as unknown as Worker },
    );
    expect(door.mode).toBe("worker");
    expect(worker.sent[0]?.message).toMatchObject({
      type: "start",
      canvas: OFFSCREEN,
      budget: FIELD_BUDGET,
      powerPreference: "high-performance",
      reducedMotion: true,
      cssW: innerWidth,
      cssH: innerHeight,
      dpr: 1,
    });
    expect(worker.sent[0]?.transfer).toEqual([OFFSCREEN]);
    expect(FIELD_BUDGET).toBe(3.2e6);
    const canvas = container.querySelector("canvas.vf-field-canvas");
    expect(canvas?.nextElementSibling).toBe(mark);
    expect(canvas?.getAttribute("aria-hidden")).toBe("true");

    door.mark(0, 400);
    expect(worker.last()).toEqual({ type: "mark", to: 0, ms: 400 });
    expect(await door.reveal({ duration: 1900, markFade: 0.24 })).toBe(true);
    expect(worker.last()).toEqual({
      type: "reveal",
      id: 1,
      options: { duration: 1900, markFade: 0.24 },
    });

    vi.useFakeTimers();
    door.destroy();
    expect(worker.last()).toEqual({ type: "destroy" });
    expect(container.querySelector("canvas")).toBeNull();
    // The worker is given a moment to let its device go, then ended.
    expect(worker.terminated).toBe(false);
    vi.advanceTimersByTime(250);
    expect(worker.terminated).toBe(true);
    door.mark(1, 400);
    expect(worker.last()).toEqual({ type: "destroy" });
  });

  it("carries the glass to the worker, and the field's word on it back (FG-3b)", async () => {
    const warned = captureWarnings();
    const worker = new FakeWorker((m) =>
      m.type === "start"
        ? { type: "ready" }
        : m.type === "glass"
          ? { type: "glass-drawn", drawn: m.glass !== null }
          : null,
    );
    const onGlass = vi.fn<(drawn: boolean) => void>();
    const { container, mark } = stage();
    const door = await openFieldDoor(
      container,
      mark,
      { reducedMotion: false, onGlass },
      { search: "", gpu: fakeGpu().gpu, worker: () => worker as unknown as Worker },
    );
    door.glass(GLASS);
    expect(worker.last()).toEqual({ type: "glass", glass: GLASS });
    await vi.waitFor(() => expect(onGlass.mock.calls).toEqual([[true]]));
    door.glass(null);
    expect(worker.last()).toEqual({ type: "glass", glass: null });
    await vi.waitFor(() => expect(onGlass.mock.calls).toEqual([[true], [false]]));

    // a pass the field can't make is logged, and the browser keeps the glass
    worker.onmessage?.({
      data: { type: "glass-failed", message: "WGSL failed" },
    } as MessageEvent<FieldFromWorker>);
    expect(warned).toEqual([["renderer.boot.field_glass", { message: "WGSL failed" }]]);

    door.destroy();
    door.glass(GLASS);
    expect(worker.last()).toEqual({ type: "destroy" });
  });

  it("answers a reveal still in flight with false when the door is destroyed", async () => {
    const worker = new FakeWorker((m) => (m.type === "start" ? { type: "ready" } : null));
    const { container, mark } = stage();
    const door = await openFieldDoor(
      container,
      mark,
      { reducedMotion: false },
      { search: "", gpu: fakeGpu().gpu, worker: () => worker as unknown as Worker },
    );
    const opened = door.reveal();
    door.destroy();
    expect(await opened).toBe(false);
    expect(await door.reveal()).toBe(false);
  });

  it("moves to the main thread when the worker can't run the field, and ends the worker", async () => {
    const worker = new FakeWorker((m) =>
      m.type === "start"
        ? {
            type: "unavailable",
            reason: "no-webgpu",
            message: "WebGPU is not available in a worker",
          }
        : null,
    );
    const { gpu, device, requested } = fakeGpu();
    const { module, calls } = fakeSplash();
    const { container, mark } = stage();
    const door = await openFieldDoor(
      container,
      mark,
      { reducedMotion: false },
      { search: "", gpu, worker: () => worker as unknown as Worker, splash: async () => module },
    );
    expect(door.mode).toBe("main");
    expect(worker.terminated).toBe(true);
    // The worker's canvas went with it; the main thread drew a canvas of its own.
    expect(container.querySelectorAll("canvas")).toHaveLength(1);
    expect(container.querySelector("canvas")?.nextElementSibling).toBe(mark);
    expect(requested).toEqual([{ powerPreference: "high-performance" }]);
    expect(calls.created).toEqual([
      expect.objectContaining({
        fps: 60,
        transparent: true,
        budget: FIELD_BUDGET,
        reducedMotion: false,
      }),
    ]);
    expect(calls.started).toBe(1);

    // A reveal cancels the mark's own fade: the two would fight over the window.
    door.mark(0, 0);
    expect(calls.setReveal.at(-1)).toEqual([0, { mark: 0 }]);
    expect(await door.reveal({ duration: 1900 })).toBe(true);
    expect(calls.reveals).toEqual([{ duration: 1900 }]);

    door.destroy();
    expect(calls.destroyed).toBe(1);
    expect(device.destroyed).toBe(1);
    expect(container.querySelector("canvas")).toBeNull();
  });

  it("draws the glass on the main thread as the splash's own post, and lets it go with the door (FG-3b)", async () => {
    const warned = captureWarnings();
    const { module, calls } = fakeSplash();
    const glass = fakeGlass();
    const onGlass = vi.fn<(drawn: boolean) => void>();
    const { container, mark } = stage();
    const door = await openFieldDoor(
      container,
      mark,
      { reducedMotion: true, onGlass },
      {
        search: "?field=main",
        gpu: fakeGpu().gpu,
        splash: async () => module,
        glass: async () => glass.module,
      },
    );
    expect(door.mode).toBe("main");
    expect(calls.created).toEqual([expect.objectContaining({ post: glass.pass })]);

    // handed a glass, the pass takes it and the field draws a frame, its loop asleep under reduced motion
    door.glass(GLASS);
    expect(glass.calls.looks).toEqual([GLASS.look]);
    expect(glass.calls.poses).toEqual([GLASS.pose]);
    expect(calls.redrawn).toBe(1);
    glass.calls.hooks?.frame();
    expect(calls.redrawn).toBe(2);
    glass.calls.hooks?.drawn(true);
    expect(onGlass.mock.calls).toEqual([[true]]);
    glass.calls.hooks?.failed("WGSL failed");
    expect(warned).toEqual([["renderer.boot.field_glass", { message: "WGSL failed" }]]);
    door.glass(null);
    expect(glass.calls.looks).toEqual([GLASS.look, null]);

    door.destroy();
    expect(glass.calls.destroyed).toBe(1);
    expect(calls.destroyed).toBe(1);
    door.glass(GLASS);
    expect(glass.calls.looks).toHaveLength(2);
  });

  it("skips the worker for ?field=main", async () => {
    const make = vi.fn();
    const { module } = fakeSplash();
    const { container, mark } = stage();
    const door = await openFieldDoor(
      container,
      mark,
      { reducedMotion: false },
      { search: "?field=main", gpu: fakeGpu().gpu, worker: make, splash: async () => module },
    );
    expect(door.mode).toBe("main");
    expect(make).not.toHaveBeenCalled();
  });

  it("is the still, says why, when the main thread finds no adapter", async () => {
    const warned = captureWarnings();
    const { module, calls } = fakeSplash();
    const { container, mark } = stage();
    const door = await openFieldDoor(
      container,
      mark,
      { reducedMotion: false },
      { search: "?field=main", gpu: fakeGpu(false).gpu, splash: async () => module },
    );
    expect(door.mode).toBe("still");
    expect(door.reason).toBe("no-adapter");
    expect(calls.created).toEqual([]);
    expect(container.querySelector("canvas")).toBeNull();
    expect(warned).toEqual([]);
  });

  it("is the still, and logs it, when the splash fails to start — its device let go", async () => {
    const warned = captureWarnings();
    const { gpu, device } = fakeGpu();
    const { module } = fakeSplash(new Error("pipeline failed"));
    const { container, mark } = stage();
    const door = await openFieldDoor(
      container,
      mark,
      { reducedMotion: false },
      { search: "?field=main", gpu, splash: async () => module },
    );
    expect(door.mode).toBe("still");
    expect(door.reason).toBe("error");
    expect(device.destroyed).toBe(1);
    expect(container.querySelector("canvas")).toBeNull();
    expect(warned).toEqual([["renderer.boot.field_still", { message: "pipeline failed" }]]);
  });

  it("is the still when the splash's module can't be loaded", async () => {
    captureWarnings();
    const { container, mark } = stage();
    const door = await openFieldDoor(
      container,
      mark,
      { reducedMotion: false },
      {
        search: "?field=main",
        gpu: fakeGpu().gpu,
        splash: () => Promise.reject(new Error("chunk failed")),
      },
    );
    expect(door.mode).toBe("still");
    expect(door.reason).toBe("error");
    expect(container.querySelector("canvas")).toBeNull();
  });
});

describe("the tear's look (FG-2; the website's SPLASH and REVEAL_LOOK)", () => {
  it("opens over 1.9s, its mark gone in the first quarter, in the sun's warm white by day and the look's own light by night", () => {
    expect(TEAR).toEqual({ duration: 1900, markFade: 0.24, rim: 0.5, tear: 0.3 });
    expect(DAYLIGHT).toEqual([1, 0.955, 0.87]);
    expect(tearLook(false)).toEqual({ ...TEAR, ink: DAYLIGHT });
    // By night no ink at all: the splash keeps its own centre light (FG-D11 A).
    expect(tearLook(true)).toEqual(TEAR);
    expect("ink" in tearLook(true)).toBe(false);
  });
});

describe("the field's mark, faded by hand", () => {
  it("eases on CSS's own `ease`", () => {
    expect(ease(0)).toBe(0);
    expect(ease(1)).toBe(1);
    // cubic-bezier(0.25, 0.1, 0.25, 1), solved by bisection
    expect(ease(0.25)).toBeCloseTo(0.408511, 5);
    expect(ease(0.5)).toBeCloseTo(0.802403, 5);
    expect(ease(0.9)).toBeCloseTo(0.994316, 5);
  });

  it("fades over its time, frame by frame, with the window kept whole", () => {
    const frames: FrameRequestCallback[] = [];
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) =>
      frames.push(callback),
    );
    vi.stubGlobal("cancelAnimationFrame", () => {});
    vi.spyOn(performance, "now").mockReturnValue(1000);
    const calls: [number, unknown][] = [];
    const fade = markFade({ setReveal: (front, look) => void calls.push([front, look]) });

    fade.to(0, 400);
    expect(calls).toEqual([]);
    frames.shift()?.(1200);
    const [front, look] = calls.at(-1) ?? [];
    expect(front).toBe(0);
    expect((look as { mark: number }).mark).toBeCloseTo(1 - ease(0.5), 6);
    frames.shift()?.(1400);
    expect(calls.at(-1)).toEqual([0, { mark: 0 }]);
    expect(frames).toHaveLength(0);

    fade.to(1, 0);
    expect(calls.at(-1)).toEqual([0, { mark: 1 }]);
  });
});

/** The door's warnings, for this test (afterEach puts the quiet logger back). */
function captureWarnings(): [string, unknown][] {
  const warned: [string, unknown][] = [];
  const logger: RendererLogger = {
    child: () => logger,
    trace() {},
    debug() {},
    info() {},
    warn(event, _message, attrs) {
      warned.push([event, attrs]);
    },
    error() {},
    fatal() {},
    isLevelEnabled: () => true,
  };
  setRendererLogger(logger);
  return warned;
}
