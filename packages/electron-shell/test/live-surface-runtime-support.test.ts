import type { LiveSurfaceRuntimeSummaryV1 } from "@vibefield/contracts";
import { describe, expect, it } from "vitest";
import {
  aggregateLiveSurfaceRuntimeSupport,
  createLiveSurfaceRuntimeSupportSnapshot,
  type LiveSurfaceRuntimeSupportMetrics,
} from "../src/main/live-surfaces/runtime-support";

function summary(
  surfaceId: string,
  state: LiveSurfaceRuntimeSummaryV1["state"],
): LiveSurfaceRuntimeSummaryV1 {
  return {
    v: 1,
    surfaceId,
    state,
    producerEpoch: 2,
    stateRevision: 4,
    capabilities: {
      pointer: false,
      wheel: false,
      keyboard: false,
      textInput: false,
      touch: false,
      rotateDevice: false,
      resizeLogicalViewport: false,
      resizeBackingRaster: true,
      crop: true,
    },
    transport: "shared-texture",
  };
}

function metrics(value: number): LiveSurfaceRuntimeSupportMetrics {
  return {
    attachmentsCreated: value,
    activeAttachments: value,
    producerStarts: value,
    producerRestarts: value,
    framesObserved: value,
    framesOffered: value,
    framesAccepted: value,
    framesDropped: value,
    sharedFramesObserved: value,
    cpuFramesObserved: value,
    localReferencesReleased: value,
    downstreamReferencesReleased: value,
    referencesQuarantined: value,
  };
}

describe("Live Surface runtime support snapshots", () => {
  it("aggregates bounded source-redacted metrics and lifecycle counts", () => {
    const browser = createLiveSurfaceRuntimeSupportSnapshot({
      sourceKind: "browser",
      summary: summary("surface_0123456789abcdef", "live"),
      effectiveDemand: {
        revision: 3,
        mode: "live",
        targetFps: 30,
        priority: 40,
        interactive: false,
      },
      metrics: metrics(2),
    });
    const simulator = createLiveSurfaceRuntimeSupportSnapshot({
      sourceKind: "ios-simulator",
      summary: summary("surface_fedcba9876543210", "failed"),
      effectiveDemand: null,
      metrics: metrics(3),
    });
    const aggregate = aggregateLiveSurfaceRuntimeSupport(
      [{ supportSnapshot: () => browser }, { supportSnapshot: () => simulator }],
      { capturedAtUnixMs: 1234 },
    );

    expect(aggregate).toMatchObject({
      v: 1,
      capturedAtUnixMs: 1234,
      truncated: false,
      stateCounts: { live: 1, failed: 1, closed: 0 },
      totals: {
        attachmentsCreated: 5,
        framesObserved: 5,
        downstreamReferencesReleased: 5,
        referencesQuarantined: 5,
      },
    });
    expect(aggregate.surfaces.map((surface) => surface.sourceKind)).toEqual([
      "browser",
      "ios-simulator",
    ]);
    const serialized = JSON.stringify(aggregate);
    expect(serialized).not.toContain("targetId");
    expect(serialized).not.toContain("sourceRef");
    expect(serialized).not.toContain("udid");
  });

  it("truncates at the explicit cap and rejects invalid counters", () => {
    const first = createLiveSurfaceRuntimeSupportSnapshot({
      sourceKind: "sck-window",
      summary: summary("surface_0123456789abcdef", "paused"),
      effectiveDemand: null,
      metrics: metrics(1),
    });
    const second = createLiveSurfaceRuntimeSupportSnapshot({
      sourceKind: "browser",
      summary: summary("surface_fedcba9876543210", "live"),
      effectiveDemand: null,
      metrics: metrics(2),
    });
    expect(
      aggregateLiveSurfaceRuntimeSupport(
        [{ supportSnapshot: () => first }, { supportSnapshot: () => second }],
        { capturedAtUnixMs: 1234, maxSurfaces: 1 },
      ),
    ).toMatchObject({ truncated: true, surfaces: [first], totals: metrics(1) });

    expect(() =>
      createLiveSurfaceRuntimeSupportSnapshot({
        sourceKind: "browser",
        summary: summary("surface_0123456789abcdef", "live"),
        effectiveDemand: null,
        metrics: { ...metrics(0), framesDropped: -1 },
      }),
    ).toThrow(/framesDropped must be a non-negative safe integer/);
  });
});
