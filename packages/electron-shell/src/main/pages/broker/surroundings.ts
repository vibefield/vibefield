// EY-1 (2026-11-19) — THE PAGE ENGINE'S SURROUNDINGS. Main runs one pinned agent-browser engine
// per run (BU-20) as its own direct child, in daemon mode, and speaks to it over the daemon's
// socket. This module makes what that engine lives in: its folders, and the environment it starts
// with, built from nothing. The environment is an allowlist: the engine never inherits main's, so
// no FIELD_*, FIELDD_* or VIBEFIELD_* name, no key and no host fact reaches it (EL7). It is the
// shape sitting 2 measured (EY-S2-01B): the agent's keys, AGENT_BROWSER_DAEMON and a random
// session, nothing else.
//
// The folders: one root per engine instance, `<parent>/vf-<uid>/pg-<8 hex>`, holding `sock`,
// `home`, `tmp` and an empty `cwd`, each 0700. The parent is /tmp in the product (the socket
// alias's own, item 345), so the daemon's socket,
// `<root>/sock/namespaces/pages/run/<session>.sock`, fits macOS's sun_path whatever the data root
// is. `vf-<uid>` is the folder item 345's alias keeps, held here to the same rules: this uid's,
// mode 0700 exactly, never a link, under a parent no other account can swap entries in. A refusal
// names the alias folder's own paths and modes, never a value.
//
// No config file is written. The daemon reads none (at v0.41.0 only the CLI reads
// AGENT_BROWSER_CONFIG, flags.rs:373), and main never runs the CLI.
//
// The release binary's stream port (2026-11-24). The release build of the pin always starts a
// stream server on a loopback TCP port, whose POST /api/command relays any command to the engine's
// socket for any local process of any account: around the bridge, the windows and the broker's own
// refusals. Main starts the pin's SOURCE BUILD alone (engine-identity.ts), and starts it with that
// build's three switches on, each read by the engine once, at its start:
// - AGENT_BROWSER_NO_STREAM: no stream server, so no TCP listener and no command relay; `stream
//   enable`, `inspect` and the dashboard refuse. No `<session>.stream` file is written.
// - AGENT_BROWSER_PEER_PIDS, naming ONE pid, main's own: the engine drops a connection to its
//   socket unless the peer's uid is the engine's own AND its pid is on the list. Every exchange
//   with the engine is main's (the broker's calls, the supervisor's ready poll and its close), so
//   the list is main alone, for the engine's whole life. The build's other peer switch,
//   AGENT_BROWSER_PEER_UID_CHECK, admits ANY process of this uid: a same-uid process could still
//   send the engine a `launch` that points it at another browser, which the pid list refuses. The
//   pid list checks the uid as well, so the uid switch would add nothing and is not set.
// - AGENT_BROWSER_HIDE_CDP_URL: the engine withholds the address it is attached to when that
//   address carries a query string or userinfo, or belongs to a provider session. It is on as a
//   belt. It does NOT keep the bridge's own address, whose key is in the PATH, which the switch
//   does not read: what keeps that address is the peer list (only main can ask the engine), main
//   never asking (`cdp_url` is no action of the pages rows), and the key being spent at its first
//   use.
// Once an engine is ready, main reads its socket folder: any `.stream` file there means a stream
// server came up after all, and the engine is refused and stopped (engine-supervisor.ts).

import { chmodSync, lstatSync, mkdirSync, readdirSync, type Stats, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { SUN_PATH_MAX_BYTES, socketPathBytes } from "@vibefield/contracts";

/** The daemon's namespace: its socket lives under `<sock>/namespaces/pages/run/`. */
export const PAGES_ENGINE_NAMESPACE = "pages";
/** The only PATH the engine gets: the system's own folders, never the person's. */
export const PAGES_ENGINE_PATH = "/usr/bin:/bin:/usr/sbin:/sbin";
/** The daemon's own idle exit, finite (never 0): it bounds an orphan's life if main dies without
 * stopping it. Provisional: EY-1's desk row measures it (2026-11-19).
 *
 * The engine's idle exit before main's reap (2026-11-24): MAIN owns how long an idle engine lives
 * (the broker's reap, PAGES_IDLE_REAP_MS, counted from a run's last call). This bound is only the
 * orphan's, so it is twice main's reap, and a row holds the order. It was 120 s against main's
 * 300 s: the engine ended itself between two calls and the agent's element refs went with it. The
 * engine counts from its last COMMAND, received or answered, and an explicit bound applies to
 * every browser (daemon.rs at v0.41.0). One case is left to the broker: a run whose calls keep
 * being answered by main before any reaches the engine (a held page, say) re-arms main's reap
 * each time and sends the engine nothing, so past this bound the engine still ends first.
 * Errata (2026-11-24, the idle reap's clock): that case is closed, and "counted from a run's last
 * call" above is no longer so for a run with an engine launched. The broker's reap counts from the
 * engine's last command of main's, sent or answered, which is where the engine counts from. */
export const PAGES_ENGINE_IDLE_TIMEOUT_MS = 600_000;
/** The run's mark a smoke gives every process it starts (run-smoke.mjs; smoke-census.mjs). */
export const SMOKE_RUN_ENV = "VF_SMOKE_RUN";

/** The three switches of the pin's SOURCE BUILD (2026-11-24), by the names its bytes carry and the
 * release build's do not: the stream server off, the socket's peers named, the CDP address
 * withheld. Main starts no engine without all three (the environment below), and a package's
 * engine is told from a release build by them (engine-identity.ts). */
export const PAGES_ENGINE_SWITCHES = [
  "AGENT_BROWSER_NO_STREAM",
  "AGENT_BROWSER_PEER_PIDS",
  "AGENT_BROWSER_HIDE_CDP_URL",
] as const;

/** Every name the engine's environment holds, and no other (the mark only in a smoke). */
export const PAGES_ENGINE_ENV_KEYS = [
  "PATH",
  "HOME",
  "TMPDIR",
  "AGENT_BROWSER_SOCKET_DIR",
  "AGENT_BROWSER_NAMESPACE",
  "AGENT_BROWSER_IDLE_TIMEOUT_MS",
  "AGENT_BROWSER_DAEMON",
  "AGENT_BROWSER_SESSION",
  ...PAGES_ENGINE_SWITCHES,
] as const;

/** A pid as the engine's peer list reads one: a whole number above 0 that fits its 32 bits. */
const PID_MAX = 0x7fff_ffff;
const ONE_PID = /^[1-9][0-9]{0,9}$/u;
const SESSION = /^[0-9a-f]{16}$/u;
const ROOT_ID = /^[0-9a-f]{8}$/u;
const FOLDERS = ["sock", "home", "tmp", "cwd"] as const;
const RUN_FOLDERS = ["namespaces", PAGES_ENGINE_NAMESPACE, "run"] as const;
/** What an engine environment never holds, whatever else is said: daemon secrets and host facts
 * (EL7), the switch that turns Electron into node, the three names that would make the daemon
 * launch or connect on its own (actions.rs:4319-4330 at v0.41.0), and the two that ask it for a
 * listener of its own (the stream's fixed port, the standalone dashboard). */
const FORBIDDEN_PREFIXES = ["FIELD_", "FIELDD_", "VIBEFIELD_", "VF_"] as const;
const FORBIDDEN_NAMES = [
  "ELECTRON_RUN_AS_NODE",
  "AGENT_BROWSER_CDP",
  "AGENT_BROWSER_AUTO_CONNECT",
  "AGENT_BROWSER_PROVIDER",
  "AGENT_BROWSER_STREAM_PORT",
  "AGENT_BROWSER_DASHBOARD",
] as const;

export class PagesSurroundingsError extends Error {
  readonly code = "pages-surroundings-refused";
}

function refuse(message: string): never {
  throw new PagesSurroundingsError(message);
}

/** An fs failure's code alone: Node's own message would carry the paths it was given. */
function errno(error: unknown): string {
  return (error as NodeJS.ErrnoException).code ?? "an unknown error";
}

/** One engine instance's folders, and its daemon's session and socket. */
export interface PagesSurroundings {
  readonly root: string;
  readonly socketDir: string;
  readonly home: string;
  readonly tmp: string;
  readonly cwd: string;
  readonly session: string;
  readonly socketPath: string;
}

/** `<parent>/vf-<uid>/pg-<rootId>`: pure, so the socket path is judged before anything is made. */
export function pagesRootFor(parent: string, uid: number, rootId: string): string {
  if (!parent.startsWith("/")) refuse("the parent must be an absolute path");
  if (!Number.isSafeInteger(uid) || uid < 0) refuse("the uid must be a whole number");
  if (!ROOT_ID.test(rootId)) refuse("the root id must be 8 lowercase hex");
  return join(parent, `vf-${uid}`, `pg-${rootId}`);
}

/** The daemon's socket under a root, as the engine derives it (connection.rs:103-144,
 * session_files.rs:58 at v0.41.0). */
export function pagesSocketPathFor(root: string, session: string): string {
  if (!SESSION.test(session)) refuse("the session must be 16 lowercase hex");
  return join(root, "sock", ...RUN_FOLDERS, `${session}.sock`);
}

export interface PagesSurroundingsOptions {
  /** Where `vf-<uid>` lives: /tmp in the product (`socketAliasParentFrom`), a test's own folder in
   * a test. */
  readonly parent: string;
  /** The uid the folders must belong to: the process's own in the product. */
  readonly uid?: number;
  /** Random lowercase hex of `bytes` bytes (crypto's in the product). */
  readonly randomHex: (bytes: number) => string;
  /** The socket path's byte bound: sun_path's in the product. A test whose parent is longer than
   * /tmp raises it. */
  readonly maxSocketPathBytes?: number;
}

/** The parent is a directory owned by root or by this process, and sticky if others may write it
 * (item 345's rule). */
function checkParent(parent: string): void {
  let found: Stats;
  try {
    found = statSync(parent); // following: /tmp is a link to /private/tmp
  } catch (error) {
    refuse(`${parent}: ${errno(error)}`);
  }
  const self = process.getuid?.() ?? 0;
  const mode = found.mode & 0o7777;
  if (!found.isDirectory()) refuse(`${parent} is not a directory`);
  if (found.uid !== 0 && found.uid !== self) refuse(`${parent} belongs to uid ${found.uid}`);
  if (mode & 0o022 && !(mode & 0o1000)) {
    refuse(`${parent} is writable by others without the sticky bit (mode 0${mode.toString(8)})`);
  }
}

/** `vf-<uid>` as FOUND: made 0700 here if absent; an existing one is judged, never chmodded. */
function ensureUidFolder(folder: string, uid: number): void {
  try {
    mkdirSync(folder, { mode: 0o700 });
    chmodSync(folder, 0o700);
  } catch (error) {
    if (errno(error) !== "EEXIST") refuse(`${folder}: ${errno(error)}`);
  }
  let found: Stats;
  try {
    found = lstatSync(folder);
  } catch (error) {
    refuse(`${folder}: ${errno(error)}`);
  }
  if (found.isSymbolicLink()) refuse(`${folder} is a link`);
  if (!found.isDirectory()) refuse(`${folder} is not a directory`);
  if (found.uid !== uid) refuse(`${folder} belongs to uid ${found.uid}, not ${uid}`);
  const mode = found.mode & 0o7777;
  if (mode !== 0o700) refuse(`${folder} has mode 0${mode.toString(8)}, not 0700`);
}

/** A new 0700 folder. One that exists already throws EEXIST: it is never reused. */
function makeFresh(path: string): void {
  mkdirSync(path, { mode: 0o700 });
  chmodSync(path, 0o700);
}

/** A fresh root under `vf-<uid>`: a new id when one is taken, three tries in all. */
function makeRoot(parent: string, uid: number, randomHex: (bytes: number) => string): string {
  for (let tries = 1; tries <= 3; tries += 1) {
    const root = pagesRootFor(parent, uid, randomHex(4));
    try {
      makeFresh(root);
      return root;
    } catch (error) {
      if (errno(error) !== "EEXIST") refuse(`${root}: ${errno(error)}`);
    }
  }
  return refuse(`no fresh root under ${join(parent, `vf-${uid}`)} in three tries`);
}

/** Makes one engine instance's surroundings: a fresh root and its four 0700 folders, the socket's
 * run folder, and a random session. The socket path is judged against its bound before anything is
 * made: the longest root has the same length as any other. */
export function makePagesSurroundings(opts: PagesSurroundingsOptions): PagesSurroundings {
  const uid = opts.uid ?? process.getuid?.() ?? 0;
  const max = opts.maxSocketPathBytes ?? SUN_PATH_MAX_BYTES;
  const session = opts.randomHex(8);
  const probe = pagesSocketPathFor(pagesRootFor(opts.parent, uid, "00000000"), session);
  if (socketPathBytes(probe) > max) {
    refuse(`the engine's socket path would be ${socketPathBytes(probe)} bytes, over ${max}`);
  }
  checkParent(opts.parent);
  ensureUidFolder(join(opts.parent, `vf-${uid}`), uid);
  const root = makeRoot(opts.parent, uid, opts.randomHex);
  for (const name of FOLDERS) makeFresh(join(root, name));
  let run = join(root, "sock");
  for (const name of RUN_FOLDERS) {
    run = join(run, name);
    makeFresh(run);
  }
  return {
    root,
    socketDir: join(root, "sock"),
    home: join(root, "home"),
    tmp: join(root, "tmp"),
    cwd: join(root, "cwd"),
    session,
    socketPath: pagesSocketPathFor(root, session),
  };
}

/** Whether an instance's cwd still holds nothing: the engine starts in an empty folder. */
export function pagesCwdIsEmpty(s: PagesSurroundings): boolean {
  return readdirSync(s.cwd).length === 0;
}

/** The stream server's port file, as an engine with the stream ON writes it: `<session>.stream`
 * beside its socket, before it binds the socket (daemon.rs:104-126 and session_files.rs:63 at
 * v0.41.0). An engine with the stream off writes none. */
export function pagesStreamFileFor(s: PagesSurroundings): string {
  return join(dirname(s.socketPath), `${s.session}.stream`);
}

/** What a READY engine's socket folder shows of its stream. `off`: the folder holds no `.stream`
 * entry at all, the session's or any other. `on`: it holds one. The folder is the instance's own
 * and was made empty, so the engine alone wrote in it. `unread` (2026-11-24): the folder could not
 * be read, so main cannot tell. That is main's own trouble with a folder it made and says nothing
 * of the build, so it has a word of its own: until this day it was answered as not off, and the
 * supervisor took it for a stream that is on. */
export type PagesStreamShown = "off" | "on" | "unread";

export function pagesStreamShown(s: PagesSurroundings): PagesStreamShown {
  try {
    return readdirSync(dirname(s.socketPath)).some((name) => name.endsWith(".stream"))
      ? "on"
      : "off";
  } catch {
    return "unread";
  }
}

/** Whether a READY engine's socket folder shows its stream off. A folder that cannot be read is
 * not shown off: what main cannot tell, it refuses. */
export function pagesStreamIsOff(s: PagesSurroundings): boolean {
  return pagesStreamShown(s) === "off";
}

/** The engine's whole environment, built from nothing, with the source build's three switches on.
 * `peerPid` is the ONE process the engine's socket admits: main's own pid in the product.
 * `smokeRun` is the run's mark, handed on only in a smoke, so the smoke's census finds the engine
 * as it finds every process the smoke started. */
export function pagesEngineEnv(
  s: PagesSurroundings,
  o: { readonly peerPid: number; readonly smokeRun?: string | undefined },
): Readonly<Record<string, string>> {
  if (!Number.isSafeInteger(o.peerPid) || o.peerPid < 1 || o.peerPid > PID_MAX) {
    refuse("the engine's peer is one process: a pid above 0");
  }
  const env: Record<string, string> = {
    PATH: PAGES_ENGINE_PATH,
    HOME: s.home,
    TMPDIR: s.tmp,
    AGENT_BROWSER_SOCKET_DIR: s.socketDir,
    AGENT_BROWSER_NAMESPACE: PAGES_ENGINE_NAMESPACE,
    AGENT_BROWSER_IDLE_TIMEOUT_MS: String(PAGES_ENGINE_IDLE_TIMEOUT_MS),
    AGENT_BROWSER_DAEMON: "1",
    AGENT_BROWSER_SESSION: s.session,
    AGENT_BROWSER_NO_STREAM: "1",
    AGENT_BROWSER_PEER_PIDS: String(o.peerPid),
    AGENT_BROWSER_HIDE_CDP_URL: "1",
  };
  if (o.smokeRun !== undefined) {
    if (o.smokeRun === "" || /[\0\n\r]/u.test(o.smokeRun)) {
      refuse("the smoke's mark is a single-line name");
    }
    env[SMOKE_RUN_ENV] = o.smokeRun;
  }
  const found = pagesEngineEnvViolations(env, s, {
    smoke: o.smokeRun !== undefined,
    peerPid: o.peerPid,
  });
  if (found.length > 0) refuse(`the engine's environment was refused: ${found.join(", ")}`);
  return Object.freeze(env);
}

function under(root: string, path: string | undefined): boolean {
  return typeof path === "string" && (path === root || path.startsWith(`${root}/`));
}

function forbiddenName(key: string): boolean {
  const upper = key.toUpperCase();
  return (
    FORBIDDEN_NAMES.some((name) => upper === name) ||
    FORBIDDEN_PREFIXES.some((prefix) => upper.startsWith(prefix))
  );
}

/** Every way an environment departs from the engine's allowlist, as `kind:NAME`: names, never
 * values. The three switches are REQUIRED, each at the one value main sets: an environment with a
 * switch missing or off is refused, so no engine is started with its stream on, its socket open to
 * every process of this uid, or its address told. The peer list is ONE pid (a blank value admits no
 * one, a list admits others); when `peerPid` is given it is that pid. */
export function pagesEngineEnvViolations(
  env: Readonly<Record<string, string | undefined>>,
  s: PagesSurroundings,
  o: { readonly smoke: boolean; readonly peerPid?: number | undefined },
): string[] {
  const out: string[] = [];
  const allowed = new Set<string>(PAGES_ENGINE_ENV_KEYS);
  if (o.smoke) allowed.add(SMOKE_RUN_ENV);
  for (const key of Object.keys(env).sort()) {
    if (typeof env[key] !== "string") out.push(`not-a-string:${key}`);
    if (allowed.has(key)) continue;
    out.push(`${forbiddenName(key) ? "forbidden" : "unexpected"}:${key}`);
  }
  for (const key of allowed) if (!(key in env)) out.push(`missing:${key}`);
  if (env.PATH !== undefined && env.PATH !== PAGES_ENGINE_PATH) out.push("path-not-fixed:PATH");
  const idle = env.AGENT_BROWSER_IDLE_TIMEOUT_MS;
  if (idle !== undefined && !/^[1-9][0-9]*$/u.test(idle)) {
    out.push("idle-not-finite:AGENT_BROWSER_IDLE_TIMEOUT_MS");
  }
  if (env.AGENT_BROWSER_DAEMON !== undefined && env.AGENT_BROWSER_DAEMON !== "1") {
    out.push("wrong-value:AGENT_BROWSER_DAEMON");
  }
  if (env.AGENT_BROWSER_SESSION !== undefined && env.AGENT_BROWSER_SESSION !== s.session) {
    out.push("not-this-session:AGENT_BROWSER_SESSION");
  }
  const namespace = env.AGENT_BROWSER_NAMESPACE;
  if (namespace !== undefined && namespace !== PAGES_ENGINE_NAMESPACE) {
    out.push("wrong-value:AGENT_BROWSER_NAMESPACE");
  }
  for (const key of ["AGENT_BROWSER_NO_STREAM", "AGENT_BROWSER_HIDE_CDP_URL"] as const) {
    if (env[key] !== undefined && env[key] !== "1") out.push(`wrong-value:${key}`);
  }
  const peers = env.AGENT_BROWSER_PEER_PIDS;
  if (peers !== undefined) {
    if (!ONE_PID.test(peers) || Number(peers) > PID_MAX) {
      out.push("not-one-pid:AGENT_BROWSER_PEER_PIDS");
    } else if (o.peerPid !== undefined && peers !== String(o.peerPid)) {
      out.push("not-the-peer:AGENT_BROWSER_PEER_PIDS");
    }
  }
  for (const key of ["HOME", "TMPDIR", "AGENT_BROWSER_SOCKET_DIR"] as const) {
    if (env[key] !== undefined && !under(s.root, env[key])) out.push(`outside-root:${key}`);
  }
  return out;
}
