import { createHash } from "node:crypto";
import { existsSync, realpathSync, statSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { posix, resolve, win32 } from "node:path";
import { PLACE_FACTS } from "@vibefield/contracts/registries";
import { isFilesystemRoot } from "../paths";
import type {
  PlaceFactsArgs,
  PlaceFactsValue,
  PlaceGitRead,
  PlaceGitRefusal,
  PlaceHit,
  PlaceKind,
  PlaceRead,
  PlaceRemote,
  PlaceSample,
  PlaceSampleSet,
} from "../protocol";
import { type GitRun, parseWorktreeList, runGit, runScrubbed, scrubbedEnvironment } from "./git";

// PJ-1 (`thinking-project-places.md` §4.1, §9; `build-pj.md` L3, L6, L7) — the
// files worker's PLACE FACTS: for each folder the scanner names, what the
// folder is (there, mounted, its volume's case rule, its kind) and what git
// says of it, through the ONE hardened runner (`git.ts`). Read-only, and no
// `git status` — a `.gitattributes` clean filter would run (build-fs M19).
//
// The per-place reads, in the order they run:
//   · the CHEAP read — `rev-parse` (git dir, common dir, shallow, top),
//     `symbolic-ref` (the branch, an unborn one too), `rev-parse --verify`
//     (the tip) and two stats (the config's and the worktree list's mtime) —
//     digested into a `key`; a key the scanner already holds answers
//     "unchanged" and the place costs nothing more;
//   · otherwise the full read: the remotes (`remote -v`: what git uses, after
//     `insteadOf`), the push-remote config, the first-parent root and the
//     samples (`rev-list`, plumbing — no repository config makes it run a
//     program), the worktree list, and `ssh -G` for an ssh host a remote names;
//   · the HITS: the samples of every place with the same root, looked for in
//     this place's objects (`cat-file --batch-check`, hex-checked) and then in
//     its history (`merge-base --is-ancestor`), the shallowest held per place.
//     Digested too (`hitsKey`): an unchanged tip and unchanged candidates
//     answer "unchanged".
// A question stops starting git after PLACE_FACTS.OP_BUDGET_MS; a place it did
// not finish comes back `skipped`, for the scanner's next pass.

/** git's own spelling of a commit id: SHA-1 or SHA-256 hex. */
const SHA = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/;
/** The empty tree, in both hash functions: a first commit with nothing in it
 * names every `git commit --allow-empty` starter alike — no root. */
const EMPTY_TREES = new Set([
  "4b825dc642cb6eb9a060e54bf8d69288fbee4904",
  "6ef19b41225c5369f1c104d45d8d85efa9b057b53b14b4b9b939dd74decc5321",
]);
/** A host `ssh -G` may be asked about (C10): never an option, never a pattern. */
const SSH_HOST = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
const DEPTHS: readonly number[] = PLACE_FACTS.SAMPLE_DEPTHS;
const MAX_DEPTH = DEPTHS[DEPTHS.length - 1] ?? 0;

class BudgetSpent extends Error {}

/** What one question shares across its places. */
interface Reading {
  deadline: number;
  platform: NodeJS.Platform;
  /** this user's home folder, real */
  home: string;
  /** the system's temporary folders, real and as spelled */
  temps: string[];
  /** the task roots, `~` expanded, as segments */
  taskRoots: string[][];
  peers: PlaceSampleSet[];
  /** ssh alias answers, this question's */
  ssh: Map<string, Promise<string | null>>;
}

/** `ssh -G` answers across questions: host → HostName (or null), and when. */
const sshCache = new Map<string, { at: number; hostname: string | null }>();

/** Volume → does it ignore case (one probe per volume per worker). */
const caselessByDevice = new Map<number, boolean>();

function realOrNull(path: string): string | null {
  try {
    return realpathSync.native(path);
  } catch {
    return null;
  }
}

function isDirectory(path: string): boolean {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}

/** Forward slashes, no trailing one (a root keeps its own). */
function slashed(path: string, platform: NodeJS.Platform): string {
  const forward = platform === "win32" ? path.replace(/\\/g, "/") : path;
  return forward.length > 1 && !/^[A-Za-z]:\/$/.test(forward)
    ? forward.replace(/\/+$/, "")
    : forward;
}

function segmentsOf(path: string, platform: NodeJS.Platform): string[] {
  return slashed(path, platform).split("/").filter(Boolean);
}

/** Does the place sit at or below `root`? Case folded on a caseless volume. */
function within(path: string, root: string, platform: NodeJS.Platform, caseless: boolean): boolean {
  const fold = (s: string) => (caseless ? s.toLowerCase() : s);
  const a = fold(slashed(path, platform));
  const b = fold(slashed(root, platform));
  return a === b || a.startsWith(b.endsWith("/") ? b : `${b}/`);
}

/** A glob of `~/…` segments, `*` matching one whole segment, as segments. */
export function taskRootSegments(glob: string, home: string, platform: NodeJS.Platform): string[] {
  const expanded = glob === "~" || glob.startsWith("~/") ? `${home}${glob.slice(1)}` : glob;
  return segmentsOf(expanded, platform);
}

/** L6 — what the owner says a place is. `home`: the home folder itself or a
 * filesystem root (`/`, a drive). `task`: at or below a folder an agent's
 * `taskRoots` glob names (AR-L1: the catalog declares it, never a pattern
 * here). `temp`: at or below a system temporary folder. Else `project`. */
export function placeKind(
  path: string,
  context: { home: string; temps: readonly string[]; taskRoots: readonly string[][] },
  platform: NodeJS.Platform,
  caseless: boolean,
): PlaceKind {
  const fold = (s: string) => (caseless ? s.toLowerCase() : s);
  if (fold(slashed(path, platform)) === fold(slashed(context.home, platform))) return "home";
  if (isFilesystemRoot(path, platform)) return "home";
  const segments = segmentsOf(path, platform).map(fold);
  for (const glob of context.taskRoots) {
    if (segments.length < glob.length) continue;
    if (glob.every((part, i) => part === "*" || fold(part) === segments[i])) return "task";
  }
  if (context.temps.some((temp) => within(path, temp, platform, caseless))) return "temp";
  return "project";
}

/** The path below `home`, `/`-separated, or null (not below it, or home). */
export function homeRelativeOf(
  path: string,
  home: string,
  platform: NodeJS.Platform,
  caseless: boolean,
): string | null {
  const p = slashed(path, platform);
  const h = slashed(home, platform);
  const fold = (s: string) => (caseless ? s.toLowerCase() : s);
  const prefix = h.endsWith("/") ? h : `${h}/`;
  return fold(p).startsWith(fold(prefix)) && p.length > prefix.length
    ? p.slice(prefix.length)
    : null;
}

/** Is the volume the path lives on there? Only a removable volume's mount
 * point can be absent: `/Volumes/<name>` (macOS), `/media/<user>/<name>`,
 * `/run/media/<user>/<name>`, `/mnt/<name>` (Linux), a drive (Windows). */
export function mountPointOf(path: string, platform: NodeJS.Platform): string | null {
  if (platform === "win32") {
    const drive = /^([A-Za-z]:)[\\/]?/.exec(path);
    return drive === null ? null : `${drive[1]}\\`;
  }
  const patterns =
    platform === "darwin"
      ? [/^\/Volumes\/[^/]+/]
      : [/^\/run\/media\/[^/]+\/[^/]+/, /^\/media\/[^/]+\/[^/]+/, /^\/mnt\/[^/]+/];
  for (const pattern of patterns) {
    const match = pattern.exec(path);
    if (match !== null) return match[0];
  }
  return null;
}

function swapCase(name: string): string {
  let out = "";
  for (const char of name) {
    const lower = char.toLowerCase();
    out += char === lower ? char.toUpperCase() : lower;
  }
  return out;
}

/** Does the volume holding `path` (which is there) ignore letter case? Probed
 * once per volume: a name on it with letters, spelled with its case swapped —
 * the same file answers yes, nothing (or another file) answers no. A volume
 * with no such name on the way takes the platform's default. */
export function caselessAt(path: string, platform: NodeJS.Platform): boolean {
  const fallback = platform === "darwin" || platform === "win32";
  const paths = platform === "win32" ? win32 : posix;
  let device: number;
  try {
    device = statSync(path).dev;
  } catch {
    return fallback;
  }
  const known = caselessByDevice.get(device);
  if (known !== undefined) return known;
  let answer = fallback;
  for (let at = path; ; ) {
    const parent = paths.dirname(at);
    if (parent === at) break;
    const name = paths.basename(at);
    const swapped = swapCase(name);
    let parentDevice: number | null = null;
    try {
      parentDevice = statSync(parent).dev;
    } catch {
      break;
    }
    // the entry lives in its parent's folder: only a parent on this volume speaks for it
    if (swapped !== name && parentDevice === device) {
      try {
        const original = statSync(at);
        const other = statSync(paths.join(parent, swapped));
        answer = other.ino === original.ino && other.dev === original.dev;
      } catch {
        answer = false;
      }
      caselessByDevice.set(device, answer);
      return answer;
    }
    at = parent;
  }
  caselessByDevice.set(device, answer);
  return answer;
}

/** The host an ssh-transport remote names — `ssh://[user@]host[:port]/…`
 * (and `git+ssh`, `ssh+git`) or scp-like `[user@]host:path` — else null. */
export function sshHostOf(url: string): string | null {
  const text = url.trim();
  const scheme = /^([a-zA-Z][a-zA-Z0-9+.-]*):\/\/(?:[^@/]*@)?(\[[^\]]+\]|[^/:?#]+)/.exec(text);
  if (scheme !== null) {
    const name = scheme[1]?.toLowerCase();
    return name === "ssh" || name === "git+ssh" || name === "ssh+git" ? (scheme[2] ?? null) : null;
  }
  if (/^[A-Za-z]:[\\/]/.test(text) || text.startsWith("\\\\")) return null;
  const scp = /^(?:[^@/\s]+@)?([^:/\s]+):(?!\/\/)/.exec(text);
  if (scp === null) return null;
  const host = scp[1] ?? "";
  return host.length > 1 ? host : null; // one letter is a drive (`c:/…`)
}

/** `git remote -v` → one fetch URL per remote, in git's order. */
export function parseRemotes(raw: string): PlaceRemote[] {
  const remotes: PlaceRemote[] = [];
  const seen = new Set<string>();
  for (const line of raw.split("\n")) {
    const match = /^(\S+)\t(.+?) \((fetch|push)\)$/.exec(line);
    if (match === null || match[3] !== "fetch") continue;
    const name = match[1] ?? "";
    if (seen.has(name)) continue;
    seen.add(name);
    remotes.push({ name, url: match[2] ?? "" });
  }
  return remotes;
}

/** The identity remote's name (§4.1 E1): the branch's push remote › the
 * repository's push default › `origin` › the only remote. A name that is not
 * one of the remotes is passed over. */
export function pickPushRemote(
  remotes: readonly PlaceRemote[],
  config: ReadonlyMap<string, string>,
  branch: string | null,
): string | null {
  const names = new Set(remotes.map((remote) => remote.name));
  const ladder = [
    branch === null ? undefined : config.get(`branch.${branch}.pushremote`),
    config.get("remote.pushdefault"),
    "origin",
    remotes.length === 1 ? remotes[0]?.name : undefined,
  ];
  for (const name of ladder) if (name !== undefined && names.has(name)) return name;
  return null;
}

/** `git config -z --get-regexp` → key → value (the first value of a key). */
function parseConfigZ(raw: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const record of raw.split("\0")) {
    if (record === "") continue;
    const newline = record.indexOf("\n");
    const key = newline === -1 ? record : record.slice(0, newline);
    const value = newline === -1 ? "" : record.slice(newline + 1);
    if (!out.has(key)) out.set(key, value);
  }
  return out;
}

/** The first-parent chain's commits at the sample depths (newest first in). */
export function samplesOf(chain: readonly string[]): PlaceSample[] {
  const samples: PlaceSample[] = [];
  for (const depth of DEPTHS) {
    const sha = chain[depth];
    if (sha !== undefined && SHA.test(sha)) samples.push({ sha, depth });
  }
  return samples;
}

function digest(parts: unknown): string {
  return createHash("sha256").update(JSON.stringify(parts)).digest("hex").slice(0, 32);
}

function isDubious(run: GitRun): boolean {
  return /dubious ownership/i.test(run.stderr);
}

function lines(raw: string): string[] {
  return raw
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
}

/** One place's git, every call under the question's budget. */
function gitIn(reading: Reading, cwd: string) {
  return (args: readonly string[], input?: string): Promise<GitRun> => {
    if (Date.now() > reading.deadline) throw new BudgetSpent();
    return runGit(cwd, args, {
      timeoutMs: PLACE_FACTS.GIT_TIMEOUT_MS,
      maxBuffer: 4 * 1024 * 1024,
      ...(input !== undefined ? { input } : {}),
    });
  };
}

async function sshAlias(reading: Reading, host: string): Promise<string | null> {
  if (!SSH_HOST.test(host)) return null;
  const now = Date.now();
  const cached = sshCache.get(host);
  if (cached !== undefined && now - cached.at < PLACE_FACTS.SSH_CACHE_MS) return cached.hostname;
  let asked = reading.ssh.get(host);
  if (asked === undefined) {
    if (now > reading.deadline) throw new BudgetSpent();
    asked = runScrubbed("ssh", ["-G", host], {
      env: scrubbedEnvironment(process.env),
      timeoutMs: PLACE_FACTS.SSH_TIMEOUT_MS,
      maxBuffer: 256 * 1024,
    }).then((run) => {
      const named = run.ok ? /^hostname\s+(\S+)\s*$/im.exec(run.stdout)?.[1] : undefined;
      const hostname = named !== undefined && SSH_HOST.test(named) ? named.toLowerCase() : null;
      const answer = hostname !== null && hostname !== host.toLowerCase() ? hostname : null;
      sshCache.set(host, { at: Date.now(), hostname: answer });
      return answer;
    });
    reading.ssh.set(host, asked);
  }
  return asked;
}

interface Cheap {
  key: string;
  toplevel: string;
  shallow: boolean;
  branch: string | null;
  head: string | null;
}

/** The cheap read: enough to say whether anything a full read would see moved. */
async function cheapRead(
  run: ReturnType<typeof gitIn>,
  cwd: string,
): Promise<Cheap | PlaceGitRefusal | null> {
  const where = await run([
    "rev-parse",
    "--absolute-git-dir",
    "--git-common-dir",
    "--is-shallow-repository",
    "--show-toplevel",
  ]);
  if (!where.ok) return isDubious(where) ? "dubious-ownership" : null;
  const [gitDir, commonRaw, shallowRaw, toplevel] = lines(where.stdout);
  if (gitDir === undefined || commonRaw === undefined || toplevel === undefined) return null;
  const common = resolve(cwd, commonRaw);
  const symbolic = await run(["symbolic-ref", "-q", "HEAD"]);
  const ref = symbolic.ok ? symbolic.stdout.trim() : "";
  const branch = ref.startsWith("refs/heads/") ? ref.slice("refs/heads/".length) : null;
  const tip = await run(["rev-parse", "-q", "--verify", "HEAD^{commit}"]);
  const head = tip.ok && SHA.test(tip.stdout.trim()) ? tip.stdout.trim() : null;
  const mtime = (path: string): number | null => {
    try {
      return statSync(path).mtimeMs;
    } catch {
      return null;
    }
  };
  const shallow = shallowRaw === "true";
  return {
    key: digest([
      gitDir,
      common,
      toplevel,
      shallow,
      ref,
      head,
      mtime(resolve(common, "config")),
      mtime(resolve(gitDir, "config.worktree")),
      mtime(resolve(common, "worktrees")),
    ]),
    toplevel,
    shallow,
    branch,
    head,
  };
}

async function fullRead(
  reading: Reading,
  run: ReturnType<typeof gitIn>,
  cheap: Cheap,
): Promise<PlaceGitRead> {
  const listed = await run(["remote", "-v"]);
  const remotes = listed.ok ? parseRemotes(listed.stdout) : [];
  const pushConfig = await run([
    "config",
    "-z",
    "--get-regexp",
    "^(remote\\.pushdefault|branch\\..+\\.pushremote)$",
  ]);
  const pushRemote = pickPushRemote(
    remotes,
    pushConfig.ok ? parseConfigZ(pushConfig.stdout) : new Map(),
    cheap.branch,
  );
  let root: string | null = null;
  let samples: PlaceSample[] = [];
  if (cheap.head !== null && !cheap.shallow) {
    const walked = await run([
      "rev-list",
      "--first-parent",
      "--max-parents=0",
      "--format=%T",
      "HEAD",
    ]);
    if (walked.ok) {
      const [commit, tree] = lines(walked.stdout);
      const sha = commit?.startsWith("commit ") ? commit.slice(7) : undefined;
      if (sha !== undefined && SHA.test(sha) && tree !== undefined && !EMPTY_TREES.has(tree))
        root = sha;
    }
    const chain = await run(["rev-list", "--first-parent", `--max-count=${MAX_DEPTH + 1}`, "HEAD"]);
    if (chain.ok) samples = samplesOf(lines(chain.stdout));
  }
  const top = realOrNull(cheap.toplevel) ?? cheap.toplevel;
  let worktreeOf: string | null = null;
  const worktrees: PlaceGitRead["worktrees"] = [];
  const list = await run(["worktree", "list", "--porcelain"]);
  if (list.ok) {
    const entries = parseWorktreeList(list.stdout);
    const main = entries[0];
    const mainReal = main === undefined ? null : (realOrNull(main.path) ?? main.path);
    if (main !== undefined && mainReal !== top) worktreeOf = mainReal;
    for (const entry of entries) {
      if (worktrees.length >= PLACE_FACTS.WORKTREES_MAX) break;
      if (entry.bare || entry.prunable) continue;
      const real = realOrNull(entry.path);
      if (real === null || real === top || !isDirectory(real)) continue;
      worktrees.push({ path: real, branch: entry.branch });
    }
  }
  const sshAliases: Record<string, string> = {};
  for (const remote of remotes) {
    const host = sshHostOf(remote.url);
    if (host === null || host in sshAliases) continue;
    const hostname = await sshAlias(reading, host);
    if (hostname !== null) sshAliases[host] = hostname;
  }
  return {
    head: cheap.head,
    branch: cheap.branch,
    shallow: cheap.shallow,
    root,
    remotes,
    pushRemote,
    sshAliases,
    toplevel: top,
    worktreeOf,
    worktrees,
    samples,
  };
}

/** The candidates a place's hits are looked for among: same root, hex-checked. */
function candidatesFor(reading: Reading, root: string): PlaceSampleSet[] {
  const out: PlaceSampleSet[] = [];
  for (const peer of reading.peers) {
    if (peer.root !== root || typeof peer.placeId !== "string") continue;
    const samples = (Array.isArray(peer.samples) ? peer.samples : [])
      .filter(
        (sample) =>
          typeof sample?.sha === "string" &&
          SHA.test(sample.sha) &&
          Number.isInteger(sample.depth) &&
          sample.depth >= 0 &&
          sample.depth <= MAX_DEPTH,
      )
      .sort((a, b) => a.depth - b.depth);
    if (samples.length > 0) out.push({ placeId: peer.placeId, root, samples });
  }
  return out.sort((a, b) => (a.placeId < b.placeId ? -1 : a.placeId > b.placeId ? 1 : 0));
}

async function hitsOf(
  run: ReturnType<typeof gitIn>,
  head: string,
  candidates: readonly PlaceSampleSet[],
): Promise<PlaceHit[]> {
  if (candidates.length === 0) return [];
  const shas = [...new Set(candidates.flatMap((c) => c.samples.map((s) => s.sha)))];
  const checked = await run(
    ["cat-file", "--batch-check=%(objectname) %(objecttype)"],
    `${shas.join("\n")}\n`,
  );
  const held = new Set<string>();
  if (checked.ok)
    for (const line of lines(checked.stdout)) {
      const [sha, type] = line.split(" ");
      if (sha !== undefined && type === "commit") held.add(sha);
    }
  const ancestor = new Map<string, boolean>([[head, true]]);
  const hits: PlaceHit[] = [];
  for (const candidate of candidates) {
    for (const sample of candidate.samples) {
      if (!held.has(sample.sha)) continue;
      let answer = ancestor.get(sample.sha);
      if (answer === undefined) {
        const asked = await run(["merge-base", "--is-ancestor", sample.sha, "HEAD"]);
        answer = asked.code === 0;
        ancestor.set(sample.sha, answer);
      }
      if (answer) {
        hits.push({ placeId: candidate.placeId, sha: sample.sha, depth: sample.depth });
        break; // the shallowest held; every deeper one is held too
      }
    }
  }
  return hits;
}

async function readPlace(
  reading: Reading,
  entry: PlaceFactsArgs["places"][number],
): Promise<PlaceRead> {
  const asked = entry.path;
  const paths = reading.platform === "win32" ? win32 : posix;
  if (!paths.isAbsolute(asked)) throw new Error("not an absolute path");
  const exists = isDirectory(asked);
  const real = exists ? realOrNull(asked) : null;
  const canonical = real ?? asked;
  const mount = mountPointOf(canonical, reading.platform);
  const mounted = mount === null || existsSync(mount);
  const caseless = exists
    ? caselessAt(canonical, reading.platform)
    : reading.platform === "darwin" || reading.platform === "win32";
  const kind = placeKind(canonical, reading, reading.platform, caseless);
  const homeRelative = homeRelativeOf(canonical, reading.home, reading.platform, caseless);
  const base = {
    path: asked,
    skipped: false as const,
    canonical,
    exists,
    mounted,
    caseless,
    kind,
    homeRelative,
  };
  if (!exists) return { ...base, git: null, gitRefused: null, key: null, hits: [], hitsKey: null };
  const run = gitIn(reading, canonical);
  const cheap = await cheapRead(run, canonical);
  if (cheap === null || cheap === "dubious-ownership")
    return { ...base, git: null, gitRefused: cheap, key: null, hits: [], hitsKey: null };
  const known = entry.known;
  const unchanged = known?.key === cheap.key;
  const git = unchanged ? ("unchanged" as const) : await fullRead(reading, run, cheap);
  const root = git === "unchanged" ? (known?.root ?? null) : git.root;
  if (cheap.head === null || root === null)
    return { ...base, git, gitRefused: null, key: cheap.key, hits: [], hitsKey: null };
  const candidates = candidatesFor(reading, root);
  const hitsKey = digest([cheap.head, candidates]);
  const hits =
    known?.hitsKey === hitsKey ? ("unchanged" as const) : await hitsOf(run, cheap.head, candidates);
  return { ...base, git, gitRefused: null, key: cheap.key, hits, hitsKey };
}

/** The system's temporary folders, real and as spelled (`/tmp` is
 * `/private/tmp` on macOS; both are said). */
function temporaryFolders(platform: NodeJS.Platform): string[] {
  const spelled =
    platform === "win32"
      ? [tmpdir()]
      : [tmpdir(), "/tmp", "/private/tmp", "/var/tmp", "/var/folders", "/private/var/folders"];
  const out = new Set<string>();
  for (const path of spelled) {
    out.add(path);
    const real = realOrNull(path);
    if (real !== null) out.add(real);
  }
  return [...out];
}

/** The `placeFacts` op: each place read in its turn, PARALLEL_PLACES at once,
 * until the budget is spent. */
export async function readPlaces(
  args: PlaceFactsArgs,
  options: {
    platform?: NodeJS.Platform;
    home?: string;
    /** a test's temporary folders (default: the system's) */
    temps?: string[];
    budgetMs?: number;
  } = {},
): Promise<PlaceFactsValue> {
  const platform = options.platform ?? process.platform;
  const homeSpelled = options.home ?? homedir();
  const home = realOrNull(homeSpelled) ?? homeSpelled;
  const reading: Reading = {
    deadline: Date.now() + (options.budgetMs ?? PLACE_FACTS.OP_BUDGET_MS),
    platform,
    home,
    temps: options.temps ?? temporaryFolders(platform),
    taskRoots: (Array.isArray(args.taskRoots) ? args.taskRoots : [])
      .filter((glob): glob is string => typeof glob === "string" && glob.length > 0)
      .map((glob) => taskRootSegments(glob, home, platform)),
    peers: Array.isArray(args.peers) ? args.peers : [],
    ssh: new Map(),
  };
  const asked = Array.isArray(args.places) ? args.places : [];
  const places: PlaceRead[] = new Array(asked.length);
  let next = 0;
  const lane = async (): Promise<void> => {
    for (;;) {
      const index = next;
      next += 1;
      const entry = asked[index];
      if (entry === undefined) return;
      const path = typeof entry.path === "string" ? entry.path : String(entry.path);
      if (Date.now() > reading.deadline) {
        places[index] = { path, skipped: true };
        continue;
      }
      try {
        places[index] = await readPlace(reading, { ...entry, path });
      } catch {
        // the budget ran out mid-place, or the place could not be read at
        // all: the scanner asks again next pass, never trusting half a read
        places[index] = { path, skipped: true };
      }
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, PLACE_FACTS.PARALLEL_PLACES) }, lane));
  return { places };
}
