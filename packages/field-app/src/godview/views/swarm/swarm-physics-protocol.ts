import type {
  SwarmAgentSpec,
  SwarmBounds,
  SwarmObstacleRect,
  SwarmPhysicsParameters,
  SwarmPoint,
} from "./swarm-physics";

// THE WIRE BETWEEN THE SWARM AND ITS PHYSICS (GT-3c, GT-D16).
//
// Two directions, deliberately asymmetric.
//
// COMMANDS go down as ordinary objects. They are rare — a parameter drag, a
// pointer gesture, a mock arrival — and their cost is irrelevant beside their
// clarity.
//
// FRAMES come back as a bare `Float32Array` whose buffer is TRANSFERRED, and
// they are the only message on the hot path. Nine bubbles at 30Hz is 1,800
// position updates a second; as objects that would be 1,800 structured clones a
// second, which is exactly the main-thread cost this slice exists to remove. The
// receiver reads them back to the sender (`releaseFrame`) so the same two
// buffers rotate forever and steady state allocates nothing.
//
// A frame is distinguishable from an event by its TYPE rather than by a tag: the
// receiver checks `instanceof Float32Array`, so the hot message carries no
// envelope at all — the header lives in the buffer's own first two floats.
//
// SharedArrayBuffer was considered and REJECTED on evidence, not taste: the
// renderer is not cross-origin isolated (no COOP/COEP is set anywhere in the
// shell, by the deliberate design that keeps the loro wasm inline and the
// renderer serverless), and a probe in the running app answers
// `crossOriginIsolated: false` with `SharedArrayBuffer` undefined outright.
// Buying it would mean isolation headers the app does not otherwise need. At
// nine bodies the ping-pong is not the bottleneck anyway.

/** What the future renderer will be handed. Accepted today, drawn to by nothing —
 * see `adoptCanvas` below. */
export type SwarmRenderSurface = OffscreenCanvas;

export type SwarmPhysicsCommand =
  | {
      type: "init";
      agents: readonly SwarmAgentSpec[];
      parameters: SwarmPhysicsParameters;
      bounds: SwarmBounds;
      obstacles: readonly SwarmObstacleRect[];
      /** Carried because the stage knows it and the renderer will want it. It
       * changes NOTHING about the simulation today, and that is a decision
       * rather than an omission: this slice's contract is zero visual delta, and
       * a swarm that moved differently under reduced motion would be exactly the
       * delta it forbids. The spawn spring — the one motion the preference does
       * govern — is a main-thread WAAPI animation and stays there. */
      reducedMotion: boolean;
    }
  | { type: "updateAgents"; agents: readonly SwarmAgentSpec[] }
  | { type: "updateParameters"; parameters: SwarmPhysicsParameters }
  | { type: "updateBounds"; bounds: SwarmBounds }
  | { type: "updateObstacles"; obstacles: readonly SwarmObstacleRect[] }
  | { type: "dragStart"; id: string; point: SwarmPoint }
  /** Keyed by id rather than ambient, so two fingers may drag two bubbles —
   * which the DOM view already allowed, each bubble owning its own pointer. */
  | { type: "dragMove"; id: string; point: SwarmPoint }
  | { type: "dragEnd"; id: string }
  | { type: "nudge"; id: string }
  | { type: "queryPoint"; point: SwarmPoint; requestId: number }
  /**
   * THE FUTURE RENDERER'S SOCKET (GT-D16).
   *
   * James's WebGPU + SDF swarm renderer is a separate session. When it arrives
   * it does not need this protocol re-plumbed: the stage transfers an
   * `OffscreenCanvas` through here and the renderer slot below it starts
   * drawing, next to a simulation that is already in the right thread with the
   * positions already in hand.
   *
   * Today the slot holds the canvas and draws NOTHING. It is a socket, not a
   * feature, and pretending otherwise would put an untested renderer on the
   * path the DOM view is still using.
   */
  | { type: "adoptCanvas"; canvas: SwarmRenderSurface }
  /** A consumed frame buffer, handed back for reuse. */
  | { type: "releaseFrame"; buffer: Float32Array }
  | { type: "dispose" };

export type SwarmPhysicsEvent =
  /**
   * THE PROOF OF LIFE (GT-5c), posted from the worker's module scope before it
   * has been asked anything.
   *
   * `new Worker(...)` resolves synchronously and tells you nothing: the module
   * is fetched and evaluated afterwards, so a missing chunk in a packaged build
   * or a CSP regression fails LATER, on the `error` listener. Without this
   * event the driver had no way to distinguish a worker that was simulating
   * from one that had never loaded, and the mode marker certified a motionless
   * field as healthy. Arrival is the only thing this carries; its absence
   * inside the deadline is what the driver acts on.
   */
  | { type: "ready" }
  /**
   * The index→id table frames are addressed by, published whenever MEMBERSHIP
   * changes and never otherwise.
   *
   * Frames carry the generation they were written under, so a frame that
   * crosses a membership change in flight is recognisable as stale rather than
   * being read against the wrong ids — which would put one agent's position on
   * another's bubble for a frame.
   */
  | { type: "idTable"; generation: number; ids: readonly string[] }
  | { type: "queryResult"; requestId: number; id: string | null };

/** Everything the physics side can send: events, plus the bare frame. */
export type SwarmPhysicsOutbound = SwarmPhysicsEvent | Float32Array;

export function isSwarmFrame(message: unknown): message is Float32Array {
  return message instanceof Float32Array;
}
