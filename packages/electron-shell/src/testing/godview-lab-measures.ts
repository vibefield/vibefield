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
