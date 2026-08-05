import { frameFloatsFor, SwarmPhysics, type SwarmPhysicsInit } from "./swarm-physics";
import type {
  SwarmPhysicsCommand,
  SwarmPhysicsOutbound,
  SwarmRenderSurface,
} from "./swarm-physics-protocol";

// THE PHYSICS SIDE OF THE WIRE (GT-3c).
//
// One host, two homes. The worker entry wires it to `self`; the inline driver
// wires it to a pair of callbacks in the same thread. They run the SAME code,
// which is what makes the inline path a legitimate stand-in for the worker in a
// fixture rather than a second implementation that agrees by coincidence.
//
// The host owns three things the physics itself has no business knowing about:
// the ping-pong buffers, the id-table generation, and when a frame is worth
// sending. It does NOT own a clock — `pump` is called by whoever is scheduling,
// which is a timer in the worker and the render loop in a fixture, and that is
// exactly why a test can drive a hundred deterministic frames through it.

/** Two buffers, rotating. A third would only ever hold a frame nobody has read. */
const BUFFER_COUNT = 2;

export interface SwarmPhysicsHostOptions {
  post(message: SwarmPhysicsOutbound, transfer?: Transferable[]): void;
  /** The host's own clock, injected so a fixture's driven time reaches the
   * accumulator seed as well as the pumps. */
  now?: () => number;
  random?: () => number;
}

export interface SwarmPhysicsHost {
  handle(command: SwarmPhysicsCommand): void;
  /** Advance to `now` and publish a frame if anything actually solved. */
  pump(now: number): void;
  /** The step period the physics is currently running at, in ms — the worker's
   * timer reads it to keep its cadence tied to the rate. */
  stepMs(): number;
  /**
   * The canvas `adoptCanvas` handed over, or null.
   *
   * This is the accessor the SDF renderer will read on the day it lands; today
   * its only caller is the fixture proving the socket HOLDS what it was given
   * and draws nothing with it.
   */
  renderSurface(): SwarmRenderSurface | null;
  readonly disposed: boolean;
  dispose(): void;
}

export function createSwarmPhysicsHost(options: SwarmPhysicsHostOptions): SwarmPhysicsHost {
  const now = options.now ?? (() => performance.now());
  let physics: SwarmPhysics | null = null;
  let free: Float32Array[] = [];
  let capacity = 0;
  let disposed = false;
  /** The future renderer's slot. Held, never drawn to (GT-D16). */
  let surface: SwarmRenderSurface | null = null;

  const ensureCapacity = (bodies: number): void => {
    const needed = frameFloatsFor(bodies);
    if (needed <= capacity) return;
    // Grown with headroom so an arriving agent every few seconds does not
    // reallocate every few seconds. Buffers still in flight are simply not
    // taken back (`releaseFrame` drops anything the wrong size).
    capacity = frameFloatsFor(bodies + 8);
    free = Array.from({ length: BUFFER_COUNT }, () => new Float32Array(capacity));
  };

  const publishTable = (): void => {
    if (!physics) return;
    options.post({ type: "idTable", generation: physics.generation, ids: [...physics.ids()] });
  };

  const publishFrame = (): void => {
    if (!physics) return;
    ensureCapacity(physics.ids().length);
    const buffer = free.pop();
    // Both buffers are out: the consumer has not read the last frame yet, so
    // this one is DROPPED rather than allocated for. Back-pressure by
    // construction — a slow main thread costs the swarm freshness, never memory.
    if (!buffer) return;
    physics.writeFrame(buffer);
    options.post(buffer, [buffer.buffer]);
  };

  const handle = (command: SwarmPhysicsCommand): void => {
    if (disposed) return;
    switch (command.type) {
      case "init": {
        physics?.dispose();
        const init: SwarmPhysicsInit = {
          parameters: command.parameters,
          bounds: command.bounds,
          obstacles: command.obstacles,
          agents: command.agents,
        };
        if (options.random) init.random = options.random;
        physics = new SwarmPhysics(init);
        physics.seed(now());
        publishTable();
        publishFrame();
        return;
      }
      case "updateAgents": {
        if (!physics) return;
        if (!physics.syncAgents(command.agents)) return;
        // A membership change publishes immediately rather than waiting for the
        // next solved step: a new bubble is invisible until its first frame
        // arrives, and at 15Hz that wait would be a sixteenth of a second of
        // nothing where the spawn animation should have started.
        publishTable();
        publishFrame();
        return;
      }
      case "updateParameters":
        physics?.setParameters(command.parameters);
        return;
      case "updateBounds":
        physics?.setBounds(command.bounds);
        return;
      case "updateObstacles":
        physics?.setObstacles(command.obstacles);
        return;
      case "dragStart":
        physics?.dragStart(command.id, command.point);
        return;
      case "dragMove":
        physics?.dragMove(command.id, command.point);
        return;
      case "dragEnd":
        physics?.dragEnd(command.id);
        return;
      case "nudge":
        physics?.nudge(command.id);
        return;
      case "queryPoint":
        options.post({
          type: "queryResult",
          requestId: command.requestId,
          id: physics?.queryPoint(command.point) ?? null,
        });
        return;
      case "adoptCanvas":
        surface = command.canvas;
        return;
      case "releaseFrame": {
        const returned = command.buffer;
        // Wrong size means it predates a growth; let it go rather than write a
        // frame into a buffer too short to hold it.
        if (returned.length === capacity && free.length < BUFFER_COUNT) free.push(returned);
        return;
      }
      case "dispose":
        dispose();
        return;
    }
  };

  const pump = (at: number): void => {
    if (disposed || !physics) return;
    if (physics.advance(at) > 0) publishFrame();
  };

  function dispose(): void {
    if (disposed) return;
    disposed = true;
    physics?.dispose();
    physics = null;
    free = [];
    capacity = 0;
    surface = null;
  }

  return {
    handle,
    pump,
    stepMs: () => physics?.stepMs ?? 1000 / 30,
    renderSurface: () => surface,
    get disposed() {
      return disposed;
    },
    dispose,
  };
}
