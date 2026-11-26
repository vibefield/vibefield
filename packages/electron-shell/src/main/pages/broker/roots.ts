// EY-1 (2026-11-19) — THE ENGINE ROOTS' END. Each engine instance lives in its own root under
// `<parent>/vf-<uid>/` (surroundings.ts). An instance's root is removed once its engine's exit has
// been seen. At main's first start, roots left by a main that ended without stopping its engines
// are swept, as folders only:
// - the uid folder is held to the alias folder's rules first, by lstat: a real directory of this
//   uid, mode 0700, never a link; otherwise nothing is swept, and that is said;
// - only entries named `pg-` and eight hex, each a real directory of this uid by lstat; a link, a
//   file or another uid's entry by that name is left, and counted;
// - only a root whose newest entry is older than the bound given (twice the engine's idle bound in
//   the product): a running engine keeps writing its own files, and ends itself at its idle bound;
// - never a root whose daemon socket answers a bare connect (no command is sent): that is a live
//   main's engine, and two app instances on one account never sweep each other;
// - the removal never follows a link out of the root, and never leaves the uid folder;
// - it never throws, and never stops main starting: whatever it meets is left, and counted.
// An engine of an earlier main is NEVER signalled. Its pid is only in a file under its root, and
// any same-uid process can write there (EL7), so no pid in it proves the process is ours. It is
// left to its own idle exit. A same-uid process could also swap an entry between the check and the
// removal; same-uid code is the adversary EL7 names, and the uid folder's 0700 keeps every other
// account out.

import { lstatSync, readdirSync, rmdirSync, type Stats, unlinkSync } from "node:fs";
import { createConnection } from "node:net";
import { basename, dirname, join } from "node:path";
import { PAGES_ENGINE_NAMESPACE } from "./surroundings";

const ROOT_NAME = /^pg-[0-9a-f]{8}$/u;
/** How long the sweep waits for a root's socket to answer before it reads the root as dead. */
export const ROOT_SOCKET_ANSWER_MS = 250;
/** A root with more entries than this is left as young: the sweep never walks a tree unbounded. */
export const ROOT_WALK_MAX_ENTRIES = 10_000;
/** A root with more sockets than this is left: the sweep never probes without bound. */
export const ROOT_SOCKETS_MAX = 8;

export interface PagesRootsSweep {
  /** Why nothing was swept: the uid folder is absent, or it is not this uid's as the rules say. */
  readonly skipped: "absent" | "not-ours" | null;
  readonly removed: number;
  /** a root with an entry newer than the bound */
  readonly young: number;
  /** a root whose socket answered */
  readonly live: number;
  /** a link, a file or another uid's entry by a root's name, or a root that would not go */
  readonly left: number;
}

/** `<parent>/vf-<uid>`: the folder the roots live in. */
export function pagesUidFolderFor(parent: string, uid: number): string {
  return join(parent, `vf-${uid}`);
}

function uidFolderIsOurs(st: Stats, uid: number): boolean {
  return !st.isSymbolicLink() && st.isDirectory() && st.uid === uid && (st.mode & 0o7777) === 0o700;
}

function rootIsOurs(st: Stats, uid: number): boolean {
  return !st.isSymbolicLink() && st.isDirectory() && st.uid === uid;
}

/** Removes `path` and all under it, as an iterative walk under the walk's bound: a link is unlinked
 * itself, never followed, and a path outside `within` is refused. Children go before their
 * folder: the walk lists each folder before what is in it, and the removal runs the list
 * backwards. */
function removeTree(path: string, within: string): void {
  const found: { readonly path: string; readonly folder: boolean }[] = [];
  const stack = [path];
  let next = stack.pop();
  while (next !== undefined) {
    if (!next.startsWith(`${within}/`)) throw new Error("a removal stays inside its folder");
    if (found.length >= ROOT_WALK_MAX_ENTRIES) throw new Error("a removal walks a bounded tree");
    const folder = lstatSync(next).isDirectory();
    found.push({ path: next, folder });
    if (folder) for (const name of readdirSync(next)) stack.push(join(next, name));
    next = stack.pop();
  }
  for (const entry of found.reverse()) {
    if (entry.folder) rmdirSync(entry.path);
    else unlinkSync(entry.path);
  }
}

/** The newest mtime in the tree, by lstat; null past the walk's bound. */
function newestIn(root: string): number | null {
  let newest = 0;
  let seen = 0;
  const stack = [root];
  let path = stack.pop();
  while (path !== undefined) {
    seen += 1;
    if (seen > ROOT_WALK_MAX_ENTRIES) return null;
    const st = lstatSync(path);
    newest = Math.max(newest, st.mtimeMs);
    if (st.isDirectory()) for (const name of readdirSync(path)) stack.push(join(path, name));
    path = stack.pop();
  }
  return newest;
}

/** The root's daemon sockets. Each folder on the way is read by lstat as a real directory of
 * this uid first, so a link put where one was is never followed. Null when one is not, or when
 * there are more sockets than the bound. Throws on a folder that cannot be read. */
function socketsIn(root: string, uid: number): string[] | null {
  let folder = root;
  for (const name of ["sock", "namespaces", PAGES_ENGINE_NAMESPACE, "run"]) {
    folder = join(folder, name);
    let st: Stats;
    try {
      st = lstatSync(folder);
    } catch {
      return []; // no daemon ever made its socket here
    }
    if (!rootIsOurs(st, uid)) return null;
  }
  const sockets = readdirSync(folder).filter((name) => name.endsWith(".sock"));
  return sockets.length > ROOT_SOCKETS_MAX ? null : sockets.map((name) => join(folder, name));
}

/** Whether something accepts a connect on the socket, within the time given. Nothing is sent. */
export function socketAnswers(path: string, timeoutMs = ROOT_SOCKET_ANSWER_MS): Promise<boolean> {
  return new Promise((resolve) => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const socket = createConnection(path);
    const done = (answered: boolean) => {
      clearTimeout(timer);
      socket.destroy();
      resolve(answered);
    };
    timer = setTimeout(() => done(false), timeoutMs);
    socket.once("connect", () => done(true));
    socket.once("error", () => done(false));
  });
}

export interface PagesRootsSweepOptions {
  /** Where `vf-<uid>` lives. Always given: the sweep has no root of its own. */
  readonly parent: string;
  readonly uid?: number;
  /** A root is swept only when its newest entry is older than this. */
  readonly olderThanMs: number;
  readonly now?: () => number;
  readonly answers?: (socketPath: string) => Promise<boolean>;
}

/** Sweeps the roots an earlier main left. Run before this main makes any root of its own. */
export async function sweepStalePagesRoots(o: PagesRootsSweepOptions): Promise<PagesRootsSweep> {
  const uid = o.uid ?? process.getuid?.() ?? 0;
  const folder = pagesUidFolderFor(o.parent, uid);
  const none = { removed: 0, young: 0, live: 0, left: 0 };
  let st: Stats;
  try {
    st = lstatSync(folder);
  } catch {
    return { skipped: "absent", ...none };
  }
  if (!uidFolderIsOurs(st, uid)) return { skipped: "not-ours", ...none };
  const counts = { ...none };
  const now = (o.now ?? Date.now)();
  const answers = o.answers ?? ((path: string) => socketAnswers(path));
  let names: string[];
  try {
    names = readdirSync(folder);
  } catch {
    return { skipped: null, ...none, left: 1 };
  }
  for (const name of names) {
    if (!ROOT_NAME.test(name)) continue;
    counts[await sweepOne(join(folder, name), folder, uid, now, o.olderThanMs, answers)] += 1;
  }
  return { skipped: null, ...counts };
}

/** One root's fate. Any error is `left`: the sweep never throws. */
async function sweepOne(
  root: string,
  folder: string,
  uid: number,
  now: number,
  olderThanMs: number,
  answers: (socketPath: string) => Promise<boolean>,
): Promise<"removed" | "young" | "live" | "left"> {
  try {
    if (!rootIsOurs(lstatSync(root), uid)) return "left";
    const newest = newestIn(root);
    if (newest === null || now - newest < olderThanMs) return "young";
    const sockets = socketsIn(root, uid);
    if (sockets === null) return "left";
    const answered = await Promise.all(sockets.map((path) => answers(path)));
    if (answered.some((a) => a)) return "live";
    removeTree(root, folder);
    return "removed";
  } catch {
    return "left";
  }
}

/** An instance's own root, removed once its engine's exit has been seen: only a `pg-` root directly
 * in this uid's folder, both still this uid's by lstat. False when it was not removed. */
export function removePagesRoot(
  root: string,
  o: { readonly parent: string; readonly uid?: number },
): boolean {
  const uid = o.uid ?? process.getuid?.() ?? 0;
  const folder = pagesUidFolderFor(o.parent, uid);
  if (dirname(root) !== folder || !ROOT_NAME.test(basename(root))) return false;
  try {
    if (!uidFolderIsOurs(lstatSync(folder), uid)) return false;
    if (!rootIsOurs(lstatSync(root), uid)) return false;
    removeTree(root, folder);
    return true;
  } catch {
    return false;
  }
}
