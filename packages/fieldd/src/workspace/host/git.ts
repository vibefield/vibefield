import { execFile } from "node:child_process";
import type {
  WorkspaceGitFacts,
  WorkspaceGitPortResponse,
  WorkspaceGitWorktree,
} from "@vibefield/contracts";
import { WORKSPACE_GIT } from "@vibefield/contracts/registries";
import { parseRelativePath } from "../paths";

// FS-1a — the INTERIM git service under the files worker (FS-D8 RULED (a):
// M5 is mille's own git spec, `GitService`; until its PR 8 lands, this is a
// TypeScript port of rosetta's `clients/app/electron/git-service.mjs` and of
// the `gitFacts` read beside it in rosetta's `main.mjs`). It serves the room's
// git-port protocol — `{id, op, args}` → `{id, ok, value | error}`, every
// failure a VALUE (`fx-host.mjs` `serveGit`) — READ-ONLY (FS-D5 (a)): `stage`,
// `unstage`, `discard` and every commit write answer `read-only in v1`.
//
// What the port changes, beyond the language:
//  · a commit id is a hex object id (4–64), checked before git sees it —
//    rosetta handed `sha` to `git show` as-is, so `--output=<file>` would
//    have been an OPTION, a write through a read;
//  · a path is a request path (`parseRelativePath`: no `..`, nothing
//    absolute), joined with "/" for git — the files service's own rule, in
//    place of mille-ui's `assertPathUnderRoot` (wall R24 keeps mille-ui out of
//    the worker);
//  · git runs with optional locks off (`GIT_OPTIONAL_LOCKS=0`: a status never
//    takes `index.lock` from under an agent's commit), no terminal prompt, no
//    fsmonitor hook, and no external diff driver or textconv. Erratum
//    (2026-10-08, found by rosetta's RO-15 lane on git 2.50.1): this header
//    said a repository's own config then never makes a READ run a program of
//    its choosing — false. A `filter.<driver>.clean` named in `.gitattributes`
//    still runs when status or diff re-reads a file whose stat changed, and git
//    has no switch for filters. It leaks nothing the repository's author lacks:
//    the worker runs with fieldd's environment less the daemon's own prefixes
//    (`workerEnvironment`, `../supervisor.ts`), and git with less still (below).
//
// PJ-1 (L3, 2026-10-08) — ONE hardened runner, for every caller (the port,
// `gitFacts`, the place facts in `places.ts`): a folder's path can come from a
// session's cwd, which an agent can forge (the project-places model review's
// EL7 finding), so every invocation carries
//  · an ALLOWLISTED environment (`gitEnvironment`): PATH, HOME, USER, LANG,
//    `LC_*`, TMPDIR (and on Windows the few variables a process needs to
//    start) — never a `GIT_*` from the shell that launched the app, so an
//    inherited `GIT_DIR`, `GIT_WORK_TREE` or `GIT_CONFIG_*` cannot redirect a
//    read into another repository or another config;
//  · `core.hooksPath=/dev/null` (no hook a repository names runs) and
//    `protocol.allow=never`, each transport also refused by name, and no lazy
//    fetch (a read never reaches the network or another repository, so a
//    repository's `core.sshCommand` never runs) beside `core.fsmonitor=false`;
//  · its timeout, and a turn under the worker-wide cap
//    (`WORKSPACE_GIT.CONCURRENCY`, `GitGate`).
// `safe.directory` is never set: a repository git refuses as owned by someone
// else stays refused, and the place facts say so (`dubious-ownership`).
//
// mille-git at c8160d5 (2026-10-08, the EL8 pin): its `GitService` rejects an
// aborted call `ABORT_ERR` (G1) and caps `commitFiles` at 10 000 with
// `{files, truncated}` (G2). Neither reaches this port: the room's protocol
// carries no cancel, and its column reads `{files, error}` and has no words
// for a cut list — so the interim does NOT cap (a silent 10 000 rows would be
// worse than every row). Both arrive with the GitService swap, the column's
// half as an upstream room change. What the interim owes now: an answer past
// the runner's buffer (DIFF_BYTES) is refused in words, never Node's
// "maxBuffer length exceeded".

/** What a git answer is made of. */
export interface GitRun {
  ok: boolean;
  stdout: string;
  stderr: string;
  /** the exit code (null when git never ran, or was killed by its timeout) */
  code: number | null;
}

/** The hardening every invocation carries (header). `protocol.allow=never`
 * alone is not the wall: a `protocol.<name>.allow` outranks it, and a
 * repository's own config may set one — so each transport git knows is
 * refused by name too, on the command line, which outranks every file. And a
 * repository's `log.showSignature` would run its `gpg.program` on a log. */
const GIT_FLAGS = [
  "-c",
  "core.fsmonitor=false",
  "-c",
  "core.hooksPath=/dev/null",
  "-c",
  "protocol.allow=never",
  ...["file", "git", "ssh", "http", "https", "ext"].flatMap((name) => [
    "-c",
    `protocol.${name}.allow=never`,
  ]),
  "-c",
  "log.showSignature=false",
] as const;

/** What git and `ssh -G` may read of the worker's environment (header). */
const ENV_ALLOWED = new Set(["PATH", "HOME", "USER", "LANG", "TMPDIR"]);
/** What a Windows process needs to start and find its home and temp. */
const ENV_ALLOWED_WINDOWS = new Set([
  "SYSTEMROOT",
  "WINDIR",
  "USERPROFILE",
  "HOMEDRIVE",
  "HOMEPATH",
  "TEMP",
  "TMP",
  "PATHEXT",
]);

/** The allowlist alone: every other variable of `source` is dropped. */
export function scrubbedEnvironment(
  source: NodeJS.ProcessEnv,
  platform: NodeJS.Platform = process.platform,
): NodeJS.ProcessEnv {
  const windows = platform === "win32";
  const out: NodeJS.ProcessEnv = {};
  for (const [key, value] of Object.entries(source)) {
    if (value === undefined) continue;
    // Windows names its variables without regard to case (`Path`)
    const name = windows ? key.toUpperCase() : key;
    if (
      ENV_ALLOWED.has(name) ||
      name.startsWith("LC_") ||
      (windows && ENV_ALLOWED_WINDOWS.has(name))
    )
      out[key] = value;
  }
  return out;
}

/** git's environment: the allowlist, then the runner's own — optional locks
 * off (a read never takes `index.lock` from under an agent's commit), no
 * terminal prompt, no lazy fetch. */
export function gitEnvironment(
  source: NodeJS.ProcessEnv,
  platform: NodeJS.Platform = process.platform,
): NodeJS.ProcessEnv {
  return {
    ...scrubbedEnvironment(source, platform),
    GIT_OPTIONAL_LOCKS: "0",
    GIT_TERMINAL_PROMPT: "0",
    // a partial clone would otherwise FETCH an object a read finds missing
    // (`cat-file -e`) from its promisor remote — git ≥ 2.45; older gits are
    // held by the refused transports instead
    GIT_NO_LAZY_FETCH: "1",
  };
}

/** The worker-wide cap: at most `limit` tasks run at once, the rest in
 * arrival order. `peak` is the most that ever ran together (a witness). */
export class GitGate {
  readonly #limit: number;
  readonly #waiting: Array<() => void> = [];
  #active = 0;
  #peak = 0;

  constructor(limit: number) {
    this.#limit = Math.max(1, limit);
  }

  get active(): number {
    return this.#active;
  }

  get waiting(): number {
    return this.#waiting.length;
  }

  get peak(): number {
    return this.#peak;
  }

  async run<T>(task: () => Promise<T>): Promise<T> {
    if (this.#active >= this.#limit)
      await new Promise<void>((resume) => this.#waiting.push(resume));
    else this.#active += 1;
    if (this.#active > this.#peak) this.#peak = this.#active;
    try {
      return await task();
    } finally {
      const next = this.#waiting.shift();
      // the slot passes straight to the next in line, or is freed
      if (next !== undefined) next();
      else this.#active -= 1;
    }
  }
}

/** THE worker's gate: every git and `ssh -G` process takes a turn here. */
export const gitGate = new GitGate(WORKSPACE_GIT.CONCURRENCY);

export interface RunOptions {
  maxBuffer?: number;
  timeoutMs?: number;
  /** written to the process's stdin, which is then closed */
  input?: string;
}

/** Run one process under the gate with the scrubbed environment: every
 * failure (a spawn that cannot happen, a timeout, a non-zero exit) is a
 * value, never a throw. */
export function runScrubbed(
  command: string,
  argv: readonly string[],
  options: RunOptions & { env: NodeJS.ProcessEnv },
): Promise<GitRun> {
  return gitGate.run(
    () =>
      new Promise<GitRun>((resolve) => {
        const child = execFile(
          command,
          [...argv],
          {
            timeout: options.timeoutMs ?? WORKSPACE_GIT.TIMEOUT_MS,
            maxBuffer: options.maxBuffer ?? WORKSPACE_GIT.DIFF_BYTES,
            windowsHide: true,
            env: options.env,
          },
          (error, stdout, stderr) => {
            const code = (error as { code?: unknown } | null)?.code;
            // an answer past the buffer is cut and git killed: say so in words
            // (the room shows this as the column's receipt), never Node's
            // "stdout maxBuffer length exceeded"
            const overflowed = code === "ERR_CHILD_PROCESS_STDIO_MAXBUFFER";
            const limit = options.maxBuffer ?? WORKSPACE_GIT.DIFF_BYTES;
            const size =
              limit >= 1024 * 1024 ? `${Math.round(limit / 1024 / 1024)} MB` : `${limit} bytes`;
            resolve({
              ok: !error,
              stdout: typeof stdout === "string" ? stdout : "",
              stderr: overflowed
                ? `git's answer is larger than the ${size} VibeField reads at once, so it is not shown`
                : (typeof stderr === "string" ? stderr : "").trim() ||
                  (error ? String(error.message) : ""),
              code: error === null ? 0 : typeof code === "number" ? code : null,
            });
          },
        );
        // a closed stdin: git never waits on a reader that is not there
        child.stdin?.on("error", () => undefined);
        child.stdin?.end(options.input ?? "");
      }),
  );
}

/** THE runner: `git -C <root>` with the hardening (header). */
export function runGit(
  root: string,
  args: readonly string[],
  options: RunOptions = {},
): Promise<GitRun> {
  return runScrubbed("git", [...GIT_FLAGS, "-C", root, ...args], {
    ...options,
    env: gitEnvironment(process.env),
  });
}

const git = runGit;

/** `.` means "unchanged in this slot" — every other character is a state. */
function slot(letter: string | undefined): string | null {
  return letter === "." || letter === undefined ? null : letter;
}

export interface StatusEntry {
  path: string;
  original: string | null;
  index: string | null;
  worktree: string | null;
}

/** `git status --porcelain=v2 -z`, keeping BOTH slots (rosetta's reading:
 * a file staged AND edited again is in both groups). */
export function parseStatus(raw: string): StatusEntry[] {
  const records = raw.split("\0");
  const entries: StatusEntry[] = [];
  for (let i = 0; i < records.length; i += 1) {
    const line = records[i] ?? "";
    if (line === "") continue;
    const tag = line[0];
    if (tag === "1" || tag === "2") {
      const xy = line.slice(2, 4);
      const fields = line.split(" ");
      const path = fields.slice(tag === "1" ? 8 : 9).join(" ");
      let original: string | null = null;
      if (tag === "2") {
        original = records[i + 1] ?? null;
        i += 1;
      }
      entries.push({ path, original, index: slot(xy[0]), worktree: slot(xy[1]) });
    } else if (tag === "?") {
      entries.push({ path: line.slice(2), original: null, index: null, worktree: "?" });
    } else if (tag === "u") {
      const fields = line.split(" ");
      entries.push({
        path: fields.slice(10).join(" "),
        original: null,
        index: null,
        worktree: "U",
      });
    }
  }
  return entries;
}

const LOG_FORMAT =
  "%H%x1f%s%x1f%an%x1f%at%x1f%P%x1f%(trailers:key=Co-authored-by,valueonly,separator=%x1e)";

export interface LogCommit {
  sha: string;
  short: string;
  subject: string;
  author: string;
  timestampMs: number;
  merge: boolean;
  coAuthors: Array<{ name: string; email: string | null }>;
  pushed: boolean | null;
  added: number;
  deleted: number;
  files: number;
}

function parseLog(raw: string, unpushed: Set<string> | null): LogCommit[] {
  const out: LogCommit[] = [];
  for (const line of raw.split("\n")) {
    if (line.trim() === "") continue;
    const [sha, subject, author, at, parents, coAuthored] = line.split("\x1f");
    if (!sha) continue;
    out.push({
      sha,
      short: sha.slice(0, 7),
      subject: subject ?? "",
      author: author ?? "",
      timestampMs: Number.parseInt(at ?? "0", 10) * 1000,
      merge: (parents ?? "").trim().split(/\s+/).filter(Boolean).length > 1,
      coAuthors: (coAuthored ?? "")
        .split("\x1e")
        .map((entry) => entry.trim())
        .filter(Boolean)
        .map((entry) => {
          const angle = entry.lastIndexOf("<");
          return angle === -1
            ? { name: entry, email: null }
            : {
                name: entry.slice(0, angle).trim(),
                email:
                  entry
                    .slice(angle + 1)
                    .replace(">", "")
                    .trim() || null,
              };
        }),
      pushed: unpushed === null ? null : !unpushed.has(sha),
      added: 0,
      deleted: 0,
      files: 0,
    });
  }
  return out;
}

function applyNumstat(commits: LogCommit[], raw: string): void {
  const bySha = new Map(commits.map((commit) => [commit.sha, commit]));
  let current: LogCommit | null = null;
  for (const line of raw.split("\n")) {
    if (line === "") continue;
    if (!line.includes("\t")) {
      current = bySha.get(line.trim()) ?? null;
      continue;
    }
    if (current === null) continue;
    const [added, deleted] = line.split("\t");
    current.files += 1;
    if (added !== "-") current.added += Number.parseInt(added ?? "0", 10) || 0;
    if (deleted !== "-") current.deleted += Number.parseInt(deleted ?? "0", 10) || 0;
  }
}

/** A commit id as the port admits it: hex, 4–64 characters. Never an option,
 * never a revision expression. */
const COMMIT_ID = /^[0-9a-fA-F]{4,64}$/;

function commitId(raw: unknown): string {
  if (typeof raw !== "string" || !COMMIT_ID.test(raw))
    throw new Error(`not a commit id: ${String(raw).slice(0, 80)}`);
  return raw;
}

/** A path below the root, as git wants it ("a/b"), or a refusal. */
function rootPath(raw: unknown): string {
  if (typeof raw !== "string" || raw.length === 0) throw new Error("no path given");
  const verdict = parseRelativePath(raw);
  if (!verdict.ok || verdict.segments.length === 0)
    throw new Error(`path escapes the root: ${raw.slice(0, 200)}`);
  return verdict.segments.join("/");
}

export interface GitService {
  branch(): Promise<{
    name: string | null;
    upstream: string | null;
    ahead: number | null;
    behind: number | null;
  }>;
  status(): Promise<{ entries: StatusEntry[]; error: string | null }>;
  log(): Promise<{ commits: LogCommit[]; error: string | null }>;
  diff(args: unknown): Promise<{ text: string; error: string | null }>;
  commitFiles(args: unknown): Promise<{
    files: Array<{
      path: string;
      original: string | null;
      status: string;
      added: number | null;
      deleted: number | null;
    }>;
    error: string | null;
  }>;
}

/** The read half of rosetta's git service, for one root. */
export function createGitService(root: string): GitService {
  return {
    async branch() {
      const head = await git(root, ["rev-parse", "--abbrev-ref", "HEAD"]);
      const name = head.ok ? head.stdout.trim() : null;
      const upstream = await git(root, [
        "rev-parse",
        "--abbrev-ref",
        "--symbolic-full-name",
        "@{u}",
      ]);
      if (!upstream.ok) return { name, upstream: null, ahead: null, behind: null };
      const counts = await git(root, ["rev-list", "--left-right", "--count", "@{u}...HEAD"]);
      const [behind, ahead] = counts.ok
        ? counts.stdout
            .trim()
            .split(/\s+/)
            .map((n) => Number.parseInt(n, 10))
        : [Number.NaN, Number.NaN];
      return {
        name,
        upstream: upstream.stdout.trim(),
        ahead: Number.isFinite(ahead) ? (ahead as number) : null,
        behind: Number.isFinite(behind) ? (behind as number) : null,
      };
    },

    async status() {
      const result = await git(root, ["status", "--porcelain=v2", "-z", "--untracked-files=all"]);
      if (!result.ok) return { entries: [], error: result.stderr };
      return { entries: parseStatus(result.stdout), error: null };
    },

    async log() {
      const unpushedResult = await git(root, ["rev-list", "@{u}..HEAD"]);
      const unpushed = unpushedResult.ok
        ? new Set(
            unpushedResult.stdout
              .split("\n")
              .map((s) => s.trim())
              .filter(Boolean),
          )
        : null;
      const result = await git(root, [
        "log",
        `--max-count=${WORKSPACE_GIT.LOG_LIMIT}`,
        `--format=${LOG_FORMAT}`,
      ]);
      if (!result.ok) return { commits: [], error: result.stderr };
      const commits = parseLog(result.stdout, unpushed);
      const stat = await git(root, [
        "log",
        `--max-count=${WORKSPACE_GIT.LOG_LIMIT}`,
        "--format=%H",
        "--numstat",
        "--no-renames",
      ]);
      if (stat.ok) applyNumstat(commits, stat.stdout);
      return { commits, error: null };
    },

    async diff(args) {
      const ask = (typeof args === "object" && args !== null ? args : {}) as {
        path?: unknown;
        staged?: unknown;
        sha?: unknown;
      };
      const only = rootPath(ask.path);
      const sha = ask.sha === undefined || ask.sha === null ? null : commitId(ask.sha);
      const plain = ["--no-ext-diff", "--no-textconv", "-M"];
      const argv = sha
        ? ["show", "--format=", ...plain, sha, "--", only]
        : ask.staged === true
          ? ["diff", "--cached", ...plain, "--", only]
          : ["diff", ...plain, "--", only];
      const result = await git(root, argv);
      if (!result.ok) return { text: "", error: result.stderr };
      if (result.stdout === "" && ask.staged !== true && sha === null) {
        const untracked = await git(root, [
          "diff",
          "--no-ext-diff",
          "--no-textconv",
          "--no-index",
          "--",
          "/dev/null",
          only,
        ]);
        return { text: untracked.stdout, error: null };
      }
      return { text: result.stdout, error: null };
    },

    async commitFiles(args) {
      const sha = commitId(args);
      const [status, stat] = await Promise.all([
        git(root, ["show", "--format=", "--no-ext-diff", "--name-status", "-M", sha]),
        git(root, ["show", "--format=", "--no-ext-diff", "--numstat", "-M", sha]),
      ]);
      if (!status.ok) return { files: [], error: status.stderr };
      const counts = new Map<string, { added: number | null; deleted: number | null }>();
      for (const line of stat.stdout.split("\n")) {
        if (!line.includes("\t")) continue;
        const parts = line.split("\t");
        const [added, deleted] = parts;
        const path = parts[parts.length - 1] ?? "";
        counts.set(path, {
          added: added === "-" ? null : Number.parseInt(added ?? "0", 10) || 0,
          deleted: deleted === "-" ? null : Number.parseInt(deleted ?? "0", 10) || 0,
        });
      }
      const files: Array<{
        path: string;
        original: string | null;
        status: string;
        added: number | null;
        deleted: number | null;
      }> = [];
      for (const line of status.stdout.split("\n")) {
        if (!line.includes("\t")) continue;
        const parts = line.split("\t");
        const letter = (parts[0] ?? "")[0] ?? "?";
        const original = parts.length > 2 ? (parts[1] ?? null) : null;
        const path = parts[parts.length - 1] ?? "";
        files.push({
          path,
          original,
          status: letter,
          ...(counts.get(path) ?? { added: null, deleted: null }),
        });
      }
      return { files, error: null };
    },
  };
}

/** One request of the git port, answered (rosetta's `serveGit`, read-only):
 * null for a frame that is not a request (no numeric id) — ignored, as
 * rosetta ignores it — else exactly one response. */
export async function answerGitRequest(
  service: GitService,
  raw: unknown,
): Promise<WorkspaceGitPortResponse | null> {
  if (typeof raw !== "object" || raw === null) return null;
  const request = raw as { id?: unknown; op?: unknown; args?: unknown };
  if (typeof request.id !== "number" || !Number.isInteger(request.id)) return null;
  const id = request.id;
  const op = typeof request.op === "string" ? request.op : String(request.op);
  if ((WORKSPACE_GIT.WRITE_OPS as readonly string[]).includes(op))
    return { id, ok: false, error: WORKSPACE_GIT.READ_ONLY_ERROR };
  if (!(WORKSPACE_GIT.READ_OPS as readonly string[]).includes(op))
    return { id, ok: false, error: `unknown op: ${op.slice(0, 64)}` };
  try {
    const run = service[op as keyof GitService] as (args: unknown) => Promise<unknown>;
    const value = await run(request.args);
    return { id, ok: true, value: value ?? null };
  } catch (error) {
    return {
      id,
      ok: false,
      error: error instanceof Error && error.message ? error.message : "the git command failed",
    };
  }
}

/** The port shape the room hands its git column (a MessagePort, or Electron's
 * main-process port as rosetta wraps it) — FS-1b attaches one. */
export interface GitPortLike {
  postMessage(message: unknown): void;
  addEventListener(type: "message", listener: (event: { data: unknown }) => void): void;
  start?(): void;
}

/** Serve the git protocol on a port (FS-1b's attach): every request answered
 * in its own time, failures as values. */
export function serveGitPort(port: GitPortLike, service: GitService): void {
  port.addEventListener("message", (event) => {
    void answerGitRequest(service, event.data).then((response) => {
      if (response !== null) port.postMessage(response);
    });
  });
  port.start?.();
}

/** A root's git facts (rosetta's `gitFacts`): null when the folder is not in
 * a repository; every field nullable when git could not answer it. */
export async function gitFacts(root: string): Promise<WorkspaceGitFacts | null> {
  const inside = await git(root, ["rev-parse", "--is-inside-work-tree"], { timeoutMs: 4_000 });
  if (!inside.ok || inside.stdout.trim() !== "true") return null;
  // `symbolic-ref`, not rosetta's `rev-parse --abbrev-ref`: a branch with no
  // commit yet is still a branch, and only a detached HEAD has none
  const head = await git(root, ["symbolic-ref", "--quiet", "--short", "HEAD"], {
    timeoutMs: 4_000,
  });
  const headName = head.ok ? head.stdout.trim() : "";
  const branch = headName.length > 0 ? headName : null;
  const status = await git(root, ["status", "--porcelain=v2", "-z", "--untracked-files=all"]);
  const dirty = status.ok ? parseStatus(status.stdout).length : null;
  const listed = await git(root, ["worktree", "list", "--porcelain"], { timeoutMs: 4_000 });
  const worktrees: WorkspaceGitWorktree[] = listed.ok
    ? parseWorktreeList(listed.stdout).map(({ path, branch }) => ({ path, branch }))
    : [];
  return { branch, dirty, worktrees };
}

/** One entry of `git worktree list --porcelain`. The first is the main
 * worktree — `bare` in the bare-repository layout, where it is no working
 * tree at all; `prunable` is one whose folder git found gone. */
export interface WorktreeEntry {
  path: string;
  branch: string | null;
  bare: boolean;
  prunable: boolean;
}

export function parseWorktreeList(raw: string): WorktreeEntry[] {
  const entries: WorktreeEntry[] = [];
  for (const block of raw.split("\n\n")) {
    const lines = block.split("\n");
    const path = lines.find((line) => line.startsWith("worktree "))?.slice(9);
    if (!path) continue;
    const named = lines
      .find((line) => line.startsWith("branch "))
      ?.slice(7)
      .replace("refs/heads/", "");
    entries.push({
      path,
      branch: named && named.length > 0 ? named : null,
      bare: lines.includes("bare"),
      prunable: lines.some((line) => line === "prunable" || line.startsWith("prunable ")),
    });
  }
  return entries;
}
