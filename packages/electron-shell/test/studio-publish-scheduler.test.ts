import { afterEach, describe, expect, it, vi } from "vitest";
import { type PublishClock, scheduleAppearancePublish } from "../src/studio/publish-scheduler";
import { type RendererPort, StudioPreloadBridge } from "../src/studio/studio-preload-bridge";

function setup() {
  vi.useFakeTimers();
  const frames: Array<() => void> = [];
  const clock: PublishClock = {
    requestAnimationFrame: (callback) => frames.push(callback),
    cancelAnimationFrame: vi.fn(),
    setTimeout: (callback, ms) => setTimeout(callback, ms) as unknown as number,
    clearTimeout: (handle) => clearTimeout(handle),
  };
  const sent: unknown[] = [];
  const port: RendererPort = {
    postMessage: (message) => sent.push(message),
    start: () => {},
    close: () => {},
    onmessage: null,
    onclose: null,
  };
  const bridge = new StudioPreloadBridge((callback) => scheduleAppearancePublish(clock, callback));
  bridge.attach(port, 1);
  sent.length = 0;
  return { bridge, clock, frames, sent };
}

afterEach(() => vi.useRealTimers());

describe("Studio publishes without depending on paint", () => {
  it("coalesces on a visible frame and cancels the fallback timer", () => {
    const { bridge, clock, frames, sent } = setup();
    bridge.publish('{"reach":1}');
    const requestId = bridge.publish('{"reach":2}');
    expect(frames).toHaveLength(1);
    expect(sent).toEqual([]);
    frames[0]?.();
    expect(sent).toEqual([{ type: "appearance.publish", requestId, serialized: '{"reach":2}' }]);
    expect(clock.cancelAnimationFrame).toHaveBeenCalledWith(1);
    expect(vi.getTimerCount()).toBe(0);
    vi.advanceTimersByTime(1_000);
    expect(sent).toHaveLength(1);
  });

  it("delivers the latest command with no frames, and ignores a stale frame after fallback", () => {
    const { bridge, frames, sent } = setup();
    bridge.publish('{"reach":1}');
    const cleared = bridge.clear();
    vi.advanceTimersByTime(100);
    expect(sent).toEqual([{ type: "appearance.clear", requestId: cleared }]);

    const published = bridge.publish('{"reach":3}');
    // Even if a cancelled frame was already queued, it cannot flush this newer slot.
    frames[0]?.();
    expect(sent).toHaveLength(1);
    vi.advanceTimersByTime(100);
    expect(sent).toEqual([
      { type: "appearance.clear", requestId: cleared },
      { type: "appearance.publish", requestId: published, serialized: '{"reach":3}' },
    ]);
    frames[1]?.();
    expect(sent).toHaveLength(2);
    expect(vi.getTimerCount()).toBe(0);
  });
});
