import type { spawn as nodeSpawn } from "node:child_process";
import { EventEmitter } from "node:events";
import { SPARK_TRANSCRIPT_SERVICE } from "@vibefield/contracts";
import type { Logger } from "@vibefield/logging";
import type { TranscriptHostLaunchSpec } from "./launch";
import type { HostError, HostOps } from "./protocol";

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

// TH-1 (red): a skeleton; the green commit builds it.
export class TranscriptHostSupervisor extends EventEmitter {
  constructor(readonly opts: TranscriptHostSupervisorOptions) {
    super();
  }

  health(): TranscriptHostHealth {
    return {
      phase: SPARK_TRANSCRIPT_SERVICE.STATE_STARTING,
      detail: "not built",
      pid: null,
      generation: 0,
    };
  }

  start(): void {}

  request<Op extends keyof HostOps>(
    _op: Op,
    _args: HostOps[Op]["args"],
  ): Promise<HostOps[Op]["value"]> {
    return Promise.reject(
      new TranscriptHostUnavailable(SPARK_TRANSCRIPT_SERVICE.STATE_STARTING, "not built", true),
    );
  }

  appended(_spark: string, _run: string): void {}

  async stop(): Promise<void> {}
}
