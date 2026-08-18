import type { CanvasEngine, GuestLedgerRecord } from "@vibecook/ice";
import {
  ephemeralBehaviorPresenceCharge,
  PLUGIN_LIMITS,
  PLUGIN_RUNTIME_DIAGNOSTIC_LIMITS,
  type PluginRuntimeBehaviorGenerationDiagnostic,
  PluginRuntimeBehaviorGenerationDiagnostic as PluginRuntimeBehaviorGenerationDiagnosticSchema,
} from "@vibefield/contracts";
import type { BehaviorBindingCatalog, BehaviorCatalogBinding } from "./behavior-binding-catalog";

export const BEHAVIOR_LEDGER_MAX_ENTRIES = 4_096;

/** Window-owned chronic breaker memory. Engine/document generation is deliberately absent. */
export class BehaviorBreakerLedger {
  private readonly rows = new Map<string, GuestLedgerRecord>();

  constructor(readonly limit = BEHAVIOR_LEDGER_MAX_ENTRIES) {
    if (!Number.isSafeInteger(limit) || limit < 1) {
      throw new TypeError("behavior breaker ledger limit must be a positive integer");
    }
  }

  get size(): number {
    return this.rows.size;
  }

  has(key: string): boolean {
    return this.rows.has(key);
  }

  get(key: string): GuestLedgerRecord | undefined {
    return this.rows.get(key);
  }

  set(key: string, record: GuestLedgerRecord): void {
    // Refresh insertion order so currently active chronic rows are the last eviction candidates.
    this.rows.delete(key);
    this.rows.set(key, Object.freeze({ ...record }));
    while (this.rows.size > this.limit) {
      const oldest = this.rows.keys().next().value;
      if (oldest === undefined) break;
      this.rows.delete(oldest);
    }
  }

  snapshot(): ReadonlyMap<string, GuestLedgerRecord> {
    return new Map(this.rows);
  }
}

export interface BehaviorGenerationTarget {
  readonly windowId: string;
  readonly documentId: string;
  /** Exact process-local engine/session nonce, never merely the durable document id. */
  readonly runtimeGeneration: string;
}

export type BehaviorBlockedReason =
  | "canvas-write-denied"
  | "presence-unavailable"
  | "presence-budget-exceeded";

export interface BehaviorGenerationError {
  readonly operation: "register" | "unregister" | "rollback";
  readonly declarationId: string;
  readonly message: string;
}

interface CapturedBehaviorGenerationError {
  readonly error: BehaviorGenerationError;
  readonly binding: BehaviorCatalogBinding;
}

export interface BehaviorGenerationReport {
  readonly state: "active" | "failed" | "closed";
  readonly installed: readonly string[];
  readonly errors: readonly BehaviorGenerationError[];
  readonly blocked: readonly {
    readonly declarationId: string;
    readonly reason: BehaviorBlockedReason;
  }[];
}

export interface BehaviorGenerationEvent {
  readonly type: "register" | "unregister" | "rollback" | "ledger" | "error" | "close";
  readonly target: BehaviorGenerationTarget;
  readonly pluginId?: string;
  readonly declarationId?: string;
  readonly orderKey?: string;
  readonly reason?: string;
  readonly record?: GuestLedgerRecord;
  readonly error?: BehaviorGenerationError;
}

interface InstalledBehavior {
  readonly binding: BehaviorCatalogBinding;
  readonly orderKey: string;
  readonly breakerKey: string;
  readonly unregister: () => void;
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function compareBinding(left: BehaviorCatalogBinding, right: BehaviorCatalogBinding): number {
  const plugin = compareText(left.pluginId, right.pluginId);
  return plugin === 0 ? left.declarationIndex - right.declarationIndex : plugin;
}

function reverseInstalled(left: InstalledBehavior, right: InstalledBehavior): number {
  return compareBinding(right.binding, left.binding);
}

function clipDiagnosticText(value: string): string {
  return value.slice(0, PLUGIN_RUNTIME_DIAGNOSTIC_LIMITS.TEXT_CHARS);
}

function projectRendererTarget(binding: BehaviorCatalogBinding) {
  const target = binding.rendererTarget;
  return Object.freeze({
    face: "renderer" as const,
    pluginId: target.pluginId,
    artifact: Object.freeze({
      installRevision: target.artifact.installRevision,
      manifestHash: target.artifact.manifestHash,
      ...(target.artifact.approvedModuleGeneration === undefined
        ? {}
        : { approvedModuleGeneration: target.artifact.approvedModuleGeneration }),
    }),
    authorityFingerprint: target.authorityFingerprint,
    observedGrantGeneration: target.observedGrantGeneration,
    ...(target.runtimeGeneration === undefined
      ? {}
      : { runtimeGeneration: target.runtimeGeneration }),
    instanceKey: Object.freeze({ windowId: target.instanceKey.windowId }),
  });
}

function rendererTargetKey(binding: BehaviorCatalogBinding): string {
  return JSON.stringify(projectRendererTarget(binding));
}

interface BehaviorDiagnosticCandidate {
  readonly binding: BehaviorCatalogBinding;
  desired: boolean;
  installed: boolean;
  blockedReason?: BehaviorBlockedReason;
  error?: BehaviorGenerationError;
  readonly breaker: GuestLedgerRecord | null;
}

function diagnosticPriority(candidate: BehaviorDiagnosticCandidate): number {
  if (candidate.error !== undefined) return 0;
  if (candidate.blockedReason !== undefined) return 1;
  if (candidate.breaker?.suspended === true) return 2;
  if (candidate.installed) return 3;
  return 4;
}

function assertNonEmpty(value: string, label: string): void {
  if (value.length === 0) throw new TypeError(`${label} must be a non-empty string`);
}

function normalizeTarget(target: BehaviorGenerationTarget): BehaviorGenerationTarget {
  assertNonEmpty(target.windowId, "target.windowId");
  assertNonEmpty(target.documentId, "target.documentId");
  assertNonEmpty(target.runtimeGeneration, "target.runtimeGeneration");
  for (const [label, value] of [
    ["target.windowId", target.windowId],
    ["target.documentId", target.documentId],
    ["target.runtimeGeneration", target.runtimeGeneration],
  ] as const) {
    if (value.length > PLUGIN_RUNTIME_DIAGNOSTIC_LIMITS.TARGET_PART_CHARS) {
      throw new TypeError(`${label} exceeds the runtime diagnostic identity bound`);
    }
  }
  return Object.freeze({ ...target });
}

function expectedOrderKey(binding: BehaviorCatalogBinding): string {
  return `${binding.pluginId}\0${binding.declarationIndex.toString().padStart(6, "0")}`;
}

function normalizeSnapshot(
  snapshot: readonly BehaviorCatalogBinding[],
  windowId: string,
): readonly BehaviorCatalogBinding[] {
  if (!Array.isArray(snapshot)) throw new TypeError("behavior catalog snapshot must be an array");
  const ids = new Set<string>();
  const ranks = new Set<string>();
  const normalized = snapshot.map((binding) => {
    assertNonEmpty(binding.pluginId, "binding.pluginId");
    assertNonEmpty(binding.id, "binding.id");
    if (!binding.id.startsWith(`${binding.pluginId}:`)) {
      throw new Error(`behavior ${binding.id} is outside ${binding.pluginId}`);
    }
    if (!Number.isSafeInteger(binding.declarationIndex) || binding.declarationIndex < 0) {
      throw new TypeError(`behavior ${binding.id} has an invalid declaration index`);
    }
    if (binding.orderKey !== expectedOrderKey(binding)) {
      throw new Error(`behavior ${binding.id} has a non-canonical order key`);
    }
    if (binding.handle?.name !== binding.id) {
      throw new Error(`behavior handle does not match ${binding.id}`);
    }
    if (typeof binding.authorized !== "boolean") {
      throw new TypeError(`behavior ${binding.id} lacks exact renderer authorization`);
    }
    if (!(["durable", "runtime", "ephemeral"] as const).includes(binding.definition.store)) {
      throw new TypeError(`behavior ${binding.id} has an invalid store descriptor`);
    }
    if (binding.definition.store === "ephemeral") {
      try {
        ephemeralBehaviorPresenceCharge(binding.definition);
      } catch {
        throw new TypeError(`ephemeral behavior ${binding.id} lacks a valid maxFacetBytes claim`);
      }
    } else if (binding.definition.maxFacetBytes !== undefined) {
      throw new TypeError(`behavior ${binding.id} has an ephemeral-only maxFacetBytes claim`);
    }
    if (binding.candidateToken === null || typeof binding.candidateToken !== "object") {
      throw new TypeError(`behavior ${binding.id} lacks candidate identity`);
    }
    if (
      binding.rendererTarget.face !== "renderer" ||
      binding.rendererTarget.pluginId !== binding.pluginId ||
      binding.rendererTarget.instanceKey.windowId !== windowId
    ) {
      throw new Error(`behavior ${binding.id} has the wrong renderer target`);
    }
    if (ids.has(binding.id)) throw new Error(`duplicate behavior binding ${binding.id}`);
    const rank = `${binding.pluginId}\0${binding.declarationIndex}`;
    if (ranks.has(rank)) throw new Error(`duplicate behavior declaration rank ${rank}`);
    ids.add(binding.id);
    ranks.add(rank);
    return binding;
  });
  normalized.sort(compareBinding);
  return Object.freeze(normalized);
}

function sameExecution(current: InstalledBehavior, desired: BehaviorCatalogBinding): boolean {
  return (
    current.binding.candidateToken === desired.candidateToken &&
    current.binding.handle === desired.handle &&
    current.orderKey === desired.orderKey
  );
}

function environmentalBlockedReason(
  binding: BehaviorCatalogBinding,
  presenceAvailable: boolean,
): BehaviorBlockedReason | undefined {
  if (!binding.authorized) return "canvas-write-denied";
  if (binding.definition.store === "ephemeral" && !presenceAvailable) {
    return "presence-unavailable";
  }
  return undefined;
}

/** Allocate the window-owned presence budget in canonical plugin order. A
 * plugin's eligible ephemeral declarations are admitted or refused together:
 * partial presence APIs are harder to reason about than deterministic scarcity. */
function eligibility(
  desired: readonly BehaviorCatalogBinding[],
  presenceAvailable: boolean,
): {
  readonly eligible: ReadonlyMap<string, BehaviorCatalogBinding>;
  readonly blocked: readonly {
    readonly declarationId: string;
    readonly reason: BehaviorBlockedReason;
  }[];
} {
  const reasonById = new Map<string, BehaviorBlockedReason>();
  const ephemeralByPlugin = new Map<string, BehaviorCatalogBinding[]>();
  for (const binding of desired) {
    const reason = environmentalBlockedReason(binding, presenceAvailable);
    if (reason !== undefined) {
      reasonById.set(binding.id, reason);
      continue;
    }
    if (binding.definition.store !== "ephemeral") continue;
    const rows = ephemeralByPlugin.get(binding.pluginId) ?? [];
    rows.push(binding);
    ephemeralByPlugin.set(binding.pluginId, rows);
  }

  let remaining = PLUGIN_LIMITS.BEHAVIOR_EPHEMERAL_WINDOW_BYTES;
  for (const rows of ephemeralByPlugin.values()) {
    const charge = rows.reduce(
      (total, binding) => total + ephemeralBehaviorPresenceCharge(binding.definition),
      0,
    );
    if (charge <= remaining) {
      remaining -= charge;
      continue;
    }
    for (const binding of rows) reasonById.set(binding.id, "presence-budget-exceeded");
  }

  const eligible = new Map<string, BehaviorCatalogBinding>();
  const blocked: Array<{ declarationId: string; reason: BehaviorBlockedReason }> = [];
  for (const binding of desired) {
    const reason = reasonById.get(binding.id);
    if (reason === undefined) eligible.set(binding.id, binding);
    else blocked.push({ declarationId: binding.id, reason });
  }
  return { eligible, blocked };
}

function report(
  state: BehaviorGenerationReport["state"],
  installed: ReadonlyMap<string, InstalledBehavior>,
  errors: readonly BehaviorGenerationError[] = [],
  blocked: BehaviorGenerationReport["blocked"] = [],
): BehaviorGenerationReport {
  return Object.freeze({
    state,
    installed: Object.freeze(
      [...installed.values()]
        .sort((left, right) => compareBinding(left.binding, right.binding))
        .map((entry) => entry.binding.id),
    ),
    errors: Object.freeze([...errors]),
    blocked: Object.freeze(blocked.map((entry) => Object.freeze({ ...entry }))),
  });
}

/** Synchronous projection of one validated window catalog into one exact document engine. */
export class BehaviorGenerationHost {
  readonly target: BehaviorGenerationTarget;
  lastReport: BehaviorGenerationReport;

  private readonly installed = new Map<string, InstalledBehavior>();
  private desired: readonly BehaviorCatalogBinding[] = [];
  private closed = false;
  private readonly stopLedger: () => void;

  constructor(
    private readonly options: {
      readonly engine: CanvasEngine;
      readonly target: BehaviorGenerationTarget;
      readonly ledger?: BehaviorBreakerLedger;
      readonly onEvent?: (event: BehaviorGenerationEvent) => void;
      /** Complete latest-only per-plugin fold for the current document generation. */
      readonly onDiagnosticsChanged?: (
        diagnostics: readonly PluginRuntimeBehaviorGenerationDiagnostic[],
      ) => void;
      readonly presenceAvailable?: () => boolean;
    },
  ) {
    if (
      options.engine?.behaviors?.register === undefined ||
      options.engine?.engine?.guests?.onLedgerChange === undefined
    ) {
      throw new TypeError("BehaviorGenerationHost needs a CanvasEngine behavior facade");
    }
    this.target = normalizeTarget(options.target);
    this.lastReport = report("active", this.installed);
    this.stopLedger = options.engine.engine.guests.onLedgerChange((guestId, record) => {
      if (this.closed || !guestId.startsWith("behavior:")) return;
      const declarationId = guestId.slice("behavior:".length);
      const current = this.installed.get(declarationId);
      if (current === undefined) return;
      this.ledger.set(current.breakerKey, record);
      this.emit("ledger", current.binding, { record: Object.freeze({ ...record }) });
      this.publishDiagnostics();
    });
  }

  private get engine(): CanvasEngine {
    return this.options.engine;
  }

  private get ledger(): BehaviorBreakerLedger {
    if (this.options.ledger !== undefined) return this.options.ledger;
    if (this.fallbackLedger === undefined) this.fallbackLedger = new BehaviorBreakerLedger();
    return this.fallbackLedger;
  }

  private fallbackLedger: BehaviorBreakerLedger | undefined;
  private lastErrors: readonly CapturedBehaviorGenerationError[] = [];
  private closeReason: string | undefined;

  reconcile(snapshot: readonly BehaviorCatalogBinding[]): BehaviorGenerationReport {
    if (this.closed) throw new Error("behavior generation host is closed");
    // Validate before revising desired state: a bad replacement cannot disturb committed truth.
    const desired = normalizeSnapshot(snapshot, this.target.windowId);
    this.desired = desired;
    return this.applyDesired();
  }

  /** Re-evaluate generation-local coeffects (currently facade presence). */
  refresh(): BehaviorGenerationReport {
    if (this.closed) throw new Error("behavior generation host is closed");
    return this.applyDesired();
  }

  close(reason = "generation-close"): BehaviorGenerationReport {
    if (this.closed) return this.lastReport;
    this.closed = true;
    this.closeReason = clipDiagnosticText(reason);
    const errors: CapturedBehaviorGenerationError[] = [];
    for (const current of [...this.installed.values()].sort(reverseInstalled)) {
      try {
        current.unregister();
        this.installed.delete(current.binding.id);
        this.emit("unregister", current.binding, { reason });
      } catch (error) {
        errors.push(this.captureError("unregister", current.binding, error));
      }
    }
    this.stopLedger();
    this.emit("close", undefined, { reason });
    return this.commitReport(errors.length === 0 ? "closed" : "failed", errors);
  }

  breakerKey(binding: BehaviorCatalogBinding): string {
    return `${this.target.windowId}\0${binding.pluginId}\0${binding.id}`;
  }

  /** Bounded plain-data fold. Declaration detail is prioritized error → blocked → suspended →
   * installed → inactive, so an old-target teardown failure survives a simultaneous new desired
   * set. At most two renderer targets describe that old→new transition without repeating full
   * authority identity on every declaration row. */
  diagnostics(): readonly PluginRuntimeBehaviorGenerationDiagnostic[] {
    interface Group {
      readonly candidates: Map<string, BehaviorDiagnosticCandidate>;
      desiredCount: number;
      installedCount: number;
      blockedCount: number;
      failedCount: number;
      suspendedCount: number;
    }
    const groups = new Map<string, Group>();
    const groupFor = (pluginId: string): Group => {
      let group = groups.get(pluginId);
      if (group === undefined) {
        group = {
          candidates: new Map(),
          desiredCount: 0,
          installedCount: 0,
          blockedCount: 0,
          failedCount: 0,
          suspendedCount: 0,
        };
        groups.set(pluginId, group);
      }
      return group;
    };
    const add = (
      binding: BehaviorCatalogBinding,
      update: Partial<Pick<BehaviorDiagnosticCandidate, "desired" | "installed">> & {
        readonly blockedReason?: BehaviorBlockedReason;
        readonly error?: BehaviorGenerationError;
      },
    ): void => {
      const group = groupFor(binding.pluginId);
      const key = `${binding.id}\0${rendererTargetKey(binding)}`;
      const current = group.candidates.get(key);
      if (current === undefined) {
        group.candidates.set(key, {
          binding,
          desired: update.desired ?? false,
          installed: update.installed ?? false,
          ...(update.blockedReason === undefined ? {} : { blockedReason: update.blockedReason }),
          ...(update.error === undefined ? {} : { error: update.error }),
          breaker: this.ledger.get(this.breakerKey(binding)) ?? null,
        });
        return;
      }
      if (update.desired === true) current.desired = true;
      if (update.installed === true) current.installed = true;
      if (update.blockedReason !== undefined) current.blockedReason = update.blockedReason;
      if (update.error !== undefined) current.error = update.error;
    };

    const blocked = new Map(
      this.lastReport.blocked.map((row) => [row.declarationId, row.reason] as const),
    );
    for (const binding of this.desired) {
      const group = groupFor(binding.pluginId);
      const blockedReason = blocked.get(binding.id);
      group.desiredCount += 1;
      if (blockedReason !== undefined) group.blockedCount += 1;
      add(binding, { desired: true, ...(blockedReason === undefined ? {} : { blockedReason }) });
    }
    for (const installed of this.installed.values()) {
      groupFor(installed.binding.pluginId).installedCount += 1;
      add(installed.binding, { installed: true });
    }
    for (const captured of this.lastErrors) {
      groupFor(captured.binding.pluginId).failedCount += 1;
      add(captured.binding, { error: captured.error });
    }
    for (const group of groups.values()) {
      group.suspendedCount = new Set(
        [...group.candidates.values()]
          .filter((candidate) => candidate.breaker?.suspended === true)
          .map((candidate) => candidate.binding.id),
      ).size;
    }

    const projected: PluginRuntimeBehaviorGenerationDiagnostic[] = [];
    for (const [pluginId, group] of [...groups].sort(([left], [right]) =>
      compareText(left, right),
    )) {
      const candidates = [...group.candidates.values()].sort((left, right) => {
        const priority = diagnosticPriority(left) - diagnosticPriority(right);
        if (priority !== 0) return priority;
        const declaration = compareText(left.binding.id, right.binding.id);
        return declaration === 0
          ? compareText(rendererTargetKey(left.binding), rendererTargetKey(right.binding))
          : declaration;
      });
      const selected: BehaviorDiagnosticCandidate[] = [];
      const selectedTargets = new Set<string>();
      for (const candidate of candidates) {
        if (selected.length >= PLUGIN_RUNTIME_DIAGNOSTIC_LIMITS.BEHAVIORS_PER_PLUGIN) break;
        const targetKey = rendererTargetKey(candidate.binding);
        if (!selectedTargets.has(targetKey)) {
          if (selectedTargets.size >= PLUGIN_RUNTIME_DIAGNOSTIC_LIMITS.BEHAVIOR_RENDERER_TARGETS) {
            continue;
          }
          selectedTargets.add(targetKey);
        }
        selected.push(candidate);
      }

      const projectSelected = (): PluginRuntimeBehaviorGenerationDiagnostic => {
        const rendererTargets: ReturnType<typeof projectRendererTarget>[] = [];
        const targetIndexes = new Map<string, number>();
        const declarations = selected.map((candidate) => {
          const targetKey = rendererTargetKey(candidate.binding);
          let targetIndex = targetIndexes.get(targetKey);
          if (targetIndex === undefined) {
            targetIndex = rendererTargets.length;
            targetIndexes.set(targetKey, targetIndex);
            rendererTargets.push(projectRendererTarget(candidate.binding));
          }
          const status =
            candidate.error !== undefined
              ? "failed"
              : candidate.installed
                ? "installed"
                : candidate.blockedReason !== undefined
                  ? "blocked"
                  : "inactive";
          return {
            declarationId: candidate.binding.id,
            rendererTarget: targetIndex,
            status,
            ...(candidate.blockedReason === undefined
              ? {}
              : { blockedReason: candidate.blockedReason }),
            ...(candidate.error === undefined
              ? {}
              : {
                  error: {
                    operation: candidate.error.operation,
                    message: candidate.error.message,
                  },
                }),
            breaker:
              candidate.breaker === null
                ? null
                : {
                    strikes: candidate.breaker.strikes,
                    suspended: candidate.breaker.suspended,
                  },
          };
        });
        return PluginRuntimeBehaviorGenerationDiagnosticSchema.parse({
          pluginId,
          state: group.failedCount > 0 ? "failed" : this.closed ? "closed" : ("active" as const),
          target: this.target,
          rendererTargets,
          desiredCount: group.desiredCount,
          installedCount: group.installedCount,
          blockedCount: group.blockedCount,
          failedCount: group.failedCount,
          suspendedCount: group.suspendedCount,
          declarations,
          omittedDeclarations: candidates.length - declarations.length,
          ...(this.closeReason === undefined ? {} : { closeReason: this.closeReason }),
        });
      };

      let diagnostic = projectSelected();
      while (
        new TextEncoder().encode(JSON.stringify(diagnostic)).byteLength >
        PLUGIN_RUNTIME_DIAGNOSTIC_LIMITS.BEHAVIOR_BYTES
      ) {
        const targetCounts = new Map<string, number>();
        for (const candidate of selected) {
          const key = rendererTargetKey(candidate.binding);
          targetCounts.set(key, (targetCounts.get(key) ?? 0) + 1);
        }
        let removeAt = -1;
        for (let index = selected.length - 1; index >= 0; index -= 1) {
          const candidate = selected[index];
          if (candidate === undefined) continue;
          if ((targetCounts.get(rendererTargetKey(candidate.binding)) ?? 0) > 1) {
            removeAt = index;
            break;
          }
        }
        if (removeAt < 0) {
          throw new Error(
            `${pluginId}: exact behavior target identity exceeded its byte invariant`,
          );
        }
        selected.splice(removeAt, 1);
        diagnostic = projectSelected();
      }
      projected.push(diagnostic);
    }
    return Object.freeze(projected);
  }

  private applyDesired(): BehaviorGenerationReport {
    const presenceAvailable = this.options.presenceAvailable?.() ?? false;
    const { eligible, blocked } = eligibility(this.desired, presenceAvailable);

    const errors: CapturedBehaviorGenerationError[] = [];
    const withdrawals = [...this.installed.values()]
      .filter((current) => {
        const next = eligible.get(current.binding.id);
        return next === undefined || !sameExecution(current, next);
      })
      .sort(reverseInstalled);
    for (const current of withdrawals) {
      try {
        current.unregister();
        this.installed.delete(current.binding.id);
        this.emit("unregister", current.binding);
      } catch (error) {
        errors.push(this.captureError("unregister", current.binding, error));
      }
    }
    if (errors.length > 0) {
      return this.commitReport("failed", errors, blocked);
    }

    const added: InstalledBehavior[] = [];
    for (const binding of this.desired) {
      if (!eligible.has(binding.id) || this.installed.has(binding.id)) continue;
      const breakerKey = this.breakerKey(binding);
      try {
        const priorLedger = this.ledger.get(breakerKey);
        const unregister = this.engine.behaviors.register(binding.handle, {
          orderKey: binding.orderKey,
          ...(priorLedger === undefined ? {} : { ledger: priorLedger }),
        });
        const current = {
          binding,
          orderKey: binding.orderKey,
          breakerKey,
          unregister,
        } satisfies InstalledBehavior;
        this.installed.set(binding.id, current);
        added.push(current);
        this.emit("register", binding, { orderKey: binding.orderKey });
      } catch (error) {
        errors.push(this.captureError("register", binding, error));
        break;
      }
    }

    if (errors.length > 0) {
      for (const current of added.reverse()) {
        try {
          current.unregister();
          this.installed.delete(current.binding.id);
          this.emit("rollback", current.binding);
        } catch (error) {
          errors.push(this.captureError("rollback", current.binding, error));
        }
      }
      return this.commitReport("failed", errors, blocked);
    }

    return this.commitReport("active", [], blocked);
  }

  private captureError(
    operation: BehaviorGenerationError["operation"],
    binding: BehaviorCatalogBinding,
    error: unknown,
  ): CapturedBehaviorGenerationError {
    const captured = Object.freeze({
      operation,
      declarationId: binding.id,
      message: clipDiagnosticText(error instanceof Error ? error.message : String(error)),
    });
    this.emit("error", binding, { error: captured });
    return Object.freeze({ error: captured, binding });
  }

  private commitReport(
    state: BehaviorGenerationReport["state"],
    errors: readonly CapturedBehaviorGenerationError[],
    blocked: BehaviorGenerationReport["blocked"] = [],
  ): BehaviorGenerationReport {
    this.lastErrors = Object.freeze([...errors]);
    this.lastReport = report(
      state,
      this.installed,
      errors.map((captured) => captured.error),
      blocked,
    );
    this.publishDiagnostics();
    return this.lastReport;
  }

  private publishDiagnostics(): void {
    try {
      this.options.onDiagnosticsChanged?.(this.diagnostics());
    } catch {
      // Diagnostics projection/delivery is observation, never behavior registration authority.
    }
  }

  private emit(
    type: BehaviorGenerationEvent["type"],
    binding?: BehaviorCatalogBinding,
    detail: Partial<BehaviorGenerationEvent> = {},
  ): void {
    try {
      this.options.onEvent?.(
        Object.freeze({
          type,
          target: this.target,
          ...(binding === undefined
            ? {}
            : { pluginId: binding.pluginId, declarationId: binding.id }),
          ...detail,
        }),
      );
    } catch {
      // Observability is not authority. A broken diagnostic sink cannot interrupt registration,
      // rollback, ledger capture, or the synchronous close edge it was asked to describe.
    }
  }
}

/** Subscribe before reading the initial snapshot, closing the missed-update window. */
export function connectBehaviorGenerationHost(
  host: BehaviorGenerationHost,
  catalog: BehaviorBindingCatalog,
): {
  refresh(): BehaviorGenerationReport;
  close(reason?: string): BehaviorGenerationReport;
} {
  let connected = true;
  const apply = (snapshot: readonly BehaviorCatalogBinding[]): void => {
    if (connected) host.reconcile(snapshot);
  };
  let unsubscribe = (): void => undefined;
  try {
    unsubscribe = catalog.subscribe(apply);
    apply(catalog.snapshot());
  } catch (error) {
    connected = false;
    unsubscribe();
    host.close("initial-catalog-failed");
    throw error;
  }
  return Object.freeze({
    refresh(): BehaviorGenerationReport {
      if (!connected) return host.lastReport;
      return host.refresh();
    },
    close(reason = "generation-close"): BehaviorGenerationReport {
      if (!connected) return host.close(reason);
      connected = false;
      unsubscribe();
      return host.close(reason);
    },
  });
}
