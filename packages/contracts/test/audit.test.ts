import { describe, expect, it } from "vitest";
import { AuditAppendV1, AuditRecordV1 } from "../src/diagnostics";
import { ErrorKind, RPC_ERROR_CODES } from "../src/errors";
import { METHODS } from "../src/methods";

describe("LOG-L6 audit contracts", () => {
  it("registers a local, non-idempotent append method and typed unavailable error", () => {
    expect(METHODS.find((method) => method.method === "audit.append")).toMatchObject({
      surface: "product",
      scope: "audit.append",
      locality: "local",
      idempotent: false,
    });
    expect(ErrorKind.parse("AUDIT_UNAVAILABLE")).toBe("AUDIT_UNAVAILABLE");
    expect(RPC_ERROR_CODES.AUDIT_UNAVAILABLE).toBeLessThanOrEqual(-32000);
  });

  it("strips caller-owned authority fields and enforces phase/outcome coherence", () => {
    const parsed = AuditAppendV1.parse({
      action: "support.bundle.export",
      target: { kind: "support-bundle", id: "bundle_01" },
      phase: "attempt",
      operationId: "operation_01",
      actor: { kind: "system", id: "forged" },
      eventId: "forged",
      time: 1,
      transportProvenance: "forged",
      integrity: {
        algorithm: "sha256-chain-v1",
        previousHash: null,
        recordHash: "a".repeat(64),
      },
    });
    expect(parsed).toEqual({
      action: "support.bundle.export",
      target: { kind: "support-bundle", id: "bundle_01" },
      phase: "attempt",
      operationId: "operation_01",
    });
    expect(
      AuditAppendV1.safeParse({
        ...parsed,
        outcome: "succeeded",
      }).success,
    ).toBe(false);
    expect(
      AuditAppendV1.safeParse({
        ...parsed,
        phase: "outcome",
      }).success,
    ).toBe(false);
  });

  it("accepts the tamper-evident extension without making it mandatory for old readers", () => {
    const base = {
      v: 1,
      eventId: "audit_01",
      time: 1,
      actor: { kind: "system", id: "fieldd" },
      action: "token.shell.mint",
      target: { kind: "token", id: "tk_0123456789ab" },
      phase: "outcome",
      outcome: "succeeded",
      operationId: "operation_01",
    };
    expect(AuditRecordV1.safeParse(base).success).toBe(true);
    expect(
      AuditRecordV1.safeParse({
        ...base,
        integrity: {
          algorithm: "sha256-chain-v1",
          previousHash: null,
          recordHash: "a".repeat(64),
        },
      }).success,
    ).toBe(true);
  });
});
