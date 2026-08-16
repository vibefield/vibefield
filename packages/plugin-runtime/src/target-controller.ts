import {
  type ActivationCloseReason,
  type ActivationCloseReport,
  ActivationEffectSetupError,
  ActivationScope,
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
  | "active"
  | "refreshing"
  | "unloading"
  | "failed"
  | "non-quiescent";

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
  readonly history: readonly Readonly<Record<string, unknown>>[];
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

interface Blocked<T extends PluginRuntimeTarget> extends RuntimeTargetControllerBlocked<T> {
  readonly token: object;
}

type TimedOutcome<T> =
  | { readonly kind: "value"; readonly value: T }
  | { readonly kind: "error"; readonly error: unknown }
  | { readonly kind: "timeout" };

function normalizedDeadline(value: number | undefined): number {
  if (value === undefined || !Number.isFinite(value)) return Number.POSITIVE_INFINITY;
  return Math.max(0, value);
}

function positiveInteger(value: number | undefined, fallback: number): number {
  if (value === undefined || !Number.isFinite(value)) return fallback;
  return Math.max(1, Math.floor(value));
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
 * happens only at one synchronous, stale-checked commit edge.
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
  private desiredRevisionValue = 0;
  private committedValue: T | null = null;
  private activeValue: Active<T, C> | null = null;
  private loadingValue: Loading<T> | null = null;
  private failedRevision: number | undefined;
  private loop: Promise<void> | undefined;
  private blockedValue: Blocked<T> | undefined;
  private errorValue: string | undefined;
  private stateValue: RuntimeTargetControllerState = "inactive";
  private forcedCountValue = 0;
  private readonly events: Array<Record<string, unknown>> = [];

  constructor(label: string, options: RuntimeTargetControllerOptions<T, C>) {
    this.label = label;
    this.options = options;
    this.activationDeadlineMs = normalizedDeadline(options.activationDeadlineMs);
    this.disposalDeadlineMs = normalizedDeadline(options.disposalDeadlineMs);
    this.historyLimit = positiveInteger(options.historyLimit, 256);
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
    if (!options.retry && samePluginRuntimeObservation(this.desiredValue, target)) {
      return this.desiredRevisionValue;
    }

    this.desiredValue = target;
    this.desiredReason = options.reason ?? { kind: "target-changed" };
    this.desiredRevisionValue += 1;
    this.failedRevision = undefined;
    this.errorValue = undefined;
    this.record("desired", { revision: this.desiredRevisionValue, target });

    if (this.loadingValue !== null) this.loadingValue.scope.close(this.desiredReason);
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
      activeScope: this.activeValue?.scope.snapshot() ?? null,
      history: this.events.map((event) => ({ ...event })),
    };
  }

  private record(event: string, data: Record<string, unknown> = {}): void {
    this.events.push({ event, state: this.stateValue, ...data });
    if (this.events.length > this.historyLimit) {
      this.events.splice(0, this.events.length - this.historyLimit);
    }
  }

  private stable(): boolean {
    if (this.blockedValue !== undefined) return true;
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
    if (report.quiescent) return true;

    const termination = this.options.termination;
    if (termination?.kind !== "same-realm" && termination?.force !== undefined) {
      let outcome: BoundaryTerminationReport | undefined;
      try {
        outcome = await termination.force(reason);
      } catch (error) {
        this.record("force-error", { phase, target, error: errorMessage(error) });
      }
      if (outcome?.terminated === true) {
        this.forcedCountValue += 1;
        this.record("force-confirmed", { phase, target, outcome });
        return true;
      }
      this.record("force-unconfirmed", { phase, target, outcome });
    }

    this.stateValue = "non-quiescent";
    const token = {};
    this.blockedValue = { token, phase, target, report };
    this.record("non-quiescent", { phase, target, report });
    void scope.whenQuiescent().then(() => {
      if (this.blockedValue?.token !== token) return;
      if (this.activeValue?.scope === scope) this.activeValue = null;
      if (this.loadingValue?.scope === scope) this.loadingValue = null;
      this.blockedValue = undefined;
      this.stateValue = "inactive";
      this.record("late-quiescence", { phase, target });
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

  private async refreshActive(): Promise<void> {
    const active = this.activeValue;
    const target = this.desiredValue;
    if (active === null || target === null) return;
    const revision = this.desiredRevisionValue;
    this.stateValue = "refreshing";
    this.record("refresh-start", { previous: active.target, target, revision });
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
