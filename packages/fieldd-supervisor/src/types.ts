import type { ProductInfo } from "@vibefield/contracts";
import type { FielddClient } from "@vibefield/fieldd-client";

// @vibefield/fieldd-supervisor (ESR spec §5.3): Node-only fieldd discovery,
// adoption, spawning, readiness, ownership, and shutdown policy. A LIBRARY that
// executes inside Electron main — never a process of its own, and never an
// Electron import (wall R3). All paths and environment are injected.

/** Terminal failure of `ensure()` — one structured kind per failure domain. */
export type SupervisorErrorKind =
  /** the native mgmt socket path would exceed the OS sun_path limit (~104B
   * on macOS): field-native could start but never bind — fail fast instead
   * of the generic pairing timeout (slice-0 finding 4) */
  | "data-root-too-long"
  | "spawn-failed"
  /** a live dev daemon owns this root but was built from different output;
   * never spawn a second daemon over it */
  | "incompatible-build"
  /** the spawned child exited before readiness — rejected promptly, never
   * waiting out the deadline (slice-0 finding 3 class) */
  | "child-exit"
  | "readiness-timeout"
  | "aborted"
  | "disposed";

/** Why an adoption probe did NOT adopt (diagnosis detail on errors/logs). */
export type ProbeFailure =
  /** no product.json/shell.token pair — nothing to adopt (normal first boot) */
  | "no-run-files"
  | "malformed-product"
  /** run files exist but nothing adoptable answers on the recorded port */
  | "stale-files"
  /** something answers but rejects our shell token — not our daemon (EL7) */
  | "foreign-listener"
  | "incompatible-contracts"
  /** a development daemon was produced by a different watched build */
  | "incompatible-build"
  | "probe-timeout";

export class SupervisorError extends Error {
  constructor(
    readonly kind: SupervisorErrorKind,
    message: string,
    readonly probe?: ProbeFailure,
    readonly cause?: unknown,
  ) {
    super(message);
    this.name = "SupervisorError";
  }
}

/** How to launch fieldd — the caller owns the runner decision (Electron main
 * passes its own binary with ELECTRON_RUN_AS_NODE in `environment`). */
export interface FielddSpawnCommand {
  command: string;
  args: readonly string[];
}

export interface FielddReadySignal {
  readonly ready: true;
  readonly port: number;
  readonly bootId: string;
}

export type SupervisorLifecycleEventName =
  | "fieldd.supervisor.adopted"
  | "fieldd.supervisor.spawn_required"
  | "fieldd.supervisor.spawned"
  | "fieldd.supervisor.spawn_race_lost"
  | "fieldd.supervisor.ready"
  | "fieldd.supervisor.stop_requested"
  | "fieldd.supervisor.force_killed"
  | "fieldd.supervisor.stopped"
  | "fieldd.supervisor.disposed";

export type FielddSupervisorEvent =
  | {
      readonly kind: "lifecycle";
      readonly event: SupervisorLifecycleEventName;
      readonly message: string;
      readonly attrs?: Readonly<Record<string, string | number | boolean | null>>;
    }
  | {
      /** A schema-valid line from fieldd's bounded stdout startup protocol.
       * It is control data, never a diagnostic log line. */
      readonly kind: "readiness";
      readonly signal: FielddReadySignal;
    }
  | {
      /** Bounded/redacted emergency output. Routine fieldd logs never use this
       * route; fieldd persists them in its process-owned stream. */
      readonly kind: "stderr";
      readonly line: string;
    }
  | {
      /** Any non-readiness stdout is abnormal and remains in the bounded
       * child-exit tail for diagnosis. */
      readonly kind: "unexpected-stdout";
      readonly line: string;
    };

export interface FielddSupervisorOptions {
  dataRoot: string;
  spawn: FielddSpawnCommand;
  /** Base environment for the child, caller-curated (the explicit-allowlist
   * law lives at the call site); the supervisor adds only FIELDD_* config. */
  environment: Readonly<Record<string, string | undefined>>;
  nativeExecutable?: string;
  allowedOrigins?: readonly string[];
  /** undefined = daemon default (registry port); 0 = ephemeral (test isolation) */
  controlPort?: number;
  dataPort?: number;
  /** Development-only build identity. When set, adoption requires an exact
   * match and spawned fieldd receives it as FIELDD_BUILD_ID. */
  expectedBuildId?: string;
  /** production: leave-running (daemon lifetime > shell lifetime, design-00);
   * dev/smoke: stop-owned tears down what THIS supervisor spawned — never an
   * adopted process. */
  shutdownPolicy: "leave-running" | "stop-owned";
  readinessDeadlineMs?: number;
  /** TERM grace before a spawned fieldd is force-killed. Dev/smoke callers
   * must budget for the daemon's bounded plugin-deactivation deadline. */
  stopDeadlineMs?: number;
  /** budget for the first adoption probe before deciding to spawn */
  adoptProbeMs?: number;
  /** Typed lifecycle/control/emergency boundary. Readiness stdout is never
   * collapsed into stderr or duplicated as a routine shell log. */
  onEvent?: (event: FielddSupervisorEvent) => void;
}

export interface FielddHandle {
  readonly ownership: "adopted" | "spawned";
  readonly info: ProductInfo;
  readonly client: FielddClient;
  readonly childPid?: number;
  /** SIGTERM the spawned fieldd (+ its recorded field-native) and wait bounded;
   * a NO-OP for adopted daemons — the shell never kills what it didn't start. */
  stopOwned(): Promise<void>;
}

export interface FielddSupervisor {
  /** Idempotent: concurrent callers share one in-flight attempt; a resolved
   * live handle is returned as-is until its client closes or fails. */
  ensure(options?: { signal?: AbortSignal }): Promise<FielddHandle>;
  /** Idempotent: cancels outstanding probes, closes the client, and applies
   * the shutdown policy (stop-owned stops only a SPAWNED daemon). */
  dispose(): Promise<void>;
}
