// Item 252 (2026-11-08): the repo's files as git sees them, for the scans that read the tree:
// `check-import-boundaries.mjs` (preflight and `check:walls`) and `check-test-temp-roots.mjs`
// (`check:walls`), and their self-tests, whose fixture roots are temp repositories of their own.
//
// A walk of the directory tree reads what git ignores, unless its skip list happens to name it.
// After the EL8 to rosetta 0.1.5, `swift package resolve` checks rosetta's whole repository out
// under `apps/ios/VibeFieldKit/.build/checkouts/rosetta/`, and run224's preflight read 134 wall
// violations there (R22 113, R24 21), none of them this repo's. Git's listing is the rule
// instead: the tracked files and the untracked ones git does not ignore, so a new file is read
// before it is staged, and no ignored tree is read, whatever its name.
import { execFileSync } from "node:child_process";
import { lstatSync } from "node:fs";
import { join } from "node:path";

// git's repo-local variables (`git rev-parse --local-env-vars`, git 2.50). Inherited, a hook's
// GIT_INDEX_FILE or an exported GIT_DIR would aim a run in a temp repository at the outer one.
const LOCAL_GIT_ENV = [
  "GIT_ALTERNATE_OBJECT_DIRECTORIES",
  "GIT_CONFIG",
  "GIT_CONFIG_PARAMETERS",
  "GIT_CONFIG_COUNT",
  "GIT_OBJECT_DIRECTORY",
  "GIT_DIR",
  "GIT_WORK_TREE",
  "GIT_IMPLICIT_WORK_TREE",
  "GIT_GRAFT_FILE",
  "GIT_INDEX_FILE",
  "GIT_NO_REPLACE_OBJECTS",
  "GIT_REPLACE_REF_BASE",
  "GIT_PREFIX",
  "GIT_SHALLOW_FILE",
  "GIT_COMMON_DIR",
];

/** `git <args>` in `cwd` without the repo-local variables; its stdout. It throws on a non-zero
 * exit. */
export function git(cwd, args) {
  const env = { ...process.env };
  for (const name of LOCAL_GIT_ENV) delete env[name];
  return execFileSync("git", args, {
    cwd,
    env,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
    stdio: ["ignore", "pipe", "pipe"],
  });
}

/** The files of the git work tree at `root`, as `/`-separated paths relative to it, sorted: the
 * tracked ones and the untracked ones git does not ignore (`--others --exclude-standard`), each a
 * regular file in the tree now. A tracked file deleted from the tree is left out, and a link is
 * never followed, as the walks this replaces followed none. */
export function repoFiles(root) {
  const listed = git(root, ["ls-files", "--cached", "--others", "--exclude-standard", "-z"]);
  const files = new Set();
  for (const rel of listed.split("\0")) {
    if (rel === "" || files.has(rel)) continue;
    try {
      if (lstatSync(join(root, rel)).isFile()) files.add(rel);
    } catch {
      // deleted from the tree, not yet staged
    }
  }
  return [...files].sort();
}
