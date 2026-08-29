// THE SURFACE POOL (DT-2a) — one refcounted live-surface attachment per key, for
// the lifetime of one window.
//
// The constitution is design-03·A C-3/D13, which the terminal pool already
// serves for sessions: consumers name a key, the pool owns the ONE attachment
// behind it, and a consumer that goes away releases its claim rather than
// reaching for the thing it was shown. What the pool exists to make impossible:
//
//   - two mints for one key. A ticket is one-use authority (EL7); minting twice
//     because two widgets mounted in the same tick would spend authority nobody
//     asked for. Concurrent acquires share ONE in-flight attach.
//   - a cold restart on a pan. Releasing the last handle starts a grace timer,
//     not a teardown — a re-acquire inside the window gets the SAME live
//     attachment, no ticket, no producer restart.
//   - demand nobody folded. Holders declare intent; the pool serializes the one
//     monotonic wire demand (see ./demand.ts).
//   - a leaked attachment. Every exit — release, grace expiry, host close, pool
//     dispose, an attach that resolves after its entry is gone — ends with the
//     attachment disposed and the entry forgotten.
//
// TWO TRANSPORT FACTS THIS MODULE IS BUILT AROUND (read from the code at
// packages/live-surfaces/src/renderer/transport.ts, not assumed):
//
//   1. An attachment closed by the HOST does not always notify its observers.
//      `acceptSummary` with a `closed` state does; the bare `detached` control
//      message and `transport.dispose()` both call `closeFromHost()`, which
//      CLEARS the listener set before anyone is told. So `attachment.closed` is
//      the only reliable witness, and the pool re-reads it at every touchpoint
//      (`#reconcile`) instead of trusting the callback alone.
//   2. `attachment.dispose()` posts a `detach` on the control port and can
//      THROW when that port is gone (postControl rethrows after disposing the
//      transport). Every disposal here is therefore best-effort — the
//      bookkeeping must not depend on a dying port accepting one more message.
//
// The pool does NOT own the transport. The host claims it, hands it over, and
// disposes it on pagehide; a pool that disposed it would tear down a capability
// belonging to the window, not to any surface.

import type { LiveSurfaceAttachTicketV1, LiveSurfaceDemandV1 } from "@vibefield/contracts";
import {
  type LiveSurfaceClosableFrame,
  LiveSurfacePresentation,
  type LiveSurfaceRendererAttachment,
  type LiveSurfaceRendererTransport,
} from "@vibefield/live-surfaces/renderer";
import {
  coalesceSurfaceDemand,
  IDLE_SURFACE_DEMAND,
  normalizeSurfaceDemandIntent,
  type SurfaceDemandIntent,
  type SurfaceDemandRequest,
  surfaceDemandIntentsEqual,
  toWireDemand,
} from "./demand";

/** How long an unheld attachment stays warm before the pool reaps it. */
export const SURFACE_POOL_GRACE_MS = 60_000;

/**
 * Mints the one-use authority for a key.
 *
 * Kept as a per-acquire dependency rather than pool state because minting is a
 * privileged host round trip whose parameters (which source, under whose
 * grant) belong to the caller that knows the surface, not to the cache in front
 * of it. The pool retains the SOURCE so a retry can ask again; it never retains
 * what the source returns.
 */
export interface SurfaceTicketSource {
  mint(): Promise<LiveSurfaceAttachTicketV1>;
}

/** One-shot timers, injectable so tests drive grace expiry off a fake clock. */
export interface SurfacePoolTimers {
  /** Arm a one-shot timer. The returned function cancels it. */
  arm(callback: () => void, delayMs: number): () => void;
}

const DEFAULT_TIMERS: SurfacePoolTimers = {
  arm: (callback, delayMs) => {
    const handle = setTimeout(callback, delayMs);
    return () => clearTimeout(handle);
  },
};

export interface SurfacePoolDeps<TFrame extends LiveSurfaceClosableFrame> {
  /**
   * The window's already-claimed transport. A promise is the normal case: the
   * host claims the port bridge before the product mounts and the ports arrive
   * one message later.
   */
  readonly transport:
    | LiveSurfaceRendererTransport<TFrame>
    | Promise<LiveSurfaceRendererTransport<TFrame>>;
  readonly now?: () => number;
  readonly graceMs?: number;
  readonly timers?: SurfacePoolTimers;
}

export interface SurfaceAcquireOptions {
  readonly tickets: SurfaceTicketSource;
  readonly initialDemand: SurfaceDemandRequest;
}

/**
 * A handle's own view of its key.
 *
 * `attaching` and `live` are the entry's; `lost` says the attachment went away
 * and nothing will bring it back on its own (the next acquire, or `retry()`,
 * mints fresh); `released` is terminal for THIS handle and says nothing about
 * the surface, which other holders may still be watching.
 */
export type SurfaceHandleStatus = "attaching" | "live" | "lost" | "released";

export interface SurfaceHandleState<TFrame extends LiveSurfaceClosableFrame> {
  readonly status: SurfaceHandleStatus;
  /** Present exactly while `status === "live"`. */
  readonly presentation: LiveSurfacePresentation<TFrame> | null;
  /** Why the last attach or attachment ended. Never carries a ticket. */
  readonly error: Error | null;
}

export interface SurfaceHandle<TFrame extends LiveSurfaceClosableFrame> {
  readonly key: string;
  readonly state: SurfaceHandleState<TFrame>;
  readonly status: SurfaceHandleStatus;
  readonly presentation: LiveSurfacePresentation<TFrame> | null;
  readonly error: Error | null;
  /** Fires immediately with the current state, then on every change. */
  onState(listener: (state: SurfaceHandleState<TFrame>) => void): () => void;
  /** Re-declare THIS holder's intent. The pool refolds and emits at most once. */
  setDemand(demand: SurfaceDemandRequest): void;
  /** Mint fresh and re-attach after a loss. A no-op in any other state. */
  retry(): void;
  /** Drop this holder's claim. Idempotent. */
  release(): void;
}

/** Which stage of the attach failed. A classification, never a message. */
export type SurfacePoolFailure = "transport" | "mint" | "attach" | "host-close";

export interface SurfacePoolEntrySnapshot {
  readonly key: string;
  readonly status: "attaching" | "live" | "lost";
  readonly holders: number;
  readonly attachmentId: string | null;
  readonly surfaceId: string | null;
  /** Tickets spent on this key since it was created. */
  readonly mints: number;
  /** The last fold actually written to the wire, revision included. */
  readonly demand: LiveSurfaceDemandV1 | null;
  readonly graceDeadlineAt: number | null;
  readonly failure: SurfacePoolFailure | null;
}

/**
 * Handle-free, serializable pool state for diagnostics and support bundles.
 *
 * It carries no ticket, by construction rather than by redaction: the pool
 * never stores a token, and failures are recorded as a stage classification
 * rather than an error message, so nothing a ticket source says can leak into
 * a bundle through here.
 */
export interface SurfacePoolSnapshot {
  readonly v: 1;
  readonly disposed: boolean;
  readonly liveAttachments: number;
  readonly pendingGraceTimers: number;
  readonly mints: number;
  readonly entries: readonly SurfacePoolEntrySnapshot[];
}

export interface SurfacePool<TFrame extends LiveSurfaceClosableFrame> {
  readonly disposed: boolean;
  acquire(key: string, opts: SurfaceAcquireOptions): SurfaceHandle<TFrame>;
  snapshot(): SurfacePoolSnapshot;
  dispose(): void;
}

interface PoolEntry<TFrame extends LiveSurfaceClosableFrame> {
  readonly key: string;
  status: "attaching" | "live" | "lost";
  tickets: SurfaceTicketSource;
  readonly holders: Set<PoolHandle<TFrame>>;
  attachment: LiveSurfaceRendererAttachment<TFrame> | null;
  presentation: LiveSurfacePresentation<TFrame> | null;
  unobserve: (() => void) | null;
  /** Bumped per attach so a resolution that lost its race can identify itself. */
  generation: number;
  attaching: boolean;
  cancelGrace: (() => void) | null;
  graceDeadlineAt: number | null;
  /** NEVER reset across re-attaches — see `#projectDemand`. */
  nextRevision: number;
  emittedIntent: SurfaceDemandIntent | null;
  emittedDemand: LiveSurfaceDemandV1 | null;
  mints: number;
  failure: SurfacePoolFailure | null;
  error: Error | null;
}

function toError(value: unknown): Error {
  return value instanceof Error ? value : new Error(String(value));
}

class PoolHandle<TFrame extends LiveSurfaceClosableFrame> implements SurfaceHandle<TFrame> {
  readonly #listeners = new Set<(state: SurfaceHandleState<TFrame>) => void>();
  #released = false;

  constructor(
    private readonly pool: SurfaceAttachmentPool<TFrame>,
    readonly entry: PoolEntry<TFrame>,
    public intent: SurfaceDemandIntent,
  ) {}

  get key(): string {
    return this.entry.key;
  }

  get released(): boolean {
    return this.#released;
  }

  /**
   * The honest state, computed on read.
   *
   * A closed attachment is reported as `lost` even before the pool has done the
   * bookkeeping, because of transport fact 1 above: the close that reaches us
   * through `detached` or a transport dispose never rang the observer. Reads
   * stay side-effect free — the mutating half runs at the next touchpoint.
   */
  get state(): SurfaceHandleState<TFrame> {
    if (this.#released) return { status: "released", presentation: null, error: null };
    const entry = this.entry;
    if (entry.status === "live" && (entry.attachment === null || entry.attachment.closed)) {
      return { status: "lost", presentation: null, error: entry.error };
    }
    if (entry.status === "live" && entry.presentation !== null) {
      return { status: "live", presentation: entry.presentation, error: null };
    }
    if (entry.status === "lost") return { status: "lost", presentation: null, error: entry.error };
    return { status: "attaching", presentation: null, error: null };
  }

  get status(): SurfaceHandleStatus {
    return this.state.status;
  }

  get presentation(): LiveSurfacePresentation<TFrame> | null {
    return this.state.presentation;
  }

  get error(): Error | null {
    return this.state.error;
  }

  onState(listener: (state: SurfaceHandleState<TFrame>) => void): () => void {
    if (this.#released) {
      this.#deliver(listener, this.state);
      return () => undefined;
    }
    this.#listeners.add(listener);
    this.#deliver(listener, this.state);
    return () => this.#listeners.delete(listener);
  }

  setDemand(demand: SurfaceDemandRequest): void {
    const next = normalizeSurfaceDemandIntent(demand);
    if (this.#released) return;
    this.intent = next;
    this.pool.holderDemandChanged(this.entry);
  }

  retry(): void {
    if (this.#released) return;
    this.pool.retryEntry(this.entry);
  }

  release(): void {
    if (this.#released) return;
    this.#released = true;
    this.entry.holders.delete(this);
    this.pool.holderReleased(this.entry);
    this.notify();
  }

  /** Fan the current state out. One faulty observer cannot block the others. */
  notify(): void {
    const state = this.state;
    for (const listener of [...this.#listeners]) this.#deliver(listener, state);
    if (state.status === "released") this.#listeners.clear();
  }

  #deliver(
    listener: (state: SurfaceHandleState<TFrame>) => void,
    state: SurfaceHandleState<TFrame>,
  ): void {
    try {
      listener(state);
    } catch {
      // A consumer's render decision cannot break pool bookkeeping.
    }
  }
}

class SurfaceAttachmentPool<TFrame extends LiveSurfaceClosableFrame>
  implements SurfacePool<TFrame>
{
  readonly #entries = new Map<string, PoolEntry<TFrame>>();
  readonly #transport: Promise<LiveSurfaceRendererTransport<TFrame>>;
  readonly #now: () => number;
  readonly #graceMs: number;
  readonly #timers: SurfacePoolTimers;
  #disposed = false;
  #mints = 0;

  constructor(deps: SurfacePoolDeps<TFrame>) {
    this.#transport = Promise.resolve(deps.transport);
    this.#now = deps.now ?? (() => Date.now());
    this.#graceMs = deps.graceMs ?? SURFACE_POOL_GRACE_MS;
    this.#timers = deps.timers ?? DEFAULT_TIMERS;
  }

  get disposed(): boolean {
    return this.#disposed;
  }

  acquire(key: string, opts: SurfaceAcquireOptions): SurfaceHandle<TFrame> {
    if (this.#disposed) throw new Error("cannot acquire a surface from a disposed pool");
    const intent = normalizeSurfaceDemandIntent(opts.initialDemand);

    // Reconcile BEFORE deciding whether this key still has an entry: a host
    // close that arrived while nobody held the key reaps it here, and attaching
    // into the reaped object would strand the new handle on an entry the map no
    // longer names (`#attached` would see the mismatch and drop the attachment).
    const existing = this.#entries.get(key);
    if (existing !== undefined) {
      // A later acquire's source wins for the NEXT mint: the newest caller has
      // the newest authority. The in-flight attach keeps the one it started.
      existing.tickets = opts.tickets;
      this.#reconcile(existing);
    }

    let entry = this.#entries.get(key);
    if (entry === undefined) {
      entry = {
        key,
        status: "attaching",
        tickets: opts.tickets,
        holders: new Set(),
        attachment: null,
        presentation: null,
        unobserve: null,
        generation: 0,
        attaching: false,
        cancelGrace: null,
        graceDeadlineAt: null,
        nextRevision: 0,
        emittedIntent: null,
        emittedDemand: null,
        mints: 0,
        failure: null,
        error: null,
      };
      this.#entries.set(key, entry);
    }

    this.#cancelGrace(entry);
    const handle = new PoolHandle(this, entry, intent);
    entry.holders.add(handle);

    if (!entry.attaching && entry.attachment === null) this.#startAttach(entry);
    else this.#projectDemand(entry);
    return handle;
  }

  snapshot(): SurfacePoolSnapshot {
    for (const entry of [...this.#entries.values()]) this.#reconcile(entry);
    const entries = [...this.#entries.values()]
      .map(
        (entry): SurfacePoolEntrySnapshot => ({
          key: entry.key,
          status: entry.status,
          holders: entry.holders.size,
          attachmentId: entry.attachment?.attachmentId ?? null,
          surfaceId: entry.attachment?.surfaceId ?? null,
          mints: entry.mints,
          demand: entry.emittedDemand,
          graceDeadlineAt: entry.graceDeadlineAt,
          failure: entry.failure,
        }),
      )
      .sort((left, right) => (left.key < right.key ? -1 : left.key === right.key ? 0 : 1));

    return {
      v: 1,
      disposed: this.#disposed,
      liveAttachments: entries.filter((entry) => entry.attachmentId !== null).length,
      pendingGraceTimers: [...this.#entries.values()].filter((entry) => entry.cancelGrace !== null)
        .length,
      mints: this.#mints,
      entries,
    };
  }

  /**
   * Drain everything: timers, attachments, handles. Idempotent.
   *
   * `#disposed` flips FIRST so an attach still in flight disposes whatever it
   * resolves with instead of parking it in a map nobody will read again.
   */
  dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    for (const entry of [...this.#entries.values()]) {
      this.#teardown(entry);
      this.#entries.delete(entry.key);
      for (const handle of [...entry.holders]) {
        entry.holders.delete(handle);
        handle.release();
      }
    }
    this.#entries.clear();
  }

  // ── the handle's half of the seam ──────────────────────────────────────────

  holderDemandChanged(entry: PoolEntry<TFrame>): void {
    if (this.#disposed) return;
    this.#reconcile(entry);
    this.#projectDemand(entry);
  }

  holderReleased(entry: PoolEntry<TFrame>): void {
    if (this.#disposed) return;
    this.#reconcile(entry);
    this.#projectDemand(entry);
    if (entry.holders.size > 0) return;
    // Nothing to keep warm for a key with no attachment and no attach running.
    if (entry.status === "lost" || (entry.attachment === null && !entry.attaching)) {
      this.#dropEntry(entry);
      return;
    }
    this.#armGrace(entry);
  }

  retryEntry(entry: PoolEntry<TFrame>): void {
    if (this.#disposed || this.#entries.get(entry.key) !== entry) return;
    this.#reconcile(entry);
    if (entry.attaching || entry.attachment !== null) return;
    this.#cancelGrace(entry);
    this.#startAttach(entry);
  }

  // ── attach ────────────────────────────────────────────────────────────────

  /**
   * One attach per entry, ever in flight.
   *
   * The generation stamp is what makes that true in the face of async: an
   * attach whose entry was retried, dropped or disposed while it was awaiting
   * resolves into a pool that no longer wants it, sees the mismatch, and
   * disposes the attachment rather than installing it.
   */
  #startAttach(entry: PoolEntry<TFrame>): void {
    entry.generation += 1;
    const generation = entry.generation;
    entry.attaching = true;
    entry.status = "attaching";
    entry.failure = null;
    entry.error = null;
    this.#notify(entry);

    void (async () => {
      let stage: SurfacePoolFailure = "transport";
      try {
        const transport = await this.#transport;
        stage = "mint";
        const ticket = await entry.tickets.mint();
        entry.mints += 1;
        this.#mints += 1;
        stage = "attach";
        // The ticket is spent here and never stored: from this line on the pool
        // holds an attachment, and nothing that can be serialized holds a token.
        const attachment = await transport.attach(ticket);
        this.#attached(entry, generation, attachment);
      } catch (error) {
        this.#attachFailed(entry, generation, stage, toError(error));
      }
    })();
  }

  #attached(
    entry: PoolEntry<TFrame>,
    generation: number,
    attachment: LiveSurfaceRendererAttachment<TFrame>,
  ): void {
    const stale =
      this.#disposed || generation !== entry.generation || this.#entries.get(entry.key) !== entry;
    if (stale) {
      disposeQuietly(attachment);
      return;
    }
    entry.attaching = false;
    entry.attachment = attachment;
    entry.presentation = new LiveSurfacePresentation<TFrame>(attachment);
    entry.status = "live";
    entry.failure = null;
    entry.error = null;
    // A fresh attachment has heard no demand, so the fold must be re-emitted.
    entry.emittedIntent = null;
    entry.emittedDemand = null;
    // Registered last: `onSummary` calls back synchronously, and the entry must
    // already read as live before the pool can be asked to reconcile it.
    entry.unobserve = attachment.onSummary(() => this.#reconcile(entry));
    this.#projectDemand(entry);
    if (entry.holders.size === 0) this.#armGrace(entry);
    this.#notify(entry);
  }

  #attachFailed(
    entry: PoolEntry<TFrame>,
    generation: number,
    stage: SurfacePoolFailure,
    error: Error,
  ): void {
    if (this.#disposed || generation !== entry.generation) return;
    if (this.#entries.get(entry.key) !== entry) return;
    entry.attaching = false;
    entry.status = "lost";
    entry.failure = stage;
    entry.error = error;
    entry.emittedIntent = null;
    entry.emittedDemand = null;
    this.#cancelGrace(entry);
    if (entry.holders.size === 0) {
      this.#dropEntry(entry);
      return;
    }
    this.#notify(entry);
  }

  // ── loss, grace and teardown ──────────────────────────────────────────────

  /**
   * Re-read the transport's truth and act on it.
   *
   * Idempotent, which is also its re-entrancy guard: a listener that calls back
   * into the pool from inside a notification finds an entry already marked
   * lost and stops there.
   */
  #reconcile(entry: PoolEntry<TFrame>): void {
    const attachment = entry.attachment;
    if (attachment === null || !attachment.closed) return;
    this.#teardown(entry);
    entry.status = "lost";
    entry.failure = "host-close";
    entry.error = new Error(`the host closed live surface attachment for "${entry.key}"`);
    if (entry.holders.size === 0 && this.#entries.get(entry.key) === entry) {
      this.#entries.delete(entry.key);
      return;
    }
    this.#notify(entry);
  }

  #armGrace(entry: PoolEntry<TFrame>): void {
    if (entry.cancelGrace !== null || this.#disposed) return;
    entry.graceDeadlineAt = this.#now() + this.#graceMs;
    entry.cancelGrace = this.#timers.arm(() => {
      entry.cancelGrace = null;
      entry.graceDeadlineAt = null;
      if (entry.holders.size > 0) return;
      this.#dropEntry(entry);
    }, this.#graceMs);
  }

  #cancelGrace(entry: PoolEntry<TFrame>): void {
    const cancel = entry.cancelGrace;
    entry.cancelGrace = null;
    entry.graceDeadlineAt = null;
    if (cancel !== null) cancel();
  }

  /** Release the attachment and its observation. Leaves the entry in the map. */
  #teardown(entry: PoolEntry<TFrame>): void {
    this.#cancelGrace(entry);
    const unobserve = entry.unobserve;
    entry.unobserve = null;
    if (unobserve !== null) unobserve();
    const presentation = entry.presentation;
    const attachment = entry.attachment;
    entry.presentation = null;
    entry.attachment = null;
    entry.emittedIntent = null;
    entry.emittedDemand = null;
    // Disposing the presentation detaches the attachment under it, so the
    // attachment is only disposed directly when there is no presentation.
    if (presentation !== null) disposeQuietly(presentation);
    else if (attachment !== null) disposeQuietly(attachment);
  }

  #dropEntry(entry: PoolEntry<TFrame>): void {
    this.#teardown(entry);
    if (this.#entries.get(entry.key) === entry) this.#entries.delete(entry.key);
  }

  // ── demand ────────────────────────────────────────────────────────────────

  /**
   * Fold the holders and, if the fold moved, write it at a fresh revision.
   *
   * `nextRevision` lives on the ENTRY and survives re-attaches. A counter reset
   * per attachment would be legal for a host that tracks demand by attachment
   * and a protocol conflict for one that tracks it by surface — the same
   * revision arriving twice with different content is exactly what
   * `LiveSurfaceDemandTracker` raises as a conflict. Never reusing a number
   * costs nothing and is right for both readers.
   *
   * Demand declared before an attachment exists is HELD, not lost: the fold is
   * re-emitted the moment one lands.
   */
  #projectDemand(entry: PoolEntry<TFrame>): void {
    const attachment = entry.attachment;
    if (attachment === null || attachment.closed) return;
    const folded =
      coalesceSurfaceDemand([...entry.holders].map((handle) => handle.intent)) ??
      IDLE_SURFACE_DEMAND;
    if (entry.emittedIntent !== null && surfaceDemandIntentsEqual(entry.emittedIntent, folded)) {
      return;
    }
    const revision = entry.nextRevision;
    entry.nextRevision += 1;
    const demand = toWireDemand(folded, revision);
    try {
      attachment.setDemand(demand);
    } catch {
      // The port died under us. The revision is spent — deliberately: the next
      // successful write takes a NEW one rather than reusing a number the host
      // may already have seen.
      this.#reconcile(entry);
      return;
    }
    entry.emittedIntent = folded;
    entry.emittedDemand = demand;
  }

  #notify(entry: PoolEntry<TFrame>): void {
    for (const handle of [...entry.holders]) handle.notify();
  }
}

/**
 * Best-effort disposal (transport fact 2): `detach` rides a control port that
 * may already be gone, and `dispose()` rethrows when the post fails. The
 * attachment is closed either way by then, so the pool drops it regardless.
 */
function disposeQuietly(disposable: { dispose(): void }): void {
  try {
    disposable.dispose();
  } catch {
    // The port died before it could carry the detach. Nothing left to release.
  }
}

/** Build a per-window surface pool over an already-claimed transport. */
export function createSurfacePool<TFrame extends LiveSurfaceClosableFrame>(
  deps: SurfacePoolDeps<TFrame>,
): SurfacePool<TFrame> {
  return new SurfaceAttachmentPool<TFrame>(deps);
}
