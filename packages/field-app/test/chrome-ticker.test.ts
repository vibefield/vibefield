import { describe, expect, it, vi } from "vitest";
import { createChromeTicker } from "../src/chrome-ticker";

// The chrome ticker's contract (3b, review finding 5): one rAF loop paces
// every chrome read at its declared cadence; hidden PAUSES the loop entirely
// (no timers while hidden — the old setIntervals kept firing); refocus runs a
// catch-up pass; AbortSignal and unsubscribe both detach; the loop parks when
// the last subscriber leaves.

function fakeSeam() {
  let hidden = false;
  const visListeners = new Set<(h: boolean) => void>();
  const frames = new Map<number, () => void>();
  let nextFrame = 1;
  let t = 1_000;
  return {
    seam: {
      isHidden: () => hidden,
      onVisibilityChange: (fn: (h: boolean) => void) => {
        visListeners.add(fn);
        return () => visListeners.delete(fn);
      },
      raf: (fn: () => void) => {
        const id = nextFrame;
        nextFrame += 1;
        frames.set(id, fn);
        return id;
      },
      caf: (id: number) => {
        frames.delete(id);
      },
      now: () => t,
    },
    /** advance time and run every scheduled frame callback */
    frame(ms = 16): void {
      t += ms;
      const fs = [...frames.values()];
      frames.clear();
      for (const f of fs) f();
    },
    setHidden(h: boolean): void {
      hidden = h;
      for (const fn of [...visListeners]) fn(h);
    },
    pending: () => frames.size,
  };
}

describe("createChromeTicker", () => {
  it("paces each subscriber at its own cadence off one shared frame loop", () => {
    const f = fakeSeam();
    const ticker = createChromeTicker(f.seam);
    const fast = vi.fn();
    const slow = vi.fn();
    ticker.subscribe(50, fast);
    ticker.subscribe(200, slow);
    expect(f.pending()).toBe(1); // ONE loop for both

    f.frame(); // first pass: everyone is due (last=0)
    expect(fast).toHaveBeenCalledTimes(1);
    expect(slow).toHaveBeenCalledTimes(1);

    f.frame(16); // +16ms: nobody due
    f.frame(16); // +32
    expect(fast).toHaveBeenCalledTimes(1);
    f.frame(16); // +48... fast(50) due on the next crossing
    f.frame(16); // +64 ≥ 50 → fast fires
    expect(fast).toHaveBeenCalledTimes(2);
    expect(slow).toHaveBeenCalledTimes(1); // 200ms not reached yet
  });

  it("hidden cancels the loop outright; refocus runs a catch-up pass", () => {
    const f = fakeSeam();
    const ticker = createChromeTicker(f.seam);
    const fn = vi.fn();
    ticker.subscribe(1_000, fn);
    f.frame();
    expect(fn).toHaveBeenCalledTimes(1);

    f.setHidden(true);
    expect(f.pending()).toBe(0); // NO scheduled work while hidden
    f.frame(500);
    expect(fn).toHaveBeenCalledTimes(1);

    f.setHidden(false); // refocus: everyone is due immediately
    expect(f.pending()).toBe(1);
    f.frame(1); // far below the 1s cadence — catch-up ignores pacing
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it("subscribing while hidden schedules nothing until visible", () => {
    const f = fakeSeam();
    f.setHidden(true);
    const ticker = createChromeTicker(f.seam);
    const fn = vi.fn();
    ticker.subscribe(50, fn);
    expect(f.pending()).toBe(0);
    f.setHidden(false);
    f.frame();
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("unsubscribe and AbortSignal both detach; the last leaver parks the loop", () => {
    const f = fakeSeam();
    const ticker = createChromeTicker(f.seam);
    const a = vi.fn();
    const b = vi.fn();
    const ac = new AbortController();
    const unA = ticker.subscribe(50, a);
    ticker.subscribe(50, b, { signal: ac.signal });
    f.frame();
    expect(a).toHaveBeenCalledTimes(1);
    expect(b).toHaveBeenCalledTimes(1);

    unA();
    ac.abort();
    expect(f.pending()).toBe(0); // nobody left — the loop parked
    f.frame(100);
    expect(a).toHaveBeenCalledTimes(1);
    expect(b).toHaveBeenCalledTimes(1);
  });

  it("an already-aborted signal never subscribes", () => {
    const f = fakeSeam();
    const ticker = createChromeTicker(f.seam);
    const fn = vi.fn();
    ticker.subscribe(50, fn, { signal: AbortSignal.abort() });
    expect(f.pending()).toBe(0);
  });

  it("dispose stops the loop and drops every subscriber", () => {
    const f = fakeSeam();
    const ticker = createChromeTicker(f.seam);
    const fn = vi.fn();
    ticker.subscribe(50, fn);
    ticker.dispose();
    expect(f.pending()).toBe(0);
    f.frame(100);
    expect(fn).not.toHaveBeenCalled();
  });
});
