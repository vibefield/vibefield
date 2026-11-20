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
import {
  type CallerContext,
  SHELL_CLIPBOARD_AUDIT_ACTIONS,
  SHELL_CUSTODY_AUDIT_ACTIONS,
  SHELL_PICTURE_AUDIT_ACTIONS,
  UPDATES_AUDIT_ACTIONS,
} from "@vibefield/contracts";
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
const SHELL_ACTIONS = new Set<string>([
  "approval.decision",
  "crash.artifact.export",
  "support.bundle.export",
  // WP12b (TD-3, EDP §11.6): the updater's verification outcomes and declines, named in contracts.
  ...Object.values(UPDATES_AUDIT_ACTIONS),
  // Item 102: the clipboard read door's outcomes (bytes, never the text), named in contracts.
  ...Object.values(SHELL_CLIPBOARD_AUDIT_ACTIONS),
  // OB custody: what main did with its own custody root, and with an older pair when it made
  // one (an outcome and what was stopped, never a secret, never the wrapped bytes), named in contracts.
  ...Object.values(SHELL_CUSTODY_AUDIT_ACTIONS),
  // Item 578: a print's picture saved through main's own panel (its size, format and file name, never a path).
  ...Object.values(SHELL_PICTURE_AUDIT_ACTIONS),
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

/** Item 559, 2026-11-18 — how an act that threw resolves in the trail, as its caller says (LOG-45): `failed`, or
 * `effect-unknown` when the act was handed to an executor fieldd does not own (a window) and no answer came. The act
 * then has no outcome record of its own: one `audit.outcome.recovery` record (`EFFECT_UNKNOWN`) closes its attempt.
 * The caller decides; this service learns no caller's error types. */
export type AuditFailureResolution = "failed" | "effect-unknown";

/** Why a recovery record closes an act's attempt (logging §16.3): its outcome could not be written, or its effect is
 * unknown (item 559, 2026-11-18). */
type RecoveryReason = "OUTCOME_DURABILITY_UNCONFIRMED" | "EFFECT_UNKNOWN";

interface RecoveryMarker {
  action: string;
  originalLedger: AuditLedger;
  operationId: string;
  target: AuditTargetV1;
  intendedOutcome: string;
  effectResolution: "unknown" | "effect-threw" | "applied" | "rolled-back" | "rollback-failed";
  failedAt: number;
  /** absent: `OUTCOME_DURABILITY_UNCONFIRMED` */
  reasonCode?: RecoveryReason;
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

/** DS-D15 (2026-09-30) — the actor names the NODE as well as the principal:
 * every tailnet-door kind carries the WhoIs node id the sidecar injected (a
 * transport fact), and a `peer-fieldd` call that carried the forwarding
 * envelope carries the window or phone behind it (DS-L7: authorized as the
 * peer daemon, recorded as the client it acted for). The record used to name
 * the login alone, which read two devices of one person as one. F1b — a phone
 * behind its home is named by its roster device as well (`clientDeviceId`). */
export function actorFor(ctx: CallerContext): AuditPrincipalV1 {
  const base = baseActorFor(ctx);
  const behalf = ctx.onBehalfOf;
  if (behalf === undefined) return base;
  return {
    ...base,
    onBehalfOf: {
      clientKind: behalf.clientKind,
      deviceId: behalf.deviceId,
      ...(behalf.windowId !== undefined ? { windowId: behalf.windowId } : {}),
      ...(behalf.userId !== undefined ? { userId: behalf.userId } : {}),
      ...(behalf.clientDeviceId !== undefined ? { clientDeviceId: behalf.clientDeviceId } : {}),
    },
  };
}

function baseActorFor(ctx: CallerContext): AuditPrincipalV1 {
  switch (ctx.principal.kind) {
    case "shell-main":
      return { kind: "shell-main", id: ctx.principal.tokenId };
    case "local-token":
      return { kind: "local-token", id: ctx.principal.tokenId };
    case "tailnet":
      return withNode({ kind: "tailnet", id: ctx.principal.login }, ctx.principal.tailscaleId);
    case "tailnet-guest":
      return withNode(
        { kind: "tailnet-guest", id: ctx.principal.login },
        ctx.principal.tailscaleId,
      );
    case "mcp-agent":
      return { kind: "mcp-agent", id: ctx.principal.sessionId };
    case "peer-fieldd":
      return withNode(
        { kind: "peer-fieldd", id: ctx.principal.deviceId },
        ctx.principal.tailscaleId,
      );
    case "plugin":
      return { kind: "plugin", id: ctx.principal.id };
  }
}

function withNode(actor: AuditPrincipalV1, nodeId: string | undefined): AuditPrincipalV1 {
  // bounded like every audit identity (LogBoundedIdentityV1): an id that would
  // not fit is left out rather than failing the act's audit closed
  return nodeId !== undefined && nodeId.length > 0 && nodeId.length <= 256
    ? { ...actor, nodeId }
    : actor;
}

function failureReason(error: unknown): string {
  if (error instanceof RpcCallError && /^[A-Z][A-Z0-9_]{0,127}$/.test(error.kind)) {
    return error.kind;
  }
  return "ACTION_FAILED";
}

const RECOVERY_AUTHORITY: { actor: AuditPrincipalV1; transportProvenance: string } = {
  actor: { kind: "system", id: "fieldd" },
  transportProvenance: "in-process",
};

/** A recovery record (logging §16.3): its own `outcome` is always `failed`, the audit's own word that it could not
 * record the act's outcome as known, never the act's; what is known of the act rides its attributes. */
function recoveryRecord(marker: RecoveryMarker): AuditAppendV1 {
  return {
    action: "audit.outcome.recovery",
    target: targetForAudit(marker.target),
    phase: "outcome",
    outcome: "failed",
    reasonCode: marker.reasonCode ?? "OUTCOME_DURABILITY_UNCONFIRMED",
    operationId: marker.operationId,
    attrs: {
      originalAction: marker.action,
      originalLedger: marker.originalLedger,
      intendedOutcome: marker.intendedOutcome,
      effectResolution: marker.effectResolution,
      failedAt: marker.failedAt,
    },
  };
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

  /** `resolveFailure` (item 559, 2026-11-18): how a throw from `effect` resolves in the trail; absent, `failed`. */
  async required<T>(
    ctx: CallerContext,
    mutation: AuditMutation,
    effect: () => Promise<T> | T,
    describeOutcome?: (value: T) => AuditMutationOutcome,
    rollbackOnOutcomeFailure?: (value: T) => Promise<void> | void,
    resolveFailure?: (error: unknown) => AuditFailureResolution,
  ): Promise<T> {
    return await this.requiredAs(
      ctx,
      mutation,
      effect,
      describeOutcome,
      rollbackOnOutcomeFailure,
      undefined,
      resolveFailure,
    );
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

  /**
   * A revocation (item 526, 2026-11-18): an act that ends what someone was given, never one that gives. It is
   * `required` while its attempt record can be written. When it cannot, the act runs all the same, as the token
   * revocations do: evidence failure is surfaced, but may never leave a grant live. A recovery marker says the act was
   * applied, and is written once the writer takes a line again; the caller is told AUDIT_UNAVAILABLE with the act
   * applied. A failure after the attempt record is `required`'s own.
   */
  async revoke<T>(
    ctx: CallerContext,
    mutation: AuditMutation,
    effect: () => Promise<T> | T,
    describeOutcome?: (value: T) => AuditMutationOutcome,
  ): Promise<T> {
    const attempt = { ran: false };
    try {
      return await this.requiredAs(
        ctx,
        mutation,
        () => {
          attempt.ran = true;
          return effect();
        },
        describeOutcome,
      );
    } catch (error) {
      if (attempt.ran || !(error instanceof AuditUnavailableError)) throw error;
      const details =
        error.details !== null && typeof error.details === "object"
          ? (error.details as { operation?: unknown; code?: unknown })
          : {};
      const owed = {
        action: mutation.action,
        originalLedger: auditLedgerForAction(mutation.action),
        operationId: `op_${randomBytes(12).toString("base64url")}`,
        target: targetForAudit(mutation.target),
      };
      let value: T;
      try {
        value = await effect();
      } catch (effectError) {
        this.queueRecovery({
          ...owed,
          intendedOutcome: "failed",
          effectResolution: "effect-threw",
          failedAt: this.now(),
        });
        throw effectError;
      }
      this.queueRecovery({
        ...owed,
        intendedOutcome: describeOutcome?.(value).outcome ?? "succeeded",
        effectResolution: "applied",
        failedAt: this.now(),
      });
      throw new AuditUnavailableError(
        typeof details.operation === "string"
          ? (details.operation as import("@vibefield/audit").AuditWriterOperation)
          : "write",
        typeof details.code === "string" ? details.code : "UNKNOWN",
        true,
      );
    }
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
    resolveFailure?: (error: unknown) => AuditFailureResolution,
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
      if (resolveFailure?.(error) === "effect-unknown") {
        // item 559, 2026-11-18 (LOG-45): the act left for an executor and no answer came, so whether it happened is
        // unknown. It is never written `failed`: one recovery record says so, and the act's own error stays primary.
        await this.writeRecovery({
          action: mutation.action,
          originalLedger: auditLedgerForAction(mutation.action),
          operationId,
          target,
          intendedOutcome: "unknown",
          effectResolution: "unknown",
          failedAt: this.now(),
          reasonCode: "EFFECT_UNKNOWN",
        });
        throw error;
      }
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
      await this.appendNow(this.recoveryCtx(), recoveryRecord(marker), RECOVERY_AUTHORITY);
      this.recovery.shift();
    }
    // Every marker was durably flushed, so recovery is now evidenced rather
    // than inferred from an empty queue.
    this.markHealthy();
  }

  /** Item 559, 2026-11-18 — a recovery record written now, after any queued before it. When the writer refuses it, it
   * is queued as any marker is, its reason kept, and written once the writer takes a line again. */
  private async writeRecovery(marker: RecoveryMarker): Promise<void> {
    try {
      await this.serial(async () => {
        await this.flushRecoveryMarkers();
        await this.appendNow(this.recoveryCtx(), recoveryRecord(marker), RECOVERY_AUTHORITY);
      });
    } catch {
      this.queueRecovery(marker);
    }
  }

  private recoveryCtx(): CallerContext {
    return {
      principal: { kind: "local-token", tokenId: "fieldd-recovery", scopes: [] },
      transport: "uds",
      receivedAt: this.now(),
    };
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
      if (marker.reasonCode !== undefined) existing.reasonCode = marker.reasonCode;
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
