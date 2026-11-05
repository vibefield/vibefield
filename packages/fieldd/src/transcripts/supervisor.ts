import { type ChildProcess, spawn as nodeSpawn } from "node:child_process";
import { EventEmitter } from "node:events";
import { SPARK_TRANSCRIPT_SERVICE } from "@vibefield/contracts";
import { createNoopLogger, type Logger } from "@vibefield/logging";
import { workerEnvironment } from "../workspace/supervisor";
import type { TranscriptHostLaunchSpec } from "./launch";
import { type FromHost, type HostError, type HostOps, readFromHost, type ToHost } from "./protocol";

// TranscriptHostSupervisor (TH-1, TH0-Q5 (b)): fieldd owns ONE transcript worker per user root, started with the
// daemon and stopped with it, in the files worker's supervision (workspace/supervisor.ts) without its engine and its
// sessions: readiness is the worker's own `ready` on its IPC pipe; a worker that dies is restarted with backoff and a
// fresh GENERATION (every socket it served closes, and each window asks for a new ticket); one that keeps dying stops
// being restarted and says `failed`; a spawn that cannot happen is terminal on sight; shutdown awaits the real exit.
// No orphan pass: the worker leaves when its pipe closes.
//
// Every question rides `request()`: while the worker is not ready it throws `TranscriptHostUnavailable` naming the
// phase, which the ticket door answers as the honest UNAVAILABLE {service: "spark-transcripts", state}. `appended`
// nudges the ready worker and is dropped otherwise: a worker that was not ready had no socket to tell.
//
// EL7: the worker's environment is fieldd's minus every FIELD_*/FIELDD_* variable, and the folder's key reaches it on
// the pipe (`init`), never in that environment or its arguments.

export type TranscriptHostPhase =
  | typeof SPARK_TRANSCRIPT_SERVICE.STATE_STARTING
  | "ready"
  | typeof SPARK_TRANSCRIPT_SERVICE.STATE_RESTARTING
  | typeof SPARK_TRANSCRIPT_SERVICE.STATE_FAILED
  | typeof SPARK_TRANSCRIPT_SERVICE.STATE_STOPPED
  | typeof SPARK_TRANSCRIPT_SERVICE.STATE_OFF
  | typeof SPARK_TRANSCRIPT_SERVICE.STATE_UNCONFIGURED;

export interface TranscriptHostHealth {
  phase: TranscriptHostPhase;
  detail: string | null;
  pid: number | null;
  /** generations spawned so far; a restart moves it */
  generation: number;
}

export const TRANSCRIPT_HOST_SUPERVISION = {
  STARTUP_TIMEOUT_MS: 10_000,
  SHUTDOWN_TIMEOUT_MS: 3_000,
  KILL_WAIT_MS: 2_000,
  RESTART_BASE_MS: 250,
  RESTART_MAX_MS: 10_000,
  STABLE_AFTER_MS: 30_000,
  RESTART_MAX: 5,
  RESTART_WINDOW_MS: 60_000,
  REQUEST_TIMEOUT_MS: 5_000,
} as const;

export type TranscriptHostTimings = { [K in keyof typeof TRANSCRIPT_HOST_SUPERVISION]: number };

/** What a door hears when the worker cannot answer: its phase. */
export class TranscriptHostUnavailable extends Error {
  constructor(
    readonly state: Exclude<TranscriptHostPhase, "ready">,
    message: string,
    readonly retryable: boolean,
  ) {
    super(message);
  }
}

/** What a door hears when the worker answered no. */
export class TranscriptHostRefusal extends Error {
  constructor(readonly error: HostError) {
    super(error.message);
  }
}

export interface TranscriptHostSupervisorOptions {
  launch: TranscriptHostLaunchSpec;
  /** LAYOUT.SPARK_FILES_DIR, absolute */
  dir: string;
  /** the folder's key, read at each generation's start (the store's signer: made once) */
  key(): Buffer;
  /** the Origins a window may send (fieldd's own `allowedOrigins`) */
  allowedOrigins: readonly string[];
  /** test seam */
  spawnProcess?: typeof nodeSpawn;
  /** test seam; production uses TRANSCRIPT_HOST_SUPERVISION */
  timings?: Partial<TranscriptHostTimings>;
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
  startupTimer: NodeJS.Timeout | null;
  stableTimer: NodeJS.Timeout | null;
  killTimer: NodeJS.Timeout | null;
  exit: Promise<void>;
  pending: Map<number, Pending>;
}

/** Emits `"transition"` `(health)` on every change. */
export class TranscriptHostSupervisor extends EventEmitter {
  readonly #opts: TranscriptHostSupervisorOptions;
  readonly #t: TranscriptHostTimings;
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
  #health: TranscriptHostHealth;

  constructor(opts: TranscriptHostSupervisorOptions) {
    super();
    this.#opts = opts;
    this.#t = { ...TRANSCRIPT_HOST_SUPERVISION, ...opts.timings };
    this.#logger = opts.logger ?? createNoopLogger();
    this.#spawn = opts.spawnProcess ?? nodeSpawn;
    const { launch } = opts;
    this.#health = {
      phase:
        launch.kind === "off"
          ? SPARK_TRANSCRIPT_SERVICE.STATE_OFF
          : launch.kind === "unconfigured"
            ? SPARK_TRANSCRIPT_SERVICE.STATE_UNCONFIGURED
            : SPARK_TRANSCRIPT_SERVICE.STATE_STARTING,
      detail:
        launch.kind === "off"
          ? "the transcript worker is switched off for this daemon"
          : launch.kind === "unconfigured"
            ? launch.reason
            : null,
      pid: null,
      generation: 0,
    };
  }

  health(): TranscriptHostHealth {
    return { ...this.#health };
  }

  /** Start the first generation (once; a no-op when off or unconfigured). */
  start(): void {
    if (this.#started || this.#stopped) return;
    this.#started = true;
    if (this.#opts.launch.kind !== "launch") return;
    this.#spawnGeneration();
  }

  /** Ask the worker one question. Throws `TranscriptHostUnavailable` when it cannot answer now,
   * `TranscriptHostRefusal` when it answered no. */
  request<Op extends keyof HostOps>(
    op: Op,
    args: HostOps[Op]["args"],
  ): Promise<HostOps[Op]["value"]> {
    const generation = this.#current;
    if (generation === null || !generation.ready || generation.terminating) {
      const phase = this.#health.phase;
      const state = (
        phase === "ready" ? SPARK_TRANSCRIPT_SERVICE.STATE_RESTARTING : phase
      ) as Exclude<TranscriptHostPhase, "ready">;
      return Promise.reject(
        new TranscriptHostUnavailable(
          state,
          `the transcript worker is ${state}${this.#health.detail ? `: ${this.#health.detail}` : ""}`,
          state === SPARK_TRANSCRIPT_SERVICE.STATE_STARTING ||
            state === SPARK_TRANSCRIPT_SERVICE.STATE_RESTARTING,
        ),
      );
    }
    this.#nextId += 1;
    const id = this.#nextId;
    return new Promise<HostOps[Op]["value"]>((resolve, reject) => {
      const timer = setTimeout(() => {
        generation.pending.delete(id);
        reject(
          new TranscriptHostRefusal({
            code: "internal",
            message: `the transcript worker did not answer ${op} within ${this.#t.REQUEST_TIMEOUT_MS} ms`,
          }),
        );
      }, this.#t.REQUEST_TIMEOUT_MS);
      timer.unref?.();
      generation.pending.set(id, { resolve: resolve as (value: unknown) => void, reject, timer });
      this.#send(generation, { t: "req", id, op, args });
    });
  }

  /** A line was written to `run` of `spark`: the ready worker reads on. Ids only (EL2). */
  appended(spark: string, run: string): void {
    const generation = this.#current;
    if (generation === null || !generation.ready || generation.terminating) return;
    this.#send(generation, { t: "appended", spark, run });
  }

  /** Stop for good: a `shutdown` message, then signals; resolves after the real exit. */
  async stop(): Promise<void> {
    this.#stopped = true;
    this.#clearRetry();
    const generation = this.#current;
    if (generation !== null) {
      generation.onExit = "settle";
      await this.#terminate(generation);
    }
    if (this.#opts.launch.kind === "launch")
      this.#publish({ phase: SPARK_TRANSCRIPT_SERVICE.STATE_STOPPED, pid: null, detail: null });
  }

  #send(generation: Generation, message: ToHost): void {
    try {
      if (generation.proc.connected) generation.proc.send(message);
    } catch (error) {
      this.#logger.warn(
        "fieldd.transcripts.send_failed",
        "A message to the transcript worker failed",
        {
          error: error instanceof Error ? error.message : String(error),
        },
      );
    }
  }

  #publish(patch: Partial<TranscriptHostHealth>): void {
    const next = { ...this.#health, ...patch };
    const changed = (Object.keys(next) as Array<keyof TranscriptHostHealth>).some(
      (key) => next[key] !== this.#health[key],
    );
    if (!changed) return;
    this.#health = next;
    this.#logger.info("fieldd.transcripts.state", "Transcript worker supervision state changed", {
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
        phase: SPARK_TRANSCRIPT_SERVICE.STATE_FAILED,
        detail: `restart intensity exceeded (${this.#t.RESTART_MAX} in ${this.#t.RESTART_WINDOW_MS} ms) — the transcript worker keeps dying; restart the app to try again`,
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

  #failPending(generation: Generation, why: string): void {
    for (const [id, pending] of generation.pending) {
      clearTimeout(pending.timer);
      pending.reject(
        new TranscriptHostUnavailable(SPARK_TRANSCRIPT_SERVICE.STATE_RESTARTING, why, true),
      );
      generation.pending.delete(id);
    }
  }

  #spawnGeneration(): void {
    if (this.#stopped || this.#opts.launch.kind !== "launch") return;
    const { launch } = this.#opts.launch;
    let key: Buffer;
    try {
      key = this.#opts.key();
    } catch (error) {
      // the folder's key the disk would not hand over: no worker could verify a line
      this.#publish({
        phase: SPARK_TRANSCRIPT_SERVICE.STATE_FAILED,
        detail: `the transcripts' key could not be read (${(error as NodeJS.ErrnoException).code ?? "EIO"})`,
      });
      return;
    }
    this.#generations += 1;
    const number = this.#generations;
    this.#publish({
      phase:
        number === 1
          ? SPARK_TRANSCRIPT_SERVICE.STATE_STARTING
          : SPARK_TRANSCRIPT_SERVICE.STATE_RESTARTING,
      generation: number,
      pid: null,
    });
    let proc: ChildProcess;
    try {
      proc = this.#spawn(launch.command, [...launch.args], {
        stdio: ["ignore", "ignore", "pipe", "ipc"],
        env: workerEnvironment(this.#opts.environment ?? process.env),
        windowsHide: true,
      });
    } catch (error) {
      this.#publish({
        phase: SPARK_TRANSCRIPT_SERVICE.STATE_FAILED,
        detail: `the transcript worker could not be spawned: ${String(error)}`,
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
      startupTimer: null,
      stableTimer: null,
      killTimer: null,
      exit: new Promise<void>((resolve) => {
        resolveExit = resolve;
      }),
      pending: new Map(),
    };
    this.#current = generation;
    this.#publish({ pid: proc.pid ?? null });

    const fail = (detail: string, terminal: boolean): void => {
      if (this.#current !== generation || generation.exited || generation.terminating) return;
      generation.failure = detail;
      if (terminal) generation.onExit = "settle";
      generation.ready = false;
      this.#failPending(generation, detail);
      this.#publish({
        phase: terminal
          ? SPARK_TRANSCRIPT_SERVICE.STATE_FAILED
          : SPARK_TRANSCRIPT_SERVICE.STATE_RESTARTING,
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
      resolveExit();
      if (this.#current !== generation) return;
      this.#current = null;
      this.#failPending(generation, "the transcript worker exited while answering");
      if (this.#stopped) return;
      if (generation.onExit === "settle") {
        this.#publish({ pid: null });
        return;
      }
      this.#publish({
        phase: SPARK_TRANSCRIPT_SERVICE.STATE_RESTARTING,
        pid: null,
        detail: generation.failure ?? exitDetail,
      });
      this.#scheduleRetry();
    };

    proc.on("message", (raw: unknown) => {
      const message = readFromHost(raw);
      if (message === null || this.#current !== generation) return;
      this.#onMessage(generation, message, fail);
    });
    proc.stderr?.setEncoding("utf8");
    proc.stderr?.on("data", (chunk: string) => {
      for (const line of chunk.split("\n"))
        if (line.trim().length > 0)
          this.#logger.info("fieldd.transcripts.stderr", "transcript worker stderr", {
            line: line.slice(0, 512),
          });
    });
    proc.on("exit", (code, signal) => exited(`the transcript worker exited (${signal ?? code})`));
    proc.on("error", (error: NodeJS.ErrnoException) => {
      if (proc.pid === undefined) {
        if (error.code === "ENOENT" || error.code === "EACCES") {
          generation.onExit = "settle";
          this.#publish({
            phase: SPARK_TRANSCRIPT_SERVICE.STATE_FAILED,
            detail: `the transcript worker could not be spawned (${error.code}): ${launch.command}`,
          });
        }
        exited(error.message);
      } else
        this.#logger.warn(
          "fieldd.transcripts.process_error",
          "The transcript worker's process erred",
          {
            error: error.message,
          },
        );
    });
    generation.startupTimer = setTimeout(
      () => fail("the transcript worker did not become ready in time", false),
      this.#t.STARTUP_TIMEOUT_MS,
    );
    generation.startupTimer.unref?.();
    // the first word: the folder, its key and the generation it serves as (EL7: the key on the pipe alone)
    this.#send(generation, {
      t: "init",
      key: key.toString("base64"),
      dir: this.#opts.dir,
      allowedOrigins: [...this.#opts.allowedOrigins],
      generation: number,
    });
  }

  #onMessage(
    generation: Generation,
    message: FromHost,
    fail: (detail: string, terminal: boolean) => void,
  ): void {
    switch (message.t) {
      case "ready": {
        if (generation.ready || generation.terminating) return;
        if (generation.startupTimer) clearTimeout(generation.startupTimer);
        generation.ready = true;
        this.#publish({ phase: "ready", detail: null });
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
        fail(message.reason, true);
        return;
      case "log":
        (message.level === "warn" ? this.#logger.warn : this.#logger.info).call(
          this.#logger,
          `fieldd.transcripts.${message.event}`,
          message.message,
          message.fields ?? {},
        );
        return;
      case "res": {
        const pending = generation.pending.get(message.id);
        if (pending === undefined) return;
        generation.pending.delete(message.id);
        clearTimeout(pending.timer);
        if (message.ok) pending.resolve(message.value);
        else pending.reject(new TranscriptHostRefusal(message.error));
        return;
      }
    }
  }
}
