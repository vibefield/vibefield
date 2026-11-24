// The development build's measure drain (History QA, 2026-11-24).
//
// React's development build draws its Performance-panel tracks by calling `performance.measure` for every
// component it re-renders, with a `detail` that carries a diff of the props that changed, and it never clears
// them (react-dom-client.development.js; its production build makes no such call). The browser keeps every
// user-timing entry until someone clears it, so a window that re-renders on a clock grows without end: the
// Vitals window, which redraws four lanes a second over a 300-sample model, rose about 20 MB a minute from the
// moment it opened (85 MB to 578 MB in 29 minutes, twice), and the desk under the History room passed 3 GB.
// Nothing of ours was kept. Only a development build does this, so only a development build drains it.
//
// The drain clears a measure once the timeline has delivered it. A recording in DevTools still shows React's
// tracks: the panel reads the trace, which has the entry from the moment it was made, never this buffer.
// VibeField's own timings are marks (`vf:renderer:*`), never measures, and are left alone.

// Its own shapes, not the DOM's: this file is typechecked by the shell's node program as well as the renderer's.
interface MeasureLike {
  readonly name: string;
  readonly detail?: unknown;
}
interface ObserverLike {
  observe(init: { type: string; buffered?: boolean }): void;
  disconnect(): void;
}
export interface MeasureDrainScope {
  readonly performance: { clearMeasures(name?: string): void };
  readonly PerformanceObserver?: new (
    callback: (list: { getEntries(): readonly MeasureLike[] }) => void,
  ) => ObserverLike;
}

/** A measure made for the Performance panel's custom tracks carries `detail.devtools` (the panel's
 * extensibility field). React tags every one of its own so. */
function isPanelTrack(entry: MeasureLike): boolean {
  const detail = entry.detail;
  return typeof detail === "object" && detail !== null && "devtools" in detail;
}

/** Clear each Performance-panel measure as the timeline delivers it. Returns the stop. */
export function drainPanelMeasures(
  scope: MeasureDrainScope = globalThis as unknown as MeasureDrainScope,
): () => void {
  const Observer = scope.PerformanceObserver;
  if (typeof Observer !== "function") return () => undefined;
  const observer = new Observer((list) => {
    const names = new Set<string>();
    for (const entry of list.getEntries()) if (isPanelTrack(entry)) names.add(entry.name);
    for (const name of names) scope.performance.clearMeasures(name);
  });
  // buffered: the ones made before this ran (the first mount's) go too
  observer.observe({ type: "measure", buffered: true });
  return () => observer.disconnect();
}
