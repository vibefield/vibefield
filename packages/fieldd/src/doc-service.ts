import { createHash, randomBytes, randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync } from "node:fs";
import { mkdir, open, readFile, rm, stat } from "node:fs/promises";
import { join } from "node:path";
import {
  DOC_HOST,
  DOC_SYNC_RECORD,
  type DocElsewhere,
  type DocHolding,
  type DocLibraryEntry,
  DocMeta,
  DocRegistryEntry,
  type DocSyncIntent,
  type DocSyncRecord,
  LANE_MAX_FRAME_BYTES,
  LAYOUT,
  type LanePutMeta,
  STORES,
} from "@vibefield/contracts";
import {
  createNoopLogger,
  durableRename,
  durableRenameSync,
  type Logger,
} from "@vibefield/logging";
import type { LoroDoc, VersionVector } from "loro-crdt";
import { hasIce1Magic, liftIce1, wrapIce1 } from "./ice1-envelope";
import {
  covers,
  decodeVersion,
  EMPTY_VERSION,
  type HolderAck,
  HostedDoc,
  type HostImport,
  isLoroPanic,
  isSnapshotPayload,
  LoroHost,
  loroBlobMode,
  meetVersions,
  mergeVersions,
  provenVersion,
  rebaseOnto,
  snapshotVersion,
  versionToBase64,
  watermark,
} from "./loro-host";
import { RpcCallError } from "./native-link";

// DocumentService (design-02 §3.5, B3 shape A): fieldd owns the board's at-rest
// bytes and NOTHING about their meaning. A doc is an OPAQUE ICE1 checkpoint plus
// zero or more opaque Loro update records; the field.docs.v1 registry is the
// catalog. fieldd never decodes either payload (the renderer is the live truth) —
// the only inspection is the cheap ICE1 checkpoint magic gate. Bytes ride the :9411 lane,
// never JSON-RPC (EL2); doc.open mints the one-shot ticket that gates it.
//
// Durability is the whole point (P0 exit criterion — the board survives restarts):
// every write is tmp-file → fsync → rename → dir-fsync, so a crash mid-write can
// never leave a torn snapshot, only the prior whole one. The registry read on boot
// is a tolerant reader — a corrupt catalog is moved aside, never fatal.
//
// DS-5 (DS-D18 RULED (a), 2026-09-30) — the opaque half above now has a MERGING
// half beside it. A checkpoint the ICE1 frame rule can lift (every checkpoint
// ICE 0.11.0 writes — test/probes/ice1-envelope) puts its doc in LORO custody:
// the LoroHost holds one LoroDoc for it, built from the at-rest bytes, and
//   · a renderer checkpoint is IMPORTED, not swapped in: whatever the host held
//     beyond it (a peer's edits the window never saw) is kept as one RESIDUAL
//     journal record, so replacing the journal can no longer drop anything;
//   · a peer's checkpoint or update is MERGED and exactly what it added is
//     appended (§1.2 defect 1: no more would-clobber for a doc that holds
//     content);
//   · an update the host already holds (a window re-journaling a pushed update,
//     a retry) is absorbed, not appended.
// The at-rest shape is unchanged and stays a renderer-openable document —
// checkpoint + journal, replayed in order, IS the host's state (pending ops
// excepted: a record that cannot apply is never persisted, because a renderer
// replaying it would quarantine). A checkpoint the rule cannot lift keeps the
// opaque custody above, untouched.
//
// DS-5c (2026-10-01) — RESIDENCY. Because checkpoint + journal ARE the host's
// state (every host mutation is followed by its durable write, and a failed
// write drops the host to be rebuilt from disk), a hosted canvas can leave
// memory with nothing to write: one with no open window, nothing on its
// per-doc chain, no import pending its base (the one thing a host holds that
// disk does not) and no host access — a VERSION, a record, a window's read or
// save — for DOC_HOST.IDLE_MS is evicted by a sweep every DOC_HOST.SWEEP_MS,
// and `hostedNow` reloads it on the next access. System documents are not
// hosted here (their owners hold them) and are never evicted.
//
// DS-5d (2026-10-01, design-06 §4) — COMPACTION. A canvas whose journal passes
// DOC_HOST.COMPACT_RECORDS / COMPACT_JOURNAL_BYTES is trimmed to a Loro
// SHALLOW snapshot AT the watermark — the meet of every known holder's
// acknowledgement (the holders ledger; DS-D17's thirty days) — trial-loaded
// before it is kept, framed by the ICE1 rule, and the epoch bumps in the
// stored revision, the registry and the library. A holder at an older epoch
// is answered with a fresh holder's base and RE-BOOTSTRAPS (S4), carrying
// over what the base can take. loro-crdt 1.13.8 panics a doc when an op whose
// base lies below its shallow root is imported into it: every import into a
// hosted canvas is CONTAINED (a throw drops the doc, rebuilt from disk), and
// every carry is tried in throwaway docs (loro-host.ts `rebaseOnto`).

/** A revision that actually landed. `origin` is load-bearing rather than
 * informational: cross-device sync broadcasts what it hears about, and a record
 * that arrived FROM a peer must never be sent back — two devices echoing each
 * other's updates is an infinite loop that looks, from the outside, exactly
 * like a busy network. */
export interface DocCommit {
  docId: string;
  origin: "local" | "peer";
  kind: "checkpoint" | "update";
  /** The bytes as stored — opaque here, as everywhere in this file. */
  payload: Uint8Array;
  meta: DocMeta;
  baseEpoch: number;
  /** DS-5 — for a checkpoint in Loro custody, exactly what it ADDED to the
   * host (a Loro update from the version before it). A DS-5 peer is sent this
   * instead of the whole checkpoint — which is how an edit that lives only in a
   * checkpoint (ICE folds pending edits into one) still reaches a desktop that
   * holds content. Absent when the checkpoint added nothing, or is opaque. */
  delta?: Uint8Array;
}

/** What became of a peer's record (applyRemoteRecord). */
export type RemoteRecordOutcome =
  | { applied: true; meta: DocMeta; pending?: true }
  | {
      applied: false;
      reason:
        | "unknown-doc"
        | "would-clobber"
        | "epoch-mismatch"
        | "unknown-kind"
        | "already-held"
        /** DS-5 — held by the host as pending: its causal base has not arrived. */
        | "pending"
        /** DS-5 — bytes the host could not read as Loro at all. */
        | "undecodable"
        /** DS-5d — an S4 answer this desktop will take once the window open on
         * the canvas closes (it cannot vouch that the window's next edit would
         * land on the new base); asked for again then. */
        | "rebootstrap-deferred";
    };

/** DS-5 — what the host needs from the service that OWNS a system document
 * (settings, library): the owner persists and reacts; the host merges. */
export interface SystemDocOwner {
  /** Persist the document after a peer's bytes were merged into it. */
  persist(): Promise<void>;
  /** The document changed under its owner (a merge): refresh what derives. */
  merged?(): void;
}

/** DS-5 (DS-D6) — the library, as the catalog reads and writes it. */
export interface DocLibraryPort {
  entries(): DocLibraryEntry[];
  /** DS-5c — one row, or undefined when the library never held the canvas. */
  get(docId: string): DocLibraryEntry | undefined;
  upsert(entry: DocLibraryEntry, by: string): Promise<void>;
  rename(docId: string, name: string, by: string): Promise<void>;
  /** DS-5c — `home`: the desktop a `local` canvas now lives on (DS-D7). */
  setSyncIntent(docId: string, intent: DocSyncIntent, by: string, home?: string): Promise<void>;
  tombstone(docId: string, at: number, by: string): Promise<void>;
  /** DS-5d — the content columns alone (the epoch a compaction bumped), so a
   * concurrent rename or intent on another desktop is never written over. */
  setColumns(
    docId: string,
    columns: { engineSchema: number | null; baseEpoch: number },
    by: string,
  ): Promise<void>;
  on(event: "changed", fn: (change: { origin: "local" | "remote" }) => void): unknown;
  off(event: "changed", fn: (change: { origin: "local" | "remote" }) => void): unknown;
}

/** DS-5d — what one compaction attempt did. Held is an ordinary outcome, not
 * a failure: the watermark waits for holders, and a window open on the canvas
 * waits for it to close. */
export type CompactOutcome =
  | {
      compacted: true;
      /** The epoch the trimmed base opens. */
      baseEpoch: number;
      bytesBefore: number;
      bytesAfter: number;
      /** Holders the watermark waited for, and the ones past DS-D17's horizon. */
      counted: string[];
      retired: string[];
    }
  | {
      compacted: false;
      reason:
        | "unknown-doc"
        | "system-doc"
        /** Not in Loro custody: no version to trim at. */
        | "opaque"
        /** A window holds the canvas (the writer lock). */
        | "window-open"
        /** The host holds ops pending their base — disk does not. */
        | "pending"
        /** The watermark's two holds (loro-host.ts `watermark`). */
        | "unacknowledged"
        | "ahead-of-here"
        /** The holders ledger cannot vouch for every holder yet (it has never
         * heard the store): none known is not the same as none. */
        | "holders-unknown"
        /** The watermark is at or below the current root. */
        | "nothing-to-trim"
        /** The trial: a base no doc could load, or one that lost ops. */
        | "unloadable"
        | "lost-ops"
        | "not-held"
        | "storage";
      /** The holder a watermark hold names. */
      device?: string;
    };

/** DS-5d — why a canvas's epoch moved here, or is behind: `compacted` (this
 * host trimmed it), `rebootstrapped` (taken from a fresher holder, S4),
 * `behind` (the library names a newer epoch than this desktop holds). */
export type EpochMove = "compacted" | "rebootstrapped" | "behind";

/** DS-5 — what a library reconcile did to this device's catalog. */
export interface CatalogChange {
  /** Canvases another desktop created, now held (empty) here for replication. */
  adopted: string[];
  /** Canvases a tombstone removed from this device's list. */
  removed: string[];
}

interface SystemDoc {
  name: string;
  hosted: HostedDoc;
  owner: SystemDocOwner;
  unsubscribe: () => void;
}

/** DS-5 — the host's standing for one doc, for a VERSION record. */
export interface HostVersion {
  /** Loro's encoded version vector (empty when nothing is held yet). */
  version: Uint8Array;
  /** A base a renderer can open is held here. */
  hasCheckpoint: boolean;
  baseEpoch: number;
}

/** DS-5 — what a holder at some version lacks, ready to send. */
export interface HostAnswer {
  meta: { baseEpoch: number; engineSchema: number | null; savedAt: number };
  /** The checkpoint envelope, for a holder that has none. */
  snapshot: Uint8Array | null;
  /** A Loro update from the holder's version (or the checkpoint's). */
  update: Uint8Array | null;
  /** DS-5d — an S4 ANSWER: the holder greeted with an OLDER epoch, so it is
   * sent this desktop's base and the records since, to re-bootstrap from. */
  rebootstrap?: true;
}

export interface DocumentServiceOptions {
  dataDir: string;
  /** injectable clock — the ticket-expiry unit tests drive it directly */
  now?: () => number;
  /** one-shot lane ticket lifetime (default 30s) */
  ticketTtlMs?: number;
  logger?: Logger;
  /** Fires once per revision that reached disk. Never for the idempotent-retry
   * path, which commits nothing. */
  onCommit?: (commit: DocCommit) => void;
  /** DS-5 — the Loro-level host (a fresh one when absent). */
  host?: LoroHost;
  /** DS-5c — residency: a hosted canvas idle `idleMs` (DOC_HOST.IDLE_MS) is
   * evicted by a sweep every `sweepMs` (DOC_HOST.SWEEP_MS). `false`: never,
   * and no timer. */
  residency?: { idleMs?: number; sweepMs?: number } | false;
  /** DS-5c (DS-D7) — this desktop's roster deviceId, asked lazily (the roster
   * is built after this service): the home a `local` canvas is given here, and
   * what tells a canvas living elsewhere apart. Absent or undefined: no canvas
   * reads as living elsewhere — the pre-DS-5c behaviour. */
  selfDevice?: () => string | undefined;
  /** DS-5d — compaction: a hosted canvas whose journal reaches `records`
   * (DOC_HOST.COMPACT_RECORDS) or `journalBytes` (COMPACT_JOURNAL_BYTES) is
   * compacted at the watermark; holders unseen past `retirementMs`
   * (RETIREMENT_MS) are not waited for. `false`: never on its own — `compact`
   * still runs when asked. */
  compaction?: { records?: number; journalBytes?: number; retirementMs?: number } | false;
}

/** doc.open's return: the caller pairs the ticket with laneUrl before dialing. */
export interface DocOpenGrant {
  docId: string;
  ticket: string;
  hasDoc: boolean;
}

/** redeemTicket's outcome — the lane needs to tell a bad ticket (drop the socket)
 * from a busy writer (LaneErr PRECONDITION_FAILED, then drop) apart. */
export type TicketRedemption =
  | { ok: true; docId: string }
  | { ok: false; reason: "invalid" }
  | { ok: false; reason: "writer-busy"; docId: string };

export interface DocServiceHealth {
  state: "ready" | "failed";
  docCount: number;
}

interface TicketRecord {
  docId: string;
  expiresAt: number;
}

interface CurrentRevision extends DocMeta {
  revisionId: string;
  file: string;
  committedAt: number;
  /** sha256 of the stored bytes. Absent on revisions written before C6-3h —
   * a tolerant reader fills it in from the file when something asks. */
  contentId?: string;
  updates: JournalRevision[];
}

interface JournalRevision {
  revisionId: string;
  file: string;
  committedAt: number;
  savedAt: number;
  byteLength: number;
  contentId?: string;
}

/** What one device holds, by CONTENT rather than by its own revision ids.
 *
 * revisionIds are minted per device — re-framing a peer's record gives it a
 * fresh one — so the SAME record has different ids on two devices, and no
 * comparison of them can say who is missing what. Hashing the bytes can, and
 * needs no idea what the bytes mean, which is the only kind of identity an
 * opaque ferry is allowed to compute. */
export interface DocRecordDigest {
  baseEpoch: number;
  hasCheckpoint: boolean;
  records: string[];
}

/** Exported for DocSyncService (C6-4): an arriving record retires its own
 * entry from the expected set by the SAME identity the digests speak. */
export function contentIdOf(bytes: Uint8Array): string {
  // 16 bytes of sha256. A HAVE is O(journal length), so the digest width is
  // the message size: 32 hex chars keeps 1000 records near 32 KB. Collision
  // risk at that width is far below the risk of the disk lying to us.
  return createHash("sha256").update(bytes).digest("hex").slice(0, 32);
}

export class DocumentService {
  private readonly dataDir: string;
  private readonly now: () => number;
  private readonly ticketTtlMs: number;
  private readonly docsDir: string;
  private readonly registryDir: string;
  private readonly registryFile: string;
  private readonly registryPath: string;
  private readonly logger: Logger;
  private readonly onCommit: ((commit: DocCommit) => void) | undefined;
  /** file name → content id, for revisions whose manifest predates C6-3h.
   * Computed once rather than on every HAVE. */
  private readonly contentIds = new Map<string, string>();

  /** insertion-ordered so list() reads back in creation order */
  private registry = new Map<string, DocRegistryEntry>();
  private tickets = new Map<string, TicketRecord>();
  /** docIds with a live write lane — the single-writer lock (design-02 §3.5) */
  private writers = new Set<string>();
  private writes = new Map<string, Promise<void>>();
  private storageOk = false;
  /** DS-5 — one LoroDoc per doc in Loro custody. */
  private readonly host: LoroHost;
  /** DS-5 — docs whose current checkpoint the frame rule cannot lift: opaque
   * custody, remembered so a HAVE does not re-read the file every time. */
  private readonly opaque = new Set<string>();
  /** DS-5 — system documents (settings, library), merged here, owned elsewhere. */
  private readonly system = new Map<string, SystemDoc>();
  /** DS-5 (DS-D6) — the library this catalog derives from, once attached. */
  private library: DocLibraryPort | null = null;
  private libraryIntent: (entry: DocLibraryEntry) => DocSyncIntent = (entry) =>
    entry.syncIntent ?? "sync";
  private detachLibrary: (() => void) | null = null;
  private catalogChain: Promise<void> = Promise.resolve();
  private readonly catalogListeners = new Set<(change: CatalogChange) => void>();
  /** DS-5 — told after a PEER's bytes changed a canvas (the push trigger). */
  private readonly peerMergeListeners = new Set<(docId: string) => void>();
  private homesOf: (docId: string) => string[] = () => [];
  /** DS-5c — when each hosted canvas was last asked for (this.now()). */
  private readonly touched = new Map<string, number>();
  /** DS-5c — the head version an evicted canvas held, for the holders slice:
   * disk has not moved since (any change reloads it first). */
  private readonly evictedHeads = new Map<string, string>();
  private readonly idleMs: number;
  private sweepTimer: ReturnType<typeof setInterval> | null = null;
  private readonly selfDevice: () => string | undefined;
  /** DS-5d — compaction's thresholds and horizon; `on` false means only `compact`. */
  private readonly compaction: {
    on: boolean;
    records: number;
    journalBytes: number;
    retirementMs: number;
  };
  /** DS-5d — every OTHER holder of a canvas, as the holders slice and its
   * ledger know them (DocHoldersService); null while they cannot be vouched
   * for. None until wired: a desktop alone waits for nobody. */
  private acknowledgements: (docId: string) => HolderAck[] | null = () => [];
  private readonly holdingsListeners = new Set<() => void>();
  /** DS-5d — canvases past a threshold whose compaction is held (a window, a
   * holder); retried on the next append and when the window closes. */
  private readonly wantsCompaction = new Set<string>();
  private readonly compacting = new Set<string>();
  /** DS-5d — the watermark whose trial last came to nothing, per canvas (a
   * base no doc could load, or one no higher than the current root): the
   * host's oplog only grows, so the same watermark comes to the same thing
   * until the acknowledgements move it — no second O(doc) export for it. */
  private readonly failedTrims = new Map<
    string,
    { key: string; reason: "unloadable" | "nothing-to-trim" }
  >();
  private readonly epochListeners = new Set<(docId: string, why: EpochMove) => void>();
  /** DS-5d — per canvas with a window open, what this desktop can PROVE the
   * window holds: what its read served, raised by every save it makes (the
   * doc lane's push proof, kept here because it is also the holder's
   * acknowledgement — a window's next edit descends from what it holds). */
  private readonly windowFloors = new Map<string, VersionVector>();
  /** DS-5d — the epoch each canvas's last window read was served at: a
   * window's undeclared append was composed against it (it can have read
   * nothing else), so the renderer, which declares none, keeps appending
   * after a compaction. Kept across a window's reconnect, as the lane keeps
   * its proof. */
  private readonly servedEpoch = new Map<string, number>();
  /** DS-5d — canvases whose S4 answer waited for a window to close. */
  private readonly rebootstrapDeferred = new Set<string>();
  /** DS-5d — the newest library epoch already announced as `behind`, per
   * canvas: a library change says it once, not on every reconcile. */
  private readonly behindNotified = new Map<string, number>();

  constructor(opts: DocumentServiceOptions) {
    this.dataDir = opts.dataDir;
    this.now = opts.now ?? Date.now;
    this.ticketTtlMs = opts.ticketTtlMs ?? 30_000;
    this.logger = opts.logger ?? createNoopLogger();
    this.onCommit = opts.onCommit;
    this.host = opts.host ?? new LoroHost();
    this.selfDevice = opts.selfDevice ?? (() => undefined);
    const compaction = opts.compaction ?? {};
    this.compaction = {
      on: compaction !== false,
      records: (compaction === false ? undefined : compaction.records) ?? DOC_HOST.COMPACT_RECORDS,
      journalBytes:
        (compaction === false ? undefined : compaction.journalBytes) ??
        DOC_HOST.COMPACT_JOURNAL_BYTES,
      retirementMs:
        (compaction === false ? undefined : compaction.retirementMs) ?? DOC_HOST.RETIREMENT_MS,
    };
    this.docsDir = join(this.dataDir, ...LAYOUT.DOCS_DIR);
    this.registryDir = join(this.dataDir, ...LAYOUT.REGISTRIES_DIR);
    this.registryFile = `${STORES.DOCS}.json`;
    this.registryPath = join(this.registryDir, this.registryFile);
    try {
      mkdirSync(this.docsDir, { recursive: true });
      mkdirSync(this.registryDir, { recursive: true });
      this.storageOk = true;
    } catch (e) {
      // honest degraded state — health() reports "failed", boot does not die
      this.logger.error(
        "fieldd.docs.storage_initialization_failed",
        "Document storage initialization failed",
        e,
      );
    }
    this.loadRegistry();
    this.reconcileRegistry();
    const residency = opts.residency ?? {};
    this.idleMs =
      residency === false ? Number.POSITIVE_INFINITY : (residency.idleMs ?? DOC_HOST.IDLE_MS);
    if (residency !== false) {
      this.sweepTimer = setInterval(() => {
        try {
          this.evictIdle();
        } catch (error) {
          this.logger.warn("fieldd.docs.evict_failed", "The residency sweep did not run", {
            error: String(error),
          });
        }
      }, residency.sweepMs ?? DOC_HOST.SWEEP_MS);
      this.sweepTimer.unref?.();
    }
  }

  /** DS-5c — evict every hosted canvas idle past `idleMs`: no open window
   * (the writer lock), nothing on its per-doc chain (a merge, a window's read,
   * a push's export in flight), no import pending its base, and no host access
   * since. Nothing is written — the bytes on disk ARE the host — and
   * `hostedNow` reloads it on the next access. Returns what left. */
  evictIdle(): string[] {
    const now = this.now();
    const evicted: string[] = [];
    for (const docId of this.host.ids()) {
      const hosted = this.host.get(docId);
      if (hosted === undefined) continue;
      if (this.writers.has(docId) || this.writes.has(docId) || hosted.hasPending()) continue;
      if (now - (this.touched.get(docId) ?? now) < this.idleMs) continue;
      this.evictedHeads.set(docId, versionToBase64(hosted.version()));
      this.host.delete(docId);
      this.touched.delete(docId);
      evicted.push(docId);
    }
    if (evicted.length > 0) {
      this.logger.debug("fieldd.docs.host_evicted", "Idle documents left memory", {
        docs: evicted.length,
        resident: this.host.ids().length,
      });
    }
    return evicted;
  }

  /** DS-5c — a hosted canvas was asked for: its idle clock restarts. */
  private touch(docId: string): void {
    this.touched.set(docId, this.now());
    this.evictedHeads.delete(docId);
  }

  /** DS-5d — an import into a hosted canvas THREW: the doc leaves the host and
   * the next access rebuilds it from disk. Disk is never ahead of a failed
   * import (every host mutation is followed by its durable write), and a PANIC
   * — an op whose base lies below a compacted root, measured on loro-crdt
   * 1.13.8 — leaves the doc holding its lock for good: kept, every later
   * VERSION, window read and save on the canvas threw until fieldd restarted. */
  private dropHosted(hosted: HostedDoc, during: string, error: unknown): void {
    if (this.host.get(hosted.docId) === hosted) this.host.delete(hosted.docId);
    const panicked = isLoroPanic(error);
    this.logger
      .child({ docId: hosted.docId })
      .warn(
        panicked ? "fieldd.docs.host_import_panicked" : "fieldd.docs.host_import_refused",
        panicked
          ? "An import panicked the document's host; the host is rebuilt from disk"
          : "An import was refused; the document's host is rebuilt from disk",
        { during, error: String(error) },
      );
  }

  // ---- catalog ----

  async create(name: string): Promise<DocRegistryEntry> {
    const docId = randomUUID();
    const createdAt = this.now();
    const entry: DocRegistryEntry = {
      docId,
      name,
      updatedAt: createdAt,
      baseEpoch: 0,
      engineSchema: null,
      sizeBytes: 0,
      createdAt,
    };
    try {
      await mkdir(join(this.docsDir, docId), { recursive: true });
      this.registry.set(docId, entry);
      await this.persistRegistry();
    } catch (err) {
      this.registry.delete(docId);
      throw this.storageError("create", err);
    }
    // DS-5 (DS-D6) — the canvas EXISTS for every desktop of the account from here.
    await this.toLibrary("create", (library) =>
      library.upsert({ docId, name, createdAt, engineSchema: null, baseEpoch: 0 }, "create"),
    );
    return entry;
  }

  /** This device's canvases — a tombstoned one is gone from every list, and
   * (DS-5c, DS-D7) so is a copy held here of a `local` canvas that lives on
   * another desktop: it is listed in `elsewhere()` instead. */
  list(): DocRegistryEntry[] {
    return [...this.registry.values()].filter(
      (entry) =>
        entry.deletedAt === undefined &&
        // only a `local` entry can live elsewhere: one cheap read, not a library scan
        !(entry.syncIntent === "local" && this.livesElsewhere(entry.docId) !== null),
    );
  }

  /** DS-5 (DS-D7) — canvases the library lists that this device does not hold:
   * a `local` canvas living on another desktop. Listed, never openable here.
   * DS-5c: and the ones it holds only a COPY of — adopted while they synced,
   * kept home since by another desktop. */
  elsewhere(): DocElsewhere[] {
    if (this.library === null) return [];
    const out: DocElsewhere[] = [];
    for (const entry of this.library.entries()) {
      if (entry.tombstone !== undefined) continue;
      const held = this.registry.get(entry.docId);
      if (held !== undefined) {
        const home = held.deletedAt === undefined ? this.livesElsewhere(entry.docId) : null;
        if (home !== null) out.push({ docId: entry.docId, name: entry.name, homes: [home] });
        continue;
      }
      out.push({
        docId: entry.docId,
        name: entry.name,
        homes: entry.home !== undefined ? [entry.home] : this.homesOf(entry.docId),
      });
    }
    return out;
  }

  /** DS-5c (DS-D7) — the desktop a `local` canvas lives on when it is NOT this
   * one: its library row names a home, and this desktop is not it. Null when
   * the canvas lives here, syncs, or nothing names where it lives (a row from
   * before DS-5c, a desktop that does not yet know its own id). */
  private livesElsewhere(docId: string): string | null {
    const row = this.library?.get(docId);
    if (row === undefined || row.tombstone !== undefined || row.syncIntent !== "local") return null;
    const self = this.selfDevice();
    if (row.home === undefined || self === undefined || row.home === self) return null;
    return row.home;
  }

  /** DS-5 — doc.delete: a TOMBSTONE, in the registry and the library, so the
   * canvas leaves every desktop's list and its lanes stop. The bytes stay on
   * disk — deleting is an act, and no settings undo can reach it (D29′). */
  async delete(docId: string): Promise<DocRegistryEntry> {
    const entry = this.registry.get(docId);
    if (!entry || entry.deletedAt !== undefined) {
      throw new RpcCallError("NOT_FOUND", `no such doc: ${docId}`, false);
    }
    const deletedAt = this.now();
    const tombstoned: DocRegistryEntry = { ...entry, deletedAt };
    this.registry.set(docId, tombstoned);
    try {
      await this.persistRegistry();
    } catch (err) {
      this.registry.set(docId, entry);
      throw this.storageError("delete", err);
    }
    this.host.delete(docId);
    this.wantsCompaction.delete(docId);
    this.failedTrims.delete(docId);
    this.servedEpoch.delete(docId);
    await this.toLibrary("delete", (library) => library.tombstone(docId, deletedAt, "delete"));
    return tombstoned;
  }

  /** Relabels a doc in place. Deliberately does NOT bump updatedAt: recency means
   * content (the last accepted PUT), not the label — the explorer sorts by it, so a
   * rename must never reorder the list. Insertion order is preserved (same key). */
  async rename(docId: string, name: string): Promise<DocRegistryEntry> {
    const entry = this.registry.get(docId);
    if (!entry) throw new RpcCallError("NOT_FOUND", `no such doc: ${docId}`, false);
    const renamed: DocRegistryEntry = { ...entry, name };
    this.registry.set(docId, renamed);
    try {
      await this.persistRegistry();
    } catch (err) {
      this.registry.set(docId, entry);
      throw this.storageError("rename", err);
    }
    await this.toLibrary("rename", (library) => library.rename(docId, name, "rename"));
    return renamed;
  }

  /** UA-D7 — says whether this doc may leave the device. A posture edit, so it
   * follows rename's shape exactly: updatedAt stays put (nothing about the
   * content changed, and the explorer must not reorder), and a failed persist
   * rolls the in-memory entry back rather than leaving the two disagreeing.
   *
   * DURABLE BEFORE ANY GATE MOVES: the registry file is the answer a restart
   * reads, and a doc that was told to stay home must not start syncing again
   * because the write failed quietly. */
  async setSyncIntent(docId: string, intent: DocSyncIntent): Promise<DocRegistryEntry> {
    const entry = this.registry.get(docId);
    if (!entry) throw new RpcCallError("NOT_FOUND", `no such doc: ${docId}`, false);
    const next: DocRegistryEntry = { ...entry, syncIntent: intent };
    this.registry.set(docId, next);
    try {
      await this.persistRegistry();
    } catch (err) {
      this.registry.set(docId, entry);
      throw this.storageError("setSyncIntent", err);
    }
    // DS-5 — the intent converges across desktops with the canvas's library row
    // (UA-D7's named follow-up); this device's registry answers first, so the
    // gates move the instant the local write is durable. DS-5c (DS-D7): a
    // canvas kept home is kept HERE — this desktop is its home, in the same
    // library commit as the intent.
    await this.toLibrary("setSyncIntent", (library) =>
      library.setSyncIntent(
        docId,
        intent,
        "setSyncIntent",
        intent === "local" ? this.selfDevice() : undefined,
      ),
    );
    return next;
  }

  /** The doc's OWN answer, or undefined when it has never given one — the
   * caller folds in the user's posture (fieldd's `resolveSyncIntent`), because
   * the posture is a settings-document fact this service knows nothing about. */
  syncIntentOf(docId: string): DocSyncIntent | undefined {
    // DS-5 — system documents sync among the account's desktops by law, never
    // by intent; a tombstoned canvas's content stops travelling.
    if (this.system.has(docId)) return "sync";
    const entry = this.registry.get(docId);
    if (entry?.deletedAt !== undefined) return "local";
    return entry?.syncIntent;
  }

  // ---- system documents and the library (DS-5, DS-D6) ----

  /** Register a SYSTEM document (settings, library): owned and persisted by its
   * service, merged by the host, synced among the account's desktops, never
   * subject to per-document intent, never listed or openable. Its local
   * commits are announced exactly like a canvas's. Returns the unregister. */
  registerSystemDoc(docId: string, name: string, doc: LoroDoc, owner: SystemDocOwner): () => void {
    this.system.get(docId)?.unsubscribe();
    const hosted = new HostedDoc(docId, doc);
    const unsubscribe = doc.subscribeLocalUpdates((bytes) => {
      this.announce({
        docId,
        origin: "local",
        kind: "update",
        payload: bytes,
        meta: {
          engineSchema: null,
          savedAt: this.now(),
          byteLength: bytes.byteLength,
          baseEpoch: 0,
        },
        baseEpoch: 0,
      });
    });
    this.system.set(docId, { name, hosted, owner, unsubscribe });
    return () => {
      const held = this.system.get(docId);
      if (held?.hosted !== hosted) return;
      held.unsubscribe();
      this.system.delete(docId);
    };
  }

  isSystemDoc(docId: string): boolean {
    return this.system.has(docId);
  }

  systemDocIds(): string[] {
    return [...this.system.keys()];
  }

  /** Attach the library this catalog derives from (DS-D6). `resolveIntent`
   * folds a row's own intent with the user's posture — a canvas another
   * desktop made is held here only when it resolves to `sync`. */
  async attachLibrary(
    library: DocLibraryPort,
    resolveIntent?: (entry: DocLibraryEntry) => DocSyncIntent,
  ): Promise<void> {
    this.detachLibrary?.();
    this.library = library;
    if (resolveIntent !== undefined) this.libraryIntent = resolveIntent;
    const onChanged = (change: { origin: "local" | "remote" }): void => {
      if (change.origin === "remote") void this.reconcileLibrary();
    };
    library.on("changed", onChanged);
    this.detachLibrary = () => {
      library.off("changed", onChanged);
      if (this.library === library) this.library = null;
    };
    await this.reconcileLibrary();
  }

  /** Where another device's holders slice says a canvas lives. */
  setHomes(homesOf: (docId: string) => string[]): void {
    this.homesOf = homesOf;
  }

  /** Fires after a library reconcile changed this device's catalog. */
  onCatalogChanged(fn: (change: CatalogChange) => void): () => void {
    this.catalogListeners.add(fn);
    return () => this.catalogListeners.delete(fn);
  }

  /** The library → catalog fold, on its own chain. Local rows the library
   * lacks are SEEDED into it (canvases older than the library, or made while
   * it was away); library rows this device lacks are ADOPTED when they resolve
   * to `sync` (an empty holding the version exchange fills); a tombstone
   * removes; a name or intent the library changed is taken. The library is
   * the truth for existence, names and intent — the registry is this device's
   * derived cache plus the content columns only it can know. */
  reconcileLibrary(): Promise<void> {
    const run = this.catalogChain.catch(() => {}).then(() => this.reconcileLibraryNow());
    this.catalogChain = run;
    return run;
  }

  private async reconcileLibraryNow(): Promise<void> {
    const library = this.library;
    if (library === null) return;
    const known = new Map(library.entries().map((entry) => [entry.docId, entry]));
    const self = this.selfDevice();
    for (const entry of [...this.registry.values()]) {
      if (known.has(entry.docId) || entry.deletedAt !== undefined || entry.system === true)
        continue;
      await this.toLibrary("seed", (lib) =>
        lib.upsert(
          {
            docId: entry.docId,
            name: entry.name,
            createdAt: entry.createdAt ?? entry.updatedAt,
            engineSchema: entry.engineSchema,
            baseEpoch: entry.baseEpoch,
            ...(entry.syncIntent !== undefined ? { syncIntent: entry.syncIntent } : {}),
            // DS-5c — a canvas already kept home here before the library knew it
            ...(entry.syncIntent === "local" && self !== undefined ? { home: self } : {}),
          },
          "seed",
        ),
      );
    }
    const change: CatalogChange = { adopted: [], removed: [] };
    let dirty = false;
    const behind: string[] = [];
    for (const row of known.values()) {
      const local = this.registry.get(row.docId);
      // DS-5d — the library names a newer epoch than this desktop holds: a
      // fresher holder has compacted, and its base is this desktop's to ask
      // for (S4). Said once per epoch, not on every reconcile.
      if (
        local !== undefined &&
        local.deletedAt === undefined &&
        row.tombstone === undefined &&
        row.baseEpoch > local.baseEpoch &&
        (this.behindNotified.get(row.docId) ?? -1) < row.baseEpoch
      ) {
        this.behindNotified.set(row.docId, row.baseEpoch);
        behind.push(row.docId);
      }
      if (row.tombstone !== undefined) {
        if (local !== undefined && local.deletedAt === undefined) {
          this.registry.set(row.docId, { ...local, deletedAt: row.tombstone });
          this.host.delete(row.docId);
          change.removed.push(row.docId);
          dirty = true;
        }
        continue;
      }
      if (local === undefined) {
        if (this.libraryIntent(row) !== "sync") continue; // lives elsewhere: listed, not held
        try {
          await mkdir(join(this.docsDir, row.docId), { recursive: true });
        } catch (err) {
          this.logger
            .child({ docId: row.docId })
            .warn("fieldd.docs.adopt_failed", "A library canvas could not be held here", {
              error: errMsg(err),
            });
          continue;
        }
        this.registry.set(row.docId, {
          docId: row.docId,
          name: row.name,
          updatedAt: row.createdAt,
          baseEpoch: row.baseEpoch,
          engineSchema: row.engineSchema,
          sizeBytes: 0,
          createdAt: row.createdAt,
          ...(row.syncIntent !== undefined ? { syncIntent: row.syncIntent } : {}),
        });
        change.adopted.push(row.docId);
        dirty = true;
        continue;
      }
      if (local.deletedAt !== undefined) continue;
      const name = row.name !== local.name ? row.name : local.name;
      const syncIntent = row.syncIntent ?? local.syncIntent;
      if (name !== local.name || syncIntent !== local.syncIntent) {
        this.registry.set(row.docId, {
          ...local,
          name,
          ...(syncIntent !== undefined ? { syncIntent } : {}),
        });
        dirty = true;
      }
    }
    for (const docId of behind) this.emitEpoch(docId, "behind");
    if (!dirty) return;
    try {
      await this.persistRegistry();
    } catch (err) {
      this.logger.error(
        "fieldd.docs.library_reconcile_persist_failed",
        "The library-derived registry could not be persisted",
        err,
      );
    }
    for (const fn of this.catalogListeners) {
      try {
        fn(change);
      } catch (error) {
        this.logger.warn("fieldd.docs.catalog_listener_failed", "A catalog listener threw", {
          error: String(error),
        });
      }
    }
  }

  /** What this device holds, for its holders slice (`field.docs.v1`). */
  async holdings(isFresh: (docId: string) => boolean): Promise<DocHolding[]> {
    const out: DocHolding[] = [];
    for (const entry of this.list()) {
      if (!this.hasStoredDoc(entry.docId)) continue;
      const hosted = this.host.get(entry.docId);
      // DS-5c — an evicted canvas still says what it holds: disk has not moved.
      const head =
        hosted !== undefined
          ? versionToBase64(hosted.version())
          : this.evictedHeads.get(entry.docId);
      const ack = head === undefined ? undefined : this.acknowledged(entry.docId, hosted, head);
      out.push({
        docId: entry.docId,
        baseEpoch: entry.baseEpoch,
        ...(head !== undefined ? { headVersion: head } : {}),
        ...(ack !== undefined ? { ackVersion: ack } : {}),
        fresh: isFresh(entry.docId),
        heldSince: entry.createdAt ?? entry.updatedAt,
      });
    }
    return out;
  }

  /** DS-5d — the version this desktop acknowledges for a canvas: the one
   * below which it will never again produce an op. With no window open that
   * is its head (fieldd itself never edits a canvas). With one open, the meet
   * of the head and what this desktop can prove the window holds — a
   * window's next edit descends from what it holds, and an edit it made
   * before it held something is carried by the same save that proves it does.
   * An open window it cannot vouch for (one that read nothing here)
   * acknowledges NOTHING: the empty version, which holds every trim. */
  private acknowledged(docId: string, hosted: HostedDoc | undefined, head: string): string {
    if (!this.writers.has(docId)) return head;
    const floor = this.windowFloors.get(docId);
    if (floor === undefined || hosted === undefined) return versionToBase64(EMPTY_VERSION());
    return versionToBase64(meetVersions(hosted.version(), floor));
  }

  /** A library write that fails is LOGGED, never thrown into the catalog
   * write that caused it: this device's registry is already durable, and the
   * next reconcile seeds whatever the library missed. */
  private async toLibrary(
    op: string,
    write: (library: DocLibraryPort) => Promise<void>,
  ): Promise<void> {
    const library = this.library;
    if (library === null) return;
    try {
      await write(library);
    } catch (error) {
      this.logger.warn("fieldd.docs.library_write_failed", "A library write failed", {
        op,
        error: String(error),
      });
    }
  }

  // ---- lane admission ----

  /** Mints a one-shot lane ticket, or refuses if a writer already holds the doc.
   * DS-5c (DS-D7): a canvas that LIVES ON ANOTHER DESKTOP — a `local` one this
   * desktop holds a copy of, or a library canvas it does not hold at all — is
   * listed and not openable: `UNAVAILABLE {service: "docs", state:
   * "held-elsewhere", device}` (the desktop it lives on, when one is known). */
  open(docId: string): DocOpenGrant {
    const listed = this.registry.get(docId);
    if (listed === undefined || listed.deletedAt !== undefined) {
      const row = listed === undefined ? this.library?.get(docId) : undefined;
      if (row !== undefined && row.tombstone === undefined) {
        throw heldElsewhere(docId, row.home ?? this.homesOf(docId)[0]);
      }
      throw new RpcCallError("NOT_FOUND", `no such doc: ${docId}`, false);
    }
    const home = this.livesElsewhere(docId);
    if (home !== null) throw heldElsewhere(docId, home);
    if (this.writers.has(docId))
      throw new RpcCallError("PRECONDITION_FAILED", "another writer holds the doc lane", false, {
        docId,
      });
    this.sweepTickets();
    const ticket = randomBytes(24).toString("base64url"); // 192-bit, one-shot
    this.tickets.set(ticket, { docId, expiresAt: this.now() + this.ticketTtlMs });
    return { docId, ticket, hasDoc: this.hasStoredDoc(docId) };
  }

  /** Authoritative single-writer gate: a ticket is consumed on the first redeem
   * (one-shot) whether or not it is usable, so a replay always reads as invalid. */
  redeemTicket(ticket: string): TicketRedemption {
    const rec = this.tickets.get(ticket);
    if (!rec) return { ok: false, reason: "invalid" };
    this.tickets.delete(ticket);
    if (this.now() >= rec.expiresAt) return { ok: false, reason: "invalid" };
    if (this.writers.has(rec.docId)) return { ok: false, reason: "writer-busy", docId: rec.docId };
    return { ok: true, docId: rec.docId };
  }

  writerAttached(docId: string): void {
    this.writers.add(docId);
    // DS-5d — until it reads, this window is one nobody can vouch for.
    this.holdingsChanged();
  }

  writerDetached(docId: string): void {
    this.writers.delete(docId);
    // DS-5d — the window's floor leaves with it; a compaction it held runs,
    // and a fresher base it held off is asked for again.
    this.windowFloors.delete(docId);
    this.holdingsChanged();
    if (this.wantsCompaction.has(docId)) this.requestCompaction(docId);
    if (this.rebootstrapDeferred.delete(docId)) this.emitEpoch(docId, "behind");
  }

  /** DS-5d — a window proved it holds `bytes`' version (a save it made). */
  private raiseWindowFloor(docId: string, bytes: Uint8Array): void {
    if (!this.writers.has(docId)) return;
    const version = provenVersion(bytes);
    if (version === null) return;
    const floor = this.windowFloors.get(docId);
    this.windowFloors.set(docId, floor === undefined ? version : mergeVersions(floor, version));
  }

  // ---- payload ----

  async readDocMeta(docId: string): Promise<DocMeta | null> {
    try {
      const current = await this.readCurrent(docId);
      if (current !== null) return currentMeta(current);
      const legacy = this.snapshotPath(docId);
      if (!existsSync(legacy)) return null;
      const info = await stat(legacy);
      return { ...this.readMeta(docId, info.size), journalEntries: 0 };
    } catch (err) {
      if (err instanceof RpcCallError) throw err;
      throw this.storageError("inspect", err);
    }
  }

  async readDoc(
    docId: string,
  ): Promise<{ bytes: Uint8Array; updates: Uint8Array[]; meta: DocMeta } | null> {
    try {
      const current = await this.readCurrent(docId);
      if (current !== null) {
        const bytes = await readFile(join(this.revisionsDir(docId), current.file));
        if (bytes.byteLength !== current.byteLength) {
          throw new RpcCallError(
            "INTERNAL",
            `revision ${current.revisionId} length ${bytes.byteLength} does not match manifest ${current.byteLength}`,
            false,
          );
        }
        const updates = await Promise.all(
          current.updates.map(async (update) => {
            const updateBytes = await readFile(join(this.revisionsDir(docId), update.file));
            if (updateBytes.byteLength !== update.byteLength) {
              throw new RpcCallError(
                "INTERNAL",
                `journal revision ${update.revisionId} length ${updateBytes.byteLength} does not match manifest ${update.byteLength}`,
                false,
              );
            }
            return new Uint8Array(updateBytes);
          }),
        );
        return { bytes, updates, meta: currentMeta(current) };
      }
      const legacy = this.snapshotPath(docId);
      if (!existsSync(legacy)) return null;
      const bytes = await readFile(legacy);
      return {
        bytes,
        updates: [],
        meta: { ...this.readMeta(docId, bytes.byteLength), journalEntries: 0 },
      };
    } catch (err) {
      if (err instanceof RpcCallError) throw err;
      throw this.storageError("read", err);
    }
  }

  /** Validates then persists atomically, then updates the registry. Any validation
   * failure throws BEFORE the first byte hits disk — prior bytes stay untouched. */
  writeDoc(
    docId: string,
    bytes: Uint8Array,
    putMeta: LanePutMeta,
    origin: "local" | "peer" = "local",
  ): Promise<DocMeta> {
    return this.serialize(docId, () => this.writeDocNow(docId, bytes, putMeta, origin));
  }

  /** The per-doc chain every at-rest read-modify-write rides — the renderer's
   * writes, a peer's merges, and (DS-5) the host reads that must see disk and
   * host agree. Nothing on it may call back into `serialize` for the same doc. */
  private serialize<T>(docId: string, op: () => Promise<T>): Promise<T> {
    const prior = this.writes.get(docId) ?? Promise.resolve();
    const run = prior.catch(() => {}).then(op);
    const tail = run.then(
      () => {},
      () => {},
    );
    this.writes.set(docId, tail);
    return run.finally(() => {
      if (this.writes.get(docId) === tail) this.writes.delete(docId);
    });
  }

  private async writeDocNow(
    docId: string,
    bytes: Uint8Array,
    putMeta: LanePutMeta,
    origin: "local" | "peer",
  ): Promise<DocMeta> {
    const entry = this.registry.get(docId);
    if (!entry) throw new RpcCallError("NOT_FOUND", `no such doc: ${docId}`, false);
    if (bytes.byteLength !== putMeta.byteLength)
      throw new RpcCallError(
        "PRECONDITION_FAILED",
        `byteLength ${putMeta.byteLength} does not match payload ${bytes.byteLength}`,
        false,
      );
    if (bytes.byteLength > LANE_MAX_FRAME_BYTES)
      throw new RpcCallError(
        "PRECONDITION_FAILED",
        `doc payload ${bytes.byteLength} exceeds lane ceiling ${LANE_MAX_FRAME_BYTES}`,
        false,
      );
    if ((putMeta.kind ?? "checkpoint") === "update") {
      return this.writeUpdateNow(entry, bytes, putMeta, origin);
    }
    if (!hasIce1Magic(bytes))
      throw new RpcCallError("PRECONDITION_FAILED", "payload is not an ICE1 envelope", false);

    // DS-5 — into the host first, so the journal this checkpoint replaces can
    // be replaced without loss: what the host holds beyond the checkpoint (a
    // peer's edits the window never saw) becomes the new journal's one record.
    const folded = await this.foldCheckpoint(docId, bytes);
    // DS-5d — what reaches disk: the checkpoint as it came, or (a full one
    // into a compacted host) the host's own shallow base.
    const stored = folded?.stored ?? bytes;
    const revisionId = putMeta.revisionId;
    const committedAt = this.now();
    const residual: JournalRevision | null =
      folded?.residual != null
        ? (() => {
            const id = randomUUID();
            return {
              revisionId: id,
              file: `${id}.loro`,
              contentId: contentIdOf(folded.residual),
              committedAt,
              savedAt: putMeta.savedAt,
              byteLength: folded.residual.byteLength,
            };
          })()
        : null;
    const meta: CurrentRevision = {
      revisionId,
      file: `${revisionId}.ice1`,
      contentId: contentIdOf(stored),
      committedAt,
      engineSchema: putMeta.engineSchema,
      savedAt: putMeta.savedAt,
      byteLength: stored.byteLength,
      baseEpoch: entry.baseEpoch,
      updates: residual === null ? [] : [residual],
    };
    const dir = join(this.docsDir, docId);
    const revisions = this.revisionsDir(docId);
    let previous: CurrentRevision | null = null;
    try {
      previous = await this.readCurrent(docId);
    } catch {
      // A successful new commit repairs a corrupt pointer. Unknown orphan
      // revisions are retained for later maintenance rather than guessed at.
    }
    try {
      await mkdir(revisions, { recursive: true });
      if (residual !== null && folded?.residual != null) {
        await atomicWrite(revisions, residual.file, folded.residual);
      }
      await atomicWrite(revisions, meta.file, stored);
      // `current.json` is the sole commit point. Until this rename lands the
      // previous complete revision remains authoritative.
      await atomicWrite(dir, "current.json", `${JSON.stringify(meta, null, 2)}\n`);
    } catch (err) {
      // The host already took the checkpoint in; disk did not. Rebuild the host
      // from disk on next use rather than let the two disagree.
      this.host.delete(docId);
      throw this.storageError("write", err);
    }

    this.commitRegistryColumns(docId, entry, {
      updatedAt: meta.committedAt,
      engineSchema: putMeta.engineSchema,
      sizeBytes: storedSize(meta),
    });
    try {
      await this.persistRegistry();
    } catch (err) {
      // The revision is already committed. Boot reconciliation repairs the
      // derived registry; report failure now so the writer retries its ACK.
      throw this.storageError("registry refresh", err);
    }
    if (previous !== null) {
      const obsolete = [previous.file, ...previous.updates.map((update) => update.file)];
      for (const file of obsolete) {
        if (file === meta.file) continue;
        void rm(join(revisions, file), { force: true }).catch((error) => {
          this.logger
            .child({ docId })
            .warn(
              "fieldd.docs.revision_cleanup_failed",
              "An obsolete document revision could not be removed",
              { error },
            );
        });
      }
    }
    // Legacy files are no longer authoritative after current.json commits.
    void rm(this.snapshotPath(docId), { force: true }).catch(() => {});
    void rm(join(dir, "meta.json"), { force: true }).catch(() => {});
    this.announce({
      docId,
      origin,
      kind: "checkpoint",
      payload: stored,
      meta: currentMeta(meta),
      baseEpoch: entry.baseEpoch,
      ...(folded?.delta !== undefined ? { delta: folded.delta } : {}),
    });
    // DS-5d — a window's checkpoint proves it holds the whole of it.
    if (origin === "local") {
      const lifted = liftIce1(bytes);
      if (lifted.ok) this.raiseWindowFloor(docId, lifted.payload);
    }
    return meta;
  }

  /** DS-5 — bring a checkpoint into Loro custody: import it into the doc's
   * host (a fresh one when the doc had no liftable base) and say what the host
   * holds BEYOND it — the residual a replaced journal must keep — and what it
   * ADDED — the delta a DS-5 peer is sent. Null when the frame rule cannot lift
   * it: the doc goes (or stays) opaque, exactly as before DS-5. */
  private async foldCheckpoint(
    docId: string,
    bytes: Uint8Array,
  ): Promise<{
    residual: Uint8Array | null;
    delta: Uint8Array | undefined;
    /** DS-5d — the envelope to store instead of the one that came. */
    stored?: Uint8Array;
  } | null> {
    const lifted = liftIce1(bytes);
    const version = lifted.ok ? snapshotVersion(lifted.payload) : null;
    if (!lifted.ok || version === null) {
      this.host.delete(docId);
      this.opaque.add(docId);
      return null;
    }
    const prior = await this.hostedNow(docId);
    const hosted = prior ?? new HostedDoc(docId);
    // Read before the import: a doc an import panicked answers nothing after.
    const compacted = prior?.isShallow() === true;
    let imported: HostImport;
    try {
      imported = hosted.import(lifted.payload);
    } catch (error) {
      this.host.delete(docId);
      // DS-5d — a COMPACTED host keeps no history below its root, so a
      // checkpoint it cannot take was built across that root (a window that
      // lagged the compaction). The opaque fallback below would store it AS
      // the base — every edit the host held beyond it gone from disk, and the
      // canvas merging nothing again. Refused; the window reopens on the base.
      if (compacted) {
        this.logger
          .child({ docId })
          .warn(
            "fieldd.docs.checkpoint_across_root",
            "A checkpoint built across this document's compacted base was refused",
            { panicked: isLoroPanic(error), error: String(error) },
          );
        throw new RpcCallError(
          "PRECONDITION_FAILED",
          "checkpoint was built across this document's compacted base; reopen the document",
          false,
          { docId, reason: "epoch-mismatch" },
        );
      }
      this.logger
        .child({ docId })
        .warn(
          "fieldd.docs.checkpoint_unmergeable",
          "A checkpoint's Loro payload could not be imported; the document stays in opaque custody",
          { error: String(error) },
        );
      this.opaque.add(docId);
      return null;
    }
    this.opaque.delete(docId);
    this.host.set(hosted);
    this.touch(docId);
    const delta = imported.changed ? hosted.exportSince(imported.before) : undefined;
    // DS-5d — a FULL checkpoint into a COMPACTED host (a window that read the
    // canvas before it was compacted): the host stays shallow, and so must the
    // stored base. Full history under a compacted epoch would hand a holder
    // re-bootstrapping from it history this host cannot merge against — ops it
    // would take and this host would refuse, for good. Stored instead: the
    // host's own base (it holds the window's content and everything else),
    // under the window's header, with nothing residual.
    if (compacted && loroBlobMode(lifted.payload) === "snapshot") {
      return {
        residual: null,
        delta,
        stored: wrapIce1(lifted.header, hosted.doc.export({ mode: "snapshot" })),
      };
    }
    return {
      residual: hosted.isAheadOf(version) ? hosted.exportSince(version) : null,
      delta,
    };
  }

  /** DS-5 — the doc's host, built from its at-rest bytes on first use: the
   * checkpoint's Loro payload, then every journal record in order — exactly
   * the renderer's own replay. Null when the doc holds no checkpoint yet, or
   * one the frame rule cannot lift (opaque custody). Runs on the per-doc chain. */
  private async hostedNow(docId: string): Promise<HostedDoc | null> {
    const cached = this.host.get(docId);
    if (cached !== undefined) {
      this.touch(docId);
      return cached;
    }
    if (this.opaque.has(docId)) return null;
    const revisions = this.revisionsDir(docId);
    let current: CurrentRevision | null;
    let checkpoint: Uint8Array;
    try {
      current = await this.readCurrent(docId);
      if (current === null) return null;
      checkpoint = new Uint8Array(await readFile(join(revisions, current.file)));
    } catch {
      return null; // unreadable at-rest bytes: the next whole write repairs them
    }
    const lifted = liftIce1(checkpoint);
    // DS-5d — a shallow payload too: a compacted base, or the checkpoint of a
    // window opened on one. Taking only full snapshots put a canvas in opaque
    // custody on its first reload after a compaction.
    if (!lifted.ok || !isSnapshotPayload(lifted.payload)) {
      this.opaque.add(docId);
      return null;
    }
    const hosted = new HostedDoc(docId);
    try {
      hosted.import(lifted.payload);
      for (const update of current.updates) {
        hosted.import(new Uint8Array(await readFile(join(revisions, update.file))));
      }
    } catch (error) {
      this.logger
        .child({ docId })
        .warn(
          "fieldd.docs.host_load_failed",
          "A document's at-rest bytes could not be loaded into the host; it stays in opaque custody",
          { error: String(error) },
        );
      this.opaque.add(docId);
      return null;
    }
    this.touch(docId);
    return this.host.set(hosted);
  }

  private async writeUpdateNow(
    entry: DocRegistryEntry,
    bytes: Uint8Array,
    putMeta: LanePutMeta,
    origin: "local" | "peer",
  ): Promise<DocMeta> {
    const docId = entry.docId;
    if (bytes.byteLength === 0) {
      throw new RpcCallError("PRECONDITION_FAILED", "journal update must not be empty", false);
    }
    if (putMeta.baseRevisionId === undefined) {
      throw new RpcCallError("PRECONDITION_FAILED", "journal update needs baseRevisionId", false);
    }
    const current = await this.readCurrent(docId);
    if (current === null) {
      throw new RpcCallError("PRECONDITION_FAILED", "journal update needs a checkpoint", false);
    }
    // THE EPOCH FENCE (S4), which replaced the revision-chain check in C6-3f.
    // Appending is safe within an epoch and never safe across one: compaction
    // replaces the checkpoint underneath, so a pre-compaction update applied
    // after it would be interpreted against a base it was never built on. The
    // caller must re-bootstrap instead — silently appending is how a peer
    // diverges without either side noticing.
    //
    // DS-5d — the renderer declares no epoch. The window that READ this doc
    // composed against the epoch that read served (it can have read nothing
    // else), so fieldd says it for the window; one that read nothing in this
    // daemon's life is refused once the doc has been compacted, as before.
    const declared =
      putMeta.baseEpoch ?? (origin === "local" ? this.servedEpoch.get(docId) : undefined);
    this.assertEpoch(entry, declared);
    // DS-5d — what a window saves, it holds: its floor rises with every save.
    if (origin === "local") this.raiseWindowFloor(docId, bytes);
    if (current.revisionId === putMeta.revisionId) {
      const last = current.updates.at(-1);
      if (last?.revisionId !== putMeta.revisionId || last.byteLength !== bytes.byteLength) {
        throw new RpcCallError("PRECONDITION_FAILED", "revision id was reused", false);
      }
      this.commitRegistryColumns(docId, entry, {
        updatedAt: current.committedAt,
        engineSchema: current.engineSchema,
        sizeBytes: storedSize(current),
      });
      try {
        await this.persistRegistry();
      } catch (err) {
        throw this.storageError("registry refresh", err);
      }
      return currentMeta(current);
    }
    // A stale head is NOT an error here (see LanePutMeta.baseRevisionId): with
    // two writers it is the ordinary case, and the update appends to whatever
    // the head is now. The client learns the real head from PUT_OK.
    if (current.revisionId !== putMeta.baseRevisionId) {
      this.logger.debug(
        "fieldd.docs.update_base_moved",
        "An update was composed against a revision that is no longer head",
        {
          docId,
          composedAgainst: putMeta.baseRevisionId,
          head: current.revisionId,
        },
      );
    }

    // DS-5 — in Loro custody the update goes into the host FIRST: what the
    // host cannot apply is never journaled, and what it already holds is not
    // journaled twice.
    const hosted = await this.hostedNow(docId);
    if (hosted !== null) {
      let imported: HostImport;
      try {
        imported = hosted.import(bytes);
      } catch (error) {
        this.dropHosted(hosted, "window-update", error);
        throw new RpcCallError(
          "PRECONDITION_FAILED",
          "journal update is not a Loro update this host can read",
          false,
          { docId, reason: "undecodable" },
        );
      }
      if (imported.pending) {
        // Its causal base is not held here, so no replay of this journal could
        // apply it — a renderer's would quarantine the document. Refused; the
        // window's autosave answers a failed append with a whole checkpoint,
        // which carries the base with it.
        throw new RpcCallError(
          "PRECONDITION_FAILED",
          "journal update's causal base is not held here; send a checkpoint",
          false,
          { docId, reason: "base-missing" },
        );
      }
      if (!imported.changed) {
        // Already held: the echo of a PUSHED update (ICE's autosave journals
        // applied remote updates too — the spike measured it), or a retry.
        // Nothing new to store, and nothing to tell anyone.
        return currentMeta(current);
      }
    }
    return this.appendNow(
      entry,
      current,
      bytes,
      {
        revisionId: putMeta.revisionId,
        engineSchema: putMeta.engineSchema,
        savedAt: putMeta.savedAt,
      },
      origin,
    );
  }

  /** The durable tail of every journal append: file, then `current.json` (the
   * commit point), then the registry columns, then the announcement. */
  private async appendNow(
    entry: DocRegistryEntry,
    current: CurrentRevision,
    bytes: Uint8Array,
    stamp: { revisionId: string; engineSchema: number | null; savedAt: number },
    origin: "local" | "peer",
  ): Promise<DocMeta> {
    const docId = entry.docId;
    const committedAt = this.now();
    const update: JournalRevision = {
      revisionId: stamp.revisionId,
      file: `${stamp.revisionId}.loro`,
      contentId: contentIdOf(bytes),
      committedAt,
      savedAt: stamp.savedAt,
      byteLength: bytes.byteLength,
    };
    const next: CurrentRevision = {
      ...current,
      revisionId: stamp.revisionId,
      committedAt,
      engineSchema: stamp.engineSchema,
      savedAt: stamp.savedAt,
      updates: [...current.updates, update],
    };
    const dir = join(this.docsDir, docId);
    const revisions = this.revisionsDir(docId);
    try {
      await atomicWrite(revisions, update.file, bytes);
      await atomicWrite(dir, "current.json", `${JSON.stringify(next, null, 2)}\n`);
    } catch (err) {
      // A host that already merged these bytes is now ahead of disk: rebuild
      // it from disk on next use (a peer's lost record comes back on the next
      // version exchange; a window's comes back as its retry).
      this.host.delete(docId);
      throw this.storageError("append", err);
    }

    this.commitRegistryColumns(docId, entry, {
      updatedAt: committedAt,
      engineSchema: stamp.engineSchema,
      sizeBytes: storedSize(next),
    });
    try {
      await this.persistRegistry();
    } catch (err) {
      throw this.storageError("registry refresh", err);
    }
    const committed = currentMeta(next);
    this.announce({
      docId,
      origin,
      kind: "update",
      payload: bytes,
      meta: committed,
      baseEpoch: entry.baseEpoch,
    });
    // DS-5d — the journal is the history this host keeps: past a threshold,
    // the canvas is offered for an epoch bump (queued behind this write).
    if (this.overThreshold(next)) this.requestCompaction(docId);
    return committed;
  }

  /** A listener's failure is ITS problem. Sync is a consumer of durability, not
   * a participant in it — a throw here must never turn a committed write into a
   * failed one, or a sync bug becomes a data-loss bug. */
  private announce(commit: DocCommit): void {
    try {
      this.onCommit?.(commit);
    } catch (error) {
      this.logger.error(
        "fieldd.docs.commit_listener_failed",
        "A commit listener threw; the revision is committed regardless",
        error,
      );
    }
  }

  /** The S4 fence, in one place because both the renderer's writes and a peer's
   * records have to pass the same one.
   *
   * An UNDECLARED epoch is admitted only while the doc has never been
   * compacted. Once it has, a client that cannot say which epoch it built on
   * cannot be shown to have built on the current one — and "probably fine" is
   * not a standard for the operation that decides whether two devices agree. */
  private assertEpoch(entry: DocRegistryEntry, declared: number | undefined): void {
    if (declared === undefined) {
      if (entry.baseEpoch !== 0) {
        throw new RpcCallError(
          "PRECONDITION_FAILED",
          `doc has been compacted to epoch ${entry.baseEpoch}; an update must declare baseEpoch`,
          false,
          { docId: entry.docId, baseEpoch: entry.baseEpoch, reason: "epoch-undeclared" },
        );
      }
      return;
    }
    if (declared !== entry.baseEpoch) {
      throw new RpcCallError(
        "PRECONDITION_FAILED",
        `update belongs to epoch ${declared}, doc is at epoch ${entry.baseEpoch}; re-bootstrap`,
        false,
        { docId: entry.docId, baseEpoch: entry.baseEpoch, reason: "epoch-mismatch" },
      );
    }
  }

  // ---- cross-device sync (C6-3f, C6-3h) ----

  /** What we hold, for a peer to diff against. Null when the doc is unknown or
   * has no content yet — both of which are "send me everything". */
  async syncDigest(docId: string): Promise<DocRecordDigest | null> {
    const entry = this.registry.get(docId);
    if (entry === undefined) return null;
    const current = await this.readCurrent(docId).catch(() => null);
    if (current === null) {
      return { baseEpoch: entry.baseEpoch, hasCheckpoint: false, records: [] };
    }
    const records: string[] = [];
    for (const update of current.updates) {
      records.push(await this.contentIdFor(docId, update.file, update.contentId));
    }
    return { baseEpoch: entry.baseEpoch, hasCheckpoint: true, records };
  }

  /** The records this peer lacks, ready to send.
   *
   * The checkpoint goes only to a peer that has NONE — never to replace one.
   * Two devices legitimately hold different checkpoint bytes for the same
   * logical state, so "their checkpoint differs from mine" is not evidence of
   * anything, and shipping ours would only be declined as would-clobber. */
  async recordsMissing(
    docId: string,
    theirs: DocRecordDigest,
  ): Promise<{
    meta: { baseEpoch: number; engineSchema: number | null; savedAt: number };
    checkpoint: Uint8Array | null;
    updates: Uint8Array[];
  } | null> {
    const entry = this.registry.get(docId);
    if (entry === undefined) return null;
    // A digest from another epoch describes a different lineage. Answering it
    // would push records across a compaction boundary, which is the one thing
    // the S4 fence exists to prevent — so the peer re-bootstraps instead.
    if (theirs.baseEpoch !== entry.baseEpoch) return null;
    const stored = await this.readDoc(docId);
    if (stored === null) return null;

    const held = new Set(theirs.records);
    const current = await this.readCurrent(docId);
    const updates: Uint8Array[] = [];
    for (const [index, update] of (current?.updates ?? []).entries()) {
      const contentId = await this.contentIdFor(docId, update.file, update.contentId);
      const bytes = stored.updates[index];
      if (bytes !== undefined && !held.has(contentId)) updates.push(bytes);
    }
    return {
      meta: {
        baseEpoch: entry.baseEpoch,
        engineSchema: stored.meta.engineSchema,
        savedAt: stored.meta.savedAt,
      },
      checkpoint: theirs.hasCheckpoint ? null : stored.bytes,
      updates,
    };
  }

  private async contentIdFor(docId: string, file: string, known?: string): Promise<string> {
    if (known !== undefined) return known;
    const cached = this.contentIds.get(file);
    if (cached !== undefined) return cached;
    // A revision written before C6-3h. Read it once, remember it — a manifest
    // rewrite on a READ path would be a worse trade than a small cache.
    const bytes = await readFile(join(this.revisionsDir(docId), file));
    const contentId = contentIdOf(bytes);
    this.contentIds.set(file, contentId);
    return contentId;
  }

  /** What became of a peer's record. Declining is a normal outcome, not a
   * failure, so it is a value rather than a thrown error — the caller reports
   * it as sync state (EL5: no silent divergence).
   *
   * DS-5 — on the per-doc chain as a WHOLE: merging is read-modify-write of
   * the host and the journal together, and a write arriving between the two
   * halves would persist a delta computed against a state that no longer is. */
  applyRemoteRecord(docId: string, record: DocSyncRecord): Promise<RemoteRecordOutcome> {
    const system = this.system.get(docId);
    if (system !== undefined) {
      return this.serialize(docId, () => this.mergeSystemNow(system, record));
    }
    return this.serialize(docId, () => this.applyRemoteRecordNow(docId, record));
  }

  /** DS-5 — a peer's update to a SYSTEM document: merged into the owner's own
   * LoroDoc, persisted by the owner, and the owner told (settings refresh their
   * posture and plugin set; the library reconciles the catalog). Never
   * announced — a peer's record is never sent back. */
  private async mergeSystemNow(
    system: SystemDoc,
    record: DocSyncRecord,
  ): Promise<RemoteRecordOutcome> {
    if (record.kind !== DOC_SYNC_RECORD.UPDATE) return { applied: false, reason: "unknown-kind" };
    if (record.meta.baseEpoch !== 0) return { applied: false, reason: "epoch-mismatch" };
    let imported: HostImport;
    try {
      imported = system.hosted.import(record.payload);
    } catch {
      return { applied: false, reason: "undecodable" };
    }
    if (!imported.changed) {
      return { applied: false, reason: imported.pending ? "pending" : "already-held" };
    }
    try {
      await system.owner.persist();
    } catch (error) {
      // The merge stands in memory; the owner's next write persists it. Said,
      // because a lost persist is a lost merge across a restart.
      this.logger.warn(
        "fieldd.docs.system_persist_failed",
        "A system document merged a peer's update but could not persist it",
        { docId: system.hosted.docId, error: String(error) },
      );
    }
    try {
      system.owner.merged?.();
    } catch (error) {
      this.logger.warn("fieldd.docs.system_listener_failed", "A system document owner threw", {
        docId: system.hosted.docId,
        error: String(error),
      });
    }
    const meta: DocMeta = {
      engineSchema: null,
      savedAt: record.meta.savedAt,
      byteLength: record.payload.byteLength,
      baseEpoch: 0,
    };
    return imported.pending ? { applied: true, meta, pending: true } : { applied: true, meta };
  }

  private async applyRemoteRecordNow(
    docId: string,
    record: DocSyncRecord,
  ): Promise<RemoteRecordOutcome> {
    const entry = this.registry.get(docId);
    if (!entry) return { applied: false, reason: "unknown-doc" };

    if (record.kind === DOC_SYNC_RECORD.SNAPSHOT) {
      // A doc with no content is BOOTSTRAPPED by a peer's checkpoint, as ever —
      // and a liftable one puts it straight into Loro custody (writeDocNow).
      if (!this.hasStoredDoc(docId)) {
        // DS-5d — a bootstrap takes the lineage it is handed: the base's epoch.
        // Never one older than this desktop already knows of — the library
        // named a newer one, and a fresher holder's base is on its way.
        if (record.meta.baseEpoch < entry.baseEpoch) {
          return { applied: false, reason: "epoch-mismatch" };
        }
        if (record.meta.baseEpoch > entry.baseEpoch) {
          this.registry.set(docId, { ...entry, baseEpoch: record.meta.baseEpoch });
        }
        const meta = await this.writeDocNow(
          docId,
          record.payload,
          {
            revisionId: randomUUID(),
            kind: "checkpoint",
            engineSchema: record.meta.engineSchema,
            savedAt: record.meta.savedAt,
            byteLength: record.payload.byteLength,
          },
          "peer",
        );
        this.peerMerged(docId);
        return { applied: true, meta };
      }
      // DS-5 (§1.2 defect 1 closed) — a doc that HOLDS content merges a peer's
      // checkpoint instead of declining it: the host imports its Loro payload
      // and keeps exactly what it added. The record-level would-clobber below
      // survives only for the case the host cannot help — either side's
      // checkpoint outside the frame rule (opaque custody, B3 shape A).
      //
      // DS-5c — THE EPOCH FENCE (S4) holds here as it does for an UPDATE: a
      // checkpoint from another epoch is another lineage, and merging it into
      // content is exactly the across-the-boundary apply S4 forbids (latent
      // until compaction bumps an epoch). A doc with NO content still takes
      // one above — that is a (re-)bootstrap, which is what S4 asks for.
      // DS-5d — S4's ANSWER: a holder at a newer epoch, answering this
      // desktop's older-epoch greeting with its base. The one cross-epoch
      // checkpoint that is taken — not merged across the boundary, but
      // re-bootstrapped from (rebootstrapNow). Unmarked, the fence holds.
      if (record.meta.rebootstrap === true && record.meta.baseEpoch > entry.baseEpoch) {
        return this.rebootstrapNow(entry, record);
      }
      if (record.meta.baseEpoch !== entry.baseEpoch) {
        return { applied: false, reason: "epoch-mismatch" };
      }
      const lifted = liftIce1(record.payload);
      if (lifted.ok && isSnapshotPayload(lifted.payload)) {
        const hosted = await this.hostedNow(docId);
        if (hosted !== null) return this.mergeNow(entry, hosted, lifted.payload, record.meta);
      }
      return { applied: false, reason: "would-clobber" };
    }

    if (record.kind !== DOC_SYNC_RECORD.UPDATE) {
      // Tolerant reader: a newer peer may ship a kind this fieldd has no
      // opinion about, and that is not a reason to tear the lane.
      return { applied: false, reason: "unknown-kind" };
    }

    if (record.meta.baseEpoch !== entry.baseEpoch) {
      return { applied: false, reason: "epoch-mismatch" };
    }
    const current = await this.readCurrent(docId);
    if (current === null) return { applied: false, reason: "would-clobber" };

    const hosted = await this.hostedNow(docId);
    if (hosted !== null) return this.mergeNow(entry, hosted, record.payload, record.meta);

    // OPAQUE custody from here down — unchanged since C6-3h.
    //
    // Already held? Then this is a redelivery — a reconnect, a second lane, a
    // HAVE exchange crossing a push — and the right answer is nothing at all.
    // Loro would dedupe it on import anyway, so appending is CORRECT but the
    // journal grows forever; content identity is what makes the whole protocol
    // idempotent, and idempotence is what makes redelivery free.
    const incoming = contentIdOf(record.payload);
    for (const update of current.updates) {
      if ((await this.contentIdFor(docId, update.file, update.contentId)) === incoming) {
        return { applied: false, reason: "already-held" };
      }
    }

    // RE-FRAMED, never appended verbatim: the peer's revision ids belong to the
    // peer's chain and mean nothing here. A fresh id, based on OUR head. The
    // C6-3f probe measured that this converges — and that a record whose causal
    // dependencies have not arrived is held pending by Loro, not lost.
    const meta = await this.writeUpdateNow(
      entry,
      record.payload,
      {
        revisionId: randomUUID(),
        kind: "update",
        baseRevisionId: current.revisionId,
        baseEpoch: entry.baseEpoch,
        engineSchema: record.meta.engineSchema,
        savedAt: record.meta.savedAt,
        byteLength: record.payload.byteLength,
      },
      "peer",
    );
    return { applied: true, meta };
  }

  /** DS-5 — merge a peer's bytes (a checkpoint's Loro payload or an update)
   * into the host and journal EXACTLY what they added: a Loro update exported
   * from the version before, so the journal replays without a pending import
   * whatever order the peer's records arrived in — and a record the host holds
   * as pending is not journaled until the base that resolves it lands. */
  private async mergeNow(
    entry: DocRegistryEntry,
    hosted: HostedDoc,
    bytes: Uint8Array,
    stamp: { engineSchema: number | null; savedAt: number },
  ): Promise<RemoteRecordOutcome> {
    let imported: HostImport;
    try {
      imported = hosted.import(bytes);
    } catch (error) {
      this.dropHosted(hosted, "peer-record", error);
      return { applied: false, reason: "undecodable" };
    }
    if (!imported.changed) {
      return { applied: false, reason: imported.pending ? "pending" : "already-held" };
    }
    const current = await this.readCurrent(entry.docId);
    if (current === null) {
      this.host.delete(entry.docId);
      return { applied: false, reason: "would-clobber" };
    }
    const meta = await this.appendNow(
      entry,
      current,
      hosted.exportSince(imported.before),
      { revisionId: randomUUID(), engineSchema: stamp.engineSchema, savedAt: stamp.savedAt },
      "peer",
    );
    this.peerMerged(entry.docId);
    return imported.pending ? { applied: true, meta, pending: true } : { applied: true, meta };
  }

  // ---- compaction (DS-5d, design-06 §4) ----

  /** The holders the watermark waits for: every OTHER desktop holding a
   * canvas, with what it acknowledged and when it was last heard — or null
   * while the source cannot vouch for all of them (the trim holds). */
  setAcknowledgements(source: (docId: string) => HolderAck[] | null): void {
    this.acknowledgements = source;
  }

  /** Fires when what this desktop's holders slice would say moved without a
   * commit: a window opened, read or closed (its floor is the
   * acknowledgement), or an epoch moved. The slice republishes on it. */
  onHoldingsChanged(fn: () => void): () => void {
    this.holdingsListeners.add(fn);
    return () => this.holdingsListeners.delete(fn);
  }

  private holdingsChanged(): void {
    for (const fn of this.holdingsListeners) {
      try {
        fn();
      } catch (error) {
        this.logger.warn("fieldd.docs.holdings_listener_failed", "A holdings listener threw", {
          error: String(error),
        });
      }
    }
  }

  /** Fires when a canvas's epoch moved here, or the library says it should. */
  onEpochChanged(fn: (docId: string, why: EpochMove) => void): () => void {
    this.epochListeners.add(fn);
    return () => this.epochListeners.delete(fn);
  }

  private emitEpoch(docId: string, why: EpochMove): void {
    for (const fn of this.epochListeners) {
      try {
        fn(docId, why);
      } catch (error) {
        this.logger.warn("fieldd.docs.epoch_listener_failed", "An epoch listener threw", {
          docId,
          why,
          error: String(error),
        });
      }
    }
  }

  /** Compact a canvas NOW, if the watermark allows (on its per-doc chain). */
  compact(docId: string): Promise<CompactOutcome> {
    return this.serialize(docId, () => this.compactNow(docId));
  }

  /** Has this journal grown past either threshold? */
  private overThreshold(current: CurrentRevision): boolean {
    if (!this.compaction.on) return false;
    const bytes = current.updates.reduce((total, update) => total + update.byteLength, 0);
    return (
      current.updates.length >= this.compaction.records || bytes >= this.compaction.journalBytes
    );
  }

  /** Queue an attempt behind whatever the canvas's chain is doing. A hold
   * keeps the canvas WANTED: the next append past the threshold and the close
   * of the window that held it both ask again. */
  private requestCompaction(docId: string): void {
    if (!this.compaction.on) return;
    this.wantsCompaction.add(docId);
    if (this.compacting.has(docId) || this.writers.has(docId)) return;
    this.compacting.add(docId);
    void this.serialize(docId, () => this.compactNow(docId))
      .then((outcome) => {
        if (
          outcome.compacted ||
          outcome.reason === "unknown-doc" ||
          outcome.reason === "system-doc" ||
          outcome.reason === "opaque"
        ) {
          this.wantsCompaction.delete(docId);
          return;
        }
        this.logger.child({ docId }).debug("fieldd.docs.compaction_held", "A compaction is held", {
          reason: outcome.reason,
          ...(outcome.device !== undefined ? { device: outcome.device } : {}),
        });
      })
      .catch((error: unknown) => {
        this.logger.child({ docId }).warn("fieldd.docs.compaction_failed", "A compaction failed", {
          error: String(error),
        });
      })
      .finally(() => this.compacting.delete(docId));
  }

  /** THE EPOCH BUMP (design-06 §4). On the per-doc chain. The base becomes a
   * Loro shallow snapshot AT the watermark — the meet of this desktop's
   * version and every known holder's acknowledgement (a holder past DS-D17's
   * horizon is not waited for) — framed by the ICE1 rule under the header of
   * the newest checkpoint, with an EMPTY journal: everything above the
   * watermark is the base's own history. The oplog below it is gone, here
   * and in memory (the trial doc becomes the host). The epoch bumps in the
   * stored revision (the commit point), the registry and the library — one
   * library write, converging like any other — and a holder at an older epoch
   * re-bootstraps from a fresh one (S4, doc-sync's answer). */
  private async compactNow(docId: string): Promise<CompactOutcome> {
    const entry = this.registry.get(docId);
    if (entry === undefined || entry.deletedAt !== undefined) {
      return { compacted: false, reason: "unknown-doc" };
    }
    if (this.system.has(docId)) return { compacted: false, reason: "system-doc" };
    // A window holds the canvas: it appends against the epoch it read, and
    // the base it read is the one a compaction would replace under it.
    if (this.writers.has(docId)) return { compacted: false, reason: "window-open" };
    const hosted = await this.hostedNow(docId);
    if (hosted === null) return { compacted: false, reason: "opaque" };
    // Ops pending their base are the one thing a host holds that disk does not.
    if (hosted.hasPending()) return { compacted: false, reason: "pending" };
    let current: CurrentRevision | null;
    let checkpoint: Uint8Array;
    try {
      current = await this.readCurrent(docId);
      if (current === null) return { compacted: false, reason: "opaque" };
      checkpoint = new Uint8Array(await readFile(join(this.revisionsDir(docId), current.file)));
    } catch (error) {
      this.logger.child({ docId }).warn("fieldd.docs.compaction_unreadable", "No base to compact", {
        error: String(error),
      });
      return { compacted: false, reason: "storage" };
    }
    const framed = liftIce1(checkpoint);
    if (!framed.ok) return { compacted: false, reason: "opaque" };
    const holders = this.acknowledgements(docId);
    if (holders === null) return { compacted: false, reason: "holders-unknown" };
    const mark = watermark(hosted.version(), holders, this.now(), this.compaction.retirementMs);
    if (!mark.ok) return { compacted: false, reason: mark.reason, device: mark.device };
    if (covers(hosted.rootVersion(), mark.version)) {
      return { compacted: false, reason: "nothing-to-trim" };
    }
    const key = versionToBase64(mark.version);
    const failed = this.failedTrims.get(docId);
    if (failed?.key === key) return { compacted: false, reason: failed.reason };
    const trimmed = hosted.compactTo(mark.version);
    if (!trimmed.ok) {
      if (trimmed.reason === "unloadable") {
        this.failedTrims.set(docId, { key, reason: "unloadable" });
      }
      this.logger
        .child({ docId })
        .info("fieldd.docs.compaction_refused", "A compacted base failed its trial", {
          reason: trimmed.reason,
          ...(trimmed.detail !== undefined ? { detail: trimmed.detail } : {}),
        });
      return { compacted: false, reason: trimmed.reason };
    }
    // Loro roots a shallow snapshot at the common ancestor of the watermark's
    // heads (measured), so the root can sit BELOW the watermark — and a second
    // pass at the same watermark lands on the same root. A base no higher than
    // the current one trims nothing: no epoch for it (an epoch sends every
    // holder through S4).
    if (covers(hosted.rootVersion(), new HostedDoc(docId, trimmed.doc).rootVersion())) {
      this.failedTrims.set(docId, { key, reason: "nothing-to-trim" });
      return { compacted: false, reason: "nothing-to-trim" };
    }
    this.failedTrims.delete(docId);

    const envelope = wrapIce1(framed.header, trimmed.bytes);
    const baseEpoch = entry.baseEpoch + 1;
    const revisionId = randomUUID();
    const next: CurrentRevision = {
      revisionId,
      file: `${revisionId}.ice1`,
      contentId: contentIdOf(envelope),
      // Not a content change: the explorer orders canvases by content recency
      // (`updatedAt` follows this), and a background trim must not reorder it.
      committedAt: current.committedAt,
      engineSchema: current.engineSchema,
      savedAt: current.savedAt,
      byteLength: envelope.byteLength,
      baseEpoch,
      updates: [],
    };
    const dir = join(this.docsDir, docId);
    const revisions = this.revisionsDir(docId);
    try {
      await atomicWrite(revisions, next.file, envelope);
      // `current.json` is the commit point: until it lands, the old base stands.
      await atomicWrite(dir, "current.json", `${JSON.stringify(next, null, 2)}\n`);
    } catch (error) {
      void rm(join(revisions, next.file), { force: true }).catch(() => {});
      this.logger
        .child({ docId })
        .error("fieldd.docs.compaction_write_failed", "A compacted base was not written", error);
      return { compacted: false, reason: "storage" };
    }
    // From here the trimmed base IS the canvas — on disk and in the host.
    this.host.set(new HostedDoc(docId, trimmed.doc));
    this.touch(docId);
    this.registry.set(docId, {
      ...(this.registry.get(docId) ?? entry),
      baseEpoch,
      sizeBytes: storedSize(next),
    });
    try {
      await this.persistRegistry();
    } catch (error) {
      // The revision is committed; boot reconciliation takes the epoch from it.
      this.logger.error(
        "fieldd.docs.compaction_registry_failed",
        "The registry did not record a compaction; the stored revision did",
        error,
      );
    }
    for (const file of [current.file, ...current.updates.map((update) => update.file)]) {
      if (file === next.file) continue;
      void rm(join(revisions, file), { force: true }).catch(() => {});
    }
    // The library carries the epoch to every desktop. Never backwards: a
    // desktop that compacted further first already wrote a higher one.
    await this.toLibrary("compact", async (library) => {
      const row = library.get(docId);
      if (row !== undefined && row.baseEpoch >= baseEpoch) return;
      await library.setColumns(docId, { engineSchema: current.engineSchema, baseEpoch }, "compact");
    });
    const bytesBefore = storedSize(current);
    this.logger.child({ docId }).info("fieldd.docs.compacted", "A canvas was compacted", {
      baseEpoch,
      bytesBefore,
      bytesAfter: next.byteLength,
      records: current.updates.length,
      counted: mark.counted.length,
      retired: mark.retired.length,
    });
    this.emitEpoch(docId, "compacted");
    this.holdingsChanged();
    return {
      compacted: true,
      baseEpoch,
      bytesBefore,
      bytesAfter: next.byteLength,
      counted: mark.counted,
      retired: mark.retired,
    };
  }

  /** DS-5d — S4, THE RE-BOOTSTRAP (design-06 §4). A holder at a newer epoch
   * answered this desktop's older-epoch greeting with its base (a shallow
   * snapshot once compacted) and, behind it, the records since. This desktop
   * drops its copy and takes the base — carrying over every op of its own
   * copy the base can take, as ONE residual record (rebaseOnto). An op it
   * cannot take was made concurrent with history the base folded: the known
   * loss design-06 accepts, which the watermark exists to make empty for every
   * holder it waited for. Logged with its count; nothing is panicked into the
   * host (every trial runs in a throwaway doc).
   *
   * An open window: taken now only if what the window provably holds covers
   * the new root — then its next edit lands on the base, and its epoch stamp
   * moves with it. Otherwise deferred until the window closes, then asked for
   * again (writerDetached says `behind`). On the per-doc chain. */
  private async rebootstrapNow(
    entry: DocRegistryEntry,
    record: DocSyncRecord,
  ): Promise<RemoteRecordOutcome> {
    const docId = entry.docId;
    const lifted = liftIce1(record.payload);
    if (!lifted.ok || !isSnapshotPayload(lifted.payload)) {
      return { applied: false, reason: "undecodable" };
    }
    const old = await this.hostedNow(docId);
    const rebased = rebaseOnto(lifted.payload, old);
    if (!rebased.ok) return { applied: false, reason: "undecodable" };
    if (this.writers.has(docId)) {
      const floor = this.windowFloors.get(docId);
      const root = new HostedDoc(docId, rebased.doc).rootVersion();
      if (floor === undefined || !covers(floor, root)) {
        this.rebootstrapDeferred.add(docId);
        this.logger
          .child({ docId })
          .info(
            "fieldd.docs.rebootstrap_deferred",
            "A fresher base waits for the window open on this canvas to close",
            { baseEpoch: record.meta.baseEpoch },
          );
        return { applied: false, reason: "rebootstrap-deferred" };
      }
    }
    const baseEpoch = record.meta.baseEpoch;
    const committedAt = this.now();
    const revisionId = randomUUID();
    const carried: JournalRevision | null =
      rebased.residual === null
        ? null
        : (() => {
            const id = randomUUID();
            return {
              revisionId: id,
              file: `${id}.loro`,
              contentId: contentIdOf(rebased.residual),
              committedAt,
              savedAt: record.meta.savedAt,
              byteLength: rebased.residual.byteLength,
            };
          })();
    const next: CurrentRevision = {
      revisionId,
      file: `${revisionId}.ice1`,
      contentId: contentIdOf(record.payload),
      committedAt,
      engineSchema: record.meta.engineSchema,
      savedAt: record.meta.savedAt,
      byteLength: record.payload.byteLength,
      baseEpoch,
      updates: carried === null ? [] : [carried],
    };
    let previous: CurrentRevision | null = null;
    try {
      previous = await this.readCurrent(docId);
    } catch {
      // the new commit repairs a corrupt pointer
    }
    const dir = join(this.docsDir, docId);
    const revisions = this.revisionsDir(docId);
    try {
      await mkdir(revisions, { recursive: true });
      if (carried !== null && rebased.residual !== null) {
        await atomicWrite(revisions, carried.file, rebased.residual);
      }
      await atomicWrite(revisions, next.file, record.payload);
      // `current.json` is the commit point: until it lands, the old copy stands.
      await atomicWrite(dir, "current.json", `${JSON.stringify(next, null, 2)}\n`);
    } catch (err) {
      throw this.storageError("re-bootstrap", err);
    }
    this.host.set(new HostedDoc(docId, rebased.doc));
    this.opaque.delete(docId);
    this.touch(docId);
    this.failedTrims.delete(docId);
    this.rebootstrapDeferred.delete(docId);
    // A window that stayed open sits on the new base now (its floor covers the root).
    if (this.writers.has(docId)) this.servedEpoch.set(docId, baseEpoch);
    this.commitRegistryColumns(docId, entry, {
      updatedAt: committedAt,
      engineSchema: record.meta.engineSchema,
      sizeBytes: storedSize(next),
    });
    this.registry.set(docId, { ...(this.registry.get(docId) ?? entry), baseEpoch });
    try {
      await this.persistRegistry();
    } catch (err) {
      // The revision is committed; boot reconciliation takes the epoch from it.
      this.logger.error(
        "fieldd.docs.rebootstrap_registry_failed",
        "The registry did not record a re-bootstrap; the stored revision did",
        err,
      );
    }
    if (previous !== null) {
      for (const file of [previous.file, ...previous.updates.map((update) => update.file)]) {
        if (file === next.file || file === carried?.file) continue;
        void rm(join(revisions, file), { force: true }).catch(() => {});
      }
    }
    if (rebased.lostOps > 0) {
      this.logger
        .child({ docId })
        .warn(
          "fieldd.docs.rebootstrap_lost",
          "A re-bootstrap could not carry ops made concurrent with the trimmed history",
          { baseEpoch, lostOps: rebased.lostOps, lostPeers: rebased.lostPeers.length },
        );
    }
    this.logger.child({ docId }).info("fieldd.docs.rebootstrapped", "A canvas re-bootstrapped", {
      baseEpoch,
      carriedBytes: rebased.residual?.byteLength ?? 0,
      lostOps: rebased.lostOps,
    });
    const meta = currentMeta(next);
    // What this desktop carried over is content its peers may lack: it goes
    // out like a local commit, at the new epoch.
    if (rebased.residual !== null) {
      this.announce({
        docId,
        origin: "local",
        kind: "update",
        payload: rebased.residual,
        meta,
        baseEpoch,
      });
    }
    this.peerMerged(docId);
    this.emitEpoch(docId, "rebootstrapped");
    this.holdingsChanged();
    return { applied: true, meta };
  }

  /** DS-5d — this desktop's epoch for a canvas (a system document's is 0). */
  baseEpochOf(docId: string): number | undefined {
    if (this.system.has(docId)) return 0;
    return this.registry.get(docId)?.baseEpoch;
  }

  // ---- open windows (DS-5, §1.2 defect 2) ----

  /** Fires after a peer's bytes changed a canvas — what an open window on
   * this device has not seen. Listeners act OFF the per-doc chain. */
  onPeerMerged(fn: (docId: string) => void): () => void {
    this.peerMergeListeners.add(fn);
    return () => this.peerMergeListeners.delete(fn);
  }

  private peerMerged(docId: string): void {
    for (const fn of this.peerMergeListeners) {
      try {
        fn(docId);
      } catch (error) {
        this.logger.warn("fieldd.docs.merge_listener_failed", "A merge listener threw", {
          docId,
          error: String(error),
        });
      }
    }
  }

  /** A window's GET: the at-rest doc AND the host version it amounts to, read
   * together on the per-doc chain so no merge can land between them — that
   * version is the first thing this device can PROVE the window holds. */
  readDocForWindow(docId: string): Promise<{
    bytes: Uint8Array;
    updates: Uint8Array[];
    meta: DocMeta;
    version: Uint8Array | null;
  } | null> {
    return this.serialize(docId, async () => {
      const read = await this.readDoc(docId);
      if (read === null) return null;
      const hosted = await this.hostedNow(docId);
      // DS-5d — the epoch this window builds on, and what it can be held to.
      this.servedEpoch.set(docId, read.meta.baseEpoch);
      if (hosted !== null && this.writers.has(docId)) {
        this.windowFloors.set(docId, hosted.version());
        this.holdingsChanged();
      }
      return { ...read, version: hosted?.encodedVersion() ?? null };
    });
  }

  /** What a window that provably holds `known` lacks — a Loro update it can
   * apply with no pending import, because every op in it depends only on ops
   * in `known` or in itself. Null when it lacks nothing, or the doc is not in
   * Loro custody. */
  windowUpdateSince(docId: string, known: Uint8Array): Promise<Uint8Array | null> {
    return this.serialize(docId, async () => {
      const hosted = await this.hostedNow(docId);
      const version = decodeVersion(known);
      if (hosted === null || version === null || !hosted.isAheadOf(version)) return null;
      // DS-5d — never from below a compacted root: Loro would export FROM the
      // root, and the window would hold the ops pending — quarantined.
      if (!hosted.canAnswer(version)) {
        this.logger
          .child({ docId })
          .warn(
            "fieldd.docs.push_below_root",
            "A window's proven version lies below the compacted base; it is not pushed",
          );
        return null;
      }
      return hosted.exportSince(version);
    });
  }

  // ---- the Loro-level host's version exchange (DS-5) ----

  /** What the host holds of a doc, for a VERSION record. Null when the version
   * exchange cannot speak for it — an unknown doc, or one in opaque custody
   * (the legacy HAVE speaks for that one). */
  hostVersion(docId: string): Promise<HostVersion | null> {
    const system = this.system.get(docId);
    if (system !== undefined) {
      return Promise.resolve({
        version: system.hosted.encodedVersion(),
        hasCheckpoint: true,
        baseEpoch: 0,
      });
    }
    return this.serialize(docId, async () => {
      const entry = this.registry.get(docId);
      if (entry === undefined) return null;
      if (!this.hasStoredDoc(docId)) {
        return {
          version: EMPTY_VERSION().encode(),
          hasCheckpoint: false,
          baseEpoch: entry.baseEpoch,
        };
      }
      const hosted = await this.hostedNow(docId);
      if (hosted === null) return null;
      return {
        version: hosted.encodedVersion(),
        hasCheckpoint: true,
        baseEpoch: entry.baseEpoch,
      };
    });
  }

  /** Exactly what a holder at `theirs` lacks. A holder with no checkpoint gets
   * this device's stored checkpoint envelope first — what a renderer needs to
   * open anything — and then the update from the CHECKPOINT's version, so the
   * pair is precisely checkpoint + journal as held here. Null when there is
   * nothing to say: an unknown or opaque doc, another epoch (S4 — never answer
   * across a compaction), or a version the bytes do not decode to. */
  hostAnswer(docId: string, theirs: HostVersion): Promise<HostAnswer | null> {
    const system = this.system.get(docId);
    if (system !== undefined) {
      const version = theirs.baseEpoch === 0 ? decodeVersion(theirs.version) : null;
      if (version === null) return Promise.resolve(null);
      return Promise.resolve({
        meta: { baseEpoch: 0, engineSchema: null, savedAt: this.now() },
        snapshot: null,
        update: system.hosted.isAheadOf(version) ? system.hosted.exportSince(version) : null,
      });
    }
    return this.serialize(docId, async () => {
      const entry = this.registry.get(docId);
      // A NEWER epoch than ours: we are the stale side, nothing to answer.
      if (entry === undefined || theirs.baseEpoch > entry.baseEpoch) return null;
      const hosted = await this.hostedNow(docId);
      if (hosted === null) return null;
      const current = await this.readCurrent(docId);
      if (current === null) return null;
      const meta = {
        baseEpoch: entry.baseEpoch,
        engineSchema: current.engineSchema,
        savedAt: current.savedAt,
      };
      // DS-5d — S4: an OLDER epoch is never answered with a delta across the
      // compaction (S4's whole law); it is answered with this desktop's BASE
      // and the records since, and re-bootstraps from them.
      const s4 = theirs.baseEpoch < entry.baseEpoch;
      if (!theirs.hasCheckpoint || s4) {
        const checkpoint = new Uint8Array(
          await readFile(join(this.revisionsDir(docId), current.file)),
        );
        const lifted = liftIce1(checkpoint);
        const base = lifted.ok ? snapshotVersion(lifted.payload) : null;
        if (base === null) return null;
        return {
          meta,
          snapshot: checkpoint,
          update: hosted.isAheadOf(base) ? hosted.exportSince(base) : null,
          ...(s4 ? { rebootstrap: true as const } : {}),
        };
      }
      const version = decodeVersion(theirs.version);
      if (version === null) return null;
      if (!hosted.isAheadOf(version)) return { meta, snapshot: null, update: null };
      // DS-5d — a holder at this epoch that lacks the compacted root cannot be
      // sent a delta (Loro would export it FROM the root: ops whose base the
      // holder can never get). Same-epoch holders hold the root by
      // construction; this is the guard that keeps a broken one from a
      // broken answer.
      if (!hosted.canAnswer(version)) {
        this.logger
          .child({ docId })
          .warn(
            "fieldd.docs.answer_below_root",
            "A holder's version lies below the compacted base; it is not sent a delta",
          );
        return null;
      }
      return { meta, snapshot: null, update: hosted.exportSince(version) };
    });
  }

  /** Does this device's host hold everything `version` names? False for a doc
   * outside Loro custody — nothing can be claimed about it. */
  hostCovers(docId: string, version: Uint8Array): Promise<boolean> {
    const system = this.system.get(docId);
    if (system !== undefined) {
      const theirs = decodeVersion(version);
      return Promise.resolve(theirs !== null && covers(system.hosted.version(), theirs));
    }
    return this.serialize(docId, async () => {
      const hosted = await this.hostedNow(docId);
      const theirs = decodeVersion(version);
      if (hosted === null || theirs === null) return false;
      return covers(hosted.version(), theirs);
    });
  }

  // ---- health / lifecycle ----

  health(): DocServiceHealth {
    return { state: this.storageOk ? "ready" : "failed", docCount: this.registry.size };
  }

  dispose(): void {
    // writes are per-call and already durable; only in-memory admission state to drop
    this.tickets.clear();
    this.writers.clear();
    if (this.sweepTimer !== null) clearInterval(this.sweepTimer);
    this.sweepTimer = null;
  }

  // ---- internals ----

  private snapshotPath(docId: string): string {
    return join(this.docsDir, docId, "snapshot.ice1");
  }

  private revisionsDir(docId: string): string {
    return join(this.docsDir, docId, "revisions");
  }

  private currentPath(docId: string): string {
    return join(this.docsDir, docId, "current.json");
  }

  private hasStoredDoc(docId: string): boolean {
    return existsSync(this.currentPath(docId)) || existsSync(this.snapshotPath(docId));
  }

  private async readCurrent(docId: string): Promise<CurrentRevision | null> {
    const path = this.currentPath(docId);
    if (!existsSync(path)) return null;
    return parseCurrentRevision(JSON.parse(await readFile(path, "utf8")), docId);
  }

  private readMeta(docId: string, byteLength: number): DocMeta {
    const metaPath = join(this.docsDir, docId, "meta.json");
    if (existsSync(metaPath)) {
      try {
        const parsed = DocMeta.safeParse(JSON.parse(readFileSync(metaPath, "utf8")));
        if (parsed.success) return parsed.data;
      } catch {
        /* fall through to the synthesized sidecar below */
      }
      this.logger
        .child({ docId })
        .warn(
          "fieldd.docs.metadata_unreadable",
          "Document metadata was unreadable; registry metadata was used",
        );
    }
    const entry = this.registry.get(docId);
    return {
      engineSchema: entry?.engineSchema ?? null,
      savedAt: entry?.updatedAt ?? this.now(),
      byteLength,
      baseEpoch: entry?.baseEpoch ?? 0,
    };
  }

  private sweepTickets(): void {
    const t = this.now();
    for (const [ticket, rec] of this.tickets) {
      if (t >= rec.expiresAt) this.tickets.delete(ticket);
    }
  }

  /** Write back the columns this commit owns, over the registry entry AS IT IS
   * NOW — not over the copy captured before the write's I/O.
   *
   * Found landing UA-6: a write is async, and a registry edit can land inside
   * that window. `doc.setSyncIntent` during a save spread the pre-save entry
   * back over itself on completion, so a doc told to stay home quietly went on
   * syncing. Rename had the same hole and had simply never been raced. The
   * content-derived columns are still this write's to state (`reconcileRegistry`
   * says current.json is authoritative for exactly these); everything else on
   * the entry belongs to whoever touched it last. */
  private commitRegistryColumns(
    docId: string,
    captured: DocRegistryEntry,
    columns: { updatedAt: number; engineSchema: number | null; sizeBytes: number },
  ): void {
    this.registry.set(docId, { ...(this.registry.get(docId) ?? captured), ...columns });
  }

  private async persistRegistry(): Promise<void> {
    await atomicWrite(
      this.registryDir,
      this.registryFile,
      `${JSON.stringify([...this.registry.values()], null, 2)}\n`,
    );
  }

  /** `current.json` is authoritative for content-derived registry columns. */
  private reconcileRegistry(): void {
    let changed = false;
    for (const [docId, entry] of this.registry) {
      const path = this.currentPath(docId);
      if (!existsSync(path)) continue;
      try {
        const current = parseCurrentRevision(JSON.parse(readFileSync(path, "utf8")), docId);
        // DS-5d — the epoch too: a compaction commits it in `current.json`
        // first, so a crash before the registry write must not boot the
        // canvas at the epoch it left.
        if (
          entry.updatedAt !== current.committedAt ||
          entry.engineSchema !== current.engineSchema ||
          entry.sizeBytes !== storedSize(current) ||
          entry.baseEpoch !== current.baseEpoch
        ) {
          this.registry.set(docId, {
            ...entry,
            updatedAt: current.committedAt,
            engineSchema: current.engineSchema,
            sizeBytes: storedSize(current),
            baseEpoch: current.baseEpoch,
          });
          changed = true;
        }
      } catch (err) {
        this.logger
          .child({ docId })
          .error(
            "fieldd.docs.current_revision_unreadable",
            "The current document revision was unreadable",
            err,
          );
      }
    }
    if (changed)
      void this.persistRegistry().catch((err) => {
        this.logger.error(
          "fieldd.docs.reconcile_persist_failed",
          "The reconciled document registry could not be persisted",
          err,
        );
      });
  }

  private storageError(op: string, err: unknown): RpcCallError {
    this.storageOk = false;
    return new RpcCallError("INTERNAL", `document storage ${op} failed: ${errMsg(err)}`, true);
  }

  /** Tolerant reader (design-00): missing → empty; corrupt → moved aside, boot lives;
   * per-entry safeParse drops the invalid, passthrough keeps unknown fields on the valid. */
  private loadRegistry(): void {
    if (!existsSync(this.registryPath)) return;
    let raw: string;
    try {
      raw = readFileSync(this.registryPath, "utf8");
    } catch (e) {
      this.logger.error(
        "fieldd.docs.registry_unreadable",
        "The document registry was unreadable; an empty registry was started",
        e,
      );
      return;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      this.quarantineRegistry("corrupt JSON");
      return;
    }
    if (!Array.isArray(parsed)) {
      this.quarantineRegistry("registry is not an array");
      return;
    }
    for (const item of parsed) {
      const entry = DocRegistryEntry.safeParse(item);
      if (entry.success) this.registry.set(entry.data.docId, entry.data);
      else
        this.logger.warn(
          "fieldd.docs.registry_entry_rejected",
          "An invalid document registry entry was rejected",
          { issueCount: entry.error.issues.length },
        );
    }
  }

  private quarantineRegistry(why: string): void {
    const aside = `${this.registryPath}.corrupt-${this.now()}`;
    try {
      durableRenameSync(this.registryPath, aside);
      this.logger.warn(
        "fieldd.docs.registry_quarantined",
        "A corrupt document registry was quarantined",
        { reason: why, quarantinePath: aside },
      );
    } catch (e) {
      this.logger.error(
        "fieldd.docs.registry_quarantine_failed",
        "A corrupt document registry could not be quarantined",
        e,
        { reason: why },
      );
    }
  }
}

/** tmp-in-same-dir → fsync file → rename → fsync dir. No partial file is ever
 * observable at the target path; a failure before rename leaves only the tmp,
 * which is removed. (design-00 durability law; the restart test depends on it.) */
async function atomicWrite(dir: string, name: string, data: Uint8Array | string): Promise<void> {
  const target = join(dir, name);
  const tmp = join(dir, `${name}.tmp-${randomBytes(6).toString("hex")}`);
  try {
    const fd = await open(tmp, "w", 0o600);
    try {
      await fd.writeFile(data);
      await fd.sync();
    } finally {
      await fd.close();
    }
    // `durableRename`, never a bare `rename`: the win32 retry it carries is not
    // a nicety here. This is where the miss was FOUND — a real commit failure
    // under full-suite load, `document storage append failed: EPERM ... rename
    // current.json.tmp-… -> current.json`, which on a user's machine is a LOST
    // DOCUMENT SAVE rather than a flaky test. Atomicity is untouched: each
    // attempt is the same all-or-nothing rename (@vibefield/logging owns the
    // budget and the reasoning).
    await durableRename(tmp, target);
  } catch (e) {
    await rm(tmp, { force: true }).catch(() => {});
    throw e;
  }
  // Directory fsync persists the rename. Windows cannot open a directory handle
  // for fsync (EPERM); the atomic rename still holds, so skip it there — the
  // same durability posture the audit store takes (audit/src/index.ts
  // syncDirectory), with packaged-Windows durability proven by its own gate.
  if (process.platform !== "win32") {
    const dirFd = await open(dir, "r");
    try {
      await dirFd.sync();
    } finally {
      await dirFd.close();
    }
  }
}

function parseCurrentRevision(value: unknown, docId: string): CurrentRevision {
  if (value === null || typeof value !== "object") {
    throw new Error(`current revision for ${docId} is not an object`);
  }
  const record = value as Record<string, unknown>;
  const meta = DocMeta.safeParse(record);
  const revisionId = record["revisionId"];
  const file = record["file"];
  const committedAt = record["committedAt"];
  if (
    !meta.success ||
    typeof revisionId !== "string" ||
    !/^[0-9a-f-]{36}$/i.test(revisionId) ||
    typeof file !== "string" ||
    !/^[0-9a-f-]{36}\.ice1$/i.test(file) ||
    !Number.isSafeInteger(committedAt) ||
    (committedAt as number) < 0
  ) {
    throw new Error(`current revision for ${docId} is malformed`);
  }
  const rawUpdates = record["updates"] ?? [];
  if (!Array.isArray(rawUpdates)) {
    throw new Error(`current revision journal for ${docId} is malformed`);
  }
  const updates: JournalRevision[] = rawUpdates.map((value) => {
    if (value === null || typeof value !== "object") {
      throw new Error(`current revision journal for ${docId} is malformed`);
    }
    const item = value as Record<string, unknown>;
    const updateRevisionId = item["revisionId"];
    const updateFile = item["file"];
    const updateCommittedAt = item["committedAt"];
    const savedAt = item["savedAt"];
    const byteLength = item["byteLength"];
    if (
      typeof updateRevisionId !== "string" ||
      !/^[0-9a-f-]{36}$/i.test(updateRevisionId) ||
      updateFile !== `${updateRevisionId}.loro` ||
      !Number.isSafeInteger(updateCommittedAt) ||
      !Number.isSafeInteger(savedAt) ||
      !Number.isSafeInteger(byteLength) ||
      (updateCommittedAt as number) < 0 ||
      (savedAt as number) < 0 ||
      (byteLength as number) <= 0
    ) {
      throw new Error(`current revision journal for ${docId} is malformed`);
    }
    const updateContentId = item["contentId"];
    return {
      revisionId: updateRevisionId,
      file: updateFile as string,
      committedAt: updateCommittedAt as number,
      savedAt: savedAt as number,
      byteLength: byteLength as number,
      // Tolerant: revisions written before C6-3h carry none, and that is a
      // thing to fill in later rather than a malformed manifest.
      ...(typeof updateContentId === "string" ? { contentId: updateContentId } : {}),
    };
  });
  const checkpointContentId = record["contentId"];
  return {
    ...meta.data,
    revisionId,
    file,
    committedAt: committedAt as number,
    ...(typeof checkpointContentId === "string" ? { contentId: checkpointContentId } : {}),
    updates,
  };
}

/** DS-5c (DS-D7) — "listed, not openable here": the honest UNAVAILABLE, naming
 * the desktop the canvas lives on when one is known. Not retryable — the
 * canvas opens on its home, or here once its person lets it travel. */
function heldElsewhere(docId: string, device: string | undefined): RpcCallError {
  return new RpcCallError("UNAVAILABLE", `canvas ${docId} lives on another desktop`, false, {
    service: "docs",
    state: "held-elsewhere",
    ...(device !== undefined ? { device } : {}),
  });
}

function currentMeta(current: CurrentRevision): DocMeta {
  return {
    revisionId: current.revisionId,
    engineSchema: current.engineSchema,
    savedAt: current.savedAt,
    byteLength: current.byteLength,
    baseEpoch: current.baseEpoch,
    journalEntries: current.updates.length,
  };
}

function storedSize(current: CurrentRevision): number {
  return (
    current.byteLength + current.updates.reduce((total, update) => total + update.byteLength, 0)
  );
}

function errMsg(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}
