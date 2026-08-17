import type { CanvasEngine, GuestLedgerRecord } from "@vibecook/ice";
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

export type BehaviorBlockedReason = "canvas-write-denied" | "presence-unavailable";

export interface BehaviorGenerationError {
  readonly operation: "register" | "unregister" | "rollback";
  readonly declarationId: string;
  readonly message: string;
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

function assertNonEmpty(value: string, label: string): void {
  if (value.length === 0) throw new TypeError(`${label} must be a non-empty string`);
}

function normalizeTarget(target: BehaviorGenerationTarget): BehaviorGenerationTarget {
  assertNonEmpty(target.windowId, "target.windowId");
  assertNonEmpty(target.documentId, "target.documentId");
  assertNonEmpty(target.runtimeGeneration, "target.runtimeGeneration");
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

function blockedReason(
  binding: BehaviorCatalogBinding,
  presenceAvailable: boolean,
): BehaviorBlockedReason | undefined {
  if (!binding.authorized) return "canvas-write-denied";
  if (binding.definition.store === "ephemeral" && !presenceAvailable) {
    return "presence-unavailable";
  }
  return undefined;
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
    const errors: BehaviorGenerationError[] = [];
    for (const current of [...this.installed.values()].sort(reverseInstalled)) {
      try {
        current.unregister();
        this.emit("unregister", current.binding, { reason });
      } catch (error) {
        errors.push(this.captureError("unregister", current.binding, error));
      } finally {
        this.installed.delete(current.binding.id);
      }
    }
    this.stopLedger();
    this.emit("close", undefined, { reason });
    this.lastReport = report(errors.length === 0 ? "closed" : "failed", this.installed, errors);
    return this.lastReport;
  }

  breakerKey(binding: BehaviorCatalogBinding): string {
    return `${this.target.windowId}\0${binding.pluginId}\0${binding.id}`;
  }

  private applyDesired(): BehaviorGenerationReport {
    const presenceAvailable = this.options.presenceAvailable?.() ?? false;
    const blocked: Array<{
      declarationId: string;
      reason: BehaviorBlockedReason;
    }> = [];
    const eligible = new Map<string, BehaviorCatalogBinding>();
    for (const binding of this.desired) {
      const reason = blockedReason(binding, presenceAvailable);
      if (reason === undefined) eligible.set(binding.id, binding);
      else blocked.push({ declarationId: binding.id, reason });
    }

    const errors: BehaviorGenerationError[] = [];
    const withdrawals = [...this.installed.values()]
      .filter((current) => {
        const next = eligible.get(current.binding.id);
        return next === undefined || !sameExecution(current, next);
      })
      .sort(reverseInstalled);
    for (const current of withdrawals) {
      try {
        current.unregister();
        this.emit("unregister", current.binding);
      } catch (error) {
        errors.push(this.captureError("unregister", current.binding, error));
      } finally {
        this.installed.delete(current.binding.id);
      }
    }
    if (errors.length > 0) {
      this.lastReport = report("failed", this.installed, errors, blocked);
      return this.lastReport;
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
          this.emit("rollback", current.binding);
        } catch (error) {
          errors.push(this.captureError("rollback", current.binding, error));
        } finally {
          this.installed.delete(current.binding.id);
        }
      }
      this.lastReport = report("failed", this.installed, errors, blocked);
      return this.lastReport;
    }

    this.lastReport = report("active", this.installed, [], blocked);
    return this.lastReport;
  }

  private captureError(
    operation: BehaviorGenerationError["operation"],
    binding: BehaviorCatalogBinding,
    error: unknown,
  ): BehaviorGenerationError {
    const captured = Object.freeze({
      operation,
      declarationId: binding.id,
      message: error instanceof Error ? error.message : String(error),
    });
    this.emit("error", binding, { error: captured });
    return captured;
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
