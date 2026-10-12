// THE GODVIEW LAB'S MEASURES (MV-3c; build-mv M33) — the pure half of what the
// perf lab and the capture tool read, kept free of Electron so a unit test can
// hold it: a window's main-thread totals from two CDP samples, the heap row's
// reading, and the negative controls' spelling.

/** Chromium's cumulative main-thread totals at one instant, in seconds. */
export interface PageMetrics {
  at: number;
  task: number;
  script: number;
  layout: number;
  recalcStyle: number;
}

/** A window's totals per second of it, in ms (M33). */
export interface MetricTotals {
  seconds: number;
  taskMsPerS: number;
  scriptMsPerS: number;
  layoutMsPerS: number;
  recalcStyleMsPerS: number;
}

export function metricTotals(
  start: PageMetrics | null,
  end: PageMetrics | null,
): MetricTotals | null {
  if (start === null || end === null || !(end.at > start.at)) return null;
  const seconds = end.at - start.at;
  const perSecond = (from: number, to: number): number => ((to - from) * 1_000) / seconds;
  return {
    seconds,
    taskMsPerS: perSecond(start.task, end.task),
    scriptMsPerS: perSecond(start.script, end.script),
    layoutMsPerS: perSecond(start.layout, end.layout),
    recalcStyleMsPerS: perSecond(start.recalcStyle, end.recalcStyle),
  };
}

/** The page's `performance.memory`, as far as the lab reads it. */
export interface HeapSample {
  usedJSHeapSize: number | null;
  totalJSHeapSize: number | null;
}

/** A cell's JS heap as the lab reports it: the paired runner's "js heap MB". */
export interface LabHeap extends HeapSample {
  /** read after a forced collection, not at whatever phase the collector was in */
  collected: boolean;
}

/**
 * The heap row's reading (MV lab debts). `collected` is the page's heap after
 * a forced collection, or null when none could be forced or the page did not
 * answer after it; the row then keeps the probe's own reading from the cell's
 * report (`report.memory`, what the row was until 2026-10-11) and says it is
 * uncollected. Never a reason to fail a launch.
 */
export function labHeap(probe: unknown, collected: HeapSample | null): LabHeap {
  const bytes = (value: unknown): number | null =>
    typeof value === "number" && Number.isFinite(value) ? value : null;
  const from = (collected ?? probe ?? {}) as Partial<Record<keyof HeapSample, unknown>>;
  return {
    collected: collected !== null,
    usedJSHeapSize: bytes(from.usedJSHeapSize),
    totalJSHeapSize: bytes(from.totalJSHeapSize),
  };
}

/** `root:2` → a side React root with 2 ms of render work per frame (M33). */
export function parseSynthetic(text: string | undefined): { sideRootMs?: number } {
  const synthetic: { sideRootMs?: number } = {};
  for (const part of (text ?? "").split(",")) {
    if (part.trim() === "") continue;
    const [kind, value, extra] = part.split(":").map((piece) => piece.trim());
    if (kind === "view") {
      throw new Error("The legacy view-render control is retired; use root:<ms> with SDK views");
    }
    const ms = Number(value);
    if (kind !== "root" || extra !== undefined || !(Number.isFinite(ms) && ms > 0)) {
      throw new Error(
        `Invalid synthetic load ${JSON.stringify(part)}; expected root:<positive ms>`,
      );
    }
    synthetic.sideRootMs = ms;
  }
  return synthetic;
}
