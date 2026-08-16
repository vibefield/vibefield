import { describe, expect, it } from "vitest";
import { LiveSurfaceLifecycle, LiveSurfaceTransitionError } from "../src/lifecycle";

describe("LiveSurfaceLifecycle", () => {
  it("advances the producer epoch before starts and reconnects", () => {
    const lifecycle = new LiveSurfaceLifecycle();
    expect(lifecycle.snapshot).toEqual({ state: "created", producerEpoch: 0, stateRevision: 0 });

    expect(lifecycle.transition("starting").current).toEqual({
      state: "starting",
      producerEpoch: 1,
      stateRevision: 1,
    });
    expect(lifecycle.acceptsFrames).toBe(true);
    lifecycle.transition("live");
    expect(lifecycle.transition("reconnecting").current).toEqual({
      state: "reconnecting",
      producerEpoch: 2,
      stateRevision: 3,
    });
    lifecycle.transition("live");
    lifecycle.transition("paused");
    lifecycle.transition("hibernated");
    expect(lifecycle.transition("starting").current.producerEpoch).toBe(3);
  });

  it("makes same-state requests idempotent and impossible transitions local errors", () => {
    const lifecycle = new LiveSurfaceLifecycle();
    const first = lifecycle.transition("starting");
    const duplicate = lifecycle.transition("starting");
    expect(first.changed).toBe(true);
    expect(duplicate).toMatchObject({ changed: false, current: first.current });
    expect(() => lifecycle.transition("hibernated")).toThrow(LiveSurfaceTransitionError);
  });

  it("makes closed terminal and frame-silent", () => {
    const lifecycle = new LiveSurfaceLifecycle();
    lifecycle.transition("closed");
    expect(lifecycle.acceptsFrames).toBe(false);
    expect(lifecycle.transition("closed").changed).toBe(false);
    expect(() => lifecycle.transition("starting")).toThrow(LiveSurfaceTransitionError);
  });
});
