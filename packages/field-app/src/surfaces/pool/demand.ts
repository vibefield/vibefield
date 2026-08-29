// SURFACE DEMAND — what a holder asks of a live surface, and the fold that turns
// every holder of one attachment into the ONE demand that rides the wire.
//
// The shape is the terminal pool's demand ledger (TP-L-E′) generalized to the
// richer live-surface contract: there the aggregate was a MAX over `none < live`,
// here it is a max over a mode rank plus a per-field fold (fps, raster size,
// priority, interactivity). The law it carries over is the important half —
// **the source is silenced by demand, never by lifecycle**. A holder unmounting
// releases its declared demand; it never reaches past the fold to stop pixels.
//
// Two things deliberately live here and not in @vibefield/live-surfaces:
//   - the INTENT type (a demand without a `revision`). Revisions are the wire's
//     serialization, and a holder that could name one could collide with another
//     holder. The pool owns the counter; holders own only what they want.
//   - COHERENCE as a caller-facing error. `LiveSurfaceDemandV1` refines
//     "live requires fps > 0 / paused and hibernated require fps 0" at parse
//     time; catching it at the pool door means the throw lands in the frame of
//     the acquire/setDemand that was wrong, not at some later emission.

import {
  LIVE_SURFACE_FPS_BUCKETS_V1,
  type LiveSurfaceDemandV1,
  type LiveSurfaceFpsBucketV1,
  type LiveSurfacePixelSizeV1,
} from "@vibefield/contracts";

export type SurfaceDemandMode = LiveSurfaceDemandV1["mode"];

/** The fold's ordering: the strongest intent of any holder wins the mode. */
const MODE_RANK: Record<SurfaceDemandMode, number> = { hibernated: 0, paused: 1, live: 2 };

/**
 * One holder's declared demand — a `LiveSurfaceDemandV1` minus its `revision`.
 *
 * `targetRasterSize` is written `| undefined` rather than plainly optional so a
 * caller under `exactOptionalPropertyTypes` may hand over a contract demand
 * whose own optional field is `X | undefined`.
 */
export interface SurfaceDemandIntent {
  readonly mode: SurfaceDemandMode;
  readonly targetFps: LiveSurfaceFpsBucketV1;
  readonly targetRasterSize?: LiveSurfacePixelSizeV1 | undefined;
  readonly priority: number;
  readonly interactive: boolean;
}

/**
 * What `acquire`/`setDemand` accept. A full contract demand is allowed because
 * it is the type callers already hold — its `revision` is IGNORED, since the
 * pool serializes the wire counter itself.
 */
export type SurfaceDemandRequest = SurfaceDemandIntent | LiveSurfaceDemandV1;

/**
 * The demand of a surface NOBODY holds.
 *
 * The grace window keeps the attachment alive so a pan does not cold-restart a
 * surface; it is not a licence to keep capturing for a surface with no viewer.
 * Paused is the honest middle: the producer stops, the session and its epoch
 * stay, and the next acquire folds straight back to live without a re-mint.
 */
export const IDLE_SURFACE_DEMAND: SurfaceDemandIntent = Object.freeze({
  mode: "paused",
  targetFps: 0,
  priority: 0,
  interactive: false,
});

function isFpsBucket(value: number): value is LiveSurfaceFpsBucketV1 {
  return (LIVE_SURFACE_FPS_BUCKETS_V1 as readonly number[]).includes(value);
}

function normalizeRasterSize(
  size: LiveSurfacePixelSizeV1 | undefined,
): LiveSurfacePixelSizeV1 | undefined {
  if (size === undefined) return undefined;
  if (!Number.isSafeInteger(size.width) || !Number.isSafeInteger(size.height)) {
    throw new RangeError("a surface demand raster size must be whole pixels");
  }
  if (size.width <= 0 || size.height <= 0) {
    throw new RangeError("a surface demand raster size must be positive");
  }
  return Object.freeze({ width: size.width, height: size.height });
}

/**
 * Validate one holder's request and strip it to the fields the fold reads.
 *
 * Coherence is checked HERE rather than left to the wire parse so the caller
 * that asked for the impossible ("live at 0fps") is the one that hears about it.
 */
export function normalizeSurfaceDemandIntent(request: SurfaceDemandRequest): SurfaceDemandIntent {
  if (!isFpsBucket(request.targetFps)) {
    throw new RangeError(
      `surface demand targetFps must be one of ${LIVE_SURFACE_FPS_BUCKETS_V1.join(", ")}`,
    );
  }
  if (!Number.isSafeInteger(request.priority) || request.priority < 0 || request.priority > 100) {
    throw new RangeError("surface demand priority must be a whole number in 0..100");
  }
  if (request.mode === "live" && request.targetFps === 0) {
    throw new RangeError("live surface demand requires a non-zero FPS bucket");
  }
  if (request.mode !== "live" && request.targetFps !== 0) {
    throw new RangeError("paused and hibernated surface demand require zero FPS");
  }
  const targetRasterSize = normalizeRasterSize(request.targetRasterSize);
  return Object.freeze({
    mode: request.mode,
    targetFps: request.targetFps,
    ...(targetRasterSize === undefined ? {} : { targetRasterSize }),
    priority: request.priority,
    interactive: request.interactive,
  });
}

function area(size: LiveSurfacePixelSizeV1 | undefined): number {
  return size === undefined ? 0 : size.width * size.height;
}

/**
 * The fold: strongest mode, greatest fps, greatest raster area, greatest
 * priority, interactive if ANY holder is.
 *
 * Ties on raster area keep the incumbent, so the emitted demand does not churn
 * as equal-area holders come and go. The result is coherent by construction: a
 * `live` fold takes its fps from the live holder that named the highest bucket,
 * and a fold that is not live is pinned back to zero fps.
 */
export function coalesceSurfaceDemand(
  intents: Iterable<SurfaceDemandIntent>,
): SurfaceDemandIntent | null {
  let mode: SurfaceDemandMode | null = null;
  let targetFps: LiveSurfaceFpsBucketV1 = 0;
  let targetRasterSize: LiveSurfacePixelSizeV1 | undefined;
  let priority = 0;
  let interactive = false;

  for (const intent of intents) {
    if (mode === null || MODE_RANK[intent.mode] > MODE_RANK[mode]) mode = intent.mode;
    if (intent.targetFps > targetFps) targetFps = intent.targetFps;
    if (area(intent.targetRasterSize) > area(targetRasterSize)) {
      targetRasterSize = intent.targetRasterSize;
    }
    if (intent.priority > priority) priority = intent.priority;
    interactive = interactive || intent.interactive;
  }
  if (mode === null) return null;

  return Object.freeze({
    mode,
    targetFps: mode === "live" ? targetFps : 0,
    ...(targetRasterSize === undefined ? {} : { targetRasterSize }),
    priority,
    interactive,
  });
}

/** Field-wise equality — the test for "this fold did not move", never revisions. */
export function surfaceDemandIntentsEqual(
  left: SurfaceDemandIntent,
  right: SurfaceDemandIntent,
): boolean {
  return (
    left.mode === right.mode &&
    left.targetFps === right.targetFps &&
    left.priority === right.priority &&
    left.interactive === right.interactive &&
    left.targetRasterSize?.width === right.targetRasterSize?.width &&
    left.targetRasterSize?.height === right.targetRasterSize?.height
  );
}

/** Serialize a fold onto the wire at the revision the POOL assigned it. */
export function toWireDemand(intent: SurfaceDemandIntent, revision: number): LiveSurfaceDemandV1 {
  return {
    revision,
    mode: intent.mode,
    targetFps: intent.targetFps,
    ...(intent.targetRasterSize === undefined
      ? {}
      : {
          targetRasterSize: {
            width: intent.targetRasterSize.width,
            height: intent.targetRasterSize.height,
          },
        }),
    priority: intent.priority,
    interactive: intent.interactive,
  };
}
