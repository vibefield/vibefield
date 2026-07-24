import { mkdtemp, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  AuditLedgerWriter,
  cleanAuditTarget,
  sanitizeAuditAttrs,
  verifyAuditSegment,
} from "../src/index";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function fixture(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "vibefield-audit-store-"));
  roots.push(root);
  return root;
}

describe("@vibefield/audit storage", () => {
  it("writes a private, chained, close-checkpointed segment", async () => {
    const dataDir = await fixture();
    const writer = new AuditLedgerWriter({
      dataDir,
      bootId: "fieldd-store-test",
      now: () => 1_785_000_000_000,
    });
    await writer.initialize();
    await writer.append({
      v: 1,
      eventId: "audit_store_01",
      time: 1_785_000_000_000,
      actor: { kind: "system", id: "fieldd" },
      action: "plugin.enable",
      target: { kind: "plugin", id: "vibefield.example" },
      phase: "attempt",
      operationId: "op_store_01",
      transportProvenance: "in-process",
    });
    await writer.close();

    const auditRoot = join(dataDir, "audit");
    const name = (await readdir(auditRoot)).find((entry) => entry.endsWith(".jsonl"));
    expect(name).toBeDefined();
    const path = join(auditRoot, name as string);
    expect((await stat(auditRoot)).mode & 0o777).toBe(0o700);
    expect((await stat(path)).mode & 0o777).toBe(0o600);
    expect(await verifyAuditSegment(path)).toMatchObject({
      valid: true,
      checkpointed: true,
      records: [expect.objectContaining({ action: "plugin.enable" })],
    });
  });

  it("bounds and redacts attributes while refusing credential-shaped target ids", () => {
    const rawToken = `tok_${"a".repeat(48)}`;
    let getterCalled = false;
    const hostile = Object.create(null) as Record<string, unknown>;
    Object.defineProperty(hostile, "secretGetter", {
      enumerable: true,
      get() {
        getterCalled = true;
        return rawToken;
      },
    });
    const attrs = sanitizeAuditAttrs(
      {
        token: rawToken,
        note: `received ${rawToken}`,
        url: "https://alice:password@example.test/private?q=secret",
        nested: { privateKey: "must disappear", safe: true },
        hostile,
      },
      undefined,
    );
    expect(getterCalled).toBe(false);
    expect(attrs).not.toHaveProperty("token");
    expect(JSON.stringify(attrs)).not.toContain(rawToken);
    expect(JSON.stringify(attrs)).not.toContain("/private");
    expect(() => cleanAuditTarget({ kind: "token", id: rawToken })).toThrow(/credential-like/);
  });

  it("detects a truncated final line without editing the evidence", async () => {
    const dataDir = await fixture();
    const writer = new AuditLedgerWriter({ dataDir, bootId: "fieldd-partial-test" });
    await writer.initialize();
    await writer.append({
      v: 1,
      eventId: "audit_partial_01",
      time: Date.now(),
      actor: { kind: "system", id: "fieldd" },
      action: "token.shell.mint",
      target: { kind: "token", id: "tk_0123456789ab" },
      phase: "attempt",
      operationId: "op_partial_01",
      transportProvenance: "in-process",
    });
    await writer.close();
    const auditRoot = join(dataDir, "audit");
    const name = (await readdir(auditRoot)).find((entry) => entry.endsWith(".jsonl"));
    const path = join(auditRoot, name as string);
    const original = await readFile(path);
    await writeFile(path, original.subarray(0, original.byteLength - 1));
    expect(await verifyAuditSegment(path)).toMatchObject({
      valid: false,
      reason: "partial-line",
    });
  });

  it("detects record-chain tampering, checkpoint tampering, and scan-cap exhaustion", async () => {
    const dataDir = await fixture();
    const writer = new AuditLedgerWriter({ dataDir, bootId: "fieldd-corruption-test" });
    await writer.initialize();
    await writer.append({
      v: 1,
      eventId: "audit_corrupt_01",
      time: Date.now(),
      actor: { kind: "system", id: "fieldd" },
      action: "plugin.enable",
      target: { kind: "plugin", id: "vibefield.example" },
      phase: "attempt",
      operationId: "op_corrupt_01",
      transportProvenance: "in-process",
    });
    await writer.close();
    const auditRoot = join(dataDir, "audit");
    const name = (await readdir(auditRoot)).find((entry) => entry.endsWith(".jsonl"));
    const path = join(auditRoot, name as string);

    expect(await verifyAuditSegment(path, 1)).toMatchObject({
      valid: false,
      reason: "scan-cap",
    });
    const checkpointPath = `${path}.integrity.json`;
    const checkpoint = JSON.parse(await readFile(checkpointPath, "utf8")) as Record<
      string,
      unknown
    >;
    await writeFile(checkpointPath, `${JSON.stringify({ ...checkpoint, records: 99 })}\n`);
    expect(await verifyAuditSegment(path)).toMatchObject({
      valid: false,
      reason: "checkpoint-mismatch",
    });

    await writeFile(checkpointPath, `${JSON.stringify(checkpoint)}\n`);
    const line = JSON.parse((await readFile(path, "utf8")).trim()) as Record<string, unknown>;
    await writeFile(path, `${JSON.stringify({ ...line, action: "plugin.disable" })}\n`);
    expect(await verifyAuditSegment(path)).toMatchObject({
      valid: false,
      reason: "broken-chain",
    });
  });
});
