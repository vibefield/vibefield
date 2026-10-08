import { createHash } from "node:crypto";
import { EventEmitter } from "node:events";
import { join } from "node:path";
import {
  DOC_HOST,
  DocHoldersSlice,
  type DocHolding,
  DocLibraryEntry,
  type DocSyncIntent,
  LAYOUT,
  STORES,
} from "@vibefield/contracts";
import { createNoopLogger, type Logger } from "@vibefield/logging";
import { LoroDoc, type LoroMap } from "loro-crdt";
import type { SystemDocOwner } from "./doc-service";
import { type HolderAck, versionFromBase64 } from "./loro-host";
import type { GroupingIntents } from "./projects/grouping";
import {
  applyProjectWrites,
  type ProjectWrite,
  projectCopyWrites,
  readProjectIntents,
} from "./projects/records-doc";
import { SystemDocFile } from "./system-doc-file";

// The LIBRARY (DS-5, DS-D6 RULED (a); thinking-desktop-sync-plane §5.2) — a
// user-scope SYSTEM document every linked desktop holds and the Loro-level host
// merges: which canvases exist, their names, their sync intent, their
// tombstones. A canvas created on the laptop therefore exists on the studio; a
// rename made offline converges; `syncIntent` converges with it (UA-D7's named
// follow-up). It is its own document, not a section of the settings document,
// because D29′'s settings undo must never resurrect a deleted canvas: the
// library has NO undo at all.
//
// LAYOUT — one root map per FIELD, keyed by docId, never a nested map per doc.
// Root containers are named, so every desktop's `names` is the same container
// and concurrent edits merge per field (last writer wins per key). A nested map
// created on two desktops at once would be two containers, and one side's
// fields would be lost to the other's.
//
// PJ-2 (build-pj23.md D1) — the person's PROJECT RECORDS live here too, in
// root maps of their own (`projects.*`, projects/records-doc.ts): the same
// account-wide reach, the same no-undo rule, and nothing `entries()` reads.
//
// Beside it, the HOLDERS slice (`field.docs.v1`, device-owned — DS-L2): who
// holds what is a fact, published by its holder, expiring with it. The library
// says a canvas exists; the slices say where it lives.

const FIELDS = {
  names: "names",
  created: "created",
  tombstones: "tombstones",
  intents: "intents",
  schemas: "schemas",
  epochs: "epochs",
  /** DS-5c (DS-D7) — a `local` canvas's home desktop (roster deviceId). */
  homes: "homes",
} as const;

/** The well-known id of a user's system document: derived from the ACCOUNT —
 * the linked login, or this user root's own name while unlinked — so every
 * desktop of one account names the same document and no two accounts do. An
 * RFC 9562 v8 (custom) UUID over sha256, so it passes every uuid gate a doc id
 * meets on the way to a lane. */
export function systemDocId(kind: "library" | "settings", account: string): string {
  const hash = createHash("sha256")
    .update(`vibefield.system-doc.v1\u0000${kind}\u0000${account}`)
    .digest();
  hash[6] = ((hash[6] ?? 0) & 0x0f) | 0x80;
  hash[8] = ((hash[8] ?? 0) & 0x3f) | 0x80;
  const hex = hash.subarray(0, 16).toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}

/** The account a user root syncs as: the linked login, else the root itself.
 * Two desktops share system documents exactly when they share a login. */
export function systemAccount(linkedLogin: string | null, userId: string | undefined): string {
  return linkedLogin !== null ? `login:${linkedLogin}` : `local:${userId ?? "default"}`;
}

export interface LibraryDocConfig {
  dataDir: string;
  /** systemDocId("library", account) — names the file too, so a relink to
   * another account opens another library rather than leaking this one. */
  docId: string;
  logger?: Logger;
}

/** A library change, for the catalog to reconcile from. */
export interface LibraryChange {
  origin: "local" | "remote";
}

export class LibraryDocService extends EventEmitter {
  readonly doc = new LoroDoc();
  readonly docId: string;
  /** DS-5c — one writer, fsync'd, the last good copy kept (system-doc-file.ts). */
  private readonly file: SystemDocFile;
  private readonly log: Logger;
  private readyPromise: Promise<void> | null = null;
  private disposed = false;

  constructor(cfg: LibraryDocConfig) {
    super();
    this.docId = cfg.docId;
    this.log = (cfg.logger ?? createNoopLogger()).child({ component: "docs.library" });
    this.file = new SystemDocFile({
      path: join(cfg.dataDir, ...LAYOUT.DOCS_DIR, ".library", `${cfg.docId}.loro`),
      snapshot: () => this.doc.export({ mode: "snapshot" }),
      logger: this.log,
    });
  }

  ready(): Promise<void> {
    this.readyPromise ??= (async () => {
      // "none" is first boot for this account — an empty library is the honest
      // start. DS-5c: a torn file is no longer one (the last good copy loads).
      await this.file.load((bytes) => {
        this.doc.import(bytes);
      });
    })();
    return this.readyPromise;
  }

  /** What the host needs to merge into this document. Persistence waits for
   * the file to have been read: a peer's merge must never be written over a
   * library that has not loaded yet. */
  hostOwner(): SystemDocOwner {
    return {
      persist: async () => {
        await this.ready();
        await this.persistNow();
      },
      merged: () => this.emit("changed", { origin: "remote" } satisfies LibraryChange),
    };
  }

  // ---- reads ----

  entries(): DocLibraryEntry[] {
    const out: DocLibraryEntry[] = [];
    const created = this.map("created").toJSON() as Record<string, unknown>;
    const names = this.map("names").toJSON() as Record<string, unknown>;
    for (const docId of new Set([...Object.keys(created), ...Object.keys(names)])) {
      const entry = this.read(docId);
      if (entry !== undefined) out.push(entry);
    }
    return out.sort((a, b) => a.createdAt - b.createdAt || a.docId.localeCompare(b.docId));
  }

  /** DS-5c — undefined for a docId the library never held. It used to read
   * the absent fields as defaults and answer a phantom row (name "",
   * createdAt 0) — harmless until something asked whether a row EXISTS. */
  get(docId: string): DocLibraryEntry | undefined {
    if (
      this.map("names").get(docId) === undefined &&
      this.map("created").get(docId) === undefined
    ) {
      return undefined;
    }
    return this.read(docId);
  }

  // ---- writes (each one commit, each one durable before it returns) ----

  async upsert(entry: DocLibraryEntry, by: string): Promise<void> {
    await this.ready();
    this.map("names").set(entry.docId, entry.name);
    this.map("created").set(entry.docId, entry.createdAt);
    this.map("schemas").set(entry.docId, entry.engineSchema as never);
    this.map("epochs").set(entry.docId, entry.baseEpoch);
    if (entry.syncIntent !== undefined) this.map("intents").set(entry.docId, entry.syncIntent);
    if (entry.home !== undefined) this.map("homes").set(entry.docId, entry.home);
    if (entry.tombstone !== undefined) this.map("tombstones").set(entry.docId, entry.tombstone);
    await this.commit(by);
  }

  async rename(docId: string, name: string, by: string): Promise<void> {
    await this.ready();
    this.map("names").set(docId, name);
    await this.commit(by);
  }

  /** DS-5c (DS-D7) — `home`: the desktop a `local` canvas now lives on (the
   * one whose person kept it home), in the same commit as the intent, so the
   * two merge as one decision. `sync`, or a home nobody can name, clears it. */
  async setSyncIntent(
    docId: string,
    intent: DocSyncIntent,
    by: string,
    home?: string,
  ): Promise<void> {
    await this.ready();
    this.map("intents").set(docId, intent);
    if (intent === "local" && home !== undefined) this.map("homes").set(docId, home);
    else this.map("homes").delete(docId);
    await this.commit(by);
  }

  async tombstone(docId: string, at: number, by: string): Promise<void> {
    await this.ready();
    this.map("tombstones").set(docId, at);
    await this.commit(by);
  }

  async setColumns(
    docId: string,
    columns: { engineSchema: number | null; baseEpoch: number },
    by: string,
  ): Promise<void> {
    await this.ready();
    const schemas = this.map("schemas");
    const epochs = this.map("epochs");
    if (schemas.get(docId) === columns.engineSchema && epochs.get(docId) === columns.baseEpoch) {
      return;
    }
    schemas.set(docId, columns.engineSchema as never);
    epochs.set(docId, columns.baseEpoch);
    await this.commit(by);
  }

  // ---- PJ-2: the person's project records (projects/records-doc.ts) ----

  /** Every project record and intent this library holds. */
  projectIntents(): Required<GroupingIntents> {
    return readProjectIntents(this.doc);
  }

  /** One act's writes: one commit, durable before it returns, heard as a
   * local change. False (and no commit) when every write was already so. */
  async writeProjects(writes: readonly ProjectWrite[], by: string): Promise<boolean> {
    await this.ready();
    if (applyProjectWrites(this.doc, writes) === 0) return false;
    await this.commit(by);
    return true;
  }

  /** D5 — a relink keeps the person's records: every record `from` (this
   * desktop's local-account library) holds and this one lacks, copied by
   * record id, with the links, splits and dismissals. Idempotent. */
  async adoptProjects(from: LibraryDocService, by: string): Promise<number> {
    await this.ready();
    await from.ready();
    const writes = projectCopyWrites(from.doc, this.doc);
    if (writes.length === 0) return 0;
    await this.writeProjects(writes, by);
    return writes.filter((w) => w.kind === "create").length;
  }

  async dispose(): Promise<void> {
    this.disposed = true;
    this.removeAllListeners();
    // DS-5c — a write already asked for lands before the daemon goes.
    await this.file.drained();
  }

  // ---- internals ----

  private map(field: keyof typeof FIELDS): LoroMap {
    return this.doc.getMap(FIELDS[field]);
  }

  /** Tolerant reader: a row whose fields do not parse (a newer desktop's
   * shape, a half-merged row) is skipped and logged, never fatal. */
  private read(docId: string): DocLibraryEntry | undefined {
    const name = this.map("names").get(docId);
    const createdAt = this.map("created").get(docId);
    const raw = {
      docId,
      name: typeof name === "string" ? name : "",
      createdAt: typeof createdAt === "number" ? createdAt : 0,
      engineSchema: this.map("schemas").get(docId) ?? null,
      baseEpoch: this.map("epochs").get(docId) ?? 0,
      ...(this.map("intents").get(docId) !== undefined
        ? { syncIntent: this.map("intents").get(docId) }
        : {}),
      ...(this.map("homes").get(docId) !== undefined ? { home: this.map("homes").get(docId) } : {}),
      ...(this.map("tombstones").get(docId) !== undefined
        ? { tombstone: this.map("tombstones").get(docId) }
        : {}),
    };
    const parsed = DocLibraryEntry.safeParse(raw);
    if (parsed.success) return parsed.data;
    this.log.warn("fieldd.docs.library_row_invalid", "A library row failed its schema", {
      docId,
      issues: parsed.error.issues.length,
    });
    return undefined;
  }

  private async commit(by: string): Promise<void> {
    this.doc.commit({ origin: `library:${by}` });
    await this.persistNow();
    this.emit("changed", { origin: "local" } satisfies LibraryChange);
  }

  /** DS-5c — through the file's ONE writer queue: a local commit's persist
   * and a merge's (`hostOwner().persist`) never interleave, and the snapshot
   * is taken when the write runs. */
  private async persistNow(): Promise<void> {
    if (this.disposed) return;
    await this.file.persist();
  }
}

/** The mesh store, narrowed to the two calls the holders slice makes. */
export interface HoldersMesh {
  setSlice(storeId: string, data: unknown): Promise<unknown>;
  subscribeStoreManaged(
    storeId: string,
    onEvent: (payload: unknown, kind: "snapshot" | "delta") => void,
  ): Promise<{ snapshot: unknown; dispose: () => void }>;
}

export interface DocHoldersOptions {
  mesh: HoldersMesh;
  /** This device's roster id (DeviceService's — the store's own owner key). */
  deviceId: () => string;
  /** What this device holds right now. */
  holdings: () => Promise<DocHolding[]>;
  logger?: Logger;
  /** Coalesce a burst of holding changes into one publish (default 1 s). */
  debounceMs?: number;
  /** DS-5d — the LEDGER's file: every holder last heard and what it last
   * acknowledged, kept across restarts. Absent: the ledger lives in memory. */
  ledgerPath?: string;
  /** DS-5d — the clock (tests move it). */
  now?: () => number;
  /** DS-5d — DOC_HOST.RETIREMENT_MS. The watermark stops waiting for a holder
   * at this horizon; the ledger forgets one at twice it. */
  retirementMs?: number;
}

/** DS-5d — one holder as the ledger remembers it. */
interface LedgerEntry {
  /** When it was last heard: the moment its slice left, or (on disk) the
   * last write while it was still present. */
  seenAt: number;
  docs: DocHolding[];
}

/** `field.docs.v1`, the device-owned holders slice (DS-L2: a device publishes
 * only its own row; peers' rows are held as they were last heard).
 *
 * DS-5d — THE LEDGER. A slice expires with its publisher: the store drops a
 * peer's slice the moment the transport drops the peer. The compaction
 * watermark has to outlast that — a laptop whose lid closed is still a
 * holder, carrying edits home, and a trim may not cut under them until
 * DS-D17's thirty days pass. So every slice heard is remembered here with the
 * time it was last heard, kept on disk across restarts, and forgotten only
 * after twice the horizon (the watermark has stopped waiting at once). */
export class DocHoldersService {
  readonly #opts: DocHoldersOptions;
  readonly #log: Logger;
  /** deviceId → that device's holdings, from the store stream. */
  readonly #peers = new Map<string, DocHolding[]>();
  #timer: ReturnType<typeof setTimeout> | null = null;
  #dispose: (() => void) | null = null;
  #stopped = false;
  /** DS-5d — every holder ever heard (present or not), by deviceId. */
  readonly #ledger = new Map<string, LedgerEntry>();
  readonly #ledgerFile: SystemDocFile | null;
  #ledgerTimer: ReturnType<typeof setTimeout> | null = null;
  /** DS-5d — the ledger can vouch for every holder: it has heard the store at
   * least once, in this life or one it remembers. Until then it knows of no
   * holder only because it has heard none — a desktop whose mesh is down at
   * its first boot is not therefore alone. */
  #heard = false;

  constructor(opts: DocHoldersOptions) {
    this.#opts = opts;
    this.#log = (opts.logger ?? createNoopLogger()).child({ component: "docs.holders" });
    this.#ledgerFile =
      opts.ledgerPath === undefined
        ? null
        : new SystemDocFile({
            path: opts.ledgerPath,
            snapshot: () => new TextEncoder().encode(JSON.stringify(this.#ledgerJson())),
            logger: this.#log,
          });
  }

  async start(): Promise<void> {
    await this.#loadLedger();
    const subscription = await this.#opts.mesh.subscribeStoreManaged(STORES.DOCS, (payload, kind) =>
      this.#onStoreEvent(payload, kind),
    );
    this.#dispose = subscription.dispose;
    this.#onStoreEvent(subscription.snapshot, "snapshot");
    await this.publish();
  }

  /** Publish soon — holding changes arrive in bursts (a bootstrap lands a
   * checkpoint and a journal at once). */
  schedule(): void {
    if (this.#stopped || this.#timer !== null) return;
    this.#timer = setTimeout(() => {
      this.#timer = null;
      void this.publish().catch(() => undefined);
    }, this.#opts.debounceMs ?? 1_000);
    this.#timer.unref?.();
  }

  async publish(): Promise<void> {
    if (this.#stopped) return;
    const slice = DocHoldersSlice.parse({
      deviceId: this.#opts.deviceId(),
      docs: await this.#opts.holdings(),
    });
    try {
      await this.#opts.mesh.setSlice(STORES.DOCS, slice);
    } catch (error) {
      // mesh down — the slice is a fact about now; the next change republishes
      this.#log.info("fieldd.docs.holders_unpublished", "The holders slice was not published", {
        error: String(error),
      });
    }
  }

  /** Every OTHER device whose slice names this doc. */
  homesOf(docId: string): string[] {
    const self = this.#opts.deviceId();
    const out: string[] = [];
    for (const [deviceId, docs] of this.#peers) {
      if (deviceId !== self && docs.some((d) => d.docId === docId)) out.push(deviceId);
    }
    return out.sort();
  }

  /** DS-5d — every OTHER holder of `docId` the compaction watermark reckons
   * with: the ones whose slice is live (seen NOW) and the ones the ledger
   * remembers (seen when their slice left). Each states the version it
   * acknowledged — `ackVersion`, or the head of a holder from before DS-5d —
   * and null when it states none it can be held to (opaque custody, a value
   * that does not decode): the watermark holds the trim for that one.
   * NULL as a whole while the ledger has never heard the store: no holder is
   * known only because none was heard, and the trim waits. */
  acknowledgements(docId: string): HolderAck[] | null {
    if (!this.#heard) return null;
    const self = this.#opts.deviceId();
    const now = this.#now();
    const out: HolderAck[] = [];
    for (const [device, entry] of this.#ledger) {
      if (device === self) continue;
      const live = this.#peers.get(device);
      const held = (live ?? entry.docs).find((doc) => doc.docId === docId);
      if (held === undefined) continue;
      const text = held.ackVersion ?? held.headVersion;
      out.push({
        device,
        ack: text === undefined ? null : versionFromBase64(text),
        seenAt: live !== undefined ? now : entry.seenAt,
      });
    }
    return out;
  }

  /** DS-5d — write the ledger now (a graceful stop; the rows). */
  async flush(): Promise<void> {
    if (this.#ledgerTimer !== null) clearTimeout(this.#ledgerTimer);
    this.#ledgerTimer = null;
    await this.#ledgerFile?.persist();
  }

  stop(): void {
    // DS-5d — what was heard since the last write is not left behind.
    if (this.#ledgerTimer !== null) {
      void this.flush().catch(() => undefined);
    }
    this.#stopped = true;
    if (this.#timer !== null) clearTimeout(this.#timer);
    this.#timer = null;
    this.#dispose?.();
    this.#dispose = null;
    this.#peers.clear();
  }

  #onStoreEvent(payload: unknown, kind: "snapshot" | "delta"): void {
    if (kind === "snapshot") {
      const snap = payload as { slices?: Record<string, { data?: unknown }> } | null;
      const before = new Set(this.#peers.keys());
      this.#peers.clear();
      if (snap !== null && typeof snap?.slices === "object" && snap.slices !== null) {
        for (const [deviceId, wrapped] of Object.entries(snap.slices)) {
          this.#adopt(deviceId, wrapped?.data);
        }
        // DS-5d — the store answered: from here the ledger vouches for holders.
        if (!this.#heard) {
          this.#heard = true;
          this.#scheduleLedger();
        }
      }
      // DS-5d — present before, absent now: it left while the stream lagged.
      for (const deviceId of before) if (!this.#peers.has(deviceId)) this.#lastHeard(deviceId);
      return;
    }
    const d = payload as { kind?: unknown; deviceId?: unknown; data?: unknown } | null;
    if (d === null || typeof d.deviceId !== "string") return;
    if (d.kind === "peerRemoved") {
      this.#peers.delete(d.deviceId);
      this.#lastHeard(d.deviceId);
    } else this.#adopt(d.deviceId, d.data);
  }

  /** Tolerant reader: a slice that does not parse (an older desktop still
   * publishing nothing here, a newer one publishing more) holds nothing. */
  #adopt(deviceId: string, data: unknown): void {
    const parsed = DocHoldersSlice.safeParse(data);
    if (!parsed.success || parsed.data.deviceId !== deviceId) {
      this.#peers.delete(deviceId);
      return;
    }
    this.#peers.set(deviceId, parsed.data.docs);
    // DS-5d — remembered beyond the slice's life.
    this.#ledger.set(deviceId, { seenAt: this.#now(), docs: parsed.data.docs });
    this.#scheduleLedger();
  }

  // ---- the ledger (DS-5d) ----

  #now(): number {
    return (this.#opts.now ?? Date.now)();
  }

  /** Its slice left: it was last heard NOW. */
  #lastHeard(deviceId: string): void {
    const entry = this.#ledger.get(deviceId);
    if (entry === undefined) return;
    entry.seenAt = this.#now();
    this.#scheduleLedger();
  }

  #scheduleLedger(): void {
    if (this.#ledgerFile === null || this.#stopped || this.#ledgerTimer !== null) return;
    this.#ledgerTimer = setTimeout(() => {
      this.#ledgerTimer = null;
      void this.#ledgerFile?.persist().catch((error: unknown) => {
        this.#log.warn(
          "fieldd.docs.holders_ledger_unwritten",
          "The holders ledger was not written",
          {
            error: String(error),
          },
        );
      });
    }, this.#opts.debounceMs ?? 1_000);
    this.#ledgerTimer.unref?.();
  }

  /** What reaches disk: every holder, a PRESENT one stamped now (so a restart
   * after it left reads when it was last present, not when its slice last
   * changed), and none unheard for twice the horizon. */
  #ledgerJson(): { v: 1; heard: boolean; holders: Record<string, LedgerEntry> } {
    const now = this.#now();
    const holders: Record<string, LedgerEntry> = {};
    for (const [deviceId, entry] of this.#ledger) {
      const live = this.#peers.get(deviceId);
      if (live === undefined && now - entry.seenAt > this.#forgetAfterMs()) continue;
      holders[deviceId] =
        live !== undefined
          ? { seenAt: now, docs: live }
          : { seenAt: entry.seenAt, docs: entry.docs };
    }
    return { v: 1, heard: this.#heard, holders };
  }

  #forgetAfterMs(): number {
    return 2 * (this.#opts.retirementMs ?? DOC_HOST.RETIREMENT_MS);
  }

  /** The ledger from disk — tolerant per holder; a file that is not JSON is
   * torn (SystemDocFile keeps it aside and reads the last good copy). */
  async #loadLedger(): Promise<void> {
    if (this.#ledgerFile === null) return;
    const now = this.#now();
    await this.#ledgerFile.load((bytes) => {
      const parsed = JSON.parse(new TextDecoder().decode(bytes)) as {
        v?: unknown;
        heard?: unknown;
        holders?: Record<string, { seenAt?: unknown; docs?: unknown }>;
      } | null;
      if (parsed === null || parsed.v !== 1 || typeof parsed.holders !== "object") {
        throw new Error("not a holders ledger");
      }
      // A ledger that heard the store in a past life vouches from boot — a
      // mesh down NOW leaves every remembered holder waited for.
      if (parsed.heard === true) this.#heard = true;
      for (const [deviceId, raw] of Object.entries(parsed.holders ?? {})) {
        const seenAt = raw?.seenAt;
        const slice = DocHoldersSlice.safeParse({ deviceId, docs: raw?.docs });
        if (typeof seenAt !== "number" || !slice.success) continue;
        if (now - seenAt > this.#forgetAfterMs()) continue;
        this.#ledger.set(deviceId, { seenAt, docs: slice.data.docs });
      }
    });
  }
}
