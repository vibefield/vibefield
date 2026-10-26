import { createHash } from "node:crypto";
import {
  ROWS,
  type RowsCursor,
  type RowsDelta,
  type RowsDigest,
  RowsDigest as RowsDigestSchema,
  RowsResumed as RowsResumedSchema,
  type RowsSnapshot,
} from "@vibefield/contracts";
import { FRAME_OVERHEAD_BYTES, type SnapshotPage, snapshotPages } from "./rows-pages";

// DS-L3 — the rows protocol, both halves, for one `{device, table}` (design-06
// §5; `thinking-desktop-sync-plane.md` §6.1). The wire shapes are the base
// commit's (`contracts/src/rows.ts`); this file is the machinery behind them:
//
//   · CatalogTable — the SOURCE. It holds the rows, assigns the table's
//     revisions (one per frame, never per row), and keeps a bounded JOURNAL of
//     the keys each frame changed (`ROWS.JOURNAL_DEPTH` frames). A reader that
//     kept its cursor RESUMES from the journal — one catch-up delta carrying
//     the CURRENT state of every key changed since — and one whose cursor is
//     older than the journal, or from another epoch, RESETS with a snapshot
//     paged at `ROWS.SNAPSHOT_PAGE_BYTES`. The source owns the journal because
//     its own source may not have one: rosetta's `/ws/meta` has no resume and
//     no removal event (§1.6), so fieldd assigns the revisions and finds
//     removals by diffing a fresh snapshot (`replaceAll`).
//   · createRowsPump — ONE subscriber of a table: the open answer, what the
//     open promised (a catch-up delta, the rest of a paged snapshot), then
//     coalesced deltas at the subscriber's own trailing-edge floor, a reset
//     when the journal can no longer serve its position, and a periodic DIGEST
//     heartbeat when it is caught up.
//   · RowsCopy — the READER's copy. It applies the open answer and every frame
//     with one rule — a delta applies when it brackets the copy's revision —
//     and says when the reader must re-subscribe (a gap, a foreign epoch) or
//     reset (a digest that disagrees at the same cursor: a reset, never a
//     repair).
//
// Why "brackets": every delta carries the CURRENT rows of the keys it names,
// never operations, so a delta `{since: a, revision: b}` lands a copy anywhere
// in `[a, b]` at exactly `b`. That is what lets a reader re-subscribe with an
// OLD cursor — the federated manager replays the params it first attached
// with — and still apply the catch-up it gets back.
//
// The digest heartbeat rides the delta channel: a delta with `since ===
// revision`, no rows, and a `digest` member (the base's `rowsDelta` is
// `.passthrough()`, so a reader that does not know it applies a no-op). The
// source sends it only when the subscriber is caught up; the reader compares
// only at that same revision.

/** One journal frame: the revision it made and the keys it touched. */
interface JournalFrame {
  readonly revision: number;
  readonly keys: readonly string[];
}

/** A held row with its encoding: the JSON is the equality test (an unchanged
 * row makes no frame) and its byte length is the page meter. */
interface Held<Row> {
  readonly row: Row;
  readonly json: string;
  readonly bytes: number;
}

export interface CatalogTableOptions<Row> {
  /** The source's identity for the table (a fieldd boot, an index rebuild).
   * A reader's cursor from any other epoch resets. */
  epoch: string;
  /** The row's key within its `{device, table}`. */
  keyOf: (row: Row) => string;
  /** Frames the journal keeps (default `ROWS.JOURNAL_DEPTH`). */
  journalDepth?: number;
  /** A snapshot page's byte budget (default `ROWS.SNAPSHOT_PAGE_BYTES`). */
  pageBytes?: number;
}

/** A snapshot page as this table sends it: the base's shape plus which page
 * of how many it is (rows-pages.ts, the one pager). */
export type CatalogPage<Row> = SnapshotPage<RowsSnapshot<Row>, Row>;

/** What a subscribe opens with: the journal covered the cursor (and the
 * catch-up that brings the reader to the head, when anything moved), or a
 * snapshot in pages. */
export type CatalogOpenPlan<Row> =
  | {
      kind: "resumed";
      resumed: { epoch: string; revision: number };
      catchUp: RowsDelta<Row> | null;
    }
  | { kind: "snapshot"; pages: CatalogPage<Row>[] };

export class CatalogTable<Row> {
  readonly epoch: string;
  readonly pageBytes: number;
  readonly #keyOf: (row: Row) => string;
  readonly #journalDepth: number;
  #revision = 0;
  /** the lowest reader revision the journal can still resume */
  #floor = 0;
  readonly #rows = new Map<string, Held<Row>>();
  readonly #journal: JournalFrame[] = [];
  readonly #listeners = new Set<(delta: RowsDelta<Row>) => void>();

  constructor(opts: CatalogTableOptions<Row>) {
    this.epoch = opts.epoch;
    this.#keyOf = opts.keyOf;
    this.#journalDepth = Math.max(1, opts.journalDepth ?? ROWS.JOURNAL_DEPTH);
    this.pageBytes = opts.pageBytes ?? ROWS.SNAPSHOT_PAGE_BYTES;
  }

  get revision(): number {
    return this.#revision;
  }

  get size(): number {
    return this.#rows.size;
  }

  cursor(): RowsCursor {
    return { epoch: this.epoch, revision: this.#revision };
  }

  get(key: string): Row | undefined {
    return this.#rows.get(key)?.row;
  }

  has(key: string): boolean {
    return this.#rows.has(key);
  }

  /** Every row, in the table's own (insertion) order. */
  rows(): Row[] {
    return [...this.#rows.values()].map((held) => held.row);
  }

  keys(): string[] {
    return [...this.#rows.keys()];
  }

  /** Hear every frame the table makes (after it is applied). */
  onDelta(listener: (delta: RowsDelta<Row>) => void): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  /** ONE frame: `upserts` applied first, then `removed`. An upsert equal to
   * the held row and a removal of an absent key change nothing; a call that
   * changes nothing makes no frame and returns null. */
  apply(change: { upserts?: readonly Row[]; removed?: readonly string[] }): RowsDelta<Row> | null {
    /** key → the row it now holds, or null for a removal */
    const touched = new Map<string, Row | null>();
    for (const row of change.upserts ?? []) {
      const key = this.#keyOf(row);
      const json = JSON.stringify(row);
      if (this.#rows.get(key)?.json === json) continue;
      this.#rows.set(key, { row, json, bytes: Buffer.byteLength(json, "utf8") });
      touched.set(key, row);
    }
    for (const key of change.removed ?? []) {
      if (!this.#rows.delete(key)) continue;
      touched.set(key, null);
    }
    if (touched.size === 0) return null;
    this.#revision += 1;
    const keys = [...touched.keys()];
    this.#journal.push({ revision: this.#revision, keys });
    while (this.#journal.length > this.#journalDepth) {
      const evicted = this.#journal.shift();
      if (evicted !== undefined) this.#floor = evicted.revision;
    }
    const upserts: Row[] = [];
    const removed: string[] = [];
    for (const [key, row] of touched) {
      if (row === null) removed.push(key);
      else upserts.push(row);
    }
    const delta: RowsDelta<Row> = {
      epoch: this.epoch,
      since: this.#revision - 1,
      revision: this.#revision,
      upserts,
      removed,
    };
    for (const listener of [...this.#listeners]) listener(delta);
    return delta;
  }

  upsert(rows: readonly Row[]): RowsDelta<Row> | null {
    return this.apply({ upserts: rows });
  }

  remove(keys: readonly string[]): RowsDelta<Row> | null {
    return this.apply({ removed: keys });
  }

  /** Replace the whole table with a FRESH source snapshot, as one frame: a
   * row that changed or is new is upserted, a key the snapshot does not hold
   * is removed. This is how removals are found when the source has no
   * removal event. */
  replaceAll(rows: readonly Row[]): RowsDelta<Row> | null {
    const next = new Set<string>();
    for (const row of rows) next.add(this.#keyOf(row));
    const removed = [...this.#rows.keys()].filter((key) => !next.has(key));
    return this.apply({ upserts: rows, removed });
  }

  /** The journal's answer for a reader at `since`: ONE delta carrying the
   * current row of every key changed after it (`removed` for a key that is
   * gone), or null when the journal no longer reaches back that far — the
   * reader must reset. A reader at the head gets an empty delta
   * (`since === revision`). */
  deltaSince(since: number): RowsDelta<Row> | null {
    if (!Number.isInteger(since) || since < this.#floor || since > this.#revision) return null;
    const keys = new Set<string>();
    for (let at = this.#journal.length - 1; at >= 0; at -= 1) {
      const frame = this.#journal[at];
      if (frame === undefined || frame.revision <= since) break;
      for (const key of frame.keys) keys.add(key);
    }
    const upserts: Row[] = [];
    const removed: string[] = [];
    for (const key of keys) {
      const held = this.#rows.get(key);
      if (held === undefined) removed.push(key);
      else upserts.push(held.row);
    }
    return { epoch: this.epoch, since, revision: this.#revision, upserts, removed };
  }

  /** The encoded size of a delta this table made, from the held encodings. */
  deltaBytes(delta: RowsDelta<Row>): number {
    let bytes = FRAME_OVERHEAD_BYTES;
    for (const row of delta.upserts) {
      bytes += (this.#rows.get(this.#keyOf(row))?.bytes ?? 0) + 1;
    }
    for (const key of delta.removed) bytes += Buffer.byteLength(key, "utf8") + 3;
    return bytes;
  }

  /** A subscribe's opening: resume from the journal when the cursor is this
   * epoch's and the journal covers it and the catch-up fits one page;
   * otherwise a snapshot in pages. */
  open(since?: RowsCursor | undefined): CatalogOpenPlan<Row> {
    if (since !== undefined && since.epoch === this.epoch) {
      const catchUp = this.deltaSince(since.revision);
      if (catchUp !== null && this.deltaBytes(catchUp) <= this.pageBytes) {
        return {
          kind: "resumed",
          resumed: { epoch: this.epoch, revision: since.revision },
          catchUp: catchUp.revision === catchUp.since ? null : catchUp,
        };
      }
    }
    return { kind: "snapshot", pages: this.snapshotPages() };
  }

  /** The table as snapshot pages under the page budget, all at one
   * `{epoch, revision}`; every page but the last says `more: true`, and each
   * says which page of how many it is (rows-pages.ts, the one pager). A single
   * row larger than a page travels alone. An empty table is one empty page. */
  snapshotPages(): CatalogPage<Row>[] {
    return snapshotPages(
      { epoch: this.epoch, revision: this.#revision },
      this.#rows.values(),
      this.pageBytes,
    );
  }

  digest(): RowsDigest {
    return digestOfKeys(this.epoch, this.#revision, this.#rows.keys());
  }
}

/** `ROWS.DIGEST_ALGORITHM` over the sorted keys joined by "\n" — the base's
 * definition, shared by the source and every reader so the two can agree. */
export function digestOfKeys(epoch: string, revision: number, keys: Iterable<string>): RowsDigest {
  const sorted = [...keys].sort();
  const keysHash = createHash(ROWS.DIGEST_ALGORITHM).update(sorted.join("\n")).digest("hex");
  return { epoch, revision, count: sorted.length, keysHash };
}

// ── the source's subscriber ──

export type RowsEmit = (payload: unknown, kind: "delta" | "snapshot") => void;

export interface RowsPumpOptions<Row> {
  table: CatalogTable<Row>;
  /** the reader's kept cursor */
  since?: RowsCursor | undefined;
  /** the reader's trailing-edge floor on deltas (default `ROWS.MIN_INTERVAL_MS`) */
  minIntervalMs?: number | undefined;
  /** how often a caught-up reader hears the key digest (default
   * `ROWS.DIGEST_INTERVAL_MS`; 0 = never) */
  digestIntervalMs?: number | undefined;
  emit: RowsEmit;
  now?: () => number;
}

/** A subscription's three parts, in ProductAPI's `SubscriptionInstall` shape:
 * the open answer, `start` (what the answer promised, then the follow), and
 * `dispose`. */
export interface RowsPump {
  readonly open: { resumed: { epoch: string; revision: number } } | { snapshot: unknown };
  start(): void;
  dispose(): void;
}

export function createRowsPump<Row>(opts: RowsPumpOptions<Row>): RowsPump {
  const { table, emit } = opts;
  const now = opts.now ?? Date.now;
  const minIntervalMs = opts.minIntervalMs ?? ROWS.MIN_INTERVAL_MS;
  const digestIntervalMs = opts.digestIntervalMs ?? ROWS.DIGEST_INTERVAL_MS;
  const plan = table.open(opts.since);
  /** the frames the open promised, delivered by `start` */
  const owed: Array<{ payload: unknown; kind: "delta" | "snapshot" }> = [];
  /** the revision the reader holds once everything emitted so far lands */
  let sent: number;
  let open: RowsPump["open"];
  if (plan.kind === "resumed") {
    open = { resumed: plan.resumed };
    sent = plan.resumed.revision;
    if (plan.catchUp !== null) {
      owed.push({ payload: plan.catchUp, kind: "delta" });
      sent = plan.catchUp.revision;
    }
  } else {
    const [first, ...rest] = plan.pages;
    open = { snapshot: first };
    sent = first?.revision ?? table.revision;
    for (const page of rest) owed.push({ payload: page, kind: "snapshot" });
  }

  let started = false;
  let disposed = false;
  let lastFlushAt = Number.NEGATIVE_INFINITY;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let digestTimer: ReturnType<typeof setInterval> | null = null;
  let unlisten: (() => void) | null = null;

  const flush = (): void => {
    timer = null;
    if (disposed || table.revision === sent) return;
    lastFlushAt = now();
    const delta = table.deltaSince(sent);
    if (delta === null || table.deltaBytes(delta) > table.pageBytes) {
      // the journal cannot serve this reader's position, or the catch-up is
      // larger than a page: a RESET, paged like any snapshot
      for (const page of table.snapshotPages()) emit(page, "snapshot");
      sent = table.revision;
      return;
    }
    emit(delta, "delta");
    sent = delta.revision;
  };

  const schedule = (): void => {
    if (disposed || !started || timer !== null) return;
    const wait = Math.max(0, lastFlushAt + minIntervalMs - now());
    timer = setTimeout(flush, wait);
    timer.unref?.();
  };

  return {
    open,
    start(): void {
      if (started || disposed) return;
      started = true;
      for (const frame of owed.splice(0)) emit(frame.payload, frame.kind);
      unlisten = table.onDelta(() => schedule());
      if (table.revision !== sent) schedule();
      if (digestIntervalMs > 0) {
        digestTimer = setInterval(() => {
          if (disposed || timer !== null || table.revision !== sent) return;
          emit(
            {
              epoch: table.epoch,
              since: sent,
              revision: sent,
              upserts: [],
              removed: [],
              digest: table.digest(),
            },
            "delta",
          );
        }, digestIntervalMs);
        digestTimer.unref?.();
      }
    },
    dispose(): void {
      disposed = true;
      unlisten?.();
      unlisten = null;
      if (timer !== null) clearTimeout(timer);
      if (digestTimer !== null) clearInterval(digestTimer);
      timer = null;
      digestTimer = null;
    },
  };
}

// ── the reader's copy ──

/** What applying one answer or frame did to a copy. `resubscribe` asks the
 * owner to subscribe again FROM THE COPY'S CURSOR (a gap, a resumed answer
 * that is not ours); `reset` asks it to subscribe with NO cursor (a digest
 * that disagrees at the same revision, an epoch the copy cannot follow). */
export interface RowsApplied {
  changed: boolean;
  resubscribe?: "cursor" | "reset";
  /** why, for the log */
  reason?: string;
  /** DS-6b — a whole snapshot LANDED: the copy was replaced. This, and never
   * the subscribe that asked for one, is where a reset completes. */
  replaced?: true;
}

export interface RowsCopyOptions<Row> {
  keyOf: (row: Row) => string;
  /** the tolerant reader's row gate: a row it cannot read is not LISTED (and
   * is reported through `onDropped`), never the whole frame */
  parseRow: (raw: unknown) => Row | undefined;
  /** DS-6b — the KEY of a row the gate cannot read, when the raw row names
   * one. The copy keeps that key (unreadable) so its digest counts what the
   * writer holds; without it the digest disagreed at every heartbeat. */
  rawKeyOf?: (raw: unknown) => string | undefined;
  onDropped?: (raw: unknown) => void;
  /** DS-6b — deltas held for a snapshot still being assembled, at most
   * (default `ROWS.MAX_PENDING_DELTAS`); past it the copy asks for a reset */
  maxPendingDeltas?: number;
}

export interface RowsCopyState<Row> {
  epoch: string;
  revision: number;
  rows: Row[];
  /** keys the copy holds and cannot read (they count in its digest) */
  unreadable?: string[];
}

/** A snapshot page as the reader first reads it: the envelope checked, the
 * rows still raw (each goes through the copy's own row gate). */
interface RawPage {
  epoch: string;
  revision: number;
  rows: unknown[];
  more: boolean;
  /** which page of how many, when the source says (CatalogPage) */
  index: number | undefined;
  count: number | undefined;
}

/** A delta as the reader first reads it (rows raw, keys checked). */
interface RawDelta {
  epoch: string;
  since: number;
  revision: number;
  upserts: unknown[];
  removed: string[];
  digest: RowsDigest | undefined;
}

// The envelope checks are the base schemas' own rules (`rows.ts`: RowsEpoch
// 1..128 chars, RowsRevision a non-negative integer, `removed` non-empty
// strings), restated over `unknown` rows so fieldd needs no schema factory of
// its own: the ROW is what the copy's `parseRow` vouches for.
const isEpoch = (value: unknown): value is string =>
  typeof value === "string" && value.length > 0 && value.length <= 128;
const isRevision = (value: unknown): value is number =>
  typeof value === "number" && Number.isInteger(value) && value >= 0;

function asPage(value: unknown): RawPage | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  const record = value as Record<string, unknown>;
  const { epoch, revision, rows, more, page, pages } = record;
  if (!isEpoch(epoch) || !isRevision(revision) || !Array.isArray(rows)) return undefined;
  if (more !== undefined && typeof more !== "boolean") return undefined;
  // the index is a hint the base does not carry: read when it is coherent,
  // ignored (sequential `more` semantics) when it is not
  const indexed = isRevision(page) && isRevision(pages) && page < pages;
  return {
    epoch,
    revision,
    rows,
    more: more === true,
    index: indexed ? page : undefined,
    count: indexed ? pages : undefined,
  };
}

function asDelta(value: unknown): RawDelta | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  const record = value as Record<string, unknown>;
  const { epoch, since, revision, upserts, removed } = record;
  if (!isEpoch(epoch) || !isRevision(since) || !isRevision(revision)) return undefined;
  if (!Array.isArray(upserts) || !Array.isArray(removed)) return undefined;
  if (!removed.every((key) => typeof key === "string" && key.length > 0)) return undefined;
  const digest = RowsDigestSchema.safeParse(record["digest"]);
  return {
    epoch,
    since,
    revision,
    upserts,
    removed: removed as string[],
    digest: digest.success ? digest.data : undefined,
  };
}

type Classified =
  | { kind: "resumed"; epoch: string; revision: number }
  | { kind: "snapshot"; page: RawPage }
  | { kind: "delta"; delta: RawDelta }
  | { kind: "unreadable" };

/** Every spelling a rows payload arrives in: the open answer's wrappers
 * (`{resumed}`, `{snapshot}`), the frame union's (`{delta}`, `{snapshot}`),
 * and the bare page or delta a `.snapshot`/`.delta` notification carries. The
 * federated manager relays a RE-subscribe's open answer as a `snapshot`-kind
 * event, so the kind alone never decides. */
function classify(payload: unknown): Classified {
  if (typeof payload !== "object" || payload === null) return { kind: "unreadable" };
  const record = payload as Record<string, unknown>;
  if ("resumed" in record) {
    const resumed = RowsResumedSchema.safeParse(record["resumed"]);
    return resumed.success
      ? { kind: "resumed", epoch: resumed.data.epoch, revision: resumed.data.revision }
      : { kind: "unreadable" };
  }
  const inner =
    "snapshot" in record ? record["snapshot"] : "delta" in record ? record["delta"] : payload;
  const page = asPage(inner);
  if (page !== undefined) return { kind: "snapshot", page };
  const delta = asDelta(inner);
  if (delta !== undefined) return { kind: "delta", delta };
  return { kind: "unreadable" };
}

/** A frame's rows through the copy's gate, in order: each row it read, or the
 * key of one it could not (DS-6b). */
type Gated<Row> = Array<readonly ["row", Row] | readonly ["unreadable", string]>;

export class RowsCopy<Row> {
  readonly #keyOf: (row: Row) => string;
  readonly #parseRow: (raw: unknown) => Row | undefined;
  readonly #rawKeyOf: ((raw: unknown) => string | undefined) | undefined;
  readonly #onDropped: ((raw: unknown) => void) | undefined;
  readonly #maxPendingDeltas: number;
  #epoch: string | null = null;
  #revision = 0;
  #rows = new Map<string, Row>();
  /** DS-6b (2026-10-01) — keys the copy holds whose rows the gate cannot read:
   * never listed, always counted in the digest, because the writer holds them.
   * Dropping them outright made the reader's digest disagree with the
   * writer's at every heartbeat — a reset, a full table, the same row dropped
   * again, forever. Disjoint from `#rows`. */
  #unreadable = new Set<string>();
  /** a paged snapshot being assembled: applied whole when its last page
   * lands — by index when the pages carry one, in arrival order when not —
   * and the deltas that arrived for it meanwhile, applied after it. It
   * belongs to the subscription sending it (DS-6b): a resumed answer ends it,
   * its owner drops it when that subscription ends (`abandonSnapshot`), and
   * past `maxPendingDeltas` held deltas it is given up for a reset — a half
   * snapshot that outlived its transfer used to hold every later frame of its
   * epoch, and the replica froze. */
  #pending: {
    epoch: string;
    revision: number;
    parts: Map<number, Gated<Row>>;
    count: number | undefined;
    deltas: RawDelta[];
  } | null = null;

  constructor(opts: RowsCopyOptions<Row>, initial?: RowsCopyState<Row>) {
    this.#keyOf = opts.keyOf;
    this.#parseRow = opts.parseRow;
    this.#rawKeyOf = opts.rawKeyOf;
    this.#onDropped = opts.onDropped;
    this.#maxPendingDeltas = opts.maxPendingDeltas ?? ROWS.MAX_PENDING_DELTAS;
    if (initial !== undefined) {
      this.#epoch = initial.epoch;
      this.#revision = initial.revision;
      for (const row of initial.rows) this.#rows.set(this.#keyOf(row), row);
      for (const key of initial.unreadable ?? []) {
        if (!this.#rows.has(key)) this.#unreadable.add(key);
      }
    }
  }

  /** The cursor to subscribe with; absent while the copy holds nothing it
   * could resume. */
  cursor(): RowsCursor | undefined {
    return this.#epoch === null ? undefined : { epoch: this.#epoch, revision: this.#revision };
  }

  rows(): Row[] {
    return [...this.#rows.values()];
  }

  get(key: string): Row | undefined {
    return this.#rows.get(key);
  }

  get size(): number {
    return this.#rows.size;
  }

  state(): RowsCopyState<Row> | undefined {
    if (this.#epoch === null) return undefined;
    return {
      epoch: this.#epoch,
      revision: this.#revision,
      rows: this.rows(),
      ...(this.#unreadable.size > 0 ? { unreadable: [...this.#unreadable].sort() } : {}),
    };
  }

  /** The key digest over EVERY key the copy holds, readable or not (DS-6b) —
   * the writer's digest counts each row it holds, whatever this build reads. */
  digest(): RowsDigest | undefined {
    return this.#epoch === null
      ? undefined
      : digestOfKeys(this.#epoch, this.#revision, [...this.#rows.keys(), ...this.#unreadable]);
  }

  /** DS-6b — the subscription that was sending a snapshot has ended (its link
   * dropped, its owner detached or is subscribing again): the pages that
   * arrived can never complete, so they go, and a half snapshot never holds
   * the next subscription's frames. Says whether one was dropped. */
  abandonSnapshot(): boolean {
    const had = this.#pending !== null;
    this.#pending = null;
    return had;
  }

  /** Apply a subscribe's answer or any later frame. */
  apply(payload: unknown): RowsApplied {
    const frame = classify(payload);
    switch (frame.kind) {
      case "unreadable":
        return { changed: false, resubscribe: "cursor", reason: "unreadable frame" };
      case "resumed":
        return this.#resumed(frame.epoch, frame.revision);
      case "snapshot":
        return this.#page(frame.page);
      case "delta":
        return this.#delta(frame.delta);
    }
  }

  #resumed(epoch: string, revision: number): RowsApplied {
    // DS-6b — a resumed answer means no snapshot is coming on this
    // subscription: one still being assembled is a transfer an earlier
    // subscription never finished, and kept it would hold (and so eat) the
    // catch-up that follows this answer
    this.#pending = null;
    // the source resumed a cursor: ours, or one we held earlier (a replayed
    // subscribe carries the params it first attached with) — either way the
    // catch-up that follows brackets our revision. A cursor we never held is
    // not ours to trust.
    if (this.#epoch !== epoch || revision > this.#revision) {
      return {
        changed: false,
        resubscribe: "reset",
        reason: "resumed a cursor this copy never held",
      };
    }
    return { changed: false };
  }

  /** The row gate over a frame's raw rows, in order. A row it cannot read is
   * reported (`onDropped`, the owner's log) and, when its key can be read,
   * kept as that key (DS-6b). A row with no readable key is lost to the
   * digest too: the writer's key field is its contract, so that is a skew
   * the epoch or the hello catches, not a row to guess at. */
  #gate(raws: readonly unknown[]): Gated<Row> {
    const gated: Gated<Row> = [];
    for (const raw of raws) {
      const row = this.#parseRow(raw);
      if (row !== undefined) {
        gated.push(["row", row]);
        continue;
      }
      this.#onDropped?.(raw);
      const key = this.#rawKeyOf?.(raw);
      if (key !== undefined) gated.push(["unreadable", key]);
    }
    return gated;
  }

  /** Hold one gated entry. A row that turns unreadable keeps only its key:
   * what the writer holds now is not what the copy held, so the old row goes
   * — a stale row listed as current would be a guess. */
  #hold(entry: Gated<Row>[number]): void {
    if (entry[0] === "row") {
      const key = this.#keyOf(entry[1]);
      this.#unreadable.delete(key);
      this.#rows.set(key, entry[1]);
    } else {
      this.#rows.delete(entry[1]);
      this.#unreadable.add(entry[1]);
    }
  }

  #page(page: RawPage): RowsApplied {
    let pending = this.#pending;
    if (pending === null || pending.epoch !== page.epoch || pending.revision !== page.revision) {
      // a newer snapshot supersedes one still being assembled
      pending = {
        epoch: page.epoch,
        revision: page.revision,
        parts: new Map(),
        count: undefined,
        deltas: [],
      };
    }
    const part = this.#gate(page.rows);
    if (page.index !== undefined && page.count !== undefined) {
      pending.parts.set(page.index, part);
      pending.count = page.count;
      if (pending.parts.size < page.count) {
        this.#pending = pending;
        return { changed: false };
      }
    } else {
      pending.parts.set(pending.parts.size, part);
      if (page.more) {
        this.#pending = pending;
        return { changed: false };
      }
    }
    this.#pending = null;
    // a reset REPLACES the copy (never a merge); it counts as a change even
    // when the rows come back identical, because the cursor moved with it
    const ordered = [...pending.parts.entries()].sort((a, b) => a[0] - b[0]);
    this.#epoch = pending.epoch;
    this.#revision = pending.revision;
    this.#rows = new Map();
    this.#unreadable = new Set();
    for (const [, entries] of ordered) for (const entry of entries) this.#hold(entry);
    const result: RowsApplied = { changed: true, replaced: true };
    for (const delta of pending.deltas) {
      const applied = this.#delta(delta);
      if (applied.resubscribe !== undefined) return { ...applied, changed: true, replaced: true };
    }
    return result;
  }

  #delta(delta: RawDelta): RowsApplied {
    const pending = this.#pending;
    if (pending !== null && delta.epoch === pending.epoch) {
      // it belongs to the snapshot still being assembled (a replay handed the
      // open answer over after its followers): hold it for the snapshot, or
      // drop it when the snapshot already covers it
      if (delta.since >= pending.revision) {
        if (pending.deltas.length >= this.#maxPendingDeltas) {
          // DS-6b — pages that stopped arriving while deltas pile up are a
          // transfer that will not complete; holding more is unbounded memory
          this.#pending = null;
          return {
            changed: false,
            resubscribe: "reset",
            reason: "a paged snapshot stopped arriving",
          };
        }
        pending.deltas.push(delta);
      }
      return { changed: false };
    }
    if (this.#epoch === null || delta.epoch !== this.#epoch) {
      return { changed: false, resubscribe: "reset", reason: "a delta from another epoch" };
    }
    if (delta.since === delta.revision) {
      // the heartbeat: a digest compared only at the same revision, over
      // every key the copy holds (unreadable ones included — DS-6b)
      const theirs = delta.digest;
      if (theirs !== undefined && delta.revision === this.#revision) {
        const mine = this.digest();
        if (
          mine !== undefined &&
          (mine.keysHash !== theirs.keysHash || mine.count !== theirs.count)
        ) {
          return { changed: false, resubscribe: "reset", reason: "the key digest disagrees" };
        }
      }
      return { changed: false };
    }
    if (delta.revision <= this.#revision) return { changed: false }; // already held
    if (delta.since > this.#revision) {
      return { changed: false, resubscribe: "cursor", reason: "a revision gap" };
    }
    let changed = false;
    for (const entry of this.#gate(delta.upserts)) {
      this.#hold(entry);
      changed = true;
    }
    for (const key of delta.removed) {
      const listed = this.#rows.delete(key);
      const unreadable = this.#unreadable.delete(key);
      changed = listed || unreadable || changed;
    }
    this.#revision = delta.revision;
    return { changed };
  }
}
