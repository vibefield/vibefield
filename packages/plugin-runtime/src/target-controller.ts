import {
  type ActivationCloseReason,
  type ActivationCloseReport,
  ActivationEffectSetupError,
  ActivationScope,
  type ActivationScopeDiagnostic,
  type ActivationScopeSnapshot,
  type ActivationTerminationAdapter,
  type BoundaryTerminationReport,
} from "./activation-scope";
import {
  type PluginRuntimeTarget,
  samePluginRuntimeObservation,
  samePluginRuntimeTarget,
} from "./runtime-target";

export type RuntimeTargetControllerState =
  | "inactive"
  | "loading"
  | "prepared"
  | "active"
  | "refreshing"
  | "unloading"
  | "failed"
  | "non-quiescent";

export type RuntimeLifecycleEventKind =
  | "close-edge"
  | "controller-error"
  | "desired"
  | "force-confirmed"
  | "force-error"
  | "force-unconfirmed"
  | "late-quiescence"
  | "load-commit"
  | "load-failed"
  | "load-prepared"
  | "load-stale"
  | "load-start"
  | "load-timeout"
  | "non-quiescent"
  | "prepared-commit"
  | "prepared-commit-failed"
  | "prepared-commit-stale"
  | "prepared-unloaded"
  | "refresh-commit"
  | "refresh-failed"
  | "refresh-stale"
  | "refresh-start"
  | "unloaded";

/** Compact target identity for recent lifecycle history. Current desired/committed targets remain
 * exact and structured on the controller diagnostic; repeating the authority vector in every
 * event would turn a count-bounded ring into an avoidable byte amplifier. */
export interface RuntimeLifecycleTarget {
  readonly face: PluginRuntimeTarget["face"];
  readonly pluginId: string;
  readonly instanceKey: string;
  readonly installRevision: string;
  readonly manifestHash: string;
  readonly observedGrantGeneration: number;
  readonly runtimeGeneration?: string;
}

export interface RuntimeCloseSummary {
  readonly reason?: ActivationCloseReason;
  readonly quiescent: boolean;
  readonly liveCount: number;
  readonly pendingSetups: number;
  readonly lateCleanups: number;
  readonly disposeErrors: number;
  readonly omittedErrors: number;
}

export interface RuntimeTargetLifecycleEvent {
  readonly sequence: number;
  readonly event: RuntimeLifecycleEventKind;
  readonly state: RuntimeTargetControllerState;
  readonly revision?: number;
  readonly phase?: string;
  readonly target?: RuntimeLifecycleTarget | null;
  readonly reason?: ActivationCloseReason;
  readonly error?: string;
  readonly close?: RuntimeCloseSummary;
  readonly force?: BoundaryTerminationReport;
}

export interface RuntimeBoundaryForceDiagnostic {
  readonly state: "confirmed" | "unconfirmed" | "error";
  readonly phase: string;
  readonly target: PluginRuntimeTarget;
  readonly outcome?: BoundaryTerminationReport;
  readonly error?: string;
}

export interface RuntimeTargetControllerDiagnostic {
  readonly label: string;
  readonly state: RuntimeTargetControllerState;
  readonly desired: PluginRuntimeTarget | null;
  readonly committed: PluginRuntimeTarget | null;
  readonly desiredRevision: number;
  readonly error?: string;
  readonly blocked: { readonly phase: string; readonly target: PluginRuntimeTarget } | null;
  readonly scope: ActivationScopeDiagnostic | null;
  readonly lastClose: ActivationCloseReport | null;
  readonly force: {
    readonly confirmedCount: number;
    readonly last: RuntimeBoundaryForceDiagnostic | null;
  };
  readonly history: readonly RuntimeTargetLifecycleEvent[];
  readonly omittedHistory: number;
}

/** Adapter-owned work remains private until commit. ActivationScope adopts the candidate's exact
 * inverse before the controller can call commit. `commit` must be synchronous; a candidate whose
 * publications can outlive its authority gate must withdraw them synchronously on scope abort. */
export interface RuntimeTargetCandidate {
  commit(): void;
  dispose(): void | Promise<void>;
}

export interface RuntimeTargetControllerOptions<
  T extends PluginRuntimeTarget,
  C extends RuntimeTargetCandidate,
> {
  activate(target: T, scope: ActivationScope, signal: AbortSignal): C | Promise<C>;
  /** A semantic-equal target has the same API shape, but a newer grant observation still needs a
   * fresh provenance-bound credential. Credential-free adapters may omit this hook. */
  refresh?(candidate: C, previous: T, next: T, signal: AbortSignal): void | Promise<void>;
  /** Same-realm adapters cannot prove force. Worker/process adapters may proceed only after this
   * adapter returns `terminated: true`. */
  termination?: ActivationTerminationAdapter;
  activationDeadlineMs?: number;
  disposalDeadlineMs?: number;
  scopeFactory?: (label: string) => ActivationScope;
  historyLimit?: number;
  /** Host-owned lifecycle log/metric sink. It receives immutable compact values only; faults and
   * rejected promises are contained and can never interrupt reconciliation. */
  observeLifecycle?(event: RuntimeTargetLifecycleEvent): void | Promise<void>;
}

export interface RuntimeTargetDesiredOptions {
  reason?: ActivationCloseReason;
  /** Begins a new observation episode even when the desired vector is unchanged. */
  retry?: boolean;
}

export interface RuntimeTargetControllerBlocked<T extends PluginRuntimeTarget> {
  readonly phase: string;
  readonly target: T;
  readonly report: ActivationCloseReport;
}

export interface RuntimeTargetControllerSnapshot<T extends PluginRuntimeTarget> {
  readonly label: string;
  readonly state: RuntimeTargetControllerState;
  readonly desired: T | null;
  readonly committed: T | null;
  readonly desiredRevision: number;
  readonly error?: string;
  readonly forcedCount: number;
  readonly blocked: RuntimeTargetControllerBlocked<T> | null;
  readonly activeScope: ActivationScopeSnapshot | null;
  readonly history: readonly RuntimeTargetLifecycleEvent[];
  readonly omittedHistory: number;
}

interface Active<T extends PluginRuntimeTarget, C extends RuntimeTargetCandidate> {
  target: T;
  readonly candidate: C;
  readonly scope: ActivationScope;
}

interface Loading<T extends PluginRuntimeTarget> {
  readonly target: T;
  readonly revision: number;
  readonly scope: ActivationScope;
}

interface Prepared<T extends PluginRuntimeTarget, C extends RuntimeTargetCandidate>
  extends Loading<T> {
  readonly candidate: C;
}

interface Blocked<T extends PluginRuntimeTarget> extends RuntimeTargetControllerBlocked<T> {
  readonly token: object;
  readonly scope: ActivationScope;
}

interface RuntimeLifecycleEventData<T extends PluginRuntimeTarget> {
  readonly revision?: number;
  readonly phase?: string;
  readonly target?: T | null;
  readonly reason?: ActivationCloseReason;
  readonly error?: string;
  readonly report?: ActivationCloseReport;
  readonly outcome?: BoundaryTerminationReport;
}

type TimedOutcome<T> =
  | { readonly kind: "value"; readonly value: T }
  | { readonly kind: "error"; readonly error: unknown }
  | { readonly kind: "timeout" };

function normalizedDeadline(value: number | undefined): number {
  if (value === undefined || !Number.isFinite(value)) return Number.POSITIVE_INFINITY;
  return Math.max(0, value);
}

function boundedPositiveInteger(
  value: number | undefined,
  fallback: number,
  maximum: number,
): number {
  if (value === undefined || !Number.isFinite(value)) return fallback;
  return Math.min(maximum, Math.max(1, Math.floor(value)));
}

const DEFAULT_HISTORY_LIMIT = 64;
const MAX_CONTROLLER_TEXT_LENGTH = 512;
const MAX_CONTROLLER_PHASE_LENGTH = 80;
const MAX_LIFECYCLE_TARGET_PART_LENGTH = 512;

function boundedText(value: string, maxLength: number, fallback: string): string {
  const normalized = [...value.slice(0, maxLength)]
    .map((character) => {
      const code = character.charCodeAt(0);
      return code <= 31 || code === 127 ? " " : character;
    })
    .join("")
    .trim();
  return (normalized || fallback).slice(0, maxLength);
}

function copyReason(reason: ActivationCloseReason | undefined): ActivationCloseReason | undefined {
  if (reason === undefined) return undefined;
  return Object.freeze({
    kind: reason.kind,
    ...(reason.detail === undefined
      ? {}
      : { detail: boundedText(reason.detail, MAX_CONTROLLER_TEXT_LENGTH, reason.kind) }),
  });
}

function copyTarget(target: PluginRuntimeTarget): PluginRuntimeTarget {
  const artifact = Object.freeze({
    installRevision: target.artifact.installRevision,
    manifestHash: target.artifact.manifestHash,
    ...(target.artifact.approvedModuleGeneration === undefined
      ? {}
      : { approvedModuleGeneration: target.artifact.approvedModuleGeneration }),
  });
  const base = {
    face: target.face,
    pluginId: target.pluginId,
    artifact,
    authorityFingerprint: target.authorityFingerprint,
    observedGrantGeneration: target.observedGrantGeneration,
    ...(target.runtimeGeneration === undefined
      ? {}
      : { runtimeGeneration: target.runtimeGeneration }),
  };
  switch (target.face) {
    case "service":
      return Object.freeze({
        ...base,
        face: "service",
        instanceKey: Object.freeze({ deviceId: target.instanceKey.deviceId }),
      });
    case "renderer":
      return Object.freeze({
        ...base,
        face: "renderer",
        instanceKey: Object.freeze({ windowId: target.instanceKey.windowId }),
      });
    case "behavior":
      return Object.freeze({
        ...base,
        face: "behavior",
        instanceKey: Object.freeze({
          windowId: target.instanceKey.windowId,
          documentId: target.instanceKey.documentId,
          behaviorDeclarationId: target.instanceKey.behaviorDeclarationId,
        }),
        runtimeGeneration: target.runtimeGeneration,
      });
  }
}

function lifecycleTarget(target: PluginRuntimeTarget): RuntimeLifecycleTarget {
  const instanceKey =
    target.face === "service"
      ? target.instanceKey.deviceId
      : target.face === "renderer"
        ? target.instanceKey.windowId
        : `${target.instanceKey.windowId}/${target.instanceKey.documentId}/${target.instanceKey.behaviorDeclarationId}`;
  return Object.freeze({
    face: target.face,
    pluginId: boundedText(target.pluginId, MAX_LIFECYCLE_TARGET_PART_LENGTH, "unknown-plugin"),
    instanceKey: boundedText(instanceKey, MAX_LIFECYCLE_TARGET_PART_LENGTH, "unknown-instance"),
    installRevision: boundedText(
      target.artifact.installRevision,
      MAX_LIFECYCLE_TARGET_PART_LENGTH,
      "unknown-revision",
    ),
    manifestHash: boundedText(
      target.artifact.manifestHash,
      MAX_LIFECYCLE_TARGET_PART_LENGTH,
      "unknown-manifest",
    ),
    observedGrantGeneration: target.observedGrantGeneration,
    ...(target.runtimeGeneration === undefined
      ? {}
      : {
          runtimeGeneration: boundedText(
            target.runtimeGeneration,
            MAX_LIFECYCLE_TARGET_PART_LENGTH,
            "unknown-generation",
          ),
        }),
  });
}

function copyCloseReport(report: ActivationCloseReport): ActivationCloseReport {
  return Object.freeze({
    label: report.label,
    state: report.state,
    ...(report.reason === undefined ? {} : { reason: copyReason(report.reason)! }),
    quiescent: report.quiescent,
    liveCount: report.liveCount,
    pendingSetups: report.pendingSetups,
    lateCleanups: report.lateCleanups,
    stats: Object.freeze({ ...report.stats }),
    errors: Object.freeze(report.errors.map((error) => Object.freeze({ ...error }))),
    omittedErrors: report.omittedErrors,
  });
}

function closeSummary(report: ActivationCloseReport): RuntimeCloseSummary {
  return Object.freeze({
    ...(report.reason === undefined ? {} : { reason: copyReason(report.reason)! }),
    quiescent: report.quiescent,
    liveCount: report.liveCount,
    pendingSetups: report.pendingSetups,
    lateCleanups: report.lateCleanups,
    disposeErrors: report.stats.disposeErrors,
    omittedErrors: report.omittedErrors,
  });
}

function copyTerminationReport(report: BoundaryTerminationReport): BoundaryTerminationReport {
  return Object.freeze({
    terminated: report.terminated,
    forced: report.forced,
    ...(report.detail === undefined
      ? {}
      : { detail: boundedText(report.detail, MAX_CONTROLLER_TEXT_LENGTH, "no detail") }),
  });
}

async function outcomeBefore<T>(task: Promise<T>, deadlineMs: number): Promise<TimedOutcome<T>> {
  if (deadlineMs === Number.POSITIVE_INFINITY) {
    try {
      return { kind: "value", value: await task };
    } catch (error) {
      return { kind: "error", error };
    }
  }
  let timer: ReturnType<typeof setTimeout> | undefined;
  const outcome = await Promise.race<TimedOutcome<T>>([
    task.then(
      (value) => ({ kind: "value", value }),
      (error) => ({ kind: "error", error }),
    ),
    new Promise<TimedOutcome<T>>((resolve) => {
      timer = setTimeout(() => resolve({ kind: "timeout" }), deadlineMs);
    }),
  ]);
  if (timer !== undefined) clearTimeout(timer);
  return outcome;
}

function targetLabel(target: PluginRuntimeTarget): string {
  const instance =
    target.face === "service"
      ? target.instanceKey.deviceId
      : target.face === "renderer"
        ? target.instanceKey.windowId
        : `${target.instanceKey.windowId}/${target.instanceKey.documentId}/${target.instanceKey.behaviorDeclarationId}`;
  return `${target.face}:${target.pluginId}:${instance}`;
}

function errorMessage(error: unknown): string {
  const primary = error instanceof ActivationEffectSetupError ? error.cause : error;
  const raw = primary instanceof Error ? primary.message : String(primary);
  const normalized = [...raw.slice(0, 512)]
    .map((character) => {
      const code = character.charCodeAt(0);
      return code <= 31 || code === 127 ? " " : character;
    })
    .join("")
    .trim();
  return normalized || "Error";
}

function isThenable(value: unknown): value is PromiseLike<unknown> {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as { then?: unknown }).then === "function"
  );
}

/**
 * Reconciles one exact plugin face/instance from a desired target to at most one committed target.
 *
 * Desired changes coalesce behind one inertia promise. Different semantic targets close active
 * ingress synchronously and unload before replacement. A newer grant observation closes an
 * in-flight candidate but refreshes a semantic-equal committed candidate. Candidate publication
 * happens only at one synchronous, stale-checked commit edge. Normal targets commit automatically;
 * disruptive participants may stop at `prepared` for a coordinator-owned commitPrepared().
 */
export class RuntimeTargetController<
  T extends PluginRuntimeTarget,
  C extends RuntimeTargetCandidate,
> {
  readonly label: string;

  private readonly activationDeadlineMs: number;
  private readonly disposalDeadlineMs: number;
  private readonly historyLimit: number;
  private readonly scopeFactory: (label: string) => ActivationScope;
  // Plain field assignment: the service worker imports this barrel through Node's strip-only
  // TypeScript loader, which cannot transform constructor parameter properties.
  private readonly options: RuntimeTargetControllerOptions<T, C>;
  private desiredValue: T | null = null;
  private desiredReason: ActivationCloseReason = { kind: "target-changed" };
  private desiredCommitMode: "automatic" | "manual" = "automatic";
  private desiredRevisionValue = 0;
  private committedValue: T | null = null;
  private activeValue: Active<T, C> | null = null;
  private loadingValue: Loading<T> | null = null;
  private preparedValue: Prepared<T, C> | null = null;
  private failedRevision: number | undefined;
  private loop: Promise<void> | undefined;
  private blockedValue: Blocked<T> | undefined;
  private errorValue: string | undefined;
  private stateValue: RuntimeTargetControllerState = "inactive";
  private forcedCountValue = 0;
  private lastCloseValue: ActivationCloseReport | null = null;
  private lastForceValue: RuntimeBoundaryForceDiagnostic | null = null;
  private nextEventSequence = 1;
  private omittedHistoryValue = 0;
  private readonly events: RuntimeTargetLifecycleEvent[] = [];

  constructor(label: string, options: RuntimeTargetControllerOptions<T, C>) {
    this.label = label;
    this.options = options;
    this.activationDeadlineMs = normalizedDeadline(options.activationDeadlineMs);
    this.disposalDeadlineMs = normalizedDeadline(options.disposalDeadlineMs);
    this.historyLimit = boundedPositiveInteger(
      options.historyLimit,
      DEFAULT_HISTORY_LIMIT,
      DEFAULT_HISTORY_LIMIT,
    );
    this.scopeFactory =
      options.scopeFactory ??
      ((scopeLabel) =>
        new ActivationScope(scopeLabel, {
          failureCleanupDeadlineMs: this.disposalDeadlineMs,
        }));
  }

  get state(): RuntimeTargetControllerState {
    return this.stateValue;
  }

  get desired(): T | null {
    return this.desiredValue;
  }

  get committed(): T | null {
    return this.committedValue;
  }

  get activeCandidate(): C | undefined {
    return this.activeValue?.candidate;
  }

  get preparedCandidate(): C | undefined {
    return this.preparedValue?.candidate;
  }

  get desiredRevision(): number {
    return this.desiredRevisionValue;
  }

  get forcedCount(): number {
    return this.forcedCountValue;
  }

  /** Sets intent and returns its monotonic observation revision. A semantic target change closes
   * committed ingress before this method returns; a loading attempt closes on every new
   * observation so credentials minted before an intervening grant event can never commit. */
  setDesired(target: T | null, options: RuntimeTargetDesiredOptions = {}): number {
    return this.setDesiredWithMode(target, "automatic", options);
  }

  /** PRC-5c disruptive participant seam. It performs the same break-before-make
   * reconciliation but holds a fully activated candidate private until
   * commitPrepared() is called at the coordinator's logical commit edge. */
  prepareDesired(target: T, options: RuntimeTargetDesiredOptions = {}): number {
    return this.setDesiredWithMode(target, "manual", options);
  }

  private setDesiredWithMode(
    target: T | null,
    commitMode: "automatic" | "manual",
    options: RuntimeTargetDesiredOptions,
  ): number {
    if (
      !options.retry &&
      this.desiredCommitMode === commitMode &&
      samePluginRuntimeObservation(this.desiredValue, target)
    ) {
      return this.desiredRevisionValue;
    }

    this.desiredValue = target;
    this.desiredCommitMode = commitMode;
    this.desiredReason = options.reason ?? { kind: "target-changed" };
    this.desiredRevisionValue += 1;
    this.failedRevision = undefined;
    this.errorValue = undefined;
    this.record("desired", { revision: this.desiredRevisionValue, target });

    if (this.loadingValue !== null) this.loadingValue.scope.close(this.desiredReason);
    if (this.preparedValue !== null) this.preparedValue.scope.close(this.desiredReason);
    if (
      this.activeValue !== null &&
      (options.retry || !samePluginRuntimeTarget(this.activeValue.target, target))
    ) {
      this.committedValue = null;
      this.activeValue.scope.close(this.desiredReason);
      this.stateValue = "unloading";
      this.record("close-edge", { target: this.activeValue.target, reason: this.desiredReason });
    }

    this.ensureLoop();
    return this.desiredRevisionValue;
  }

  retry(reason: ActivationCloseReason = { kind: "manual" }): number {
    return this.setDesired(this.desiredValue, { reason, retry: true });
  }

  /** One synchronous publication edge for a manually prepared candidate. */
  commitPrepared(): RuntimeTargetControllerSnapshot<T> {
    const prepared = this.preparedValue;
    if (
      prepared === null ||
      this.desiredCommitMode !== "manual" ||
      prepared.revision !== this.desiredRevisionValue ||
      prepared.scope.state !== "open" ||
      !samePluginRuntimeObservation(prepared.target, this.desiredValue)
    ) {
      throw new Error(`${this.label}: no current prepared target to commit`);
    }

    try {
      const commitResult = prepared.candidate.commit() as unknown;
      if (isThenable(commitResult)) {
        void Promise.resolve(commitResult).catch(() => undefined);
        throw new TypeError("target candidate commit must be synchronous");
      }
    } catch (error) {
      this.errorValue = errorMessage(error);
      this.failedRevision = prepared.revision;
      prepared.scope.close({ kind: "activation-failed", detail: "candidate commit failed" });
      this.stateValue = "unloading";
      this.record("prepared-commit-failed", {
        target: prepared.target,
        revision: prepared.revision,
        error: this.errorValue,
      });
      this.ensureLoop();
      throw error;
    }

    // Publication callbacks may synchronously supersede the target. The scope
    // close withdraws the just-published candidate before this method returns.
    if (
      this.preparedValue !== prepared ||
      prepared.revision !== this.desiredRevisionValue ||
      !samePluginRuntimeObservation(prepared.target, this.desiredValue) ||
      prepared.scope.state !== "open"
    ) {
      prepared.scope.close({ kind: "target-changed", detail: "changed-during-commit" });
      this.stateValue = "unloading";
      this.record("prepared-commit-stale", {
        target: prepared.target,
        revision: prepared.revision,
      });
      this.ensureLoop();
      throw new Error(`${this.label}: prepared target changed during commit`);
    }

    this.preparedValue = null;
    this.activeValue = {
      target: prepared.target,
      candidate: prepared.candidate,
      scope: prepared.scope,
    };
    this.committedValue = prepared.target;
    this.errorValue = undefined;
    this.stateValue = "active";
    this.record("prepared-commit", {
      target: prepared.target,
      revision: prepared.revision,
    });
    return this.snapshot();
  }

  async settle(options: { deadlineMs?: number } = {}): Promise<RuntimeTargetControllerSnapshot<T>> {
    const stopAt = performance.now() + (options.deadlineMs ?? 2_000);
    while (this.loop !== undefined) {
      const remaining = Math.max(0, stopAt - performance.now());
      if ((await outcomeBefore(this.loop, remaining)).kind === "timeout") break;
      await Promise.resolve();
    }
    return this.snapshot();
  }

  snapshot(): RuntimeTargetControllerSnapshot<T> {
    return {
      label: this.label,
      state: this.stateValue,
      desired: this.desiredValue,
      committed: this.committedValue,
      desiredRevision: this.desiredRevisionValue,
      ...(this.errorValue === undefined ? {} : { error: this.errorValue }),
      forcedCount: this.forcedCountValue,
      blocked:
        this.blockedValue === undefined
          ? null
          : {
              phase: this.blockedValue.phase,
              target: this.blockedValue.target,
              report: this.blockedValue.report,
            },
      activeScope:
        this.activeValue?.scope.snapshot() ?? this.preparedValue?.scope.snapshot() ?? null,
      history: [...this.events],
      omittedHistory: this.omittedHistoryValue,
    };
  }

  /** Serialization-safe, globally bounded projection for host diagnostics. It never exposes a
   * candidate, disposer, scope object, worker, port, promise, or termination adapter. */
  diagnostic(): RuntimeTargetControllerDiagnostic {
    const blocked = this.blockedValue;
    const scope =
      blocked?.scope ??
      this.loadingValue?.scope ??
      this.preparedValue?.scope ??
      this.activeValue?.scope ??
      null;
    return {
      label: this.label,
      state: this.stateValue,
      desired: this.desiredValue === null ? null : copyTarget(this.desiredValue),
      committed: this.committedValue === null ? null : copyTarget(this.committedValue),
      desiredRevision: this.desiredRevisionValue,
      ...(this.errorValue === undefined
        ? {}
        : { error: boundedText(this.errorValue, MAX_CONTROLLER_TEXT_LENGTH, "Error") }),
      blocked:
        blocked === undefined ? null : { phase: blocked.phase, target: copyTarget(blocked.target) },
      scope: scope?.diagnostic() ?? null,
      lastClose: this.lastCloseValue === null ? null : copyCloseReport(this.lastCloseValue),
      force: {
        confirmedCount: this.forcedCountValue,
        last:
          this.lastForceValue === null
            ? null
            : Object.freeze({
                ...this.lastForceValue,
                target: copyTarget(this.lastForceValue.target),
                ...(this.lastForceValue.outcome === undefined
                  ? {}
                  : { outcome: copyTerminationReport(this.lastForceValue.outcome) }),
              }),
      },
      history: [...this.events],
      omittedHistory: this.omittedHistoryValue,
    };
  }

  private record(event: RuntimeLifecycleEventKind, data: RuntimeLifecycleEventData<T> = {}): void {
    const next = Object.freeze({
      sequence: this.nextEventSequence,
      event,
      state: this.stateValue,
      ...(data.revision === undefined ? {} : { revision: data.revision }),
      ...(data.phase === undefined
        ? {}
        : { phase: boundedText(data.phase, MAX_CONTROLLER_PHASE_LENGTH, "unknown") }),
      ...(!Object.hasOwn(data, "target")
        ? {}
        : { target: data.target === null ? null : lifecycleTarget(data.target as T) }),
      ...(data.reason === undefined ? {} : { reason: copyReason(data.reason)! }),
      ...(data.error === undefined
        ? {}
        : { error: boundedText(data.error, MAX_CONTROLLER_TEXT_LENGTH, "Error") }),
      ...(data.report === undefined ? {} : { close: closeSummary(data.report) }),
      ...(data.outcome === undefined ? {} : { force: copyTerminationReport(data.outcome) }),
    }) satisfies RuntimeTargetLifecycleEvent;
    this.nextEventSequence += 1;
    this.events.push(next);
    if (this.events.length > this.historyLimit) {
      const removed = this.events.length - this.historyLimit;
      this.events.splice(0, removed);
      this.omittedHistoryValue += removed;
    }
    try {
      const observed = this.options.observeLifecycle?.(next) as unknown;
      if (isThenable(observed)) void Promise.resolve(observed).catch(() => undefined);
    } catch {
      // Observability is never lifecycle authority. A broken log/metric sink cannot interrupt the
      // state machine and is deliberately not recorded here, which would recurse into the sink.
    }
  }

  private stable(): boolean {
    if (this.blockedValue !== undefined) return true;
    if (
      this.preparedValue !== null &&
      this.preparedValue.scope.state === "open" &&
      this.desiredCommitMode === "manual" &&
      samePluginRuntimeObservation(this.preparedValue.target, this.desiredValue)
    ) {
      return true;
    }
    if (this.activeValue !== null && this.activeValue.scope.state === "open") {
      return samePluginRuntimeObservation(this.activeValue.target, this.desiredValue);
    }
    if (this.desiredValue === null) return this.stateValue === "inactive";
    return this.failedRevision === this.desiredRevisionValue && this.stateValue === "failed";
  }

  private ensureLoop(): void {
    if (this.loop !== undefined || this.blockedValue !== undefined) return;
    const running = this.reconcile();
    this.loop = running;
    void running.then(
      () => {
        if (this.loop === running) this.loop = undefined;
        if (!this.stable()) this.ensureLoop();
      },
      (error) => {
        if (this.loop === running) this.loop = undefined;
        this.errorValue = errorMessage(error);
        this.failedRevision = this.desiredRevisionValue;
        this.stateValue = "failed";
        this.record("controller-error", { error: this.errorValue });
      },
    );
  }

  private async allowAfterClose(
    scope: ActivationScope,
    target: T,
    report: ActivationCloseReport,
    phase: string,
    reason: ActivationCloseReason,
  ): Promise<boolean> {
    this.lastCloseValue = copyCloseReport(report);
    if (report.quiescent) return true;

    const termination = this.options.termination;
    if (termination?.kind !== "same-realm" && termination?.force !== undefined) {
      let outcome: BoundaryTerminationReport | undefined;
      let forceFailed = false;
      try {
        outcome = await termination.force(reason);
      } catch (error) {
        forceFailed = true;
        const message = errorMessage(error);
        this.lastForceValue = Object.freeze({
          state: "error",
          phase: boundedText(phase, MAX_CONTROLLER_PHASE_LENGTH, "unknown"),
          target: copyTarget(target),
          error: message,
        });
        this.record("force-error", { phase, target, error: message });
      }
      if (outcome?.terminated === true) {
        const copied = copyTerminationReport(outcome);
        this.forcedCountValue += 1;
        this.lastForceValue = Object.freeze({
          state: "confirmed",
          phase: boundedText(phase, MAX_CONTROLLER_PHASE_LENGTH, "unknown"),
          target: copyTarget(target),
          outcome: copied,
        });
        this.record("force-confirmed", { phase, target, outcome: copied });
        return true;
      }
      if (outcome !== undefined) {
        const copied = copyTerminationReport(outcome);
        this.lastForceValue = Object.freeze({
          state: "unconfirmed",
          phase: boundedText(phase, MAX_CONTROLLER_PHASE_LENGTH, "unknown"),
          target: copyTarget(target),
          outcome: copied,
        });
        this.record("force-unconfirmed", { phase, target, outcome: copied });
      } else if (!forceFailed) {
        this.lastForceValue = Object.freeze({
          state: "unconfirmed",
          phase: boundedText(phase, MAX_CONTROLLER_PHASE_LENGTH, "unknown"),
          target: copyTarget(target),
        });
        this.record("force-unconfirmed", { phase, target });
      }
    }

    this.stateValue = "non-quiescent";
    const token = {};
    this.blockedValue = { token, phase, target, report, scope };
    this.record("non-quiescent", { phase, target, report });
    void scope.whenQuiescent().then((lateReport) => {
      if (this.blockedValue?.token !== token) return;
      this.lastCloseValue = copyCloseReport(lateReport);
      if (this.activeValue?.scope === scope) this.activeValue = null;
      if (this.loadingValue?.scope === scope) this.loadingValue = null;
      if (this.preparedValue?.scope === scope) this.preparedValue = null;
      this.blockedValue = undefined;
      this.stateValue = "inactive";
      this.record("late-quiescence", { phase, target, report: lateReport });
      this.ensureLoop();
    });
    return false;
  }

  private async unloadActive(): Promise<boolean> {
    const active = this.activeValue;
    if (active === null) return true;
    this.stateValue = "unloading";
    this.committedValue = null;
    active.scope.close(this.desiredReason);
    const report = await active.scope.observe(this.disposalDeadlineMs);
    const closeReason = report.reason ?? this.desiredReason;
    const mayContinue = await this.allowAfterClose(
      active.scope,
      active.target,
      report,
      "unload",
      closeReason,
    );
    if (!mayContinue) return false;
    if (this.activeValue === active) this.activeValue = null;
    this.stateValue = "inactive";
    this.record("unloaded", { target: active.target, report });
    return true;
  }

  private async unloadPrepared(): Promise<boolean> {
    const prepared = this.preparedValue;
    if (prepared === null) return true;
    this.stateValue = "unloading";
    prepared.scope.close(this.desiredReason);
    const report = await prepared.scope.observe(this.disposalDeadlineMs);
    const closeReason = report.reason ?? this.desiredReason;
    const mayContinue = await this.allowAfterClose(
      prepared.scope,
      prepared.target,
      report,
      "unload-prepared",
      closeReason,
    );
    if (!mayContinue) return false;
    if (this.preparedValue === prepared) this.preparedValue = null;
    this.stateValue = "inactive";
    this.record("prepared-unloaded", { target: prepared.target, report });
    return true;
  }

  private async refreshActive(): Promise<void> {
    const active = this.activeValue;
    const target = this.desiredValue;
    if (active === null || target === null) return;
    const revision = this.desiredRevisionValue;
    this.stateValue = "refreshing";
    this.record("refresh-start", { target, revision });
    try {
      await this.options.refresh?.(active.candidate, active.target, target, active.scope.signal);
    } catch (error) {
      this.errorValue = errorMessage(error);
      this.record("refresh-failed", { target, revision, error: this.errorValue });
      this.committedValue = null;
      active.scope.close({ kind: "grant-revoked", detail: this.errorValue });
      return;
    }

    if (
      this.activeValue !== active ||
      active.scope.state !== "open" ||
      revision !== this.desiredRevisionValue ||
      !samePluginRuntimeTarget(active.target, this.desiredValue)
    ) {
      this.record("refresh-stale", { target, revision });
      return;
    }
    active.target = target;
    this.committedValue = target;
    this.errorValue = undefined;
    this.stateValue = "active";
    this.record("refresh-commit", { target, revision });
  }

  private async closeAttempt(
    loading: Loading<T>,
    reason: ActivationCloseReason,
    phase: string,
  ): Promise<boolean> {
    loading.scope.close(reason);
    const report = await loading.scope.observe(this.disposalDeadlineMs);
    const mayContinue = await this.allowAfterClose(
      loading.scope,
      loading.target,
      report,
      phase,
      reason,
    );
    if (this.loadingValue === loading) this.loadingValue = null;
    return mayContinue;
  }

  private async activate(target: T, revision: number): Promise<boolean> {
    const scope = this.scopeFactory(`${this.label}/${targetLabel(target)}`);
    const loading: Loading<T> = { target, revision, scope };
    this.loadingValue = loading;
    this.stateValue = "loading";
    this.record("load-start", { target, revision });

    const setup = scope.effect("activate", (effect, signal) =>
      this.options.activate(target, effect, signal),
    );
    void setup.catch(() => undefined);
    const outcome = await outcomeBefore(setup, this.activationDeadlineMs);

    if (outcome.kind === "timeout") {
      this.errorValue = `activation deadline exceeded for ${targetLabel(target)}`;
      if (revision === this.desiredRevisionValue) this.failedRevision = revision;
      const mayContinue = await this.closeAttempt(
        loading,
        { kind: "activation-timeout", detail: target.pluginId },
        "activation-timeout",
      );
      if (mayContinue) {
        this.stateValue = revision === this.desiredRevisionValue ? "failed" : "inactive";
        this.record("load-timeout", { target, revision });
      }
      return mayContinue;
    }

    if (outcome.kind === "error") {
      this.errorValue = errorMessage(outcome.error);
      if (revision === this.desiredRevisionValue) this.failedRevision = revision;
      const mayContinue = await this.closeAttempt(
        loading,
        { kind: "activation-failed", detail: target.pluginId },
        "activation-failed",
      );
      if (mayContinue) {
        this.stateValue = revision === this.desiredRevisionValue ? "failed" : "inactive";
        this.record("load-failed", { target, revision, error: this.errorValue });
      }
      return mayContinue;
    }

    const candidate = outcome.value;
    if (
      revision !== this.desiredRevisionValue ||
      !samePluginRuntimeObservation(target, this.desiredValue) ||
      scope.state !== "open"
    ) {
      const mayContinue = await this.closeAttempt(
        loading,
        { kind: "target-changed", detail: "stale-before-commit" },
        "stale-before-commit",
      );
      if (mayContinue) {
        this.stateValue = "inactive";
        this.record("load-stale", { target, revision });
      }
      return mayContinue;
    }

    if (this.desiredCommitMode === "manual") {
      this.loadingValue = null;
      this.preparedValue = { target, revision, scope, candidate };
      this.errorValue = undefined;
      this.stateValue = "prepared";
      this.record("load-prepared", { target, revision });
      return true;
    }

    try {
      const commitResult = candidate.commit() as unknown;
      if (isThenable(commitResult)) {
        void Promise.resolve(commitResult).catch(() => undefined);
        throw new TypeError("target candidate commit must be synchronous");
      }
    } catch (error) {
      this.errorValue = errorMessage(error);
      if (revision === this.desiredRevisionValue) this.failedRevision = revision;
      const mayContinue = await this.closeAttempt(
        loading,
        { kind: "activation-failed", detail: "candidate commit failed" },
        "commit-failed",
      );
      if (mayContinue) this.stateValue = "failed";
      return mayContinue;
    }

    // A synchronous publication listener may request a newer target. setDesired closes this
    // loading scope at that edge; this post-commit check prevents stale resurrection.
    if (
      revision !== this.desiredRevisionValue ||
      !samePluginRuntimeObservation(target, this.desiredValue) ||
      scope.state !== "open"
    ) {
      const mayContinue = await this.closeAttempt(
        loading,
        { kind: "target-changed", detail: "changed-during-commit" },
        "changed-during-commit",
      );
      if (mayContinue) this.stateValue = "inactive";
      return mayContinue;
    }

    this.loadingValue = null;
    this.activeValue = { target, candidate, scope };
    this.committedValue = target;
    this.errorValue = undefined;
    this.stateValue = "active";
    this.record("load-commit", { target, revision });
    return true;
  }

  private async reconcile(): Promise<void> {
    while (this.blockedValue === undefined) {
      const prepared = this.preparedValue;
      if (prepared !== null) {
        if (
          prepared.scope.state !== "open" ||
          this.desiredCommitMode !== "manual" ||
          !samePluginRuntimeObservation(prepared.target, this.desiredValue)
        ) {
          if (!(await this.unloadPrepared())) return;
          continue;
        }
        this.committedValue = null;
        this.stateValue = "prepared";
        return;
      }

      const active = this.activeValue;
      if (active !== null) {
        if (active.scope.state !== "open") {
          if (!(await this.unloadActive())) return;
          continue;
        }
        if (!samePluginRuntimeTarget(active.target, this.desiredValue)) {
          if (!(await this.unloadActive())) return;
          continue;
        }
        if (!samePluginRuntimeObservation(active.target, this.desiredValue)) {
          await this.refreshActive();
          continue;
        }
        this.committedValue = this.desiredValue;
        this.stateValue = "active";
        return;
      }

      if (this.desiredValue === null) {
        this.stateValue = "inactive";
        return;
      }
      if (this.failedRevision === this.desiredRevisionValue) {
        this.stateValue = "failed";
        return;
      }

      const target = this.desiredValue;
      const revision = this.desiredRevisionValue;
      if (!(await this.activate(target, revision))) return;
      if (this.failedRevision === this.desiredRevisionValue) return;
    }
  }
}
