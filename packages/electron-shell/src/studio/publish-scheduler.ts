/** The preload's browser clock; kept explicit so the no-paint path can be exercised. */
export interface PublishClock {
  requestAnimationFrame(callback: () => void): number;
  cancelAnimationFrame(handle: number): void;
  setTimeout(callback: () => void, ms: number): number;
  clearTimeout(handle: number): void;
}

/** Coalesce on a frame while painting; keep transport moving when Studio is occluded.
 * Hidden-window timers may be throttled, but do not depend on a repaint. */
export function scheduleAppearancePublish(clock: PublishClock, callback: () => void): void {
  let pending = true;
  const flush = (): void => {
    if (!pending) return;
    pending = false;
    clock.cancelAnimationFrame(frame);
    clock.clearTimeout(timer);
    callback();
  };
  const frame = clock.requestAnimationFrame(flush);
  const timer = clock.setTimeout(flush, 100);
}
