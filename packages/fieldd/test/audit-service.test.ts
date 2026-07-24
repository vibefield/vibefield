import { createHash } from "node:crypto";
import { mkdtemp, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { CallerContext } from "@vibefield/contracts";
import type { AuditRecordV1 } from "@vibefield/contracts/diagnostics";
import { afterEach, describe, expect, it } from "vitest";
import { AuditService, verifyAuditSegment } from "../src/audit-service";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function root(): Promise<string> {
  const value = await mkdtemp(join(tmpdir(), "vibefield-audit-"));
  roots.push(value);
  return value;
}

function shellContext(tokenId = "tk_shell_safe"): CallerContext {
  return {
    principal: {
      kind: "local-token",
      tokenId,
      scopes: ["audit.append", "plugins.manage"],
    },
    transport: "ws-loopback",
    receivedAt: Date.now(),
    clientKind: "shell-main",
  };
}

async function auditFiles(auditRoot: string): Promise<string[]> {
  return (await readdir(auditRoot))
    .filter((name) => name.endsWith(".jsonl"))
    .map((name) => join(auditRoot, name))
    .sort();
}

async function records(auditRoot: string): Promise<AuditRecordV1[]> {
  const result: AuditRecordV1[] = [];
  for (const path of await auditFiles(auditRoot)) {
    const verified = await verifyAuditSegment(path);
    expect(verified.valid, `${path}: ${verified.reason}`).toBe(true);
    result.push(...verified.records);
  }
  return result;
}

describe("LOG-L6 append-only audit ledger", () => {
  it("derives authority fields, syncs private chained records, and checkpoints on close", async () => {
    const dataDir = await root();
    let now = 1_785_000_000_000;
    const service = new AuditService({
      dataDir,
      bootId: "fieldd-audit-test",
      now: () => now++,
      aliases: { data: dataDir },
    });
    await service.start();
    const ctx = shellContext();
    const operationId = "operation_support_01";
    await service.appendFromCaller(ctx, {
      action: "support.bundle.export",
      target: { kind: "support-bundle", id: "bundle_01" },
      phase: "attempt",
      operationId,
      actor: { kind: "system", id: "forged" },
      transportProvenance: "forged-remote",
      attrs: {
        includedAudit: true,
        token: "tok_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        note: "tok_bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
      },
    });
    await service.appendFromCaller(ctx, {
      action: "support.bundle.export",
      target: { kind: "support-bundle", id: "bundle_01" },
      phase: "outcome",
      outcome: "succeeded",
      reasonCode: "USER_REQUESTED",
      operationId,
    });
    expect(service.health()).toMatchObject({
      state: "healthy",
      records: 2,
      syncs: 2,
      pendingRecoveryMarkers: 0,
    });
    await service.close();

    const files = await auditFiles(service.root);
    expect(files).toHaveLength(1);
    expect(files[0]).toContain("own-actions.2026-07.fieldd-audit-test.jsonl");
    expect((await stat(service.root)).mode & 0o777).toBe(0o700);
    expect((await stat(files[0] as string)).mode & 0o777).toBe(0o600);
    expect((await stat(`${files[0]}.integrity.json`)).mode & 0o777).toBe(0o600);

    const verified = await verifyAuditSegment(files[0] as string);
    expect(verified).toMatchObject({
      valid: true,
      checkpointed: true,
      bytes: (await stat(files[0] as string)).size,
    });
    expect(verified.records).toHaveLength(2);
    expect(verified.records[0]).toMatchObject({
      actor: { kind: "shell-main", id: "tk_shell_safe" },
      transportProvenance: "ws-loopback",
      phase: "attempt",
      operationId,
    });
    expect(verified.records[0]?.attrs).not.toHaveProperty("token");
    expect(JSON.stringify(verified.records)).not.toContain(
      "tok_bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
    );
    expect(verified.records[0]?.integrity?.previousHash).toBeNull();
    expect(verified.records[1]?.integrity?.previousHash).toBe(
      verified.records[0]?.integrity?.recordHash,
    );
  });

  it("refuses non-shell authors, unregistered shell actions, and credential-shaped identities", async () => {
    const dataDir = await root();
    const service = new AuditService({ dataDir, bootId: "fieldd-authority-test" });
    await service.start();
    const renderer = { ...shellContext(), clientKind: "renderer" as const };
    expect(() =>
      service.appendFromCaller(renderer, {
        action: "support.bundle.export",
        target: { kind: "support-bundle", id: "bundle_01" },
        phase: "attempt",
        operationId: "op_01",
      }),
    ).toThrow(/local shell/);
    expect(() =>
      service.appendFromCaller(shellContext(), {
        action: "plugin.enable",
        target: { kind: "plugin", id: "vibefield.example" },
        phase: "attempt",
        operationId: "op_02",
      }),
    ).toThrow(/shell-owned/);
    await expect(
      service.appendFromCaller(shellContext(), {
        action: "support.bundle.export",
        target: {
          kind: "support-bundle",
          id: "tok_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        },
        phase: "attempt",
        operationId: "op_03",
      }),
    ).rejects.toMatchObject({ kind: "PRECONDITION_FAILED" });
    await service.close();
  });

  it("prevents a required side effect when its attempt cannot be made durable", async () => {
    const dataDir = await root();
    let fail = true;
    const service = new AuditService({
      dataDir,
      bootId: "fieldd-fail-closed",
      hooks: {
        beforeWrite: () => {
          if (fail) throw Object.assign(new Error("disk full"), { code: "ENOSPC" });
        },
      },
    });
    await service.start();
    let applied = false;
    await expect(
      service.required(
        shellContext(),
        {
          action: "plugin.enable",
          target: { kind: "plugin", id: "vibefield.example" },
        },
        () => {
          applied = true;
        },
      ),
    ).rejects.toMatchObject({
      kind: "AUDIT_UNAVAILABLE",
      details: { operation: "write", code: "ENOSPC", actionApplied: false },
    });
    expect(applied).toBe(false);
    expect(service.health()).toMatchObject({
      state: "degraded",
      records: 0,
      pendingRecoveryMarkers: 0,
    });

    fail = false;
    await service.required(
      shellContext(),
      {
        action: "plugin.enable",
        target: { kind: "plugin", id: "vibefield.example" },
      },
      () => {
        applied = true;
      },
    );
    expect(applied).toBe(true);
    expect(service.health()).toMatchObject({ state: "healthy", records: 2 });
    await service.close();
  });

  it("reports an applied action whose outcome sync failed and writes a recovery marker later", async () => {
    const dataDir = await root();
    let syncs = 0;
    let failOutcome = true;
    const service = new AuditService({
      dataDir,
      bootId: "fieldd-outcome-recovery",
      hooks: {
        beforeSync: () => {
          syncs += 1;
          if (failOutcome && syncs === 2) {
            throw Object.assign(new Error("read-only filesystem"), { code: "EROFS" });
          }
        },
      },
    });
    await service.start();
    let applied = false;
    await expect(
      service.required(
        shellContext(),
        {
          action: "plugin.disable",
          target: { kind: "plugin", id: "vibefield.example" },
        },
        () => {
          applied = true;
          return { revoked: 3 };
        },
        (value) => ({ attrs: { revokedTokens: value.revoked } }),
      ),
    ).rejects.toMatchObject({
      kind: "AUDIT_UNAVAILABLE",
      details: { operation: "sync", code: "EROFS", actionApplied: true },
    });
    expect(applied).toBe(true);
    expect(service.health()).toMatchObject({
      state: "degraded",
      records: 1,
      pendingRecoveryMarkers: 1,
    });

    failOutcome = false;
    await service.appendFromCaller(shellContext(), {
      action: "support.bundle.export",
      target: { kind: "support-bundle", id: "bundle_after_recovery" },
      phase: "attempt",
      operationId: "op_after_recovery",
    });
    expect(service.health()).toMatchObject({
      state: "healthy",
      pendingRecoveryMarkers: 0,
    });
    await service.close();
    const persisted = await records(service.root);
    expect(persisted).toContainEqual(
      expect.objectContaining({
        action: "audit.outcome.recovery",
        phase: "outcome",
        outcome: "failed",
        reasonCode: "OUTCOME_DURABILITY_UNCONFIRMED",
        actor: { kind: "system", id: "fieldd" },
      }),
    );
  });

  it("detects line corruption and a close-checkpoint truncation", async () => {
    const dataDir = await root();
    const service = new AuditService({ dataDir, bootId: "fieldd-corruption-test" });
    await service.start();
    await service.appendFromCaller(shellContext(), {
      action: "support.bundle.export",
      target: { kind: "support-bundle", id: "bundle_integrity" },
      phase: "attempt",
      operationId: "op_integrity",
    });
    await service.close();
    const [path] = await auditFiles(service.root);
    expect(path).toBeDefined();

    const original = await readFile(path as string);
    const changed = Buffer.from(original);
    const marker = changed.indexOf(Buffer.from("bundle_integrity"));
    expect(marker).toBeGreaterThan(0);
    changed[marker] = "X".charCodeAt(0);
    await writeFile(path as string, changed);
    expect(await verifyAuditSegment(path as string)).toMatchObject({
      valid: false,
      reason: "broken-chain",
    });

    await writeFile(path as string, original.subarray(0, original.byteLength - 1));
    expect(await verifyAuditSegment(path as string)).toMatchObject({
      valid: false,
      reason: "partial-line",
    });

    // Prove the checkpoint itself anchors the exact closed bytes.
    await writeFile(path as string, original);
    const checkpoint = JSON.parse(await readFile(`${path}.integrity.json`, "utf8"));
    expect(checkpoint.fileSha256).toBe(createHash("sha256").update(original).digest("hex"));
    expect(await verifyAuditSegment(path as string)).toMatchObject({
      valid: true,
      checkpointed: true,
    });
  });
});
