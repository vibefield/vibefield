// DT-2b — the element→demand law: what a DOM-mounted surface asks of its
// producer, derived from what the ENGINE/DOM already knows (DT-D5). PF6 is the
// shape: visibility silences the source, never the sink — a hidden page or a
// culled element folds to paused, and the pool's grace keeps the session warm.
// Hibernation is deliberately NOT declared here: releasing the producer is the
// pool's reap decision (grace expiry), not a per-frame visibility fact.

import type { SurfaceDemandIntent } from "../pool/demand";

export interface SurfaceElementFacts {
  /** IntersectionObserver truth for the element (any part on screen). */
  readonly elementVisible: boolean;
  /** document.visibilityState === "visible". */
  readonly pageVisible: boolean;
  /** CSS size of the element box, pre-DPR. */
  readonly cssWidth: number;
  readonly cssHeight: number;
  readonly devicePixelRatio: number;
  /** The holder is interactively focused (typing/pointing into the surface). */
  readonly interactive: boolean;
}

/** FPS from apparent size (the reference-workload buckets, LSF §15.3): a
 * near-native surface earns 60, a mid card 30, a tile 15, a thumbnail 5. The
 * measure is the larger device-pixel side, so zoom and DPR both count. */
function fpsForApparentSize(devicePixelSide: number): SurfaceDemandIntent["targetFps"] {
  if (devicePixelSide >= 960) return 60;
  if (devicePixelSide >= 480) return 30;
  if (devicePixelSide >= 200) return 15;
  return 5;
}

const MAX_RASTER_SIDE = 4096;

export function demandFromElementFacts(facts: SurfaceElementFacts): SurfaceDemandIntent {
  const dpr =
    Number.isFinite(facts.devicePixelRatio) && facts.devicePixelRatio > 0
      ? Math.min(facts.devicePixelRatio, 4)
      : 1;
  const width = Math.min(MAX_RASTER_SIDE, Math.max(1, Math.round(facts.cssWidth * dpr)));
  const height = Math.min(MAX_RASTER_SIDE, Math.max(1, Math.round(facts.cssHeight * dpr)));
  const visible =
    facts.elementVisible && facts.pageVisible && facts.cssWidth >= 1 && facts.cssHeight >= 1;
  if (!visible) {
    return {
      mode: "paused",
      targetFps: 0,
      priority: 0,
      interactive: false,
    };
  }
  return {
    mode: "live",
    targetFps: facts.interactive ? 60 : fpsForApparentSize(Math.max(width, height)),
    targetRasterSize: { width, height },
    priority: facts.interactive ? 80 : 50,
    interactive: facts.interactive,
  };
}
