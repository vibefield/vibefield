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
    // A GETTER, not a copy: the worker driver can demote itself to inline after
    // this object is built (see the readiness watchdog), and a mode read at
    // construction would keep saying `worker` about a thread that never loaded.
    get mode() {
      return driver.mode;
    },
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

/**
 * How long a worker has to say `ready` before it is presumed not to be coming.
 *
 * Generous, because this only ever costs a slow machine a late demotion and
 * never costs a healthy one anything: the timer is cleared by the first
 * message. Fetching and evaluating one module chunk is milliseconds; four
 * seconds is a deadline only a load that will NEVER finish can miss.
 */
const WORKER_READY_TIMEOUT_MS = 4_000;

/** The commands that constitute a WORLD, keyed by what they replace.
 *
 * A demotion has to hand the inline host the same world the dead worker was
 * given, and this is all of it: the last `init` plus the last of each `update`.
 * Gestures (`dragStart`/`dragMove`/`nudge`) and queries are deliberately not
 * replayed — a pointer that was down four seconds ago is not down now, and an
 * answer to a query nobody is still waiting for would arrive against a stale
 * requestId. `releaseFrame` is likewise dropped: those buffers belong to a
 * thread that is being terminated.
 */
const REPLAYED_COMMANDS = new Set([
  "init",
  "updateAgents",
  "updateParameters",
  "updateBounds",
  "updateObstacles",
]);

function createWorkerDriver(options: SwarmPhysicsDriverOptions): SwarmPhysicsDriver {
  const worker = new Worker(new URL("./swarm-physics.worker.ts", import.meta.url), {
    type: "module",
    name: "vibefield-swarm-physics",
  });
  // THE READINESS WATCHDOG (GT-5c). `new Worker(...)` returns before the module
  // is fetched, let alone evaluated, so a missing chunk in a packaged build or a
  // CSP regression throws NOTHING here — it arrives at the `error` listener
  // below, which used only to log. The result was a swarm frozen at its spawn
  // positions under a marker certifying `worker`, and a smoke row built to catch
  // exactly that reporting success. A worker that never says hello is demoted.
  let fallback: SwarmPhysicsDriver | undefined;
  let disposed = false;
  const world = new Map<string, SwarmPhysicsCommand>();
  let deadline: ReturnType<typeof setTimeout> | undefined;

  /** The worker has spoken, so it loaded. The watchdog stands down and the
   * replay buffer is dropped — holding a whole agent list for the life of the
   * stage would be a leak dressed as caution. */
  const settle = (): void => {
    if (deadline !== undefined) clearTimeout(deadline);
    deadline = undefined;
    world.clear();
  };

  const demote = (why: string): void => {
    // `deadline` still armed IS the definition of "never proved it was live".
    if (disposed || fallback !== undefined || deadline === undefined) return;
    // The world, in the order it was built. `init` is first by construction —
    // the view posts it before anything else can reach a driver — and the rest
    // are the latest value of each, which is what the worker would be holding.
    const pending = [...world.values()];
    settle();
    getRendererLogger().warn(
      "renderer.godview.swarm_worker_unavailable",
      "The swarm's physics worker never came up; simulating on the main thread instead",
      { detail: why },
    );
    worker.terminate();
    fallback = createInlineSwarmPhysicsDriver(options);
    activeMode = "inline";
    for (const command of pending) fallback.post(command);
  };

  worker.addEventListener("message", (event: MessageEvent) => {
    // ANY message proves the module evaluated, `ready` most cheaply and first.
    settle();
    const data = event.data as unknown;
    if (isSwarmFrame(data)) {
      options.onFrame(data);
      return;
    }
    const message = data as SwarmPhysicsEvent;
    if (message.type === "ready") return;
    options.onEvent(message);
  });
  // A worker that dies AFTER it was live takes the swarm's motion with it and
  // there is no honest way to hide that, so it is said out loud. Rebuilding one
  // here would mean replaying a whole world's state into it mid-gesture; the
  // residual is recorded rather than half-paid. A worker that dies before it was
  // ever live is a different thing and IS recoverable — nothing has happened
  // yet — so it takes the demotion above.
  worker.addEventListener("error", (event: ErrorEvent) => {
    const detail = event.message || "unknown worker error";
    if (deadline !== undefined) {
      demote(detail);
      return;
    }
    getRendererLogger().error(
      "renderer.godview.swarm_worker_failed",
      "The swarm's physics worker died; the field will not move until the stage is reopened",
      event.error,
      { detail },
    );
  });

  deadline = setTimeout(
    () => demote("no ready event inside the deadline"),
    WORKER_READY_TIMEOUT_MS,
  );

  return {
    get mode() {
      return fallback?.mode ?? "worker";
    },
    post: (command, transfer) => {
      if (fallback !== undefined) {
        fallback.post(command, transfer);
        return;
      }
      // Kept only while the worker is unproven. Once it says `ready` this map is
      // cleared and never written again.
      if (deadline !== undefined && REPLAYED_COMMANDS.has(command.type)) {
        world.set(command.type, command);
      }
      if (transfer && transfer.length > 0) worker.postMessage(command, transfer);
      else worker.postMessage(command);
    },
    dispose: () => {
      disposed = true;
      settle();
      world.clear();
      if (fallback !== undefined) fallback.dispose();
      else worker.terminate();
    },
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
