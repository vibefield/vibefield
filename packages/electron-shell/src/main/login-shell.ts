import { homedir, userInfo } from "node:os";

// The user's shell and home, which only main can read (GT-D10).
//
// Since the workspace owns pane births, its `platform.defaultShell` and
// `initialCwd` are what every pane is spawned with — so these two values ARE
// the product's shell policy, and a sandboxed renderer cannot see either one.
// Main resolves them and answers them on the terminal connect.
//
// ghosttea desktop resolves the same thing in its preload (apps/desktop/src/
// preload/index.ts:34) as `SHELL ?? "/bin/zsh"`. This adds one rung: a GUI app
// on macOS is not always launched from a shell, and `SHELL` can be absent in
// exactly that case — the passwd entry still knows, so it is asked before the
// constant is. The constant remains, because a passwd entry can be empty too
// and an honest guess beats an exception.

/** What a pane is born with. Both fields are always answerable: the ladder
 * below ends in a constant rather than an error. */
export interface ShellIdentity {
  /** absolute path to the user's real login shell — never `/bin/sh` */
  defaultShell: string;
  /** `$HOME`, which becomes the workspace's `initialCwd` */
  home: string;
}

/** The last-resort shells, per platform. macOS has shipped zsh as the default
 * since Catalina and Linux distributions overwhelmingly ship it or bash; either
 * way this rung is reached only when both the environment and the passwd entry
 * are silent, which is rarer than it is impossible. */
const FALLBACK_SHELL = "/bin/zsh";
const FALLBACK_COMSPEC = "powershell.exe";

const nonEmpty = (value: string | undefined | null): string | undefined => {
  const trimmed = value?.trim();
  return trimmed !== undefined && trimmed !== "" ? trimmed : undefined;
};

/** The resolution, with its two inputs injected so the ladder is testable
 * without mutating `process.env` or owning a second passwd entry. */
export function resolveShellIdentity(
  env: NodeJS.ProcessEnv,
  info: { shell?: string | null; homedir: string },
  platform: NodeJS.Platform,
): ShellIdentity {
  const home = nonEmpty(info.homedir) ?? nonEmpty(env["HOME"]) ?? "/";
  if (platform === "win32") {
    return { defaultShell: nonEmpty(env["COMSPEC"]) ?? FALLBACK_COMSPEC, home };
  }
  return {
    defaultShell: nonEmpty(env["SHELL"]) ?? nonEmpty(info.shell) ?? FALLBACK_SHELL,
    home,
  };
}

/** Memoized: the answer cannot change under a running app (a shell chosen in
 * System Settings takes effect at the next login), and re-reading the passwd
 * database on every window's connect would be a syscall spent on a constant. */
let cached: ShellIdentity | undefined;

export function shellIdentity(): ShellIdentity {
  if (cached === undefined) {
    // `userInfo()` types `shell` as `string | null` and answers null on
    // platforms without a passwd entry — Windows among them, where the branch
    // above never reads it anyway.
    cached = resolveShellIdentity(
      process.env,
      { shell: userInfo().shell, homedir: homedir() },
      process.platform,
    );
  }
  return cached;
}

// ── ESP-18 (item 341): the pair's PATH ──
//
// A Mac app opened from the Dock, the Finder or its updater inherits launchd's
// short PATH, and a pair spawned with it finds no agent. In `production` mode
// main asks the person's login shell for PATH once, from its start, and a
// pair's SPAWN awaits the answer (the supervisor's `spawnEnvironment`): the
// window and an adoption never wait on it. The pair gets that one key (ESP
// §5.1). SLICE 2 (red): the names and types below are final; their bodies are
// not built yet.

/** The mark the login shell prints its PATH between. An rc file's banner,
 * prompt or error before or after the two marks is never read. */
export const PERSON_PATH_MARK = "__VIBEFIELD_PERSON_PATH__";

/** How long the login shell is given before the fallback answers. */
export const PERSON_PATH_CEILING_MS = 3_000;

/** The most of the login shell's stdout ever held, enforced while it is read:
 * the chunk that reaches it is cut there, the child's group is ended, and what
 * still arrives is drained and dropped. */
export const PERSON_PATH_STDOUT_CAP = 64 * 1024;

export type PersonPathSource = "login-shell" | "fallback";
export type PersonPathWhy = "timeout" | "exit" | "no-mark" | "unsupported-shell" | "spawn-failed";

/** The answer: the PATH a pair is spawned with, and how it was come by. */
export interface PersonPath {
  /** the directories, `:`-joined */
  path: string;
  source: PersonPathSource;
  /** why the fallback answered; absent for `login-shell` */
  why?: PersonPathWhy;
  dirs: number;
  ms: number;
}

/** A spawned login shell, as the resolve sees it. */
export interface PersonPathChild {
  /** settles on the child's close, when it has exited AND every process that
   * held its stdout (its group's) has let go: its code (null after a signal)
   * and its stdout, at most PERSON_PATH_STDOUT_CAP bytes */
  done: Promise<{ code: number | null; stdout: string }>;
  /** ends the child's whole process group */
  killGroup(): void;
}

export type PersonPathSpawn = (
  shell: string,
  args: readonly string[],
  env: Readonly<Record<string, string>>,
) => PersonPathChild;

/** The one event the resolve says, and nothing of the PATH itself. */
export interface PersonPathLog {
  info(
    event: string,
    message: string,
    attrs?: { source: PersonPathSource; why?: PersonPathWhy; dirs: number; ms: number },
  ): void;
}

export interface ResolvePersonPathOptions {
  /** the shell's mode; only `"production"` resolves */
  mode: string;
  platform: NodeJS.Platform;
  /** the login shell, `shellIdentity().defaultShell` */
  shell: string;
  /** `$HOME`, for the fallback's `~/.local/bin` */
  home: string;
  /** main's environment, before the child's is made from it */
  env: Readonly<Record<string, string | undefined>>;
  spawn: PersonPathSpawn;
  exists: (path: string) => boolean;
  now: () => number;
  log: PersonPathLog;
  /** VibeField's own launcher directories, never handed back */
  shimDirectories: readonly string[];
  ceilingMs?: number;
}

const NOT_BUILT = "item 341: not built yet";

/** The login shell's argv for its PATH, or undefined for a shell it is never asked of. */
export function personPathCommand(_shell: string): readonly string[] | undefined {
  throw new Error(NOT_BUILT);
}

/** The directories between the two marks, as kept; undefined when there is no usable answer. */
export function parsePersonPath(
  _stdout: string,
  _opts: { shimDirectories: readonly string[] },
): string[] | undefined {
  throw new Error(NOT_BUILT);
}

/** The child's environment: main's, minus VibeField's own variables, with no history file. */
export function personPathChildEnvironment(
  _env: Readonly<Record<string, string | undefined>>,
): Record<string, string> {
  throw new Error(NOT_BUILT);
}

/** main's own PATH, then the common install folders that exist. */
export function fallbackPersonPath(
  _mainPath: string | undefined,
  _home: string,
  _exists: (path: string) => boolean,
): string[] {
  throw new Error(NOT_BUILT);
}

/** The person's PATH for a pair, or undefined where the mode or platform keeps its own. */
export async function resolvePersonPath(
  _opts: ResolvePersonPathOptions,
): Promise<PersonPath | undefined> {
  throw new Error(NOT_BUILT);
}

/** One answer per shell process: every pair and every respawn reuses the first. */
export function personPathOnce(
  _resolve: () => Promise<PersonPath | undefined>,
): () => Promise<PersonPath | undefined> {
  throw new Error(NOT_BUILT);
}

/** The production spawn: the login shell detached in its own process group. */
export const spawnPersonPathChild: PersonPathSpawn = () => {
  throw new Error(NOT_BUILT);
};
