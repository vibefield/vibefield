import { type ChildProcess, execFile } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { setPriority } from "node:os";
import { dirname, isAbsolute, join } from "node:path";
import { WORKSPACE_TREE_SIZE } from "@vibefield/contracts/registries";

// HD-3 — WHAT A WORKTREE'S FOLDER HOLDS ON DISK, for the room's worktree ledger. A port of rosetta's
// `clients/app/electron/tree-size.mjs`, as `git.ts` beside it is of its git service: the room reads the same
// fact from either host.
//
// There is no instant answer for an ordinary folder: the figure is a walk. Its cost follows the number of
// files, not their bytes (measured 2026-11-24, an APFS SSD, file cache warm: 36,028 entries and 1.05 GB in
// 0.2 s; a 3.7 GB build folder of 5,794 entries in 0.02 s). A repository's worktrees hold the same tracked
// files, so git's own record of sizes (60 ms, no walk) says the same figure for each and cannot tell a heavy
// checkout from a light one: what differs is what git does not track, and only the walk sees it.
//
// ONE WALK IS CHEAP AND FOUR HUNDRED ARE NOT. *Corrected 2026-11-24, the day it was built:* the first cut
// queued every worktree `git worktree list` named whenever a root's git facts were asked for, and measured
// each again ten minutes later. On a repository with 470 worktrees that is a walk without end, and it ran a
// laptop hot. So now:
//  · NOTHING IS WALKED UNLESS IT IS ASKED FOR BY NAME (`ask`), and the room asks only for the rows it is
//    showing. A new ask REPLACES the queue: a row scrolled away is no longer owed.
//  · A FIGURE IS KEPT, on disk (`file`), and stands for TTL_MS (a day). Opening the list again reads the file
//    and walks nothing. `peek` answers a standing figure however old, and queues nothing.
//  · A WALK RUNS IN THE BACKGROUND AND RESTS: on macOS through `taskpolicy -b` (background quality of service:
//    the efficiency cores, throttled disk), elsewhere at the lowest priority; and after each walk the queue
//    rests REST_FACTOR times as long as the walk took (REST_MIN_MS at least), so the walker never holds more
//    than a third of one core however long the queue.
//
// `du` walks: it counts a hard-linked file once, counts blocks allocated, and with `-x` never leaves the
// filesystem it started on. The figure is NOT what removing the folder would free (files cloned from a
// package store share their blocks, and no cheap call tells shared from owned), and a linked build folder is
// not followed.
//
// EL7: a path comes from `git worktree list`, and a repository an agent wrote can name any folder there. The
// caller asks only for paths git listed for a root the files service serves (`worktreeSizes`, git.ts); here a
// path is walked only when absolute with a `.git` of its own; a walk is cut at TIMEOUT_MS; a cut or failed
// walk is remembered as "no figure" for FAILED_TTL_MS, never retried in a loop. `du` runs with the
// environment the caller hands it (the git runner's allowlist) and prints one number, which is all that is
// read. The kept file holds paths and byte counts, nothing of a file's content, at 0600.

export type TreeMeasure = (
  folder: string,
  options: { onChild?: (child: ChildProcess) => void },
) => Promise<number | null>;

/** macOS's door to background quality of service; absent elsewhere. */
const TASKPOLICY = "/usr/sbin/taskpolicy";

/** `du -skx -- <folder>`: kilobytes allocated, in bytes; null when it could not be read or ran out of time.
 * `du` exits non-zero when one folder below refused it and still prints the sum of the rest, which is kept. */
export function measureWithDu(
  folder: string,
  options: {
    timeoutMs?: number;
    env?: NodeJS.ProcessEnv;
    onChild?: (child: ChildProcess) => void;
    background?: boolean;
  } = {},
): Promise<number | null> {
  const background =
    options.background ?? (process.platform === "darwin" && existsSync(TASKPOLICY));
  const du = ["-skx", "--", folder];
  return new Promise((resolve) => {
    const child = execFile(
      background ? TASKPOLICY : "du",
      background ? ["-b", "du", ...du] : du,
      {
        timeout: options.timeoutMs ?? WORKSPACE_TREE_SIZE.TIMEOUT_MS,
        maxBuffer: 64 * 1024,
        windowsHide: true,
        env: { ...(options.env ?? { PATH: process.env["PATH"] }), LANG: "C", LC_ALL: "C" },
      },
      (error, stdout) => {
        if (error?.killed === true) return resolve(null);
        const kilobytes = /^(\d+)\s/.exec(String(stdout))?.[1];
        resolve(kilobytes === undefined ? null : Number(kilobytes) * 1024);
      },
    );
    try {
      // `taskpolicy` becomes `du` (it execs), so this is the walker's own priority either way
      if (child.pid !== undefined) setPriority(child.pid, 19);
    } catch {
      // it runs at the priority it has
    }
    options.onChild?.(child);
  });
}

export interface TreeSizesOptions {
  /** where figures are kept across runs; absent or null keeps them in memory only */
  file?: string | null;
  ttlMs?: number;
  now?: () => number;
  platform?: NodeJS.Platform;
  measure?: TreeMeasure;
  isWorktree?: (folder: string) => boolean;
  /** the pause after a walk (a test's own clock) */
  rest?: (ms: number) => Promise<void>;
}

interface Known {
  /** undefined: the walk failed or was cut */
  bytes: number | undefined;
  at: number;
}

export class TreeSizes {
  readonly #file: string | null;
  readonly #ttlMs: number;
  readonly #now: () => number;
  readonly #platform: NodeJS.Platform;
  readonly #measure: TreeMeasure;
  readonly #isWorktree: (folder: string) => boolean;
  readonly #rest: (ms: number) => Promise<void>;
  readonly #known = new Map<string, Known>();
  #queue: string[] = [];
  #running: string | null = null;
  #child: ChildProcess | null = null;
  #saveTimer: NodeJS.Timeout | null = null;
  #dirty = false;
  #disposed = false;

  constructor(options: TreeSizesOptions = {}) {
    this.#file = options.file ?? null;
    this.#ttlMs = options.ttlMs ?? WORKSPACE_TREE_SIZE.TTL_MS;
    this.#now = options.now ?? Date.now;
    this.#platform = options.platform ?? process.platform;
    this.#measure = options.measure ?? ((folder, o) => measureWithDu(folder, o));
    this.#isWorktree =
      options.isWorktree ?? ((folder) => isAbsolute(folder) && existsSync(join(folder, ".git")));
    this.#rest =
      options.rest ??
      ((ms) =>
        new Promise((resolve) => {
          setTimeout(resolve, ms).unref?.();
        }));
    this.#load();
  }

  /** A standing figure, however old; undefined when there is none. Queues nothing. */
  peek(folder: string): number | undefined {
    return this.#known.get(folder)?.bytes;
  }

  /** The figures for these folders, in their order, and the walks they are owed. Per folder: bytes (a fresh
   * figure, or an old one while its replacement is walked); null while a first walk is queued or running;
   * undefined when this desktop does not measure (Windows has no `du`) or the folder could not be read.
   * The queue becomes exactly what THIS ask is owed, in its order: what an earlier ask queued and this one
   * does not name is dropped (the walk in flight finishes). At most ASK_MAX folders are taken; the rest
   * answer undefined. */
  ask(folders: readonly string[]): Array<number | null | undefined> {
    if (this.#platform === "win32" || this.#disposed) return folders.map(() => undefined);
    const now = this.#now();
    const owed: string[] = [];
    const answers = folders.map((folder, at) => {
      if (at >= WORKSPACE_TREE_SIZE.ASK_MAX) return undefined;
      const entry = this.#known.get(folder);
      if (entry !== undefined) {
        const life = entry.bytes === undefined ? WORKSPACE_TREE_SIZE.FAILED_TTL_MS : this.#ttlMs;
        if (now - entry.at < life) return entry.bytes;
      }
      if (!owed.includes(folder)) owed.push(folder);
      return entry?.bytes ?? null;
    });
    this.#queue = owed.filter((folder) => folder !== this.#running);
    this.#next();
    return answers;
  }

  /** Stop: the walk in flight is ended, nothing further starts, and what is known is written. */
  dispose(): void {
    this.#disposed = true;
    this.#queue = [];
    this.#child?.kill();
    if (this.#saveTimer !== null) clearTimeout(this.#saveTimer);
    this.#saveTimer = null;
    this.#save();
  }

  #next(): void {
    if (this.#running !== null || this.#disposed) return;
    const folder = this.#queue.shift();
    if (folder === undefined) return;
    this.#running = folder;
    const started = this.#now();
    const done = (bytes: number | null): void => {
      this.#child = null;
      if (this.#disposed) return;
      this.#known.delete(folder);
      this.#known.set(folder, { bytes: bytes ?? undefined, at: this.#now() });
      while (this.#known.size > WORKSPACE_TREE_SIZE.KEPT) {
        const oldest = this.#known.keys().next().value;
        if (oldest === undefined) break;
        this.#known.delete(oldest);
      }
      if (bytes !== null) this.#saveSoon();
      const took = Math.max(0, this.#now() - started);
      const pause = Math.max(
        WORKSPACE_TREE_SIZE.REST_MIN_MS,
        took * WORKSPACE_TREE_SIZE.REST_FACTOR,
      );
      // the figure is answerable at once; only the NEXT walk waits out the rest
      void this.#rest(pause).then(() => {
        this.#running = null;
        this.#next();
      });
    };
    Promise.resolve()
      .then(() =>
        this.#isWorktree(folder)
          ? this.#measure(folder, {
              onChild: (child) => {
                this.#child = child;
              },
            })
          : null,
      )
      .then(done, () => done(null));
  }

  #load(): void {
    if (this.#file === null) return;
    try {
      const kept = JSON.parse(readFileSync(this.#file, "utf8")) as { sizes?: unknown };
      if (typeof kept.sizes !== "object" || kept.sizes === null) return;
      for (const [folder, value] of Object.entries(kept.sizes)) {
        const entry = value as { bytes?: unknown; at?: unknown } | null;
        if (
          isAbsolute(folder) &&
          typeof entry?.bytes === "number" &&
          Number.isSafeInteger(entry.bytes) &&
          entry.bytes >= 0 &&
          typeof entry.at === "number" &&
          Number.isFinite(entry.at)
        )
          this.#known.set(folder, { bytes: entry.bytes, at: entry.at });
        if (this.#known.size >= WORKSPACE_TREE_SIZE.KEPT) break;
      }
    } catch {
      // no file yet, or one this reader cannot use: figures are measured again as they are asked for
    }
  }

  #saveSoon(): void {
    this.#dirty = true;
    if (this.#file === null || this.#saveTimer !== null) return;
    this.#saveTimer = setTimeout(() => {
      this.#saveTimer = null;
      this.#save();
    }, WORKSPACE_TREE_SIZE.SAVE_DELAY_MS);
    this.#saveTimer.unref?.();
  }

  #save(): void {
    if (this.#file === null || !this.#dirty) return;
    this.#dirty = false;
    const sizes: Record<string, { bytes: number; at: number }> = {};
    for (const [folder, entry] of this.#known)
      if (entry.bytes !== undefined) sizes[folder] = { bytes: entry.bytes, at: entry.at };
    try {
      mkdirSync(dirname(this.#file), { recursive: true, mode: 0o700 });
      const aside = `${this.#file}.tmp`;
      writeFileSync(aside, JSON.stringify({ v: 1, sizes }), { mode: 0o600 });
      renameSync(aside, this.#file);
    } catch {
      // the figures stand in memory; the next walk tries the file again
      this.#dirty = true;
    }
  }
}
