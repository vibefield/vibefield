import { afterEach, beforeEach } from "vitest";
import {
  createInlineSwarmPhysicsDriver,
  setSwarmPhysicsDriverFactory,
} from "../src/godview/views/swarm/swarm-physics-driver";

/**
 * Run the swarm's physics in THIS thread for the duration of a fixture.
 *
 * happy-dom defines no `Worker` at all, so a fixture that mounts the swarm has
 * to be told where to simulate. The stand-in is not a mock: it is the same host,
 * the same engine and the same accumulator the worker runs, wired to callbacks
 * instead of a port — so what these fixtures assert on is the real thing, minus
 * the thread.
 *
 * Being synchronous is the point. The inline driver delivers a frame from inside
 * the pump, and the pump rides the same rAF the fixtures already drive, so
 * "advance one frame" still means the simulation moved, the frame landed and the
 * DOM was written, with nothing to await.
 */
export function useInlineSwarmPhysics(): void {
  beforeEach(() => {
    setSwarmPhysicsDriverFactory((options) => createInlineSwarmPhysicsDriver(options));
  });
  afterEach(() => {
    setSwarmPhysicsDriverFactory(undefined);
  });
}
