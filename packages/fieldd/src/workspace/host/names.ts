import type { Dirent } from "node:fs";
import { readdir } from "node:fs/promises";
import { join } from "node:path";

// FS-1a — the search's NAME WALK and its matcher.
//
// The lead's ruling (2026-10-05) asked the worker to walk the searched subtree
// INTO the export's mille engine up to an entry budget and let mille's own
// search answer. Measured on this Mac (mille 0.3.4), that cannot meet any
// budget worth having: mille's hydration grows super-linearly with its store —
// 5 500 entries in 0.45 s, 11 000 in 2.8 s, 22 000 in 15 s (prefetch, the
// native depth walk and populateFromRoots alike) — so 100 000 entries would be
// minutes. A plain directory walk reads 100 000 entries of the real home
// folder in under a second. So the search reads NAMES from the filesystem,
// bounded exactly as the ruling bounds it (SEARCH_WALK_ENTRIES, SEARCH_WALK_MS,
// `complete: false` when cut), matches them here, and hands mille only the
// hits (`resolvePath`, one ancestor chain each), so every hit still carries the
// engine's id. An upstream ask (mille: linear hydration, or its matcher as a
// pure function, or a walk-and-search op that does not hydrate) retires this.
//
// What the walk never descends: hidden folders (a leading dot), vendored trees
// (node_modules), macOS packages (a `.app`, a `.key` — Finder shows them as
// files, and an iCloud-evicted one BLOCKS a directory read while the system
// downloads it: measured, a Keynote package in ~/Documents held a read for
// minutes), `Library` at the top of the home folder (hidden by Finder, and the
// home walk's largest tree), and symlinks (never followed). A folder whose
// read does not answer within READ_TIMEOUT_MS is skipped and remembered
// for the worker's life (its read may still be holding a thread) — the walk
// then says it is not complete.

export const ENTRY = { FILE: 0, DIR: 1, SYMLINK: 2, OTHER: 3 } as const;

/** A walk that has seen this many reads hang stops (its folders' threads are
 * the worker's I/O pool; a third hung read would start to starve it). */
export const HUNG_READS_MAX = 2;

/** Folder names never descended (beside hidden ones). */
const VENDORED = new Set(["node_modules"]);
/** Folders macOS presents as a single file (a document or an app package). */
const PACKAGE =
  /\.(app|appex|bundle|framework|plugin|kext|key|pages|numbers|rtfd|photoslibrary|musiclibrary|imovielibrary|tvlibrary|fcpbundle|logicx|band|xcarchive|sparsebundle|playground|xcassets|lproj)$/i;

/** One walk's result: every entry seen, by its path below the ROOT. */
export interface NameWalk {
  rels: string[];
  kinds: Uint8Array;
  /** the walk reached every folder it would descend */
  complete: boolean;
  /** entries seen */
  walked: number;
  /** when it ran (ms) */
  at: number;
}

export interface NameWalkOptions {
  /** absolute path of the subtree's folder */
  start: string;
  /** its path below the root ("" = the root) */
  startRel: string;
  /** the walk starts at the user's home folder (its top-level `Library` is skipped) */
  home: boolean;
  maxEntries: number;
  deadline: number;
  readTimeoutMs: number;
  /** folders known to hang a read (absolute paths); grows as reads hang */
  hung: Set<string>;
  now: () => number;
}

function kindOf(dirent: Dirent): number {
  if (dirent.isDirectory()) return ENTRY.DIR;
  if (dirent.isFile()) return ENTRY.FILE;
  if (dirent.isSymbolicLink()) return ENTRY.SYMLINK;
  return ENTRY.OTHER;
}

/** A read that answers in time, or "timeout" (the folder is then remembered
 * as hung until its read settles). Every folder read the worker makes outside
 * mille goes through it: a search walk's, and a page's child counts. */
export function timedRead(
  path: string,
  ms: number,
  hung: Set<string>,
): Promise<Dirent[] | null | "timeout"> {
  return new Promise((resolve) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      hung.add(path);
      resolve("timeout");
    }, ms);
    timer.unref?.();
    readdir(path, { withFileTypes: true }).then(
      (entries) => {
        hung.delete(path);
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(entries);
      },
      () => {
        hung.delete(path);
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(null);
      },
    );
  });
}

/** Walk the subtree breadth-first, reading names only (module header). */
export async function walkNames(opts: NameWalkOptions): Promise<NameWalk> {
  const rels: string[] = [];
  const kinds: number[] = [];
  let complete = true;
  let timeouts = 0;
  const queue: string[] = [opts.startRel];
  outer: for (let head = 0; head < queue.length; head += 1) {
    const rel = queue[head] as string;
    const below = opts.startRel.length === 0 ? rel : rel.slice(opts.startRel.length + 1);
    const abs = below.length === 0 ? opts.start : join(opts.start, ...below.split("/"));
    if (opts.now() > opts.deadline || opts.hung.has(abs)) {
      complete = false;
      if (opts.now() > opts.deadline) break;
      continue;
    }
    const entries = await timedRead(abs, opts.readTimeoutMs, opts.hung);
    if (entries === "timeout") {
      complete = false;
      timeouts += 1;
      if (timeouts >= HUNG_READS_MAX) break;
      continue;
    }
    if (entries === null) continue; // unreadable: it holds no names
    for (const dirent of entries) {
      const childRel = rel.length === 0 ? dirent.name : `${rel}/${dirent.name}`;
      const kind = kindOf(dirent);
      rels.push(childRel);
      kinds.push(kind);
      if (rels.length >= opts.maxEntries) {
        complete = false;
        break outer;
      }
      if (
        kind === ENTRY.DIR &&
        !dirent.name.startsWith(".") &&
        !VENDORED.has(dirent.name) &&
        !PACKAGE.test(dirent.name) &&
        !(opts.home && rel.length === 0 && dirent.name === "Library")
      )
        queue.push(childRel);
    }
  }
  return { rels, kinds: Uint8Array.from(kinds), complete, walked: rels.length, at: opts.now() };
}

const BOUNDARY = /[\s._\-/]/;

/**
 * A fuzzy name match in the spirit of mille's (nucleo, "smart case"): every
 * character of `query` appears in `name` in order; a lowercase query matches
 * any case, one with an uppercase letter matches case exactly. Scored so a
 * reader sees the likeliest first: an exact name, then a prefix, then runs of
 * consecutive characters and characters at word starts; gaps cost a little.
 * Null when the query does not match.
 */
export function matchName(query: string, name: string): number | null {
  if (query.length === 0 || query.length > name.length) return null;
  const sensitive = query !== query.toLowerCase();
  const q = sensitive ? query : query.toLowerCase();
  const n = sensitive ? name : name.toLowerCase();
  if (n === q) return 10_000;
  let score = n.startsWith(q) ? 1_000 : 0;
  const contiguous = n.indexOf(q);
  if (contiguous >= 0) score += 500 - Math.min(contiguous, 400);
  let at = 0;
  let previous = -2;
  for (let i = 0; i < q.length; i += 1) {
    const found = n.indexOf(q[i] as string, at);
    if (found === -1) return null;
    score += 16;
    if (found === previous + 1) score += 12;
    if (found === 0 || BOUNDARY.test(name[found - 1] as string)) score += 10;
    else if (/[a-z]/.test(name[found - 1] as string) && /[A-Z]/.test(name[found] as string))
      score += 8;
    score -= Math.min(found - at, 8);
    previous = found;
    at = found + 1;
  }
  return score - Math.min(name.length - q.length, 50) / 10;
}
