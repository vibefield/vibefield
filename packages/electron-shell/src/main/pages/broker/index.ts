// EY-1 (2026-11-19) — THE PAGES BROKER, MADE FOR MAIN. The cores take every effect as a seam; this
// module gives them the product's: the pinned record, the engine's spawn, the runner of
// `--version` and codesign, the socket alias's parent, and the smoke's mark. createPagesBroker
// joins them with the ports main wires: the control targets, the bridge and the windows. Before
// its first engine it sweeps the roots earlier mains left, and each instance's root ends with its
// engine (roots.ts).

import {
  type ExecFileException,
  type ExecFileOptionsWithStringEncoding,
  execFile,
  type SpawnOptions,
  spawn,
} from "node:child_process";
import { randomBytes } from "node:crypto";
import { constants, type Stats } from "node:fs";
import { lstat, open, unlink } from "node:fs/promises";
import { SOCKET_ALIAS_PARENT_ENV, socketAliasParentFrom } from "@vibefield/contracts";
import { PAGES_ENGINE_RECORD } from "@vibefield/contracts/pages-record";
import {
  type PagesBridgePort,
  type PagesBroker,
  PagesBrokerCore,
  type PagesLinkPort,
  type PagesMakerPort,
  type PagesPanesPort,
  type PagesStillsPort,
  type PagesTargetsPort,
  type PagesWindowsPort,
} from "./broker";
import {
  checkDevEngine,
  checkPackagedEngine,
  type PagesEngineIdentityDeps,
  type PagesEngineIdentityResult,
  type RunFile,
  readAppTeam,
} from "./engine-identity";
import { type EngineChild, PagesEngineSupervisor, type SpawnEngine } from "./engine-supervisor";
import { removePagesRoot, sweepStalePagesRoots } from "./roots";
import {
  makePagesSurroundings,
  PAGES_ENGINE_IDLE_TIMEOUT_MS,
  PAGES_ENGINE_PATH,
  type PagesSurroundings,
  SMOKE_RUN_ENV,
} from "./surroundings";

/** The engine child's spawn options. Main's DIRECT child, never detached, so main holds it and no
 * pid file is ever read; the environment and cwd given, and nothing else; every stream ignored,
 * since main needs none of the engine's output, and a pipe nobody drains can stall the engine once
 * its buffer fills. */
export function engineSpawnOptions(
  cwd: string,
  env: Readonly<Record<string, string>>,
): SpawnOptions {
  return { cwd, env: { ...env }, detached: false, stdio: ["ignore", "ignore", "ignore"] };
}

export type SpawnLike = (
  file: string,
  args: readonly string[],
  options: SpawnOptions,
) => EngineChild;

const nodeSpawn: SpawnLike = (file, args, options) => spawn(file, [...args], options);

/** The supervisor's spawn, as the product makes it. */
export function productionSpawnEngine(run: SpawnLike = nodeSpawn): SpawnEngine {
  return (file, args, o) => run(file, args, engineSpawnOptions(o.cwd, o.env));
}

/** What `--version` and codesign may print before they are cut off. */
export const RUN_FILE_MAX_BUFFER = 64 * 1024;

export type ExecFileLike = (
  file: string,
  args: readonly string[],
  options: ExecFileOptionsWithStringEncoding,
  done: (error: ExecFileException | null, stdout: string, stderr: string) => void,
) => unknown;

const nodeExecFile: ExecFileLike = (file, args, options, done) =>
  execFile(file, [...args], options, done);

/** A bounded run: exactly the environment and cwd given, ended at its timeout. */
export function runFileOptions(o: {
  readonly env: Readonly<Record<string, string>>;
  readonly cwd: string;
  readonly timeoutMs: number;
}): ExecFileOptionsWithStringEncoding {
  return {
    cwd: o.cwd,
    env: { ...o.env },
    timeout: o.timeoutMs,
    killSignal: "SIGKILL",
    maxBuffer: RUN_FILE_MAX_BUFFER,
    encoding: "utf8",
  };
}

/** The identity check's runner, as the product makes it: an exit code, or null when the run was
 * ended (its timeout) or never started. */
export function productionRunFile(exec: ExecFileLike = nodeExecFile): RunFile {
  return (file, args, o) =>
    new Promise((resolve) => {
      exec(file, args, runFileOptions(o), (error, stdout, stderr) => {
        const code = error === null ? 0 : typeof error.code === "number" ? error.code : null;
        resolve({ code, stdout, stderr });
      });
    });
}

/** What a stat says a path is, as the still guard reads it. */
function kindOf(stat: Stats): "directory" | "file" | "link" | "other" {
  if (stat.isSymbolicLink()) return "link";
  if (stat.isDirectory()) return "directory";
  return stat.isFile() ? "file" : "other";
}

/** A still's disk, as the product reads it (2026-11-24): node's fs, and nothing decided here.
 * - `lstat` never follows a link, and anything it cannot read is nothing there.
 * - `opened` opens read-only with O_NOFOLLOW, so a link at the name opens nothing, and O_NONBLOCK,
 *   so a pipe planted at the name cannot hold the open. The facts are the HANDLE's (`fstat`), and
 *   only a regular file's first bytes are read.
 * - `remove` unlinks the name: a link goes, never what it points at.
 * A platform with no uid (Windows) answers -1, which no folder or file is held to, so it takes no
 * still: its modes are not POSIX's, and the guard reads POSIX's. */
export function productionStills(): PagesStillsPort {
  return {
    uid: process.getuid?.() ?? -1,
    random: (bytes) => randomBytes(bytes),
    lstat: async (path) => {
      try {
        const stat = await lstat(path);
        return { kind: kindOf(stat), uid: stat.uid, mode: stat.mode & 0o7777 };
      } catch {
        return null;
      }
    },
    opened: async (path, bytes) => {
      let handle: Awaited<ReturnType<typeof open>>;
      try {
        handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
      } catch {
        return null;
      }
      try {
        const stat = await handle.stat();
        const facts = { kind: kindOf(stat), uid: stat.uid, nlink: stat.nlink, size: stat.size };
        if (facts.kind !== "file") return { facts, head: new Uint8Array(0) };
        const head = new Uint8Array(bytes);
        const { bytesRead } = await handle.read(head, 0, bytes, 0);
        return { facts, head: head.subarray(0, bytesRead) };
      } catch {
        return null;
      } finally {
        await handle.close().catch(() => undefined);
      }
    },
    remove: async (path) => {
      await unlink(path).catch(() => undefined);
    },
  };
}

/** The smoke's own switch for the testing engine kill, on main's command line: never an
 * environment variable, which whatever main starts would inherit. */
export const PAGES_DAEMON_KILL_FLAG = "--pages-daemon-kill";

export interface CreatePagesBrokerDeps {
  /** resources' pinned engine path: null when this build has none */
  readonly enginePath: () => string | null;
  /** a package is judged by its team, a development run by the record's bytes */
  readonly packaged: boolean;
  /** the .app bundle whose signature names the team (a package only) */
  readonly appBundlePath: string | null;
  /** main's own environment, read for two names: the socket alias's parent and the smoke's mark */
  readonly env: Readonly<Record<string, string | undefined>>;
  readonly targets: PagesTargetsPort;
  /** EY-1 (7b, 2026-11-19): custody's half of a run's own panes, and the pane store over it */
  readonly maker?: PagesMakerPort;
  readonly panes?: PagesPanesPort;
  readonly bridge: PagesBridgePort;
  /** the run's engine on the bridge at the epoch its launch armed (2026-11-24): the keyring's read */
  readonly link: PagesLinkPort;
  readonly windows: PagesWindowsPort;
  readonly spawn?: SpawnLike;
  readonly exec?: ExecFileLike;
  /** The testing engine kill's hook, passed only when pagesDaemonKillAsked; production passes
   * none, so no engine child is held for a kill. */
  readonly onSpawned?: (run: string, generation: number, child: EngineChild) => void;
  /** a still's disk; absent: the product's (node's fs). A row's own for a row. */
  readonly stills?: PagesStillsPort;
  /** Durations, sizes and states only. */
  readonly log?: (event: string, fields: Readonly<Record<string, number | string>>) => void;
  /** The broker's wall lines (PagesBrokerDeps.warn). */
  readonly warn?: (event: string, fields: Readonly<Record<string, number | string>>) => void;
}

/** Whether main may load the testing engine kill: only in a smoke run (its mark, not empty)
 * whose command line carries the flag. The mark alone gives none. */
export function pagesDaemonKillAsked(
  env: Readonly<Record<string, string | undefined>>,
  argv: readonly string[],
): boolean {
  const mark = env[SMOKE_RUN_ENV];
  return mark !== undefined && mark !== "" && argv.includes(PAGES_DAEMON_KILL_FLAG);
}

/** The broker main runs: nothing starts until a run's first call. */
export function createPagesBroker(deps: CreatePagesBrokerDeps): PagesBroker {
  const parent = socketAliasParentFrom(deps.env[SOCKET_ALIAS_PARENT_ENV]);
  const mark = deps.env[SMOKE_RUN_ENV];
  const run = productionRunFile(deps.exec);
  const host = `${process.platform}-${process.arch}`;
  const log = deps.log === undefined ? {} : { log: deps.log };
  let appTeam: Promise<string | null> | null = null;
  const identity = (path: string, s: PagesSurroundings): Promise<PagesEngineIdentityResult> => {
    const checks: PagesEngineIdentityDeps = {
      record: PAGES_ENGINE_RECORD,
      host,
      run,
      versionEnv: { PATH: PAGES_ENGINE_PATH, HOME: s.home, TMPDIR: s.tmp },
      cwd: s.cwd,
    };
    if (!deps.packaged) return checkDevEngine(path, checks);
    // the app's team is read once, from its own signature
    appTeam ??=
      deps.appBundlePath === null
        ? Promise.resolve(null)
        : readAppTeam(deps.appBundlePath, run, { env: { PATH: PAGES_ENGINE_PATH }, cwd: s.cwd });
    return appTeam.then((team) => checkPackagedEngine(path, team, checks));
  };
  const engines = new PagesEngineSupervisor({
    enginePath: deps.enginePath,
    identity,
    surroundings: () =>
      makePagesSurroundings({ parent, randomHex: (bytes) => randomBytes(bytes).toString("hex") }),
    smokeRun: mark === "" ? undefined : mark,
    spawn: productionSpawnEngine(deps.spawn),
    // a root whose newest entry is older than twice the idle bound: its engine has ended itself
    sweep: async () => {
      const swept = await sweepStalePagesRoots({
        parent,
        olderThanMs: 2 * PAGES_ENGINE_IDLE_TIMEOUT_MS,
      });
      deps.log?.("pages.roots.swept", { ...swept, skipped: swept.skipped ?? "no" });
    },
    forget: (s) => {
      removePagesRoot(s.root, { parent });
    },
    ...(deps.onSpawned === undefined ? {} : { onSpawned: deps.onSpawned }),
    ...log,
  });
  return new PagesBrokerCore({
    targets: deps.targets,
    bridge: deps.bridge,
    link: deps.link,
    windows: deps.windows,
    engines,
    stills: deps.stills ?? productionStills(),
    ...log,
    ...(deps.warn === undefined ? {} : { warn: deps.warn }),
    ...(deps.maker === undefined ? {} : { maker: deps.maker }),
    ...(deps.panes === undefined ? {} : { panes: deps.panes }),
  });
}
