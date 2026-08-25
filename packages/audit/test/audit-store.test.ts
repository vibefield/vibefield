import { mkdtemp, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  currentWindowsAccount,
  MULTI_USER_PRINCIPALS,
  readWindowsAcl,
} from "@vibefield/logging/testing";
import { afterEach, describe, expect, it } from "vitest";
import {
  AuditLedgerWriter,
  type AuditRecordBase,
  auditChainHash,
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
    const directorySyncs: string[] = [];
    const writer = new AuditLedgerWriter({
      dataDir,
      bootId: "fieldd-store-test",
      now: () => 1_785_000_000_000,
      hooks: {
        beforeDirectorySync: (path) => {
          directorySyncs.push(path);
        },
      },
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
    // POSIX mode bits are a no-op on Windows (WIN-D4) — `mode` is the read-only
    // attribute there, not a permission. The win32 expression of this same
    // 0600/0700 boundary is the DACL, asserted by the row below on the box that
    // has one. (Corrected 2026-08-11: this used to say "proven by the packaged
    // gate", which named a gate that asserted nothing about these paths.)
    if (process.platform !== "win32") {
      expect((await stat(auditRoot)).mode & 0o777).toBe(0o700);
      expect((await stat(path)).mode & 0o777).toBe(0o600);
    }
    const verified = await verifyAuditSegment(path);
    expect(verified).toMatchObject({
      valid: true,
      checkpointed: true,
      records: [expect.objectContaining({ action: "plugin.enable" })],
    });
    const persisted = verified.records[0]!;
    const { integrity, ...persistedBase } = persisted;
    expect(integrity?.recordHash).toBe(
      auditChainHash(persistedBase as AuditRecordBase, integrity?.previousHash ?? null),
    );
    if (process.platform !== "win32") {
      expect(directorySyncs).toEqual([auditRoot, dataDir, auditRoot, auditRoot]);
    }
  });

  // The win32 arm of the mode-bit assertion above: the audit chain is evidence,
  // and on NTFS "private" is a DACL, not a mode. `createPrivateDir` breaks
  // inheritance on the audit root and grants this account alone; the ledger
  // segment and its integrity checkpoint are private BECAUSE they inherit that.
  // Red without the createPrivateDir call site — a plain mkdir under the user
  // temp dir inherits SYSTEM, Administrators and every app-container SID.
  it.skipIf(process.platform !== "win32")(
    "grants the audit root, its ledger segment, and its checkpoint to this account alone",
    async () => {
      const dataDir = await fixture();
      const writer = new AuditLedgerWriter({
        dataDir,
        bootId: "fieldd-acl-test",
        now: () => 1_785_000_000_000,
      });
      await writer.initialize();
      await writer.append({
        v: 1,
        eventId: "audit_acl_01",
        time: 1_785_000_000_000,
        actor: { kind: "system", id: "fieldd" },
        action: "plugin.enable",
        target: { kind: "plugin", id: "vibefield.example" },
        phase: "attempt",
        operationId: "op_acl_01",
        transportProvenance: "in-process",
      });
      await writer.close();

      const auditRoot = join(dataDir, "audit");
      const entries = await readdir(auditRoot);
      const segment = entries.find((entry) => entry.endsWith(".jsonl"));
      // The checkpoint is published by rename, so its ACL also proves the
      // durableRename commit point lands inside the private root.
      const checkpoint = entries.find((entry) => entry.endsWith(".integrity.json"));
      expect(segment).toBeDefined();
      expect(checkpoint).toBeDefined();

      const account = (await currentWindowsAccount()).toLowerCase();
      for (const path of [auditRoot, join(auditRoot, segment as string)]) {
        const acl = await readWindowsAcl(path);
        expect(acl.map((ace) => ace.account.toLowerCase())).toEqual([account]);
        for (const principal of MULTI_USER_PRINCIPALS) {
          expect(acl.map((ace) => ace.account.toLowerCase())).not.toContain(
            principal.toLowerCase(),
          );
        }
      }
      const checkpointAcl = await readWindowsAcl(join(auditRoot, checkpoint as string));
      expect(checkpointAcl.map((ace) => ace.account.toLowerCase())).toEqual([account]);
      // Inheritance is broken at the root and only at the root: the files below
      // are private by inheriting its single grant.
      expect((await readWindowsAcl(auditRoot)).some((ace) => ace.inherited)).toBe(false);
      expect(
        (await readWindowsAcl(join(auditRoot, segment as string))).every((ace) => ace.inherited),
      ).toBe(true);
    },
  );

  it.skipIf(process.platform === "win32")(
    "refuses an append when its new directory entry cannot be made durable",
    async () => {
      const dataDir = await fixture();
      let auditRootSyncs = 0;
      const writer = new AuditLedgerWriter({
        dataDir,
        bootId: "fieldd-directory-sync-test",
        hooks: {
          beforeDirectorySync: (path) => {
            if (path !== join(dataDir, "audit")) return;
            auditRootSyncs += 1;
            if (auditRootSyncs === 2) {
              throw Object.assign(new Error("directory sync failed"), { code: "EIO" });
            }
          },
        },
      });
      await writer.initialize();
      await expect(
        writer.append({
          v: 1,
          eventId: "audit_dirsync_01",
          time: Date.now(),
          actor: { kind: "system", id: "fieldd" },
          action: "plugin.enable",
          target: { kind: "plugin", id: "vibefield.example" },
          phase: "attempt",
          operationId: "op_dirsync_01",
          transportProvenance: "in-process",
        }),
      ).rejects.toMatchObject({ operation: "sync", code: "EIO" });
      expect(writer.openSegments()).toBe(0);
      await writer.close();
    },
  );

  it("classifies root, segment-open, and close-checkpoint failures", async () => {
    const rootFailureDir = await fixture();
    const rootFailure = new AuditLedgerWriter({
      dataDir: rootFailureDir,
      bootId: "fieldd-root-failure-test",
      hooks: {
        beforeRoot: () => {
          throw Object.assign(new Error("audit root denied"), { code: "EACCES" });
        },
      },
    });
    await expect(rootFailure.initialize()).rejects.toMatchObject({
      operation: "root",
      code: "EACCES",
    });
    await rootFailure.close();

    const openFailureDir = await fixture();
    const openFailure = new AuditLedgerWriter({
      dataDir: openFailureDir,
      bootId: "fieldd-open-failure-test",
      hooks: {
        beforeOpen: () => {
          throw Object.assign(new Error("segment open denied"), { code: "EACCES" });
        },
      },
    });
    await openFailure.initialize();
    await expect(
      openFailure.append({
        v: 1,
        eventId: "audit_open_failure_01",
        time: Date.now(),
        actor: { kind: "system", id: "fieldd" },
        action: "plugin.enable",
        target: { kind: "plugin", id: "vibefield.example" },
        phase: "attempt",
        operationId: "op_open_failure_01",
        transportProvenance: "in-process",
      }),
    ).rejects.toMatchObject({ operation: "open", code: "EACCES" });
    expect(openFailure.openSegments()).toBe(0);
    await openFailure.close();

    const checkpointFailureDir = await fixture();
    const checkpointFailure = new AuditLedgerWriter({
      dataDir: checkpointFailureDir,
      bootId: "fieldd-checkpoint-failure-test",
      hooks: {
        beforeCheckpoint: () => {
          throw Object.assign(new Error("checkpoint denied"), { code: "EIO" });
        },
      },
    });
    await checkpointFailure.initialize();
    await checkpointFailure.append({
      v: 1,
      eventId: "audit_checkpoint_failure_01",
      time: Date.now(),
      actor: { kind: "system", id: "fieldd" },
      action: "plugin.enable",
      target: { kind: "plugin", id: "vibefield.example" },
      phase: "attempt",
      operationId: "op_checkpoint_failure_01",
      transportProvenance: "in-process",
    });
    await expect(checkpointFailure.close()).rejects.toMatchObject({
      operation: "checkpoint",
      code: "EIO",
    });
    const auditRoot = join(checkpointFailureDir, "audit");
    const segment = (await readdir(auditRoot)).find((entry) => entry.endsWith(".jsonl"));
    expect(segment).toBeDefined();
    expect(await verifyAuditSegment(join(auditRoot, segment as string))).toMatchObject({
      valid: true,
      checkpointed: false,
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

    await writeFile(checkpointPath, "{");
    expect(await verifyAuditSegment(path)).toMatchObject({
      valid: false,
      reason: "invalid-checkpoint",
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
