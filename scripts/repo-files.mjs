// Item 252 (2026-11-08): git, run so that a hook's or a parent's environment never points it at
// another repository, for the scans that read the tree (`check-import-boundaries.mjs`, in preflight
// and `check:walls`, and `check-test-temp-roots.mjs`, in `check:walls`) and their self-tests, whose
// fixture roots are temp repositories of their own.
import { execFileSync } from "node:child_process";

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
