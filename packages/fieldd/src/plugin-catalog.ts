import { createHash, randomBytes } from "node:crypto";
import { mkdir, open, readFile, rename, rm } from "node:fs/promises";
import { join } from "node:path";
import {
  CONTRACTS_VERSION,
  type PluginsCatalog,
  type PluginsCatalogEntry,
  type PluginsCatalogState,
  type RegistryIndex,
  type RegistryListedAs,
  registryListedAs,
} from "@vibefield/contracts";
import { createNoopLogger, type Logger } from "@vibefield/logging";
import { RpcCallError } from "./native-link";
import { type RegistryInstallService, semverNewer } from "./plugin-install";
import { contractsRangeSatisfied, type PluginRegistryService } from "./plugin-registry";

// PluginCatalogService (MK-2b; MK-D5, MK-E8; MK-2's custody note §1 G3 and its rollback addendum): the plugin
// list the Plugins popup reads. `get` answers at once from the list fieldd holds; `refresh` is the one signed read,
// on the person's act only (plugins.manage; PA-30: no timer, no push feed, no identity).
//
// The held list is one file, `<dataDir>/plugins/catalog/held.json`: `{signature, checkedAt, index}`, with `index`
// the base64 of the index's exact bytes as fetched, written by one rename, so a reader sees the old list or the new
// one, whole (VF-PM 2026-11-11 09:55:48Z). Every read of it re-verifies the decoded bytes against the configured key.
// `checkedAt` is the one unsigned value believed: `generatedAt` and every entry come from the re-verified bytes, and
// any other key decides nothing (VF-PM 09:25:04Z). A held file that cannot be used (unreadable, a signature that
// fails, bytes this build's schema refuses) answers `refused` with nothing shown; it is left as it is, and the next
// successful refresh replaces it.
//
// What the held list does not hold: the file is under `<dataDir>`, which a process running as the same user can
// write. The re-verify holds a rung or an entry to the signature; the rollback floor holds against the network, not
// against that (custody note, addenda 2026-11-11). Nothing at load reads this list yet (`listedAsFor`, G3's read):
// whether a community plugin still loads while the switch is off is James's.

const CATALOG_DIR = ["plugins", "catalog"] as const;
const HELD_FILE = "held.json";
/** the catalog contract's own bound (`PluginsCatalog.plugins`) */
const MAX_ENTRIES = 4096;

export interface PluginCatalogConfig {
  dataDir: string;
  installer: Pick<
    RegistryInstallService,
    "registryConfigured" | "fetchSignedIndex" | "verifyIndex" | "parseIndex"
  >;
  plugins: Pick<PluginRegistryService, "list">;
  logger?: Logger;
  now?: () => number;
  /** The tests' seam alone, to hold a write open between its temp file and its rename; daemon.ts never passes it. */
  rename?: typeof rename;
}

interface HeldList {
  index: RegistryIndex;
  checkedAt: number | null;
}

/** What the last read this boot ended as; null until one has run. */
type LastRead = "ready" | "unreachable" | "refused" | null;

/** Why a held list was refused: the file cannot be used as one, its bytes fail re-verify, or they verify and this
 * build cannot parse them. */
type HeldRefusal = "held-unreadable" | "held-signature" | "held-schema";

export class PluginCatalogService {
  private readonly log: Logger;
  private readonly dir: string;
  private readonly now: () => number;
  private lastRead: LastRead = null;
  private inflight: Promise<PluginsCatalog> | null = null;
  /** The last held refusal, by its key (the signature's text, or an unusable file's hash), in memory alone: `get`
   * is plugins.read, and a caller with it must not fill the log, so a refusal is said once per key (a restart says
   * it once more). */
  private lastRefusedHeld: { key: string; reason: HeldRefusal } | null = null;

  constructor(private readonly cfg: PluginCatalogConfig) {
    this.log = (cfg.logger ?? createNoopLogger()).child({ component: "plugin.catalog" });
    this.dir = join(cfg.dataDir, ...CATALOG_DIR);
    this.now = cfg.now ?? Date.now;
  }

  /** Answers at once, from the list fieldd holds. Never starts a read. */
  async get(): Promise<PluginsCatalog> {
    if (!this.cfg.installer.registryConfigured()) return empty("unconfigured");
    const held = await this.readHeld();
    if (this.inflight !== null) return this.answerFrom(held, "reading");
    return this.answerFrom(held, this.lastRead);
  }

  /** The person's read: one at a time; a second call while one runs joins it. */
  refresh(): Promise<PluginsCatalog> {
    if (!this.cfg.installer.registryConfigured()) return this.get();
    if (this.inflight !== null) return this.inflight;
    const read = this.read().finally(() => {
      this.inflight = null;
    });
    this.inflight = read;
    return read;
  }

  /** G3's read (custody note §1): the signed rung for an id, from the held, re-verified list. An id the list does
   * not name, or no list, reads as community (closed, MK-1). Nothing at load calls it until James answers. */
  async listedAsFor(id: string): Promise<RegistryListedAs> {
    const held = await this.readHeld();
    if (held === null || held === "refused") return "community";
    const entry = held.index.plugins[id];
    return entry === undefined ? "community" : registryListedAs(entry);
  }

  private async read(): Promise<PluginsCatalog> {
    let signed: Awaited<ReturnType<PluginCatalogConfig["installer"]["fetchSignedIndex"]>>;
    try {
      signed = await this.cfg.installer.fetchSignedIndex();
    } catch (error) {
      // the host did not answer (UNAVAILABLE) is offline; anything else a list arrived and was refused (its
      // reason already logged by the installer)
      this.lastRead =
        error instanceof RpcCallError && error.kind === "UNAVAILABLE" ? "unreachable" : "refused";
      return this.answerFrom(await this.readHeld(), this.lastRead);
    }
    let index: RegistryIndex;
    try {
      index = this.cfg.installer.parseIndex(signed.bytes);
    } catch {
      this.lastRead = "refused";
      return this.answerFrom(await this.readHeld(), this.lastRead);
    }
    const held = await this.readHeld();
    // the rollback floor (VF-PM 09:25:04Z, Q2): a signed list older than the held one is refused, the held list
    // stays; an equal one passes. A held list that failed re-verify sets no floor.
    if (held !== null && held !== "refused" && index.generatedAt < held.index.generatedAt) {
      this.log.warn(
        "fieldd.plugin_catalog.index_refused",
        "A plugin list older than the one held was refused; the held list stays",
        {
          reason: "rollback",
          heldGeneratedAt: held.index.generatedAt,
          generatedAt: index.generatedAt,
        },
      );
      this.lastRead = "refused";
      return this.answerFrom(held, this.lastRead);
    }
    const checkedAt = this.now();
    await this.writeHeld(signed.bytes, signed.signature, checkedAt);
    this.lastRead = "ready";
    return this.answerFrom({ index, checkedAt }, "ready");
  }

  private answerFrom(
    held: HeldList | "refused" | null,
    state: LastRead | "reading",
  ): PluginsCatalog {
    // a held list that fails re-verify shows nothing (VF-PM 09:25:04Z); while a read runs, it says the read
    if (held === "refused") return empty(state === "reading" ? "reading" : "refused");
    if (state === null) return held === null ? empty("unread") : this.answerHeld("ready", held);
    if (held === null) return empty(state);
    return this.answerHeld(state, held);
  }

  private answerHeld(state: PluginsCatalogState, held: HeldList): PluginsCatalog {
    const entries: PluginsCatalogEntry[] = Object.values(held.index.plugins)
      .slice(0, MAX_ENTRIES)
      .map((entry) => ({
        id: entry.id,
        listedAs: registryListedAs(entry),
        latest: entry.latest,
        compatible: contractsRangeSatisfied(CONTRACTS_VERSION, entry.latest.minContracts),
        ...(entry.listing !== undefined ? { listing: entry.listing } : {}),
      }));
    const named = new Set(entries.map((e) => e.id));
    let updates = 0;
    for (const record of this.cfg.plugins.list()) {
      if (record.source !== "registry") continue;
      const entry = held.index.plugins[record.id];
      if (entry === undefined) continue;
      if (
        semverNewer(entry.latest.version, record.version) &&
        contractsRangeSatisfied(CONTRACTS_VERSION, entry.latest.minContracts)
      )
        updates += 1;
    }
    return {
      state,
      checkedAt: held.checkedAt,
      plugins: entries,
      featured: (held.index.featured ?? []).filter((id) => named.has(id)),
      updates,
    };
  }

  /** null: no file held. "refused": a file is held and cannot be used (it is left as it is). */
  private async readHeld(): Promise<HeldList | "refused" | null> {
    let raw: Buffer;
    try {
      raw = await readFile(join(this.dir, HELD_FILE));
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code === "ENOENT") return null;
      return this.refuseHeld("held-unreadable", `read:${code ?? "unknown"}`);
    }
    const file = heldFile(raw);
    if (file === null) return this.refuseHeld("held-unreadable", `file:${sha256Hex(raw)}`);
    const key = `signature:${file.signature}`;
    const verified = this.cfg.installer.verifyIndex(file.bytes, file.signature);
    const last = this.lastRefusedHeld;
    // verified bytes this build already could not parse are those same bytes (the signature binds them): they are
    // not parsed again, so neither the installer's line nor this one is said twice (VF-PM 2026-11-11 09:50:06Z)
    if (verified && last !== null && last.key === key && last.reason === "held-schema")
      return "refused";
    let index: RegistryIndex | null = null;
    if (verified) {
      try {
        index = this.cfg.installer.parseIndex(file.bytes);
      } catch {
        index = null;
      }
    }
    if (index !== null) return { index, checkedAt: file.checkedAt };
    // held-schema: the bytes verify, and this build cannot parse them (not JSON, or a stricter schema after an update)
    return this.refuseHeld(verified ? "held-schema" : "held-signature", key);
  }

  /** Says a held refusal once per its key and reason, and answers refused. */
  private refuseHeld(reason: HeldRefusal, key: string): "refused" {
    const last = this.lastRefusedHeld;
    if (last === null || last.key !== key || last.reason !== reason) {
      this.lastRefusedHeld = { key, reason };
      this.log.warn(
        "fieldd.plugin_catalog.index_refused",
        "The held plugin list could not be used; nothing from it is shown until a new list is read",
        { reason },
      );
    }
    return "refused";
  }

  /** One file, written to a temp name (0o600), synced and renamed into place: a reader sees the old list or the
   * new one, whole. A crash before the rename leaves a `.tmp-*` file beside it, which nothing sweeps. */
  private async writeHeld(bytes: Buffer, signature: string, checkedAt: number): Promise<void> {
    await mkdir(this.dir, { recursive: true });
    const body = { signature, checkedAt, index: bytes.toString("base64") };
    const target = join(this.dir, HELD_FILE);
    const temp = join(this.dir, `${HELD_FILE}.tmp-${randomBytes(8).toString("hex")}`);
    try {
      const handle = await open(temp, "wx", 0o600);
      try {
        await handle.writeFile(`${JSON.stringify(body)}\n`);
        await handle.sync();
      } finally {
        await handle.close();
      }
      await (this.cfg.rename ?? rename)(temp, target);
    } catch (error) {
      await rm(temp, { force: true }).catch(() => undefined);
      throw error;
    }
  }
}

/** The held file's fields, or null when it cannot be used as one: not JSON, a missing or non-string `signature` or
 * `index`, or an `index` that is not base64 (strict: the text must be what its bytes encode to). `checkedAt` is
 * read as a safe non-negative integer, else null; any other key decides nothing. */
function heldFile(
  raw: Buffer,
): { signature: string; bytes: Buffer; checkedAt: number | null } | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw.toString("utf8"));
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return null;
  const { signature, index, checkedAt } = parsed as Record<string, unknown>;
  if (typeof signature !== "string" || typeof index !== "string") return null;
  const bytes = Buffer.from(index, "base64");
  if (bytes.toString("base64") !== index) return null;
  const time =
    typeof checkedAt === "number" && Number.isSafeInteger(checkedAt) && checkedAt >= 0
      ? checkedAt
      : null;
  return { signature, bytes, checkedAt: time };
}

function sha256Hex(raw: Buffer): string {
  return createHash("sha256").update(raw).digest("hex");
}

/** A state with no list shown and no time said. */
function empty(state: PluginsCatalogState): PluginsCatalog {
  return { state, checkedAt: null, plugins: [], featured: [], updates: 0 };
}
