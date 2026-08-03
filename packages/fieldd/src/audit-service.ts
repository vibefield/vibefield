import { randomBytes } from "node:crypto";
import { EventEmitter } from "node:events";
import {
  type AuditLedger,
  AuditLedgerWriter,
  type AuditPathAliases,
  type AuditRecordBase,
  AuditWriterError,
  type AuditWriterTestHooks,
  auditLedgerForAction,
  cleanAuditTarget,
  sanitizeAuditAttrs,
} from "@vibefield/audit";
import type { CallerContext } from "@vibefield/contracts";
import {
  AuditAppendResultV1 as AuditAppendResultSchemaV1,
  type AuditAppendResultV1,
  AuditAppendV1 as AuditAppendSchemaV1,
  type AuditAppendV1,
  AuditHealthV1 as AuditHealthSchemaV1,
  type AuditHealthV1,
  type AuditPrincipalV1,
  type AuditTargetV1,
} from "@vibefield/contracts/diagnostics";
import { RpcCallError } from "./native-link";

export type {
  AuditIntegrityResult,
  AuditLedger,
  AuditWriterOperation,
  AuditWriterTestHooks,
} from "@vibefield/audit";
export {
  AUDIT_LEDGERS,
  verifyAuditSegment,
} from "@vibefield/audit";

const MAX_RECOVERY_MARKERS = 64;
const SHELL_ACTIONS = new Set([
  "approval.decision",
  "crash.artifact.export",
  "support.bundle.export",
]);

export interface AuditServiceOptions {
  dataDir: string;
  bootId: string;
  aliases?: AuditPathAliases;
  now?: () => number;
  hooks?: AuditWriterTestHooks;
}

export interface AuditMutation {
  action: AuditAppendV1["action"];
  target: AuditTargetV1;
  reasonCode?: string;
  traceId?: string;
  sessionId?: string;
  attrs?: Readonly<Record<string, unknown>>;
}

export interface AuditMutationOutcome {
  outcome?: "allowed" | "denied" | "succeeded" | "failed" | "cancelled";
  reasonCode?: string;
  attrs?: Readonly<Record<string, unknown>>;
}

interface RecoveryMarker {
  action: string;
  originalLedger: AuditLedger;
  operationId: string;
  target: AuditTargetV1;
  intendedOutcome: string;
  effectResolution: "unknown" | "effect-threw" | "applied" | "rolled-back" | "rollback-failed";
  failedAt: number;
}

export class AuditUnavailableError extends RpcCallError {
  constructor(
    operation: import("@vibefield/audit").AuditWriterOperation,
    code: string,
    actionApplied = false,
  ) {
    super(
      "AUDIT_UNAVAILABLE",
      actionApplied
        ? "the action completed, but its audit outcome could not be durably confirmed"
        : "required audit evidence could not be durably recorded",
      true,
      { service: "audit", state: "degraded", operation, code, actionApplied },
    );
    this.name = "AuditUnavailableError";
  }
}

function errorCode(error: unknown): string {
  if (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    typeof error.code === "string"
  ) {
    return error.code.slice(0, 64);
  }
  return error instanceof Error && error.name !== "" ? error.name.slice(0, 64) : "UNKNOWN";
}

function targetForAudit(target: AuditTargetV1): AuditTargetV1 {
  try {
    return cleanAuditTarget(target);
  } catch {
    throw new RpcCallError(
      "PRECONDITION_FAILED",
      "audit target contains forbidden credential-like material",
      false,
    );
  }
}

function actorFor(ctx: CallerContext): AuditPrincipalV1 {
  switch (ctx.principal.kind) {
    case "shell-main":
      return { kind: "shell-main", id: ctx.principal.tokenId };
    case "local-token":
      return { kind: "local-token", id: ctx.principal.tokenId };
    case "tailnet":
      return { kind: "tailnet", id: ctx.principal.login };
    case "mcp-agent":
      return { kind: "mcp-agent", id: ctx.principal.sessionId };
    case "peer-fieldd":
      return { kind: "peer-fieldd", id: ctx.principal.deviceId };
    case "plugin":
      return { kind: "plugin", id: ctx.principal.id };
  }
}

function failureReason(error: unknown): string {
  if (error instanceof RpcCallError && /^[A-Z][A-Z0-9_]{0,127}$/.test(error.kind)) {
    return error.kind;
  }
  return "ACTION_FAILED";
}

export class AuditService extends EventEmitter {
  readonly root: string;
  private readonly writer: AuditLedgerWriter;
  private readonly now: () => number;
  private operation: Promise<void> = Promise.resolve();
  private recovery: RecoveryMarker[] = [];
  private state: AuditHealthV1["state"] = "healthy";
  private records = 0;
  private bytes = 0;
  private syncs = 0;
  private integrityFailures = 0;
  private lastSuccessAt: number | undefined;
  private lastFailure: AuditHealthV1["lastFailure"];
  private closed = false;

  constructor(private readonly options: AuditServiceOptions) {
    super();
    this.writer = new AuditLedgerWriter(options);
    this.root = this.writer.root;
    this.now = options.now ?? Date.now;
  }

  async start(): Promise<void> {
    try {
      await this.writer.initialize();
      this.markHealthy();
    } catch (error) {
      this.markFailure(error);
      // Preserve typed degraded health here rather than replacing the root
      // failure. Daemon bootstrap still fails closed when its mandatory
      // audited shell-token mint reaches append.
    }
  }

  health(): AuditHealthV1 {
    return AuditHealthSchemaV1.parse({
      v: 1,
      state: this.closed ? "closed" : this.state,
      records: this.records,
      bytes: this.bytes,
      syncs: this.syncs,
      openSegments: this.writer.openSegments(),
      pendingRecoveryMarkers: this.recovery.length,
      integrityFailures: this.integrityFailures,
      ...(this.lastSuccessAt !== undefined ? { lastSuccessAt: this.lastSuccessAt } : {}),
      ...(this.lastFailure !== undefined ? { lastFailure: this.lastFailure } : {}),
    });
  }

  appendFromCaller(ctx: CallerContext, raw: unknown): Promise<AuditAppendResultV1> {
    if (ctx.transport !== "ws-loopback" || ctx.principal.kind !== "shell-main") {
      throw new RpcCallError(
        "FORBIDDEN_SCOPE",
        "audit.append is available only to the authenticated local shell",
        false,
      );
    }
    const parsed = AuditAppendSchemaV1.safeParse(raw);
    if (!parsed.success) {
      throw new RpcCallError(
        "PRECONDITION_FAILED",
        "expected a bounded audit attempt or outcome",
        false,
      );
    }
    if (!SHELL_ACTIONS.has(parsed.data.action)) {
      throw new RpcCallError(
        "FORBIDDEN_SCOPE",
        "the shell may append only registered shell-owned audit actions",
        false,
      );
    }
    return this.append(ctx, parsed.data);
  }

  append(ctx: CallerContext, input: AuditAppendV1): Promise<AuditAppendResultV1> {
    return this.appendAs(ctx, input);
  }

  async required<T>(
    ctx: CallerContext,
    mutation: AuditMutation,
    effect: () => Promise<T> | T,
    describeOutcome?: (value: T) => AuditMutationOutcome,
    rollbackOnOutcomeFailure?: (value: T) => Promise<void> | void,
  ): Promise<T> {
    return await this.requiredAs(ctx, mutation, effect, describeOutcome, rollbackOnOutcomeFailure);
  }

  async requiredSystem<T>(
    mutation: AuditMutation,
    effect: () => Promise<T> | T,
    describeOutcome?: (value: T) => AuditMutationOutcome,
    rollbackOnOutcomeFailure?: (value: T) => Promise<void> | void,
  ): Promise<T> {
    const ctx: CallerContext = {
      principal: { kind: "local-token", tokenId: "fieldd-system", scopes: [] },
      transport: "uds",
      receivedAt: this.now(),
    };
    return await this.requiredAs(ctx, mutation, effect, describeOutcome, rollbackOnOutcomeFailure, {
      actor: { kind: "system", id: "fieldd" },
      transportProvenance: "in-process",
    });
  }

  close(): Promise<void> {
    return this.serial(async () => {
      if (this.closed) return;
      this.closed = true;
      try {
        await this.writer.close();
      } catch (error) {
        this.markFailure(error);
        throw error;
      } finally {
        this.state = "closed";
        this.emit("health");
      }
    });
  }

  private appendAs(
    ctx: CallerContext,
    input: AuditAppendV1,
    authority?: { actor: AuditPrincipalV1; transportProvenance: string },
  ): Promise<AuditAppendResultV1> {
    return this.serial(async () => {
      await this.flushRecoveryMarkers();
      return await this.appendNow(ctx, input, authority);
    });
  }

  private async requiredAs<T>(
    ctx: CallerContext,
    mutation: AuditMutation,
    effect: () => Promise<T> | T,
    describeOutcome?: (value: T) => AuditMutationOutcome,
    rollbackOnOutcomeFailure?: (value: T) => Promise<void> | void,
    authority?: { actor: AuditPrincipalV1; transportProvenance: string },
  ): Promise<T> {
    const operationId = `op_${randomBytes(12).toString("base64url")}`;
    const target = targetForAudit(mutation.target);
    await this.appendAs(
      ctx,
      {
        action: mutation.action,
        target,
        phase: "attempt",
        operationId,
        ...(mutation.reasonCode !== undefined ? { reasonCode: mutation.reasonCode } : {}),
        ...(mutation.traceId !== undefined ? { traceId: mutation.traceId } : {}),
        ...(mutation.sessionId !== undefined ? { sessionId: mutation.sessionId } : {}),
        ...(mutation.attrs !== undefined
          ? { attrs: sanitizeAuditAttrs(mutation.attrs, this.options.aliases) ?? {} }
          : {}),
      },
      authority,
    );

    let value: T;
    try {
      value = await effect();
    } catch (error) {
      try {
        await this.appendAs(
          ctx,
          {
            action: mutation.action,
            target,
            phase: "outcome",
            outcome: "failed",
            reasonCode: failureReason(error),
            operationId,
            ...(mutation.traceId !== undefined ? { traceId: mutation.traceId } : {}),
            ...(mutation.sessionId !== undefined ? { sessionId: mutation.sessionId } : {}),
          },
          authority,
        );
      } catch {
        this.queueRecovery({
          action: mutation.action,
          originalLedger: auditLedgerForAction(mutation.action),
          operationId,
          target,
          intendedOutcome: "failed",
          effectResolution: "effect-threw",
          failedAt: this.now(),
        });
        // The action's own typed failure remains primary. Audit health and the
        // bounded recovery marker make the missing outcome visible.
      }
      throw error;
    }

    const described = describeOutcome?.(value) ?? {};
    try {
      await this.appendAs(
        ctx,
        {
          action: mutation.action,
          target,
          phase: "outcome",
          outcome: described.outcome ?? "succeeded",
          operationId,
          ...(described.reasonCode !== undefined ? { reasonCode: described.reasonCode } : {}),
          ...(mutation.traceId !== undefined ? { traceId: mutation.traceId } : {}),
          ...(mutation.sessionId !== undefined ? { sessionId: mutation.sessionId } : {}),
          ...(described.attrs !== undefined
            ? { attrs: sanitizeAuditAttrs(described.attrs, this.options.aliases) ?? {} }
            : {}),
        },
        authority,
      );
    } catch (error) {
      if (error instanceof AuditUnavailableError) {
        let rolledBack = false;
        let effectResolution: RecoveryMarker["effectResolution"] = "applied";
        if (rollbackOnOutcomeFailure !== undefined) {
          try {
            await rollbackOnOutcomeFailure(value);
            rolledBack = true;
            effectResolution = "rolled-back";
          } catch {
            effectResolution = "rollback-failed";
          }
        }
        this.queueRecovery({
          action: mutation.action,
          originalLedger: auditLedgerForAction(mutation.action),
          operationId,
          target,
          intendedOutcome: described.outcome ?? "succeeded",
          effectResolution,
          failedAt: this.now(),
        });
        const details =
          error.details !== null && typeof error.details === "object"
            ? (error.details as { operation?: unknown; code?: unknown })
            : {};
        throw new AuditUnavailableError(
          typeof details.operation === "string"
            ? (details.operation as import("@vibefield/audit").AuditWriterOperation)
            : "write",
          typeof details.code === "string" ? details.code : "UNKNOWN",
          !rolledBack,
        );
      }
      throw error;
    }
    return value;
  }

  private async appendNow(
    ctx: CallerContext,
    input: AuditAppendV1,
    authority?: { actor: AuditPrincipalV1; transportProvenance: string },
  ): Promise<AuditAppendResultV1> {
    if (this.closed) throw new AuditUnavailableError("write", "CLOSED");
    const target = targetForAudit(input.target);
    const time = this.now();
    const base: AuditRecordBase = {
      v: 1,
      eventId: `audit_${randomBytes(12).toString("base64url")}`,
      time,
      actor: authority?.actor ?? actorFor(ctx),
      action: input.action,
      target,
      phase: input.phase,
      ...(input.outcome !== undefined ? { outcome: input.outcome } : {}),
      ...(input.reasonCode !== undefined ? { reasonCode: input.reasonCode } : {}),
      ...(input.traceId !== undefined ? { traceId: input.traceId } : {}),
      operationId: input.operationId,
      ...(input.sessionId !== undefined ? { sessionId: input.sessionId } : {}),
      transportProvenance: authority?.transportProvenance ?? ctx.transport,
      ...(input.attrs !== undefined
        ? { attrs: sanitizeAuditAttrs(input.attrs, this.options.aliases) ?? {} }
        : {}),
    };
    try {
      const written = await this.writer.append(base);
      this.records += 1;
      this.bytes += written.bytes;
      this.syncs += 1;
      this.lastSuccessAt = time;
      this.markHealthy();
      return AuditAppendResultSchemaV1.parse({
        v: 1,
        eventId: written.record.eventId,
        time: written.record.time,
        operationId: input.operationId,
        durable: true,
      });
    } catch (error) {
      this.markFailure(error);
      if (input.phase === "outcome" && input.action !== "audit.outcome.recovery") {
        this.queueRecovery({
          action: input.action,
          originalLedger: auditLedgerForAction(input.action),
          operationId: input.operationId,
          target,
          intendedOutcome: input.outcome ?? "unknown",
          effectResolution: "unknown",
          failedAt: time,
        });
      }
      const operation = error instanceof AuditWriterError ? error.operation : "write";
      throw new AuditUnavailableError(
        operation,
        error instanceof AuditWriterError ? error.code : errorCode(error),
      );
    }
  }

  private async flushRecoveryMarkers(): Promise<void> {
    // An empty recovery queue is not evidence that the writer recovered. In
    // particular, another queued append may enter here after a failed write;
    // declaring health before that append succeeds creates a transient,
    // externally observable "healthy" state while the writer is still down.
    if (this.recovery.length === 0) return;

    while (this.recovery.length > 0) {
      const marker = this.recovery[0]!;
      const ctx: CallerContext = {
        principal: { kind: "local-token", tokenId: "fieldd-recovery", scopes: [] },
        transport: "uds",
        receivedAt: this.now(),
      };
      await this.appendNow(
        ctx,
        {
          action: "audit.outcome.recovery",
          target: targetForAudit(marker.target),
          phase: "outcome",
          outcome: "failed",
          reasonCode: "OUTCOME_DURABILITY_UNCONFIRMED",
          operationId: marker.operationId,
          attrs: {
            originalAction: marker.action,
            originalLedger: marker.originalLedger,
            intendedOutcome: marker.intendedOutcome,
            effectResolution: marker.effectResolution,
            failedAt: marker.failedAt,
          },
        },
        {
          actor: { kind: "system", id: "fieldd" },
          transportProvenance: "in-process",
        },
      );
      this.recovery.shift();
    }
    // Every marker was durably flushed, so recovery is now evidenced rather
    // than inferred from an empty queue.
    this.markHealthy();
  }

  private queueRecovery(marker: RecoveryMarker): void {
    const existing = this.recovery.find(
      (candidate) =>
        candidate.operationId === marker.operationId && candidate.action === marker.action,
    );
    if (existing !== undefined) {
      existing.originalLedger = marker.originalLedger;
      existing.target = marker.target;
      existing.intendedOutcome = marker.intendedOutcome;
      existing.effectResolution = marker.effectResolution;
      this.emit("health");
      return;
    }
    if (this.recovery.length >= MAX_RECOVERY_MARKERS) this.recovery.shift();
    this.recovery.push(marker);
    this.emit("health");
  }

  private markHealthy(): void {
    if (!this.closed) {
      this.state = this.recovery.length > 0 || this.integrityFailures > 0 ? "degraded" : "healthy";
    }
    this.emit("health");
  }

  private markFailure(error: unknown): void {
    const operation = error instanceof AuditWriterError ? error.operation : "write";
    if (operation === "checkpoint") this.integrityFailures += 1;
    this.state = "degraded";
    this.lastFailure = {
      time: this.now(),
      operation,
      code: error instanceof AuditWriterError ? error.code : errorCode(error),
    };
    this.emit("health");
  }

  private serial<T>(task: () => Promise<T>): Promise<T> {
    const result = this.operation.then(task, task);
    this.operation = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }
}
