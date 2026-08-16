import { describe, expect, it } from "vitest";
import {
  aggregateLiveSurfaceSoakMetrics,
  evaluateLiveSurfaceSoakBudgets,
  LIVE_SURFACE_FOUNDATION_FAULT_MATRIX,
  type LiveSurfaceSoakMetricSample,
} from "../src/testing";

function metricSample(
  overrides: Partial<LiveSurfaceSoakMetricSample> = {},
): LiveSurfaceSoakMetricSample {
  return {
    rendererPendingPerSurface: 1,
    rendererInFlightPerSurface: 1,
    mainOutstandingTransfersPerSurface: 2,
    helperOutstandingLeasesPerSession: 2,
    worstActiveFrameAgeMs: 25,
    electronMainDutyRatio: 0.08,
    sharedTextureImportMs: 0.2,
    primaryCpuPixelConversionsSincePreviousSample: 0,
    unreconciledReusableLeases: 0,
    ...overrides,
  };
}

describe("Live Surface hardening harness", () => {
  it("publishes one unique, plane-classified canonical fault matrix", () => {
    expect(new Set(LIVE_SURFACE_FOUNDATION_FAULT_MATRIX.map((fault) => fault.id)).size).toBe(
      LIVE_SURFACE_FOUNDATION_FAULT_MATRIX.length,
    );
    expect(LIVE_SURFACE_FOUNDATION_FAULT_MATRIX).toContainEqual({
      id: "helper-exit-with-leases",
      plane: "helper",
      expected: "all leases release or quarantine before a replacement session becomes reusable",
    });
  });

  it("aggregates percentile/max/delta metrics and reports exact budget failures", () => {
    const aggregate = aggregateLiveSurfaceSoakMetrics([
      metricSample({ worstActiveFrameAgeMs: 10, primaryCpuPixelConversionsSincePreviousSample: 0 }),
      metricSample({ worstActiveFrameAgeMs: 20, primaryCpuPixelConversionsSincePreviousSample: 1 }),
      metricSample({ worstActiveFrameAgeMs: 60, sharedTextureImportMs: 0.4 }),
    ]);
    expect(aggregate).toEqual({
      sampleCount: 3,
      rendererPendingPerSurfaceMax: 1,
      rendererInFlightPerSurfaceMax: 1,
      mainOutstandingTransfersPerSurfaceMax: 2,
      helperOutstandingLeasesPerSessionMax: 2,
      worstActiveFrameAgeP95Ms: 60,
      electronMainDutyRatioMax: 0.08,
      sharedTextureImportP95Ms: 0.4,
      primaryCpuPixelConversions: 1,
      unreconciledReusableLeasesMax: 0,
    });
    expect(evaluateLiveSurfaceSoakBudgets(aggregate)).toEqual([
      "active frame age p95 ms: 60 > 50",
      "shared-texture import p95 ms: 0.4 > 0.3",
      "primary CPU pixel conversions: 1 > 0",
    ]);
    expect(
      evaluateLiveSurfaceSoakBudgets(aggregateLiveSurfaceSoakMetrics([metricSample()])),
    ).toEqual([]);
  });
});
