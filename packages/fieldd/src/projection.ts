// SP-1 — the projection helper (SP-L4, `thinking-sync-planes.md` §3 and §6;
// design-06 §2.2). Every subscription a phone or a peer daemon may open is a
// PROJECTION: a snapshot that carries a revision, then frames at a
// per-subscriber trailing-edge floor, nothing at all while the projection is
// still, and a lost frame repaired by a fresh snapshot rather than a delta the
// subscriber can no longer apply. `agent-field.ts` was the template (MF-1's
// `FieldProjection`, `createFieldSubscription`, `diffFieldRows`); this file is
// that machinery with the field taken out of it, so the roster, the artifact
// catalog and the next doors get the same floor instead of one each.
//
// Three parts, each usable alone:
//
//   · `projectRows` — a source's items projected into rows KEYED by a string,
//     each stamped by its projected JSON. A row's own revision bumps only when
//     its projection changed, and the table's revision bumps once per apply
//     that carried a change — which is why a source that only churns what the
//     projection drops (a usage sample, a lastSeenAt) costs a reader nothing.
//   · `diffRows` — upserts and removals between two keyed boards.
//   · `RevisionedSubscription` — ONE subscriber: the open answer now, then
//     frames at this subscriber's own floor. Two subscribers of one source at
//     250 ms and 100 ms each get their own cadence and their own revision
//     chain; nothing here is shared between them but the source.
//
// The floor is TRAILING-EDGE, exactly as the fold's 16 ms tick and MF-1's field
// floor are: the first change opens a window, every change inside it lands in
// the one frame that leaves when it closes, and a change is never dropped —
// only held. A window whose changes cancel out sends nothing.
//
// What a frame IS belongs to the view (`RevisionedView`), so one subscription
// machine serves all three of the registry's shapes (`methods.ts`
// SUBSCRIPTION_SHAPES): `snapshotDeltaView` speaks the field's
// `{epoch?, revision, rows}` / `{epoch?, since, revision, upserts, removed}`
// pair, and `wholeValueView` speaks a stream of whole values whose wire stays
// exactly what it was (the roster as `DeviceInfo[]`, the catalog as
// `ArtifactView[]`).

import { PRODUCT_API_LIMITS } from "@vibefield/contracts";

/** A frame's kind on the door: `<base>.delta` or `<base>.snapshot`. */
export type FrameKind = "delta" | "snapshot";

/** A reader's asked cadence, served at the door's floor: slower is honoured,
 * faster never is (SP-1 — a declared floor that a caller can undercut is a
 * default, and the registry declares floors). */
export function atFloor(askedMs: number | undefined, floorMs: number): number {
  return Math.max(askedMs ?? floorMs, floorMs);
}

// ── diffRows ──

/** What moved between two keyed boards: the rows of `next` that are new or
 * not `same` as their predecessor (in `next`'s order), and the keys of `prev`
 * that `next` no longer has (in `prev`'s order). */
export interface RowsDiff<T> {
  upserts: T[];
  removed: string[];
}

/** JSON equality — the default notion of "unchanged". */
export function sameJson(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

export function diffRows<T>(
  prev: readonly T[],
  next: readonly T[],
  keyOf: (row: T) => string,
  same: (before: T, after: T) => boolean = sameJson,
): RowsDiff<T> {
  const before = new Map(prev.map((row) => [keyOf(row), row]));
  const upserts: T[] = [];
  for (const row of next) {
    const key = keyOf(row);
    const prior = before.get(key);
    if (prior === undefined || !same(prior, row)) upserts.push(row);
    before.delete(key);
  }
  return { upserts, removed: [...before.keys()] };
}

// ── projectRows ──

/** A table as a reader holds it: its revision, and its rows. */
export interface RowsTable<R> {
  revision: number;
  rows: R[];
}

/** What one apply moved, chained: a reader at `since` reaches `revision` by
 * applying `upserts` then `removed` (the rows' KEYS). */
export interface RowsChange<R> {
  since: number;
  revision: number;
  upserts: R[];
  removed: string[];
}

export interface RowsProjectionOptions<S, P, R extends object> {
  /** one source item → its projected row (the ONLY place that reads the
   * source's shape) */
  project: (item: S) => P;
  /** the projected row's key within the table */
  keyOf: (row: P) => string;
  /** the row as it is sent, given its own revision (the field writes it into
   * the row; a table whose rows carry none passes the row through) */
  stamp: (row: P, rowRevision: number) => R;
}

interface Entry<R> {
  readonly key: string;
  readonly rowRevision: number;
  readonly row: R;
}

/** A source's items as a keyed table with the revisions that make deltas
 * possible. One per READER: the revision chain is per subscriber, so nothing
 * has to reason about what a second reader has already seen. */
export class RowsProjection<S, P, R extends object> {
  #entries: Entry<R>[] = [];
  /** the projected JSON each row's revision was last stamped for */
  readonly #stamps = new Map<string, string>();
  #revision = 0;
  readonly #opts: RowsProjectionOptions<S, P, R>;

  constructor(opts: RowsProjectionOptions<S, P, R>) {
    this.#opts = opts;
  }

  /** The table as it stands, as copies: a consumer cannot mutate the board
   * this projection will diff against. */
  snapshot(): RowsTable<R> {
    return { revision: this.#revision, rows: this.#entries.map((entry) => ({ ...entry.row })) };
  }

  get revision(): number {
    return this.#revision;
  }

  /** Fold in the source's items as they are now. The change when the
   * PROJECTION moved, `null` when it did not — the whole reason an idle
   * table sends nothing. */
  apply(items: Iterable<S>): RowsChange<R> | null {
    const since = this.#revision;
    const previous = new Map(this.#entries.map((entry) => [entry.key, entry]));
    const next: Entry<R>[] = [];
    const seen = new Set<string>();
    for (const item of items) {
      const projected = this.#opts.project(item);
      const key = this.#opts.keyOf(projected);
      seen.add(key);
      const stamp = JSON.stringify(projected);
      const prior = previous.get(key);
      if (prior !== undefined && this.#stamps.get(key) === stamp) {
        next.push(prior);
        continue;
      }
      this.#stamps.set(key, stamp);
      // a row that left and came back starts its own count again at 1
      const rowRevision = (prior?.rowRevision ?? 0) + 1;
      next.push({ key, rowRevision, row: this.#opts.stamp(projected, rowRevision) });
    }
    for (const key of this.#stamps.keys()) if (!seen.has(key)) this.#stamps.delete(key);

    const diff = diffRows(
      this.#entries,
      next,
      (entry) => entry.key,
      (before, after) => before.rowRevision === after.rowRevision,
    );
    this.#entries = next;
    if (diff.upserts.length === 0 && diff.removed.length === 0) return null;
    this.#revision = since + 1;
    return {
      since,
      revision: this.#revision,
      upserts: diff.upserts.map((entry) => ({ ...entry.row })),
      removed: diff.removed,
    };
  }
}

/** `projectRows` — a keyed projection of a source (see `RowsProjection`). */
export function projectRows<S, P, R extends object>(
  opts: RowsProjectionOptions<S, P, R>,
): RowsProjection<S, P, R> {
  return new RowsProjection(opts);
}

// ── RevisionedSubscription ──

/** ONE subscriber's view of a source: what its open answer is, what the next
 * frame is, and — for a shape whose readers take a replacement mid-stream —
 * what replaces its copy after a frame was lost. */
export interface RevisionedView<TOpen, TFrame> {
  /** the open answer: the source as it is now, and what the subscriber holds
   * once it lands */
  open(): TOpen;
  /** fold the source in: the frame that brings the subscriber up to date, or
   * `null` when nothing the subscriber holds moved */
  advance(): TFrame | null;
  /** the view's revision: it moves once per frame that carries a change */
  readonly revision: number;
  /** an EMPTY frame at the current revision — a heartbeat spoken into silence */
  heartbeat?(): TFrame;
  /** After a lost frame, the frame that REPLACES what the subscriber holds,
   * folded from the source as it is now, and the kind it rides. Absent: the
   * shape leaves a gap to its reader, whose own rule re-subscribes (the
   * field's wire since MF-1 — it has never carried a mid-stream snapshot).
   * *Corrected 2026-10-31 (PG-1d):* the field's view resets now
   * (`createFieldSubscription`), so the field's wire carries one: a re-present
   * on a terminal-gate flip, or the repair after a lost frame. */
  reset?(): { frame: TOpen | TFrame; kind: FrameKind };
}

export interface RevisionedSubscriptionOptions<TOpen, TFrame> {
  view: RevisionedView<TOpen, TFrame>;
  /** the source's change signal; answers its unsubscribe. The signal says only
   * that something MAY have moved — the view decides whether anything did.
   * MV-3a (L12) — a signal may say it is URGENT (what a person waits on moved):
   * when the floor has already elapsed since the last frame the frame goes out
   * at once, leading-edge; inside the floor it waits the window out like any
   * other. A source that never says so keeps the trailing-edge floor exactly. */
  subscribe: (onChange: (urgent?: boolean) => void) => () => void;
  /** one frame to this subscriber */
  emit: (frame: TOpen | TFrame, kind: FrameKind) => void;
  /** this subscriber's trailing-edge floor, in ms */
  minIntervalMs: number;
  /** after this long with no frame, the view's heartbeat (DS-3); absent: none */
  heartbeatMs?: number;
  /** a throwing consumer or a source that failed to read: logged, never thrown
   * into the source's publish */
  onError?: (error: unknown) => void;
  /** Item 60 — a snapshot too large for one frame, as the frames that carry it
   * (the rows protocol's pages, rows-pages.ts). The open answer is the first;
   * the rest are owed to `sendRest`, which the owner calls once the open
   * answer has gone. A reset goes out as all of them, in order. One page, or
   * absent: a snapshot is one frame, as the view built it. */
  pages?: (snapshot: TOpen) => TOpen[];
}

/**
 * One subscriber of one source: `snapshot` now, then frames at this
 * subscriber's own trailing-edge floor.
 *
 *  · idle sends nothing: no signal, no timer; a signal whose window ends where
 *    it started (the view's `advance` answers null) sends nothing either;
 *  · the floor holds under churn: one frame per window, however loudly the
 *    source signals inside it;
 *  · a GAP resnapshots: a frame that could not be delivered (the consumer
 *    threw) leaves the subscriber holding a state its next delta would not
 *    chain from, so — when the view can say what replaces a copy — the next
 *    frame is that replacement, never a delta built on a revision it never
 *    got. `resnapshot()` asks for the same from outside (a source that knows
 *    it broke its own continuity).
 */
export class RevisionedSubscription<TOpen, TFrame> {
  /** the open answer (its first page, when the snapshot is paged) */
  readonly snapshot: TOpen;
  readonly #opts: RevisionedSubscriptionOptions<TOpen, TFrame>;
  /** the open's remaining pages, until `sendRest` */
  #rest: TOpen[];
  readonly #unsubscribe: () => void;
  #timer: ReturnType<typeof setTimeout> | null = null;
  #beat: ReturnType<typeof setTimeout> | null = null;
  #gap = false;
  #disposed = false;
  /** ms — when a frame last went out (the open counts), for the urgent edge */
  #lastFrameAt: number;

  constructor(opts: RevisionedSubscriptionOptions<TOpen, TFrame>) {
    this.#opts = opts;
    const [first, ...rest] = this.#paged(opts.view.open());
    this.snapshot = first as TOpen;
    this.#rest = rest;
    this.#lastFrameAt = Date.now();
    this.#unsubscribe = opts.subscribe((urgent) => this.#schedule(urgent === true));
    this.#armBeat();
  }

  /** the view's revision: what this subscriber holds once every frame sent
   * so far has landed */
  get revision(): number {
    return this.#opts.view.revision;
  }

  /** whether the next frame will replace the subscriber's copy */
  get gapped(): boolean {
    return this.#gap;
  }

  /** The open's remaining pages, in order, as `snapshot` frames: what the open
   * answer promised with its `more`. Once; a page that does not land opens a
   * gap, which a view that can reset repairs with a whole new snapshot. */
  sendRest(): void {
    const rest = this.#rest;
    this.#rest = [];
    if (this.#disposed) return;
    for (const page of rest) if (!this.#deliver(page, "snapshot")) return;
  }

  /** The next frame replaces the subscriber's copy (at the floor, like any
   * frame). A view with no `reset` leaves gaps to its reader: a no-op. */
  resnapshot(): void {
    if (this.#disposed || this.#opts.view.reset === undefined) return;
    this.#gap = true;
    this.#schedule();
  }

  dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    if (this.#timer !== null) clearTimeout(this.#timer);
    if (this.#beat !== null) clearTimeout(this.#beat);
    this.#timer = null;
    this.#beat = null;
    this.#unsubscribe();
  }

  #schedule(urgent = false): void {
    if (this.#disposed) return;
    // L12 — the leading edge: an urgent change with the floor already elapsed
    // since the last frame goes out now, not a window later. A gap is repaired
    // on the floor as before (a replacement is never hurried).
    if (urgent && !this.#gap && Date.now() - this.#lastFrameAt >= this.#opts.minIntervalMs) {
      if (this.#timer !== null) {
        clearTimeout(this.#timer);
        this.#timer = null;
      }
      this.#flush();
      return;
    }
    if (this.#timer !== null) return;
    this.#timer = setTimeout(() => this.#flush(), this.#opts.minIntervalMs);
    this.#timer.unref?.();
  }

  #flush(): void {
    this.#timer = null;
    if (this.#disposed) return;
    if (this.#gap) {
      this.#repair();
      return;
    }
    let frame: TFrame | null;
    try {
      frame = this.#opts.view.advance();
    } catch (error) {
      this.#opts.onError?.(error);
      return;
    }
    if (frame === null) return;
    this.#deliver(frame, "delta");
  }

  /** the replacement after a gap; the gap closes only once it is delivered */
  #repair(): void {
    const reset = this.#opts.view.reset;
    if (reset === undefined) {
      this.#gap = false;
      return;
    }
    let replacement: { frame: TOpen | TFrame; kind: FrameKind };
    try {
      replacement = reset.call(this.#opts.view);
    } catch (error) {
      this.#opts.onError?.(error);
      return;
    }
    // a snapshot replacement goes out in its pages; the gap closes only once
    // the last of them has landed, and a page that does not land stops the rest
    const frames =
      replacement.kind === "snapshot"
        ? this.#paged(replacement.frame as TOpen)
        : [replacement.frame];
    for (const frame of frames) if (!this.#deliver(frame, replacement.kind)) return;
    this.#gap = false;
  }

  /** A snapshot that fits one page goes out as the view built it, its wire
   * unchanged; only one that does not is sent as its pages. */
  #paged(snapshot: TOpen): TOpen[] {
    const pages = this.#opts.pages?.(snapshot);
    return pages === undefined || pages.length <= 1 ? [snapshot] : pages;
  }

  /** One frame out. A frame that does not land opens a gap — for a view that
   * can repair one. The heartbeat is re-armed by every frame, delivered or
   * not, so it only ever speaks into silence. */
  #deliver(frame: TOpen | TFrame, kind: FrameKind): boolean {
    let delivered = true;
    this.#lastFrameAt = Date.now();
    try {
      this.#opts.emit(frame, kind);
    } catch (error) {
      delivered = false;
      if (this.#opts.view.reset !== undefined) this.#gap = true;
      this.#opts.onError?.(error);
    }
    this.#armBeat();
    return delivered;
  }

  #armBeat(): void {
    const every = this.#opts.heartbeatMs;
    if (every === undefined || this.#disposed || this.#opts.view.heartbeat === undefined) return;
    if (this.#beat !== null) clearTimeout(this.#beat);
    this.#beat = setTimeout(() => {
      this.#beat = null;
      if (this.#disposed) return;
      // a gapped chain is repaired, never beaten on: a heartbeat would be a
      // delta the subscriber cannot chain from
      if (this.#gap) {
        this.#repair();
        return;
      }
      const heartbeat = this.#opts.view.heartbeat;
      if (heartbeat !== undefined) this.#deliver(heartbeat.call(this.#opts.view), "delta");
    }, every);
    this.#beat.unref?.();
  }
}

// ── the two views the doors use today ──

/** The field's pair (`snapshot-delta` in the registry): `{epoch?, revision,
 * rows}` then `{epoch?, since, revision, upserts, removed}`. */
export type SnapshotFrame<R> = { epoch?: string; revision: number; rows: R[] };
export type DeltaFrame<R> = {
  epoch?: string;
  since: number;
  revision: number;
  upserts: R[];
  removed: string[];
};

export interface SnapshotDeltaViewOptions<R> {
  /** the subscriber's table as it stands (already folded) */
  table: () => RowsTable<R>;
  /** fold the source in; the change, or null */
  apply: () => RowsChange<R> | null;
  /** the table's revision */
  revision: () => number;
  /** the chain's identity, stamped on every frame (DS-3, DS-L3); absent: the
   * frames carry none */
  epoch?: string;
  /** the rows a frame carries, shaped at SEND time (the field's attach gate) */
  present?: (rows: R[]) => R[];
  /** a reset rides a SNAPSHOT frame (`rows.ts` readers take one mid-stream).
   * Absent or false: gaps are the reader's (the field's wire until PG-1d,
   * 2026-10-31, when its view began to reset). */
  resets?: boolean;
}

export function snapshotDeltaView<R>(
  opts: SnapshotDeltaViewOptions<R>,
): RevisionedView<SnapshotFrame<R>, DeltaFrame<R>> {
  const stamp = opts.epoch === undefined ? {} : { epoch: opts.epoch };
  const present = opts.present ?? ((rows: R[]) => rows);
  const snapshot = (): SnapshotFrame<R> => {
    const table = opts.table();
    return { ...stamp, ...table, rows: present(table.rows) };
  };
  const view: RevisionedView<SnapshotFrame<R>, DeltaFrame<R>> = {
    open: snapshot,
    advance: () => {
      const change = opts.apply();
      if (change === null) return null;
      return { ...stamp, ...change, upserts: present(change.upserts) };
    },
    get revision() {
      return opts.revision();
    },
    heartbeat: () => {
      const revision = opts.revision();
      return { ...stamp, since: revision, revision, upserts: [], removed: [] };
    },
  };
  if (opts.resets === true)
    view.reset = () => {
      opts.apply();
      return { frame: snapshot(), kind: "snapshot" };
    };
  return view;
}

/**
 * A stream of WHOLE values (`stream` in the registry): the open answers the
 * value, and a frame is the whole value again whenever its JSON moved. The
 * newest value stands, so a lost frame is healed by sending the newest one —
 * as an ordinary frame, on the same `.delta` notification the stream has always
 * used: a reader of whole lists sees nothing new on the wire.
 */
export function wholeValueView<V>(read: () => V): RevisionedView<V, V> {
  let revision = 0;
  let sent: string | undefined;
  return {
    open: () => {
      const value = read();
      sent = JSON.stringify(value);
      return value;
    },
    advance: () => {
      const value = read();
      const json = JSON.stringify(value);
      if (json === sent) return null;
      sent = json;
      revision += 1;
      return value;
    },
    get revision() {
      return revision;
    },
    reset: () => {
      const value = read();
      sent = JSON.stringify(value);
      revision += 1;
      return { frame: value, kind: "delta" };
    },
  };
}

/** A source whose whole value can be read now, and which says when it may have
 * moved (the roster's "changed", the catalog's listener, a pushed frame). */
export interface WholeValueSource<V> {
  read(): V;
  onChange(listener: () => void): () => void;
}

/**
 * SP-1 — a whole-value door (`stream` in the registry), as ProductAPI installs
 * it: the open answers `read()`, then the WHOLE value again on `<base>.delta`
 * at most once per window per subscriber (default
 * `PRODUCT_API_LIMITS.STREAM_MIN_INTERVAL_MS`). The frames a reader of whole
 * lists has always taken, at a cadence a phone's radio can afford: a churning
 * source costs one frame per window, an unmoved one costs nothing.
 */
export function wholeValueDoor<V>(
  source: WholeValueSource<V>,
  emit: (payload: unknown, kind?: FrameKind) => void,
  opts: { minIntervalMs?: number; onError?: (error: unknown) => void } = {},
): { snapshot: V; dispose: () => void } {
  const subscriber = new RevisionedSubscription<V, V>({
    view: wholeValueView(() => source.read()),
    subscribe: (onChange) => source.onChange(onChange),
    emit: (frame, kind) => emit(frame, kind),
    minIntervalMs: opts.minIntervalMs ?? PRODUCT_API_LIMITS.STREAM_MIN_INTERVAL_MS,
    ...(opts.onError !== undefined ? { onError: opts.onError } : {}),
  });
  return { snapshot: subscriber.snapshot, dispose: () => subscriber.dispose() };
}
