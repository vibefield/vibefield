import { createHash, randomBytes } from "node:crypto";
import { lstat, mkdir, open, readdir, readFile, rename, rm, unlink } from "node:fs/promises";
import { join } from "node:path";
import {
  CONTRACTS_VERSION,
  type PluginsCatalog,
  type PluginsCatalogEntry,
  type PluginsCatalogState,
  type RegistryIndex,
  type RegistryListedAs,
  type RegistryListingFile,
  registryListedAs,
} from "@vibefield/contracts";
import { createNoopLogger, type Logger } from "@vibefield/logging";
import { RpcCallError } from "./native-link";
import {
  type ListingFileRead,
  REGISTRY_FETCH_TIMEOUT_MS,
  type RegistryInstallService,
  readFileCapped,
  semverNewer,
} from "./plugin-install";
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
//
// MK-O3 (O3-B, 2026-11-12; custody note addendum "an install holds the list it verified", accepted 02:58:44Z; James's
// pick on the board, 03:42:10Z): the held list has a second writer. An install hands over the index it read and
// verified (`holdVerified`), and the catalog holds it as its own read would: the same re-verify, parse and floor, the
// same one write, and no picture fetched. The floor and the write run one at a time, whichever writer asks.
//
// MK-2e (2026-11-11; MK-E9, B1; `lanes/mk/mk2e/PLAN.md` v3, VF-PM 11:00:56Z, 11:03:18Z): the pictures. After a read
// ends ready, inside the person's refresh, the catalog keeps the pictures the held list pins in
// `<dataDir>/plugins/catalog/pictures/<hex>`, one file per pin, and the refresh answers once that phase ends:
//   - the folder is read by lstat (not a directory: refused, nothing fetched or pruned); then the prune, the count
//     and the fetches, in that order;
//   - only direct children that are REGULAR files named 64 lowercase hex are ever hashed or removed, each removal one
//     unlink; anything else under such a name reads as absent and is never followed;
//   - a cached file is kept only while its bytes (at most the per-file cap, read without following a link) hash to
//     its pin; a fetched one is written only when they do, by a `wx` temp file (0o600), synced and renamed;
//   - one budget for the phase, four fetches at a time, 512 a phase, 4 MiB a file, 256 MiB the folder;
//   - a refusal is said once per pin and reason (`picture_refused`: the id, the field, the reason code).
// Nothing serves the folder yet: main's serve is MK-4's (and its token side ob/ui's). What the folder does not hold:
// it is under `<dataDir>`, which a process running as the same user can write; fieldd's hash holds a file at its
// check, not after it (custody note, its fifth addendum).

const CATALOG_DIR = ["plugins", "catalog"] as const;
const HELD_FILE = "held.json";
/** the catalog contract's own bound (`PluginsCatalog.plugins`) */
const MAX_ENTRIES = 4096;
/** MK-2e: the pictures' folder, under the catalog's (Q4: MK-4 decides its home when main reads it) */
const PICTURES_DIR = "pictures";
/** MK-2e: the most bytes one picture file may have */
export const PICTURE_FILE_MAX_BYTES = 4 * 1024 * 1024;
/** MK-2e (VF-PM 11:00:56Z, Q2): the most bytes the folder holds. A plausible list of 100 plugins is about 160 MiB
 * (each an icon, a spread by day and night, four objects' stills: about 1.6 MiB). */
export const PICTURE_CACHE_MAX_BYTES = 256 * 1024 * 1024;
/** MK-2e: the most fetches one phase makes */
export const PICTURE_FETCHES_MAX = 512;
const PICTURE_FETCHES_AT_ONCE = 4;
/** a cached picture's name: its pin's hex */
const PIN_NAME = /^[0-9a-f]{64}$/;

type PictureRefusal = "pin" | "size" | "unreachable" | "total" | "cache";

/** One picture the held list pins, named by the first entry and field that pin it. */
interface Picture {
  hex: string;
  pluginId: string;
  field: string;
  path: string;
}

export interface PluginCatalogConfig {
  dataDir: string;
  installer: Pick<
    RegistryInstallService,
    "registryConfigured" | "fetchSignedIndex" | "verifyIndex" | "parseIndex" | "fetchListingFile"
  >;
  plugins: Pick<PluginRegistryService, "list">;
  logger?: Logger;
  now?: () => number;
  /** The tests' seam alone, to hold a write open between its temp file and its rename; daemon.ts never passes it. */
  rename?: typeof rename;
  /** MK-2e: the tests' seams alone (daemon.ts never passes them): the phase's budget and the two caps. */
  pictures?: { budgetMs?: number; fileMaxBytes?: number; cacheMaxBytes?: number };
}

interface HeldList {
  index: RegistryIndex;
  checkedAt: number | null;
}

/** MK-O3 (O3-B): what one turn of the floor and the write ended as: held, at its time, or refused with the held list
 * that stays. */
type HoldOutcome = { held: true; checkedAt: number } | { held: false; kept: HeldList };

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
  /** MK-2e: the picture refusals said, `<hex>:<reason>`, in memory alone; kept to the held list's pins */
  private readonly saidPictures = new Set<string>();
  /** MK-O3 (O3-B): the floor and the write, one at a time, for the person's read and an install's hand-over alike */
  private writes: Promise<void> = Promise.resolve();

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

  /** MK-2c (2026-11-11; the floor, VF-PM 10:08:59Z): the held list's `generatedAt`, re-verified, for the installer's
   * own index reads (`plugin-install.ts`, `fetchIndex`). Null with no file held or a held file refused: neither sets
   * a floor. */
  async heldGeneratedAt(): Promise<number | null> {
    const held = await this.readHeld();
    return held === null || held === "refused" ? null : held.index.generatedAt;
  }

  /** MK-O3 (O3-B, 2026-11-12): an install's hand-over, the index it read and verified (`plugin-install.ts`, prepare).
   * It is held as the person's read holds a list: re-verified with the configured key, parsed, held to the floor (an
   * older list than the one held is refused, an equal one passes), and only then written; no picture is fetched (those
   * stay inside the person's refresh). Answers whether it was held; a list refused anywhere holds nothing. */
  async holdVerified(signed: { bytes: Buffer; signature: string }): Promise<boolean> {
    if (!this.cfg.installer.verifyIndex(signed.bytes, signed.signature)) {
      this.log.warn(
        "fieldd.plugin_catalog.index_refused",
        "A plugin list an install handed over did not verify; nothing was held",
        { reason: "signature" },
      );
      return false;
    }
    let index: RegistryIndex;
    try {
      // a refusal here is logged by the installer's own parse, with its reason
      index = this.cfg.installer.parseIndex(signed.bytes);
    } catch {
      return false;
    }
    const outcome = await this.holdIfNotOlder(signed.bytes, signed.signature, index);
    if (!outcome.held) return false;
    // the install read the list on the person's act, as a refresh does
    this.lastRead = "ready";
    return true;
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
    const outcome = await this.holdIfNotOlder(signed.bytes, signed.signature, index);
    if (!outcome.held) {
      this.lastRead = "refused";
      return this.answerFrom(outcome.kept, this.lastRead);
    }
    this.lastRead = "ready";
    // MK-2e: the pictures this list pins, inside the person's read; `get` says reading until the phase ends
    await this.picturesPhase(index, signed.indexRef);
    return this.answerFrom({ index, checkedAt: outcome.checkedAt }, "ready");
  }

  /** The rollback floor and the one write, for either writer (the person's read, an install's hand-over), run one at
   * a time: the floor is read and the list written in one turn, so an older list never passes the floor before a newer
   * one lands and is then written over it (MK-O3, O3-B). The floor (VF-PM 09:25:04Z, Q2): a signed list older than
   * the held one is refused and the held list stays; an equal one passes; a held list that failed re-verify sets no
   * floor. */
  private holdIfNotOlder(
    bytes: Buffer,
    signature: string,
    index: RegistryIndex,
  ): Promise<HoldOutcome> {
    const turn = this.writes.then(async (): Promise<HoldOutcome> => {
      const held = await this.readHeld();
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
        return { held: false, kept: held };
      }
      const checkedAt = this.now();
      await this.writeHeld(bytes, signature, checkedAt);
      return { held: true, checkedAt };
    });
    this.writes = turn.then(
      () => undefined,
      () => undefined,
    );
    return turn;
  }

  /** MK-2e (plan v3 §2): the folder's lstat, the prune, the count, the fetches. Runs only after a ready read. */
  private async picturesPhase(index: RegistryIndex, indexRef: string): Promise<void> {
    const pictures = picturesOf(index);
    for (const key of this.saidPictures)
      if (!pictures.has(key.slice(0, 64))) this.saidPictures.delete(key);
    const dir = join(this.dir, PICTURES_DIR);
    const fileMax = this.cfg.pictures?.fileMaxBytes ?? PICTURE_FILE_MAX_BYTES;
    const cacheMax = this.cfg.pictures?.cacheMaxBytes ?? PICTURE_CACHE_MAX_BYTES;
    // the folder, by lstat: anything but a directory is refused, and nothing is fetched or pruned. None, and a list
    // that pins no picture, leaves it unmade: there is nothing to prune and nothing to keep
    const before = await lstat(dir).then(
      () => true,
      (error: NodeJS.ErrnoException) => error.code !== "ENOENT",
    );
    if (!before && pictures.size === 0) return;
    await mkdir(dir, { recursive: true }).catch(() => undefined);
    const folder = await lstat(dir).catch(() => null);
    const names = folder?.isDirectory() === true ? await readdir(dir).catch(() => null) : null;
    if (names === null) {
      this.log.warn(
        "fieldd.plugin_catalog.picture_refused",
        "The pictures folder could not be used; no picture was fetched",
        { field: "pictures", reason: "cache" },
      );
      return;
    }
    // its direct children: only a regular file named 64 lowercase hex is ever hashed or removed
    const present = new Map<string, number>();
    for (const name of names) {
      if (!PIN_NAME.test(name)) continue;
      const stat = await lstat(join(dir, name)).catch(() => null);
      if (stat?.isFile() === true) present.set(name, stat.size);
    }
    // the prune, before the count (VF-PM 11:03:18Z): the list is held, so a file it does not pin is stale
    let pruned = 0;
    for (const name of [...present.keys()]) {
      if (pictures.has(name)) continue;
      present.delete(name);
      // one file each, never a recursive remove; one that cannot go is left for the next ready read
      const gone = await unlink(join(dir, name)).then(
        () => true,
        () => false,
      );
      if (gone) pruned += 1;
    }
    if (pruned > 0)
      this.log.info(
        "fieldd.plugin_catalog.pictures_pruned",
        "Pictures the plugin list no longer names were removed",
        { count: pruned },
      );
    // the count: the bytes of the pinned files that still hash to their pins (a file past the cap is not read)
    let total = 0;
    const wanted: Picture[] = [];
    for (const picture of pictures.values()) {
      const size = present.get(picture.hex);
      const kept =
        size !== undefined && size <= fileMax
          ? await cachedBytes(join(dir, picture.hex), picture.hex, fileMax)
          : null;
      if (kept !== null) total += kept;
      else wanted.push(picture);
    }
    // the fetches: one budget, four at a time, 512 a phase, and the folder's cap with 4 MiB held per fetch in flight
    const budget = new AbortController();
    const timer = setTimeout(
      () => budget.abort(new Error("the pictures' budget ended")),
      this.cfg.pictures?.budgetMs ?? REGISTRY_FETCH_TIMEOUT_MS,
    );
    let next = 0;
    let made = 0;
    let inFlight = 0;
    let full = false;
    const fetchOne = async (): Promise<void> => {
      while (!budget.signal.aborted && !full) {
        const picture = wanted[next];
        if (picture === undefined || made >= PICTURE_FETCHES_MAX) return;
        next += 1;
        if (total + (inFlight + 1) * fileMax > cacheMax) {
          // the first fetch that would pass the cap is not made, and the phase makes no other: said once
          full = true;
          this.log.warn(
            "fieldd.plugin_catalog.picture_refused",
            "The pictures folder is full; the rest wait",
            { pluginId: picture.pluginId, field: picture.field, reason: "total" },
          );
          return;
        }
        made += 1;
        // the fetch's 4 MiB stay held until its bytes are counted or refused
        inFlight += 1;
        try {
          await this.keepOne(dir, indexRef, picture, fileMax, budget.signal, (bytes) => {
            total += bytes;
          });
        } finally {
          inFlight -= 1;
        }
      }
    };
    try {
      await Promise.all(Array.from({ length: PICTURE_FETCHES_AT_ONCE }, fetchOne));
    } finally {
      clearTimeout(timer);
    }
  }

  /** MK-2e: one picture fetched, checked against its pin and written; `kept` counts the bytes written. */
  private async keepOne(
    dir: string,
    indexRef: string,
    picture: Picture,
    fileMax: number,
    budget: AbortSignal,
    kept: (bytes: number) => void,
  ): Promise<void> {
    const read: ListingFileRead = await this.cfg.installer.fetchListingFile(
      indexRef,
      picture.path,
      {
        maxBytes: fileMax,
        signal: budget,
      },
    );
    if (!read.ok) {
      // what the budget ended waits for the next refresh, unsaid
      if (!budget.aborted) this.pictureRefused(picture, read.reason);
      return;
    }
    if (sha256Hex(read.bytes) !== picture.hex) {
      this.pictureRefused(picture, "pin");
      return;
    }
    if (await writePicture(dir, picture.hex, read.bytes)) kept(read.bytes.length);
    else this.pictureRefused(picture, "cache");
  }

  /** Says a picture's refusal once per pin and reason, by its id, field and reason code alone (rule 22). */
  private pictureRefused(picture: Picture, reason: PictureRefusal): void {
    const key = `${picture.hex}:${reason}`;
    if (this.saidPictures.has(key)) return;
    this.saidPictures.add(key);
    this.log.warn(
      "fieldd.plugin_catalog.picture_refused",
      "A listing picture was not kept; the plugin shows without it",
      { pluginId: picture.pluginId, field: picture.field, reason },
    );
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

/** MK-2e: every picture the list's parsed listings pin, by pin, in the list's order: the icon, the spread by day and
 * night, each object's stills by day and night. One pin named twice is one picture, named by its first naming. */
function picturesOf(index: RegistryIndex): Map<string, Picture> {
  const out = new Map<string, Picture>();
  const add = (pluginId: string, field: string, file: RegistryListingFile | undefined): void => {
    if (file === undefined) return;
    const hex = file.sha256.slice("sha256:".length);
    if (!out.has(hex)) out.set(hex, { hex, pluginId, field, path: file.path });
  };
  for (const entry of Object.values(index.plugins).slice(0, MAX_ENTRIES)) {
    const listing = entry.listing;
    if (listing === undefined) continue;
    add(entry.id, "icon", listing.icon);
    add(entry.id, "spread.day", listing.spread?.day);
    add(entry.id, "spread.night", listing.spread?.night);
    listing.objects.forEach((object, i) => {
      add(entry.id, `objects.${i}.stills.day`, object.stills?.day);
      add(entry.id, `objects.${i}.stills.night`, object.stills?.night);
    });
  }
  return out;
}

/** MK-2e: a cached picture's size while its bytes still hash to its pin, else null. Read without following a link,
 * at most the cap, re-checked on the open handle (`readFileCapped`). */
async function cachedBytes(file: string, hex: string, maxBytes: number): Promise<number | null> {
  try {
    const read = await readFileCapped(file, maxBytes);
    return read.ok && sha256Hex(read.bytes) === hex ? read.bytes.length : null;
  } catch {
    return null;
  }
}

/** MK-2e: a picture's bytes, already matched to its pin, written as the held list is: a `wx` temp file (0o600, never an
 * existing name), synced, renamed onto `<hex>`. A rename replaces a link's entry, never its target; one that cannot
 * replace the entry (a directory) fails, and the temp file goes. */
async function writePicture(dir: string, hex: string, bytes: Buffer): Promise<boolean> {
  const temp = join(dir, `${hex}.tmp-${randomBytes(8).toString("hex")}`);
  try {
    const handle = await open(temp, "wx", 0o600);
    try {
      await handle.writeFile(bytes);
      await handle.sync();
    } finally {
      await handle.close();
    }
    await rename(temp, join(dir, hex));
    return true;
  } catch {
    await rm(temp, { force: true }).catch(() => undefined);
    return false;
  }
}

/** A state with no list shown and no time said. */
function empty(state: PluginsCatalogState): PluginsCatalog {
  return { state, checkedAt: null, plugins: [], featured: [], updates: 0 };
}
