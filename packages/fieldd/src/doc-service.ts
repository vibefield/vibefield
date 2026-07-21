import { randomBytes, randomUUID } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
} from "node:fs";
import { mkdir, open, readFile, rename, rm } from "node:fs/promises";
import { join } from "node:path";
import {
  DocMeta,
  DocRegistryEntry,
  LANE_MAX_FRAME_BYTES,
  type LanePutMeta,
  STORES,
} from "@vibefield/contracts";
import { RpcCallError } from "./native-link";

// DocumentService (design-02 §3.5, B3 shape A): fieldd owns the board's at-rest
// bytes and NOTHING about their meaning. A doc is an OPAQUE ICE1 envelope stored
// as docs/{docId}/snapshot.ice1 + meta.json; the field.docs.v1 registry is the
// catalog. fieldd never decodes the envelope (the renderer is the live truth) —
// the only inspection is the cheap ICE1 magic gate. Bytes ride the :9411 lane,
// never JSON-RPC (EL2); doc.open mints the one-shot ticket that gates it.
//
// Durability is the whole point (P0 exit criterion — the board survives restarts):
// every write is tmp-file → fsync → rename → dir-fsync, so a crash mid-write can
// never leave a torn snapshot, only the prior whole one. The registry read on boot
// is a tolerant reader — a corrupt catalog is moved aside, never fatal.

const ICE1_MAGIC = [0x49, 0x43, 0x45, 0x31] as const; // "ICE1"

export interface DocumentServiceOptions {
  dataDir: string;
  /** injectable clock — the ticket-expiry unit tests drive it directly */
  now?: () => number;
  /** one-shot lane ticket lifetime (default 30s) */
  ticketTtlMs?: number;
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
}

export class DocumentService {
  private readonly dataDir: string;
  private readonly now: () => number;
  private readonly ticketTtlMs: number;
  private readonly docsDir: string;
  private readonly registryDir: string;
  private readonly registryFile: string;
  private readonly registryPath: string;

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
    this.docsDir = join(this.dataDir, "docs");
    this.registryDir = join(this.dataDir, "registries");
    this.registryFile = `${STORES.DOCS}.json`;
    this.registryPath = join(this.registryDir, this.registryFile);
    try {
      mkdirSync(this.docsDir, { recursive: true });
      mkdirSync(this.registryDir, { recursive: true });
      this.storageOk = true;
    } catch (e) {
      // honest degraded state — health() reports "failed", boot does not die
      console.error(`[doc-service] storage init failed: ${errMsg(e)}`);
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

  async readDoc(docId: string): Promise<{ bytes: Uint8Array; meta: DocMeta } | null> {
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
        return { bytes, meta: current };
      }
      const legacy = this.snapshotPath(docId);
      if (!existsSync(legacy)) return null;
      const bytes = await readFile(legacy);
      return { bytes, meta: this.readMeta(docId, bytes.byteLength) };
    } catch (err) {
      if (err instanceof RpcCallError) throw err;
      throw this.storageError("read", err);
    }
  }

  /** Validates then persists atomically, then updates the registry. Any validation
   * failure throws BEFORE the first byte hits disk — prior bytes stay untouched. */
  writeDoc(docId: string, bytes: Uint8Array, putMeta: LanePutMeta): Promise<DocMeta> {
    const prior = this.writes.get(docId) ?? Promise.resolve();
    const write = prior.catch(() => {}).then(() => this.writeDocNow(docId, bytes, putMeta));
    const tail = write.then(
      () => {},
      () => {},
    );
    this.writes.set(docId, tail);
    return write.finally(() => {
      if (this.writes.get(docId) === tail) this.writes.delete(docId);
    });
  }

  private async writeDocNow(docId: string, bytes: Uint8Array, putMeta: LanePutMeta): Promise<DocMeta> {
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
    if (!hasIce1Magic(bytes))
      throw new RpcCallError("PRECONDITION_FAILED", "payload is not an ICE1 envelope", false);

    const revisionId = putMeta.revisionId;
    const meta: CurrentRevision = {
      revisionId,
      file: `${revisionId}.ice1`,
      committedAt: this.now(),
      engineSchema: putMeta.engineSchema,
      savedAt: putMeta.savedAt,
      byteLength: bytes.byteLength,
      baseEpoch: entry.baseEpoch,
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
    if (previous !== null && previous.revisionId !== revisionId) {
      void rm(join(revisions, previous.file), { force: true }).catch((err) =>
        console.warn(`[doc-service] old revision cleanup failed for ${docId}: ${errMsg(err)}`),
      );
    }
    // Legacy files are no longer authoritative after current.json commits.
    void rm(this.snapshotPath(docId), { force: true }).catch(() => {});
    void rm(join(dir, "meta.json"), { force: true }).catch(() => {});
    return meta;
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
      console.warn(`[doc-service] meta.json unreadable for ${docId}; synthesizing from registry`);
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
          entry.sizeBytes !== current.byteLength
        ) {
          this.registry.set(docId, {
            ...entry,
            updatedAt: current.committedAt,
            engineSchema: current.engineSchema,
            sizeBytes: current.byteLength,
          });
          changed = true;
        }
      } catch (err) {
        console.error(`[doc-service] current revision unreadable for ${docId}: ${errMsg(err)}`);
      }
    }
    if (changed) void this.persistRegistry().catch((err) => console.error(`[doc-service] reconcile persist failed: ${errMsg(err)}`));
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
      console.error(`[doc-service] registry unreadable, starting empty: ${errMsg(e)}`);
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
      else console.warn(`[doc-service] dropping invalid registry entry: ${entry.error.message}`);
    }
  }

  private quarantineRegistry(why: string): void {
    const aside = `${this.registryPath}.corrupt-${this.now()}`;
    try {
      renameSync(this.registryPath, aside);
      console.error(`[doc-service] docs registry ${why}; moved aside to ${aside}`);
    } catch (e) {
      console.error(`[doc-service] docs registry ${why}; could not quarantine: ${errMsg(e)}`);
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
    file !== `${revisionId}.ice1` ||
    !Number.isSafeInteger(committedAt) ||
    (committedAt as number) < 0
  ) {
    throw new Error(`current revision for ${docId} is malformed`);
  }
  return { ...meta.data, revisionId, file, committedAt: committedAt as number };
}

function errMsg(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}
