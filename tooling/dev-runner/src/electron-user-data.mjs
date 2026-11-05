import * as nodeFs from "node:fs";
import { hostname } from "node:os";
import { join } from "node:path";

// BP-1c (BP-D9 (a)) — the dev runner's Electron userData moved from `.vibefield/dev/electron-user-data` to the dev root
// itself (`paths.mjs` `devLayoutFor`), so the desk browser's profiles under the data root lie inside it. Electron's own
// files therefore start afresh in the dev root. What a developer's desk keeps of its OWN there is carried over ONCE, by
// copy, before the first Electron starts on the new folder; the old folder is never moved, changed or removed (it stays
// as it was, and saying so is the runner's log line).

/**
 * What is carried: the app's theme file (`main/theme.ts` `THEME_FILE`) and the renderer's own storage: localStorage,
 * IndexedDB, the desk's OPFS byte store with the explorer's stills (`File System`), and the quota database that indexes
 * the last two (`WebStorage`). Never a cache (1.2 GB of the old folder's on James's Mac, 2026-11-05: Chromium rebuilds
 * them), never the default session's cookie store (the shell's own sessions hold no page cookies, PT-4), never Chromium's
 * `Local State`, `Preferences` or a lock, and never Crashpad's reports (the old folder keeps them).
 */
export const CARRIED_ENTRIES = Object.freeze([
  "vibefield-theme.json",
  "Local Storage",
  "IndexedDB",
  "File System",
  "WebStorage",
]);

/** The file Chromium writes first in a userData it has run on: once the new folder has one, the move is done. */
const CHROMIUM_RAN = "Local State";
/** The link a running Electron holds in its userData (its single-instance lock; a dev shell takes it). */
const LIVE_LOCK = "SingletonLock";

const present = (fs, path) => {
  try {
    fs.lstatSync(path);
    return true;
  } catch {
    return false;
  }
};

/** Whether a pid answers on this host (`kill(pid, 0)`: EPERM is a live process that is not ours). */
function pidAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error?.code === "EPERM";
  }
}

/**
 * Whether the Electron that holds a userData's `SingletonLock` is alive. Chromium's lock is a symlink whose target is
 * `<hostname>-<pid>`; a crashed Electron leaves it behind. A lock this host's dead process left is STALE (false); one
 * whose target cannot be read, names another host, or names a live pid is taken as live (true): a live profile is never
 * copied. `host` and `alive` are the seams.
 */
export function lockHolderAlive(target, { host = hostname(), alive = pidAlive } = {}) {
  if (typeof target !== "string") return true;
  const dash = target.lastIndexOf("-");
  if (dash <= 0) return true;
  const pid = Number(target.slice(dash + 1));
  if (!Number.isSafeInteger(pid) || pid <= 0) return true;
  if (target.slice(0, dash) !== host) return true;
  return alive(pid);
}

const lockTarget = (fs, path) => {
  try {
    return fs.readlinkSync(path);
  } catch {
    return null;
  }
};

/**
 * Where an entry is copied before it takes its name: a dot-named sibling in the new folder (the same filesystem, so taking
 * the name is one rename). An entry is in the new folder WHOLE or not at all: a copy that fails partway (a full disk, a
 * file it may not read) is discarded, and one a stopped runner left behind is cleared before the carry does anything else.
 * The carry runs once (`already-moved`), so a half-copied LevelDB or OPFS store would never be repaired: Chromium would
 * open it as corrupt.
 */
export const STAGING_PREFIX = ".bp1c-carry-";

/** Remove a staging copy, never throwing (one that will not go is dot-named, and Chromium never reads it). */
const discard = (fs, path) => {
  try {
    fs.rmSync(path, { recursive: true, force: true });
  } catch {
    /* the loop below refuses to copy into it */
  }
};

const messageOf = (error) => (error instanceof Error ? error.message : String(error));

/**
 * Carry a dev desk's own state from the folder Electron used before into the one it uses now, ONCE, by copy. Answers what
 * it did: `carried` (the entries copied), `failed` (when any entry could not be: `{ name, error }` each, the entry absent
 * from the new folder), and, when it copied nothing and nothing failed, `reason`:
 *  - `same-folder` — the two are one (no move to make);
 *  - `no-old-folder` — nothing was ever there;
 *  - `already-moved` — Chromium has run on the new folder (`Local State`): the move happened before;
 *  - `old-folder-in-use` — the old folder holds a live Electron's lock (`lockHolderAlive`): a live profile is never
 *    copied. A STALE lock (a crashed Electron's, its pid gone on this host) does not stop the carry;
 *  - `nothing-to-carry` — no entry of `CARRIED_ENTRIES` is in the old folder that the new one lacks.
 * An entry the new folder already has is never overwritten, and each one is copied to its staging name first and renamed
 * into place only once whole (`STAGING_PREFIX`). `fs` and `lockAlive` are the seams (node's by default).
 */
export function carryLegacyElectronState({ from, to, fs = nodeFs, lockAlive = lockHolderAlive }) {
  if (from === to) return { carried: [], reason: "same-folder" };
  if (!present(fs, from)) return { carried: [], reason: "no-old-folder" };
  const staging = (name) => join(to, `${STAGING_PREFIX}${name}`);
  // a runner stopped mid-copy left its staging copies: cleared whatever this run then does
  for (const name of CARRIED_ENTRIES) discard(fs, staging(name));
  if (present(fs, join(to, CHROMIUM_RAN))) return { carried: [], reason: "already-moved" };
  const lock = join(from, LIVE_LOCK);
  if (present(fs, lock) && lockAlive(lockTarget(fs, lock)))
    return { carried: [], reason: "old-folder-in-use" };
  const carried = [];
  const failed = [];
  for (const name of CARRIED_ENTRIES) {
    const source = join(from, name);
    const target = join(to, name);
    const stage = staging(name);
    if (!present(fs, source) || present(fs, target)) continue;
    if (present(fs, stage)) {
      // never copied INTO a staging copy that would not go: the two would merge
      failed.push({ name, error: `its staging copy ${stage} could not be cleared` });
      continue;
    }
    try {
      fs.cpSync(source, stage, {
        recursive: true,
        force: false,
        errorOnExist: false,
        preserveTimestamps: true,
        verbatimSymlinks: true,
      });
      fs.renameSync(stage, target);
      carried.push(name);
    } catch (error) {
      discard(fs, stage);
      failed.push({ name, error: messageOf(error) });
    }
  }
  if (failed.length > 0) return { carried, failed };
  return carried.length === 0 ? { carried, reason: "nothing-to-carry" } : { carried };
}

/** The runner's one line for what the carry did (none for a run with nothing to say). A carry with a `failed` entry is
 * the runner's warning: it names what could not come across, which starts afresh in the new folder. */
export function carryWords(result, { from, to }) {
  if (result.failed !== undefined && result.failed.length > 0) {
    const came = result.carried.length > 0 ? `carried ${result.carried.join(", ")}; ` : "";
    const lost = result.failed.map((f) => `${f.name} (${f.error})`).join(", ");
    return `BP-1c: Electron's userData is now ${to}; ${came}could not carry ${lost} from ${from}, so ${result.failed.length === 1 ? "it starts" : "they start"} afresh in the new folder (nothing half-copied is left there), and the old folder is left as it was`;
  }
  if (result.carried.length > 0) {
    return `BP-1c: Electron's userData is now ${to} (the desk browser keeps its sign-ins there); carried ${result.carried.join(", ")} from ${from}, which is left as it was`;
  }
  if (result.reason === "old-folder-in-use") {
    // never a promise of a later carry: this run's Electron writes `Local State` in the new folder, and a carry happens
    // only before Chromium has run there (`already-moved`)
    return `BP-1c: Electron's userData is now ${to}; ${from} holds a running Electron's lock, so nothing was carried from it (the theme and the renderer's storage start afresh in the new folder), and the old folder is left as it was`;
  }
  if (result.reason === "nothing-to-carry") {
    return `BP-1c: Electron's userData is now ${to}; ${from} is left as it was (nothing of the desk's own to carry)`;
  }
  return null;
}
