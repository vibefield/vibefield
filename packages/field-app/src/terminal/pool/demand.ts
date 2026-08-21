// DEMAND (TP-L-E′) — the semantic projection, and the ledger that holds it.
//
// The law in one sentence: "unmount does not silence the source directly; it
// atomically RELEASES that view's declared demand — the source is silenced by
// demand, never by lifecycle." This module is the atomic half. It knows nothing
// about runtimes, cells or sockets: it holds `view → SourceDemand`, folds the
// views of a session into ONE aggregate, and reports the transitions of that
// aggregate to whoever is projecting them upward.
//
// v1 core profile (TP-D25): `mode ∈ {none, live}`. `snapshot` is a negotiated
// capability and is deliberately not modelled here — the ordering below would
// admit it as a middle rank the day it is negotiated, and pretending to carry it
// now would be an interim model (TP-L-F).
//
// Why a ledger and not a ref count: a count cannot answer "which views, at what
// mode", and TP-S3b's `DeclareDemand` needs the aggregate's cadence and urgency
// beside its mode. The shape is here; the wire is not.

/** The semantic mode a view asks of the SOURCE. Ordered `none < live`. */
export type SourceDemandMode = "none" | "live";

/** The rank the aggregate takes a MAX over (TP-L-E′'s algebra). */
const DEMAND_RANK: Record<SourceDemandMode, number> = { none: 0, live: 1 };

export interface SourceDemand {
  readonly mode: SourceDemandMode;
}

/** The two demands v1 can express, as values rather than object literals nobody
 * can compare. A view that wants nothing still HOLDS a binding — that is the
 * difference between "declared none" and "released", and the whole reason the
 * ledger counts views separately from the mode they ask for. */
export const NO_SOURCE_DEMAND: SourceDemand = Object.freeze({ mode: "none" });
export const LIVE_SOURCE_DEMAND: SourceDemand = Object.freeze({ mode: "live" });

/** One session's folded demand. `views` is diagnostics — never an address. */
export interface SessionDemand {
  readonly sessionId: string;
  readonly mode: SourceDemandMode;
  readonly views: number;
}

/** An aggregate that MOVED. Emitted once per fold, never per view. */
export interface SessionDemandChange {
  readonly sessionId: string;
  readonly mode: SourceDemandMode;
  readonly previous: SourceDemandMode;
}

/** The handle a view holds. Its id is opaque and never reused. */
export type ViewDemandKey = string & { readonly __viewDemandKey: unique symbol };

/**
 * The per-window demand ledger.
 *
 * Every mutator returns the aggregate change it caused, or null when the fold
 * did not move — so a caller projecting demand upward sends one message per real
 * transition rather than one per view event. `release` is the load-bearing one:
 * it drops the view from BOTH indexes and refolds in a single synchronous step,
 * so there is no instant at which a released view is still counted or a
 * half-released session reports a mode nobody asked for.
 */
export class SessionDemandLedger {
  /** view → what it asked for, and of which session. */
  readonly #views = new Map<ViewDemandKey, { sessionId: string; mode: SourceDemandMode }>();
  /** session → its live view keys. The fold's domain. */
  readonly #viewsBySession = new Map<string, Set<ViewDemandKey>>();
  /** session → the last folded mode, for change detection. */
  readonly #modeBySession = new Map<string, SourceDemandMode>();
  #nextKey = 0;

  /** Bind a view to a session at a mode. The key is fresh and never reused —
   * TP-L-C's "the session id is the only address" applies to CONSUMERS; the
   * ledger's own keys are private and say nothing about placement.
   *
   * The change rides back beside the key rather than being looked up afterwards:
   * a bind is a fold like any other (the first `live` view of a warm session
   * moves its aggregate), and a caller that had to diff the ledger itself to
   * notice would be reimplementing the fold at the call site. */
  bind(
    sessionId: string,
    demand: SourceDemand,
  ): { key: ViewDemandKey; change: SessionDemandChange | null } {
    this.#nextKey += 1;
    const key = `view-${this.#nextKey}` as ViewDemandKey;
    this.#views.set(key, { sessionId, mode: demand.mode });
    let views = this.#viewsBySession.get(sessionId);
    if (views === undefined) {
      views = new Set();
      this.#viewsBySession.set(sessionId, views);
    }
    views.add(key);
    return { key, change: this.#refold(sessionId) };
  }

  /** Re-declare one view's demand. Idempotent: an unchanged mode folds to the
   * same aggregate and reports nothing. */
  declare(key: ViewDemandKey, demand: SourceDemand): SessionDemandChange | null {
    const view = this.#views.get(key);
    if (view === undefined || view.mode === demand.mode) return null;
    view.mode = demand.mode;
    return this.#refold(view.sessionId);
  }

  /**
   * Release a view — the unmount path, and atomic by construction.
   *
   * Both indexes drop the key before the refold reads either of them, so the
   * aggregate this returns is computed against a ledger the released view has
   * already left. Releasing twice is a no-op rather than an error: React can
   * run a cleanup after the thing it cleans up is already gone (a StrictMode
   * double-invoke, a generation swap mid-flight), and an idempotent release is
   * how that stops being a correctness question.
   */
  release(key: ViewDemandKey): SessionDemandChange | null {
    const view = this.#views.get(key);
    if (view === undefined) return null;
    this.#views.delete(key);
    const views = this.#viewsBySession.get(view.sessionId);
    views?.delete(key);
    if (views !== undefined && views.size === 0) this.#viewsBySession.delete(view.sessionId);
    return this.#refold(view.sessionId);
  }

  /** The aggregate for one session. `none` for a session nobody has bound. */
  modeFor(sessionId: string): SourceDemandMode {
    return this.#modeBySession.get(sessionId) ?? "none";
  }

  /** Every session with at least one bound view, folded. Sorted by id so a
   * snapshot is comparable across reads without a caller sorting it. */
  sessions(): SessionDemand[] {
    return [...this.#viewsBySession.entries()]
      .map(([sessionId, views]) => ({
        sessionId,
        mode: this.modeFor(sessionId),
        views: views.size,
      }))
      .sort((left, right) => (left.sessionId < right.sessionId ? -1 : 1));
  }

  /** The sessions a source must actually be advancing. TP-R1 reads this. */
  liveSessionIds(): string[] {
    return this.sessions()
      .filter((session) => session.mode === "live")
      .map((session) => session.sessionId);
  }

  /** How many views are bound, at any mode. Zero after every view unmounts is
   * the leak check: this ledger outlives React, so nothing else would notice. */
  viewCount(): number {
    return this.#views.size;
  }

  /**
   * Drop EVERY binding, reporting each session that fell to `none`.
   *
   * Used when the transport under the ledger is replaced or disposed: demand is
   * declared against a runtime, and demand that outlived its runtime would be a
   * claim about a source nothing is connected to.
   */
  clear(): SessionDemandChange[] {
    const changes: SessionDemandChange[] = [];
    for (const [sessionId, previous] of this.#modeBySession) {
      if (previous !== "none") changes.push({ sessionId, mode: "none", previous });
    }
    this.#views.clear();
    this.#viewsBySession.clear();
    this.#modeBySession.clear();
    return changes.sort((left, right) => (left.sessionId < right.sessionId ? -1 : 1));
  }

  /** The fold: MAX over the session's views, and the change it caused. */
  #refold(sessionId: string): SessionDemandChange | null {
    const views = this.#viewsBySession.get(sessionId);
    let mode: SourceDemandMode = "none";
    if (views !== undefined) {
      for (const key of views) {
        const view = this.#views.get(key);
        if (view !== undefined && DEMAND_RANK[view.mode] > DEMAND_RANK[mode]) mode = view.mode;
      }
    }
    const previous = this.#modeBySession.get(sessionId) ?? "none";
    if (mode === "none") this.#modeBySession.delete(sessionId);
    else this.#modeBySession.set(sessionId, mode);
    if (mode === previous) return null;
    return { sessionId, mode, previous };
  }
}
