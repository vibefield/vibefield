import { spawn } from "node:child_process";
import { homedir, userInfo } from "node:os";
import { basename, join } from "node:path";

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
// §5.1). Nothing of the shell's stdout or of the PATH's value reaches a log, an
// error or a thrown text: the one event carries a reason code, a count and a
// duration.

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

/** VibeField's own variables (EL7): the login shell's child inherits none of them. */
const OWN_PREFIXES = ["FIELD_", "FIELDD_", "VIBEFIELD_", "VF_"];

/** The shells asked, by name: these three take the same command; fish its own. */
const POSIX_SHELLS = new Set(["zsh", "bash", "ksh"]);

/** The common install folders the fallback adds after main's own PATH, where they exist. */
const COMMON_FOLDERS = ["/opt/homebrew/bin", "/usr/local/bin"];

const MAX_ENTRIES = 256;
const MAX_BYTES = 16 * 1024;

/** A C0 control or DEL anywhere in an entry, which no directory a person meant has. */
function hasControl(entry: string): boolean {
  for (let index = 0; index < entry.length; index += 1) {
    const code = entry.charCodeAt(index);
    if (code < 0x20 || code === 0x7f) return true;
  }
  return false;
}

const withoutTrailingSlash = (path: string): string =>
  path.length > 1 && path.endsWith("/") ? path.slice(0, -1) : path;

/** The entries kept, in order: absolute, free of controls, first of equals, no shim directory,
 * at most MAX_ENTRIES and MAX_BYTES once `:`-joined. */
function keepDirectories(entries: readonly string[], shims: readonly string[]): string[] {
  const shimSet = new Set(shims.map(withoutTrailingSlash));
  const seen = new Set<string>();
  const kept: string[] = [];
  let bytes = 0;
  for (const entry of entries) {
    if (kept.length === MAX_ENTRIES) break;
    if (!entry.startsWith("/") || hasControl(entry) || seen.has(entry)) continue;
    if (shimSet.has(withoutTrailingSlash(entry))) continue;
    const added = Buffer.byteLength(entry, "utf8") + (kept.length > 0 ? 1 : 0);
    if (bytes + added > MAX_BYTES) break;
    seen.add(entry);
    kept.push(entry);
    bytes += added;
  }
  return kept;
}

/** The login shell's argv for its PATH, or undefined for a shell it is never asked of. */
export function personPathCommand(shell: string): readonly string[] | undefined {
  const name = basename(shell);
  const mark = PERSON_PATH_MARK;
  const ask = `printf %s ${mark}; /usr/bin/printenv PATH; printf %s ${mark}`;
  if (POSIX_SHELLS.has(name)) return ["-l", "-i", "-c", `unset HISTFILE; ${ask}`];
  if (name === "fish") return ["-l", "-i", "-c", `set fish_history ''; ${ask}`];
  return undefined;
}

/** The directories between the two marks, as kept; undefined when there is no usable answer. */
export function parsePersonPath(
  stdout: string,
  opts: { shimDirectories: readonly string[] },
): string[] | undefined {
  const first = stdout.indexOf(PERSON_PATH_MARK);
  if (first < 0) return undefined;
  const from = first + PERSON_PATH_MARK.length;
  const second = stdout.indexOf(PERSON_PATH_MARK, from);
  if (second < 0) return undefined;
  const between = stdout.slice(from, second).trim();
  const kept = keepDirectories(between.split(":"), opts.shimDirectories);
  return kept.length > 0 ? kept : undefined;
}

/** The child's environment: main's, minus VibeField's own variables, with no history file. */
export function personPathChildEnvironment(
  env: Readonly<Record<string, string | undefined>>,
): Record<string, string> {
  const kept: Record<string, string> = {};
  for (const [key, value] of Object.entries(env)) {
    if (value === undefined || OWN_PREFIXES.some((prefix) => key.startsWith(prefix))) continue;
    kept[key] = value;
  }
  return { ...kept, HISTFILE: "/dev/null", TERM: "dumb" };
}

/** main's own PATH, then the common install folders that exist. */
export function fallbackPersonPath(
  mainPath: string | undefined,
  home: string,
  exists: (path: string) => boolean,
): string[] {
  const local = join(home, ".local", "bin");
  const folders = [...COMMON_FOLDERS, local].filter((folder) => exists(folder));
  return keepDirectories([...(mainPath ?? "").split(":"), ...folders], []);
}

/** What asking the login shell came to: its directories, or why the fallback answers. */
type Asked = { dirs: string[] } | { why: PersonPathWhy };

async function askLoginShell(opts: ResolvePersonPathOptions): Promise<Asked> {
  const args = personPathCommand(opts.shell);
  if (args === undefined) return { why: "unsupported-shell" };
  let child: PersonPathChild;
  try {
    child = opts.spawn(opts.shell, args, personPathChildEnvironment(opts.env));
  } catch {
    // the error's words are never kept: they can name the shell's path or the person's folders
    return { why: "spawn-failed" };
  }
  let timer: ReturnType<typeof setTimeout> | undefined;
  const ceiling = new Promise<"ceiling">((resolve) => {
    timer = setTimeout(() => resolve("ceiling"), opts.ceilingMs ?? PERSON_PATH_CEILING_MS);
  });
  try {
    const exit = await Promise.race([child.done, ceiling]);
    if (exit === "ceiling") {
      child.killGroup();
      return { why: "timeout" };
    }
    if (exit.code !== 0) return { why: "exit" };
    const dirs = parsePersonPath(exit.stdout, { shimDirectories: opts.shimDirectories });
    return dirs === undefined ? { why: "no-mark" } : { dirs };
  } catch {
    return { why: "spawn-failed" };
  } finally {
    clearTimeout(timer);
  }
}

/** The person's PATH for a pair, or undefined where the mode or platform keeps its own. Never
 * throws: every way the login shell can fail answers the fallback with its reason. */
export async function resolvePersonPath(
  opts: ResolvePersonPathOptions,
): Promise<PersonPath | undefined> {
  if (opts.mode !== "production" || opts.platform === "win32") return undefined;
  const started = opts.now();
  const asked = await askLoginShell(opts);
  const fallback = () => fallbackPersonPath(opts.env["PATH"], opts.home, opts.exists);
  const dirs = "dirs" in asked ? asked.dirs : keepDirectories(fallback(), opts.shimDirectories);
  const ms = opts.now() - started;
  const source: PersonPathSource = "dirs" in asked ? "login-shell" : "fallback";
  const why = "why" in asked ? { why: asked.why } : {};
  const words =
    source === "login-shell"
      ? "A pair's PATH is the person's, read from their login shell"
      : "A pair's PATH fell back to the app's own and the common install folders";
  opts.log.info("desktop.person_path.resolved", words, { source, ...why, dirs: dirs.length, ms });
  return { path: dirs.join(":"), source, ...why, dirs: dirs.length, ms };
}

/** One answer per shell process: every pair and every respawn reuses the first. */
export function personPathOnce(
  resolve: () => Promise<PersonPath | undefined>,
): () => Promise<PersonPath | undefined> {
  let once: Promise<PersonPath | undefined> | undefined;
  return () => {
    once ??= resolve();
    return once;
  };
}

/** The production spawn: the login shell detached in its own process group, with no stdin and
 * no stderr. At most PERSON_PATH_STDOUT_CAP bytes of its stdout are held: the chunk that reaches
 * the cap is cut, the group is ended, and what still arrives is drained and dropped, so `done`
 * settles on the close, once every process holding the stdout has let go of it. */
export const spawnPersonPathChild: PersonPathSpawn = (shell, args, env) => {
  const child = spawn(shell, [...args], {
    env,
    stdio: ["ignore", "pipe", "ignore"],
    detached: true,
  });
  // the group of THIS child alone, the one this call spawned detached: never a pid read from
  // anywhere else, and never one that is unknown or 1 or below (`kill(-1)` is every process)
  const killGroup = (): void => {
    const pid = child.pid;
    if (pid === undefined || pid <= 1) return;
    try {
      process.kill(-pid, "SIGKILL");
    } catch {
      // ESRCH: the group is already gone; nothing else is left to do from here
    }
  };
  const kept: Buffer[] = [];
  let held = 0;
  let capped = false;
  child.stdout?.on("data", (chunk: Buffer) => {
    if (capped) return;
    const room = PERSON_PATH_STDOUT_CAP - held;
    const take = chunk.length > room ? chunk.subarray(0, room) : chunk;
    kept.push(take);
    held += take.length;
    if (held >= PERSON_PATH_STDOUT_CAP) {
      capped = true;
      killGroup();
    }
  });
  const done = new Promise<{ code: number | null; stdout: string }>((resolve, reject) => {
    child.once("error", reject);
    child.once("close", (code: number | null) => {
      resolve({ code, stdout: Buffer.concat(kept).toString("utf8") });
    });
  });
  return { done, killGroup };
};
