import { type ChildProcess, spawn } from "node:child_process";
import { EventEmitter } from "node:events";
import { posix, resolve, sep } from "node:path";
import {
  ENV_PREFIXES,
  type ProcessRecord,
  ProcessSignalParams,
  ProcessSpawnParams,
  type ProcessSubEvent,
} from "@vibefield/contracts";
import { createNoopLogger, type Logger } from "@vibefield/logging";
import { RpcCallError } from "./native-link";
import { shimSpawn } from "./spawn-shim";

// ProcessService (plugin spec §17.1, P6): the ONLY door to plugin child
// processes. fieldd owns the process group and the termination ladder; plugin
// code never touches ambient child_process (the import wall enforces the SDK
// side; this service is the daemon side). Every child:
//   - runs with a MINIMAL, platform-shaped base env, plugin additions layered
//     under it, and every FIELD_*/FIELDD_* key stripped LAST (EL7 — the host
//     wins; daemon and plugin bearer tokens never reach a child, even via
//     params.env). WIN-3: that strip folds case on win32, where the env itself
//     does — an exact-prefix compare leaves `Field_Token` in place and the child
//     reads it back folded, a leak that fails NO test on unix (§4.2);
//   - is provenance-recorded (§15.5) and visible via process.stat/subscribe;
//   - dies no later than fieldd shutdown in v1 (stopAll).
//
// v1 executable policy (§17.1 "resolves executable policy" — recorded
// decision): an ABSOLUTE path, or a bare command name resolved via PATH.
// Relative paths are refused (no cwd-dependent surprises); a later rung can
// tighten this to per-plugin allowlists without an SDK break. On win32 that
// promise costs three more refusals, because three Windows spellings are
// working-directory-dependent while reading absolute-ish: `..\evil.exe`,
// the drive-relative `C:evil` (resolved against that drive's own cwd), and the
// current-drive-rooted `\evil.exe`. Drive-absolute and UNC paths are absolute
// and stay allowed.

const MAX_PROCS_PER_PLUGIN = 8;
/** §18.3-shaped restart ladder for restart:"on-crash" children. */
const RESTART_BASE_MS = 1_000;
const RESTART_MAX_MS = 30_000;
const TERM_GRACE_MS = 2_000;
/** uptime that counts as a healthy run and resets the backoff rung */
const CLEAN_RUN_MS = 60_000;

export interface ProcessServiceConfig {
  logger?: Logger;
  /** cwd confinement roots for a plugin (its install dir + its data dir).
   * A cwd outside every root is refused — SelectedPathRef lands later. */
  allowedCwdRoots: (pluginId: string) => string[];
  /** test seam: restart backoff floor override */
  restartBaseMs?: number;
}

interface Supervised {
  procId: string;
  pluginId: string;
  params: ProcessSpawnParams;
  child: ChildProcess | null;
  state: ProcessRecord["state"];
  pid: number | undefined;
  startedAt: number | undefined;
  exitedAt: number | undefined;
  exitCode: number | null | undefined;
  exitSignal: string | undefined;
  spawnCount: number;
  /** consecutive crashes with < CLEAN_RUN_MS uptime — drives the backoff rung;
   * a healthy run resets it (the §18.3 clean-run rule, process-sized) */
  crashStreak: number;
  restartTimer: NodeJS.Timeout | null;
  killTimer: NodeJS.Timeout | null;
  /** set once the owner (or shutdown) asked for termination — no restarts after */
  stopped: boolean;
}

const isUnderRoot = (path: string, root: string): boolean => {
  const r = resolve(root);
  const p = resolve(path);
  return p === r || p.startsWith(r + sep);
};

/** The POSIX floor: a shell, a locale, a temp dir, a search path, a home. */
const UNIX_BASE_KEYS = ["PATH", "HOME", "LANG", "TMPDIR", "SHELL"];
/** The win32 floor (WIN-3, §4.5). Those five say almost nothing here, and a
 * child with no `SystemRoot` cannot load its own runtime — "many Windows
 * binaries won't start" is the measured failure, not a theory. PATHEXT/COMSPEC
 * are the `.cmd` door; the temp pair, the per-user roots and the two CPU facts
 * are what language runtimes read before main(). Names are CANONICAL here: the
 * parent's own keys are matched case-insensitively, because Windows env keys are
 * and they arrive with whatever casing set them. */
const WIN32_BASE_KEYS = [
  "PATH",
  "PATHEXT",
  "SystemRoot",
  "windir",
  "COMSPEC",
  "TEMP",
  "TMP",
  "APPDATA",
  "LOCALAPPDATA",
  "USERPROFILE",
  "PROGRAMDATA",
  "NUMBER_OF_PROCESSORS",
  "PROCESSOR_ARCHITECTURE",
];

/** Minimal, boring base env — never process.env wholesale (EL7). */
const baseEnv = (
  platform = process.platform,
  parent: NodeJS.ProcessEnv = process.env,
): Record<string, string> => {
  const out: Record<string, string> = {};
  if (platform !== "win32") {
    for (const key of UNIX_BASE_KEYS) {
      const v = parent[key];
      if (v !== undefined) out[key] = v;
    }
    return out;
  }
  const folded = new Map<string, string>();
  for (const [k, v] of Object.entries(parent)) if (v !== undefined) folded.set(k.toUpperCase(), v);
  for (const key of WIN32_BASE_KEYS) {
    const v = folded.get(key.toUpperCase());
    if (v !== undefined) out[key] = v;
  }
  return out;
};

const stripPrefixed = (
  env: Record<string, string>,
  platform = process.platform,
): Record<string, string> => {
  // Case folds on win32 ONLY: unix env keys are genuinely case-sensitive, so
  // folding there would eat a legitimately distinct variable that merely spells
  // a reserved prefix in another case.
  const fold = platform === "win32";
  const prefixes: readonly string[] = fold
    ? ENV_PREFIXES.map((p) => p.toUpperCase())
    : ENV_PREFIXES;
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(env)) {
    const probe = fold ? k.toUpperCase() : k;
    if (prefixes.some((p) => probe.startsWith(p))) continue;
    out[k] = v;
  }
  return out;
};

/** The one child-env law, exported for every daemon-spawned plugin-adjacent
 * child (MCP stdio servers ride this too): minimal base, additions layered,
 * FIELD_-/FIELDD_-prefixed keys stripped LAST so nothing smuggles a daemon
 * secret (EL7). */
export const pluginChildEnv = (
  extra?: Record<string, string>,
  platform = process.platform,
  parent: NodeJS.ProcessEnv = process.env,
): Record<string, string> =>
  stripPrefixed({ ...baseEnv(platform, parent), ...(extra ?? {}) }, platform);

/** The executable candidates a plugin may name (§17.1), platform-shaped: unix
 * refuses any relative path; win32 allows a drive-absolute or UNC path, or a
 * name with no separator or drive at all, and refuses everything else. */
export const executableAllowed = (executable: string, platform = process.platform): boolean => {
  if (executable.length === 0) return false;
  if (platform === "win32") {
    if (/^[A-Za-z]:[\\/]/.test(executable) || executable.startsWith("\\\\")) return true;
    return !/[\\/:]/.test(executable); // a bare name — PATH resolves it
  }
  return posix.isAbsolute(executable) || !executable.includes("/");
};

export class ProcessService extends EventEmitter {
  private readonly log: Logger;
  private readonly procs = new Map<string, Supervised>();
  private seq = 0;
  private shuttingDown = false;

  constructor(private readonly cfg: ProcessServiceConfig) {
    super();
    this.log = (cfg.logger ?? createNoopLogger()).child({ component: "plugin.process" });
  }

  /** §17.1 — spawn a supervised child for a plugin service entry. */
  spawnFor(pluginId: string, rawParams: unknown): ProcessRecord {
    if (this.shuttingDown)
      throw new RpcCallError("UNAVAILABLE", "fieldd is shutting down", false, {
        service: "plugin-process",
        state: "stopping",
      });
    const parsed = ProcessSpawnParams.safeParse(rawParams);
    if (!parsed.success)
      throw new RpcCallError(
        "PRECONDITION_FAILED",
        "expected { executable, args?, cwd?, env?, restart }",
        false,
      );
    const params = parsed.data;
    const owned = [...this.procs.values()].filter(
      (s) => s.pluginId === pluginId && (s.state === "running" || s.state === "restarting"),
    );
    if (owned.length >= MAX_PROCS_PER_PLUGIN)
      throw new RpcCallError(
        "PRECONDITION_FAILED",
        `plugin already supervises ${MAX_PROCS_PER_PLUGIN} processes`,
        false,
        { pluginKind: "PLUGIN_QUOTA_EXCEEDED", limit: MAX_PROCS_PER_PLUGIN },
      );
    if (!executableAllowed(params.executable))
      throw new RpcCallError(
        "PRECONDITION_FAILED",
        "executable must be an absolute path or a bare PATH command",
        false,
      );
    if (params.cwd !== undefined) {
      const roots = this.cfg.allowedCwdRoots(pluginId);
      if (!roots.some((root) => isUnderRoot(params.cwd as string, root)))
        throw new RpcCallError(
          "FORBIDDEN_SCOPE",
          "cwd must stay under the plugin's own directories",
          false,
          { pluginKind: "PLUGIN_CAPABILITY_DENIED" },
        );
    }

    this.seq += 1;
    const procId = `${pluginId}#${this.seq}`;
    const sup: Supervised = {
      procId,
      pluginId,
      params,
      child: null,
      state: "running",
      pid: undefined,
      startedAt: undefined,
      exitedAt: undefined,
      exitCode: undefined,
      exitSignal: undefined,
      spawnCount: 0,
      crashStreak: 0,
      restartTimer: null,
      killTimer: null,
      stopped: false,
    };
    this.procs.set(procId, sup);
    this.launch(sup);
    return this.record(sup);
  }

  private launch(sup: Supervised): void {
    // additions first, host strip LAST — a plugin cannot smuggle FIELD_* back in
    const env = pluginChildEnv(sup.params.env);
    // WIN-3 — a `.cmd`/`.bat` target cannot be spawned without a shell since
    // CVE-2024-27980, so the shim door quotes it into `cmd.exe /d /s /c` itself
    // rather than handing plugin argv to a shell. Transparent everywhere else.
    const cmd = shimSpawn(sup.params.executable, sup.params.args, process.platform, {
      env,
      ...(sup.params.cwd !== undefined ? { cwd: sup.params.cwd } : {}),
    });
    let child: ChildProcess;
    try {
      child = spawn(cmd.command, cmd.args, {
        ...(sup.params.cwd !== undefined ? { cwd: sup.params.cwd } : {}),
        env,
        stdio: ["ignore", "ignore", "ignore"],
        detached: true, // its own process group — fieldd owns and kills the GROUP
        windowsHide: true, // a supervised background child flashes no console
        ...(cmd.windowsVerbatimArguments ? { windowsVerbatimArguments: true } : {}),
      });
    } catch (e) {
      sup.state = "failed";
      this.publish(sup);
      throw new RpcCallError("PRECONDITION_FAILED", `spawn failed: ${(e as Error).message}`, false);
    }
    sup.child = child;
    sup.spawnCount += 1;
    sup.startedAt = Date.now();
    sup.state = "running";
    child.once("error", (e) => {
      // spawn-time failure (ENOENT etc.) arrives async on the child
      sup.state = "failed";
      sup.exitedAt = Date.now();
      sup.child = null;
      this.log.warn("fieldd.plugin_process.spawn_error", "Supervised process failed to start", {
        pluginId: sup.pluginId,
        procId: sup.procId,
        error: (e as Error).message,
      });
      this.publish(sup);
    });
    child.once("exit", (code, signal) => {
      sup.pid = undefined;
      sup.child = null;
      sup.exitedAt = Date.now();
      sup.exitCode = code;
      sup.exitSignal = signal ?? undefined;
      if (sup.killTimer !== null) {
        clearTimeout(sup.killTimer);
        sup.killTimer = null;
      }
      if (sup.stopped || this.shuttingDown || sup.params.restart === "never") {
        sup.state = sup.stopped || code === 0 ? "exited" : "failed";
        this.publish(sup);
        return;
      }
      // restart:"on-crash" — §18.3-shaped exponential ladder; a ≥60s healthy
      // run resets the rung (a monthly crasher is not a crash loop)
      const uptime = sup.startedAt !== undefined ? Date.now() - sup.startedAt : 0;
      sup.crashStreak = uptime >= CLEAN_RUN_MS ? 1 : sup.crashStreak + 1;
      sup.state = "restarting";
      const backoff = Math.min(
        (this.cfg.restartBaseMs ?? RESTART_BASE_MS) * 2 ** Math.max(0, sup.crashStreak - 1),
        RESTART_MAX_MS,
      );
      this.log.info("fieldd.plugin_process.restarting", "Supervised process crashed; restarting", {
        pluginId: sup.pluginId,
        procId: sup.procId,
        exitCode: code,
        backoffMs: backoff,
      });
      this.publish(sup);
      sup.restartTimer = setTimeout(() => {
        sup.restartTimer = null;
        if (sup.stopped || this.shuttingDown) return;
        this.launch(sup);
        this.publish(sup);
      }, backoff);
      sup.restartTimer.unref();
    });
    sup.pid = child.pid;
    this.log.info("fieldd.plugin_process.spawned", "Supervised process started", {
      pluginId: sup.pluginId,
      procId: sup.procId,
      pid: child.pid,
      spawnCount: sup.spawnCount,
    });
  }

  /** §17.1 termination ladder rungs: term = group SIGTERM with a grace-then-
   * SIGKILL timer; kill = group SIGKILL now. */
  signal(owner: string | null, rawParams: unknown): ProcessRecord {
    const parsed = ProcessSignalParams.safeParse(rawParams);
    if (!parsed.success)
      throw new RpcCallError("PRECONDITION_FAILED", "expected { procId, signal }", false);
    const sup = this.procs.get(parsed.data.procId);
    if (sup === undefined || (owner !== null && sup.pluginId !== owner))
      throw new RpcCallError("NOT_FOUND", `no such process: ${parsed.data.procId}`, false);
    sup.stopped = true;
    if (sup.restartTimer !== null) {
      clearTimeout(sup.restartTimer);
      sup.restartTimer = null;
      sup.state = "exited";
    }
    this.deliver(sup, parsed.data.signal);
    this.publish(sup);
    return this.record(sup);
  }

  private deliver(sup: Supervised, signal: "term" | "kill"): void {
    const pid = sup.child?.pid;
    if (pid === undefined) return;
    const groupKill = (sig: NodeJS.Signals): void => {
      try {
        process.kill(-pid, sig); // negative pid — the whole group (§17.1)
      } catch {
        try {
          sup.child?.kill(sig);
        } catch {
          // already gone — exit handler owns the record from here
        }
      }
    };
    if (signal === "kill") {
      groupKill("SIGKILL");
      return;
    }
    groupKill("SIGTERM");
    sup.killTimer = setTimeout(() => {
      sup.killTimer = null;
      groupKill("SIGKILL");
    }, TERM_GRACE_MS);
    sup.killTimer.unref();
  }

  /** owner=null is the plugins.manage view (all plugins). */
  stat(owner: string | null, procId?: string): ProcessRecord[] {
    const rows = [...this.procs.values()]
      .filter((s) => owner === null || s.pluginId === owner)
      .filter((s) => procId === undefined || s.procId === procId)
      .map((s) => this.record(s));
    if (procId !== undefined && rows.length === 0)
      throw new RpcCallError("NOT_FOUND", `no such process: ${procId}`, false);
    return rows;
  }

  snapshotFor(owner: string | null): ProcessSubEvent {
    return { kind: "snapshot", processes: this.stat(owner) };
  }

  /** disable/quarantine/revocation path — everything the plugin owns dies and
   * its finished records drop (fresh slate on re-enable). */
  async killPlugin(pluginId: string): Promise<number> {
    let n = 0;
    for (const sup of this.procs.values()) {
      if (sup.pluginId !== pluginId) continue;
      n += 1;
      sup.stopped = true;
      if (sup.restartTimer !== null) {
        clearTimeout(sup.restartTimer);
        sup.restartTimer = null;
      }
      this.deliver(sup, "term");
    }
    if (n > 0) {
      await this.drainPlugin(pluginId, TERM_GRACE_MS + 1_000);
      for (const [procId, sup] of this.procs) {
        if (sup.pluginId === pluginId) {
          this.deliver(sup, "kill");
          this.procs.delete(procId);
        }
      }
      this.emit("changed");
    }
    return n;
  }

  private async drainPlugin(pluginId: string, deadlineMs: number): Promise<void> {
    const t0 = Date.now();
    while (Date.now() - t0 < deadlineMs) {
      const alive = [...this.procs.values()].some(
        (s) => s.pluginId === pluginId && s.child !== null,
      );
      if (!alive) return;
      await new Promise((r) => setTimeout(r, 50));
    }
  }

  /** v1 law: children die no later than fieldd shutdown (§17.1). */
  async stopAll(): Promise<void> {
    this.shuttingDown = true;
    const owners = new Set([...this.procs.values()].map((s) => s.pluginId));
    await Promise.all([...owners].map((id) => this.killPlugin(id)));
    this.removeAllListeners();
  }

  private record(sup: Supervised): ProcessRecord {
    return {
      procId: sup.procId,
      pluginId: sup.pluginId,
      executable: sup.params.executable,
      args: [...sup.params.args],
      restart: sup.params.restart,
      state: sup.state,
      ...(sup.pid !== undefined ? { pid: sup.pid } : {}),
      ...(sup.startedAt !== undefined ? { startedAt: sup.startedAt } : {}),
      ...(sup.exitedAt !== undefined ? { exitedAt: sup.exitedAt } : {}),
      ...(sup.exitCode !== undefined ? { exitCode: sup.exitCode } : {}),
      ...(sup.exitSignal !== undefined ? { exitSignal: sup.exitSignal } : {}),
      spawnCount: Math.max(1, sup.spawnCount),
    };
  }

  private publish(sup: Supervised): void {
    this.emit("changed", { kind: "delta", proc: this.record(sup) } satisfies ProcessSubEvent);
  }
}
