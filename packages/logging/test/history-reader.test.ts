import { appendFile, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { LOG_STREAMS } from "@vibefield/contracts";
import { afterEach, describe, expect, it } from "vitest";
import { createNodeLogging, type NodeLogging, readLogHistory } from "../src/index";

const roots: string[] = [];
const services = new Set<NodeLogging>();

afterEach(async () => {
  await Promise.all([...services].map((service) => service.close()));
  services.clear();
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function root(): Promise<string> {
  const path = await mkdtemp(join(tmpdir(), "vibefield-history-"));
  roots.push(path);
  return path;
}

async function fieldd(logRoot: string): Promise<NodeLogging> {
  const service = await createNodeLogging({
    logRoot,
    stream: LOG_STREAMS.SYSTEM_FIELDD,
    service: "fieldd",
    role: "daemon",
    bootId: "history-boot",
    instanceId: "history-instance",
    component: "history",
    retention: { maxSegmentBytes: 700, maxClosedSegments: 6 },
  });
  services.add(service);
  return service;
}

describe("bounded historical diagnostics reader", () => {
  it("reads active and rotated segments incrementally and returns the newest bounded page", async () => {
    const logRoot = await root();
    const service = await fieldd(logRoot);
    for (let index = 1; index <= 8; index += 1) {
      service.logger.info("fieldd.history.recorded", `${index}:${"x".repeat(220)}`, { index });
    }
    await service.flush();

    const page = await readLogHistory({
      logRoot,
      query: {
        sources: [LOG_STREAMS.SYSTEM_FIELDD],
        components: ["history"],
        text: "fieldd.history.recorded",
        limit: 3,
      },
    });
    expect(page.records.map((record) => record.attrs?.["index"])).toEqual([6, 7, 8]);
    expect(page.scannedSegments).toBeGreaterThan(0);
    expect(page.scannedBytes).toBeGreaterThan(0);
    expect(page.failures).toEqual([]);
  });

  it("reports corrupt, oversized, and partial-final lines without returning their bodies", async () => {
    const logRoot = await root();
    const service = await fieldd(logRoot);
    service.logger.info("fieldd.history.valid", "valid");
    const valid = service.recent().records[0];
    if (valid === undefined) throw new Error("expected the valid record in the live ring");
    const mismatched = {
      ...valid,
      service: "desktop",
      role: "main",
      event: "desktop.history.misfiled",
    };
    await service.close();
    services.delete(service);
    await appendFile(
      service.filePath,
      `${JSON.stringify(mismatched)}\nnot-json\n${"x".repeat(70 * 1024)}\n{"v":1,"partial":`,
    );

    const page = await readLogHistory({
      logRoot,
      query: { sources: [LOG_STREAMS.SYSTEM_FIELDD], limit: 10 },
    });
    expect(page.records.map((record) => record.event)).toEqual(["fieldd.history.valid"]);
    expect(page.failures.map((failure) => failure.reason)).toEqual([
      "invalid-record",
      "invalid-json",
      "oversized-record",
      "partial-line",
    ]);
  });

  it("never follows a matching segment symlink", async () => {
    if (process.platform === "win32") return;
    const logRoot = await root();
    const systemDir = join(logRoot, "system");
    await mkdir(systemDir, { recursive: true });
    const outside = join(logRoot, "outside.ndjson");
    await writeFile(outside, '{"secret":"must-not-be-read"}\n');
    await symlink(outside, join(systemDir, "renderer.ndjson"));

    const page = await readLogHistory({
      logRoot,
      query: { sources: [LOG_STREAMS.SYSTEM_RENDERER], limit: 10 },
    });
    expect(page.records).toEqual([]);
    expect(page.scannedBytes).toBe(0);
    expect(page.skippedUnsafeSegments).toBe(1);
    expect(await readFile(outside, "utf8")).toContain("must-not-be-read");
  });

  it("honors one scan-byte budget across all selected streams", async () => {
    const logRoot = await root();
    const service = await fieldd(logRoot);
    service.logger.info("fieldd.history.large", "x".repeat(10_000));
    await service.flush();

    const page = await readLogHistory({
      logRoot,
      query: { sources: [LOG_STREAMS.SYSTEM_FIELDD], limit: 10 },
      maxScanBytes: 128,
    });
    expect(page.scannedBytes).toBe(128);
    expect(page.truncated).toBe(true);
    expect(page.records).toEqual([]);
    expect(page.failures.map((failure) => failure.reason)).toContain("partial-line");
  });
});
