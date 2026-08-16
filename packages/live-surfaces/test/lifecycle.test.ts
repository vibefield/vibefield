import type { LiveSurfaceLifecycleStateV1 } from "@vibefield/contracts";
import { describe, expect, it } from "vitest";
import { LiveSurfaceLifecycle, LiveSurfaceTransitionError } from "../src/lifecycle";

const states: readonly LiveSurfaceLifecycleStateV1[] = [
  "created",
  "starting",
  "live",
  "paused",
  "hibernated",
  "reconnecting",
  "failed",
  "closed",
];

const transitions: Readonly<
  Record<LiveSurfaceLifecycleStateV1, readonly LiveSurfaceLifecycleStateV1[]>
> = {
  created: ["starting", "closed"],
  starting: ["live", "failed", "closed"],
  live: ["paused", "reconnecting", "failed", "closed"],
  paused: ["live", "hibernated", "failed", "closed"],
  hibernated: ["starting", "closed"],
  reconnecting: ["live", "failed", "closed"],
  failed: ["starting", "closed"],
  closed: [],
};

const paths: Readonly<Record<LiveSurfaceLifecycleStateV1, readonly LiveSurfaceLifecycleStateV1[]>> =
  {
    created: [],
    starting: ["starting"],
    live: ["starting", "live"],
    paused: ["starting", "live", "paused"],
    hibernated: ["starting", "live", "paused", "hibernated"],
    reconnecting: ["starting", "live", "reconnecting"],
    failed: ["starting", "failed"],
    closed: ["closed"],
  };

function lifecycleAt(state: LiveSurfaceLifecycleStateV1): LiveSurfaceLifecycle {
  const lifecycle = new LiveSurfaceLifecycle();
  for (const next of paths[state]) lifecycle.transition(next);
  return lifecycle;
}

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

  it("accepts every declared edge and rejects every other state pair", () => {
    for (const from of states) {
      for (const to of states) {
        const lifecycle = lifecycleAt(from);
        if (to === from) {
          expect(lifecycle.transition(to).changed, `${from} -> ${to}`).toBe(false);
        } else if (transitions[from].includes(to)) {
          expect(lifecycle.transition(to).current.state, `${from} -> ${to}`).toBe(to);
        } else {
          expect(() => lifecycle.transition(to), `${from} -> ${to}`).toThrow(
            LiveSurfaceTransitionError,
          );
        }
      }
    }
  });
});
