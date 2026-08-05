import { getRendererLogger } from "../../../logging";
import { createSwarmPhysicsHost } from "./swarm-physics-host";
import {
  isSwarmFrame,
  type SwarmPhysicsCommand,
  type SwarmPhysicsEvent,
} from "./swarm-physics-protocol";

// THE MAIN THREAD'S END OF THE WIRE (GT-3c).
//
// Two implementations behind one small interface. The WORKER driver is what
// ships. The INLINE driver runs the identical host in this thread, and exists
// for the two environments that cannot have a worker: a fixture under happy-dom
// (which defines no `Worker` at all) and a renderer where constructing one
// failed.
//
// The fallback is deliberately VISIBLE rather than quiet. A swarm that silently
// went back to main-thread physics would undo this slice while looking exactly
// like it working, so the mode is published — the Godview monitor marker carries
// it and the smoke asserts on it, which turns a silent regression into a failed
// row.

export type SwarmPhysicsMode = "worker" | "inline" | "none";

export interface SwarmPhysicsDriverOptions {
  onEvent(event: SwarmPhysicsEvent): void;
  /** Called with a frame the driver does not own past the call: read it and
   * hand it back. */
  onFrame(frame: Float32Array): void;
}

export interface SwarmPhysicsDriver {
  readonly mode: "worker" | "inline";
  post(command: SwarmPhysicsCommand, transfer?: Transferable[]): void;
  dispose(): void;
}

export type SwarmPhysicsDriverFactory = (options: SwarmPhysicsDriverOptions) => SwarmPhysicsDriver;

let factory: SwarmPhysicsDriverFactory | undefined;
let activeMode: SwarmPhysicsMode = "none";

/**
 * What is simulating the swarm right now — `none` when nothing is.
 *
 * Read by the monitor marker (`development-console.ts`), which is why it lives
 * in a module and not in the view's state: the marker is emitted by the stage
 * ABOVE the swarm, and parent effects run after their children's, so by the time
 * the marker is written the view's mount effect has already chosen.
 */
export function currentSwarmPhysicsMode(): SwarmPhysicsMode {
  return activeMode;
}

/** The fixture seam: install a driver factory (the inline one, or a fake) for
 * the duration of a test. Passing `undefined` restores the real choice. */
export function setSwarmPhysicsDriverFactory(next: SwarmPhysicsDriverFactory | undefined): void {
  factory = next;
}

export function createSwarmPhysicsDriver(options: SwarmPhysicsDriverOptions): SwarmPhysicsDriver {
  const driver = (factory ?? chooseDriver)(options);
  activeMode = driver.mode;
  return {
    mode: driver.mode,
    post: (command, transfer) => driver.post(command, transfer),
    dispose: () => {
      driver.dispose();
      activeMode = "none";
    },
  };
}

function chooseDriver(options: SwarmPhysicsDriverOptions): SwarmPhysicsDriver {
  if (typeof Worker === "function") {
    try {
      return createWorkerDriver(options);
    } catch (error) {
      getRendererLogger().warn(
        "renderer.godview.swarm_worker_unavailable",
        "The swarm's physics worker would not start; simulating on the main thread instead",
        { error: error instanceof Error ? error.message : String(error) },
      );
    }
  }
  return createInlineSwarmPhysicsDriver(options);
}

function createWorkerDriver(options: SwarmPhysicsDriverOptions): SwarmPhysicsDriver {
  const worker = new Worker(new URL("./swarm-physics.worker.ts", import.meta.url), {
    type: "module",
    name: "vibefield-swarm-physics",
  });
  worker.addEventListener("message", (event: MessageEvent) => {
    const data = event.data as unknown;
    if (isSwarmFrame(data)) options.onFrame(data);
    else options.onEvent(data as SwarmPhysicsEvent);
  });
  // A worker that dies takes the swarm's motion with it and there is no honest
  // way to hide that, so it is said out loud. Rebuilding one here would mean
  // replaying a whole world's state into it mid-gesture; the residual is
  // recorded rather than half-paid.
  worker.addEventListener("error", (event: ErrorEvent) => {
    getRendererLogger().error(
      "renderer.godview.swarm_worker_failed",
      "The swarm's physics worker died; the field will not move until the stage is reopened",
      event.error,
      { detail: event.message || "unknown worker error" },
    );
  });
  return {
    mode: "worker",
    post: (command, transfer) => {
      if (transfer && transfer.length > 0) worker.postMessage(command, transfer);
      else worker.postMessage(command);
    },
    dispose: () => worker.terminate(),
  };
}

/** How the inline host gets its pumps. The default rides rAF, so a fixture that
 * drives frames drives the physics with them. */
export type InlinePhysicsSchedule = (pump: (now: number) => void) => () => void;

function scheduleOnAnimationFrame(pump: (now: number) => void): () => void {
  let frame = requestAnimationFrame(function tick(now: number) {
    pump(now);
    frame = requestAnimationFrame(tick);
  });
  return () => cancelAnimationFrame(frame);
}

/**
 * The same physics, in this thread.
 *
 * Frames are delivered SYNCHRONOUSLY from inside the pump, which is what makes a
 * fixture deterministic: drive one animation frame and the simulation has
 * advanced, the frame has been delivered, and the view can be asserted on
 * without a single await.
 */
export function createInlineSwarmPhysicsDriver(
  options: SwarmPhysicsDriverOptions & { schedule?: InlinePhysicsSchedule },
): SwarmPhysicsDriver {
  const host = createSwarmPhysicsHost({
    post: (message) => {
      if (isSwarmFrame(message)) options.onFrame(message);
      else options.onEvent(message);
    },
  });
  const stop = (options.schedule ?? scheduleOnAnimationFrame)((now) => host.pump(now));
  return {
    mode: "inline",
    post: (command) => host.handle(command),
    dispose: () => {
      stop();
      host.dispose();
    },
  };
}
