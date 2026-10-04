// THE PROBE (MV-0, step 6): what a mounted view does, counted from inside the
// renderer — the per-view counters `design-mv.md` §5 asks for, under the same
// replay: renders and commits of the view subtree, the swarm's worker posts,
// canvas repaints (2D draw calls and WebGPU submits), DOM mutations under the
// stage, frame p50/p95 and long animation frames, change-to-pixel latency from
// a corpus mark to the first render / commit / mutation / draw / frame after it,
// and the JS heap.
//
// DORMANT. Nothing here runs unless `installGodviewPerfLab` was asked for by the
// renderer's URL (`godviewPerf=1`, set only by the Electron lab); the two
// product hooks that feed it (`instrumentedMonitorView` in GodviewMonitor, the
// post counter in swarm-physics-driver) read `activeProbe()` and do nothing on
// `null`. When on, it adds a rAF loop (the frame sampler, the same observer
// effect `frame-stats.ts` makes and declares), prototype wrappers on the canvas
// contexts, and one MutationObserver on the stage.
//
// React's production build never calls `Profiler.onRender`, so "renders" and
// "commits" are counted by a wrapper component the host mounts around the view
// ONLY while the probe is on (the view has no memo: the wrapper renders exactly
// when the view does).
//
// MV-3c (M32) — RAF WORK. An offscreen window pins frame p50 at its frame rate,
// so the frame intervals stop saying what a frame costs. The probe also times
// every animation-frame callback the page asks for (the views' draw loops, a
// replica's publication and the store render it queues — each callback with the
// microtasks it queued), per frame and in total; its own sampler is not counted.

export interface GodviewPerfMark {
  name: string;
  at: number;
  firstRenderAfter: number | null;
  firstCommitAfter: number | null;
  firstMutationAfter: number | null;
  firstDraw2dAfter: number | null;
  firstGpuAfter: number | null;
  nextFrameAfter: number | null;
}

export interface GodviewPerfReport {
  sinceMs: number;
  windowMs: number;
  frames: { count: number; p50: number; p95: number; max: number; fps: number };
  /** MV-3c — the page's animation-frame callbacks: their count, their summed
   * time, and that time per frame */
  raf: { callbacks: number; totalMs: number; perFrame: { p50: number; p95: number; max: number } };
  loaf: { observable: boolean; count: number; blockingMs: number; longestMs: number };
  renders: Record<string, number>;
  commits: Record<string, number>;
  posts: Record<string, number>;
  postsTotal: number;
  canvas2d: { calls: number; framesWithCalls: number };
  gpu: { submits: number; framesWithSubmits: number };
  dom: { mutations: number; childList: number; attributes: number; characterData: number };
  marks: GodviewPerfMark[];
  memory: { usedJSHeapSize: number | null; totalJSHeapSize: number | null };
}

export interface GodviewPerfProbe {
  reset(): void;
  report(): GodviewPerfReport;
  /** the replay door delivered a corpus mark */
  mark(name: string, at?: number): void;
  /** the counting wrapper rendered / committed the view */
  viewRender(viewId: string, at?: number): void;
  viewCommit(viewId: string, at?: number): void;
  /** the physics driver posted a command */
  workerPost(type: string): void;
  /** watch the stage's subtree; retried on rAF until the element exists */
  observeStage(selector: string): void;
  dispose(): void;
}

const now = (): number => performance.now();

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
  const renders = new Map<string, number>();
  const commits = new Map<string, number>();
  const posts = new Map<string, number>();
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

  const bump = (map: Map<string, number>, key: string): void => {
    map.set(key, (map.get(key) ?? 0) + 1);
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
      renders.clear();
      commits.clear();
      posts.clear();
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
        },
        renders: Object.fromEntries(renders),
        commits: Object.fromEntries(commits),
        posts: Object.fromEntries(posts),
        postsTotal: [...posts.values()].reduce((total, count) => total + count, 0),
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
      };
    },
    mark(name, at = now()) {
      marks.push({
        name,
        at,
        firstRenderAfter: null,
        firstCommitAfter: null,
        firstMutationAfter: null,
        firstDraw2dAfter: null,
        firstGpuAfter: null,
        nextFrameAfter: null,
      });
    },
    viewRender(viewId, at = now()) {
      bump(renders, viewId);
      settle("firstRenderAfter", at);
    },
    viewCommit(viewId, at = now()) {
      bump(commits, viewId);
      settle("firstCommitAfter", at);
    },
    workerPost(type) {
      bump(posts, type);
    },
    observeStage,
    dispose() {
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
