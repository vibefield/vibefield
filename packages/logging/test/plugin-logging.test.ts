import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { LOG_STREAMS, type PluginRecord } from "@vibefield/contracts";
import type { PluginLogProvenanceV1 } from "@vibefield/contracts/logging";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createNodeLogging,
  type Logger,
  type NodeLogging,
  PLUGIN_BUFFERS,
  PLUGIN_RETENTION,
  PluginLogRouter,
  pluginLogProvenance,
  type TrustedLogIngress,
} from "../src/index";

const roots: string[] = [];
const services = new Set<NodeLogging>();

afterEach(async () => {
  vi.useRealTimers();
  await Promise.all([...services].map((service) => service.close()));
  services.clear();
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

function provenance(overrides: Partial<PluginLogProvenanceV1> = {}): PluginLogProvenanceV1 {
  return {
    id: "vibefield.example.plugin",
    version: "1.2.3",
    installRevision: "revision-1",
    entry: "service",
    installSource: "bundled",
    trust: "r0-bundled",
    ...overrides,
  };
}

function captureSink(records: TrustedLogIngress[]): NodeLogging {
  const logger: Logger = {
    child: () => logger,
    trace() {},
    debug() {},
    info() {},
    warn() {},
    error() {},
    fatal() {},
    isLevelEnabled: () => true,
  };
  return {
    logger,
    filePath: "/not-used",
    ingest: (record) => records.push(record),
    health: () => {
      throw new Error("not used");
    },
    recent: () => {
      throw new Error("not used");
    },
    readSince: () => {
      throw new Error("not used");
    },
    subscribeUpdates: () => () => undefined,
    subscribeWriterState: () => () => undefined,
    replaceDiagnosticLeases() {},
    setLevel() {},
    flush: () => Promise.resolve(),
    close: () => Promise.resolve(),
  };
}

describe("plugin log routing", () => {
  it("pins the stricter plugin memory and disk category budgets", () => {
    expect(PLUGIN_BUFFERS).toMatchObject({
      queueRecords: 4_096,
      queueBytes: 4 * 1024 * 1024,
      ringRecords: 1_000,
      ringBytes: 1 * 1024 * 1024,
      maxRecordBytes: 16 * 1024,
    });
    expect(PLUGIN_RETENTION).toEqual({
      maxSegmentBytes: 5 * 1024 * 1024,
      maxClosedSegments: 2,
      maxAgeMs: 3 * 24 * 60 * 60 * 1_000,
      categoryCapBytes: 100 * 1024 * 1024,
    });
  });

  it("derives source/trust from the active install rather than plugin input", () => {
    const install = {
      id: "vibefield.example.plugin",
      version: "1.2.3",
      title: "Example",
      source: "dev-linked",
      manifestHash: `sha256:${"a".repeat(64)}`,
      installRevision: "revision-1",
      state: "enabled",
      compatible: true,
      enabled: true,
      requestedCapabilities: [],
      grantedCapabilities: [],
      deniedCapabilities: [],
      grantGeneration: 0,
      contributions: { widgets: [], behaviors: [], commands: [], surfaces: [], capabilities: [] },
      renderer: "active",
      service: "active",
    } satisfies PluginRecord;
    expect(pluginLogProvenance(install, "renderer", "window-7")).toEqual({
      id: "vibefield.example.plugin",
      version: "1.2.3",
      installRevision: "revision-1",
      entry: "renderer",
      windowId: "window-7",
      installSource: "dev-link",
      trust: "r3-dev",
    });
    expect(pluginLogProvenance({ ...install, enabled: false }, "renderer", "window-7")).toBeNull();
  });

  it("reserves burst capacity for warning/error and emits one host-owned drop summary", () => {
    vi.useFakeTimers();
    const records: TrustedLogIngress[] = [];
    const router = new PluginLogRouter({
      sink: captureSink(records),
      now: () => Date.now(),
      dropWindowMs: 1_000,
    });
    for (let index = 0; index < 80; index += 1) {
      expect(router.accept(provenance(), { level: "info", message: `low ${index}` })).toBe(true);
    }
    expect(router.accept(provenance(), { level: "info", message: "low overflow" })).toBe(false);
    for (let index = 0; index < 20; index += 1) {
      expect(router.accept(provenance(), { level: "error", message: `high ${index}` })).toBe(true);
    }
    expect(router.accept(provenance(), { level: "error", message: "high overflow" })).toBe(false);
    expect(records).toHaveLength(100);

    vi.advanceTimersByTime(1_000);
    expect(records.at(-1)).toMatchObject({
      level: "warn",
      event: "plugin.logging.records_dropped",
      plugin: provenance(),
      attrs: { reason: "rate", info: 1, error: 1 },
    });
    expect(router.health()).toEqual({
      accepted: 100,
      droppedRate: 2,
      rejected: 0,
      activeEntries: 1,
    });
    router.close();
  });

  it("bounds retained rate state across install revisions", () => {
    const records: TrustedLogIngress[] = [];
    const router = new PluginLogRouter({ sink: captureSink(records), now: () => 1 });
    for (let index = 0; index < 1_025; index += 1) {
      router.accept(provenance({ installRevision: `revision-${index}` }), {
        level: "info",
        message: "one record per revision",
      });
    }
    expect(router.health()).toMatchObject({
      accepted: 1_025,
      activeEntries: 1_024,
    });
    router.close();
  });

  it("enforces plugin/system category identity and the 16 KiB plugin profile", async () => {
    const root = await mkdtemp(join(tmpdir(), "vibefield-plugin-logging-"));
    roots.push(root);
    const pluginSink = await createNodeLogging({
      logRoot: root,
      stream: LOG_STREAMS.PLUGINS_RENDERER,
      service: "renderer",
      role: "renderer",
      bootId: "boot-1",
      instanceId: "boot-1",
    });
    const systemSink = await createNodeLogging({
      logRoot: root,
      stream: LOG_STREAMS.SYSTEM_RENDERER,
      service: "renderer",
      role: "renderer",
      bootId: "boot-1",
      instanceId: "boot-1",
    });
    services.add(pluginSink);
    services.add(systemSink);

    pluginSink.ingest({
      time: 1,
      level: "info",
      event: "plugin.log",
      message: "missing provenance",
      component: "plugin.renderer",
      windowId: "7",
    });
    pluginSink.ingest({
      time: 2,
      level: "info",
      event: "plugin.log",
      message: "wrong entry",
      component: "plugin.renderer",
      windowId: "7",
      plugin: provenance({ entry: "service" }),
    });
    pluginSink.ingest({
      time: 3,
      level: "info",
      event: "plugin.log",
      message: "m".repeat(20 * 1024),
      component: "plugin.renderer",
      windowId: "7",
      attrs: { payload: "x".repeat(20 * 1024) },
      plugin: provenance({ entry: "renderer", windowId: "7" }),
    });
    systemSink.ingest({
      time: 4,
      level: "info",
      event: "plugin.log",
      message: "wrong category",
      component: "plugin.renderer",
      windowId: "7",
      plugin: provenance({ entry: "renderer", windowId: "7" }),
    });
    await Promise.all([pluginSink.flush(), systemSink.flush()]);

    const pluginRaw = (await readFile(pluginSink.filePath, "utf8")).trim();
    const record = JSON.parse(pluginRaw) as Record<string, unknown>;
    expect(Buffer.byteLength(pluginRaw, "utf8")).toBeLessThanOrEqual(16 * 1024);
    expect(record).toMatchObject({
      event: "plugin.log",
      plugin: provenance({ entry: "renderer", windowId: "7" }),
      truncation: { reasons: expect.arrayContaining(["message-bytes", "string-bytes"]) },
    });
    expect(pluginSink.health().counters.rejected).toBe(2);
    expect(systemSink.health().counters.rejected).toBe(1);
    expect((await readFile(systemSink.filePath, "utf8")).trim()).toBe("");
  });
});
