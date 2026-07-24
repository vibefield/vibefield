import { z } from "zod";
import {
  LogAttributesV1,
  LogBoundedIdentityV1,
  LoggingHealthV1,
  LogLevelNameV1,
  LogRecordV1,
  LogSafeIntegerV1,
  LogSchemaVersionV1,
  LogServiceV1,
  LogStreamV1,
} from "./logging";

// LOG-L0 diagnostics/audit/support contracts. TS consumers import the
// @vibefield/contracts/diagnostics subpath; only the LOG-42 snapshot/delta
// dependency closure is added to Rust generation.

export const DiagnosticCursorV1 = z
  .string()
  .min(1)
  .max(16 * 1024);
export type DiagnosticCursorV1 = z.infer<typeof DiagnosticCursorV1>;

export const DiagnosticLogQueryV1 = z
  .object({
    sources: z.array(LogStreamV1).min(1).max(8),
    sinceTime: LogSafeIntegerV1.optional(),
    minLevel: LogLevelNameV1.optional(),
    components: z.array(z.string().min(1).max(160)).max(64).optional(),
    pluginId: LogBoundedIdentityV1.optional(),
    text: z.string().max(500).optional(),
    limit: z.number().int().min(1).max(1_000),
  })
  .passthrough();
export type DiagnosticLogQueryV1 = z.infer<typeof DiagnosticLogQueryV1>;

export const DiagnosticProducerStateV1 = z
  .object({
    producerId: LogBoundedIdentityV1,
    service: LogServiceV1,
    stream: LogStreamV1,
    bootId: LogBoundedIdentityV1,
    instanceId: LogBoundedIdentityV1,
    oldestCursor: LogSafeIntegerV1,
    newestCursor: LogSafeIntegerV1,
    droppedBefore: LogSafeIntegerV1,
    health: LoggingHealthV1,
  })
  .passthrough();
export type DiagnosticProducerStateV1 = z.infer<typeof DiagnosticProducerStateV1>;

export const DiagnosticLogSnapshotV1 = z
  .object({
    v: LogSchemaVersionV1,
    producers: z.array(DiagnosticProducerStateV1).max(16),
    records: z.array(LogRecordV1).max(2_000),
    nextCursor: DiagnosticCursorV1,
    droppedBefore: LogSafeIntegerV1,
    history: z
      .object({
        scannedBytes: LogSafeIntegerV1,
        scannedSegments: LogSafeIntegerV1,
        parseFailures: LogSafeIntegerV1,
        skippedUnsafeSegments: LogSafeIntegerV1,
        truncated: z.boolean(),
      })
      .passthrough()
      .optional(),
  })
  .passthrough()
  .describe("vibefield.diagnostics.contract.v1");
export type DiagnosticLogSnapshotV1 = z.infer<typeof DiagnosticLogSnapshotV1>;

export const DiagnosticLogDeltaV1 = z
  .object({
    v: LogSchemaVersionV1,
    cursor: DiagnosticCursorV1,
    records: z.array(LogRecordV1).max(2_000),
    droppedSincePrevious: LogSafeIntegerV1,
  })
  .passthrough()
  .describe("vibefield.diagnostics.delta.contract.v1");
export type DiagnosticLogDeltaV1 = z.infer<typeof DiagnosticLogDeltaV1>;

export const DiagnosticParseFailureV1 = z
  .object({
    v: LogSchemaVersionV1,
    source: LogStreamV1,
    observedTime: LogSafeIntegerV1,
    reason: z.enum([
      "invalid-json",
      "unsupported-version",
      "invalid-record",
      "oversized-record",
      "partial-line",
    ]),
    inputBytes: LogSafeIntegerV1,
    lineNumber: LogSafeIntegerV1.optional(),
  })
  .passthrough();
export type DiagnosticParseFailureV1 = z.infer<typeof DiagnosticParseFailureV1>;

export const DiagnosticPrincipalV1 = z
  .object({
    kind: z.enum(["shell-main", "developer", "system"]),
    id: LogBoundedIdentityV1.optional(),
  })
  .passthrough();
export type DiagnosticPrincipalV1 = z.infer<typeof DiagnosticPrincipalV1>;

export const DiagnosticLeaseSelectorV1 = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("service"),
      service: LogServiceV1,
    })
    .passthrough(),
  z
    .object({
      kind: z.literal("component"),
      service: LogServiceV1,
      component: z.string().min(1).max(160),
    })
    .passthrough(),
  z
    .object({
      kind: z.literal("plugin"),
      pluginId: LogBoundedIdentityV1,
      entry: z.enum(["renderer", "service", "utility"]).optional(),
    })
    .passthrough(),
]);
export type DiagnosticLeaseSelectorV1 = z.infer<typeof DiagnosticLeaseSelectorV1>;

export const DiagnosticLeaseV1 = z
  .object({
    v: LogSchemaVersionV1,
    leaseId: LogBoundedIdentityV1,
    selector: DiagnosticLeaseSelectorV1,
    level: z.enum(["trace", "debug", "info", "warn", "error"]),
    createdAt: LogSafeIntegerV1,
    expiresAt: LogSafeIntegerV1,
    createdBy: DiagnosticPrincipalV1,
  })
  .passthrough();
export type DiagnosticLeaseV1 = z.infer<typeof DiagnosticLeaseV1>;

export const DiagnosticLeaseDurationV1 = z.enum(["15m", "1h", "until-restart"]);
export type DiagnosticLeaseDurationV1 = z.infer<typeof DiagnosticLeaseDurationV1>;

export const DiagnosticLeaseCreateV1 = z
  .object({
    selector: DiagnosticLeaseSelectorV1,
    level: z.enum(["trace", "debug", "info", "warn", "error"]),
    duration: DiagnosticLeaseDurationV1,
  })
  .strip();
export type DiagnosticLeaseCreateV1 = z.infer<typeof DiagnosticLeaseCreateV1>;

export const DiagnosticLeaseListV1 = z
  .object({
    v: LogSchemaVersionV1,
    observedAt: LogSafeIntegerV1,
    leases: z.array(DiagnosticLeaseV1).max(256),
  })
  .passthrough();
export type DiagnosticLeaseListV1 = z.infer<typeof DiagnosticLeaseListV1>;

export const DiagnosticLeaseRevokeV1 = z
  .object({
    leaseId: LogBoundedIdentityV1,
  })
  .strip();
export type DiagnosticLeaseRevokeV1 = z.infer<typeof DiagnosticLeaseRevokeV1>;

export const AuditPrincipalV1 = z
  .object({
    kind: z.enum(["local-token", "tailnet", "mcp-agent", "peer-fieldd", "shell-main", "system"]),
    id: LogBoundedIdentityV1.optional(),
    label: z.string().max(256).optional(),
  })
  .passthrough();
export type AuditPrincipalV1 = z.infer<typeof AuditPrincipalV1>;

export const AuditTargetV1 = z
  .object({
    kind: z.string().min(1).max(96),
    id: LogBoundedIdentityV1,
    parentId: LogBoundedIdentityV1.optional(),
  })
  .passthrough();
export type AuditTargetV1 = z.infer<typeof AuditTargetV1>;

export const AuditRecordV1 = z
  .object({
    v: LogSchemaVersionV1,
    eventId: LogBoundedIdentityV1,
    time: LogSafeIntegerV1,
    actor: AuditPrincipalV1,
    action: z
      .string()
      .min(3)
      .max(192)
      .regex(/^[a-z][a-z0-9_]*(?:\.[a-z][a-z0-9_]*)+$/),
    target: AuditTargetV1,
    phase: z.enum(["attempt", "outcome"]),
    outcome: z.enum(["allowed", "denied", "succeeded", "failed", "cancelled"]).optional(),
    reasonCode: z.string().min(1).max(128).optional(),
    traceId: LogBoundedIdentityV1.optional(),
    operationId: LogBoundedIdentityV1.optional(),
    sessionId: LogBoundedIdentityV1.optional(),
    transportProvenance: z.string().min(1).max(128).optional(),
    attrs: LogAttributesV1.optional(),
  })
  .passthrough();
export type AuditRecordV1 = z.infer<typeof AuditRecordV1>;

export const SupportBundleFileV1 = z
  .object({
    path: z
      .string()
      .min(1)
      .max(512)
      .regex(/^(?!\/)(?!.*(?:^|\/)\.\.(?:\/|$))[A-Za-z0-9._/-]+$/),
    category: z.enum(["system", "plugin", "health", "doctor", "audit", "crash", "manifest"]),
    bytes: LogSafeIntegerV1,
    sha256: z.string().regex(/^[0-9a-f]{64}$/),
  })
  .passthrough();
export type SupportBundleFileV1 = z.infer<typeof SupportBundleFileV1>;

export const SupportBundleManifestV1 = z
  .object({
    v: LogSchemaVersionV1,
    bundleId: LogBoundedIdentityV1,
    createdAt: LogSafeIntegerV1,
    range: z
      .object({
        from: LogSafeIntegerV1,
        to: LogSafeIntegerV1,
      })
      .passthrough(),
    sources: z.array(LogStreamV1).max(8),
    pluginAliases: z.array(LogBoundedIdentityV1).max(256),
    includesAudit: z.boolean(),
    crashArtifacts: z.array(LogBoundedIdentityV1).max(5),
    sanitizerVersion: z.string().min(1).max(64),
    omittedRecords: LogSafeIntegerV1,
    truncatedRecords: LogSafeIntegerV1,
    files: z.array(SupportBundleFileV1).max(256),
    totalBytes: LogSafeIntegerV1,
    versions: z.record(z.string().max(128)),
  })
  .passthrough()
  .describe("vibefield.support.manifest.contract.v1");
export type SupportBundleManifestV1 = z.infer<typeof SupportBundleManifestV1>;
