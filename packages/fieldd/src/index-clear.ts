import { mkdirSync, readdirSync, renameSync } from "node:fs";
import { rm } from "node:fs/promises";
import { join } from "node:path";

// HD-1 — WHAT `index.clear` DOES TO THE DISK. The index directory (`LAYOUT.INDEX_DIR`, per user root) holds two
// owners' files: fieldd's own (the enrollment record and what it sets aside, the announce directory, the per-start
// credentials) and everything else, which is rosettad's: its projection with SQLite's journals, its ledger and the
// staged one a cold import keeps for its next start, its search and media sidecars, its receipts, its lock, what a
// recovery kept. rosetta names its files in its own repo and adds to them between releases (a sidecar a release, so
// far), so the rule here is the one that needs no list of them: WHAT IS NOT FIELDD'S IS ROSETTAD'S, AND GOES.
//
// It goes in two steps. With no rosettad running (the caller's promise: the supervisor holds the daemon down), every
// entry of rosettad's is renamed into one fresh folder inside the directory. Renames within one directory are quick
// and each is whole or not at all, so the daemon that starts next finds no projection, however large the old one was.
// The folder is then removed, which for a long history is thousands of media files and may take a while; a fieldd
// that dies before the end leaves the folder, and the next clear or the next start removes it (`removeCleared`).

/** The folder a clear moves rosettad's files into: `.cleared-<ms>` inside the index directory. */
const CLEARED_PREFIX = ".cleared-";

export interface IndexFiles {
  /** the index directory, absolute (`LAYOUT.INDEX_DIR` under the user root) */
  readonly dir: string;
  /** fieldd's own entries in it, by name: they stay. An entry whose name starts with a kept name and a dot stays
   * too (the record's `enrollment.json.unreadable-<ms>` asides, its `.tmp`). */
  readonly keep: readonly string[];
}

function kept(files: IndexFiles, name: string): boolean {
  return files.keep.some((own) => name === own || name.startsWith(`${own}.`));
}

function entries(dir: string): string[] {
  try {
    return readdirSync(dir);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
}

/** Move everything of rosettad's out of the daemon's sight. Answers the folder it went into, or null when the
 * directory held nothing of rosettad's. A rename that fails puts back what was already moved and throws: the daemon
 * that starts next then finds its files as they were. Synchronous: nothing else of fieldd's runs between two moves. */
export function setIndexAside(files: IndexFiles, now: number = Date.now()): string | null {
  const names = entries(files.dir).filter(
    (name) => !kept(files, name) && !name.startsWith(CLEARED_PREFIX),
  );
  if (names.length === 0) return null;
  const aside = join(files.dir, `${CLEARED_PREFIX}${now}`);
  mkdirSync(aside, { recursive: true, mode: 0o700 });
  const moved: string[] = [];
  try {
    for (const name of names) {
      renameSync(join(files.dir, name), join(aside, name));
      moved.push(name);
    }
  } catch (error) {
    for (const name of moved.reverse()) {
      try {
        renameSync(join(aside, name), join(files.dir, name));
      } catch {
        // it stays in the folder, which the next clear removes
      }
    }
    throw error;
  }
  return aside;
}

/** Remove every folder a clear left in the index directory: this clear's, and one a fieldd that died left. */
export async function removeCleared(files: IndexFiles): Promise<void> {
  for (const name of entries(files.dir)) {
    if (!name.startsWith(CLEARED_PREFIX)) continue;
    await rm(join(files.dir, name), { recursive: true, force: true });
  }
}
