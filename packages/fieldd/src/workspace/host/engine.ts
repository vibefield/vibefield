import { lstat, realpath, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, join } from "node:path";
import { createFileExplorerHost, type Entry, type FileExplorerHost } from "@vibecook/mille";
import type { WorkspaceEntry, WorkspaceEntryKind } from "@vibefield/contracts";
import { WORKSPACE_LIMITS } from "@vibefield/contracts/registries";
import { isWithin } from "../paths";
import type {
  ListArgs,
  ListValue,
  SearchArgs,
  SearchValue,
  WorkerErrorCode,
  WorkerSearchHit,
} from "../protocol";
import { ENTRY, HUNG_READS_MAX, matchName, type NameWalk, timedRead, walkNames } from "./names";

// FS-1a/FS-1b — the files worker's ENGINES: one host per canonical root.
//
// The record (§4) pictured one `createFileExplorerHost` holding every export;
// mille refuses that — "workspace roots must be unique and non-overlapping"
// (mille-binding explorer.rs, mille-core store.rs) — and the home export holds
// every place. So this is mille-truffle's own model (`server.ts` acquireHost):
// an engine per export, created on the first ask that names it, disposed
// after `WORKSPACE_LIMITS.HOST_IDLE_MS` without one, inside the one always-on
// worker, at most `WORKSPACE_LIMITS.HOSTS_MAX` alive at once (the least
// recently used idle one goes at the cap; all busy is a retryable refusal).
// A place nested in the home directory is its OWN export: asked by its root
// id, it is answered by its own engine, never by walking home.
//
// Each engine: `initialWalk: "roots-only"` (the root row, nothing walked until
// asked), `followSymlinks: false` (mille's spelling of "none": a symlink is
// listed as one and never descended), folders one per row. FS-1b attaches hold
// an active lease and arm mille's watcher and 16 ms fan-out tick (host.js
// `ensureBackgroundServices`); row-only engines have no watcher (FS-D12).
// A narrowed ticket has its own canonical subtree root. The price of
// no watcher: a folder listed once goes stale, so a folder listed AGAIN is
// reconciled against the disk first (`resync`) — the door's answer is the
// disk's, never a cache's.
//
// READS (M10, mille c8160d5): every engine hands mille the worker's one read
// deadline (`WORKSPACE_LIMITS.READ_TIMEOUT_MS`) and never downloads a folder
// that lives only in iCloud (`MATERIALIZE_DATALESS`). A folder mille could not
// read answers its own refusal — `timed-out` (ETIMEDOUT) or `dataless`
// (EDATALESS) — in words that name it (`readRefusal`), never the generic
// failure an unmapped code would become.
//
// `followSymlinks: false` holds on EVERY engine (the lead's ruling, 2026-10-05:
// mille's "smart" behaves like false today, and a followed link is recorded as
// a plain folder, which would defeat the symlink guard for ticketed sessions).
//
// A SEARCH does not walk into the engine: mille's hydration grows
// super-linearly with its store (measured: 22 000 entries in 15 s), so the
// search reads names from the filesystem (host/names.ts), bounded, and hands
// the engine only its hits. Its hits are RELATIVE to the export's root (as
// mille's own search over the port will say them, M6); the door composes the
// absolute path.
//
// *Errata (2026-10-14, fix7 — PJ-7's first phone run):* "row-only engines have
// no watcher" above was never true. mille arms a RECURSIVE watcher on an
// engine's root at its first filesystem-facing call ("filesystem-facing calls
// lazily enable live updates" — `ensure_watcher` in `prefetch`/`resync`/
// `refreshWorkspaceRoots`, mille-binding explorer.rs at c8160d5), and every
// watcher batch reconciles under the engine's one `policy_gate`, which
// `prefetch` and `resync` take too. On an export where something writes a lot
// (an external SSD other lanes build on), a list waited there: one `resync` of
// a two-entry folder took 37 011 ms, a phone's Browse timed every list out at
// the worker's 20 s. mille has no switch for it (only the debounce), so the
// worker keeps its waits bounded instead, in two LANES:
//   - the ROWS' engine (lists, attaches) is never waited on for longer than
//     WORKSPACE_LIMITS.LIST_ENGINE_MS: an engine that held a list that long is
//     RETIRED (out of the table; disposed once its attachments let go) and the
//     list is answered by a fresh one, whose store holds nothing busy yet —
//     once; a second stall is the folder's honest `timed-out`;
//   - a SEARCH resolves its hits in an engine of its OWN, made for it and
//     disposed when no search holds it, so the busy folders a hit's ancestors
//     hydrate never enter the rows' store; its resolve phase stops at
//     SEARCH_RESOLVE_MS and says `complete: false`. Its hit ids are that
//     engine's (an identity within the answer; a hit is listed by its path).
// Searches of one subtree asked together (a reader typing) share one walk.

/** mille's `EntryKind` (mille-core entry.rs). */
const KIND = { FILE: 0, DIR: 1, SYMLINK: 2, UNAVAILABLE: 4 } as const;

/** How often idle engines are looked for. An engine idle past
 * `WORKSPACE_LIMITS.HOST_IDLE_MS` is disposed (its store, its native
 * explorer); the next ask makes a fresh one. Entry ids are stable while an
 * engine lives — the answers say so (`WorkspaceEntry.id`). */
const SWEEP_MS = 60_000;
/** Folder child counts read at once for one page. */
const COUNT_CONCURRENCY = 16;
/** Subtree name walks kept per export (host/names.ts), and in the whole
 * worker at most this many walked entries (two full walks: some 40 MB
 * measured) — the oldest walk anywhere goes first. */
const WALKS_KEPT = 2;
const WALK_CACHE_ENTRIES = 2 * WORKSPACE_LIMITS.SEARCH_WALK_ENTRIES;
/** The wire's kind for a name walk's entry kind. */
const ENTRY_KIND_NAMES: Record<number, WorkspaceEntryKind> = {
  [ENTRY.FILE]: "file",
  [ENTRY.DIR]: "dir",
  [ENTRY.SYMLINK]: "symlink",
  [ENTRY.OTHER]: "other",
};

export class WorkerFailure extends Error {
  constructor(
    readonly code: WorkerErrorCode,
    message: string,
  ) {
    super(message);
  }
}

/** What a folder read that did not answer is refused with (M10). The door
 * hands the sentence to the reader as it is — the phone's folder browser
 * draws it — so it names the folder, says what happened and what to do. */
export function readRefusal(
  code: "timed-out" | "dataless",
  path: string | undefined,
  platform: NodeJS.Platform = process.platform,
): WorkerFailure {
  const leaf = path === undefined ? "" : basename(path);
  const name = leaf === "" ? "That folder" : `“${leaf}”`;
  if (code === "timed-out") {
    const seconds = WORKSPACE_LIMITS.READ_TIMEOUT_MS / 1_000;
    const why =
      platform === "darwin"
        ? "macOS may still be downloading it from iCloud, or its drive stopped responding"
        : "its drive or network share may have stopped responding";
    return new WorkerFailure(
      "timed-out",
      `${name} did not answer within ${seconds} s — ${why}. Try again in a moment.`,
    );
  }
  return new WorkerFailure(
    "dataless",
    platform === "darwin"
      ? `${name} is in iCloud only — it is not downloaded to this Mac, and VibeField does not download a folder to list it. Download it in Finder, then try again.`
      : `${name} is a cloud placeholder whose contents are not on this computer, and VibeField does not download a folder to list it.`,
  );
}

/** mille's two read codes (`FileSystemError.code`, duck-typed: the binding's
 * error and the port's carry the same `code` and `path`) as the worker's
 * refusal; null for anything else, which keeps its own way out. */
export function milleRefusal(
  error: unknown,
  platform: NodeJS.Platform = process.platform,
): WorkerFailure | null {
  if (typeof error !== "object" || error === null) return null;
  const { code, path } = error as { code?: unknown; path?: unknown };
  const where = typeof path === "string" && path.length > 0 ? path : undefined;
  if (code === "ETIMEDOUT") return readRefusal("timed-out", where, platform);
  if (code === "EDATALESS") return readRefusal("dataless", where, platform);
  return null;
}

/** Which work an engine serves (fix7; header): the rows' — lists and
 * attaches — or the searches' of one export. */
export type EngineLane = "rows" | "search";

/** One export's engine, as the worker holds it. `active` is counted from the
 * moment an ask names the export — before its engine exists — so an engine an
 * ask is waiting for is never the one evicted. */
interface Slot {
  key: string;
  lane: EngineLane;
  rootPath: string;
  pending: Promise<FileExplorerHost>;
  host: FileExplorerHost | null;
  lastUsed: number;
  active: number;
  /** fix7 — out of the table: a list found it held past LIST_ENGINE_MS (or a
   * search lane's last search ended); disposed once nothing holds it */
  retired: boolean;
}

/** fix7 — what a bounded wait answers when the call did not come back in time
 * (the call itself runs on; mille has no cancel for it). */
const HELD = Symbol("held");

function bounded<T>(answer: Promise<T>, ms: number): Promise<T | typeof HELD> {
  let timer: NodeJS.Timeout | undefined;
  const late = new Promise<typeof HELD>((resolve) => {
    timer = setTimeout(() => resolve(HELD), Math.max(0, ms));
    timer.unref?.();
  });
  return Promise.race([answer, late]).finally(() => clearTimeout(timer));
}

/** fix7 — a folder whose ENGINE did not answer within LIST_ENGINE_MS, twice:
 * the folder's `timed-out`, in words that name what holds it. */
export function engineHeld(
  path: string | undefined,
  ms: number = WORKSPACE_LIMITS.LIST_ENGINE_MS,
): WorkerFailure {
  const leaf = path === undefined ? "" : basename(path);
  const name = leaf === "" ? "That folder" : `“${leaf}”`;
  const seconds = Math.round(ms / 100) / 10;
  return new WorkerFailure(
    "timed-out",
    `${name} did not answer within ${seconds} s — its drive is busy (something is writing a lot there). Try again in a moment.`,
  );
}

/** An acquired slot: its engine is there. */
type Live = Slot & { host: FileExplorerHost };

export interface EnginesOptions {
  /** test seams; production: WORKSPACE_LIMITS.HOST_IDLE_MS / HOSTS_MAX /
   * SEARCH_WALK_ENTRIES / SEARCH_WALK_MS / LIST_ENGINE_MS / SEARCH_RESOLVE_MS */
  idleMs?: number;
  hostsMax?: number;
  walkEntries?: number;
  walkMs?: number;
  listMs?: number;
  resolveMs?: number;
  /** the user's home folder (its top-level Library is never walked) */
  home?: string;
  now?: () => number;
  platform?: NodeJS.Platform;
  /** test seam: each engine as it is made, before it answers anything */
  onHost?: (host: FileExplorerHost, lane: EngineLane) => void;
  /** test seam: each name walk as it starts (its subtree below the root) */
  onWalk?: (startRel: string) => void;
  /** fix7 — the worker's word to fieldd's log (a retired engine) */
  onLog?: (event: string, message: string, fields: Record<string, unknown>) => void;
}

/** What every engine is made with, beside its root (header). */
export const ENGINE_OPTIONS = {
  initialWalk: "roots-only",
  followSymlinks: false,
  respectIgnore: true,
  compactFolders: false,
  readTimeoutMs: WORKSPACE_LIMITS.READ_TIMEOUT_MS,
  materializeDataless: WORKSPACE_LIMITS.MATERIALIZE_DATALESS,
} as const satisfies Omit<Parameters<typeof createFileExplorerHost>[0], "roots">;

function kindOf(entry: Entry): WorkspaceEntryKind {
  switch (entry.kind) {
    case KIND.DIR:
      return "dir";
    case KIND.FILE:
      return "file";
    case KIND.SYMLINK:
      return "symlink";
    default:
      return "other";
  }
}

/** A folder's visible children, as the OS lists them (a leading dot is not
 * counted); undefined when it cannot be read in time (`READ_TIMEOUT_MS` — an
 * iCloud-evicted folder blocks a read while it downloads) or at all. No engine
 * is asked: counting a page's folders must not hydrate their children into
 * the store. */
async function countChildren(
  path: string,
  hung: Set<string>,
  page: { timeouts: number },
): Promise<number | undefined> {
  // a page whose reads hang stops counting (the rest go without a count)
  if (hung.has(path) || page.timeouts >= HUNG_READS_MAX) return undefined;
  const entries = await timedRead(path, WORKSPACE_LIMITS.READ_TIMEOUT_MS, hung);
  if (entries === "timeout") page.timeouts += 1;
  if (entries === null || entries === "timeout") return undefined;
  let count = 0;
  for (const entry of entries) if (!entry.name.startsWith(".")) count += 1;
  return count;
}

async function mapLimit<T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const out = new Array<R>(items.length);
  let next = 0;
  const run = async (): Promise<void> => {
    for (;;) {
      const index = next;
      next += 1;
      if (index >= items.length) return;
      out[index] = await fn(items[index] as T);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, run));
  return out;
}

/** The root's folder is there — or the worker's honest "root-missing". */
export async function assertRoot(rootPath: string): Promise<void> {
  try {
    if ((await stat(rootPath)).isDirectory()) return;
  } catch {
    // absent or unreadable: the same answer
  }
  throw new WorkerFailure("root-missing", "the root's folder is not there");
}

export class Engines {
  readonly #slots = new Map<string, Slot>();
  readonly #idleMs: number;
  readonly #hostsMax: number;
  readonly #walkEntries: number;
  readonly #walkMs: number;
  readonly #listMs: number;
  readonly #resolveMs: number;
  readonly #home: string;
  /** the searches' name walks, by export and then subtree (host/names.ts) —
   * names, not engine state, so they outlive a search lane's engine */
  readonly #walks = new Map<string, Map<string, NameWalk>>();
  /** walks in flight, by export and subtree: one walk per subtree at a time */
  readonly #walking = new Map<string, Promise<NameWalk>>();
  /** folders whose read hung (a search walk's or a child count's,
   * host/names.ts) — never read again while that read holds its thread */
  readonly #hung = new Set<string>();
  readonly #now: () => number;
  readonly #platform: NodeJS.Platform;
  readonly #onHost: EnginesOptions["onHost"];
  readonly #onWalk: EnginesOptions["onWalk"];
  readonly #onLog: EnginesOptions["onLog"];
  readonly #sweeper: NodeJS.Timeout;

  constructor(opts: EnginesOptions = {}) {
    this.#idleMs = opts.idleMs ?? WORKSPACE_LIMITS.HOST_IDLE_MS;
    this.#hostsMax = Math.max(1, opts.hostsMax ?? WORKSPACE_LIMITS.HOSTS_MAX);
    this.#walkEntries = opts.walkEntries ?? WORKSPACE_LIMITS.SEARCH_WALK_ENTRIES;
    this.#walkMs = opts.walkMs ?? WORKSPACE_LIMITS.SEARCH_WALK_MS;
    this.#listMs = opts.listMs ?? WORKSPACE_LIMITS.LIST_ENGINE_MS;
    this.#resolveMs = opts.resolveMs ?? WORKSPACE_LIMITS.SEARCH_RESOLVE_MS;
    this.#home = opts.home ?? homedir();
    this.#now = opts.now ?? Date.now;
    this.#platform = opts.platform ?? process.platform;
    this.#onHost = opts.onHost;
    this.#onWalk = opts.onWalk;
    this.#onLog = opts.onLog;
    this.#sweeper = setInterval(() => void this.sweep(), Math.min(SWEEP_MS, this.#idleMs));
    this.#sweeper.unref();
  }

  /** Engines alive (or being made) now. */
  get count(): number {
    return this.#slots.size;
  }

  /** The root's folder must be there, and is read through its real path. */
  async #rootReal(rootPath: string): Promise<string> {
    try {
      if (!(await stat(rootPath)).isDirectory())
        throw new WorkerFailure("root-missing", "the root is not a folder any more");
      return await realpath(rootPath);
    } catch (error) {
      if (error instanceof WorkerFailure) throw error;
      throw new WorkerFailure("root-missing", "the root's folder is not there");
    }
  }

  /** At the cap: the least recently used IDLE engine goes (synchronously out
   * of the table, disposed in the background), or every engine is answering
   * and the ask is refused, retryable. */
  #evictOne(): void {
    let victim: Slot | null = null;
    for (const slot of this.#slots.values()) {
      if (slot.active > 0 || slot.host === null) continue;
      if (victim === null || slot.lastUsed < victim.lastUsed) victim = slot;
    }
    if (victim === null || victim.host === null)
      throw new WorkerFailure(
        "busy",
        `every one of the ${this.#hostsMax} file engines is answering; ask again shortly`,
      );
    this.#slots.delete(victim.key);
    void victim.host.dispose().catch(() => undefined);
  }

  async #acquire(rootPath: string, lane: EngineLane = "rows"): Promise<Live> {
    const key = lane === "rows" ? rootPath : `search\u0000${rootPath}`;
    let slot = this.#slots.get(key);
    if (slot === undefined) {
      if (this.#slots.size >= this.#hostsMax) this.#evictOne();
      const pending = createFileExplorerHost({ roots: [rootPath], ...ENGINE_OPTIONS }).then(
        (host) => {
          this.#onHost?.(host, lane);
          return host;
        },
      );
      const made: Slot = {
        key,
        lane,
        rootPath,
        pending,
        host: null,
        lastUsed: this.#now(),
        active: 0,
        retired: false,
      };
      slot = made;
      this.#slots.set(key, made);
      pending.catch(() => {
        if (this.#slots.get(key) === made) this.#slots.delete(key);
      });
    }
    slot.active += 1;
    slot.lastUsed = this.#now();
    try {
      slot.host = await slot.pending;
    } catch (error) {
      slot.active -= 1;
      throw error;
    }
    return slot as Live;
  }

  #release(slot: Slot): void {
    slot.active -= 1;
    slot.lastUsed = this.#now();
    // a search lane lives while a search holds it (header)
    if (slot.lane === "search" && slot.active === 0) this.#retire(slot);
    else if (slot.retired && slot.active === 0) this.#dispose(slot);
  }

  /** Out of the table now; disposed once nothing holds it (an attachment
   * keeps a retired rows engine to its end). */
  #retire(slot: Slot): void {
    if (this.#slots.get(slot.key) === slot) this.#slots.delete(slot.key);
    if (slot.retired) return;
    slot.retired = true;
    if (slot.active === 0) this.#dispose(slot);
  }

  #dispose(slot: Slot): void {
    void slot.pending.then((host) => host.dispose()).catch(() => undefined);
  }

  /** The engine's root row — refreshed when the folder came back after the
   * engine saw it gone (mille keeps a gone root as `Unavailable`). */
  async #rootEntry(slot: Live): Promise<Entry> {
    const fx = slot.host.local;
    let root = fx.getSnapshot().roots()[0];
    if (root === undefined || root.kind === KIND.UNAVAILABLE) {
      await fx.refreshWorkspaceRoots();
      root = fx.getSnapshot().roots()[0];
    }
    if (root === undefined || root.kind === KIND.UNAVAILABLE)
      throw new WorkerFailure("root-missing", "the root's folder is not there");
    return root;
  }

  /** A child of a loaded folder by name; `fresh` reconciles the folder first. */
  async #child(slot: Live, parent: number, name: string, fresh: boolean): Promise<Entry | null> {
    const fx = slot.host.local;
    if (fresh) await fx.resync(parent);
    else await fx.prefetch(parent);
    const snapshot = fx.getSnapshot();
    for (const id of snapshot.childrenOf(parent)) {
      const entry = snapshot.getById(id);
      if (entry !== null && entry.name === name) return entry;
    }
    return null;
  }

  /** The folder a request names: walked segment by segment from the root, a
   * symlink on the way refused as absent, and its real path proved inside the
   * root's before anything is read from it. */
  async #folder(
    slot: Live,
    rootReal: string,
    segments: readonly string[],
  ): Promise<{ id: number; abs: string }> {
    let id = (await this.#rootEntry(slot)).id;
    let abs = slot.rootPath;
    for (const segment of segments) {
      const child =
        (await this.#child(slot, id, segment, false)) ??
        (await this.#child(slot, id, segment, true));
      if (child === null || child.kind === KIND.SYMLINK)
        throw new WorkerFailure("not-found", "no folder at that path");
      if (child.kind !== KIND.DIR)
        throw new WorkerFailure("not-a-directory", "that path is a file");
      id = child.id;
      abs = join(abs, segment);
    }
    let real: string;
    try {
      real = await realpath(abs);
    } catch {
      throw new WorkerFailure("not-found", "no folder at that path");
    }
    if (!isWithin(rootReal, real, this.#platform))
      throw new WorkerFailure("not-found", "no folder at that path");
    return { id, abs };
  }

  /** Hold the same host the row doors use for the full attached session. */
  async attach(rootPath: string): Promise<{ host: FileExplorerHost; release: () => void }> {
    if ((await this.#rootReal(rootPath)) !== rootPath)
      throw new WorkerFailure("not-found", "the exported folder changed");
    const slot = await this.#acquire(rootPath);
    let released = false;
    return {
      host: slot.host,
      release: () => {
        if (released) return;
        released = true;
        this.#release(slot);
      },
    };
  }

  /** The folder's page from the rows' engine, or HELD when the engine did not
   * answer within LIST_ENGINE_MS (its lock held: header). */
  async #page(
    slot: Live,
    rootReal: string,
    segments: readonly string[],
  ): Promise<
    { abs: string; page: Awaited<ReturnType<FileExplorerHost["local"]["list"]>> } | typeof HELD
  > {
    return bounded(
      (async () => {
        const { id, abs } = await this.#folder(slot, rootReal, segments);
        const fx = slot.host.local;
        // a folder read before is reconciled against the disk, never served
        // from memory (the engine's watcher is not trusted to have caught up)
        if (fx.getSnapshot().directoryChildrenLoaded(id)) await fx.resync(id);
        return { abs, page: await fx.list(id, { sort: "kindThenName" }) };
      })(),
      this.#listMs,
    );
  }

  /** fix7 — an engine that held a list past its budget: retired, said. */
  #held(slot: Slot, ms: number): void {
    this.#retire(slot);
    this.#onLog?.(
      "engine_retired",
      "A files engine held a list past its budget; a fresh one answers",
      {
        export: slot.rootPath,
        ms,
      },
    );
  }

  async list(args: ListArgs): Promise<ListValue> {
    const rootReal = await this.#rootReal(args.rootPath);
    let slot = await this.#acquire(rootReal);
    try {
      let read = await this.#page(slot, rootReal, args.segments);
      if (read === HELD) {
        // the list's own lane: never a second wait on a held engine
        this.#held(slot, this.#listMs);
        this.#release(slot);
        slot = await this.#acquire(rootReal);
        read = await this.#page(slot, rootReal, args.segments);
        if (read === HELD) {
          this.#held(slot, this.#listMs);
          throw engineHeld(join(rootReal, ...args.segments), this.#listMs);
        }
      }
      const { abs, page } = read;
      const entries =
        args.kinds === "dirs" ? page.entries.filter((e) => e.kind === KIND.DIR) : [...page.entries];
      const slice = entries.slice(args.offset, args.offset + args.limit);
      const counting = { timeouts: 0 };
      const wire = await mapLimit(slice, COUNT_CONCURRENCY, async (entry) => {
        const path = join(abs, entry.name);
        const kind = kindOf(entry);
        const row: WorkspaceEntry = {
          id: entry.id,
          name: entry.name.slice(0, WORKSPACE_LIMITS.NAME_CHARS),
          kind,
          path,
          ...(Number.isFinite(entry.mtimeMs) && entry.mtimeMs >= 0 ? { mtime: entry.mtimeMs } : {}),
        };
        if (kind === "file" && Number.isSafeInteger(entry.size) && entry.size >= 0)
          row.size = entry.size;
        if (kind === "dir") {
          const count = await countChildren(path, this.#hung, counting);
          if (count !== undefined) row.childCount = count;
        }
        return row;
      });
      const end = args.offset + slice.length;
      return {
        path: abs,
        entries: wire,
        total: entries.length,
        nextOffset: end < entries.length ? end : null,
      };
    } catch (error) {
      throw milleRefusal(error, this.#platform) ?? error;
    } finally {
      this.#release(slot);
    }
  }

  /** The subtree's NAMES (host/names.ts): this export's walk of that subtree
   * when one ran within SEARCH_CACHE_MS (a reader typing a query asks again
   * and again) or is running now (fix7: asked together, one walk), else a
   * fresh walk — kept for the export, at most WALKS_KEPT of them. */
  async #names(rootPath: string, abs: string, startRel: string): Promise<NameWalk> {
    const now = this.#now();
    const walks = this.#walks.get(rootPath) ?? new Map<string, NameWalk>();
    this.#walks.set(rootPath, walks);
    for (const [key, walk] of walks)
      if (now - walk.at > WORKSPACE_LIMITS.SEARCH_CACHE_MS) walks.delete(key);
    const kept = walks.get(startRel);
    if (kept !== undefined) return kept;
    const flight = `${rootPath}\u0000${startRel}`;
    const running = this.#walking.get(flight);
    if (running !== undefined) return running;
    this.#onWalk?.(startRel);
    const walking = walkNames({
      start: abs,
      startRel,
      home: abs === this.#home,
      maxEntries: this.#walkEntries,
      deadline: now + this.#walkMs,
      readTimeoutMs: WORKSPACE_LIMITS.READ_TIMEOUT_MS,
      hung: this.#hung,
      now: this.#now,
    }).then((walk) => {
      walks.set(startRel, walk);
      if (walks.size > WALKS_KEPT) {
        const oldest = [...walks.entries()].sort((a, b) => a[1].at - b[1].at)[0];
        if (oldest !== undefined) walks.delete(oldest[0]);
      }
      this.#trimWalks(walk);
      return walk;
    });
    this.#walking.set(flight, walking);
    try {
      return await walking;
    } finally {
      this.#walking.delete(flight);
    }
  }

  /** The worker-wide bound on kept walks: the oldest anywhere goes until the
   * kept entries fit WALK_CACHE_ENTRIES (never the walk just made). */
  #trimWalks(keep: NameWalk): void {
    const all: Array<{ walks: Map<string, NameWalk>; key: string; walk: NameWalk }> = [];
    let total = 0;
    for (const walks of this.#walks.values())
      for (const [key, walk] of walks) {
        all.push({ walks, key, walk });
        total += walk.walked;
      }
    all.sort((a, b) => a.walk.at - b.walk.at);
    for (const item of all) {
      if (total <= WALK_CACHE_ENTRIES) break;
      if (item.walk === keep) continue;
      item.walks.delete(item.key);
      total -= item.walk.walked;
    }
  }

  async search(args: SearchArgs): Promise<SearchValue> {
    const rootReal = await this.#rootReal(args.rootPath);
    // fix7 — an engine of the search's own (header): what it hydrates never
    // enters the rows' store
    const slot = await this.#acquire(rootReal, "search");
    try {
      const folder = await bounded(this.#folder(slot, rootReal, args.segments), this.#listMs);
      if (folder === HELD) throw engineHeld(join(rootReal, ...args.segments), this.#listMs);
      const { abs } = folder;
      const walk = await this.#names(rootReal, abs, args.segments.join("/"));
      const scored: Array<{ index: number; score: number }> = [];
      for (let index = 0; index < walk.rels.length; index += 1) {
        const kind = walk.kinds[index] as number;
        if (args.kinds === "dirs" && kind !== ENTRY.DIR) continue;
        const rel = walk.rels[index] as string;
        const score = matchName(args.q, rel.slice(rel.lastIndexOf("/") + 1));
        if (score !== null) scored.push({ index, score });
      }
      scored.sort(
        (a, b) =>
          b.score - a.score ||
          (walk.rels[a.index] as string).length - (walk.rels[b.index] as string).length ||
          (walk.rels[a.index] as string).localeCompare(walk.rels[b.index] as string),
      );
      const hits: WorkerSearchHit[] = [];
      let more = false;
      // a hit whose folder did not answer is left out, and the answer says it
      // is not all the walk found
      let unread = false;
      // fix7 — the resolve phase's budget: what is unresolved by then is left
      // out, said as `complete: false`
      const resolveBy = Date.now() + this.#resolveMs;
      for (const { index } of scored) {
        if (hits.length === args.limit) {
          more = true;
          break;
        }
        if (Date.now() >= resolveBy) {
          unread = true;
          break;
        }
        const relativePath = walk.rels[index] as string;
        const absolute = join(slot.rootPath, ...relativePath.split("/"));
        // the name list may be a minute old: a hit is read from the disk again,
        // and given the engine's id (mille hydrates just its ancestor chain)
        try {
          await lstat(absolute);
        } catch {
          continue;
        }
        const id = await bounded(
          slot.host.local.resolvePath(absolute).catch((error: unknown) => {
            if (milleRefusal(error) !== null) unread = true;
            return null;
          }),
          resolveBy - Date.now(),
        );
        if (id === HELD) {
          unread = true;
          break;
        }
        if (id === null || id === undefined) continue;
        hits.push({
          id,
          name: relativePath
            .slice(relativePath.lastIndexOf("/") + 1)
            .slice(0, WORKSPACE_LIMITS.NAME_CHARS),
          relativePath,
          kind: ENTRY_KIND_NAMES[walk.kinds[index] as number] ?? "other",
        });
      }
      return { hits, clipped: more, complete: walk.complete && !unread, walked: walk.walked };
    } catch (error) {
      throw milleRefusal(error, this.#platform) ?? error;
    } finally {
      this.#release(slot);
    }
  }

  /** Dispose every engine idle past its lease. */
  async sweep(): Promise<void> {
    const now = this.#now();
    for (const slot of [...this.#slots.values()]) {
      if (slot.host === null || slot.active > 0 || now - slot.lastUsed < this.#idleMs) continue;
      if (this.#slots.get(slot.key) !== slot) continue;
      this.#slots.delete(slot.key);
      await slot.host.dispose().catch(() => undefined);
    }
  }

  async disposeAll(): Promise<void> {
    clearInterval(this.#sweeper);
    const slots = [...this.#slots.values()];
    this.#slots.clear();
    this.#walks.clear();
    await Promise.all(
      slots.map((slot) => slot.pending.then((host) => host.dispose()).catch(() => undefined)),
    );
  }
}
