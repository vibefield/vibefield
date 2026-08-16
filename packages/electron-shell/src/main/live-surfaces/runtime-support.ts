import { type LiveSurfaceDemandV1, LiveSurfaceRuntimeSummaryV1 } from "@vibefield/contracts";

export const LIVE_SURFACE_SUPPORT_MAX_SURFACES = 256;

export type LiveSurfaceRuntimeSourceKind = "browser" | "sck-window" | "ios-simulator";

export interface LiveSurfaceRuntimeSupportMetrics {
  readonly attachmentsCreated: number;
  readonly activeAttachments: number;
  readonly producerStarts: number;
  readonly producerRestarts: number;
  readonly framesObserved: number;
  readonly framesOffered: number;
  readonly framesAccepted: number;
  readonly framesDropped: number;
  readonly sharedFramesObserved: number;
  readonly cpuFramesObserved: number;
  readonly localReferencesReleased: number;
  readonly downstreamReferencesReleased: number;
  readonly referencesQuarantined: number;
}

export interface LiveSurfaceRuntimeSupportSnapshot {
  readonly v: 1;
  readonly sourceKind: LiveSurfaceRuntimeSourceKind;
  readonly summary: LiveSurfaceRuntimeSummaryV1;
  readonly effectiveDemand: LiveSurfaceDemandV1 | null;
  readonly metrics: LiveSurfaceRuntimeSupportMetrics;
}

export interface LiveSurfaceRuntimeSupportSource {
  supportSnapshot(): LiveSurfaceRuntimeSupportSnapshot;
}

export interface LiveSurfaceRuntimeSupportAggregate {
  readonly v: 1;
  readonly capturedAtUnixMs: number;
  readonly truncated: boolean;
  readonly surfaces: readonly LiveSurfaceRuntimeSupportSnapshot[];
  readonly totals: LiveSurfaceRuntimeSupportMetrics;
  readonly stateCounts: Readonly<Record<LiveSurfaceRuntimeSummaryV1["state"], number>>;
}

function safeCount(value: number, name: string): number {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new RangeError(`${name} must be a non-negative safe integer`);
  }
  return value;
}

function copyMetrics(metrics: LiveSurfaceRuntimeSupportMetrics): LiveSurfaceRuntimeSupportMetrics {
  return {
    attachmentsCreated: safeCount(metrics.attachmentsCreated, "attachmentsCreated"),
    activeAttachments: safeCount(metrics.activeAttachments, "activeAttachments"),
    producerStarts: safeCount(metrics.producerStarts, "producerStarts"),
    producerRestarts: safeCount(metrics.producerRestarts, "producerRestarts"),
    framesObserved: safeCount(metrics.framesObserved, "framesObserved"),
    framesOffered: safeCount(metrics.framesOffered, "framesOffered"),
    framesAccepted: safeCount(metrics.framesAccepted, "framesAccepted"),
    framesDropped: safeCount(metrics.framesDropped, "framesDropped"),
    sharedFramesObserved: safeCount(metrics.sharedFramesObserved, "sharedFramesObserved"),
    cpuFramesObserved: safeCount(metrics.cpuFramesObserved, "cpuFramesObserved"),
    localReferencesReleased: safeCount(metrics.localReferencesReleased, "localReferencesReleased"),
    downstreamReferencesReleased: safeCount(
      metrics.downstreamReferencesReleased,
      "downstreamReferencesReleased",
    ),
    referencesQuarantined: safeCount(metrics.referencesQuarantined, "referencesQuarantined"),
  };
}

export function createLiveSurfaceRuntimeSupportSnapshot(options: {
  readonly sourceKind: LiveSurfaceRuntimeSourceKind;
  readonly summary: LiveSurfaceRuntimeSummaryV1;
  readonly effectiveDemand: LiveSurfaceDemandV1 | null;
  readonly metrics: LiveSurfaceRuntimeSupportMetrics;
}): LiveSurfaceRuntimeSupportSnapshot {
  return {
    v: 1,
    sourceKind: options.sourceKind,
    summary: LiveSurfaceRuntimeSummaryV1.parse(options.summary),
    effectiveDemand:
      options.effectiveDemand === null
        ? null
        : {
            ...options.effectiveDemand,
            ...(options.effectiveDemand.targetRasterSize === undefined
              ? {}
              : { targetRasterSize: { ...options.effectiveDemand.targetRasterSize } }),
          },
    metrics: copyMetrics(options.metrics),
  };
}

function emptyMetrics(): LiveSurfaceRuntimeSupportMetrics {
  return {
    attachmentsCreated: 0,
    activeAttachments: 0,
    producerStarts: 0,
    producerRestarts: 0,
    framesObserved: 0,
    framesOffered: 0,
    framesAccepted: 0,
    framesDropped: 0,
    sharedFramesObserved: 0,
    cpuFramesObserved: 0,
    localReferencesReleased: 0,
    downstreamReferencesReleased: 0,
    referencesQuarantined: 0,
  };
}

function addMetrics(
  total: LiveSurfaceRuntimeSupportMetrics,
  next: LiveSurfaceRuntimeSupportMetrics,
): LiveSurfaceRuntimeSupportMetrics {
  const summed: Record<keyof LiveSurfaceRuntimeSupportMetrics, number> = { ...total };
  for (const key of Object.keys(summed) as Array<keyof LiveSurfaceRuntimeSupportMetrics>) {
    summed[key] = safeCount(total[key] + next[key], `aggregate ${key}`);
  }
  return summed;
}

/** Bounded, source-redacted main-process evidence for diagnostics/support export. */
export function aggregateLiveSurfaceRuntimeSupport(
  sources: readonly LiveSurfaceRuntimeSupportSource[],
  options: { readonly capturedAtUnixMs?: number; readonly maxSurfaces?: number } = {},
): LiveSurfaceRuntimeSupportAggregate {
  const maxSurfaces = options.maxSurfaces ?? LIVE_SURFACE_SUPPORT_MAX_SURFACES;
  if (!Number.isSafeInteger(maxSurfaces) || maxSurfaces <= 0 || maxSurfaces > 4_096) {
    throw new RangeError("support snapshot surface limit must be between 1 and 4096");
  }
  const capturedAtUnixMs = options.capturedAtUnixMs ?? Date.now();
  if (!Number.isSafeInteger(capturedAtUnixMs) || capturedAtUnixMs < 0) {
    throw new RangeError("support snapshot timestamp must be a non-negative safe integer");
  }
  const surfaces = sources.slice(0, maxSurfaces).map((source) => {
    const snapshot = source.supportSnapshot();
    return createLiveSurfaceRuntimeSupportSnapshot(snapshot);
  });
  let totals = emptyMetrics();
  const stateCounts: Record<LiveSurfaceRuntimeSummaryV1["state"], number> = {
    created: 0,
    starting: 0,
    live: 0,
    paused: 0,
    hibernated: 0,
    reconnecting: 0,
    failed: 0,
    closed: 0,
  };
  for (const snapshot of surfaces) {
    totals = addMetrics(totals, snapshot.metrics);
    stateCounts[snapshot.summary.state] += 1;
  }
  return {
    v: 1,
    capturedAtUnixMs,
    truncated: sources.length > surfaces.length,
    surfaces,
    totals,
    stateCounts,
  };
}
