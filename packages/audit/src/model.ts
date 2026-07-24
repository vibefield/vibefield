import { createHash } from "node:crypto";
import type { AuditPrincipalV1, AuditTargetV1 } from "@vibefield/contracts/diagnostics";
import type { LogAttributesV1 } from "@vibefield/contracts/logging";

export const MAX_AUDIT_RECORD_BYTES = 16 * 1024;

export interface AuditRecordBase {
  v: 1;
  eventId: string;
  time: number;
  actor: AuditPrincipalV1;
  action: string;
  target: AuditTargetV1;
  phase: "attempt" | "outcome";
  outcome?: "allowed" | "denied" | "succeeded" | "failed" | "cancelled";
  reasonCode?: string;
  traceId?: string;
  operationId?: string;
  sessionId?: string;
  transportProvenance?: string;
  attrs?: LogAttributesV1;
}

export function canonicalAuditJson(value: unknown): string {
  if (value === null || typeof value === "boolean" || typeof value === "number") {
    return JSON.stringify(value);
  }
  if (typeof value === "string") return JSON.stringify(value);
  if (Array.isArray(value)) {
    return `[${value.map((entry) => canonicalAuditJson(entry)).join(",")}]`;
  }
  if (typeof value !== "object") throw new TypeError("audit canonicalization requires JSON");
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalAuditJson(record[key])}`)
    .join(",")}}`;
}

export function auditChainHash(record: AuditRecordBase, previousHash: string | null): string {
  return createHash("sha256")
    .update("vibefield-audit-v1\0")
    .update(previousHash ?? "")
    .update("\0")
    .update(canonicalAuditJson(record))
    .digest("hex");
}
