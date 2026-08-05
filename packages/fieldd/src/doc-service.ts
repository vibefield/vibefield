import { createHash, randomBytes, randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync } from "node:fs";
import { mkdir, open, readFile, rename, rm, stat } from "node:fs/promises";
import { join } from "node:path";
import {
  DOC_SYNC_RECORD,
  DocMeta,
  DocRegistryEntry,
  type DocSyncRecord,
  LANE_MAX_FRAME_BYTES,
  LAYOUT,
  type LanePutMeta,
  STORES,
} from "@vibefield/contracts";
import { createNoopLogger, type Logger } from "@vibefield/logging";
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

const ICE1_MAGIC = [0x49, 0x43, 0x45, 0x31] as const; // "ICE1"

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

  constructor(opts: DocumentServiceOptions) {
    this.dataDir = opts.dataDir;
    this.now = opts.now ?? Date.now;
    this.ticketTtlMs = opts.ticketTtlMs ?? 30_000;
    this.logger = opts.logger ?? createNoopLogger();
    this.onCommit = opts.onCommit;
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
  }

  // ---- catalog ----

  async create(name: string): Promise<DocRegistryEntry> {
    const docId = randomUUID();
    const entry: DocRegistryEntry = {
      docId,
      name,
      updatedAt: this.now(),
      baseEpoch: 0,
      engineSchema: null,
      sizeBytes: 0,
    };
    try {
      await mkdir(join(this.docsDir, docId), { recursive: true });
      this.registry.set(docId, entry);
      await this.persistRegistry();
    } catch (err) {
      this.registry.delete(docId);
      throw this.storageError("create", err);
    }
    return entry;
  }

  list(): DocRegistryEntry[] {
    return [...this.registry.values()];
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
    return renamed;
  }

  // ---- lane admission ----

  /** Mints a one-shot lane ticket, or refuses if a writer already holds the doc. */
  open(docId: string): DocOpenGrant {
    if (!this.registry.has(docId))
      throw new RpcCallError("NOT_FOUND", `no such doc: ${docId}`, false);
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
  }

  writerDetached(docId: string): void {
    this.writers.delete(docId);
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
    const prior = this.writes.get(docId) ?? Promise.resolve();
    const write = prior.catch(() => {}).then(() => this.writeDocNow(docId, bytes, putMeta, origin));
    const tail = write.then(
      () => {},
      () => {},
    );
    this.writes.set(docId, tail);
    return write.finally(() => {
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

    const revisionId = putMeta.revisionId;
    const meta: CurrentRevision = {
      revisionId,
      file: `${revisionId}.ice1`,
      contentId: contentIdOf(bytes),
      committedAt: this.now(),
      engineSchema: putMeta.engineSchema,
      savedAt: putMeta.savedAt,
      byteLength: bytes.byteLength,
      baseEpoch: entry.baseEpoch,
      updates: [],
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
      await atomicWrite(revisions, meta.file, bytes);
      // `current.json` is the sole commit point. Until this rename lands the
      // previous complete revision remains authoritative.
      await atomicWrite(dir, "current.json", `${JSON.stringify(meta, null, 2)}\n`);
    } catch (err) {
      throw this.storageError("write", err);
    }

    this.registry.set(docId, {
      ...entry,
      updatedAt: meta.committedAt,
      engineSchema: putMeta.engineSchema,
      sizeBytes: bytes.byteLength,
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
      payload: bytes,
      meta: currentMeta(meta),
      baseEpoch: entry.baseEpoch,
    });
    return meta;
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
    this.assertEpoch(entry, putMeta.baseEpoch);
    if (current.revisionId === putMeta.revisionId) {
      const last = current.updates.at(-1);
      if (last?.revisionId !== putMeta.revisionId || last.byteLength !== bytes.byteLength) {
        throw new RpcCallError("PRECONDITION_FAILED", "revision id was reused", false);
      }
      this.registry.set(docId, {
        ...entry,
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

    const committedAt = this.now();
    const update: JournalRevision = {
      revisionId: putMeta.revisionId,
      file: `${putMeta.revisionId}.loro`,
      contentId: contentIdOf(bytes),
      committedAt,
      savedAt: putMeta.savedAt,
      byteLength: bytes.byteLength,
    };
    const next: CurrentRevision = {
      ...current,
      revisionId: putMeta.revisionId,
      committedAt,
      engineSchema: putMeta.engineSchema,
      savedAt: putMeta.savedAt,
      updates: [...current.updates, update],
    };
    const dir = join(this.docsDir, docId);
    const revisions = this.revisionsDir(docId);
    try {
      await atomicWrite(revisions, update.file, bytes);
      await atomicWrite(dir, "current.json", `${JSON.stringify(next, null, 2)}\n`);
    } catch (err) {
      throw this.storageError("append", err);
    }

    this.registry.set(docId, {
      ...entry,
      updatedAt: committedAt,
      engineSchema: putMeta.engineSchema,
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
   * it as sync state (EL5: no silent divergence). */
  async applyRemoteRecord(
    docId: string,
    record: DocSyncRecord,
  ): Promise<
    | { applied: true; meta: DocMeta }
    | {
        applied: false;
        reason:
          | "unknown-doc"
          | "would-clobber"
          | "epoch-mismatch"
          | "unknown-kind"
          | "already-held";
      }
  > {
    const entry = this.registry.get(docId);
    if (!entry) return { applied: false, reason: "unknown-doc" };

    if (record.kind === DOC_SYNC_RECORD.SNAPSHOT) {
      // Bootstrap ONLY. fieldd cannot merge two checkpoints because it cannot
      // read them (B3 shape A), and writeDoc replaces rather than merges — so
      // accepting a peer's checkpoint over local content would destroy work
      // that Loro itself would happily have merged. Declining is the honest
      // move; merging belongs to the renderer, which holds the live doc.
      if (this.hasStoredDoc(docId)) return { applied: false, reason: "would-clobber" };
      const meta = await this.writeDoc(
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
      return { applied: true, meta };
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
    const meta = await this.writeDoc(
      docId,
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

  // ---- health / lifecycle ----

  health(): DocServiceHealth {
    return { state: this.storageOk ? "ready" : "failed", docCount: this.registry.size };
  }

  dispose(): void {
    // writes are per-call and already durable; only in-memory admission state to drop
    this.tickets.clear();
    this.writers.clear();
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
        if (
          entry.updatedAt !== current.committedAt ||
          entry.engineSchema !== current.engineSchema ||
          entry.sizeBytes !== storedSize(current)
        ) {
          this.registry.set(docId, {
            ...entry,
            updatedAt: current.committedAt,
            engineSchema: current.engineSchema,
            sizeBytes: storedSize(current),
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
      renameSync(this.registryPath, aside);
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

function hasIce1Magic(bytes: Uint8Array): boolean {
  return bytes.byteLength >= ICE1_MAGIC.length && ICE1_MAGIC.every((b, i) => bytes[i] === b);
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
    await rename(tmp, target);
  } catch (e) {
    await rm(tmp, { force: true }).catch(() => {});
    throw e;
  }
  const dirFd = await open(dir, "r");
  try {
    await dirFd.sync();
  } finally {
    await dirFd.close();
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
