import { LOG_TRANSPORT_LIMITS } from "@vibefield/contracts";
import {
  type Logger,
  type NodeLogging,
  PluginLogRouter,
  type TrustedLogIngress,
} from "@vibefield/logging";
import { describe, expect, it } from "vitest";
import type {
  RendererPluginResolution,
  RendererPluginResolver,
} from "../src/main/plugin-provenance";
import { RendererLogIngress } from "../src/main/renderer-logging";

function captureLogger(events: Array<{ event: string; attrs?: unknown }>): Logger {
  const logger: Logger = {
    child: () => logger,
    trace: (event, _message, attrs) => events.push({ event, attrs }),
    debug: (event, _message, attrs) => events.push({ event, attrs }),
    info: (event, _message, attrs) => events.push({ event, attrs }),
    warn: (event, _message, attrs) => events.push({ event, attrs }),
    error: (event, _message, _error, attrs) => events.push({ event, attrs }),
    fatal: (event, _message, _error, attrs) => events.push({ event, attrs }),
    isLevelEnabled: () => true,
  };
  return logger;
}

function fakeSink(records: TrustedLogIngress[]): NodeLogging {
  return {
    logger: captureLogger([]),
    filePath: "/not-used",
    ingest: (record) => records.push(record),
    health: () => {
      throw new Error("not used");
    },
    recent: () => {
      throw new Error("not used");
    },
    setLevel: () => undefined,
    flush: () => Promise.resolve(),
    close: () => Promise.resolve(),
  };
}

function batch(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    v: 1,
    records: [
      {
        v: 1,
        time: 100,
        level: "info",
        event: "renderer.test.recorded",
        msg: "accepted",
        component: "test",
        attrs: {
          webContentsId: 999,
          rendererPid: 999,
          safe: true,
        },
        service: "fieldd",
        pid: 999,
        windowId: "claimed",
      },
    ],
    ...overrides,
  });
}

describe("Electron renderer log ingress", () => {
  it("validates then host-stamps process/window identity and observed time", () => {
    const records: TrustedLogIngress[] = [];
    const desktop: Array<{ event: string; attrs?: unknown }> = [];
    const ingress = new RendererLogIngress({
      sink: fakeSink(records),
      desktopLogger: captureLogger(desktop),
      windowId: "7",
      webContentsId: 11,
      rendererPid: () => 22,
      now: () => 200,
    });
    ingress.accept(batch());

    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({
      time: 100,
      observedTime: 200,
      event: "renderer.test.recorded",
      windowId: "7",
      pid: 22,
      attrs: {
        webContentsId: 11,
        rendererPid: 22,
        safe: true,
      },
    });
    expect(desktop).toHaveLength(0);
  });

  it("drops oversized and malformed input without echoing it into diagnostics", () => {
    const records: TrustedLogIngress[] = [];
    const desktop: Array<{ event: string; attrs?: unknown }> = [];
    const ingress = new RendererLogIngress({
      sink: fakeSink(records),
      desktopLogger: captureLogger(desktop),
      windowId: "7",
      webContentsId: 11,
      rendererPid: () => 22,
      now: () => 200,
    });
    const canary = "never-copy-this-raw-envelope";
    ingress.accept(`${canary}${"x".repeat(LOG_TRANSPORT_LIMITS.RENDERER_BATCH_BYTES)}`);
    ingress.accept("{invalid-json");
    ingress.accept(JSON.stringify({ v: 1, records: [{ raw: canary }] }));

    expect(records).toHaveLength(0);
    expect(JSON.stringify(desktop)).not.toContain(canary);
    expect(ingress.health().rejected).toMatchObject({
      oversized: 1,
      "invalid-json": 1,
      "invalid-batch": 1,
    });
    expect(desktop.map((event) => event.event)).toEqual(["desktop.renderer.log_batch_rejected"]);
  });

  it("caps compromised-renderer batches and preserves a renderer drop summary", () => {
    let now = 1_000;
    const records: TrustedLogIngress[] = [];
    const ingress = new RendererLogIngress({
      sink: fakeSink(records),
      desktopLogger: captureLogger([]),
      windowId: "7",
      webContentsId: 11,
      rendererPid: () => 22,
      now: () => now,
    });
    for (let index = 0; index < LOG_TRANSPORT_LIMITS.RENDERER_BATCHES_PER_SECOND + 1; index += 1) {
      ingress.accept(batch());
    }
    expect(ingress.health().rejected.rate).toBe(1);

    now += 1_000;
    ingress.accept(
      batch({
        records: [],
        dropped: { trace: 1, debug: 2, info: 3, warn: 0, error: 0, fatal: 0 },
      }),
    );
    expect(records.at(-1)).toMatchObject({
      event: "renderer.logging.records_dropped",
      attrs: { trace: 1, debug: 2, info: 3 },
    });
    expect(ingress.health().rendererDropped).toBe(6);
  });

  it("charges malformed envelopes before parsing so invalid JSON cannot bypass the CPU cap", () => {
    const ingress = new RendererLogIngress({
      sink: fakeSink([]),
      desktopLogger: captureLogger([]),
      windowId: "7",
      webContentsId: 11,
      rendererPid: () => 22,
      now: () => 1_000,
    });
    for (
      let index = 0;
      index < LOG_TRANSPORT_LIMITS.RENDERER_ENVELOPE_BATCHES_PER_SECOND + 5;
      index += 1
    ) {
      ingress.accept("{malformed");
    }
    expect(ingress.health().rejected).toMatchObject({
      "invalid-json": LOG_TRANSPORT_LIMITS.RENDERER_ENVELOPE_BATCHES_PER_SECOND,
      rate: 5,
    });
  });

  it("uses a bounded reserve for error batches after the normal budget is exhausted", () => {
    const records: TrustedLogIngress[] = [];
    const ingress = new RendererLogIngress({
      sink: fakeSink(records),
      desktopLogger: captureLogger([]),
      windowId: "7",
      webContentsId: 11,
      rendererPid: () => 22,
      now: () => 1_000,
    });
    expect(LOG_TRANSPORT_LIMITS.RENDERER_ENVELOPE_BATCHES_PER_SECOND).toBe(
      LOG_TRANSPORT_LIMITS.RENDERER_BATCHES_PER_SECOND +
        LOG_TRANSPORT_LIMITS.RENDERER_HIGH_SEVERITY_BATCHES_PER_SECOND,
    );

    for (let index = 0; index < LOG_TRANSPORT_LIMITS.RENDERER_BATCHES_PER_SECOND; index += 1) {
      ingress.accept(
        batch({
          records: [
            {
              v: 1,
              time: 100,
              level: "info",
              event: "renderer.test.normal",
              msg: "normal",
              component: "test",
              attrs: { index },
            },
          ],
        }),
      );
    }
    for (
      let index = 0;
      index < LOG_TRANSPORT_LIMITS.RENDERER_HIGH_SEVERITY_BATCHES_PER_SECOND;
      index += 1
    ) {
      ingress.accept(
        batch({
          records: [
            {
              v: 1,
              time: 100,
              level: "info",
              event: "renderer.test.deprioritized",
              msg: "deprioritized",
              component: "test",
            },
            {
              v: 1,
              time: 100,
              level: "error",
              event: "renderer.test.failed",
              msg: "failed",
              component: "test",
              attrs: { index },
            },
          ],
        }),
      );
    }
    ingress.accept(
      batch({
        records: [
          {
            v: 1,
            time: 100,
            level: "error",
            event: "renderer.test.excess_error",
            msg: "bounded",
            component: "test",
          },
        ],
      }),
    );

    expect(records.filter((record) => record.event === "renderer.test.normal")).toHaveLength(
      LOG_TRANSPORT_LIMITS.RENDERER_BATCHES_PER_SECOND,
    );
    expect(records.filter((record) => record.event === "renderer.test.failed")).toHaveLength(
      LOG_TRANSPORT_LIMITS.RENDERER_HIGH_SEVERITY_BATCHES_PER_SECOND,
    );
    expect(records.some((record) => record.event === "renderer.test.deprioritized")).toBe(false);
    expect(records.some((record) => record.event === "renderer.test.excess_error")).toBe(false);
    expect(records).toContainEqual(
      expect.objectContaining({
        event: "renderer.logging.records_dropped",
        attrs: expect.objectContaining({ info: 1, hostRateLimited: 1 }),
      }),
    );
    expect(ingress.health()).toMatchObject({
      acceptedBatches: LOG_TRANSPORT_LIMITS.RENDERER_ENVELOPE_BATCHES_PER_SECOND,
      acceptedHighSeverityReserveBatches:
        LOG_TRANSPORT_LIMITS.RENDERER_HIGH_SEVERITY_BATCHES_PER_SECOND,
      acceptedRecords: LOG_TRANSPORT_LIMITS.RENDERER_ENVELOPE_BATCHES_PER_SECOND,
      rendererDropped: LOG_TRANSPORT_LIMITS.RENDERER_HIGH_SEVERITY_BATCHES_PER_SECOND,
      rejected: { rate: 1 },
    });
  });

  it("routes plugin hints only after the host resolves and stamps active-install provenance", () => {
    const systemRecords: TrustedLogIngress[] = [];
    const pluginRecords: TrustedLogIngress[] = [];
    const listeners = new Set<() => void>();
    let resolution: RendererPluginResolution = { kind: "pending" };
    const resolver: RendererPluginResolver = {
      resolve: () => resolution,
      onChange(listener) {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
    };
    const pluginRouter = new PluginLogRouter({ sink: fakeSink(pluginRecords), now: () => 200 });
    const ingress = new RendererLogIngress({
      sink: fakeSink(systemRecords),
      pluginRouter,
      pluginResolver: resolver,
      desktopLogger: captureLogger([]),
      windowId: "7",
      webContentsId: 11,
      rendererPid: () => 22,
      now: () => 200,
    });
    ingress.accept(
      batch({
        records: [
          {
            v: 1,
            time: 100,
            level: "info",
            event: "forged.event",
            msg: "plugin message",
            component: "forged.component",
            pluginId: "vibefield.example.plugin",
            plugin: {
              id: "attacker",
              version: "9.9.9",
              installRevision: "forged",
              entry: "renderer",
              installSource: "peer",
              trust: "r2-peer",
            },
            attrs: { safe: true },
          },
        ],
      }),
    );
    expect(systemRecords).toHaveLength(0);
    expect(pluginRecords).toHaveLength(0);
    expect(ingress.health()).toMatchObject({ pendingPluginRecords: 1 });

    resolution = {
      kind: "resolved",
      provenance: {
        id: "vibefield.example.plugin",
        version: "1.2.3",
        installRevision: "host-revision",
        entry: "renderer",
        windowId: "7",
        installSource: "bundled",
        trust: "r0-bundled",
      },
    };
    for (const listener of listeners) listener();

    expect(ingress.health()).toMatchObject({ pendingPluginRecords: 0, pendingPluginBytes: 0 });
    expect(pluginRecords).toEqual([
      expect.objectContaining({
        time: 100,
        observedTime: 200,
        level: "info",
        event: "plugin.log",
        message: "plugin message",
        component: "plugin.renderer",
        windowId: "7",
        pid: 22,
        plugin: {
          id: "vibefield.example.plugin",
          version: "1.2.3",
          installRevision: "host-revision",
          entry: "renderer",
          windowId: "7",
          installSource: "bundled",
          trust: "r0-bundled",
        },
        attrs: { safe: true, webContentsId: 11, rendererPid: 22 },
      }),
    ]);
    expect(pluginRouter.health().activeEntries).toBe(1);
    ingress.dispose();
    expect(pluginRouter.health().activeEntries).toBe(0);
  });
});
