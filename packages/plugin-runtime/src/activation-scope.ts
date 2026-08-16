/** A resource whose future lifetime can be ended by the host. Durable mutations and external
 * emissions deliberately do not satisfy this contract merely because they happened at activate. */
export interface ActivationDisposable {
  dispose(): void | Promise<void>;
}

export type ActivationDisposer = () => void | Promise<void>;
export type ActivationResource = ActivationDisposable | ActivationDisposer;

export type ActivationScopeState = "open" | "closing" | "closed";

/** Structured vocabulary shared by renderer, worker, and process adapters. The first close wins;
 * later observers may have different deadlines, but they cannot rewrite why cleanup began. */
export type ActivationCloseKind =
  | "activation-failed"
  | "activation-timeout"
  | "crash"
  | "disable"
  | "grant-revoked"
  | "host-shutdown"
  | "manual"
  | "parent-close"
  | "quarantine"
  | "reload"
  | "target-changed"
  | "uninstall"
  | "window-close";

export interface ActivationCloseReason {
  readonly kind: ActivationCloseKind;
  readonly detail?: string;
}

export interface ActivationCleanupError {
  readonly label: string;
  readonly name: string;
  readonly message: string;
}

export interface ActivationScopeStats {
  readonly acquired: number;
  readonly disposed: number;
  readonly disposeErrors: number;
  readonly lateArrivals: number;
}

export interface ActivationCloseReport {
  readonly label: string;
  readonly state: ActivationScopeState;
  readonly reason?: ActivationCloseReason;
  /** True only after every owned inverse, in-flight setup, and late cleanup settled. Abort alone
   * can never make this true. */
  readonly quiescent: boolean;
  readonly liveCount: number;
  readonly pendingSetups: number;
  readonly lateCleanups: number;
  readonly stats: ActivationScopeStats;
  readonly errors: readonly ActivationCleanupError[];
  readonly omittedErrors: number;
}

export interface ActivationEffectSnapshot {
  readonly label: string;
  readonly kind: "resource" | "scope";
  readonly status: "live" | "disposing";
  readonly child?: ActivationScopeSnapshot;
}

export interface ActivationScopeSnapshot extends ActivationCloseReport {
  readonly effects: readonly ActivationEffectSnapshot[];
  readonly omittedEffects: number;
}

export interface ActivationScopeOptions {
  /** A setup failure owns its cleanup, but an adapter may bound how long the thrown
   * EffectSetupError waits for the cleanup report. Infinity is the conservative default. */
  readonly failureCleanupDeadlineMs?: number;
  /** Diagnostic projection limits only. All live ownership records remain tracked. */
  readonly maxDiagnosticEffects?: number;
  readonly maxDiagnosticErrors?: number;
  readonly maxLabelLength?: number;
}

export interface BoundaryTerminationReport {
  readonly terminated: boolean;
  readonly forced: boolean;
  readonly detail?: string;
}

/** Cleanup ownership is shared; proof of termination is boundary-specific. */
export interface ActivationTerminationAdapter {
  readonly kind: "same-realm" | "worker" | "process";
  force?(
    reason: ActivationCloseReason,
  ): BoundaryTerminationReport | Promise<BoundaryTerminationReport>;
}

interface MutableStats {
  acquired: number;
  disposed: number;
  disposeErrors: number;
  lateArrivals: number;
}

interface OwnershipRecord {
  readonly label: string;
  readonly kind: "resource" | "scope";
  readonly disposer: ActivationDisposer;
  readonly child?: ActivationScope;
  status: "live" | "disposing" | "disposed";
  childMerged: boolean;
  task?: Promise<void>;
}

interface Deferred<T> {
  readonly promise: Promise<T>;
  resolve(value: T): void;
}

const DEFAULT_MAX_DIAGNOSTIC_EFFECTS = 128;
const DEFAULT_MAX_DIAGNOSTIC_ERRORS = 32;
const DEFAULT_MAX_LABEL_LENGTH = 120;
const MAX_DIAGNOSTIC_ERROR_NAME_LENGTH = 80;
const MAX_DIAGNOSTIC_ERROR_MESSAGE_LENGTH = 512;

function deferred<T>(): Deferred<T> {
  let resolvePromise: ((value: T) => void) | undefined;
  const promise = new Promise<T>((resolve) => {
    resolvePromise = resolve;
  });
  return {
    promise,
    resolve(value) {
      resolvePromise?.(value);
    },
  };
}

function describeError(error: unknown): Omit<ActivationCleanupError, "label"> {
  if (error instanceof Error) return { name: error.name, message: error.message };
  return { name: "Error", message: String(error) };
}

function disposerOf(value: ActivationResource): ActivationDisposer {
  if (typeof value === "function") return value;
  return () => value.dispose();
}

function normalizedDeadline(deadlineMs: number): number {
  return Number.isFinite(deadlineMs) ? Math.max(0, deadlineMs) : Number.POSITIVE_INFINITY;
}

function positiveInteger(value: number | undefined, fallback: number): number {
  if (value === undefined || !Number.isFinite(value)) return fallback;
  return Math.max(1, Math.floor(value));
}

async function observeBefore(task: Promise<void>, deadlineMs: number): Promise<boolean> {
  if (deadlineMs === Number.POSITIVE_INFINITY) {
    await task;
    return true;
  }
  let timer: ReturnType<typeof setTimeout> | undefined;
  const finished = await Promise.race([
    task.then(() => true),
    new Promise<false>((resolve) => {
      timer = setTimeout(() => resolve(false), deadlineMs);
    }),
  ]);
  if (timer !== undefined) clearTimeout(timer);
  return finished;
}

export class InactiveActivationScopeError extends Error {
  readonly scopeLabel: string;

  constructor(label: string) {
    super(`activation scope ${label} is no longer open`);
    this.name = "InactiveActivationScopeError";
    this.scopeLabel = label;
  }
}

/** The primary setup failure and its cleanup outcome stay separately inspectable. */
export class ActivationEffectSetupError extends Error {
  readonly effectLabel: string;
  readonly cleanup: ActivationCloseReport;

  constructor(label: string, cause: unknown, cleanup: ActivationCloseReport) {
    super(
      `effect ${label} failed during setup: ${cause instanceof Error ? cause.message : String(cause)}`,
      { cause },
    );
    this.name = "ActivationEffectSetupError";
    this.effectLabel = label;
    this.cleanup = cleanup;
  }
}

/**
 * Host-owned tree of ephemeral acquisitions.
 *
 * The close gate is synchronous; cleanup is single-flight and awaited in strict reverse order.
 * Each observer owns only its wait deadline. A resource arriving after close is adopted long
 * enough to dispose itself and is never allowed to become live.
 */
export class ActivationScope {
  readonly label: string;
  readonly signal: AbortSignal;

  private readonly controller = new AbortController();
  private readonly records: OwnershipRecord[] = [];
  private readonly ownedValues = new WeakMap<object, OwnershipRecord>();
  private readonly pendingSetups = new Set<Promise<void>>();
  private readonly lateCleanups = new Set<Promise<void>>();
  private readonly cleanupErrors: ActivationCleanupError[] = [];
  private readonly closedCallbacks = new Set<() => void>();
  private readonly closed = deferred<void>();
  private readonly failureCleanupDeadlineMs: number;
  private readonly maxDiagnosticEffects: number;
  private readonly maxDiagnosticErrors: number;
  private readonly maxLabelLength: number;
  private readonly stats: MutableStats = {
    acquired: 0,
    disposed: 0,
    disposeErrors: 0,
    lateArrivals: 0,
  };
  private omittedErrors = 0;
  private closeReason?: ActivationCloseReason;
  private currentState: ActivationScopeState = "open";
  private cleanupStarted = false;

  constructor(label: string, options: ActivationScopeOptions = {}) {
    this.maxLabelLength = positiveInteger(options.maxLabelLength, DEFAULT_MAX_LABEL_LENGTH);
    this.maxDiagnosticEffects = positiveInteger(
      options.maxDiagnosticEffects,
      DEFAULT_MAX_DIAGNOSTIC_EFFECTS,
    );
    this.maxDiagnosticErrors = positiveInteger(
      options.maxDiagnosticErrors,
      DEFAULT_MAX_DIAGNOSTIC_ERRORS,
    );
    this.failureCleanupDeadlineMs = normalizedDeadline(
      options.failureCleanupDeadlineMs ?? Number.POSITIVE_INFINITY,
    );
    this.label = this.boundLabel(label);
    this.signal = this.controller.signal;
  }

  get state(): ActivationScopeState {
    return this.currentState;
  }

  track<T extends ActivationResource>(resource: T): T;
  track<T extends ActivationResource>(label: string, resource: T): T;
  track<T extends ActivationResource>(labelOrResource: string | T, possibleResource?: T): T {
    const labeled = typeof labelOrResource === "string";
    const label = labeled ? labelOrResource : "plugin:tracked";
    const resource = labeled ? possibleResource : labelOrResource;
    if (resource === undefined) throw new TypeError(`${this.boundLabel(label)} is not disposable`);
    return this.adopt(label, resource);
  }

  child(label: string): ActivationScope {
    return this.createChild(label);
  }

  /** Registers the child ownership edge and its setup marker before plugin/library code runs. */
  async effect<T>(
    label: string,
    acquire: (effect: ActivationScope, signal: AbortSignal) => T | Promise<T>,
  ): Promise<T> {
    this.assertOpen();
    const effect = this.createChild(label);
    const setup = deferred<void>();
    effect.pendingSetups.add(setup.promise);
    let setupSettled = false;
    const settleSetup = (): void => {
      if (setupSettled) return;
      setupSettled = true;
      effect.pendingSetups.delete(setup.promise);
      setup.resolve();
    };

    let acquired: T | Promise<T>;
    try {
      acquired = acquire(effect, effect.signal);
    } catch (error) {
      acquired = Promise.reject(error);
    }

    try {
      const value = await acquired;
      if (this.isActivationResource(value)) {
        effect.adopt("$return", value, true);
      }
      return value;
    } catch (cause) {
      // Settling first is load-bearing: otherwise failure cleanup waits for the setup marker while
      // this catch waits for cleanup, a self-deadlock.
      settleSetup();
      effect.close({ kind: "activation-failed", detail: effect.label });
      const cleanup = await effect.observe(this.failureCleanupDeadlineMs);
      throw new ActivationEffectSetupError(effect.label, cause, cleanup);
    } finally {
      settleSetup();
    }
  }

  /** Closes authority synchronously and starts one cleanup chain. The first reason wins. */
  close(reason: ActivationCloseReason): void {
    if (this.currentState !== "open") return;
    const sealed: ActivationScope[] = [];
    this.sealTree(reason, sealed);
    // Every existing descendant is gated before the first abort listener runs. A callback in
    // one child therefore cannot acquire through a sibling that merely had not been visited yet.
    for (const scope of sealed) scope.controller.abort(scope.closeReason);
    this.startCleanup();
  }

  private startCleanup(): void {
    if (this.currentState === "closed" || this.cleanupStarted) return;
    this.cleanupStarted = true;
    const initial = [...this.records].reverse();
    void this.runCleanup(initial);
  }

  /** Waits only as long as this observer requested; cleanup continues after a deadline report. */
  async observe(deadlineMs = Number.POSITIVE_INFINITY): Promise<ActivationCloseReport> {
    await observeBefore(this.awaitCurrentQuiescence(), normalizedDeadline(deadlineMs));
    return this.report();
  }

  /** May never settle for uncooperative same-realm work. It never initiates close by itself. */
  async whenQuiescent(): Promise<ActivationCloseReport> {
    await this.awaitCurrentQuiescence();
    return this.report();
  }

  report(): ActivationCloseReport {
    const childReports = this.liveChildReports();
    const stats = { ...this.stats };
    let pendingSetups = this.pendingSetups.size;
    let lateCleanups = this.lateCleanups.size;
    let liveCount = this.records.length;
    const errors = this.cleanupErrors.map((error) => ({ ...error }));
    let omittedErrors = this.omittedErrors;

    for (const { record, report } of childReports) {
      stats.acquired += report.stats.acquired;
      stats.disposed += report.stats.disposed;
      stats.disposeErrors += report.stats.disposeErrors;
      stats.lateArrivals += report.stats.lateArrivals;
      pendingSetups += report.pendingSetups;
      lateCleanups += report.lateCleanups;
      liveCount += report.liveCount;
      omittedErrors += report.omittedErrors;
      for (const error of report.errors) {
        if (errors.length >= this.maxDiagnosticErrors) {
          omittedErrors += 1;
          continue;
        }
        errors.push({ ...error, label: this.boundLabel(`${record.label}/${error.label}`) });
      }
    }

    return {
      label: this.label,
      state: this.currentState,
      ...(this.closeReason === undefined ? {} : { reason: { ...this.closeReason } }),
      quiescent:
        this.currentState === "closed" &&
        liveCount === 0 &&
        pendingSetups === 0 &&
        lateCleanups === 0,
      liveCount,
      pendingSetups,
      lateCleanups,
      stats,
      errors,
      omittedErrors,
    };
  }

  snapshot(): ActivationScopeSnapshot {
    const omittedEffects = Math.max(0, this.records.length - this.maxDiagnosticEffects);
    const visible = this.records.slice(-this.maxDiagnosticEffects);
    return {
      ...this.report(),
      effects: visible.map((record) => ({
        label: record.label,
        kind: record.kind,
        status: record.status === "disposed" ? "disposing" : record.status,
        ...(record.child === undefined ? {} : { child: record.child.snapshot() }),
      })),
      omittedEffects,
    };
  }

  private boundLabel(label: string): string {
    const normalized =
      [...label.slice(0, this.maxLabelLength)]
        .map((character) => {
          const code = character.charCodeAt(0);
          return code <= 31 || code === 127 ? " " : character;
        })
        .join("")
        .trim() || "unnamed";
    return normalized.slice(0, this.maxLabelLength);
  }

  private boundDiagnosticText(value: string, maxLength: number, fallback: string): string {
    const normalized = [...value.slice(0, maxLength)]
      .map((character) => {
        const code = character.charCodeAt(0);
        return code <= 31 || code === 127 ? " " : character;
      })
      .join("")
      .trim();
    return (normalized || fallback).slice(0, maxLength);
  }

  private assertOpen(): void {
    if (this.currentState !== "open") throw new InactiveActivationScopeError(this.label);
  }

  private isActivationResource(value: unknown): value is ActivationResource {
    return (
      typeof value === "function" ||
      (typeof value === "object" &&
        value !== null &&
        typeof (value as { dispose?: unknown }).dispose === "function")
    );
  }

  private record(
    label: string,
    disposer: ActivationDisposer,
    kind: OwnershipRecord["kind"],
    child?: ActivationScope,
  ): OwnershipRecord {
    const record: OwnershipRecord = {
      label: this.boundLabel(label),
      kind,
      disposer,
      status: "live",
      childMerged: false,
      ...(child === undefined ? {} : { child }),
    };
    this.records.push(record);
    this.stats.acquired += 1;
    return record;
  }

  private adopt<T extends ActivationResource>(label: string, value: T, internalLate = false): T {
    const key = value as object;
    const existing = this.ownedValues.get(key);
    if (existing !== undefined) {
      if (this.currentState !== "open" && !internalLate) this.assertOpen();
      return value;
    }
    const record = this.record(label, disposerOf(value), "resource");
    this.ownedValues.set(key, record);
    if (this.currentState === "open") return value;
    this.startLateCleanup(record);
    if (!internalLate) this.assertOpen();
    return value;
  }

  private createChild(label: string, internalLate = false): ActivationScope {
    const childLabel = this.boundLabel(label);
    const child = new ActivationScope(`${this.label}/${childLabel}`, {
      failureCleanupDeadlineMs: this.failureCleanupDeadlineMs,
      maxDiagnosticEffects: this.maxDiagnosticEffects,
      maxDiagnosticErrors: this.maxDiagnosticErrors,
      maxLabelLength: this.maxLabelLength,
    });
    const record = this.record(
      childLabel,
      async () => {
        child.close({ kind: "parent-close", detail: this.label });
        // An ancestor's phase-one tree seal deliberately does not start descendant cleanup.
        // Reaching this ownership record is the LIFO permission to begin it.
        child.startCleanup();
        await child.whenQuiescent();
      },
      "scope",
      child,
    );
    child.onClosed(() => this.retireClosedChild(record));
    if (this.currentState !== "open") {
      const sealed: ActivationScope[] = [];
      child.sealTree({ kind: "parent-close", detail: this.label }, sealed);
      for (const scope of sealed) scope.controller.abort(scope.closeReason);
      this.startLateCleanup(record);
      if (!internalLate) this.assertOpen();
    }
    return child;
  }

  private onClosed(callback: () => void): void {
    if (this.currentState === "closed") {
      callback();
      return;
    }
    this.closedCallbacks.add(callback);
  }

  private startLateCleanup(record: OwnershipRecord): void {
    this.stats.lateArrivals += 1;
    const task = this.disposeRecord(record);
    this.lateCleanups.add(task);
    void task.finally(() => this.lateCleanups.delete(task));
  }

  private disposeRecord(record: OwnershipRecord): Promise<void> {
    if (record.task !== undefined) return record.task;
    // A child can finish and compact while an earlier LIFO record keeps its parent's captured
    // cleanup list waiting. Do not execute or count that already-retired ownership edge again.
    if (record.status === "disposed") return Promise.resolve();
    record.status = "disposing";
    // Defer invocation by one microtask so record.task exists before a reentrant disposer can call
    // close/observe again.
    record.task = Promise.resolve().then(async () => {
      try {
        await record.disposer();
      } catch (error) {
        this.stats.disposeErrors += 1;
        this.addCleanupError(record.label, error);
      } finally {
        this.mergeChild(record);
        record.status = "disposed";
        this.stats.disposed += 1;
        const index = this.records.indexOf(record);
        if (index >= 0) this.records.splice(index, 1);
      }
    });
    return record.task;
  }

  private async runCleanup(initial: readonly OwnershipRecord[]): Promise<void> {
    try {
      // Completion order, not merely start order, is LIFO. An inverse may rely on the resource
      // acquired immediately before it until that inverse has completely settled.
      for (const record of initial) await this.disposeRecord(record);
      await this.awaitDynamicWork();
    } catch (error) {
      // Resource failures are caught per record; this is a last-resort invariant guard so an
      // internal bookkeeping error cannot strand every observer forever.
      this.addCleanupError("$scope", error);
    } finally {
      this.currentState = "closed";
      for (const callback of this.closedCallbacks) {
        try {
          callback();
        } catch (error) {
          this.addCleanupError("$closed-callback", error);
        }
      }
      this.closedCallbacks.clear();
      this.closed.resolve();
    }
  }

  private async awaitDynamicWork(): Promise<void> {
    while (true) {
      const work = [...this.pendingSetups, ...this.lateCleanups];
      if (work.length === 0) return;
      await Promise.allSettled(work);
    }
  }

  /** Phase one of close: mark the whole existing ownership tree before emitting any abort event.
   * Cleanup is deliberately not started here; the owning records still invoke it in LIFO order. */
  private sealTree(reason: ActivationCloseReason, sealed: ActivationScope[]): void {
    if (this.currentState !== "open") return;
    this.closeReason = Object.freeze({ ...reason });
    this.currentState = "closing";
    sealed.push(this);
    for (const record of [...this.records]) {
      record.child?.sealTree({ kind: "parent-close", detail: this.label }, sealed);
    }
  }

  /** Closed is monotonic, but an illegal post-close transfer can still hand us a disposer.
   * Observers that arrive after that transfer must include its self-cleanup in quiescence. */
  private async awaitCurrentQuiescence(): Promise<void> {
    await this.closed.promise;
    await this.awaitDynamicWork();
  }

  private retireClosedChild(record: OwnershipRecord): void {
    if (record.status !== "live") return;
    this.mergeChild(record);
    record.status = "disposed";
    this.stats.disposed += 1;
    const index = this.records.indexOf(record);
    if (index >= 0) this.records.splice(index, 1);
  }

  private mergeChild(record: OwnershipRecord): void {
    if (record.child === undefined || record.childMerged) return;
    record.childMerged = true;
    const child = record.child.report();
    this.stats.acquired += child.stats.acquired;
    this.stats.disposed += child.stats.disposed;
    this.stats.disposeErrors += child.stats.disposeErrors;
    this.stats.lateArrivals += child.stats.lateArrivals;
    this.omittedErrors += child.omittedErrors;
    for (const error of child.errors) {
      this.addCleanupError(`${record.label}/${error.label}`, error);
    }
  }

  private addCleanupError(label: string, error: unknown): void {
    if (this.cleanupErrors.length >= this.maxDiagnosticErrors) {
      this.omittedErrors += 1;
      return;
    }
    const described =
      typeof error === "object" &&
      error !== null &&
      "name" in error &&
      "message" in error &&
      typeof error.name === "string" &&
      typeof error.message === "string"
        ? { name: error.name, message: error.message }
        : describeError(error);
    this.cleanupErrors.push({
      label: this.boundLabel(label),
      name: this.boundDiagnosticText(described.name, MAX_DIAGNOSTIC_ERROR_NAME_LENGTH, "Error"),
      message: this.boundDiagnosticText(
        described.message,
        MAX_DIAGNOSTIC_ERROR_MESSAGE_LENGTH,
        "cleanup failed",
      ),
    });
  }

  private liveChildReports(): Array<{
    record: OwnershipRecord;
    report: ActivationCloseReport;
  }> {
    return this.records.flatMap((record) =>
      record.child === undefined || record.childMerged
        ? []
        : [{ record, report: record.child.report() }],
    );
  }
}
