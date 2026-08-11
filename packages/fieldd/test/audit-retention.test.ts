import { mkdtemp, readdir, readFile, rm, stat, utimes } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { LOG_STREAMS } from "@vibefield/contracts";
import { createNodeLogging } from "@vibefield/logging";
import { afterEach, describe, expect, it } from "vitest";
import { AuditService, verifyAuditSegment } from "../src/audit-service";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("audit retention independence", () => {
  it("keeps old audit evidence byte-for-byte while diagnostic janitors rotate and delete", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "vf-audit-retention-"));
    roots.push(dataDir);
    const audit = new AuditService({ dataDir, bootId: "retention-test" });
    await audit.start();
    await audit.requiredSystem(
      {
        action: "plugin.enable",
        target: { kind: "plugin", id: "vibefield.retention.fixture" },
      },
      () => true,
    );
    await audit.close();

    const auditRoot = join(dataDir, "audit");
    const auditName = (await readdir(auditRoot)).find((name) => name.endsWith(".jsonl"));
    expect(auditName).toBeDefined();
    const auditPath = join(auditRoot, auditName as string);
    const checkpointPath = `${auditPath}.integrity.json`;
    const before = await readFile(auditPath);
    const checkpointBefore = await readFile(checkpointPath);
    const old = new Date("2020-01-01T00:00:00.000Z");
    await utimes(auditPath, old, old);
    await utimes(checkpointPath, old, old);

    const logging = await createNodeLogging({
      logRoot: join(dataDir, "logs"),
      stream: LOG_STREAMS.SYSTEM_FIELDD,
      service: "fieldd",
      role: "daemon",
      bootId: "retention-test",
      instanceId: "retention-test",
      component: "retention.test",
      retention: {
        maxSegmentBytes: 600,
        maxClosedSegments: 1,
        maxAgeMs: 1,
        categoryCapBytes: 1_200,
      },
      emergency: () => undefined,
    });
    for (let index = 0; index < 20; index += 1) {
      logging.logger.info("fieldd.retention.segment_filled", `${index}:${"x".repeat(260)}`);
    }
    await logging.flush();
    expect(logging.health().counters.cleanupDeletions).toBeGreaterThan(0);
    await logging.close();

    expect(await readFile(auditPath)).toEqual(before);
    expect(await readFile(checkpointPath)).toEqual(checkpointBefore);
    // POSIX mode bits are a no-op on Windows (WIN-D4); the 0600/0700 boundary is an ACL there, proven by the packaged gate.
    if (process.platform !== "win32") {
      expect((await stat(auditPath)).mode & 0o777).toBe(0o600);
    }
    expect(await verifyAuditSegment(auditPath)).toMatchObject({
      valid: true,
      checkpointed: true,
      records: expect.arrayContaining([
        expect.objectContaining({ action: "plugin.enable", outcome: "succeeded" }),
      ]),
    });
  });
});
