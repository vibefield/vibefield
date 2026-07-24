import {
  appendFile,
  chmod,
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rm,
  stat,
  utimes,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { LOG_STREAMS, PORTS } from "@vibefield/contracts";
import { afterEach, describe, expect, it } from "vitest";
import { createNodeLogging, type NodeLogging, type NodeLoggingTestHooks } from "../src/index";

const roots: string[] = [];
const services = new Set<NodeLogging>();

afterEach(async () => {
  await Promise.all([...services].map((service) => service.close()));
  services.clear();
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function root(): Promise<string> {
  const path = await mkdtemp(join(tmpdir(), "vibefield-logging-"));
  roots.push(path);
  return path;
}

async function logging(
  logRoot: string,
  overrides: Partial<Parameters<typeof createNodeLogging>[0]> = {},
): Promise<NodeLogging> {
  const service = await createNodeLogging({
    logRoot,
    stream: LOG_STREAMS.SYSTEM_FIELDD,
    service: "fieldd",
    role: "daemon",
    bootId: "boot-test",
    instanceId: "instance-test",
    component: "test",
    ...overrides,
  });
  services.add(service);
  return service;
}

function codedError(code: string, message = code): Error & { code: string } {
  return Object.assign(new Error(message), { code });
}

async function eventually(
  predicate: () => boolean | Promise<boolean>,
  timeoutMs = 2_500,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!(await predicate())) {
    if (Date.now() >= deadline) throw new Error("condition was not reached before timeout");
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

async function fielddSegments(logRoot: string): Promise<string[]> {
  return (await readdir(join(logRoot, "system")))
    .filter((name) => name.startsWith("fieldd") && name.endsWith(".ndjson"))
    .sort();
}

describe("node logging writer lifecycle", () => {
  it("writes schema-valid NDJSON with private directory and file permissions", async () => {
    const logRoot = await root();
    const service = await logging(logRoot);
    service.logger.info("fieldd.test.started", "fieldd started", {
      port: PORTS.FIELDD_WS_CONTROL,
    });
    await service.flush();

    const lines = (await readFile(service.filePath, "utf8")).trim().split("\n");
    expect(lines).toHaveLength(1);
    expect(JSON.parse(lines[0]!)).toMatchObject({
      event: "fieldd.test.started",
      service: "fieldd",
      component: "test",
      attrs: { port: PORTS.FIELDD_WS_CONTROL },
    });
    expect((await stat(logRoot)).mode & 0o777).toBe(0o700);
    expect((await stat(join(logRoot, "system"))).mode & 0o777).toBe(0o700);
    expect((await stat(service.filePath)).mode & 0o777).toBe(0o600);
    await service.close();
  });

  it("host-stamps forwarded records while preserving bounded origin and observation time", async () => {
    const logRoot = await root();
    const service = await logging(logRoot, {
      service: "renderer",
      role: "renderer",
      stream: LOG_STREAMS.SYSTEM_RENDERER,
      pid: 101,
      now: () => 200,
    });
    service.ingest({
      time: 100,
      observedTime: 200,
      level: "error",
      event: "renderer.test.forwarded",
      message: "forwarded",
      component: "test.forwarded",
      pid: 202,
      windowId: "window-7",
      bindings: { operationId: "operation-1" },
      error: {
        type: "RendererError",
        message: "render failed",
        stack: "at <home>/renderer.js:1",
      },
      attrs: {
        token: "abcdefghijklmnopqrstuvwxyz123456",
        webContentsId: 7,
      },
      truncation: {
        reasons: ["partial-line"],
        originalBytes: 70_000,
        droppedBytes: 4_464,
      },
    });
    await service.flush();

    const record = JSON.parse((await readFile(service.filePath, "utf8")).trim());
    expect(record).toMatchObject({
      time: 100,
      observedTime: 200,
      service: "renderer",
      role: "renderer",
      pid: 202,
      bootId: "boot-test",
      instanceId: "instance-test",
      seq: 1,
      windowId: "window-7",
      operationId: "operation-1",
      component: "test.forwarded",
      err: { type: "RendererError", message: "render failed" },
      attrs: {
        token: "[redacted]",
        webContentsId: 7,
      },
      truncation: {
        reasons: ["partial-line"],
        originalBytes: 70_000,
        droppedBytes: 4_464,
      },
    });
  });

  it("rotates on size and on a UTC day boundary", async () => {
    const logRoot = await root();
    let now = Date.UTC(2026, 6, 22, 23, 59, 59);
    const service = await logging(logRoot, {
      now: () => now,
      retention: { maxSegmentBytes: 700 },
    });
    for (let index = 0; index < 8; index += 1) {
      service.logger.info(
        "fieldd.test.chunk_written",
        `before midnight ${index} ${"x".repeat(220)}`,
      );
    }
    await service.flush();
    const sizeRotations = service.health().counters.rotations;
    expect(sizeRotations).toBeGreaterThan(0);

    now = Date.UTC(2026, 6, 23, 0, 0, 1);
    service.logger.info("fieldd.test.day_changed", "after midnight");
    await service.flush();
    expect(service.health().counters.rotations).toBeGreaterThan(sizeRotations);
    expect((await fielddSegments(logRoot)).some((name) => name.includes(".utc-day.ndjson"))).toBe(
      true,
    );
    await service.close();
  });

  it("enforces closed-segment count while preserving the active file", async () => {
    const logRoot = await root();
    const service = await logging(logRoot, {
      retention: { maxSegmentBytes: 600, maxClosedSegments: 2 },
    });
    for (let index = 0; index < 20; index += 1) {
      service.logger.info("fieldd.test.segment_filled", `${index}:${"x".repeat(260)}`);
    }
    await service.flush();

    const names = await fielddSegments(logRoot);
    expect(names.filter((name) => name !== "fieldd.ndjson")).toHaveLength(2);
    expect(names).toContain("fieldd.ndjson");
    expect(service.health().counters.cleanupDeletions).toBeGreaterThan(0);
    await service.close();
  });

  it("removes expired segments by age", async () => {
    const logRoot = await root();
    let now = Date.now();
    const service = await logging(logRoot, {
      now: () => now,
      retention: { maxSegmentBytes: 650, maxAgeMs: 1_000, maxClosedSegments: 20 },
    });
    for (let index = 0; index < 5; index += 1) {
      service.logger.info("fieldd.test.segment_filled", `${index}:${"x".repeat(280)}`);
    }
    await service.flush();
    const old = (await fielddSegments(logRoot)).filter((name) => name !== "fieldd.ndjson");
    expect(old.length).toBeGreaterThan(0);
    const oldDate = new Date(now - 10_000);
    await Promise.all(old.map((name) => utimes(join(logRoot, "system", name), oldDate, oldDate)));

    now += 24 * 60 * 60 * 1_000;
    service.logger.info("fieldd.test.day_changed", "trigger cleanup");
    await service.flush();
    const remaining = await fielddSegments(logRoot);
    expect(old.some((name) => remaining.includes(name))).toBe(false);
    await service.close();
  });

  it("enforces a category cap without deleting active files", async () => {
    const logRoot = await root();
    const systemDir = join(logRoot, "system");
    await mkdir(systemDir, { recursive: true });
    const desktopActive = join(systemDir, "desktop.ndjson");
    const desktopClosed = join(
      systemDir,
      "desktop.20200101T000000000Z.desktop-boot.0001.size.ndjson",
    );
    await writeFile(desktopActive, "a".repeat(500));
    await writeFile(desktopClosed, "b".repeat(500));
    const oldDate = new Date("2020-01-01T00:00:00.000Z");
    await utimes(desktopClosed, oldDate, oldDate);

    const service = await logging(logRoot, {
      retention: {
        maxSegmentBytes: 550,
        maxClosedSegments: 20,
        categoryCapBytes: 1_100,
      },
    });
    for (let index = 0; index < 4; index += 1) {
      service.logger.info("fieldd.test.segment_filled", `${index}:${"x".repeat(280)}`);
    }
    await service.flush();

    expect(await readFile(desktopActive, "utf8")).toHaveLength(500);
    await expect(stat(desktopClosed)).rejects.toMatchObject({ code: "ENOENT" });
    expect(await stat(service.filePath)).toBeDefined();
    await service.close();
  });

  it("appends across clean restarts and rolls a partial active line before recovery", async () => {
    const logRoot = await root();
    const first = await logging(logRoot, { bootId: "boot-one" });
    first.logger.info("fieldd.test.first_boot", "first");
    await first.close();

    const second = await logging(logRoot, { bootId: "boot-two" });
    second.logger.info("fieldd.test.second_boot", "second");
    await second.close();
    expect((await readFile(second.filePath, "utf8")).trim().split("\n")).toHaveLength(2);

    await appendFile(second.filePath, '{"partial":');
    const third = await logging(logRoot, { bootId: "boot-three" });
    third.logger.info("fieldd.test.recovered", "recovered");
    await third.close();

    const active = (await readFile(third.filePath, "utf8")).trim().split("\n");
    expect(active).toHaveLength(1);
    expect(JSON.parse(active[0]!)).toMatchObject({ event: "fieldd.test.recovered" });
    expect(
      (await fielddSegments(logRoot)).some((name) => name.includes(".partial-recovery.ndjson")),
    ).toBe(true);
  });

  it("never overwrites a closed segment when boot identity and clock repeat", async () => {
    const logRoot = await root();
    const now = Date.UTC(2026, 6, 23, 12, 0, 0);
    const first = await logging(logRoot, {
      bootId: "repeated-boot",
      now: () => now,
      retention: { maxSegmentBytes: 500, maxClosedSegments: 10 },
    });
    first.logger.info("fieldd.test.first", `${"a".repeat(260)}`);
    first.logger.info("fieldd.test.second", `${"b".repeat(260)}`);
    await first.close();
    const originalClosed = (await fielddSegments(logRoot)).find((name) => name !== "fieldd.ndjson");
    if (originalClosed === undefined) throw new Error("expected the first closed segment");
    const original = await readFile(join(logRoot, "system", originalClosed), "utf8");

    const second = await logging(logRoot, {
      bootId: "repeated-boot",
      now: () => now,
      retention: { maxSegmentBytes: 500, maxClosedSegments: 10 },
    });
    second.logger.info("fieldd.test.third", `${"c".repeat(260)}`);
    await second.close();
    const closed = (await fielddSegments(logRoot)).filter((name) => name !== "fieldd.ndjson");
    expect(closed).toHaveLength(2);
    expect(await readFile(join(logRoot, "system", originalClosed), "utf8")).toBe(original);
  });

  it("serializes high-volume concurrent callers through one writer", async () => {
    const logRoot = await root();
    const service = await logging(logRoot);
    await Promise.all(
      Array.from({ length: 2_000 }, async (_, index) => {
        service.logger.info("fieldd.test.concurrent", "record", { index });
      }),
    );
    await service.close();

    const lines = (await readFile(service.filePath, "utf8")).trim().split("\n");
    expect(lines).toHaveLength(2_000);
    expect(service.health().counters.accepted).toBe(2_000);
    expect(service.health().writerState).toBe("closed");
  });

  it("performs a bounded fatal-path drain before close", async () => {
    const logRoot = await root();
    const service = await logging(logRoot);
    service.logger.fatal("fieldd.test.fatal", "fieldd cannot continue", new Error("fatal cause"));
    const started = Date.now();
    await service.close();

    expect(Date.now() - started).toBeLessThan(2_500);
    const lines = (await readFile(service.filePath, "utf8")).trim().split("\n");
    expect(JSON.parse(lines.at(-1)!)).toMatchObject({
      event: "fieldd.test.fatal",
      level: 60,
      severity: "FATAL",
      err: { message: "fatal cause" },
    });
  });

  it("detects a live writer conflict without corrupting the first writer", async () => {
    const logRoot = await root();
    const first = await logging(logRoot, { bootId: "writer-one" });
    const emergencies: string[] = [];
    const second = await logging(logRoot, {
      bootId: "writer-two",
      emergency: (message) => emergencies.push(message),
    });

    expect(second.health().writerState).toBe("writer-conflict");
    expect(second.health().lastFailure?.kind).toBe("writer-conflict");
    expect(emergencies).toHaveLength(1);
    first.logger.info("fieldd.test.writer_alive", "first writer remains live");
    await first.flush();
    await second.close();
    await first.close();
  });

  it("admits exactly one writer under concurrent lock acquisition", async () => {
    const logRoot = await root();
    const contenders = await Promise.all(
      Array.from({ length: 8 }, (_, index) =>
        logging(logRoot, {
          bootId: `writer-${index}`,
          emergency: () => undefined,
        }),
      ),
    );
    expect(contenders.filter((service) => service.health().writerState === "healthy")).toHaveLength(
      1,
    );
    expect(
      contenders.filter((service) => service.health().writerState === "writer-conflict"),
    ).toHaveLength(7);
  });

  it.each([
    ["EACCES", "eacces"],
    ["EROFS", "read-only"],
  ] as const)("classifies %s open failures and recovers with bounded retry", async (code, kind) => {
    const logRoot = await root();
    let fail = true;
    const emergencies: string[] = [];
    const service = await logging(logRoot, {
      emergency: (message) => emergencies.push(message),
      testHooks: {
        beforeOpen() {
          if (fail) throw codedError(code);
        },
      },
    });
    expect(service.health().lastFailure?.kind).toBe(kind);
    fail = false;
    await eventually(() => service.health().writerState === "healthy");
    expect(emergencies).toHaveLength(1);
    await service.close();
  });

  it("reports ENOSPC once, retains queued records, and recovers", async () => {
    const logRoot = await root();
    let fail = false;
    const emergencies: string[] = [];
    const hooks: NodeLoggingTestHooks = {
      beforeWrite() {
        if (fail) throw codedError("ENOSPC");
      },
    };
    const service = await logging(logRoot, {
      emergency: (message) => emergencies.push(message),
      testHooks: hooks,
    });
    fail = true;
    service.logger.error("fieldd.test.write_failed", "important record");
    await eventually(() => service.health().lastFailure?.kind === "enospc");
    expect(service.health().queue.records).toBe(1);
    expect(emergencies).toHaveLength(1);

    fail = false;
    await eventually(() => service.health().writerState === "healthy");
    await service.flush();
    expect(service.health().queue.records).toBe(0);
    expect(service.health().counters.bytesWritten).toBeGreaterThan(0);
    await service.close();
  });

  it("uses one emergency fallback across persistent write retries", async () => {
    const logRoot = await root();
    let fail = true;
    const emergencies: string[] = [];
    const service = await logging(logRoot, {
      emergency: (message) => emergencies.push(message),
      testHooks: {
        beforeWrite() {
          if (fail) throw codedError("ENOSPC");
        },
      },
    });
    service.logger.error("fieldd.test.write_failed", "important record");
    await eventually(() => service.health().lastFailure?.kind === "enospc");
    await new Promise((resolve) => setTimeout(resolve, 850));
    expect(emergencies).toHaveLength(1);
    expect(service.health().writerState).toBe("degraded");

    fail = false;
    await eventually(() => service.health().writerState === "healthy");
    await service.close();
  });

  it("classifies rename, flush, and close failures", async () => {
    const renameRoot = await root();
    let failRename = true;
    const renameService = await logging(renameRoot, {
      retention: { maxSegmentBytes: 500 },
      emergency: () => undefined,
      testHooks: {
        beforeRename() {
          if (failRename) throw new Error("rename fault");
        },
      },
    });
    renameService.logger.info("fieldd.test.rotate", `${"a".repeat(260)}`);
    renameService.logger.info("fieldd.test.rotate", `${"b".repeat(260)}`);
    await eventually(() => renameService.health().lastFailure?.kind === "rename");
    failRename = false;
    await eventually(() => renameService.health().writerState === "healthy");
    await renameService.close();

    const flushRoot = await root();
    let failFlush = true;
    const flushService = await logging(flushRoot, {
      emergency: () => undefined,
      testHooks: {
        beforeFlush() {
          if (failFlush) throw new Error("flush fault");
        },
      },
    });
    await expect(flushService.flush()).rejects.toThrow("log writer flush failed");
    expect(flushService.health().lastFailure?.kind).toBe("flush");
    failFlush = false;
    await flushService.close();

    const closeRoot = await root();
    const closeService = await logging(closeRoot, {
      emergency: () => undefined,
      testHooks: {
        beforeClose() {
          throw new Error("close fault");
        },
      },
    });
    await closeService.close();
    expect(closeService.health().lastFailure?.kind).toBe("close");
    expect(closeService.health().writerState).toBe("closed");
  });

  it("bounds queue memory and reserves capacity for high-severity records", async () => {
    const logRoot = await root();
    let fail = false;
    const service = await logging(logRoot, {
      buffers: {
        queueRecords: 20,
        queueBytes: 32 * 1024,
        reservedRecords: 4,
        reservedBytes: 4 * 1024,
        maxRecordBytes: 4 * 1024,
      },
      testHooks: {
        beforeWrite() {
          if (fail) throw codedError("ENOSPC");
        },
      },
      emergency: () => undefined,
    });
    fail = true;
    for (let index = 0; index < 100; index += 1) {
      service.logger.info("fieldd.test.pressure", "low priority", { index });
    }
    for (let index = 0; index < 4; index += 1) {
      service.logger.error("fieldd.test.pressure", "high priority", undefined, { index });
    }
    const pressure = service.health();
    expect(pressure.queue.records).toBeLessThanOrEqual(20);
    expect(pressure.queue.bytes).toBeLessThanOrEqual(32 * 1024);
    expect(pressure.counters.droppedInfo).toBeGreaterThan(0);
    expect(pressure.counters.accepted).toBeGreaterThanOrEqual(20);

    fail = false;
    await service.flush();
    await service.close();
  });

  it("keeps a bounded recent-record ring with monotonic cursors", async () => {
    const logRoot = await root();
    const service = await logging(logRoot, {
      buffers: { ringRecords: 2, ringBytes: 16 * 1024 },
    });
    for (let index = 1; index <= 3; index += 1) {
      service.logger.info("fieldd.test.recent", `record ${index}`, { index });
    }
    const recent = service.recent();
    expect(recent.records.map((entry) => entry.attrs?.["index"])).toEqual([2, 3]);
    expect(recent.oldestCursor).toBe(2);
    expect(recent.newestCursor).toBe(3);
    expect(recent.droppedBefore).toBe(1);
    await service.close();
  });

  it("streams predicate-aware deltas without skipping filtered or backlogged records", async () => {
    const logRoot = await root();
    const service = await logging(logRoot, {
      buffers: { ringRecords: 4, ringBytes: 16 * 1024 },
    });
    let updates = 0;
    const unsubscribe = service.subscribeUpdates(() => {
      updates += 1;
    });
    for (let index = 1; index <= 4; index += 1) {
      service.logger.info("fieldd.test.delta", `record ${index}`, { index });
    }

    const first = service.readSince(0, 1, (record) => Number(record.attrs?.["index"]) % 2 === 0);
    expect(first.records.map((record) => record.attrs?.["index"])).toEqual([2]);
    expect(first.cursor).toBe(2);
    expect(first.hasMore).toBe(true);

    const second = service.readSince(
      first.cursor,
      1,
      (record) => Number(record.attrs?.["index"]) % 2 === 0,
    );
    expect(second.records.map((record) => record.attrs?.["index"])).toEqual([4]);
    expect(second.cursor).toBe(4);
    expect(second.hasMore).toBe(false);
    expect(updates).toBe(4);
    unsubscribe();
  });

  it("enforces component diagnostic leases at the producer and expires them", async () => {
    const logRoot = await root();
    let now = 1_000;
    const service = await logging(logRoot, { now: () => now });
    const target = service.logger.child({ component: "docs.fold" });
    const other = service.logger.child({ component: "mesh.reconcile" });

    target.debug("fieldd.test.before_lease", "not admitted");
    service.replaceDiagnosticLeases([
      {
        v: 1,
        leaseId: "lease-1",
        selector: { kind: "component", service: "fieldd", component: "docs.fold" },
        level: "debug",
        createdAt: now,
        expiresAt: 2_000,
        createdBy: { kind: "shell-main", id: "test" },
      },
    ]);
    expect(target.isLevelEnabled("debug")).toBe(true);
    expect(other.isLevelEnabled("debug")).toBe(false);
    target.debug("fieldd.test.during_lease", "admitted");
    other.debug("fieldd.test.wrong_component", "not admitted");
    expect(service.health().activeLeaseCount).toBe(1);

    now = 2_001;
    expect(target.isLevelEnabled("debug")).toBe(false);
    target.debug("fieldd.test.after_lease", "not admitted");
    expect(service.health().activeLeaseCount).toBe(0);
    expect(service.recent().records.map((record) => record.event)).toEqual([
      "fieldd.test.during_lease",
    ]);
  });

  it("does not follow an unsafe active-file symlink", async () => {
    if (process.platform === "win32") return;
    const logRoot = await root();
    const systemDir = join(logRoot, "system");
    const target = join(logRoot, "outside");
    await mkdir(systemDir, { recursive: true });
    await writeFile(target, "do not touch");
    const { symlink } = await import("node:fs/promises");
    await symlink(target, join(systemDir, "fieldd.ndjson"));
    const service = await logging(logRoot, { emergency: () => undefined });
    expect(service.health().writerState).toBe("degraded");
    expect(await readFile(target, "utf8")).toBe("do not touch");
    await service.close();
    await chmod(target, 0o600);
  });

  it("does not follow an unsafe log-root symlink", async () => {
    if (process.platform === "win32") return;
    const container = await root();
    const target = join(container, "target");
    const link = join(container, "linked-root");
    await mkdir(target);
    const { symlink } = await import("node:fs/promises");
    await symlink(target, link);

    const service = await logging(link, { emergency: () => undefined });
    expect(service.health().writerState).toBe("degraded");
    await expect(stat(join(target, "system"))).rejects.toMatchObject({ code: "ENOENT" });
    await service.close();
  });
});
