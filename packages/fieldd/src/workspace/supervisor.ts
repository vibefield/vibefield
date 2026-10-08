import { type ChildProcess, spawn as nodeSpawn } from "node:child_process";
import { EventEmitter } from "node:events";
import { ENV_PREFIXES, WORKSPACE_SERVICE } from "@vibefield/contracts";
import { createNoopLogger, type Logger } from "@vibefield/logging";
import type { FilesHostLaunch } from "./launch";
import {
  type AttachEvent,
  type AttachSession,
  type FromWorker,
  readFromWorker,
  type ToWorker,
  type WorkerError,
  type WorkerOp,
  type WorkerOps,
} from "./protocol";

// FilesHostSupervisor (FS-1a; `thinking-files-service.md` §4, FS-D11 RULED
// (b)): fieldd owns ONE files worker per user root, started WITH the daemon
// and stopped with it — always on, so a phone's first folder sheet never waits
// for a cold start. Modelled on RosettadSupervisor (rosettad-supervisor.ts),
// in fieldd's idiom: readiness is the worker's own READY message on its IPC
// pipe (never a scraped banner); a worker that dies is restarted with backoff
// and a fresh GENERATION; one that keeps dying stops being restarted (bounded
// intensity — TC-D1's shape) and says "failed" honestly; shutdown awaits the
// real exit. Two failures are TERMINAL on sight, because retrying cannot fix
// them: a spawn that cannot happen (ENOENT/EACCES) and a worker that says it
// cannot load mille's engine (`fatal`).
//
// No orphan pass: the worker leaves when its pipe closes (host/main.ts), so a
// fieldd killed without its stop ladder takes its worker with it.
//
// Every question rides `request()`: while the worker is not ready it throws a
// `FilesHostUnavailable` naming the phase — the doors turn it into the honest
// UNAVAILABLE {service: "workspace", state} — and a generation that dies with
// questions in flight fails each of them the same way, `restarting`.
//
// EL7: the worker's environment is fieldd's minus every FIELD_*/FIELDD_*
// variable (the agent PTYs' strip list): it runs git, and a daemon's
// configuration is nothing a repository's hooks should read.

export type FilesHostPhase =
  | typeof WORKSPACE_SERVICE.STATE_STARTING
  | "ready"
  | typeof WORKSPACE_SERVICE.STATE_RESTARTING
  | typeof WORKSPACE_SERVICE.STATE_FAILED
  | typeof WORKSPACE_SERVICE.STATE_STOPPED
  | typeof WORKSPACE_SERVICE.STATE_OFF
  | typeof WORKSPACE_SERVICE.STATE_UNCONFIGURED;

/** The client-facing projection: the phase and its reason, the generation. */
export interface FilesHostHealth {
  phase: FilesHostPhase;
  detail: string | null;
  pid: number | null;
  /** generations spawned so far; a restart moves it */
  generation: number;
  mille: { packageVersion: string; nativeVersion: string } | null;
}

export const FILES_HOST_SUPERVISION = {
  /** from the spawn to the READY message (the addon loads in it) */
  STARTUP_TIMEOUT_MS: 15_000,
  /** a `shutdown` message → this much patience → SIGTERM → KILL_WAIT → SIGKILL */
  SHUTDOWN_TIMEOUT_MS: 3_000,
  KILL_WAIT_MS: 2_000,
  RESTART_BASE_MS: 250,
  RESTART_MAX_MS: 10_000,
  /** a generation ready this long resets the backoff */
  STABLE_AFTER_MS: 30_000,
  RESTART_MAX: 5,
  RESTART_WINDOW_MS: 60_000,
  /** one question's budget (a list of a huge folder, a cold search walk) */
  REQUEST_TIMEOUT_MS: 20_000,
  /** the worker's I/O thread pool (libuv's default is 4): a folder read that
   * blocks — an iCloud-evicted folder downloading — holds one thread until it
   * answers, and the worker stops reading after two such in a walk or a page
   * (host/names.ts), so this leaves room for many of them */
  THREADPOOL_SIZE: 16,
} as const;

export type FilesHostTimings = { [K in keyof typeof FILES_HOST_SUPERVISION]: number };

/** R6 — an attachment's life as the supervisor tells it: the worker's word,
 * or fieldd's own for a session a dying generation took with it. */
export type FilesHostSessionEvent = AttachEvent & { generation: number };

/** What a door hears when the worker cannot answer: its phase. */
export class FilesHostUnavailable extends Error {
  constructor(
    readonly state: Exclude<FilesHostPhase, "ready">,
    message: string,
    readonly retryable: boolean,
  ) {
    super(message);
  }
}

/** What a door hears when the worker answered with a refusal. */
export class FilesHostRefusal extends Error {
  constructor(readonly error: WorkerError) {
    super(error.message);
  }
}

export type FilesHostLaunchSpec =
  | { kind: "launch"; launch: FilesHostLaunch }
  | { kind: "off" }
  | { kind: "unconfigured"; reason: string };

export interface FilesHostSupervisorOptions {
  launch: FilesHostLaunchSpec;
  /** test seam */
  spawnProcess?: typeof nodeSpawn;
  /** test seam; production uses FILES_HOST_SUPERVISION */
  timings?: Partial<FilesHostTimings>;
  /** the environment the worker inherits (default: this process's, stripped) */
  environment?: NodeJS.ProcessEnv;
  logger?: Logger;
}

interface Pending {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  timer: NodeJS.Timeout;
}

interface Generation {
  number: number;
  proc: ChildProcess;
  ready: boolean;
  exited: boolean;
  terminating: boolean;
  /** "retry" — it died on its own; "settle" — fieldd ended it or it is terminal */
  onExit: "retry" | "settle";
  failure: string | null;
  stderrTail: string[];
  stderrLine: string;
  startupTimer: NodeJS.Timeout | null;
  stableTimer: NodeJS.Timeout | null;
  killTimer: NodeJS.Timeout | null;
  exit: Promise<void>;
  pending: Map<number, Pending>;
  /** R6 — the attachments this generation said were established and has not
   * yet said ended: an exit ends them in fieldd's words */
  sessions: Map<string, AttachSession>;
}

const STDERR_TAIL_LINES = 4;

/** The worker's environment: fieldd's, less the daemon's own prefixes. */
export function workerEnvironment(source: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const out: NodeJS.ProcessEnv = {};
  for (const [key, value] of Object.entries(source)) {
    if (value === undefined) continue;
    if (ENV_PREFIXES.some((prefix) => key.toUpperCase().startsWith(prefix))) continue;
    out[key] = value;
  }
  return out;
}

/** Emits `"transition"` `(health: FilesHostHealth)` on every change, and
 * `"session"` `(event: FilesHostSessionEvent)` when an attachment is
 * established or ends (R6). */
export class FilesHostSupervisor extends EventEmitter {
  readonly #opts: FilesHostSupervisorOptions;
  readonly #t: FilesHostTimings;
  readonly #logger: Logger;
  readonly #spawn: typeof nodeSpawn;
  #current: Generation | null = null;
  #retryTimer: NodeJS.Timeout | null = null;
  #started = false;
  #stopped = false;
  #generations = 0;
  #attempts = 0;
  #restartStamps: number[] = [];
  #nextId = 0;
  #health: FilesHostHealth;

  constructor(opts: FilesHostSupervisorOptions) {
    super();
    this.#opts = opts;
    this.#t = { ...FILES_HOST_SUPERVISION, ...opts.timings };
    this.#logger = opts.logger ?? createNoopLogger();
    this.#spawn = opts.spawnProcess ?? nodeSpawn;
    const launch = opts.launch;
    this.#health = {
      phase:
        launch.kind === "off"
          ? WORKSPACE_SERVICE.STATE_OFF
          : launch.kind === "unconfigured"
            ? WORKSPACE_SERVICE.STATE_UNCONFIGURED
            : WORKSPACE_SERVICE.STATE_STARTING,
      detail:
        launch.kind === "off"
          ? "the files worker is switched off for this daemon"
          : launch.kind === "unconfigured"
            ? launch.reason
            : null,
      pid: null,
      generation: 0,
      mille: null,
    };
  }

  health(): FilesHostHealth {
    return { ...this.#health };
  }

  /** Start the first generation (once; a no-op when off or unconfigured). */
  start(): void {
    if (this.#started || this.#stopped) return;
    this.#started = true;
    if (this.#opts.launch.kind !== "launch") return;
    this.#spawnGeneration();
  }

  /** Ask the worker one question. Throws `FilesHostUnavailable` when it
   * cannot answer now, `FilesHostRefusal` when it answered no. */
  request<Op extends WorkerOp>(
    op: Op,
    args: WorkerOps[Op]["args"],
  ): Promise<WorkerOps[Op]["value"]> {
    const generation = this.#current;
    if (generation === null || !generation.ready || generation.terminating) {
      const phase = this.#health.phase;
      const state = (phase === "ready" ? WORKSPACE_SERVICE.STATE_RESTARTING : phase) as Exclude<
        FilesHostPhase,
        "ready"
      >;
      return Promise.reject(
        new FilesHostUnavailable(
          state,
          `the files service is ${state}${this.#health.detail ? `: ${this.#health.detail}` : ""}`,
          state === WORKSPACE_SERVICE.STATE_STARTING ||
            state === WORKSPACE_SERVICE.STATE_RESTARTING,
        ),
      );
    }
    this.#nextId += 1;
    const id = this.#nextId;
    return new Promise<WorkerOps[Op]["value"]>((resolve, reject) => {
      const timer = setTimeout(() => {
        generation.pending.delete(id);
        reject(
          new FilesHostRefusal({
            code: "internal",
            message: `the files worker did not answer ${op} within ${this.#t.REQUEST_TIMEOUT_MS} ms`,
          }),
        );
      }, this.#t.REQUEST_TIMEOUT_MS);
      timer.unref?.();
      generation.pending.set(id, {
        resolve: resolve as (value: unknown) => void,
        reject,
        timer,
      });
      this.#send(generation, { t: "req", id, op, args });
    });
  }

  /** Stop for good: a `shutdown` message, then signals; resolves after the
   * real exit. */
  async stop(): Promise<void> {
    this.#stopped = true;
    this.#clearRetry();
    const generation = this.#current;
    if (generation !== null) {
      generation.onExit = "settle";
      await this.#terminate(generation);
    }
    if (this.#opts.launch.kind === "launch")
      this.#publish({ phase: WORKSPACE_SERVICE.STATE_STOPPED, pid: null, detail: null });
  }

  #send(generation: Generation, message: ToWorker): void {
    try {
      if (generation.proc.connected) generation.proc.send(message);
    } catch (error) {
      this.#logger.warn("fieldd.workspace.send_failed", "A message to the files worker failed", {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  #publish(patch: Partial<FilesHostHealth>): void {
    const next = { ...this.#health, ...patch };
    const changed = (Object.keys(next) as Array<keyof FilesHostHealth>).some(
      (key) => next[key] !== this.#health[key],
    );
    if (!changed) return;
    this.#health = next;
    this.#logger.info("fieldd.workspace.state", "Files worker supervision state changed", {
      phase: next.phase,
      detail: next.detail,
      pid: next.pid,
      generation: next.generation,
    });
    this.emit("transition", this.health());
  }

  #clearRetry(): void {
    if (this.#retryTimer !== null) {
      clearTimeout(this.#retryTimer);
      this.#retryTimer = null;
    }
  }

  #scheduleRetry(): void {
    if (this.#stopped || this.#retryTimer !== null) return;
    const now = Date.now();
    this.#restartStamps = this.#restartStamps.filter((s) => now - s < this.#t.RESTART_WINDOW_MS);
    if (this.#restartStamps.length >= this.#t.RESTART_MAX) {
      this.#publish({
        phase: WORKSPACE_SERVICE.STATE_FAILED,
        detail: `restart intensity exceeded (${this.#t.RESTART_MAX} in ${this.#t.RESTART_WINDOW_MS} ms) — the files worker keeps dying; restart the app to try again`,
      });
      return;
    }
    this.#restartStamps.push(now);
    const delay = Math.min(this.#t.RESTART_MAX_MS, this.#t.RESTART_BASE_MS * 2 ** this.#attempts);
    this.#attempts += 1;
    this.#retryTimer = setTimeout(() => {
      this.#retryTimer = null;
      this.#spawnGeneration();
    }, delay);
    this.#retryTimer.unref?.();
  }

  #terminate(generation: Generation): Promise<void> {
    if (generation.exited || generation.terminating) return generation.exit;
    generation.terminating = true;
    if (generation.startupTimer) clearTimeout(generation.startupTimer);
    if (generation.stableTimer) clearTimeout(generation.stableTimer);
    this.#send(generation, { t: "shutdown" });
    generation.killTimer = setTimeout(() => {
      if (generation.exited) return;
      try {
        generation.proc.kill("SIGTERM");
      } catch {
        // gone already; the exit event says so
      }
      generation.killTimer = setTimeout(() => {
        if (generation.exited) return;
        try {
          generation.proc.kill("SIGKILL");
        } catch {
          // gone already
        }
      }, this.#t.KILL_WAIT_MS);
      generation.killTimer.unref?.();
    }, this.#t.SHUTDOWN_TIMEOUT_MS);
    generation.killTimer.unref?.();
    return generation.exit;
  }

  #failPending(generation: Generation, state: Exclude<FilesHostPhase, "ready">, why: string): void {
    for (const [id, pending] of generation.pending) {
      clearTimeout(pending.timer);
      pending.reject(new FilesHostUnavailable(state, why, true));
      generation.pending.delete(id);
    }
  }

  #spawnGeneration(): void {
    if (this.#stopped || this.#opts.launch.kind !== "launch") return;
    const launch = this.#opts.launch.launch;
    this.#generations += 1;
    const number = this.#generations;
    this.#publish({
      phase: number === 1 ? WORKSPACE_SERVICE.STATE_STARTING : WORKSPACE_SERVICE.STATE_RESTARTING,
      generation: number,
      pid: null,
    });
    let proc: ChildProcess;
    try {
      proc = this.#spawn(launch.command, [...launch.args], {
        stdio: ["ignore", "pipe", "pipe", "ipc"],
        env: {
          UV_THREADPOOL_SIZE: String(this.#t.THREADPOOL_SIZE),
          ...workerEnvironment(this.#opts.environment ?? process.env),
        },
        // WIN-3 — a background worker never flashes a console window
        windowsHide: true,
      });
    } catch (error) {
      this.#publish({
        phase: WORKSPACE_SERVICE.STATE_FAILED,
        detail: `the files worker could not be spawned: ${String(error)}`,
      });
      return;
    }
    let resolveExit!: () => void;
    const generation: Generation = {
      number,
      proc,
      ready: false,
      exited: false,
      terminating: false,
      onExit: "retry",
      failure: null,
      stderrTail: [],
      stderrLine: "",
      startupTimer: null,
      stableTimer: null,
      killTimer: null,
      exit: new Promise<void>((resolve) => {
        resolveExit = resolve;
      }),
      pending: new Map(),
      sessions: new Map(),
    };
    this.#current = generation;
    this.#publish({ pid: proc.pid ?? null });

    const fail = (detail: string, terminal: boolean): void => {
      if (this.#current !== generation || generation.exited || generation.terminating) return;
      generation.failure = detail;
      if (terminal) generation.onExit = "settle";
      generation.ready = false;
      this.#failPending(generation, WORKSPACE_SERVICE.STATE_RESTARTING, detail);
      this.#publish({
        phase: terminal ? WORKSPACE_SERVICE.STATE_FAILED : WORKSPACE_SERVICE.STATE_RESTARTING,
        detail,
      });
      void this.#terminate(generation);
    };

    const exited = (exitDetail: string): void => {
      if (generation.exited) return;
      generation.exited = true;
      generation.ready = false;
      for (const timer of [generation.startupTimer, generation.stableTimer, generation.killTimer])
        if (timer) clearTimeout(timer);
      const last = generation.stderrLine.trim();
      if (last.length > 0) generation.stderrTail.push(last.slice(0, 256));
      // R6 — a session the worker did not live to end (a crash, a kill, or its
      // last words lost with the pipe) ends here, in fieldd's words: stopped
      // when fieldd asked it to go, exited when it went on its own
      for (const session of generation.sessions.values())
        this.emit("session", {
          event: "ended",
          ...session,
          reason: generation.terminating ? "worker-stopped" : "worker-exited",
          generation: generation.number,
        } satisfies FilesHostSessionEvent);
      generation.sessions.clear();
      resolveExit();
      if (this.#current !== generation) return;
      this.#current = null;
      this.#failPending(
        generation,
        WORKSPACE_SERVICE.STATE_RESTARTING,
        "the files worker exited while answering",
      );
      if (this.#stopped) return;
      if (generation.onExit === "settle") {
        this.#publish({ pid: null });
        return;
      }
      const tail =
        generation.stderrTail.length > 0 ? ` — ${generation.stderrTail.join(" | ")}` : "";
      this.#publish({
        phase: WORKSPACE_SERVICE.STATE_RESTARTING,
        pid: null,
        detail: `${generation.failure ?? exitDetail}${tail}`,
      });
      this.#scheduleRetry();
    };

    proc.on("message", (raw: unknown) => {
      const message = readFromWorker(raw);
      if (message === null || this.#current !== generation) return;
      this.#onMessage(generation, message, fail);
    });
    proc.stdout?.setEncoding("utf8");
    proc.stdout?.on("data", (chunk: string) => {
      for (const line of chunk.split("\n"))
        if (line.trim().length > 0)
          this.#logger.debug("fieldd.workspace.stdout", "files worker stdout", {
            line: line.slice(0, 512),
          });
    });
    proc.stderr?.setEncoding("utf8");
    proc.stderr?.on("data", (chunk: string) => {
      generation.stderrLine += chunk;
      let end = generation.stderrLine.indexOf("\n");
      while (end !== -1) {
        const line = generation.stderrLine.slice(0, end).trimEnd();
        generation.stderrLine = generation.stderrLine.slice(end + 1);
        end = generation.stderrLine.indexOf("\n");
        if (line.length === 0) continue;
        this.#logger.info("fieldd.workspace.stderr", "files worker stderr", {
          line: line.slice(0, 512),
        });
        generation.stderrTail.push(line.slice(0, 256));
        if (generation.stderrTail.length > STDERR_TAIL_LINES) generation.stderrTail.shift();
      }
      if (generation.stderrLine.length > 4_096)
        generation.stderrLine = generation.stderrLine.slice(-2_048);
    });
    proc.on("exit", (code, signal) => exited(`the files worker exited (${signal ?? code})`));
    proc.on("error", (error: NodeJS.ErrnoException) => {
      if (proc.pid === undefined) {
        // a spawn that cannot happen has no exit event; ENOENT/EACCES are terminal
        if (error.code === "ENOENT" || error.code === "EACCES") {
          generation.onExit = "settle";
          this.#publish({
            phase: WORKSPACE_SERVICE.STATE_FAILED,
            detail: `the files worker could not be spawned (${error.code}): ${launch.command}`,
          });
        }
        exited(error.message);
      } else {
        this.#logger.warn("fieldd.workspace.process_error", "The files worker's process erred", {
          error: error.message,
        });
      }
    });
    generation.startupTimer = setTimeout(
      () => fail("the files worker did not become ready in time", false),
      this.#t.STARTUP_TIMEOUT_MS,
    );
    generation.startupTimer.unref?.();
    // the first word: the addon's explicit path (L1)
    this.#send(generation, { t: "init", milleNative: launch.milleNative });
  }

  #onMessage(
    generation: Generation,
    message: FromWorker,
    fail: (detail: string, terminal: boolean) => void,
  ): void {
    switch (message.t) {
      case "ready": {
        if (generation.ready || generation.terminating) return;
        if (generation.startupTimer) clearTimeout(generation.startupTimer);
        generation.ready = true;
        const mille =
          typeof message.mille === "object" && message.mille !== null
            ? {
                packageVersion: String(message.mille.packageVersion),
                nativeVersion: String(message.mille.nativeVersion),
              }
            : null;
        this.#publish({ phase: "ready", detail: null, mille });
        generation.stableTimer = setTimeout(() => {
          if (this.#current === generation) {
            this.#attempts = 0;
            this.#restartStamps = [];
          }
        }, this.#t.STABLE_AFTER_MS);
        generation.stableTimer.unref?.();
        return;
      }
      case "fatal":
        fail(String(message.reason).slice(0, 1_024), true);
        return;
      case "session": {
        const session = {
          attachId: message.attachId,
          rootId: message.rootId,
          clientId: message.clientId,
        };
        if (message.event === "established") {
          if (generation.sessions.has(session.attachId)) return;
          generation.sessions.set(session.attachId, session);
          this.emit("session", {
            event: "established",
            ...session,
            generation: generation.number,
          } satisfies FilesHostSessionEvent);
        } else if (generation.sessions.delete(session.attachId))
          this.emit("session", {
            event: "ended",
            ...session,
            reason: message.reason,
            generation: generation.number,
          } satisfies FilesHostSessionEvent);
        return;
      }
      case "log":
        (message.level === "warn" ? this.#logger.warn : this.#logger.info).call(
          this.#logger,
          `fieldd.workspace.${String(message.event).slice(0, 64)}`,
          String(message.message).slice(0, 512),
          message.fields ?? {},
        );
        return;
      case "res": {
        const pending = generation.pending.get(message.id);
        if (pending === undefined) return;
        generation.pending.delete(message.id);
        clearTimeout(pending.timer);
        if (message.ok) pending.resolve(message.value);
        else {
          const error = message.error as Partial<WorkerError> | undefined;
          pending.reject(
            new FilesHostRefusal({
              code: error?.code ?? "internal",
              message: String(error?.message ?? "the files worker refused").slice(0, 512),
            }),
          );
        }
        return;
      }
    }
  }
}
