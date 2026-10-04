// THE GODVIEW LAB'S MEASURES (MV-3c; build-mv M33) — the pure half of what the
// perf lab and the capture tool read, kept free of Electron so a unit test can
// hold it: a window's main-thread totals from two CDP samples, and the
// negative controls' spelling.

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

/** `view:2,root:1` → the probe's synthetic load (M33's negative controls). */
export function parseSynthetic(text: string | undefined): {
  viewRenderMs?: number;
  sideRootMs?: number;
} {
  const synthetic: { viewRenderMs?: number; sideRootMs?: number } = {};
  for (const part of (text ?? "").split(",")) {
    const [kind, value] = part.split(":").map((piece) => piece.trim());
    const ms = Number(value);
    if (!(Number.isFinite(ms) && ms > 0)) continue;
    if (kind === "view") synthetic.viewRenderMs = ms;
    if (kind === "root") synthetic.sideRootMs = ms;
  }
  return synthetic;
}
