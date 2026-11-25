import { execFile } from "node:child_process";
import type {
  WorkspaceGitFacts,
  WorkspaceGitPortResponse,
  WorkspaceGitWorktree,
  WorkspaceWorktreeSize,
} from "@vibefield/contracts";
import { WORKSPACE_GIT, WORKSPACE_TREE_SIZE } from "@vibefield/contracts/registries";
import { parseRelativePath } from "../paths";
import { measureWithDu, TreeSizes } from "./tree-size";

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

// History QA (2026-11-24) — THE ROOM ASKS EVERY FOUR SECONDS; THE WORKER READS ONLY WHAT MAY HAVE MOVED.
// The room's pane asks `branch`, `status` and `log` together on a timer, and each ask ran its own git: three for
// the branch, one status, three for the log (the log twice over the same 200 commits): seven processes a tick, for
// answers that change when HEAD or the upstream moves and otherwise never. Measured on a large checkout: 121
// processes a minute. Now a tick is two:
//  · ONE status serves `branch` and `status`: `--branch` adds the head, its upstream and the ahead/behind counts to
//    the read the pane already asked for, and asks that arrive together (or within STATUS_SHARE_MS of its end)
//    share it;
//  · `log` is a pure function of the head commit and the upstream's, so its answer is kept per root under those
//    two ids and read again only when one of them moves (one `rev-parse` asks the upstream's; none without one).
// The answers are the ones the three reads gave. Where the shared status cannot answer (it failed, or timed out
// on a tree too large to walk in time), `branch` reads as it did before, by its own three.

/** How long a finished status read still serves an ask that arrives after it. */
export const STATUS_SHARE_MS = 500;
/** How many roots keep a memo (the worker serves a few panes at most). */
const MEMO_ROOTS = 32;

/** What `git status --branch` says of HEAD, in the words `branch()` answers in. */
export interface StatusHeads {
  /** the head commit's id; null before the first commit */
  oid: string | null;
  name: string | null;
  upstream: string | null;
  ahead: number | null;
  behind: number | null;
}

/** The `# branch.*` records of `git status --porcelain=v2 --branch -z`; null when the output carries none. */
export function parseStatusHeads(raw: string): StatusHeads | null {
  let oid: string | null = null;
  let head: string | null = null;
  let upstream: string | null = null;
  let ahead: number | null = null;
  let behind: number | null = null;
  let seen = false;
  for (const record of raw.split("\0")) {
    // the headers come first; the first record that is not one ends them
    if (!record.startsWith("# ")) break;
    seen = true;
    const [key, ...rest] = record.slice(2).split(" ");
    const value = rest.join(" ");
    if (key === "branch.oid") oid = value === "(initial)" ? null : value;
    else if (key === "branch.head") head = value;
    else if (key === "branch.upstream") upstream = value;
    else if (key === "branch.ab") {
      const counts = /^\+(\d+) -(\d+)$/.exec(value);
      if (counts !== null) {
        ahead = Number.parseInt(counts[1] as string, 10);
        behind = Number.parseInt(counts[2] as string, 10);
      }
    }
  }
  if (!seen) return null;
  // `rev-parse --abbrev-ref HEAD` named a detached head "HEAD" and failed before the first commit; an upstream
  // that is set and gone resolved to nothing. The answers stay those.
  const name = oid === null ? null : head === "(detached)" ? "HEAD" : head;
  const tracked = ahead !== null && behind !== null;
  return {
    oid,
    name,
    upstream: tracked ? upstream : null,
    ahead: tracked ? ahead : null,
    behind: tracked ? behind : null,
  };
}

interface StatusRead {
  run: GitRun;
  heads: StatusHeads | null;
  entries: StatusEntry[];
}
interface LogAnswer {
  commits: LogCommit[];
  error: string | null;
}
interface RootMemo {
  status: { read: Promise<StatusRead>; endedAt: number | null } | null;
  log: { key: string; answer: LogAnswer } | null;
}
const memos = new Map<string, RootMemo>();

function memoOf(root: string): RootMemo {
  let memo = memos.get(root);
  if (memo !== undefined) {
    // the newest-asked root is the last to go
    memos.delete(root);
    memos.set(root, memo);
    return memo;
  }
  memo = { status: null, log: null };
  memos.set(root, memo);
  if (memos.size > MEMO_ROOTS) {
    const oldest = memos.keys().next().value;
    if (oldest !== undefined) memos.delete(oldest);
  }
  return memo;
}

/** Forget every root's memo (tests). */
export function forgetGitMemos(): void {
  memos.clear();
}

/** The one status read a tick's asks share: in flight, or ended within STATUS_SHARE_MS. */
function sharedStatus(root: string, run: typeof runGit): Promise<StatusRead> {
  const memo = memoOf(root);
  const held = memo.status;
  if (held !== null && (held.endedAt === null || Date.now() - held.endedAt <= STATUS_SHARE_MS))
    return held.read;
  const entry: NonNullable<RootMemo["status"]> = {
    endedAt: null,
    read: run(root, ["status", "--porcelain=v2", "--branch", "-z", "--untracked-files=all"]).then(
      (result): StatusRead => {
        entry.endedAt = Date.now();
        return result.ok
          ? {
              run: result,
              heads: parseStatusHeads(result.stdout),
              entries: parseStatus(result.stdout),
            }
          : { run: result, heads: null, entries: [] };
      },
    ),
  };
  memo.status = entry;
  return entry.read;
}

/** The read half of rosetta's git service, for one root. `run` is the runner (tests count its calls). */
export function createGitService(root: string, run: typeof runGit = runGit): GitService {
  const git = run;
  /** The log, read from git: the commits, which of them are not pushed, and each one's line counts. */
  async function readLog(): Promise<LogAnswer> {
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
  }
  return {
    async branch() {
      const shared = await sharedStatus(root, run);
      if (shared.heads !== null) {
        const { name, upstream, ahead, behind } = shared.heads;
        return { name, upstream, ahead, behind };
      }
      // the shared status could not answer: the three reads, as before
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
      const shared = await sharedStatus(root, run);
      if (!shared.run.ok) return { entries: [], error: shared.run.stderr };
      return { entries: shared.entries, error: null };
    },

    async log() {
      // the log moves only when the head commit or the upstream's does: kept under the two ids
      const heads = (await sharedStatus(root, run)).heads;
      let key: string | null = null;
      if (heads !== null && heads.oid !== null) {
        const upstreamId =
          heads.upstream === null
            ? null
            : await git(root, ["rev-parse", "--verify", "--quiet", "@{u}^{commit}"]);
        key = `${heads.oid} ${heads.upstream ?? ""} ${upstreamId?.ok ? upstreamId.stdout.trim() : ""}`;
        const kept = memoOf(root).log;
        if (kept !== null && kept.key === key) return kept.answer;
      }
      const answer = await readLog();
      if (key !== null && answer.error === null) memoOf(root).log = { key, answer };
      return answer;
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

/** HD-3 — the worker's one measurer of worktree folders (`tree-size.ts`): its walks run with the git
 * runner's own allowlisted environment. Opened once, at the worker's `init`, with the file its figures
 * are kept in; before that (and in a test that never opens it) figures live in memory. */
function treeSizesOver(file: string | null): TreeSizes {
  return new TreeSizes({
    file,
    measure: (folder, options) =>
      measureWithDu(folder, { ...options, env: scrubbedEnvironment(process.env) }),
  });
}
let treeSizes = treeSizesOver(null);

/** The worker's `init`: read the kept figures and keep new ones there. */
export function openTreeSizes(file: string | null): void {
  treeSizes.dispose();
  treeSizes = treeSizesOver(file);
}

/** The worker is leaving: end the walk in flight and write what is known. */
export function stopTreeSizes(): void {
  treeSizes.dispose();
}

/** What `gitFacts` and `worktreeSizes` need of the measurer (a test's own). */
export type TreeSizeReader = Pick<TreeSizes, "peek" | "ask">;

/** HD-3 — the worktrees a root's repository was last read to have and whose folders may be walked (not
 * gone, not bare), so that an ask for sizes names only what git named and does not run git again for
 * LIST_FRESH_MS. Kept for the few roots a window looks at. */
const walkable = new Map<string, { at: number; paths: Set<string> }>();
const WALKABLE_ROOTS = 16;

function rememberWalkable(root: string, entries: readonly WorktreeEntry[]): Set<string> {
  const paths = new Set(
    entries.filter((entry) => !entry.prunable && !entry.bare).map((entry) => entry.path),
  );
  walkable.delete(root);
  walkable.set(root, { at: Date.now(), paths });
  while (walkable.size > WALKABLE_ROOTS) {
    const oldest = walkable.keys().next().value;
    if (oldest === undefined) break;
    walkable.delete(oldest);
  }
  return paths;
}

/** A root's git facts (rosetta's `gitFacts`): null when the folder is not in a repository; every field
 * nullable when git could not answer it. HD-3: each worktree with its commit, whether its folder is
 * gone, and the figure this desktop already holds for it. Git facts never start a walk: a figure is
 * measured only when `worktreeSizes` is asked for it by name. */
export async function gitFacts(
  root: string,
  sizes: TreeSizeReader = treeSizes,
): Promise<WorkspaceGitFacts | null> {
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
  const entries = listed.ok ? parseWorktreeList(listed.stdout) : [];
  if (listed.ok) rememberWalkable(root, entries);
  const worktrees: WorkspaceGitWorktree[] = entries.map((entry) => {
    const worktree: WorkspaceGitWorktree = {
      path: entry.path,
      branch: entry.branch,
      head: entry.head,
      gone: entry.prunable,
    };
    // a folder that is gone holds nothing, and a bare repository is no working tree
    const sizeBytes = entry.prunable || entry.bare ? undefined : sizes.peek(entry.path);
    return sizeBytes === undefined ? worktree : { ...worktree, sizeBytes };
  });
  return { branch, dirty, worktrees };
}

/** HD-3 — `workspace.worktreeSizes`: what the asked worktrees of `root`'s repository hold on disk, in
 * the order asked. Only a path git lists for this root, with its folder there, is ever walked: any
 * other answers with no figure. Asking is what queues a walk, and each ask replaces the queue
 * (`TreeSizes.ask`), so the caller names the rows it is showing and nothing more. */
export async function worktreeSizes(
  root: string,
  paths: readonly string[],
  sizes: TreeSizeReader = treeSizes,
): Promise<WorkspaceWorktreeSize[]> {
  const asked = [...new Set(paths)].slice(0, WORKSPACE_TREE_SIZE.ASK_MAX);
  let known = walkable.get(root);
  if (known === undefined || Date.now() - known.at >= WORKSPACE_TREE_SIZE.LIST_FRESH_MS) {
    const listed = await git(root, ["worktree", "list", "--porcelain"], { timeoutMs: 4_000 });
    known = {
      at: Date.now(),
      paths: listed.ok ? rememberWalkable(root, parseWorktreeList(listed.stdout)) : new Set(),
    };
  }
  const allowed = asked.filter((path) => known.paths.has(path));
  const figures = sizes.ask(allowed);
  return asked.map((path) => {
    const at = allowed.indexOf(path);
    const sizeBytes = at === -1 ? undefined : figures[at];
    return sizeBytes === undefined ? { path } : { path, sizeBytes };
  });
}

/** One entry of `git worktree list --porcelain`. The first is the main
 * worktree — `bare` in the bare-repository layout, where it is no working
 * tree at all; `prunable` is one whose folder git found gone. */
export interface WorktreeEntry {
  path: string;
  branch: string | null;
  /** the commit checked out (a hex object id); null when git names none (a
   * bare repository, or a line this reader does not know as one) */
  head: string | null;
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
    const head = lines.find((line) => line.startsWith("HEAD "))?.slice(5) ?? "";
    entries.push({
      path,
      branch: named && named.length > 0 ? named : null,
      head: /^[0-9a-f]{4,64}$/.test(head) ? head : null,
      bare: lines.includes("bare"),
      prunable: lines.some((line) => line === "prunable" || line.startsWith("prunable ")),
    });
  }
  return entries;
}
