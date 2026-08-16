const MAX_SOAK_SAMPLES = 100_000;

export const LIVE_SURFACE_FOUNDATION_FAULT_MATRIX = [
  {
    id: "browser-producer-exit",
    plane: "producer",
    expected: "bounded epoch restart with no stale target or frame resurrection",
  },
  {
    id: "helper-exit-with-leases",
    plane: "helper",
    expected: "all leases release or quarantine before a replacement session becomes reusable",
  },
  {
    id: "renderer-reload-with-frame",
    plane: "renderer",
    expected: "old generation drains while a new generation receives fresh authority",
  },
  {
    id: "webgpu-device-loss",
    plane: "renderer",
    expected: "presentation texture is recreated without restarting a healthy producer",
  },
  {
    id: "source-geometry-change",
    plane: "producer",
    expected: "geometry and crop change atomically after a stable source observation",
  },
  {
    id: "stale-epoch-callback",
    plane: "transport",
    expected: "retired callbacks release ownership and cannot mutate current state",
  },
  {
    id: "texture-transfer-timeout",
    plane: "transport",
    expected: "bounded drain quarantines the native slot instead of reusing it",
  },
  {
    id: "control-target-loss",
    plane: "control",
    expected: "the private binding revokes without interrupting independent pixels",
  },
] as const;

export type LiveSurfaceFoundationFaultId =
  (typeof LIVE_SURFACE_FOUNDATION_FAULT_MATRIX)[number]["id"];
export type LiveSurfaceFaultPlane = (typeof LIVE_SURFACE_FOUNDATION_FAULT_MATRIX)[number]["plane"];

export interface LiveSurfaceSoakMetricSample {
  /** Maximum for any one surface at this sample. */
  readonly rendererPendingPerSurface: number;
  /** Maximum for any one surface at this sample. */
  readonly rendererInFlightPerSurface: number;
  /** Maximum shared transfers for any one surface at this sample. */
  readonly mainOutstandingTransfersPerSurface: number;
  /** Maximum helper leases for any one capture session at this sample. */
  readonly helperOutstandingLeasesPerSession: number;
  readonly worstActiveFrameAgeMs: number;
  readonly electronMainDutyRatio: number;
  readonly sharedTextureImportMs?: number;
  /** Delta since the preceding sample, not a cumulative process counter. */
  readonly primaryCpuPixelConversionsSincePreviousSample: number;
  readonly unreconciledReusableLeases: number;
}

export interface LiveSurfaceSoakMetricAggregate {
  readonly sampleCount: number;
  readonly rendererPendingPerSurfaceMax: number;
  readonly rendererInFlightPerSurfaceMax: number;
  readonly mainOutstandingTransfersPerSurfaceMax: number;
  readonly helperOutstandingLeasesPerSessionMax: number;
  readonly worstActiveFrameAgeP95Ms: number;
  readonly electronMainDutyRatioMax: number;
  readonly sharedTextureImportP95Ms: number | null;
  readonly primaryCpuPixelConversions: number;
  readonly unreconciledReusableLeasesMax: number;
}

export interface LiveSurfaceSoakBudgets {
  readonly rendererPendingPerSurfaceMax: number;
  readonly rendererInFlightPerSurfaceMax: number;
  readonly mainOutstandingTransfersPerSurfaceMax: number;
  readonly helperOutstandingLeasesPerSessionMax: number;
  readonly worstActiveFrameAgeP95Ms: number;
  readonly electronMainDutyRatioMax: number;
  readonly sharedTextureImportP95Ms: number;
  readonly primaryCpuPixelConversions: number;
  readonly unreconciledReusableLeasesMax: number;
}

export const LIVE_SURFACE_FOUNDATION_SOAK_BUDGETS: LiveSurfaceSoakBudgets = {
  rendererPendingPerSurfaceMax: 1,
  rendererInFlightPerSurfaceMax: 1,
  mainOutstandingTransfersPerSurfaceMax: 2,
  helperOutstandingLeasesPerSessionMax: 2,
  worstActiveFrameAgeP95Ms: 50,
  electronMainDutyRatioMax: 0.1,
  sharedTextureImportP95Ms: 0.3,
  primaryCpuPixelConversions: 0,
  unreconciledReusableLeasesMax: 0,
};

function finiteNonNegative(value: number, name: string): number {
  if (!Number.isFinite(value) || value < 0) {
    throw new RangeError(`${name} must be finite and non-negative`);
  }
  return value;
}

function nonNegativeSafeInteger(value: number, name: string): number {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new RangeError(`${name} must be a non-negative safe integer`);
  }
  return value;
}

function percentile95(values: readonly number[]): number {
  if (values.length === 0) return 0;
  const ordered = [...values].sort((left, right) => left - right);
  return ordered[Math.max(0, Math.ceil(ordered.length * 0.95) - 1)] ?? 0;
}

export function aggregateLiveSurfaceSoakMetrics(
  samples: readonly LiveSurfaceSoakMetricSample[],
): LiveSurfaceSoakMetricAggregate {
  if (samples.length === 0 || samples.length > MAX_SOAK_SAMPLES) {
    throw new RangeError(`soak metrics require between 1 and ${MAX_SOAK_SAMPLES} samples`);
  }
  const normalized = samples.map((sample) => ({
    rendererPendingPerSurface: nonNegativeSafeInteger(
      sample.rendererPendingPerSurface,
      "rendererPendingPerSurface",
    ),
    rendererInFlightPerSurface: nonNegativeSafeInteger(
      sample.rendererInFlightPerSurface,
      "rendererInFlightPerSurface",
    ),
    mainOutstandingTransfersPerSurface: nonNegativeSafeInteger(
      sample.mainOutstandingTransfersPerSurface,
      "mainOutstandingTransfersPerSurface",
    ),
    helperOutstandingLeasesPerSession: nonNegativeSafeInteger(
      sample.helperOutstandingLeasesPerSession,
      "helperOutstandingLeasesPerSession",
    ),
    worstActiveFrameAgeMs: finiteNonNegative(sample.worstActiveFrameAgeMs, "worstActiveFrameAgeMs"),
    electronMainDutyRatio: finiteNonNegative(sample.electronMainDutyRatio, "electronMainDutyRatio"),
    sharedTextureImportMs:
      sample.sharedTextureImportMs === undefined
        ? undefined
        : finiteNonNegative(sample.sharedTextureImportMs, "sharedTextureImportMs"),
    primaryCpuPixelConversionsSincePreviousSample: nonNegativeSafeInteger(
      sample.primaryCpuPixelConversionsSincePreviousSample,
      "primaryCpuPixelConversionsSincePreviousSample",
    ),
    unreconciledReusableLeases: nonNegativeSafeInteger(
      sample.unreconciledReusableLeases,
      "unreconciledReusableLeases",
    ),
  }));
  const maximum = (select: (sample: (typeof normalized)[number]) => number): number =>
    Math.max(...normalized.map(select));
  const imports = normalized.flatMap((sample) =>
    sample.sharedTextureImportMs === undefined ? [] : [sample.sharedTextureImportMs],
  );
  return {
    sampleCount: normalized.length,
    rendererPendingPerSurfaceMax: maximum((sample) => sample.rendererPendingPerSurface),
    rendererInFlightPerSurfaceMax: maximum((sample) => sample.rendererInFlightPerSurface),
    mainOutstandingTransfersPerSurfaceMax: maximum(
      (sample) => sample.mainOutstandingTransfersPerSurface,
    ),
    helperOutstandingLeasesPerSessionMax: maximum(
      (sample) => sample.helperOutstandingLeasesPerSession,
    ),
    worstActiveFrameAgeP95Ms: percentile95(
      normalized.map((sample) => sample.worstActiveFrameAgeMs),
    ),
    electronMainDutyRatioMax: maximum((sample) => sample.electronMainDutyRatio),
    sharedTextureImportP95Ms: imports.length === 0 ? null : percentile95(imports),
    primaryCpuPixelConversions: normalized.reduce(
      (total, sample) =>
        nonNegativeSafeInteger(
          total + sample.primaryCpuPixelConversionsSincePreviousSample,
          "aggregate primaryCpuPixelConversions",
        ),
      0,
    ),
    unreconciledReusableLeasesMax: maximum((sample) => sample.unreconciledReusableLeases),
  };
}

export function evaluateLiveSurfaceSoakBudgets(
  metrics: LiveSurfaceSoakMetricAggregate,
  budgets: LiveSurfaceSoakBudgets = LIVE_SURFACE_FOUNDATION_SOAK_BUDGETS,
): readonly string[] {
  const failures: string[] = [];
  const gate = (name: string, actual: number, maximum: number): void => {
    if (actual > maximum) failures.push(`${name}: ${actual} > ${maximum}`);
  };
  gate(
    "renderer pending per surface",
    metrics.rendererPendingPerSurfaceMax,
    budgets.rendererPendingPerSurfaceMax,
  );
  gate(
    "renderer in-flight per surface",
    metrics.rendererInFlightPerSurfaceMax,
    budgets.rendererInFlightPerSurfaceMax,
  );
  gate(
    "main outstanding transfers per surface",
    metrics.mainOutstandingTransfersPerSurfaceMax,
    budgets.mainOutstandingTransfersPerSurfaceMax,
  );
  gate(
    "helper outstanding leases per session",
    metrics.helperOutstandingLeasesPerSessionMax,
    budgets.helperOutstandingLeasesPerSessionMax,
  );
  gate(
    "active frame age p95 ms",
    metrics.worstActiveFrameAgeP95Ms,
    budgets.worstActiveFrameAgeP95Ms,
  );
  gate(
    "Electron main duty ratio",
    metrics.electronMainDutyRatioMax,
    budgets.electronMainDutyRatioMax,
  );
  if (metrics.sharedTextureImportP95Ms !== null) {
    gate(
      "shared-texture import p95 ms",
      metrics.sharedTextureImportP95Ms,
      budgets.sharedTextureImportP95Ms,
    );
  }
  gate(
    "primary CPU pixel conversions",
    metrics.primaryCpuPixelConversions,
    budgets.primaryCpuPixelConversions,
  );
  gate(
    "unreconciled reusable leases",
    metrics.unreconciledReusableLeasesMax,
    budgets.unreconciledReusableLeasesMax,
  );
  return failures;
}
