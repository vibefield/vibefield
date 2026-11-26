import { createHash } from "node:crypto";
import {
  closeSync,
  constants,
  type Dirent,
  fchmodSync,
  fstatSync,
  lstatSync,
  mkdirSync,
  openSync,
  readdirSync,
  rmSync,
  type Stats,
  unlinkSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { PAGES_STILLS_MAX_AGE_MS } from "@vibefield/contracts";

// EY-2 (2b, 2026-11-19) — where a run's stills rest: a PRIVATE folder per run, under fieldd's own state, never the run's
// working folder. The root and each run's folder are real directories of fieldd's own: read without following a link,
// held to fieldd's uid, and kept 0700. A run's folder is named by a hash of its run, so nothing a run is called reaches a
// path. The room bounds each run's stills by what its folder holds, so a restart forgets nothing.
//
// PRIVATE means out of the run's working folder and out of other OS users' reach, NOT out of another run of the same
// person's: an agent runs as the person's own uid (EL7), so it can list the root and read any run's stills, and a
// folder's name hides nothing. Real separation needs an agent sandbox or a second uid, which this does not provide.
// What the keeper does hold: a run's folder holds only that run's stills, and the room answers a still only when it is
// a file of fieldd's own directly in the asking run's folder (`holds`), so no answer names another run's folder.
//
// A folder goes when its run's record is forgotten, or once its newest still is older than PAGES_STILLS_MAX_AGE_MS
// (swept at fieldd's start and once a day). Not at the run's end: a resume continues the session in a new run, and the
// conversation still names the old run's stills, while fieldd cannot yet tell a session over for good. Each removal stays
// inside the root and runs inside its one audit line, told by its folder's hash, count and bytes, never a path or a
// picture.

/** The room's view of the keeper. */
export interface PagesStillsPort {
  /** The run's folder, made at its first still; throws when it cannot be fieldd's own. */
  folderFor(run: string): string;
  /** The bytes the run's stills hold now (its folder's regular files). */
  used(run: string): number;
  /** The still main named is the run's own: a file fieldd's uid can read, directly in the run's folder. */
  holds(run: string, file: string): boolean;
}

/** One folder to remove: why, which (its hashed name, never a path), and how much it holds. */
export interface PagesStillsRemoval {
  readonly why: "forgotten" | "age";
  readonly folder: string;
  readonly files: number;
  readonly bytes: number;
}

export interface PagesStillsOptions {
  /** LAYOUT.PAGES_STILLS_DIR under fieldd's state */
  readonly root: string;
  /** whose the folders must be: fieldd's own uid */
  readonly uid?: number;
  readonly now?: () => number;
  /** runs each removal inside the daemon's one audit line for it; with none, the removal runs alone */
  readonly audited?: (removal: PagesStillsRemoval, remove: () => void) => Promise<void>;
}

const PRIVATE = 0o700;
const DAY_MS = 24 * 60 * 60 * 1000;

const notOwn = (): Error => new Error("the stills folder is not a real directory of fieldd's own");

/** A folder of fieldd's own: a real directory (a link at its name is never followed), its uid's, and 0700. Read by
 * its name without following, then opened without following and held to be the same folder, so a link put in its place
 * between the two is refused, never followed; the mode is set on what was opened. */
function ownFolder(path: string, uid: number | undefined): void {
  let seen: Stats;
  try {
    seen = lstatSync(path);
  } catch {
    throw notOwn();
  }
  if (!seen.isDirectory() || (uid !== undefined && seen.uid !== uid)) throw notOwn();
  // Windows keeps no POSIX mode: the folder's place in the user's own profile is its guard there
  if (process.platform === "win32") return;
  let fd: number;
  try {
    fd = openSync(path, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
  } catch {
    throw notOwn();
  }
  try {
    const opened = fstatSync(fd);
    if (!opened.isDirectory() || opened.dev !== seen.dev || opened.ino !== seen.ino) throw notOwn();
    if ((opened.mode & 0o777) !== PRIVATE) fchmodSync(fd, PRIVATE);
  } finally {
    closeSync(fd);
  }
}

/** Read only, never set: a real directory (not a link) of the uid's, and 0700 (Windows keeps no POSIX mode). */
function isOwnFolder(path: string, uid: number | undefined): boolean {
  let seen: Stats;
  try {
    seen = lstatSync(path);
  } catch {
    return false;
  }
  if (!seen.isDirectory() || (uid !== undefined && seen.uid !== uid)) return false;
  return process.platform === "win32" || (seen.mode & 0o777) === PRIVATE;
}

/** A folder's regular files, each by its lstat (a link inside is never followed, and never counted). */
function filesIn(path: string): Stats[] {
  let entries: Dirent[];
  try {
    entries = readdirSync(path, { withFileTypes: true });
  } catch {
    return [];
  }
  const files: Stats[] = [];
  for (const entry of entries) {
    if (!entry.isFile()) continue;
    try {
      files.push(lstatSync(join(path, entry.name)));
    } catch {
      // gone since the listing
    }
  }
  return files;
}

export class PagesStills implements PagesStillsPort {
  readonly #root: string;
  readonly #uid: number | undefined;
  readonly #now: () => number;
  readonly #audited: (removal: PagesStillsRemoval, remove: () => void) => Promise<void>;

  constructor(opts: PagesStillsOptions) {
    this.#root = opts.root;
    this.#uid = opts.uid;
    this.#now = opts.now ?? Date.now;
    this.#audited = opts.audited ?? (async (_removal, remove) => remove());
  }

  /** A run's folder name: a hash, so the run's id never reaches a path. */
  static nameOf(run: string): string {
    return createHash("sha256").update(run, "utf8").digest("hex").slice(0, 32);
  }

  folderFor(run: string): string {
    mkdirSync(this.#root, { recursive: true, mode: PRIVATE });
    ownFolder(this.#root, this.#uid);
    const path = join(this.#root, PagesStills.nameOf(run));
    try {
      mkdirSync(path, { mode: PRIVATE });
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "EEXIST") throw err;
    }
    ownFolder(path, this.#uid);
    return path;
  }

  used(run: string): number {
    return filesIn(join(this.#root, PagesStills.nameOf(run))).reduce(
      (sum, file) => sum + file.size,
      0,
    );
  }

  /** A regular file (never a link, with one name) of fieldd's uid that the uid can read, directly in the run's folder,
   * that folder and the root each a real 0700 directory of the uid. Read only: nothing is made or set. */
  holds(run: string, file: string): boolean {
    const folder = join(this.#root, PagesStills.nameOf(run));
    if (dirname(file) !== folder) return false;
    if (!isOwnFolder(this.#root, this.#uid) || !isOwnFolder(folder, this.#uid)) return false;
    let seen: Stats;
    try {
      seen = lstatSync(file);
    } catch {
      return false;
    }
    if (!seen.isFile() || seen.nlink !== 1) return false;
    if (this.#uid !== undefined && seen.uid !== this.#uid) return false;
    return process.platform === "win32" || (seen.mode & 0o400) !== 0;
  }

  /** The run's record is forgotten: so is its folder. */
  async forget(run: string): Promise<void> {
    if (!this.#rootStands()) return;
    await this.#remove(PagesStills.nameOf(run), "forgotten");
  }

  /** Every folder whose newest still (or, holding none, the folder itself) is older than the bound goes. One that
   * cannot go now (its audit line would not write) is left for the next sweep. */
  async sweep(): Promise<void> {
    if (!this.#rootStands()) return;
    const oldest = this.#now() - PAGES_STILLS_MAX_AGE_MS;
    let entries: Dirent[];
    try {
      entries = readdirSync(this.#root, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      // only a folder of the keeper's own naming; anything else in the root is left as it is
      if (!entry.isDirectory() || !/^[0-9a-f]{32}$/.test(entry.name)) continue;
      const path = join(this.#root, entry.name);
      let folder: Stats;
      try {
        folder = lstatSync(path);
      } catch {
        continue;
      }
      const newest = filesIn(path).reduce((at, file) => Math.max(at, file.mtimeMs), folder.mtimeMs);
      if (newest >= oldest) continue;
      try {
        await this.#remove(entry.name, "age");
      } catch {
        // left for the next sweep
      }
    }
  }

  /** The sweep at once (`swept`) and then daily, until `stop`. */
  startSweeps(): { readonly swept: Promise<void>; stop(): void } {
    const swept = this.sweep().catch(() => undefined);
    const timer = setInterval(() => void this.sweep().catch(() => undefined), DAY_MS);
    timer.unref?.();
    return { swept, stop: () => clearInterval(timer) };
  }

  #rootStands(): boolean {
    try {
      ownFolder(this.#root, this.#uid);
      return true;
    } catch {
      return false;
    }
  }

  /** One entry of the root, by its name (never a path from outside), removed. A link there is unlinked, never what it
   * names; a folder's removal unlinks every link inside it, never following one, so nothing outside the root moves. */
  async #remove(name: string, why: PagesStillsRemoval["why"]): Promise<void> {
    const path = join(this.#root, name);
    let stat: Stats;
    try {
      stat = lstatSync(path);
    } catch {
      return;
    }
    if (!stat.isDirectory()) {
      unlinkSync(path);
      return;
    }
    const files = filesIn(path);
    await this.#audited(
      {
        why,
        folder: name,
        files: files.length,
        bytes: files.reduce((sum, file) => sum + file.size, 0),
      },
      () => rmSync(path, { recursive: true, force: true }),
    );
  }
}
