import { lstat, realpath, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
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

// FS-1a — the files worker's ENGINES: mille's host, ONE PER EXPORT.
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
// listed as one and never descended), folders one per row. No session is ever
// ATTACHED here in FS-1a, and mille arms its watcher and its 16 ms fan-out
// tick only on an attach (host.js `ensureBackgroundServices`) — so an export
// nobody is attached to has no watcher (FS-D12) by construction. The price of
// no watcher: a folder listed once goes stale, so a folder listed AGAIN is
// reconciled against the disk first (`resync`) — the door's answer is the
// disk's, never a cache's.
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

/** mille's `EntryKind` (mille-core entry.rs). */
const KIND = { FILE: 0, DIR: 1, SYMLINK: 2, UNAVAILABLE: 4 } as const;

/** How often idle engines are looked for. An engine idle past
 * `WORKSPACE_LIMITS.HOST_IDLE_MS` is disposed (its store, its native
 * explorer); the next ask makes a fresh one. Entry ids are stable while an
 * engine lives — the answers say so (`WorkspaceEntry.id`). */
const SWEEP_MS = 60_000;
/** Folder child counts read at once for one page. */
const COUNT_CONCURRENCY = 16;
/** Subtree name walks kept beside one engine (host/names.ts), and in the
 * whole worker at most this many walked entries (two full walks: some 40 MB
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

/** One export's engine, as the worker holds it. `active` is counted from the
 * moment an ask names the export — before its engine exists — so an engine an
 * ask is waiting for is never the one evicted. */
interface Slot {
  rootPath: string;
  pending: Promise<FileExplorerHost>;
  host: FileExplorerHost | null;
  lastUsed: number;
  active: number;
  /** the search's name walks of this export, by subtree (host/names.ts) */
  walks: Map<string, NameWalk>;
}

/** An acquired slot: its engine is there. */
type Live = Slot & { host: FileExplorerHost };

export interface EnginesOptions {
  /** test seams; production: WORKSPACE_LIMITS.HOST_IDLE_MS / HOSTS_MAX /
   * SEARCH_WALK_ENTRIES / SEARCH_WALK_MS */
  idleMs?: number;
  hostsMax?: number;
  walkEntries?: number;
  walkMs?: number;
  /** the user's home folder (its top-level Library is never walked) */
  home?: string;
  now?: () => number;
  platform?: NodeJS.Platform;
}

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
  readonly #home: string;
  /** folders whose read hung (a search walk's or a child count's,
   * host/names.ts) — never read again while that read holds its thread */
  readonly #hung = new Set<string>();
  readonly #now: () => number;
  readonly #platform: NodeJS.Platform;
  readonly #sweeper: NodeJS.Timeout;

  constructor(opts: EnginesOptions = {}) {
    this.#idleMs = opts.idleMs ?? WORKSPACE_LIMITS.HOST_IDLE_MS;
    this.#hostsMax = Math.max(1, opts.hostsMax ?? WORKSPACE_LIMITS.HOSTS_MAX);
    this.#walkEntries = opts.walkEntries ?? WORKSPACE_LIMITS.SEARCH_WALK_ENTRIES;
    this.#walkMs = opts.walkMs ?? WORKSPACE_LIMITS.SEARCH_WALK_MS;
    this.#home = opts.home ?? homedir();
    this.#now = opts.now ?? Date.now;
    this.#platform = opts.platform ?? process.platform;
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
    this.#slots.delete(victim.rootPath);
    void victim.host.dispose().catch(() => undefined);
  }

  async #acquire(rootPath: string): Promise<Live> {
    let slot = this.#slots.get(rootPath);
    if (slot === undefined) {
      if (this.#slots.size >= this.#hostsMax) this.#evictOne();
      const pending = createFileExplorerHost({
        roots: [rootPath],
        initialWalk: "roots-only",
        followSymlinks: false,
        respectIgnore: true,
        compactFolders: false,
      });
      const made: Slot = {
        rootPath,
        pending,
        host: null,
        lastUsed: this.#now(),
        active: 0,
        walks: new Map(),
      };
      slot = made;
      this.#slots.set(rootPath, made);
      pending.catch(() => {
        if (this.#slots.get(rootPath) === made) this.#slots.delete(rootPath);
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

  async list(args: ListArgs): Promise<ListValue> {
    const rootReal = await this.#rootReal(args.rootPath);
    const slot = await this.#acquire(rootReal);
    try {
      const { id, abs } = await this.#folder(slot, rootReal, args.segments);
      const fx = slot.host.local;
      // no watcher: a folder read before is reconciled, never served from memory
      if (fx.getSnapshot().directoryChildrenLoaded(id)) await fx.resync(id);
      const page = await fx.list(id, { sort: "kindThenName" });
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
    } finally {
      this.#release(slot);
    }
  }

  /** The subtree's NAMES (host/names.ts): this export's walk of that subtree
   * when one ran within SEARCH_CACHE_MS (a reader typing a query asks again
   * and again), else a fresh walk — kept beside the engine for its life, at
   * most WALKS_KEPT of them. */
  async #names(slot: Live, abs: string, startRel: string): Promise<NameWalk> {
    const now = this.#now();
    for (const [key, walk] of slot.walks)
      if (now - walk.at > WORKSPACE_LIMITS.SEARCH_CACHE_MS) slot.walks.delete(key);
    const kept = slot.walks.get(startRel);
    if (kept !== undefined) return kept;
    const walk = await walkNames({
      start: abs,
      startRel,
      home: abs === this.#home,
      maxEntries: this.#walkEntries,
      deadline: now + this.#walkMs,
      readTimeoutMs: WORKSPACE_LIMITS.READ_TIMEOUT_MS,
      hung: this.#hung,
      now: this.#now,
    });
    slot.walks.set(startRel, walk);
    if (slot.walks.size > WALKS_KEPT) {
      const oldest = [...slot.walks.entries()].sort((a, b) => a[1].at - b[1].at)[0];
      if (oldest !== undefined) slot.walks.delete(oldest[0]);
    }
    this.#trimWalks(walk);
    return walk;
  }

  /** The worker-wide bound on kept walks: the oldest anywhere goes until the
   * kept entries fit WALK_CACHE_ENTRIES (never the walk just made). */
  #trimWalks(keep: NameWalk): void {
    const all: Array<{ slot: Slot; key: string; walk: NameWalk }> = [];
    let total = 0;
    for (const slot of this.#slots.values())
      for (const [key, walk] of slot.walks) {
        all.push({ slot, key, walk });
        total += walk.walked;
      }
    all.sort((a, b) => a.walk.at - b.walk.at);
    for (const item of all) {
      if (total <= WALK_CACHE_ENTRIES) break;
      if (item.walk === keep) continue;
      item.slot.walks.delete(item.key);
      total -= item.walk.walked;
    }
  }

  async search(args: SearchArgs): Promise<SearchValue> {
    const rootReal = await this.#rootReal(args.rootPath);
    const slot = await this.#acquire(rootReal);
    try {
      const { abs } = await this.#folder(slot, rootReal, args.segments);
      const walk = await this.#names(slot, abs, args.segments.join("/"));
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
      for (const { index } of scored) {
        if (hits.length === args.limit) {
          more = true;
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
        const id = await slot.host.local.resolvePath(absolute).catch(() => null);
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
      return { hits, clipped: more, complete: walk.complete, walked: walk.walked };
    } finally {
      this.#release(slot);
    }
  }

  /** Dispose every engine idle past its lease. */
  async sweep(): Promise<void> {
    const now = this.#now();
    for (const slot of [...this.#slots.values()]) {
      if (slot.host === null || slot.active > 0 || now - slot.lastUsed < this.#idleMs) continue;
      if (this.#slots.get(slot.rootPath) !== slot) continue;
      this.#slots.delete(slot.rootPath);
      await slot.host.dispose().catch(() => undefined);
    }
  }

  async disposeAll(): Promise<void> {
    clearInterval(this.#sweeper);
    const slots = [...this.#slots.values()];
    this.#slots.clear();
    await Promise.all(
      slots.map((slot) => slot.pending.then((host) => host.dispose()).catch(() => undefined)),
    );
  }
}
