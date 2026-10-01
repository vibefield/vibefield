import { createNoopLogger, type Logger } from "@vibefield/logging";

// FederatedSubscriptionManager (C6-5, design-04 §6/D35) — the subscription
// half of the `device?` convention. A local subscriber to a foreign device's
// topic gets a PROXY: this manager holds ONE standing upstream subscription
// per {device, method, params} (ref-counted — the D35 bound on upstream
// fan-out), relays snapshot and delta frames with their kinds intact, and
// owns recovery when the link under it is torn down.
//
// Recovery is two-tier, deliberately:
//   · a socket blip / peer restart never reaches this file — FielddClient
//     re-dials and replays its subscription table with a FRESH snapshot (the
//     P5 law), which arrives here as an ordinary kind:"snapshot" event and is
//     relayed like any other. "Peer reconnect ⇒ re-snapshot" is the client's
//     existing behaviour, not new machinery;
//   · a LINK death (a unary forward's timeout dropping the shared link, an
//     incompatible pin, dispose) orphans the client-side subscription — the
//     link's onDrop lands here, and the manager re-subscribes (re-dialing)
//     with capped backoff while local subscribers remain.
// *Corrected 2026-10-01 (the DS landing review, S3):* a peer restart DOES
// reach this file when the restarted peer refuses the replay — PeerLink hands
// that one subscription back through its onDrop (the link stands), and the
// recovery below re-subscribes on its backoff. Both re-asks, the client's
// replay and the recovery, read `paramsForResubscribe`: a reader's CURRENT
// view (a cursor), where they used to repeat the params the entry was opened
// with.
//
// Frames that beat the open answer (the 23:47 ruling of 2026-09-30, fixed at
// the landing fix-up of 2026-10-01): FielddClient routes the frames a source
// sends right behind its reply — ProductAPI's `start` hook: later snapshot
// pages, a resume's catch-up, per-device frames — BEFORE the awaiting
// subscribe resumes. They used to be broadcast to the members of that moment:
// lost to the newcomer, and heard by existing members before the snapshot they
// follow. Now an upstream's early frames are held until its open answer is
// taken. Existing members hear the snapshot, then them; the newcomer gets the
// snapshot as its result and them through `start()` — which ProductAPI calls
// right after its reply, as it does for a local producer — or, at the latest,
// just before the next frame. Nothing lost, nothing out of order, nothing sent
// before the reply that routes it.
//
// During an outage the proxy goes QUIET — no synthetic rows, no invented
// payloads. That is design-04 §6's sanctioned semantics: the ROSTER carries
// peer liveness ("federated topics simply lack that device's rows"); a topic
// stream only ever carries what the peer actually said.

/** The one PeerLink capability this manager needs (kept narrow — provable
 * against fakes, the doc-sync precedent). */
export interface UpstreamLink {
  subscribe(
    deviceId: string,
    method: string,
    params: unknown,
    onEvent: (payload: unknown, kind: "snapshot" | "delta") => void,
    onDrop: () => void,
    /** S3 — `params` is read when a socket blip's replay is sent */
    opts?: { params?: () => unknown },
  ): Promise<{ snapshot: unknown; unsubscribe: () => void }>;
}

export interface FederatedSubsOptions {
  link: UpstreamLink;
  logger?: Logger;
  /** retry floor/ceiling for link-death recovery (tests compress these) */
  retryMinMs?: number;
  retryMaxMs?: number;
}

/** A reader's choices (`attach`). */
export interface FederatedAttachOptions {
  /** What a re-subscribe asks with — after a link death, and in a socket
   * blip's replay — read at that moment: a resumable reader's CURRENT cursor.
   * Every member of one upstream has heard the same frames since its last
   * snapshot, so the first member that supplies one speaks for all. Default:
   * the params the entry was opened with. */
  paramsForResubscribe?: () => unknown;
}

/** A reader's handle (`attach`). */
export interface FederatedAttachment {
  snapshot: unknown;
  dispose: () => void;
  /** Hands over what the upstream sent right behind this reader's snapshot.
   * Call it once the snapshot is taken — ProductAPI does, right after its
   * reply. Idempotent; until it is called those frames wait, and at the
   * latest they go just before the next frame. */
  start: () => void;
}

type Emit = (payload: unknown, kind?: "delta" | "snapshot") => void;
type Frame = readonly [payload: unknown, kind: "snapshot" | "delta"];

interface Member {
  emit: Emit;
  paramsForResubscribe?: () => unknown;
  /** frames waiting for this reader's `start` (null = live) */
  held: Frame[] | null;
}

interface Entry {
  device: string;
  method: string;
  params: unknown;
  members: Set<Member>;
  upstream: { unsubscribe: () => void } | null;
  /** bumped per upstream subscribe (and at the drop): a superseded upstream's
   * frames and link death are ignored */
  generation: number;
  /** what the upstream being opened sent before its open answer was taken
   * (null = none is being opened) */
  early: Frame[] | null;
  /** attaches queued or in flight: an entry is never dropped under one */
  pending: number;
  /** per-entry serialisation: attaches, swaps and recoveries never interleave */
  chain: Promise<unknown>;
  retry: ReturnType<typeof setTimeout> | null;
  backoffMs: number;
}

/** Key-stable stringify: two callers spelling the same params in different
 * key orders share one upstream. */
function canonical(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(canonical);
  if (v !== null && typeof v === "object") {
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(v as object).sort()) {
      out[k] = canonical((v as Record<string, unknown>)[k]);
    }
    return out;
  }
  return v;
}

export class FederatedSubscriptionManager {
  readonly #link: UpstreamLink;
  readonly #logger: Logger;
  readonly #retryMinMs: number;
  readonly #retryMaxMs: number;
  readonly #entries = new Map<string, Entry>();
  #disposed = false;

  constructor(opts: FederatedSubsOptions) {
    this.#link = opts.link;
    this.#logger = (opts.logger ?? createNoopLogger()).child({ component: "federated.subs" });
    this.#retryMinMs = opts.retryMinMs ?? 1_000;
    this.#retryMaxMs = opts.retryMaxMs ?? 30_000;
  }

  /** ProductApi's DeviceSubscriptionForwarder. Params forward WHOLE (device
   * key included) — the remote end's own `device === self` strip serves them
   * locally, exactly like the unary path; nothing is rewritten in flight. */
  async attach(
    device: string,
    method: string,
    params: unknown,
    emit: Emit,
    opts?: FederatedAttachOptions,
  ): Promise<FederatedAttachment> {
    if (this.#disposed) throw new Error("federated subscriptions disposed");
    const key = `${device}\u0000${method}\u0000${JSON.stringify(canonical(params) ?? null)}`;
    let entry = this.#entries.get(key);
    if (entry === undefined) {
      entry = {
        device,
        method,
        params,
        members: new Set(),
        upstream: null,
        generation: 0,
        early: null,
        pending: 0,
        chain: Promise.resolve(),
        retry: null,
        backoffMs: this.#retryMinMs,
      };
      this.#entries.set(key, entry);
    }
    const settled = entry;
    const member: Member = {
      emit,
      held: null,
      ...(opts?.paramsForResubscribe !== undefined
        ? { paramsForResubscribe: opts.paramsForResubscribe }
        : {}),
    };
    settled.pending += 1;
    const job = settled.chain.then(async () => {
      // Every attach RE-SNAPSHOTS the shared upstream rather than handing the
      // newcomer a cached payload: a fresh subscribe is the only snapshot that
      // is correct for incremental topics too, and the swap keeps exactly one
      // upstream standing. Old first — a stale delta arriving AFTER the new
      // snapshot would corrupt an incremental stream, while deltas missed in
      // the gap are covered BY that snapshot.
      settled.upstream?.unsubscribe();
      settled.upstream = null;
      const sub = await this.#open(key, settled, params);
      if (this.#entries.get(key) !== settled) {
        sub.unsubscribe(); // the manager closed while the subscribe was in flight
        throw new Error("federated subscriptions disposed");
      }
      settled.upstream = sub;
      settled.backoffMs = this.#retryMinMs;
      if (settled.retry !== null) {
        // a recovery waiting on its backoff would orphan this upstream
        clearTimeout(settled.retry);
        settled.retry = null;
      }
      // Existing members hear the fresh snapshot as a stream event, then what
      // followed it on the wire. The newcomer is added AFTER, so nobody hears
      // their own snapshot twice: it gets the snapshot as its result, and what
      // followed it once its caller has taken the snapshot (`start`).
      const early = this.#takeEarly(settled);
      this.#broadcast(settled, sub.snapshot, "snapshot");
      for (const [payload, kind] of early) this.#broadcast(settled, payload, kind);
      if (early.length > 0) member.held = [...early];
      settled.members.add(member);
      return sub.snapshot;
    });
    settled.chain = job.catch(() => {});
    let snapshot: unknown;
    try {
      snapshot = await job;
    } catch (e) {
      settled.pending -= 1;
      if (settled.members.size > 0) {
        // The swap killed the old upstream before the new one failed —
        // existing members must not be left silent with no retry standing.
        this.#recover(key);
      } else if (settled.pending === 0) {
        this.#drop(key, settled); // nobody left, and nobody queued behind
      }
      throw e;
    }
    settled.pending -= 1;
    return {
      snapshot,
      dispose: () => {
        if (!settled.members.delete(member)) return;
        member.held = null;
        if (settled.members.size === 0 && settled.pending === 0) this.#drop(key, settled);
      },
      start: () => this.#release(member),
    };
  }

  dispose(): void {
    this.#disposed = true;
    for (const [key, entry] of [...this.#entries]) this.#drop(key, entry);
  }

  /** DS-3 — how many upstreams are standing (one per {device, method,
   * params}): the witness that a reader leaving closes what it opened. */
  get size(): number {
    return this.#entries.size;
  }

  // ---- internals ----

  /** One upstream subscribe for `entry`, as a new generation: its frames are
   * held in `entry.early` until the caller takes the open answer
   * (`#takeEarly`), and a superseded generation's frames and drop are ignored.
   * A socket blip's replay asks with the readers' current params. */
  async #open(
    key: string,
    entry: Entry,
    params: unknown,
  ): Promise<{ snapshot: unknown; unsubscribe: () => void }> {
    const generation = ++entry.generation;
    const early: Frame[] = [];
    entry.early = early;
    try {
      return await this.#link.subscribe(
        entry.device,
        entry.method,
        params,
        (payload, kind) => {
          if (entry.generation !== generation) return; // a superseded upstream
          if (entry.early === early) early.push([payload, kind]);
          else this.#broadcast(entry, payload, kind);
        },
        () => {
          if (entry.generation === generation) this.#recover(key);
        },
        { params: () => this.#resubscribeParams(entry) },
      );
    } catch (error) {
      if (entry.early === early) entry.early = null;
      throw error;
    }
  }

  /** The open answer is taken: what came behind it, in order — and from here
   * the upstream's frames go straight to the members. */
  #takeEarly(entry: Entry): Frame[] {
    const early = entry.early ?? [];
    entry.early = null;
    return early;
  }

  /** What a re-subscribe asks with: the first member's own supplier, else
   * the params the entry was opened with. */
  #resubscribeParams(entry: Entry): unknown {
    for (const member of entry.members) {
      if (member.paramsForResubscribe === undefined) continue;
      try {
        return member.paramsForResubscribe();
      } catch (error) {
        this.#logger.warn(
          "fieldd.federated_subs.params_failed",
          "A reader's resubscribe params threw; the entry's own params are used",
          { error: String(error) },
        );
        break;
      }
    }
    return entry.params;
  }

  #broadcast(entry: Entry, payload: unknown, kind: "snapshot" | "delta"): void {
    for (const member of entry.members) {
      // a reader still holding what came behind its snapshot hears that first
      if (member.held !== null) this.#release(member);
      this.#emit(member, payload, kind);
    }
  }

  /** `start`: what the upstream sent behind this reader's snapshot, in order. */
  #release(member: Member): void {
    const held = member.held;
    if (held === null) return;
    member.held = null;
    for (const [payload, kind] of held) this.#emit(member, payload, kind);
  }

  #emit(member: Member, payload: unknown, kind: "snapshot" | "delta"): void {
    try {
      member.emit(payload, kind);
    } catch (error) {
      // a subscriber's failure is its own — the fan-out must complete
      this.#logger.warn("fieldd.federated_subs.emit_failed", "A subscriber's emit threw", {
        error: String(error),
      });
    }
  }

  /** Link death: the client-side subscription is gone. Re-subscribe (which
   * re-dials) while members remain; back off while the peer stays gone. The
   * stream is QUIET in between — the roster carries liveness, never this. */
  #recover(key: string): void {
    const entry = this.#entries.get(key);
    if (entry === undefined || this.#disposed) return;
    entry.upstream = null;
    entry.chain = entry.chain
      .catch(() => {})
      .then(async () => {
        if (this.#entries.get(key) !== entry || entry.members.size === 0) return;
        try {
          const sub = await this.#open(key, entry, this.#resubscribeParams(entry));
          if (this.#entries.get(key) !== entry || entry.members.size === 0) {
            // every reader left (or the manager closed) while it re-subscribed
            this.#takeEarly(entry);
            sub.unsubscribe();
            return;
          }
          entry.upstream = sub;
          entry.backoffMs = this.#retryMinMs;
          const early = this.#takeEarly(entry);
          this.#broadcast(entry, sub.snapshot, "snapshot");
          for (const [payload, kind] of early) this.#broadcast(entry, payload, kind);
          this.#logger.info(
            "fieldd.federated_subs.recovered",
            "A federated subscription re-attached after its link dropped",
            { device: entry.device, method: entry.method },
          );
        } catch (error) {
          const delay = entry.backoffMs;
          entry.backoffMs = Math.min(entry.backoffMs * 2, this.#retryMaxMs);
          entry.retry = setTimeout(() => {
            entry.retry = null;
            this.#recover(key);
          }, delay);
          entry.retry.unref?.();
          this.#logger.info(
            "fieldd.federated_subs.retry_scheduled",
            "A federated subscription could not re-attach; retrying",
            { device: entry.device, method: entry.method, delayMs: delay, error: String(error) },
          );
        }
      });
  }

  /** Retire `entry` (removed from the table only if it is still the one there). */
  #drop(key: string, entry: Entry): void {
    if (this.#entries.get(key) === entry) this.#entries.delete(key);
    entry.generation += 1; // nothing it hears from here counts
    entry.early = null;
    if (entry.retry !== null) clearTimeout(entry.retry);
    entry.retry = null;
    entry.upstream?.unsubscribe();
    entry.upstream = null;
    for (const member of entry.members) member.held = null;
    entry.members.clear();
  }
}
