import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { CanvasEngine, WidgetType } from "@vibecook/ice";
import type { PluginRecord, PluginRegistrySnapshot } from "@vibefield/contracts";
import { buildPlugin } from "@vibefield/plugin-build/build";
import type { PluginRegistry } from "@vibefield/plugin-runtime";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createHarness, type Harness, installDom } from "../src/boot";

type FieldEngineModule = typeof import("../../../packages/field-app/src/field-engine");
type StagedLoaderModule =
  typeof import("../../../packages/field-app/src/plugin-host/staged-loader");
type BehaviorHostModule =
  typeof import("../../../packages/field-app/src/plugin-host/behavior-generation-host");
type LoggingModule = typeof import("../../../packages/field-app/src/logging");
type FielddModule = typeof import("../../../packages/fieldd/src/plugin-registry");
type RendererLogger = import("../../../packages/field-app/src/logging").RendererLogger;
type RendererLoggerBindings =
  import("../../../packages/field-app/src/logging").RendererLoggerBindings;

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, "..", "..", "..");
const PLUGIN_ID = "vibefield.behavior-conformance";
const WIDGET_TYPE = `${PLUGIN_ID}.card`;
const DURABLE_ID = `${PLUGIN_ID}:durable`;
const RUNTIME_ID = `${PLUGIN_ID}:runtime`;
const BREAKER_ID = `${PLUGIN_ID}:breaker`;
const PLUGIN_ROOT = join(REPO, "examples", "plugins", "behavior-conformance");
const ARTIFACT = join(PLUGIN_ROOT, "dist", "renderer.js");
const V1_AUTHOR = join(PLUGIN_ROOT, "test", "author-v1.mjs");
const ICE_MODULE = createRequire(import.meta.url).resolve("@vibecook/ice");

interface CapturedLog {
  readonly level: string;
  readonly event: string;
  readonly message: string;
  readonly bindings: RendererLoggerBindings;
  readonly error?: unknown;
  readonly attrs?: Readonly<Record<string, unknown>>;
}

function recordingLogger(
  records: CapturedLog[],
  bindings: RendererLoggerBindings = {},
): RendererLogger {
  const plain =
    (level: string) =>
    (event: string, message: string, attrs?: Readonly<Record<string, unknown>>): void => {
      records.push({ level, event, message, bindings, ...(attrs === undefined ? {} : { attrs }) });
    };
  const withError =
    (level: string) =>
    (
      event: string,
      message: string,
      error?: unknown,
      attrs?: Readonly<Record<string, unknown>>,
    ): void => {
      records.push({
        level,
        event,
        message,
        bindings,
        ...(error === undefined ? {} : { error }),
        ...(attrs === undefined ? {} : { attrs }),
      });
    };
  return {
    child: (child) => recordingLogger(records, { ...bindings, ...child }),
    trace: plain("trace"),
    debug: plain("debug"),
    info: plain("info"),
    warn: plain("warn"),
    error: withError("error"),
    fatal: withError("fatal"),
    isLevelEnabled: () => true,
  };
}

function snapshot(generation: number, record: PluginRecord): PluginRegistrySnapshot {
  return { generation, plugins: [record], problems: [] };
}

function withGrant(record: PluginRecord, generation: number, granted: boolean): PluginRecord {
  return {
    ...record,
    grantedCapabilities: granted ? ["canvas.write"] : [],
    deniedCapabilities: granted ? [] : [{ capability: "canvas.write", reason: "revoked" as const }],
    grantGeneration: generation,
  };
}

function authorV1(): { readonly envelope: Uint8Array; readonly key: string } {
  const child = spawnSync(process.execPath, [V1_AUTHOR], {
    encoding: "utf8",
    env: { ...process.env, PRC4_ICE_MODULE: ICE_MODULE },
  });
  expect(child.status, `v1 author failed\nstdout:\n${child.stdout}\nstderr:\n${child.stderr}`).toBe(
    0,
  );
  const parsed = JSON.parse(child.stdout) as { envelope: string; key: string };
  return { envelope: Buffer.from(parsed.envelope, "base64"), key: parsed.key };
}

function behaviorEventCount(records: readonly CapturedLog[]): number {
  return records.filter((record) => record.event.startsWith("renderer.plugin.behavior_")).length;
}

function guest(engine: CanvasEngine, behaviorId: string) {
  return engine.engine.guests.list().find((candidate) => candidate.id === `behavior:${behaviorId}`);
}

let harness: Harness;
let fieldEngine: FieldEngineModule;
let stagedLoader: StagedLoaderModule;
let behaviorHost: BehaviorHostModule;
let logging: LoggingModule;
let fieldd: FielddModule;
let artifact: Record<string, unknown>;

beforeAll(async () => {
  await installDom();
  // dist/ is intentionally not committed. Produce the same package artifact an
  // author/release build would, so this witness is valid from a clean checkout.
  await buildPlugin({ root: PLUGIN_ROOT });
  harness = await createHarness([PLUGIN_ROOT]);
  [fieldEngine, stagedLoader, behaviorHost, logging, fieldd, artifact] = await Promise.all([
    harness.load(
      join(REPO, "packages", "field-app", "src", "field-engine.ts"),
    ) as Promise<FieldEngineModule>,
    harness.load(
      join(REPO, "packages", "field-app", "src", "plugin-host", "staged-loader.ts"),
    ) as Promise<StagedLoaderModule>,
    harness.load(
      join(REPO, "packages", "field-app", "src", "plugin-host", "behavior-generation-host.ts"),
    ) as Promise<BehaviorHostModule>,
    harness.load(
      join(REPO, "packages", "field-app", "src", "logging.ts"),
    ) as Promise<LoggingModule>,
    harness.load(
      join(REPO, "packages", "fieldd", "src", "plugin-registry.ts"),
    ) as Promise<FielddModule>,
    // Exact emitted bytes. Loading src/renderer.ts here would make A9 fail.
    harness.load(ARTIFACT),
  ]);
}, 120_000);

afterAll(async () => {
  await harness?.close();
});

describe("PRC4-E21 packaged behavior conformance", () => {
  it("preserves migration, riders, diagnostics, breaker state, and exact cleanup through churn", async () => {
    const dataDir = mkdtempSync(join(tmpdir(), "vibefield-prc4f-"));
    const registryService = new fieldd.PluginRegistryService({
      dataDir,
      roots: { bundled: [], devLinked: [join(REPO, "examples", "plugins")] },
    });
    const logs: CapturedLog[] = [];
    const previousLogger = logging.getRendererLogger();
    logging.setRendererLogger(recordingLogger(logs));
    let runtime:
      | Awaited<ReturnType<StagedLoaderModule["prepareRendererPlugins"]>>["runtime"]
      | undefined;
    try {
      await registryService.refresh();
      const authoritySnapshot = registryService.snapshot();
      const record = authoritySnapshot.plugins.find((candidate) => candidate.id === PLUGIN_ID);
      if (record === undefined) throw new Error("fieldd did not discover the conformance plugin");
      expect(record).toMatchObject({
        state: "enabled",
        grantedCapabilities: ["canvas.write"],
        renderer: "inactive",
      });
      expect(record.contributions.behaviors.map((row) => row.id)).toEqual([
        DURABLE_ID,
        RUNTIME_ID,
        BREAKER_ID,
      ]);

      const moduleRow = {
        pluginId: PLUGIN_ID,
        moduleUrl: `vibefield-plugin://${"e".repeat(32)}`,
        manifestHash: record.manifestHash,
        installRevision: record.installRevision,
      };
      const prepared = await stagedLoader.prepareRendererPlugins({
        windowId: "field",
        request: async (method) => {
          if (method === "plugins.modules") {
            return { generation: authoritySnapshot.generation, modules: [moduleRow] };
          }
          if (method === "plugins.list") return authoritySnapshot;
          throw new Error(`unexpected request ${method}`);
        },
        snapshot: () => null,
        importModule: async () => artifact,
      });
      runtime = prepared.runtime;
      if (runtime === undefined) throw new Error("staged loader did not create a window runtime");
      expect(prepared.staged.map((entry) => entry.activation.state)).toEqual(["active"]);
      const catalog = runtime.behaviorCatalog.snapshot();
      expect(catalog.map((row) => [row.id, row.definition.store, row.authorized])).toEqual([
        [DURABLE_ID, "durable", true],
        [RUNTIME_ID, "runtime", true],
        [BREAKER_ID, "runtime", true],
      ]);

      const handles = new Map(catalog.map((row) => [row.id, row.handle]));
      const durable = handles.get(DURABLE_ID);
      const runtimeProbe = handles.get(RUNTIME_ID);
      const breaker = handles.get(BREAKER_ID);
      if (durable === undefined || runtimeProbe === undefined || breaker === undefined) {
        throw new Error("the staged catalog is incomplete");
      }

      const pluginRegistry = fieldEngine.buildRegistry(prepared) as PluginRegistry<WidgetType>;
      const v1 = authorV1();
      const lifecycle: string[] = [];
      let engine = fieldEngine.createFieldEngine(pluginRegistry);
      let host = new behaviorHost.BehaviorGenerationHost({
        engine,
        target: { windowId: "field", documentId: "prc4f", runtimeGeneration: "engine-0" },
        ledger: runtime.behaviorLedger,
        onEvent: (event) => lifecycle.push(`${event.type}:${event.declarationId ?? "host"}`),
      });
      let connection = behaviorHost.connectBehaviorGenerationHost(host, runtime.behaviorCatalog);
      expect(host.lastReport.installed).toEqual([DURABLE_ID, RUNTIME_ID, BREAKER_ID]);
      expect(engine.engine.guests.list()).toHaveLength(3);

      const opened = engine.docs.open(v1.envelope);
      if (!opened.ok) throw new Error(`v1 document was refused: ${opened.reason}`);
      expect(opened.session.readOnly).toBe(false);
      engine.world.sync();
      engine.step(16);
      const oldEntity = opened.session.store.resolve(
        v1.key as Parameters<typeof opened.session.store.resolve>[0],
      );
      if (oldEntity === undefined) throw new Error("v1 behavior carrier did not project");
      expect(engine.behaviors.read(oldEntity, durable)).toEqual({ count: 42 });
      expect(
        logs.some(
          (row) =>
            row.event === "renderer.plugin.behavior_log" &&
            row.attrs?.behaviorId === DURABLE_ID &&
            row.message.includes("migrated 1 instance(s) from v1 to v2"),
        ),
      ).toBe(true);

      const widget = engine.ops.spawnWidget(WIDGET_TYPE, {
        x: 0,
        y: 0,
        undoable: false,
      });
      engine.world.sync();
      expect(engine.behaviors.read(widget, durable)).toEqual({ count: 5 });
      // Runtime riders are projected by the widget runtime on its first engine step; durable
      // riders are document cells and are therefore visible immediately after the spawn tx.
      engine.step(32);
      expect(engine.behaviors.read(widget, runtimeProbe)).toEqual({ count: 7 });
      expect(engine.behaviors.has(widget, breaker)).toBe(true);
      engine.step(48);
      engine.step(64);
      engine.step(80);
      await Promise.resolve();
      expect(guest(engine, BREAKER_ID)).toMatchObject({ strikes: 3, status: "suspended" });
      expect(
        logs.filter(
          (row) =>
            row.event === "renderer.plugin.behavior_fault" &&
            row.bindings.pluginId === PLUGIN_ID &&
            row.attrs?.behaviorId === BREAKER_ID &&
            row.attrs?.hook === "tick",
        ),
      ).toHaveLength(3);
      expect(
        logs.some(
          (row) =>
            row.event === "renderer.plugin.behavior_log" &&
            row.bindings.pluginId === PLUGIN_ID &&
            row.attrs?.behaviorId === BREAKER_ID &&
            row.message === "breaker.tick",
        ),
      ).toBe(true);

      engine.behaviors.attach(widget, runtimeProbe, { count: 9 });
      expect(engine.behaviors.read(widget, runtimeProbe)).toEqual({ count: 9 });
      let observationGeneration = authoritySnapshot.generation;
      for (let cycle = 0; cycle < 6; cycle += 1) {
        const denied = withGrant(record, ++observationGeneration, false);
        await runtime.reconcile(snapshot(observationGeneration, denied));
        expect(engine.engine.guests.list(), `deny cycle ${cycle}`).toEqual([]);
        expect(host.lastReport.blocked).toEqual([
          { declarationId: DURABLE_ID, reason: "canvas-write-denied" },
          { declarationId: RUNTIME_ID, reason: "canvas-write-denied" },
          { declarationId: BREAKER_ID, reason: "canvas-write-denied" },
        ]);
        expect(engine.behaviors.read(oldEntity, durable)).toEqual({ count: 42 });
        expect(engine.behaviors.read(widget, runtimeProbe)).toEqual({ count: 9 });
        const quiet = behaviorEventCount(logs);
        engine.step(128 + cycle * 64);
        expect(behaviorEventCount(logs), `denied hook ran in cycle ${cycle}`).toBe(quiet);

        const granted = withGrant(record, ++observationGeneration, true);
        await runtime.reconcile(snapshot(observationGeneration, granted));
        expect(engine.engine.guests.list()).toHaveLength(3);
        expect(guest(engine, BREAKER_ID)).toMatchObject({ strikes: 3, status: "suspended" });
        const faults = logs.filter((row) => row.event === "renderer.plugin.behavior_fault").length;
        engine.step(144 + cycle * 64);
        expect(
          logs.filter((row) => row.event === "renderer.plugin.behavior_fault").length,
          `suspended breaker ran after regrant ${cycle}`,
        ).toBe(faults);
      }

      const widgetKey = opened.session.store.keyOf(widget);
      if (typeof widgetKey !== "string") throw new Error("widget has no durable key");
      let envelope = opened.session.exportEnvelope();
      connection.close("document-switch");
      expect(engine.engine.guests.list()).toEqual([]);
      const afterGenerationClose = behaviorEventCount(logs);
      engine.step(600);
      expect(behaviorEventCount(logs)).toBe(afterGenerationClose);
      engine.docs.close();
      engine.dispose();

      for (let generation = 1; generation <= 8; generation += 1) {
        engine = fieldEngine.createFieldEngine(pluginRegistry);
        host = new behaviorHost.BehaviorGenerationHost({
          engine,
          target: {
            windowId: "field",
            documentId: "prc4f",
            runtimeGeneration: `engine-${generation}`,
          },
          ledger: runtime.behaviorLedger,
          onEvent: (event) => lifecycle.push(`${event.type}:${event.declarationId ?? "host"}`),
        });
        connection = behaviorHost.connectBehaviorGenerationHost(host, runtime.behaviorCatalog);
        expect(engine.engine.guests.list()).toHaveLength(3);
        expect(guest(engine, BREAKER_ID)).toMatchObject({ strikes: 3, status: "suspended" });
        const next = engine.docs.open(envelope);
        if (!next.ok) throw new Error(`generation ${generation} document was refused`);
        engine.world.sync();
        engine.step(500 + generation * 16);
        const restoredOld = next.session.store.resolve(
          v1.key as Parameters<typeof next.session.store.resolve>[0],
        );
        const restoredWidget = next.session.store.resolve(widgetKey);
        if (restoredOld === undefined || restoredWidget === undefined) {
          throw new Error(`generation ${generation} did not project both carriers`);
        }
        expect(engine.behaviors.read(restoredOld, durable)).toEqual({ count: 42 });
        expect(engine.behaviors.read(restoredWidget, durable)).toEqual({ count: 5 });
        expect(engine.behaviors.read(restoredWidget, runtimeProbe)).toEqual({ count: 7 });
        envelope = next.session.exportEnvelope();
        connection.close("document-switch");
        expect(engine.engine.guests.list(), `generation ${generation} left guests`).toEqual([]);
        const quiet = behaviorEventCount(logs);
        engine.step(700 + generation * 16);
        expect(behaviorEventCount(logs), `generation ${generation} left a live hook`).toBe(quiet);
        engine.docs.close();
        engine.dispose();
      }

      expect(runtime.behaviorLedger.snapshot().get(`field\0${PLUGIN_ID}\0${BREAKER_ID}`)).toEqual({
        strikes: 3,
        suspended: true,
      });
      // 3 initial + (6 grant re-adoptions × 3) + (8 replacement engines × 3).
      expect(lifecycle.filter((event) => event.startsWith("register:"))).toHaveLength(45);
      expect(lifecycle.filter((event) => event.startsWith("unregister:"))).toHaveLength(45);
    } finally {
      await runtime?.close();
      logging.setRendererLogger(previousLogger);
      registryService.dispose();
      rmSync(dataDir, { recursive: true, force: true });
    }
  }, 120_000);
});
