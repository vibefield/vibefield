import { execFile } from "node:child_process";

const DROP_COUNTERS = [
  "rejected",
  "droppedTrace",
  "droppedDebug",
  "droppedInfo",
  "droppedWarn",
  "droppedError",
  "emergencyFallbacks",
] as const;
type DropCounter = (typeof DROP_COUNTERS)[number];
type LogSource = "desktop" | "renderer" | "utility" | "pluginRenderer" | "fieldd" | "pluginService";

export interface LoggingHealthLike {
  readonly bootId?: string;
  readonly instanceId?: string;
  readonly queue?: { readonly records?: number; readonly bytes?: number };
  // Tolerant logging contracts allow unknown extensions; only these numeric counters are read.
  readonly counters?: Readonly<Partial<Record<DropCounter, number>>>;
}

interface LoggingStream {
  readonly source: LogSource;
  readonly available: boolean;
  readonly bootId: string | null;
  readonly instanceId: string | null;
  readonly queueRecords: number;
  readonly queueBytes: number;
  readonly counters: Readonly<Record<DropCounter, number>>;
}

interface LoggingChange {
  readonly source: LogSource;
  readonly counter: DropCounter;
  readonly previous: number | null;
  readonly current: number;
  /** Null for a new identity or a counter reset: never count a reset as a negative loss. */
  readonly delta: number | null;
}

export interface LoggingCensus {
  readonly queueRecords: number;
  readonly queueBytes: number;
  readonly unexplainedDrops: number;
  readonly streams: readonly LoggingStream[];
  readonly changes: readonly LoggingChange[];
}

/** Same aggregate gate as the original soak, with host-labelled, allow-listed attribution.
 * No log messages, plugin fields, error objects or arbitrary health properties reach the trace. */
export function loggingCensus(
  rows: readonly { source: LogSource; health: LoggingHealthLike | null | undefined }[],
  previous?: LoggingCensus,
): LoggingCensus {
  const count = (value: number | undefined): number => {
    if (value === undefined) return 0;
    if (!Number.isSafeInteger(value) || value < 0) throw new TypeError("invalid logging count");
    return value;
  };
  const identity = (value: string | undefined): string | null => {
    if (value === undefined) return null;
    if (typeof value !== "string" || value.length > 256)
      throw new TypeError("invalid log identity");
    return value;
  };
  const streams = rows.map(
    ({ source, health }): LoggingStream => ({
      source,
      available: health != null,
      bootId: identity(health?.bootId),
      instanceId: identity(health?.instanceId),
      queueRecords: count(health?.queue?.records),
      queueBytes: count(health?.queue?.bytes),
      counters: Object.fromEntries(
        DROP_COUNTERS.map((key) => [key, count(health?.counters?.[key])]),
      ) as Record<DropCounter, number>,
    }),
  );
  const changes: LoggingChange[] = [];
  for (const stream of streams) {
    if (!stream.available) continue;
    const before = previous?.streams.find((row) => row.source === stream.source);
    const sameIdentity =
      before?.available === true &&
      before.bootId === stream.bootId &&
      before.instanceId === stream.instanceId;
    for (const counter of DROP_COUNTERS) {
      const old = sameIdentity ? before.counters[counter] : null;
      const current = stream.counters[counter];
      if (old === current || (old === null && current === 0)) continue;
      changes.push({
        source: stream.source,
        counter,
        previous: old,
        current,
        delta: old === null || current < old ? null : current - old,
      });
    }
  }
  return {
    queueRecords: streams.reduce((sum, row) => sum + row.queueRecords, 0),
    queueBytes: streams.reduce((sum, row) => sum + row.queueBytes, 0),
    unexplainedDrops: streams.reduce(
      (sum, row) => sum + DROP_COUNTERS.reduce((total, key) => total + row.counters[key], 0),
      0,
    ),
    streams,
    changes,
  };
}

export const SOAK_PROBE_TIMEOUT_MS = 15_000;
export interface ResourceProbeFailure {
  readonly command: string;
  readonly pid: number | null;
  readonly elapsedMs: number;
  readonly timeoutMs: number;
  readonly timedOut: boolean;
  readonly code: string | number | null;
  readonly signal: string | null;
}

export interface ResourceProbeOptions {
  readonly timeoutMs?: number;
  readonly onFailure?: (failure: ResourceProbeFailure) => void;
}

/** Only the probe child is killed, never the sampled process. A timed-out observation
 * aborts the run; an ordinary command failure remains an unavailable metric for the oracle. */
export function runResourceProbe(
  command: string,
  args: readonly string[],
  options: ResourceProbeOptions = {},
): Promise<string | null> {
  const timeoutMs = options.timeoutMs ?? SOAK_PROBE_TIMEOUT_MS;
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > SOAK_PROBE_TIMEOUT_MS) {
    throw new RangeError("resource probe deadline must be between 1 and 15000ms");
  }
  return new Promise((resolve, reject) => {
    const started = performance.now();
    let timedOut = false;
    const child = execFile(
      command,
      args,
      { encoding: "utf8", maxBuffer: 4 * 1024 * 1024 },
      (error, stdout) => {
        clearTimeout(timer);
        if (error === null && !timedOut) return resolve(stdout);
        const failure: ResourceProbeFailure = {
          command,
          pid: child.pid ?? null,
          elapsedMs: performance.now() - started,
          timeoutMs,
          timedOut,
          code: error?.code ?? null,
          signal: error?.signal ?? null,
        };
        try {
          options.onFailure?.(failure);
        } catch (observationError) {
          reject(observationError);
          return;
        }
        if (timedOut) reject(new Error(`resource probe ${command} exceeded ${timeoutMs}ms`));
        else resolve(null);
      },
    );
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGKILL");
    }, timeoutMs);
  });
}

type SoakPhase =
  | "setup"
  | "health-settle"
  | "board-save"
  | "daemon-replacement"
  | "renderer-ready"
  | "desk-ready"
  | "desk-stillness"
  | "identity-and-death"
  | "logging-flush"
  | "os-resources"
  | "footprint"
  | "sample"
  | "dwell"
  | "verdict"
  | "teardown";
interface ClockReading {
  readonly monotonicMs: number;
  readonly wallTimeMs: number;
}
interface PhaseReading extends ClockReading {
  readonly phase: SoakPhase;
  readonly cycle: number | null;
}
export type SoakDiagnostic = PhaseReading &
  (
    | {
        readonly kind: "phase";
        readonly previous: (PhaseReading & { readonly durationMs: number }) | null;
      }
    | { readonly kind: "suspend" | "resume" | "operation-failed" }
    | { readonly kind: "logging"; readonly logging: LoggingCensus }
    | { readonly kind: "probe-failed"; readonly probe: ResourceProbeFailure }
    | { readonly kind: "end"; readonly outcome: "pass" | "fail"; readonly phaseDurationMs: number }
  );

/** Streams bounded records as work starts, so the last phase survives a stalled sample.
 * Retains only one phase, not a run-length event buffer. */
export class PhysicalSoakTrace {
  private current: PhaseReading;
  private readonly emit: (event: SoakDiagnostic) => void;
  private readonly clock: () => ClockReading;

  constructor(
    emit: (event: SoakDiagnostic) => void,
    clock: () => ClockReading = () => ({ monotonicMs: performance.now(), wallTimeMs: Date.now() }),
  ) {
    this.emit = emit;
    this.clock = clock;
    this.current = { phase: "setup", cycle: null, ...clock() };
    this.emit({ ...this.current, kind: "phase", previous: null });
  }

  mark(cycle: number | null, phase: SoakPhase): void {
    const now = this.clock();
    const previous = { ...this.current, durationMs: now.monotonicMs - this.current.monotonicMs };
    this.current = { cycle, phase, ...now };
    this.emit({ ...this.current, kind: "phase", previous });
  }

  event(kind: "suspend" | "resume" | "operation-failed"): void {
    this.emit({ ...this.current, ...this.clock(), kind });
  }

  logging(logging: LoggingCensus): void {
    this.emit({ ...this.current, ...this.clock(), kind: "logging", logging });
  }

  probeFailed(probe: ResourceProbeFailure): void {
    this.emit({ ...this.current, ...this.clock(), kind: "probe-failed", probe });
  }

  end(outcome: "pass" | "fail"): void {
    const now = this.clock();
    this.emit({
      ...this.current,
      ...now,
      kind: "end",
      outcome,
      phaseDurationMs: now.monotonicMs - this.current.monotonicMs,
    });
  }
}
