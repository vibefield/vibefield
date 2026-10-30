import type { Splash } from "./vibefield-splash.js";

// The field's mark, faded by hand (DESIGN.md §6, the glass forming: the field's mark goes under the
// glass over 400ms on plain `ease`). One fade at a time, on the splash's own setReveal with the
// window kept whole (front 0), so a reveal must cancel it first: setReveal(0, …) would close a
// window the reveal is opening.

// CSS's `ease`, cubic-bezier(0.25, 0.1, 0.25, 1): x(t) solved by Newton's method, then y(t).
const bezier = (a: number, b: number) => (t: number) =>
  3 * a * t * (1 - t) ** 2 + 3 * b * t * t * (1 - t) + t ** 3;
const slope = (a: number, b: number) => (t: number) =>
  3 * a * (1 - t) ** 2 + 6 * (b - a) * t * (1 - t) + 3 * (1 - b) * t * t;
const x = bezier(0.25, 0.25);
const dx = slope(0.25, 0.25);
const y = bezier(0.1, 1);

export function ease(k: number): number {
  if (k <= 0) return 0;
  if (k >= 1) return 1;
  let t = k;
  for (let i = 0; i < 8; i++) {
    const d = dx(t);
    if (d < 1e-6) break;
    t -= (x(t) - k) / d;
  }
  return y(Math.min(1, Math.max(0, t)));
}

export interface MarkFade {
  /** Fade the mark to `to` (0 … 1) over `ms`; at once for 0. */
  to(to: number, ms: number): void;
  cancel(): void;
}

export function markFade(splash: Pick<Splash, "setReveal">): MarkFade {
  let value = 1;
  let from = 1;
  let target = 1;
  let ms = 0;
  let t0 = 0;
  let frame = 0;
  const step = (now: number): void => {
    const k = Math.min(1, (now - t0) / ms);
    value = from + (target - from) * ease(k);
    splash.setReveal(0, { mark: value });
    frame = k < 1 ? requestAnimationFrame(step) : 0;
  };
  return {
    to(next, duration) {
      cancelAnimationFrame(frame);
      frame = 0;
      if (duration <= 0) {
        value = next;
        splash.setReveal(0, { mark: next });
        return;
      }
      from = value;
      target = next;
      ms = duration;
      t0 = performance.now();
      frame = requestAnimationFrame(step);
    },
    cancel() {
      cancelAnimationFrame(frame);
      frame = 0;
    },
  };
}
