import { type ChildProcess, execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { setPriority } from "node:os";
import { isAbsolute, join } from "node:path";
import { WORKSPACE_TREE_SIZE } from "@vibefield/contracts/registries";

// HD-3 — WHAT A WORKTREE'S FOLDER HOLDS ON DISK, for the room's worktree ledger
// (`WorkspaceGitWorktree.sizeBytes`). A port of rosetta's
// `clients/app/electron/tree-size.mjs`, as `git.ts` beside it is of its git
// service: the room reads the same fact from either host.
//
// There is no instant answer for an ordinary folder: the figure is a walk. Its
// cost follows the number of files, not their bytes (measured 2026-11-24, an
// APFS SSD, file cache warm: 36,028 entries and 1.05 GB in 0.2 s; a 3.7 GB
// build folder of 5,794 entries in 0.02 s). A repository's worktrees hold the
// same tracked files, so git's own record of sizes (60 ms, no walk) says the
// same figure for each and cannot tell a heavy checkout from a light one: what
// differs is what git does not track, and only the walk sees it.
//
// So `read` answers at once from what was measured and queues a measurement
// when it has none or an old one. One walk runs at a time, at low priority,
// and only because somebody asked for a root's git facts (the room's poll
// while its files column is open); the next poll carries the figure.
//
// `du` walks: it counts a hard-linked file once, counts blocks allocated, and
// with `-x` never leaves the filesystem it started on. The figure is NOT what
// removing the folder would free (files cloned from a package store share
// their blocks, and no cheap call tells shared from owned), and a linked build
// folder is not followed.
//
// EL7: the path comes from `git worktree list`, and a repository an agent
// wrote can name any folder there. A path is walked only when it is absolute
// and has a `.git` of its own; a walk is cut at TIMEOUT_MS; a cut or failed
// walk is remembered as "no figure" for as long as a figure would be, never
// retried in a loop. `du` runs with the environment the caller hands it (the
// git runner's allowlist) and prints one number, which is all that is read.

export interface TreeSizeReader {
  /** bytes; null while a first measurement is queued or running; undefined
   * when this desktop does not measure (Windows has no `du`) or the folder
   * could not be read. An old figure is answered while its replacement is
   * measured. */
  read(folder: string): number | null | undefined;
}

export type TreeMeasure = (
  folder: string,
  options: { onChild?: (child: ChildProcess) => void },
) => Promise<number | null>;

/** `du -skx -- <folder>`: kilobytes allocated, in bytes; null when it could
 * not be read or ran out of time. `du` exits non-zero when one folder below
 * refused it and still prints the sum of the rest, which is kept. */
export function measureWithDu(
  folder: string,
  options: {
    timeoutMs?: number;
    env?: NodeJS.ProcessEnv;
    onChild?: (child: ChildProcess) => void;
  } = {},
): Promise<number | null> {
  return new Promise((resolve) => {
    const child = execFile(
      "du",
      ["-skx", "--", folder],
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
      if (child.pid !== undefined) setPriority(child.pid, WORKSPACE_TREE_SIZE.NICE);
    } catch {
      // it runs at the priority it has
    }
    options.onChild?.(child);
  });
}

export interface TreeSizesOptions {
  ttlMs?: number;
  now?: () => number;
  platform?: NodeJS.Platform;
  measure?: TreeMeasure;
  isWorktree?: (folder: string) => boolean;
}

export class TreeSizes implements TreeSizeReader {
  readonly #ttlMs: number;
  readonly #now: () => number;
  readonly #platform: NodeJS.Platform;
  readonly #measure: TreeMeasure;
  readonly #isWorktree: (folder: string) => boolean;
  readonly #known = new Map<string, { bytes: number | undefined; at: number }>();
  readonly #queue: string[] = [];
  #running: string | null = null;
  #child: ChildProcess | null = null;
  #disposed = false;

  constructor(options: TreeSizesOptions = {}) {
    this.#ttlMs = options.ttlMs ?? WORKSPACE_TREE_SIZE.TTL_MS;
    this.#now = options.now ?? Date.now;
    this.#platform = options.platform ?? process.platform;
    this.#measure = options.measure ?? ((folder, o) => measureWithDu(folder, o));
    this.#isWorktree =
      options.isWorktree ?? ((folder) => isAbsolute(folder) && existsSync(join(folder, ".git")));
  }

  read(folder: string): number | null | undefined {
    if (this.#platform === "win32" || this.#disposed) return undefined;
    const entry = this.#known.get(folder);
    if (entry === undefined || this.#now() - entry.at >= this.#ttlMs) {
      if (this.#running !== folder && !this.#queue.includes(folder)) this.#queue.push(folder);
      this.#next();
    }
    return entry === undefined ? null : entry.bytes;
  }

  /** Stop: the walk in flight is ended and nothing further starts. */
  dispose(): void {
    this.#disposed = true;
    this.#queue.length = 0;
    this.#child?.kill();
  }

  #next(): void {
    if (this.#running !== null || this.#disposed) return;
    const folder = this.#queue.shift();
    if (folder === undefined) return;
    this.#running = folder;
    const done = (bytes: number | null): void => {
      this.#child = null;
      this.#running = null;
      if (this.#disposed) return;
      this.#known.delete(folder);
      this.#known.set(folder, { bytes: bytes ?? undefined, at: this.#now() });
      while (this.#known.size > WORKSPACE_TREE_SIZE.KEPT) {
        const oldest = this.#known.keys().next().value;
        if (oldest === undefined) break;
        this.#known.delete(oldest);
      }
      this.#next();
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
}
