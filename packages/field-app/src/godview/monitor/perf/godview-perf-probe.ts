// THE GODVIEW LAB PROBE. Installed only for `godviewPerf=1`: frame intervals,
// animation-frame callback work, long animation frames, stage mutations,
// canvas draws, heap usage and every React root's commits/render time.
// The SDK view has its own root; react-roots.ts reads the lab's DevTools hook
// so the gate includes it. Chromium task totals come from the lab's CDP samples.
// The synthetic side root proves the totals include work outside the host root.
// MV-8 retires the legacy view wrapper and its render/commit/worker counters.
// Old report files remain readable by the paired harness; an absent counter is
// unknown, never a manufactured zero.

import { type ReactRootsReport, reactRootsBase, reactRootsSince } from "./react-roots";

/** MV-3c (M33) — the negative controls; zero is off. */
export interface GodviewPerfSynthetic {
  /** a side React root that commits once per frame with this much render work */
  sideRootMs?: number;
}

export interface GodviewPerfMark {
  name: string;
  at: number;
  firstMutationAfter: number | null;
  firstDraw2dAfter: number | null;
  firstGpuAfter: number | null;
  nextFrameAfter: number | null;
}

/** One script a long animation frame ran (`PerformanceScriptTiming`): who called it, where it
 * lives, and how long it ran, forced style and layout included. */
export interface GodviewPerfLoafScript {
  invoker: string;
  invokerType: string;
  sourceURL: string;
  sourceFunctionName: string;
  sourceCharPosition: number;
  startTime: number;
  duration: number;
  forcedStyleAndLayoutDuration: number;
}

/** MV-8b — one long animation frame with its attribution. Times are on the probe's own clock
 * (`performance.now()`, the report's `sinceMs` timebase): rendering began at `renderStart` and
 * style and layout at `styleAndLayoutStart` (0 when the frame rendered nothing). */
export interface GodviewPerfLoafEntry {
  startTime: number;
  duration: number;
  blockingDuration: number;
  renderStart: number;
  styleAndLayoutStart: number;
  scripts: GodviewPerfLoafScript[];
}

/** How many of the window's longest frames a report keeps, with their attribution. */
export const LOAF_KEPT = 5;
/** A frame this long or longer is counted in `over100Ms` (M177's long frames). */
export const LOAF_LONG_MS = 100;

export interface GodviewPerfReport {
  sinceMs: number;
  windowMs: number;
  frames: { count: number; p50: number; p95: number; max: number; fps: number };
  /** MV-3c — the page's animation-frame callbacks: their count, their summed
   * time, and that time per frame */
  raf: { callbacks: number; totalMs: number; perFrame: { p50: number; p95: number; max: number } };
  /** Long animation frames (≥ 50 ms, the browser's own cut): how many, their blocking, the
   * longest; MV-8b — how many ran 100 ms or more, and the five longest with attribution,
   * longest first. */
  loaf: {
    observable: boolean;
    count: number;
    blockingMs: number;
    longestMs: number;
    over100Ms: number;
    longest: GodviewPerfLoafEntry[];
  };
  canvas2d: { calls: number; framesWithCalls: number };
  gpu: { submits: number; framesWithSubmits: number };
  dom: { mutations: number; childList: number; attributes: number; characterData: number };
  marks: GodviewPerfMark[];
  memory: { usedJSHeapSize: number | null; totalJSHeapSize: number | null };
  /** MV-3c (M33) — every React root's commits and render time in the window */
  react: ReactRootsReport;
  /** MV-3c (M33) — the synthetic load standing during the window */
  synthetic: GodviewPerfSynthetic;
}

export interface GodviewPerfProbe {
  reset(): void;
  report(): GodviewPerfReport;
  /** the model replay delivered a corpus mark */
  mark(name: string, at?: number): void;
  /** watch the stage's subtree; retried on rAF until the element exists */
  observeStage(selector: string): void;
  /** MV-3c (M33) — set the negative controls (`{}` turns them off) */
  setSynthetic(synthetic: GodviewPerfSynthetic): Promise<GodviewPerfSynthetic>;
  dispose(): void;
}

const now = (): number => performance.now();

function busyWait(ms: number): void {
  const until = now() + ms;
  while (now() < until) {
    // the synthetic load is the wait itself
  }
}

const numberOf = (value: unknown): number => (typeof value === "number" ? value : 0);
const textOf = (value: unknown): string => (typeof value === "string" ? value : "");

/** A long animation frame entry as the report keeps it: only what attributes its time. */
function loafEntry(entry: PerformanceEntry): GodviewPerfLoafEntry {
  const frame = entry as PerformanceEntry & Record<string, unknown>;
  const scripts = Array.isArray(frame["scripts"]) ? (frame["scripts"] as unknown[]) : [];
  return {
    startTime: entry.startTime,
    duration: entry.duration,
    blockingDuration: numberOf(frame["blockingDuration"]),
    renderStart: numberOf(frame["renderStart"]),
    styleAndLayoutStart: numberOf(frame["styleAndLayoutStart"]),
    scripts: scripts.map((script) => {
      const held = script as Record<string, unknown>;
      return {
        invoker: textOf(held["invoker"]),
        invokerType: textOf(held["invokerType"]),
        sourceURL: textOf(held["sourceURL"]),
        sourceFunctionName: textOf(held["sourceFunctionName"]),
        sourceCharPosition: numberOf(held["sourceCharPosition"]),
        startTime: numberOf(held["startTime"]),
        duration: numberOf(held["duration"]),
        forcedStyleAndLayoutDuration: numberOf(held["forcedStyleAndLayoutDuration"]),
      };
    }),
  };
}

function quantile(sorted: readonly number[], q: number): number {
  if (sorted.length === 0) return 0;
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * q) - 1))] ?? 0;
}

const DRAW_METHODS = [
  "clearRect",
  "fillRect",
  "strokeRect",
  "fill",
  "stroke",
  "fillText",
  "strokeText",
  "drawImage",
  "putImageData",
] as const;

let probe: GodviewPerfProbe | null = null;

/** The side root (M33's total-work control): its own container and `createRoot`,
 * so its commits are a root the view host's root does not contain. Reached by
 * dynamic import: the probe module stays free of react-dom until asked. */
async function mountSideRoot(
  workMs: () => number,
): Promise<{ render(tick: number): void; unmount(): void }> {
  const [{ createElement }, { createRoot }] = await Promise.all([
    import("react"),
    import("react-dom/client"),
  ]);
  const container = document.createElement("div");
  container.className = "vf-perf-side-root";
  container.hidden = true;
  document.body.append(container);
  const root = createRoot(container);
  function SideRootLoad(props: { tick: number }) {
    busyWait(workMs());
    return createElement("span", null, props.tick);
  }
  return {
    render: (tick) => root.render(createElement(SideRootLoad, { tick })),
    unmount: () => {
      root.unmount();
      container.remove();
    },
  };
}

/** The probe, when the lab installed one; the product's hooks read this. */
export function activeProbe(): GodviewPerfProbe | null {
  return probe;
}

export function installGodviewPerfProbe(): GodviewPerfProbe {
  if (probe !== null) return probe;

  let since = now();
  let frameTimes: number[] = [];
  let lastFrameAt: number | null = null;
  let intervals: number[] = [];
  let loafCount = 0;
  let loafBlockingMs = 0;
  let loafLongestMs = 0;
  let loafOver100 = 0;
  /** the window's longest frames so far, longest first, at most LOAF_KEPT */
  let loafLongest: GodviewPerfLoafEntry[] = [];
  let draw2dCalls = 0;
  let draw2dThisFrame = false;
  let framesWithDraw2d = 0;
  let gpuSubmits = 0;
  let gpuThisFrame = false;
  let framesWithGpu = 0;
  let mutations = { total: 0, childList: 0, attributes: 0, characterData: 0 };
  const marks: GodviewPerfMark[] = [];
  let rafCallbacks = 0;
  let rafTotalMs = 0;
  let rafThisFrame = 0;
  let rafFrames: number[] = [];
  let reactBase = reactRootsBase();
  let synthetic: GodviewPerfSynthetic = {};
  let sideRoot: { render(tick: number): void; unmount(): void } | null = null;
  let sideTick = 0;

  /** Each event settles the "first X after" of every mark still waiting for it. */
  const settle = (key: keyof Omit<GodviewPerfMark, "name" | "at">, at: number): void => {
    for (const mark of marks) {
      if (mark[key] === null && at >= mark.at) mark[key] = at;
    }
  };

  // ── the page's animation-frame callbacks, timed (MV-3c) ─────────────────────
  // the probe's own loops keep the page's original; everyone else's callback is
  // timed with the microtasks it queued (they run first-in first-out, ahead of
  // the one that reads the clock)
  const nativeRaf = globalThis.requestAnimationFrame;
  const originalRaf = nativeRaf.bind(globalThis);
  const originalCancel = globalThis.cancelAnimationFrame.bind(globalThis);
  const timedRaf = (callback: FrameRequestCallback): number =>
    originalRaf((at) => {
      const begun = now();
      try {
        callback(at);
      } finally {
        queueMicrotask(() => {
          const spent = now() - begun;
          rafCallbacks += 1;
          rafTotalMs += spent;
          rafThisFrame += spent;
        });
      }
    });
  globalThis.requestAnimationFrame = timedRaf;

  // ── the frame sampler (rAF) ───────────────────────────────────────────────
  let raf = 0;
  const tick = (at: number): void => {
    if (lastFrameAt !== null) intervals.push(at - lastFrameAt);
    lastFrameAt = at;
    frameTimes.push(at);
    rafFrames.push(rafThisFrame);
    rafThisFrame = 0;
    if (sideRoot !== null) {
      sideTick += 1;
      sideRoot.render(sideTick);
    }
    if (draw2dThisFrame) framesWithDraw2d += 1;
    if (gpuThisFrame) framesWithGpu += 1;
    draw2dThisFrame = false;
    gpuThisFrame = false;
    settle("nextFrameAfter", at);
    raf = originalRaf(tick);
  };
  raf = originalRaf(tick);

  // ── long animation frames ─────────────────────────────────────────────────
  let loaf: PerformanceObserver | null = null;
  const observable =
    typeof PerformanceObserver !== "undefined" &&
    (PerformanceObserver.supportedEntryTypes ?? []).includes("long-animation-frame");
  if (observable) {
    loaf = new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        loafCount += 1;
        const blocking = (entry as PerformanceEntry & { blockingDuration?: number })
          .blockingDuration;
        loafBlockingMs += typeof blocking === "number" ? blocking : 0;
        loafLongestMs = Math.max(loafLongestMs, entry.duration);
        if (entry.duration >= LOAF_LONG_MS) loafOver100 += 1;
        // keep the longest few with what attributes them; the rest stay counts
        const kept = loafLongest.at(-1);
        if (
          loafLongest.length < LOAF_KEPT ||
          (kept !== undefined && entry.duration > kept.duration)
        ) {
          loafLongest = [...loafLongest, loafEntry(entry)]
            .sort((a, b) => b.duration - a.duration)
            .slice(0, LOAF_KEPT);
        }
      }
    });
    loaf.observe({ type: "long-animation-frame", buffered: false });
  }

  // ── canvas spies: 2D draw calls and WebGPU submits ────────────────────────
  const restores: (() => void)[] = [];
  const context2d = (globalThis as { CanvasRenderingContext2D?: { prototype: object } })
    .CanvasRenderingContext2D;
  if (context2d !== undefined) {
    const proto = context2d.prototype as Record<string, unknown>;
    for (const method of DRAW_METHODS) {
      const original = proto[method];
      if (typeof original !== "function") continue;
      proto[method] = function wrapped(this: unknown, ...args: unknown[]) {
        draw2dCalls += 1;
        draw2dThisFrame = true;
        settle("firstDraw2dAfter", now());
        return (original as (...a: unknown[]) => unknown).apply(this, args);
      };
      restores.push(() => {
        proto[method] = original;
      });
    }
  }
  const gpuQueue = (globalThis as { GPUQueue?: { prototype: object } }).GPUQueue;
  if (gpuQueue !== undefined) {
    const proto = gpuQueue.prototype as Record<string, unknown>;
    const original = proto["submit"];
    if (typeof original === "function") {
      proto["submit"] = function wrapped(this: unknown, ...args: unknown[]) {
        gpuSubmits += 1;
        gpuThisFrame = true;
        settle("firstGpuAfter", now());
        return (original as (...a: unknown[]) => unknown).apply(this, args);
      };
      restores.push(() => {
        proto["submit"] = original;
      });
    }
  }

  // ── the stage's DOM ───────────────────────────────────────────────────────
  let observer: MutationObserver | null = null;
  let stageWatch = 0;
  const observeStage = (selector: string): void => {
    observer?.disconnect();
    observer = null;
    originalCancel(stageWatch);
    const attach = (): void => {
      const stage = document.querySelector(selector);
      if (stage === null) {
        stageWatch = originalRaf(attach);
        return;
      }
      observer = new MutationObserver((records) => {
        const at = now();
        for (const record of records) {
          mutations.total += 1;
          if (record.type === "childList") mutations.childList += 1;
          else if (record.type === "attributes") mutations.attributes += 1;
          else mutations.characterData += 1;
        }
        if (records.length > 0) settle("firstMutationAfter", at);
      });
      observer.observe(stage, {
        subtree: true,
        childList: true,
        attributes: true,
        characterData: true,
      });
    };
    attach();
  };

  probe = {
    reset() {
      since = now();
      frameTimes = [];
      intervals = [];
      lastFrameAt = null;
      loafCount = 0;
      loafBlockingMs = 0;
      loafLongestMs = 0;
      loafOver100 = 0;
      loafLongest = [];
      draw2dCalls = 0;
      draw2dThisFrame = false;
      framesWithDraw2d = 0;
      gpuSubmits = 0;
      gpuThisFrame = false;
      framesWithGpu = 0;
      mutations = { total: 0, childList: 0, attributes: 0, characterData: 0 };
      marks.length = 0;
      rafCallbacks = 0;
      rafTotalMs = 0;
      rafThisFrame = 0;
      rafFrames = [];
      reactBase = reactRootsBase();
    },
    report() {
      const sorted = [...intervals].sort((a, b) => a - b);
      const rafSorted = [...rafFrames].sort((a, b) => a - b);
      const windowMs = now() - since;
      const memory = (
        performance as Performance & {
          memory?: { usedJSHeapSize: number; totalJSHeapSize: number };
        }
      ).memory;
      return {
        sinceMs: since,
        windowMs,
        frames: {
          count: frameTimes.length,
          p50: quantile(sorted, 0.5),
          p95: quantile(sorted, 0.95),
          max: sorted.at(-1) ?? 0,
          fps: windowMs > 0 ? (frameTimes.length * 1_000) / windowMs : 0,
        },
        raf: {
          callbacks: rafCallbacks,
          totalMs: rafTotalMs,
          perFrame: {
            p50: quantile(rafSorted, 0.5),
            p95: quantile(rafSorted, 0.95),
            max: rafSorted.at(-1) ?? 0,
          },
        },
        loaf: {
          observable,
          count: loafCount,
          blockingMs: loafBlockingMs,
          longestMs: loafLongestMs,
          over100Ms: loafOver100,
          longest: loafLongest.map((entry) => ({
            ...entry,
            scripts: entry.scripts.map((script) => ({ ...script })),
          })),
        },
        canvas2d: { calls: draw2dCalls, framesWithCalls: framesWithDraw2d },
        gpu: { submits: gpuSubmits, framesWithSubmits: framesWithGpu },
        dom: {
          mutations: mutations.total,
          childList: mutations.childList,
          attributes: mutations.attributes,
          characterData: mutations.characterData,
        },
        marks: marks.map((mark) => ({ ...mark })),
        memory: {
          usedJSHeapSize: memory?.usedJSHeapSize ?? null,
          totalJSHeapSize: memory?.totalJSHeapSize ?? null,
        },
        react: reactRootsSince(reactBase),
        synthetic: { ...synthetic },
      };
    },
    mark(name, at = now()) {
      marks.push({
        name,
        at,
        firstMutationAfter: null,
        firstDraw2dAfter: null,
        firstGpuAfter: null,
        nextFrameAfter: null,
      });
    },
    observeStage,
    async setSynthetic(next) {
      synthetic = { ...next };
      const sideMs = synthetic.sideRootMs ?? 0;
      if (sideMs <= 0) {
        sideRoot?.unmount();
        sideRoot = null;
      } else if (sideRoot === null) {
        sideRoot = await mountSideRoot(() => synthetic.sideRootMs ?? 0);
      }
      return { ...synthetic };
    },
    dispose() {
      sideRoot?.unmount();
      sideRoot = null;
      originalCancel(raf);
      originalCancel(stageWatch);
      if (globalThis.requestAnimationFrame === timedRaf)
        globalThis.requestAnimationFrame = nativeRaf;
      loaf?.disconnect();
      observer?.disconnect();
      for (const restore of restores) restore();
      probe = null;
    },
  };
  return probe;
}
