// DT-2b — the headless half of `LiveSurfaceView`: everything the component does
// except the DOM. It owns the draw loop (tick only while the surface is LIVE,
// the element visible, and the folded demand live — PF3: the loop touches
// renderer-local state only), re-derives demand from element facts, and pushes
// intent through the handle. The React shell wires IntersectionObserver,
// ResizeObserver, page visibility, and a canvas 2D sink into this; tests drive
// it with fakes and an injected scheduler.

import type { LiveSurfaceFrameMetadataV1 } from "@vibefield/contracts";
import type { LiveSurfaceClosableFrame } from "@vibefield/live-surfaces/renderer";
import { type SurfaceDemandIntent, surfaceDemandIntentsEqual } from "../pool/demand";
import type { SurfaceHandle, SurfaceHandleState } from "../pool/surface-pool";
import { demandFromElementFacts, type SurfaceElementFacts } from "./element-demand";

/** Where frames land. `draw` returns false to report a failed paint (counted by
 * the presentation as consumer-rejected); it must not retain the frame. */
export interface SurfaceDrawSink<TFrame extends LiveSurfaceClosableFrame> {
  draw(frame: TFrame, metadata: LiveSurfaceFrameMetadataV1): boolean;
}

/** rAF, injectable. The returned function cancels the pending tick. */
export interface SurfaceFrameScheduler {
  schedule(tick: () => void): () => void;
}

export interface SurfaceViewControllerDeps<TFrame extends LiveSurfaceClosableFrame> {
  readonly handle: SurfaceHandle<TFrame>;
  readonly sink: SurfaceDrawSink<TFrame>;
  readonly scheduler: SurfaceFrameScheduler;
  readonly initialFacts: SurfaceElementFacts;
}

export interface SurfaceViewController<
  TFrame extends LiveSurfaceClosableFrame = LiveSurfaceClosableFrame,
> {
  /** The handle's own state, re-exposed for the shell's face rendering. */
  readonly state: SurfaceHandleState<TFrame>;
  onState(listener: () => void): () => void;
  /** Re-declare the element facts; demand is re-derived and pushed if moved. */
  updateFacts(facts: Partial<SurfaceElementFacts>): void;
  retry(): void;
  /** Stop the loop and unsubscribe. Idempotent. Deliberately does NOT release
   * the handle: mount/unmount moves refcounts at the ACQUIRER (03·A C-3), and
   * the view only presents what its owner acquired. */
  dispose(): void;
}

export function createSurfaceViewController<TFrame extends LiveSurfaceClosableFrame>(
  deps: SurfaceViewControllerDeps<TFrame>,
): SurfaceViewController<TFrame> {
  const { handle, sink, scheduler } = deps;
  let facts: SurfaceElementFacts = deps.initialFacts;
  // Null until the first applyFacts: the acquirer's initialDemand was its
  // guess, and the mount's MEASURED facts must be pushed once unconditionally —
  // the pool's fold dedupes if they happen to agree.
  let intent: SurfaceDemandIntent | null = null;
  let cancelTick: (() => void) | null = null;
  let disposed = false;

  const shouldTick = (): boolean =>
    !disposed && intent?.mode === "live" && handle.status === "live";

  const scheduleTick = (): void => {
    if (cancelTick !== null || !shouldTick()) return;
    cancelTick = scheduler.schedule(() => {
      cancelTick = null;
      if (!shouldTick()) return;
      const presentation = handle.presentation;
      // One latest frame per tick; an idle tick still reschedules — frames
      // arrive on the producer's clock, not ours, and the scheduler (rAF) is
      // what bounds the polling to the display rate.
      presentation?.presentLatestVia((frame, metadata) => sink.draw(frame, metadata));
      scheduleTick();
    });
  };

  const stopTicking = (): void => {
    const cancel = cancelTick;
    cancelTick = null;
    if (cancel !== null) cancel();
  };

  const applyFacts = (): void => {
    const next = demandFromElementFacts(facts);
    // The pool's own field-wise equality, so a new demand field (the logical
    // viewport was the second) can never move without moving the wire.
    const moved = intent === null || !surfaceDemandIntentsEqual(next, intent);
    intent = next;
    if (moved && handle.status !== "released") handle.setDemand(next);
    if (shouldTick()) scheduleTick();
    else stopTicking();
  };

  const offState = handle.onState(() => {
    if (shouldTick()) scheduleTick();
    else stopTicking();
  });

  // The handle was acquired with SOME initial demand; align it with the real
  // element facts immediately (the mount's first measured size, not a guess).
  applyFacts();

  return {
    get state() {
      return handle.state;
    },
    onState(listener) {
      return handle.onState(() => listener());
    },
    updateFacts(next) {
      if (disposed) return;
      facts = { ...facts, ...next };
      applyFacts();
    },
    retry() {
      if (!disposed) handle.retry();
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      stopTicking();
      offState();
    },
  };
}
