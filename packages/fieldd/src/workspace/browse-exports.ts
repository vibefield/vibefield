import { existsSync, readdirSync, realpathSync, statSync } from "node:fs";
import { homedir, userInfo } from "node:os";
import { posix, win32 } from "node:path";
import { isExcludedRoot } from "./paths";

// FS-1a (L2; `thinking-files-service.md` §6, FS-D4 as amended 2026-10-05 by
// James's SFTP note) — the BROWSE exports: the home directory and each mounted
// volume, so a picker can walk the desktop's filesystem the way SFTP does.
// ONE enumerator for every platform, its filesystem behind seams so each
// platform's rule is a fixture test on any machine:
//
//   macOS    /Volumes/* — less the boot volume's alias of `/` (its real path
//            IS `/`) and dot-entries (`.timemachine` and kin)
//   Linux    /media/$USER/* and /mnt/*
//   Windows  each drive letter C:\ … Z:\ that answers
//
// Never `/System`, `/Library`, `/private` (`isExcludedRoot`, on the REAL
// path). Enumerated LIVE at every ask — a volume that unmounts is simply not
// there; it is not a folder that vanished (a place is, and keeps `missing`).

export interface BrowseExport {
  path: string;
  browse: "home" | "volume";
}

/** The filesystem the enumerator reads (a fixture test's seams). */
export interface BrowseFs {
  readdir(path: string): string[];
  realpath(path: string): string;
  isDirectory(path: string): boolean;
  exists(path: string): boolean;
}

export const NODE_BROWSE_FS: BrowseFs = {
  readdir: (path) => readdirSync(path),
  realpath: (path) => realpathSync(path),
  isDirectory: (path) => {
    try {
      return statSync(path).isDirectory();
    } catch {
      return false;
    }
  },
  exists: (path) => existsSync(path),
};

export interface BrowseFacts {
  platform: NodeJS.Platform;
  home: string;
  /** the OS user's login name (Linux mounts removable media under it) */
  user: string;
  fs: BrowseFs;
}

export function ownBrowseFacts(): BrowseFacts {
  let user = "";
  try {
    user = userInfo().username;
  } catch {
    // no login name: /media/<user> is not read
  }
  return { platform: process.platform, home: homedir(), user, fs: NODE_BROWSE_FS };
}

function childDirectories(
  fs: BrowseFs,
  parent: string,
  join: (a: string, b: string) => string,
): string[] {
  let names: string[];
  try {
    names = fs.readdir(parent);
  } catch {
    return [];
  }
  return names
    .filter((name) => !name.startsWith("."))
    .sort((a, b) => a.localeCompare(b))
    .map((name) => join(parent, name))
    .filter((path) => fs.isDirectory(path));
}

function realOrNull(fs: BrowseFs, path: string): string | null {
  try {
    return fs.realpath(path);
  } catch {
    return null;
  }
}

/** The browse exports, home first, then the volumes by name. */
export function enumerateBrowseExports(facts: BrowseFacts): BrowseExport[] {
  const { fs, platform } = facts;
  const out: BrowseExport[] = [];
  const seen = new Set<string>();
  const admit = (path: string, browse: BrowseExport["browse"]): void => {
    const real = realOrNull(fs, path);
    if (real === null || seen.has(real) || isExcludedRoot(real, platform)) return;
    seen.add(real);
    out.push({ path, browse });
  };
  if (facts.home.length > 0 && fs.isDirectory(facts.home)) admit(facts.home, "home");
  if (platform === "darwin") {
    // the boot volume's alias (`Macintosh HD` → `/`) is refused by its real
    // path inside `admit` (the filesystem's root is never an export)
    for (const volume of childDirectories(fs, "/Volumes", posix.join)) admit(volume, "volume");
  } else if (platform === "win32") {
    for (let code = "C".charCodeAt(0); code <= "Z".charCodeAt(0); code += 1) {
      const drive = `${String.fromCharCode(code)}:\\`;
      if (fs.exists(drive) && fs.isDirectory(drive)) admit(drive, "volume");
    }
  } else {
    const media =
      facts.user.length > 0
        ? childDirectories(fs, posix.join("/media", facts.user), posix.join)
        : [];
    for (const volume of [...media, ...childDirectories(fs, "/mnt", posix.join)])
      admit(volume, "volume");
  }
  return out;
}

/** The path module for a platform's paths (the registry's, the worker's). */
export function pathFor(platform: NodeJS.Platform): typeof posix {
  return platform === "win32" ? win32 : posix;
}
