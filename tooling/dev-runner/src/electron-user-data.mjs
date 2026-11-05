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
 * Carry a dev desk's own state from the folder Electron used before into the one it uses now, ONCE, by copy. Answers what
 * it did: `carried` (the entries copied) and, when it copied nothing, `reason`:
 *  - `same-folder` — the two are one (no move to make);
 *  - `no-old-folder` — nothing was ever there;
 *  - `already-moved` — Chromium has run on the new folder (`Local State`): the move happened before;
 *  - `old-folder-in-use` — the old folder holds a live Electron's lock (`lockHolderAlive`): a live profile is never
 *    copied. A STALE lock (a crashed Electron's, its pid gone on this host) does not stop the carry;
 *  - `nothing-to-carry` — no entry of `CARRIED_ENTRIES` is in the old folder that the new one lacks.
 * An entry the new folder already has is never overwritten. `fs` and `lockAlive` are the seams (node's by default).
 */
export function carryLegacyElectronState({ from, to, fs = nodeFs, lockAlive = lockHolderAlive }) {
  if (from === to) return { carried: [], reason: "same-folder" };
  if (!present(fs, from)) return { carried: [], reason: "no-old-folder" };
  if (present(fs, join(to, CHROMIUM_RAN))) return { carried: [], reason: "already-moved" };
  const lock = join(from, LIVE_LOCK);
  if (present(fs, lock) && lockAlive(lockTarget(fs, lock)))
    return { carried: [], reason: "old-folder-in-use" };
  const carried = [];
  for (const name of CARRIED_ENTRIES) {
    const source = join(from, name);
    const target = join(to, name);
    if (!present(fs, source) || present(fs, target)) continue;
    fs.cpSync(source, target, {
      recursive: true,
      force: false,
      errorOnExist: false,
      preserveTimestamps: true,
      verbatimSymlinks: true,
    });
    carried.push(name);
  }
  return carried.length === 0 ? { carried, reason: "nothing-to-carry" } : { carried };
}

/** The runner's one line for what the carry did (none for a run with nothing to say). */
export function carryWords(result, { from, to }) {
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
