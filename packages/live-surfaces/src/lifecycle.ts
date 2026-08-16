import type { LiveSurfaceLifecycleStateV1 } from "@vibefield/contracts";

const TRANSITIONS: Readonly<
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

export interface LiveSurfaceLifecycleSnapshot {
  readonly state: LiveSurfaceLifecycleStateV1;
  readonly producerEpoch: number;
  readonly stateRevision: number;
}

export interface LiveSurfaceTransitionResult {
  readonly changed: boolean;
  readonly previous: LiveSurfaceLifecycleSnapshot;
  readonly current: LiveSurfaceLifecycleSnapshot;
}

export class LiveSurfaceTransitionError extends Error {
  constructor(
    readonly from: LiveSurfaceLifecycleStateV1,
    readonly to: LiveSurfaceLifecycleStateV1,
  ) {
    super(`live surface lifecycle cannot transition from ${from} to ${to}`);
    this.name = "LiveSurfaceTransitionError";
  }
}

function increment(value: number, name: string): number {
  if (!Number.isSafeInteger(value) || value < 0 || value === Number.MAX_SAFE_INTEGER) {
    throw new RangeError(`${name} exhausted its safe integer range`);
  }
  return value + 1;
}

/**
 * Policy-free lifecycle/epoch authority. Starting and reconnecting advance the
 * producer epoch before asynchronous producer work can publish a callback.
 */
export class LiveSurfaceLifecycle {
  #state: LiveSurfaceLifecycleStateV1 = "created";
  #producerEpoch = 0;
  #stateRevision = 0;

  get snapshot(): LiveSurfaceLifecycleSnapshot {
    return {
      state: this.#state,
      producerEpoch: this.#producerEpoch,
      stateRevision: this.#stateRevision,
    };
  }

  get acceptsFrames(): boolean {
    return this.#state === "starting" || this.#state === "live" || this.#state === "reconnecting";
  }

  canTransition(to: LiveSurfaceLifecycleStateV1): boolean {
    return to === this.#state || TRANSITIONS[this.#state].includes(to);
  }

  transition(to: LiveSurfaceLifecycleStateV1): LiveSurfaceTransitionResult {
    const previous = this.snapshot;
    if (to === this.#state) return { changed: false, previous, current: previous };
    if (!TRANSITIONS[this.#state].includes(to)) {
      throw new LiveSurfaceTransitionError(this.#state, to);
    }

    // Entering either state invalidates callbacks from the previous producer
    // before the caller starts/rebinds any asynchronous source work.
    if (to === "starting" || to === "reconnecting") {
      this.#producerEpoch = increment(this.#producerEpoch, "producer epoch");
    }
    this.#stateRevision = increment(this.#stateRevision, "state revision");
    this.#state = to;
    return { changed: true, previous, current: this.snapshot };
  }
}
