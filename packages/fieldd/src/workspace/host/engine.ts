import { lstat, readdir, realpath, stat } from "node:fs/promises";
import { join } from "node:path";
import { createFileExplorerHost, type Entry, type FileExplorerHost } from "@vibecook/mille";
import type { WorkspaceEntry, WorkspaceEntryKind, WorkspaceSearchHit } from "@vibefield/contracts";
import { WORKSPACE_LIMITS } from "@vibefield/contracts/registries";
import { isWithin } from "../paths";
import type { ListArgs, ListValue, SearchArgs, SearchValue, WorkerErrorCode } from "../protocol";

// FS-1a — the files worker's ENGINES: mille's host, ONE PER EXPORT.
//
// The record (§4) pictured one `createFileExplorerHost` holding every export;
// mille refuses that — "workspace roots must be unique and non-overlapping"
// (mille-binding explorer.rs, mille-core store.rs) — and the home export holds
// every place. So this is mille-truffle's own model (`server.ts` acquireHost):
// an engine per export, created on the first ask that names it, disposed
// after `ENGINE_IDLE_MS` without one, inside the one always-on worker.
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

/** mille's `EntryKind` (mille-core entry.rs). */
const KIND = { FILE: 0, DIR: 1, SYMLINK: 2, UNAVAILABLE: 4 } as const;

/** An engine with no ask for this long is disposed (its store, its native
 * explorer); the next ask makes a fresh one. Entry ids are stable while an
 * engine lives — the answers say so (`WorkspaceEntry.id`). */
export const ENGINE_IDLE_MS = 5 * 60_000;
/** How often idle engines are looked for. */
const SWEEP_MS = 60_000;
/** Folder child counts read at once for one page. */
const COUNT_CONCURRENCY = 16;
/** Folders a search's walk never descends, beside hidden and ignored ones:
 * vendored trees whose names would bury every real hit. */
const SEARCH_SKIP = new Set(["node_modules"]);
/** How many raw matches a search reads from mille before it filters to the
 * root, the kinds and the live disk. */
const SEARCH_SCAN = 5_000;

export class WorkerFailure extends Error {
  constructor(
    readonly code: WorkerErrorCode,
    message: string,
  ) {
    super(message);
  }
}

interface Slot {
  rootPath: string;
  host: FileExplorerHost;
  lastUsed: number;
  active: number;
}

export interface EnginesOptions {
  idleMs?: number;
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
 * counted); undefined when it cannot be read. No engine is asked: counting a
 * page's folders must not hydrate their children into the store. */
async function countChildren(path: string): Promise<number | undefined> {
  try {
    const names = await readdir(path);
    let count = 0;
    for (const name of names) if (!name.startsWith(".")) count += 1;
    return count;
  } catch {
    return undefined;
  }
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
  readonly #slots = new Map<string, Promise<Slot>>();
  readonly #idleMs: number;
  readonly #now: () => number;
  readonly #platform: NodeJS.Platform;
  readonly #sweeper: NodeJS.Timeout;

  constructor(opts: EnginesOptions = {}) {
    this.#idleMs = opts.idleMs ?? ENGINE_IDLE_MS;
    this.#now = opts.now ?? Date.now;
    this.#platform = opts.platform ?? process.platform;
    this.#sweeper = setInterval(() => void this.sweep(), Math.min(SWEEP_MS, this.#idleMs));
    this.#sweeper.unref();
  }

  /** Engines alive now. */
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

  async #acquire(rootPath: string): Promise<Slot> {
    let pending = this.#slots.get(rootPath);
    if (pending === undefined) {
      pending = createFileExplorerHost({
        roots: [rootPath],
        initialWalk: "roots-only",
        followSymlinks: false,
        respectIgnore: true,
        compactFolders: false,
      }).then((host) => ({ rootPath, host, lastUsed: this.#now(), active: 0 }));
      this.#slots.set(rootPath, pending);
      pending.catch(() => this.#slots.delete(rootPath));
    }
    const slot = await pending;
    slot.active += 1;
    slot.lastUsed = this.#now();
    return slot;
  }

  #release(slot: Slot): void {
    slot.active -= 1;
    slot.lastUsed = this.#now();
  }

  /** The engine's root row — refreshed when the folder came back after the
   * engine saw it gone (mille keeps a gone root as `Unavailable`). */
  async #rootEntry(slot: Slot): Promise<Entry> {
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
  async #child(slot: Slot, parent: number, name: string, fresh: boolean): Promise<Entry | null> {
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
    slot: Slot,
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

  async list(args: ListArgs): Promise<ListValue> {
    const rootReal = await this.#rootReal(args.rootPath);
    const slot = await this.#acquire(args.rootPath);
    try {
      const { id, abs } = await this.#folder(slot, rootReal, args.segments);
      const fx = slot.host.local;
      // no watcher: a folder read before is reconciled, never served from memory
      if (fx.getSnapshot().directoryChildrenLoaded(id)) await fx.resync(id);
      const page = await fx.list(id, { sort: "kindThenName" });
      const entries =
        args.kinds === "dirs" ? page.entries.filter((e) => e.kind === KIND.DIR) : [...page.entries];
      const slice = entries.slice(args.offset, args.offset + args.limit);
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
          const count = await countChildren(path);
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

  /** Walk the root breadth-first so a search has names to match: folders not
   * read yet are read, at most `SEARCH_WALK_DIRS` of them and for at most
   * `SEARCH_WALK_MS`; hidden, ignored and vendored folders and symlinks are
   * not descended. Answers whether the walk reached every folder it would. */
  async #walk(slot: Slot, rootId: number): Promise<boolean> {
    const fx = slot.host.local;
    const deadline = this.#now() + WORKSPACE_LIMITS.SEARCH_WALK_MS;
    let read = 0;
    const queue: number[] = [rootId];
    for (let head = 0; head < queue.length; head += 1) {
      const id = queue[head] as number;
      if (!fx.getSnapshot().directoryChildrenLoaded(id)) {
        if (read >= WORKSPACE_LIMITS.SEARCH_WALK_DIRS || this.#now() > deadline) return false;
        try {
          await fx.prefetch(id);
        } catch {
          // an unreadable folder holds no names; the walk goes on
        }
        read += 1;
      }
      const snapshot = fx.getSnapshot();
      for (const childId of snapshot.childrenOf(id)) {
        const child = snapshot.getById(childId);
        if (
          child !== null &&
          child.kind === KIND.DIR &&
          !child.isHidden &&
          !child.isIgnored &&
          !SEARCH_SKIP.has(child.name)
        )
          queue.push(childId);
      }
    }
    return true;
  }

  async search(args: SearchArgs): Promise<SearchValue> {
    await this.#rootReal(args.rootPath);
    const slot = await this.#acquire(args.rootPath);
    try {
      const root = await this.#rootEntry(slot);
      const complete = await this.#walk(slot, root.id);
      const fx = slot.host.local;
      const snapshot = fx.getSnapshot();
      const raw = fx.search(args.q, { limit: SEARCH_SCAN });
      const pathOf = (id: number): string | null => {
        const names: string[] = [];
        let cursor: number | null | undefined = id;
        for (let hop = 0; hop < 1_024 && cursor !== null && cursor !== undefined; hop += 1) {
          const entry = snapshot.getById(cursor);
          if (entry === null) return null;
          if (entry.parentId === null || entry.parentId === undefined)
            return entry.id === root.id ? join(slot.rootPath, ...names.reverse()) : null;
          names.push(entry.name);
          cursor = entry.parentId;
        }
        return null;
      };
      const matched: WorkspaceSearchHit[] = [];
      let more = raw.length >= SEARCH_SCAN;
      for (const hit of raw) {
        const entry = hit.entry;
        if (entry.id === root.id) continue;
        if (args.kinds === "dirs" && entry.kind !== KIND.DIR) continue;
        const path = pathOf(entry.id);
        if (path === null) continue;
        // the store may remember a name the disk no longer has (no watcher)
        try {
          await lstat(path);
        } catch {
          continue;
        }
        if (matched.length === args.limit) {
          more = true;
          break;
        }
        matched.push({
          id: entry.id,
          name: entry.name.slice(0, WORKSPACE_LIMITS.NAME_CHARS),
          path,
          kind: kindOf(entry),
        });
      }
      return { hits: matched, clipped: more, complete };
    } finally {
      this.#release(slot);
    }
  }

  /** Dispose every engine idle past its lease. */
  async sweep(): Promise<void> {
    const now = this.#now();
    for (const [rootPath, pending] of [...this.#slots]) {
      let slot: Slot;
      try {
        slot = await pending;
      } catch {
        continue;
      }
      if (slot.active > 0 || now - slot.lastUsed < this.#idleMs) continue;
      if (this.#slots.get(rootPath) !== pending) continue;
      this.#slots.delete(rootPath);
      await slot.host.dispose().catch(() => undefined);
    }
  }

  async disposeAll(): Promise<void> {
    clearInterval(this.#sweeper);
    const slots = [...this.#slots.values()];
    this.#slots.clear();
    await Promise.all(
      slots.map((pending) => pending.then((slot) => slot.host.dispose()).catch(() => undefined)),
    );
  }
}
