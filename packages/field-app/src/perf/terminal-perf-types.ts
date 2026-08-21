// The shape ghosttea's render worker reports, restated locally.
//
// It is a copy of `@vibecook/ghosttea-react`'s `TerminalRenderPerformanceSnapshot`
// (`dist/performance.d.ts`), and it is a copy on purpose: `perf/` is reached from
// the sampler, the readout and the tests, and none of them should have to import
// the ghosttea package to talk about a number. `terminal-perf.test.ts` pins the
// two against each other structurally, so a field the upstream adds or renames
// fails a gate here rather than silently reading `undefined` in a lane.
//
// EL-adjacent, worth being explicit about: this is NOT a wire contract, so it
// does not belong in `@vibefield/contracts`. It is the shape of an upstream
// library's return value, consumed in one process.

export interface TerminalRenderPerformanceSnapshot {
  readonly backend: string;
  readonly durationMs: number;
  /** True when the window closed on its deadline instead of on idle — which is
   * the NORMAL outcome under a flood and must never be read as an error. Every
   * number in a timed-out snapshot describes a still-busy renderer. */
  readonly timedOutWaitingForIdle: boolean;
  /** Milliseconds `renderer.settle()` took — a GPU DRAIN BARRIER the finish
   * always runs (worker `finishPerformanceMeasurement`). It is the observer
   * effect of taking a measurement at all, which is why no mode below `metrics`
   * may take one. */
  readonly gpuQueueDrainMs: number | null;
  readonly frames: {
    readonly received: number;
    readonly bytes: number;
    readonly full: number;
    readonly incremental: number;
    readonly stale: number;
    readonly resyncRequested: number;
    readonly rowsDecoded: number;
    readonly glyphDefinitions: number;
  };
  readonly scheduling: {
    readonly flushes: number;
    readonly renderCalls: number;
    readonly maximumDirtyPanes: number;
    readonly panesPerFlush: readonly number[];
  };
  readonly renderer: {
    readonly queueSubmits: number;
    readonly fullRenders: number;
    readonly partialRenders: number;
    readonly damagedRows: number;
    readonly geometryCacheHits: number;
    readonly geometryCacheMisses: number;
    readonly canvasPixelFrames: number;
    readonly renderPasses: number;
    readonly drawCalls: number;
    readonly rectangleVertices: number;
    readonly monoGlyphVertices: number;
    readonly colorGlyphVertices: number;
    readonly fallbackGlyphVertices: number;
    readonly vertexUploadBytes: number;
    readonly atlasUploadBytes: number;
    readonly atlasUploadCalls: number;
  };
  /** Bounded at 100,000 entries each (`MAX_PERFORMANCE_SAMPLES`, worker line
   * 2706). A window that fills one describes its FIRST 100k frames and then
   * stops recording, so a long flood's histogram is of the run's opening. */
  readonly samples: {
    readonly frameApplyMs: readonly number[];
    readonly renderCpuMs: readonly number[];
    readonly dirtyToRenderMs: readonly number[];
    readonly frameArrivalToRenderMs: readonly number[];
  };
}
