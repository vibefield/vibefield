import { INDEX_STATUS_FEED, type IndexStatus } from "@vibefield/contracts";
import { createNoopLogger, type Logger } from "@vibefield/logging";

// AO-4b (track AO; `thinking-agent-onboarding.md` §5) — `index.status.subscribe`'s
// ONE poller. The desk's History cell and Setting up must not poll at the
// room's pace, and every window would: so fieldd reads the daemon's status
// once a tick for everyone, and only while anyone listens. A tick is a second
// while History is reading and half a minute once nothing is (INDEX_STATUS_FEED);
// `poke` reads at once when the daemon's phase moves (a consent restarts it).
// Listeners hear that a newer status stands; the door (`wholeValueDoor`) holds
// each reader to the stream floor and sends a frame only when what that reader
// holds changed.

/** One listener's hold on the feed. */
export interface IndexStatusLease {
  /** the newest status the feed holds */
  current(): IndexStatus;
  /** a newer status may stand */
  onChange(listener: () => void): () => void;
  /** let go; the last holder's close stops the poller */
  close(): void;
}

export interface IndexStatusFeedOptions {
  /** one read of the whole status, as this desktop's windows are answered */
  read: () => Promise<IndexStatus>;
  logger?: Logger;
  /** test seam: the two ticks (default INDEX_STATUS_FEED's) */
  ticks?: { importMs: number; restMs: number };
}

/** Whether a status has nothing left to read: the archive is ready, or the
 * index is not reading at all (no consent, a pause, a daemon that stopped or
 * failed — whose restart moves its phase, and a moved phase is read at once). */
export function statusSettled(status: IndexStatus): boolean {
  switch (status.phase) {
    case "live":
      return status.search?.readiness === "ready" || status.search?.readiness === "failed";
    case "unconfigured":
    case "awaiting_consent":
    case "metadata_ready":
    case "failed":
    case "stopped":
      return true;
    default:
      return false;
  }
}

export class IndexStatusFeed {
  readonly #read: () => Promise<IndexStatus>;
  readonly #logger: Logger;
  readonly #ticks: { importMs: number; restMs: number };
  readonly #listeners = new Set<() => void>();
  #latest: IndexStatus | null = null;
  #reading: Promise<IndexStatus> | null = null;
  #timer: ReturnType<typeof setTimeout> | null = null;
  #holders = 0;

  constructor(opts: IndexStatusFeedOptions) {
    this.#read = opts.read;
    this.#logger = opts.logger ?? createNoopLogger();
    this.#ticks = opts.ticks ?? {
      importMs: INDEX_STATUS_FEED.IMPORT_TICK_MS,
      restMs: INDEX_STATUS_FEED.REST_TICK_MS,
    };
  }

  /** Hold the feed. The first holder starts the poller; every holder starts
   * from the newest status, read now when the feed holds none. A first read
   * that fails is the open's failure. */
  async open(): Promise<IndexStatusLease> {
    this.#holders += 1;
    let closed = false;
    const close = (): void => {
      if (closed) return;
      closed = true;
      this.#holders -= 1;
      if (this.#holders === 0) this.#stop();
    };
    let first: IndexStatus;
    try {
      first = this.#latest ?? (await this.#readNow());
    } catch (error) {
      close();
      throw error;
    }
    if (this.#timer === null && this.#holders > 0) this.#schedule(this.#tickAfter(first));
    return {
      current: () => this.#latest ?? first,
      onChange: (listener) => {
        this.#listeners.add(listener);
        return () => {
          this.#listeners.delete(listener);
        };
      },
      close,
    };
  }

  /** Read at once — the daemon's phase moved. Nothing while nobody listens. */
  poke(): void {
    if (this.#holders > 0) this.#schedule(0);
  }

  get holders(): number {
    return this.#holders;
  }

  async #readNow(): Promise<IndexStatus> {
    this.#reading ??= this.#read().finally(() => {
      this.#reading = null;
    });
    const status = await this.#reading;
    // a read that lands after the last holder left is not kept: the next
    // first holder reads afresh
    if (this.#holders > 0) this.#latest = status;
    for (const listener of [...this.#listeners]) listener();
    return status;
  }

  #tickAfter(status: IndexStatus | null): number {
    return status !== null && statusSettled(status) ? this.#ticks.restMs : this.#ticks.importMs;
  }

  #schedule(ms: number): void {
    if (this.#timer !== null) clearTimeout(this.#timer);
    this.#timer = setTimeout(() => {
      this.#timer = null;
      void this.#tick();
    }, ms);
    this.#timer.unref?.();
  }

  async #tick(): Promise<void> {
    if (this.#holders === 0) return;
    try {
      await this.#readNow();
    } catch (error) {
      // the last status stands; the next tick asks again
      this.#logger.debug("fieldd.index_status_feed.read_failed", "A status read failed", {
        error: error instanceof Error ? error.message : String(error),
      });
    }
    if (this.#holders > 0 && this.#timer === null) this.#schedule(this.#tickAfter(this.#latest));
  }

  #stop(): void {
    if (this.#timer !== null) clearTimeout(this.#timer);
    this.#timer = null;
    // a later first holder reads afresh: what was held may be hours old
    this.#latest = null;
  }
}
