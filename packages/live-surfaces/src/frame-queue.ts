import type { LiveSurfaceFrameMetadataV1 } from "@vibefield/contracts";

export type LiveSurfaceFrameReleaseReason =
  | "consumed"
  | "superseded"
  | "stale-epoch"
  | "stale-sequence"
  | "not-demanded"
  | "epoch-reset"
  | "closed"
  | "protocol-violation";

export interface OrderedLiveSurfaceFrameMetadata {
  readonly producerEpoch: number;
  readonly sequence: string;
}

export interface QueuedLiveSurfaceFrame<
  T,
  M extends OrderedLiveSurfaceFrameMetadata = LiveSurfaceFrameMetadataV1,
> {
  readonly value: T;
  readonly metadata: M;
}

export interface LiveSurfaceFrameLease<
  T,
  M extends OrderedLiveSurfaceFrameMetadata = LiveSurfaceFrameMetadataV1,
> {
  readonly frame: QueuedLiveSurfaceFrame<T, M>;
  release(): void;
}

export type LiveSurfaceFrameOfferResult =
  | { readonly kind: "accepted" }
  | { readonly kind: "replaced" }
  | { readonly kind: "dropped"; readonly reason: LiveSurfaceFrameReleaseReason };

export interface LiveSurfaceFrameQueueStats {
  readonly offered: number;
  readonly accepted: number;
  readonly taken: number;
  readonly released: number;
  readonly pending: 0 | 1;
  readonly inFlight: 0 | 1;
  readonly releases: Readonly<Record<LiveSurfaceFrameReleaseReason, number>>;
}

interface InFlightFrame<T, M extends OrderedLiveSurfaceFrameMetadata> {
  readonly frame: QueuedLiveSurfaceFrame<T, M>;
  released: boolean;
}

const RELEASE_REASONS: readonly LiveSurfaceFrameReleaseReason[] = [
  "consumed",
  "superseded",
  "stale-epoch",
  "stale-sequence",
  "not-demanded",
  "epoch-reset",
  "closed",
  "protocol-violation",
];

function emptyReleaseCounts(): Record<LiveSurfaceFrameReleaseReason, number> {
  return {
    consumed: 0,
    superseded: 0,
    "stale-epoch": 0,
    "stale-sequence": 0,
    "not-demanded": 0,
    "epoch-reset": 0,
    closed: 0,
    "protocol-violation": 0,
  };
}

function parseSequence(value: string): bigint | null {
  if (!/^(0|[1-9][0-9]{0,19})$/u.test(value)) return null;
  const parsed = BigInt(value);
  return parsed <= 0xffff_ffff_ffff_ffffn ? parsed : null;
}

function validEpoch(value: number): boolean {
  return Number.isSafeInteger(value) && value >= 0;
}

/**
 * Generic one-in-flight/one-pending queue. The release callback is where a
 * renderer closes a VideoFrame; the pure package never imports DOM types.
 */
export class LatestLiveSurfaceFrameQueue<
  T,
  M extends OrderedLiveSurfaceFrameMetadata = LiveSurfaceFrameMetadataV1,
> {
  #activeEpoch: number;
  #accepting = true;
  #closed = false;
  #lastSequence: bigint | null = null;
  #pending: QueuedLiveSurfaceFrame<T, M> | null = null;
  #inFlight: InFlightFrame<T, M> | null = null;
  #offered = 0;
  #accepted = 0;
  #taken = 0;
  #released = 0;
  readonly #releases = emptyReleaseCounts();

  constructor(
    activeEpoch: number,
    readonly releaseFrame: (
      frame: QueuedLiveSurfaceFrame<T, M>,
      reason: LiveSurfaceFrameReleaseReason,
    ) => void,
  ) {
    if (!validEpoch(activeEpoch))
      throw new RangeError("active epoch must be a non-negative safe integer");
    this.#activeEpoch = activeEpoch;
  }

  get activeEpoch(): number {
    return this.#activeEpoch;
  }

  get stats(): LiveSurfaceFrameQueueStats {
    const releases = emptyReleaseCounts();
    for (const reason of RELEASE_REASONS) releases[reason] = this.#releases[reason];
    return {
      offered: this.#offered,
      accepted: this.#accepted,
      taken: this.#taken,
      released: this.#released,
      pending: this.#pending === null ? 0 : 1,
      inFlight: this.#inFlight === null ? 0 : 1,
      releases,
    };
  }

  offer(frame: QueuedLiveSurfaceFrame<T, M>): LiveSurfaceFrameOfferResult {
    this.#offered += 1;
    if (this.#closed) return this.#drop(frame, "closed");
    if (!this.#accepting) return this.#drop(frame, "not-demanded");
    if (!validEpoch(frame.metadata.producerEpoch)) {
      return this.#drop(frame, "protocol-violation");
    }
    if (frame.metadata.producerEpoch !== this.#activeEpoch) {
      return this.#drop(frame, "stale-epoch");
    }
    const sequence = parseSequence(frame.metadata.sequence);
    if (sequence === null) return this.#drop(frame, "protocol-violation");
    if (this.#lastSequence !== null && sequence <= this.#lastSequence) {
      return this.#drop(frame, "stale-sequence");
    }

    const replaced = this.#pending;
    this.#lastSequence = sequence;
    this.#pending = frame;
    this.#accepted += 1;
    if (replaced !== null) {
      this.#release(replaced, "superseded");
      return { kind: "replaced" };
    }
    return { kind: "accepted" };
  }

  take(): LiveSurfaceFrameLease<T, M> | null {
    if (this.#closed || !this.#accepting || this.#inFlight !== null || this.#pending === null) {
      return null;
    }
    const record: InFlightFrame<T, M> = { frame: this.#pending, released: false };
    this.#pending = null;
    this.#inFlight = record;
    this.#taken += 1;
    return {
      frame: record.frame,
      release: () => this.#releaseInFlight(record, "consumed"),
    };
  }

  setAccepting(accepting: boolean): void {
    if (this.#closed || accepting === this.#accepting) return;
    this.#accepting = accepting;
    if (!accepting && this.#pending !== null) {
      const pending = this.#pending;
      this.#pending = null;
      this.#release(pending, "not-demanded");
    }
  }

  resetEpoch(nextEpoch: number): void {
    if (!validEpoch(nextEpoch))
      throw new RangeError("next epoch must be a non-negative safe integer");
    if (this.#closed) throw new Error("cannot reset a closed live surface frame queue");
    if (nextEpoch < this.#activeEpoch) throw new RangeError("producer epoch cannot move backwards");
    if (nextEpoch === this.#activeEpoch) return;

    const pending = this.#pending;
    const inFlight = this.#inFlight;
    this.#pending = null;
    this.#inFlight = null;
    this.#activeEpoch = nextEpoch;
    this.#lastSequence = null;
    this.#releaseDrained(pending, inFlight, "epoch-reset");
  }

  close(): void {
    if (this.#closed) return;
    const pending = this.#pending;
    const inFlight = this.#inFlight;
    this.#closed = true;
    this.#accepting = false;
    this.#pending = null;
    this.#inFlight = null;
    this.#releaseDrained(pending, inFlight, "closed");
  }

  #drop(
    frame: QueuedLiveSurfaceFrame<T, M>,
    reason: LiveSurfaceFrameReleaseReason,
  ): LiveSurfaceFrameOfferResult {
    this.#release(frame, reason);
    return { kind: "dropped", reason };
  }

  #releaseInFlight(record: InFlightFrame<T, M>, reason: LiveSurfaceFrameReleaseReason): void {
    if (record.released) return;
    record.released = true;
    if (this.#inFlight === record) this.#inFlight = null;
    this.#release(record.frame, reason);
  }

  #releaseDrained(
    pending: QueuedLiveSurfaceFrame<T, M> | null,
    inFlight: InFlightFrame<T, M> | null,
    reason: "epoch-reset" | "closed",
  ): void {
    const failures: unknown[] = [];
    if (pending !== null) {
      try {
        this.#release(pending, reason);
      } catch (error) {
        failures.push(error);
      }
    }
    if (inFlight !== null) {
      try {
        this.#releaseInFlight(inFlight, reason);
      } catch (error) {
        failures.push(error);
      }
    }
    if (failures.length === 1) throw failures[0];
    if (failures.length > 1) {
      throw new AggregateError(
        failures,
        `multiple live surface frames failed to release on ${reason}`,
      );
    }
  }

  #release(frame: QueuedLiveSurfaceFrame<T, M>, reason: LiveSurfaceFrameReleaseReason): void {
    this.#released += 1;
    this.#releases[reason] += 1;
    this.releaseFrame(frame, reason);
  }
}
