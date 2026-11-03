import { CameraZoomStep, type CanvasEngine, FrameInfo } from "@vibecook/ice";

/** Tactile scale landmarks. Zoom stays continuous; these never snap the camera. */
export const ZOOM_FEEDBACK_LEVELS = [0.25, 0.5, 1, 2, 4] as const;
const REARM_RATIO = 1.03;
const MIN_INTERVAL_MS = 100;

/** A crossing earns one pulse. A level rearms only after moving 3% away, so
 * fingers wavering at 100% cannot buzz. Large changes still earn at most one
 * pulse, and a suppressed pulse is never queued for after the gesture. */
export function createZoomFeedback(pulse: () => void) {
  const disarmed = new Set<number>();
  let lastPulse = Number.NEGATIVE_INFINITY;
  return (from: number, to: number, now: number): void => {
    if (
      !Number.isFinite(from) ||
      !Number.isFinite(to) ||
      !Number.isFinite(now) ||
      from <= 0 ||
      to <= 0 ||
      from === to
    )
      return;
    let crossed = false;
    for (const level of ZOOM_FEEDBACK_LEVELS) {
      if (from < level / REARM_RATIO || from > level * REARM_RATIO) disarmed.delete(level);
      if ((from < level && to >= level) || (from > level && to <= level)) {
        if (!disarmed.has(level)) crossed = true;
        disarmed.add(level);
      }
    }
    if (!crossed || now - lastPulse < MIN_INTERVAL_MS) return;
    lastPulse = now;
    pulse();
  };
}

/** Publish-time feedback follows only camera input, never a camera observer:
 * fits, flights and restored boards change the camera too. No timer or wake
 * source is installed; a parked desk stays parked. The stage owns cleanup. */
export function bindDeskZoomFeedback(ce: CanvasEngine, pulse: () => void): () => void {
  const feedback = createZoomFeedback(pulse);
  let seenTick = -1;
  return ce.engine.onPublish(() => {
    // getResource returns the stored record (one Map lookup, no allocation).
    // Polling resourceStamp instead would arm bookkeeping on every resource write.
    const step = ce.world.getResource(CameraZoomStep);
    if (
      step === undefined ||
      step.tick === seenTick ||
      step.tick !== ce.world.getResource(FrameInfo)?.tick
    )
      return;
    seenTick = step.tick;
    feedback(step.from, step.to, performance.now());
  });
}
