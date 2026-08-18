import {
  createCanvasEngine,
  defineBehavior,
  describeBehavior,
  type GuestLedgerRecord,
  p,
  type WidgetType,
} from "@vibecook/ice";
import {
  type BehaviorDefinition,
  PLUGIN_LIMITS,
  PLUGIN_RUNTIME_DIAGNOSTIC_LIMITS,
} from "@vibefield/contracts";
import { PluginRegistry } from "@vibefield/plugin-runtime";
import { describe, expect, it, vi } from "vitest";
import { createFieldEngine } from "../src/field-engine";
import {
  getRendererLogger,
  type RendererLogger,
  type RendererLoggerBindings,
  setRendererLogger,
} from "../src/logging";
import {
  BehaviorBindingCatalog,
  type BehaviorCatalogBinding,
} from "../src/plugin-host/behavior-binding-catalog";
import {
  BehaviorBreakerLedger,
  BehaviorGenerationHost,
  connectBehaviorGenerationHost,
} from "../src/plugin-host/behavior-generation-host";
import type { RendererBehaviorBinding } from "../src/plugin-host/renderer-harness";

function rendererTarget(pluginId: string, authorized = true) {
  return {
    face: "renderer" as const,
    pluginId,
    artifact: {
      installRevision: "behavior-host-rev-1",
      manifestHash: `sha256:${"d".repeat(64)}`,
    },
    instanceKey: { windowId: "field" },
    authorityFingerprint: JSON.stringify(["v1", "renderer", authorized ? ["canvas.write"] : []]),
    observedGrantGeneration: authorized ? 1 : 2,
  };
}

function rendererBinding(
  pluginId: string,
  handle: ReturnType<typeof defineBehavior>,
  declarationIndex: number,
  authorized = true,
): RendererBehaviorBinding {
  const { id: _id, ...definition } = describeBehavior(handle);
  return {
    pluginId,
    id: handle.name,
    declarationIndex,
    orderKey: `${pluginId}\0${declarationIndex.toString().padStart(6, "0")}`,
    definition: definition as BehaviorDefinition,
    authorized,
    handle,
  };
}

function publish(
  catalog: BehaviorBindingCatalog,
  pluginId: string,
  handles: readonly ReturnType<typeof defineBehavior>[],
  options: { readonly authorized?: boolean; readonly token?: object } = {},
): object {
  const authorized = options.authorized ?? true;
  const token = options.token ?? {};
  catalog.publishCandidate(
    pluginId,
    token,
    rendererTarget(pluginId, authorized),
    new Map(
      handles.map((handle, index) => [
        handle.name,
        rendererBinding(pluginId, handle, index, authorized),
      ]),
    ),
  );
  return token;
}

function target(runtimeGeneration: string, documentId = "doc-a") {
  return { windowId: "field", documentId, runtimeGeneration };
}

function guest(engine: ReturnType<typeof createCanvasEngine>, behaviorName: string) {
  return engine.engine.guests.list().find((entry) => entry.id === `behavior:${behaviorName}`);
}

async function eventually(check: () => boolean, message: string): Promise<void> {
  const deadline = Date.now() + 1_000;
  while (!check()) {
    if (Date.now() >= deadline) throw new Error(message);
    await new Promise((resolve) => setTimeout(resolve, 8));
  }
}

function recordingLogger(
  events: Array<{ event: string; bindings: RendererLoggerBindings }>,
  bindings: RendererLoggerBindings = {},
): RendererLogger {
  const write = (event: string): void => {
    events.push({ event, bindings });
  };
  return {
    child: (child) => recordingLogger(events, { ...bindings, ...child }),
    trace: write,
    debug: write,
    info: write,
    warn: write,
    error: write,
    fatal: write,
    isLevelEnabled: () => true,
  };
}

describe("document behavior generation host", () => {
  it("projects one bounded plugin-local generation fold and polling emits nothing", () => {
    const aId = "com.example.host-diagnostic-a";
    const bId = "com.example.host-diagnostic-b";
    const A = defineBehavior(`${aId}:layout`, { store: "runtime" });
    const B = defineBehavior(`${bId}:layout`, { store: "runtime" });
    const catalog = new BehaviorBindingCatalog();
    publish(catalog, aId, [A], { authorized: false });
    publish(catalog, bId, [B]);
    const engine = createCanvasEngine();
    const changed = vi.fn();
    const host = new BehaviorGenerationHost({
      engine,
      target: target("engine-diagnostic", "doc-diagnostic"),
      onDiagnosticsChanged: changed,
    });
    const connection = connectBehaviorGenerationHost(host, catalog);

    expect(host.diagnostics()).toEqual([
      expect.objectContaining({
        pluginId: aId,
        state: "active",
        target: {
          windowId: "field",
          documentId: "doc-diagnostic",
          runtimeGeneration: "engine-diagnostic",
        },
        desiredCount: 1,
        installedCount: 0,
        blockedCount: 1,
        declarations: [
          expect.objectContaining({
            declarationId: A.name,
            status: "blocked",
            blockedReason: "canvas-write-denied",
          }),
        ],
      }),
      expect.objectContaining({
        pluginId: bId,
        desiredCount: 1,
        installedCount: 1,
        blockedCount: 0,
        declarations: [expect.objectContaining({ declarationId: B.name, status: "installed" })],
      }),
    ]);
    const beforePolling = changed.mock.calls.length;
    for (let index = 0; index < 100; index += 1) host.diagnostics();
    expect(changed).toHaveBeenCalledTimes(beforePolling);

    connection.close("diagnostic-close");
    expect(changed.mock.calls.at(-1)?.[0]).toEqual([
      expect.objectContaining({ pluginId: aId, state: "closed", closeReason: "diagnostic-close" }),
      expect.objectContaining({ pluginId: bId, state: "closed", closeReason: "diagnostic-close" }),
    ]);
    engine.dispose();
  });

  it("retains exact old and new renderer targets when old withdrawal fails", () => {
    const pluginId = "com.example.host-diagnostic-transition";
    const Behavior = defineBehavior(`${pluginId}:layout`, { store: "runtime" });
    const engine = createCanvasEngine();
    const ledger = new BehaviorBreakerLedger();
    ledger.set(`field\0${pluginId}\0${Behavior.name}`, { strikes: 3, suspended: true });
    const register = engine.behaviors.register.bind(engine.behaviors);
    let refuseUnregister = false;
    engine.behaviors.register = ((...args: Parameters<typeof register>) => {
      const unregister = register(...args);
      return () => {
        if (refuseUnregister) throw new Error("old target would not unregister");
        unregister();
      };
    }) as typeof engine.behaviors.register;
    const host = new BehaviorGenerationHost({
      engine,
      target: target("engine-transition", "doc-transition"),
      ledger,
    });
    const old = {
      ...rendererBinding(pluginId, Behavior, 0),
      candidateToken: {},
      rendererTarget: rendererTarget(pluginId),
    } satisfies BehaviorCatalogBinding;
    expect(host.reconcile([old]).state).toBe("active");

    refuseUnregister = true;
    const next = {
      ...rendererBinding(pluginId, Behavior, 0),
      candidateToken: {},
      rendererTarget: {
        ...rendererTarget(pluginId),
        artifact: {
          installRevision: "behavior-host-rev-2",
          manifestHash: `sha256:${"e".repeat(64)}`,
        },
      },
    } satisfies BehaviorCatalogBinding;
    expect(host.reconcile([next]).state).toBe("failed");
    const diagnostic = host.diagnostics()[0];
    expect(guest(engine, Behavior.name)).toBeDefined();
    expect(diagnostic?.installedCount).toBe(1);
    expect(diagnostic?.suspendedCount).toBe(1);
    expect(diagnostic?.declarations.every((row) => row.breaker?.suspended === true)).toBe(true);
    expect(diagnostic?.rendererTargets.map((target) => target.artifact.installRevision)).toEqual([
      "behavior-host-rev-1",
      "behavior-host-rev-2",
    ]);
    expect(diagnostic?.declarations).toEqual([
      expect.objectContaining({
        declarationId: Behavior.name,
        rendererTarget: 0,
        status: "failed",
        error: { operation: "unregister", message: "old target would not unregister" },
      }),
      expect.objectContaining({
        declarationId: Behavior.name,
        rendererTarget: 1,
        status: "inactive",
      }),
    ]);
    refuseUnregister = false;
    host.close();
    expect(guest(engine, Behavior.name)).toBeUndefined();
    engine.dispose();
  });

  it("keeps a failed withdrawn registration owned until close retries it", () => {
    const pluginId = "com.example.host-diagnostic-withdrawal";
    const Behavior = defineBehavior(`${pluginId}:layout`, { store: "runtime" });
    const engine = createCanvasEngine();
    const register = engine.behaviors.register.bind(engine.behaviors);
    let refuseUnregister = false;
    engine.behaviors.register = ((...args: Parameters<typeof register>) => {
      const unregister = register(...args);
      return () => {
        if (refuseUnregister) throw new Error("withdrawn behavior remained live");
        unregister();
      };
    }) as typeof engine.behaviors.register;
    const ledger = new BehaviorBreakerLedger();
    const host = new BehaviorGenerationHost({
      engine,
      target: target("engine-withdrawal", "doc-withdrawal"),
      ledger,
    });
    const binding = {
      ...rendererBinding(pluginId, Behavior, 0),
      candidateToken: {},
      rendererTarget: rendererTarget(pluginId),
    } satisfies BehaviorCatalogBinding;
    ledger.set(host.breakerKey(binding), { strikes: 3, suspended: true });
    expect(host.reconcile([binding]).state).toBe("active");

    refuseUnregister = true;
    expect(host.reconcile([])).toMatchObject({ state: "failed", installed: [Behavior.name] });
    expect(host.diagnostics()).toEqual([
      expect.objectContaining({
        pluginId,
        desiredCount: 0,
        installedCount: 1,
        failedCount: 1,
        suspendedCount: 1,
        declarations: [
          expect.objectContaining({
            declarationId: Behavior.name,
            status: "failed",
            error: {
              operation: "unregister",
              message: "withdrawn behavior remained live",
            },
          }),
        ],
      }),
    ]);
    expect(guest(engine, Behavior.name)).toBeDefined();

    refuseUnregister = false;
    expect(host.close().state).toBe("closed");
    expect(guest(engine, Behavior.name)).toBeUndefined();
    engine.dispose();
  });

  it("preserves both exact transition targets while shedding detail below 32 KiB", () => {
    const pluginId = `c.${"d".repeat(62)}`;
    const behaviors = Array.from({ length: PLUGIN_LIMITS.BEHAVIORS_MAX }, (_, index) =>
      defineBehavior(`${pluginId}:${index.toString().padStart(2, "0")}${"x".repeat(61)}`, {
        store: "runtime",
      }),
    );
    const windowId = "w".repeat(PLUGIN_RUNTIME_DIAGNOSTIC_LIMITS.TARGET_PART_CHARS);
    const exactRendererTarget = (marker: string) => ({
      face: "renderer" as const,
      pluginId,
      artifact: {
        installRevision: marker.repeat(PLUGIN_RUNTIME_DIAGNOSTIC_LIMITS.TARGET_PART_CHARS),
        manifestHash: marker.repeat(PLUGIN_RUNTIME_DIAGNOSTIC_LIMITS.TARGET_PART_CHARS),
        approvedModuleGeneration: Number.MAX_SAFE_INTEGER,
      },
      authorityFingerprint: marker.repeat(
        PLUGIN_RUNTIME_DIAGNOSTIC_LIMITS.AUTHORITY_FINGERPRINT_CHARS,
      ),
      observedGrantGeneration: Number.MAX_SAFE_INTEGER,
      runtimeGeneration: marker.repeat(PLUGIN_RUNTIME_DIAGNOSTIC_LIMITS.TARGET_PART_CHARS),
      instanceKey: { windowId },
    });
    const engine = createCanvasEngine();
    const register = engine.behaviors.register.bind(engine.behaviors);
    const refused = new Set(behaviors.slice(0, -1).map((behavior) => behavior.name));
    let refuseUnregister = false;
    engine.behaviors.register = ((...args: Parameters<typeof register>) => {
      const unregister = register(...args);
      return () => {
        if (refuseUnregister && refused.has(args[0].name)) {
          throw new Error("e".repeat(4_096));
        }
        unregister();
      };
    }) as typeof engine.behaviors.register;
    const host = new BehaviorGenerationHost({
      engine,
      target: {
        windowId,
        documentId: "d".repeat(PLUGIN_RUNTIME_DIAGNOSTIC_LIMITS.TARGET_PART_CHARS),
        runtimeGeneration: "g".repeat(PLUGIN_RUNTIME_DIAGNOSTIC_LIMITS.TARGET_PART_CHARS),
      },
    });
    const bindings = (rendererTarget: ReturnType<typeof exactRendererTarget>, token: object) =>
      behaviors.map(
        (behavior, index) =>
          ({
            ...rendererBinding(pluginId, behavior, index),
            candidateToken: token,
            rendererTarget,
          }) satisfies BehaviorCatalogBinding,
      );
    expect(host.reconcile(bindings(exactRendererTarget("a"), {})).state).toBe("active");

    refuseUnregister = true;
    expect(host.reconcile(bindings(exactRendererTarget("z"), {})).state).toBe("failed");
    const diagnostic = host.diagnostics()[0];
    if (diagnostic === undefined) throw new Error("maximal behavior diagnostic missing");
    const bytes = new TextEncoder().encode(JSON.stringify(diagnostic)).byteLength;
    expect(diagnostic.rendererTargets).toHaveLength(2);
    expect(diagnostic.declarations.some((row) => row.rendererTarget === 0)).toBe(true);
    expect(diagnostic.declarations.some((row) => row.rendererTarget === 1)).toBe(true);
    expect(diagnostic.omittedDeclarations).toBeGreaterThan(0);
    expect(bytes).toBeLessThanOrEqual(PLUGIN_RUNTIME_DIAGNOSTIC_LIMITS.BEHAVIOR_BYTES);

    refuseUnregister = false;
    host.close();
    engine.dispose();
  });

  it("registers the initial catalog before open and reverse-unregisters before close", async () => {
    const lifecycle: string[] = [];
    const ticks: string[] = [];
    const aId = "com.example.host-a";
    const bId = "com.example.host-b";
    const A = defineBehavior(`${aId}:layout`, {
      store: "runtime",
      phase: "simulate",
      on: {
        tick: () => ticks.push("a"),
        dispose: () => lifecycle.push("dispose:a"),
      },
    });
    const B = defineBehavior(`${bId}:layout`, {
      store: "runtime",
      phase: "simulate",
      on: {
        tick: () => ticks.push("b"),
        dispose: () => lifecycle.push("dispose:b"),
      },
    });
    const catalog = new BehaviorBindingCatalog();
    publish(catalog, bId, [B]);
    publish(catalog, aId, [A]);
    const engine = createCanvasEngine();
    const events: string[] = [];
    const host = new BehaviorGenerationHost({
      engine,
      target: target("engine-1"),
      onEvent: (event) => {
        if (event.type === "register") events.push(`register:${event.declarationId}`);
      },
    });
    const connection = connectBehaviorGenerationHost(host, catalog);
    expect(events).toEqual([`register:${A.name}`, `register:${B.name}`]);

    lifecycle.push("docs:create");
    await engine.docs.create();
    const entity = engine.world.spawn({});
    engine.behaviors.attach(entity, A);
    engine.behaviors.attach(entity, B);
    engine.step(16);
    expect(ticks).toEqual(["a", "b"]);

    connection.close("document-switch");
    expect(lifecycle.slice(-2)).toEqual(["dispose:b", "dispose:a"]);
    expect(engine.engine.guests.list()).toEqual([]);
    lifecycle.push("docs:close");
    engine.docs.close();
    expect(lifecycle.indexOf("dispose:a")).toBeLessThan(lifecycle.indexOf("docs:close"));
    engine.dispose();
  });

  it("handles live deny/regrant without rebuilding an unaffected peer", async () => {
    let aInits = 0;
    let bInits = 0;
    const ticks: string[] = [];
    const aId = "com.example.host-live-a";
    const bId = "com.example.host-live-b";
    const A = defineBehavior(`${aId}:layout`, {
      store: "runtime",
      phase: "simulate",
      schema: { value: p.number({ default: 0 }) },
      on: { init: () => aInits++, tick: () => ticks.push("a") },
    });
    const B = defineBehavior(`${bId}:layout`, {
      store: "runtime",
      phase: "simulate",
      on: { init: () => bInits++, tick: () => ticks.push("b") },
    });
    const catalog = new BehaviorBindingCatalog();
    publish(catalog, aId, [A]);
    publish(catalog, bId, [B]);
    const engine = createCanvasEngine();
    const host = new BehaviorGenerationHost({ engine, target: target("engine-live") });
    const connection = connectBehaviorGenerationHost(host, catalog);
    await engine.docs.create();
    const entity = engine.world.spawn({});
    engine.behaviors.attach(entity, A, { value: 7 });
    engine.behaviors.attach(entity, B);
    engine.step(16);
    expect({ aInits, bInits }).toEqual({ aInits: 1, bInits: 1 });

    publish(catalog, aId, [A], { authorized: false });
    expect(guest(engine, A.name)).toBeUndefined();
    expect(guest(engine, B.name)).toBeDefined();
    expect(host.lastReport.blocked).toEqual([
      { declarationId: A.name, reason: "canvas-write-denied" },
    ]);
    expect(engine.behaviors.read(entity, A)).toEqual({ value: 7 });
    ticks.length = 0;
    engine.step(32);
    expect(ticks).toEqual(["b"]);

    publish(catalog, aId, [A]);
    ticks.length = 0;
    engine.step(48);
    expect(ticks).toEqual(["a", "b"]);
    expect({ aInits, bInits }).toEqual({ aInits: 2, bInits: 1 });

    connection.close();
    engine.docs.close();
    engine.dispose();
  });

  it("seeds chronic breaker state across exact engine generations", async () => {
    const pluginId = "com.example.host-ledger";
    const Async = defineBehavior(`${pluginId}:async`, {
      store: "runtime",
      phase: "simulate",
      on: { tick: async () => undefined },
    });
    const catalog = new BehaviorBindingCatalog();
    publish(catalog, pluginId, [Async]);
    const ledger = new BehaviorBreakerLedger();
    const first = createCanvasEngine({
      onBehaviorFault() {},
      onGuestFault() {},
      onGuestNotice() {},
    });
    const hostA = new BehaviorGenerationHost({
      engine: first,
      target: target("engine-ledger-1", "same-doc"),
      ledger,
    });
    const connectionA = connectBehaviorGenerationHost(hostA, catalog);
    await first.docs.create();
    const entity = first.world.spawn({});
    first.behaviors.attach(entity, Async);
    first.step(16);
    first.step(32);
    first.step(48);
    await Promise.resolve();
    const row = catalog.snapshot()[0];
    if (row === undefined) throw new Error("catalog row missing");
    const breakerKey = hostA.breakerKey(row);
    expect(ledger.get(breakerKey)).toEqual({ strikes: 3, suspended: true });
    expect(hostA.diagnostics()[0]).toMatchObject({
      pluginId,
      suspendedCount: 1,
      declarations: [expect.objectContaining({ breaker: { strikes: 3, suspended: true } })],
    });
    connectionA.close("engine-replaced");
    first.docs.close();
    first.dispose();

    const second = createCanvasEngine({
      onBehaviorFault() {},
      onGuestFault() {},
      onGuestNotice() {},
    });
    const hostB = new BehaviorGenerationHost({
      engine: second,
      target: target("engine-ledger-2", "same-doc"),
      ledger,
    });
    const connectionB = connectBehaviorGenerationHost(hostB, catalog);
    expect(guest(second, Async.name)).toMatchObject({ status: "suspended", strikes: 3 });
    connectionB.close();
    second.dispose();
  });

  it("rolls back failed additions and rejects an invalid snapshot without disturbing truth", () => {
    const pluginId = "com.example.host-rollback";
    const Stable = defineBehavior(`${pluginId}:stable`, { store: "runtime" });
    const Added = defineBehavior(`${pluginId}:added`, { store: "runtime" });
    const Collision = defineBehavior(`${pluginId}:collision`, { store: "runtime" });
    const engine = createCanvasEngine();
    const host = new BehaviorGenerationHost({ engine, target: target("engine-rollback") });
    const stable = rendererBinding(pluginId, Stable, 0);
    const base = {
      ...stable,
      candidateToken: {},
      rendererTarget: rendererTarget(pluginId),
    } satisfies BehaviorCatalogBinding;
    expect(host.reconcile([base]).state).toBe("active");
    const removeCollision = engine.behaviors.register(Collision);
    const desired = [
      base,
      {
        ...rendererBinding(pluginId, Added, 1),
        candidateToken: {},
        rendererTarget: rendererTarget(pluginId),
      },
      {
        ...rendererBinding(pluginId, Collision, 2),
        candidateToken: {},
        rendererTarget: rendererTarget(pluginId),
      },
    ] satisfies BehaviorCatalogBinding[];
    expect(host.reconcile(desired)).toMatchObject({ state: "failed", installed: [Stable.name] });
    expect(guest(engine, Added.name)).toBeUndefined();
    expect(guest(engine, Stable.name)).toBeDefined();

    const invalid = [{ ...base, orderKey: "wrong" }] as BehaviorCatalogBinding[];
    expect(() => host.reconcile(invalid)).toThrow(/non-canonical order key/);
    expect(host.lastReport.installed).toEqual([Stable.name]);

    const Facet = defineBehavior(`${pluginId}:facet`, {
      store: "ephemeral",
      maxFacetBytes: 128,
    });
    const facetBinding = rendererBinding(pluginId, Facet, 1);
    const unattested = [
      base,
      {
        ...facetBinding,
        definition: { ...facetBinding.definition, maxFacetBytes: undefined },
        candidateToken: {},
        rendererTarget: rendererTarget(pluginId),
      },
    ] as BehaviorCatalogBinding[];
    expect(() => host.reconcile(unattested)).toThrow(/lacks a valid maxFacetBytes claim/);
    expect(host.lastReport.installed).toEqual([Stable.name]);

    host.close();
    removeCollision();
    engine.dispose();
  });

  it("bounds chronic breaker memory", () => {
    const ledger = new BehaviorBreakerLedger(2);
    const row = (strikes: number): GuestLedgerRecord => ({ strikes, suspended: false });
    ledger.set("a", row(1));
    ledger.set("b", row(2));
    ledger.set("a", row(3));
    ledger.set("c", row(4));
    expect([...ledger.snapshot()]).toEqual([
      ["a", row(3)],
      ["c", row(4)],
    ]);
  });

  it("keeps ephemeral intent dormant until facade presence appears", async () => {
    let inits = 0;
    const pluginId = "com.example.host-presence";
    const Facet = defineBehavior(`${pluginId}:facet`, {
      store: "ephemeral",
      maxFacetBytes: 1_024,
      schema: { mode: p.string({ default: "active" }) },
      on: { init: () => inits++ },
    });
    const catalog = new BehaviorBindingCatalog();
    publish(catalog, pluginId, [Facet]);
    const engine = createCanvasEngine();
    const host = new BehaviorGenerationHost({
      engine,
      target: target("engine-presence"),
      presenceAvailable: () => engine.docs.presence() !== undefined,
    });
    const connection = connectBehaviorGenerationHost(host, catalog);
    expect(host.lastReport).toMatchObject({
      state: "active",
      installed: [],
      blocked: [{ declarationId: Facet.name, reason: "presence-unavailable" }],
    });
    expect(guest(engine, Facet.name)).toBeUndefined();

    await engine.docs.create();
    const detachPresence = engine.docs.attachPresence({
      peerId: "behavior-host-local",
      name: "Behavior host",
      color: "#111111",
    });
    const presence = engine.docs.presence();
    expect(presence).toBeDefined();
    expect(connection.refresh()).toMatchObject({
      state: "active",
      installed: [Facet.name],
      blocked: [],
    });
    engine.step(16);
    expect(inits).toBe(1);
    expect(
      presence === undefined ? undefined : engine.world.get(presence.localPeer, Facet.component),
    ).toEqual({ mode: "active" });

    connection.close("presence-close");
    expect(guest(engine, Facet.name)).toBeUndefined();
    detachPresence();
    engine.docs.close();
    engine.dispose();
  });

  it("allocates one plugin-atomic ephemeral window in canonical plugin order", () => {
    const facet = (pluginId: string, local: string, chargedBytes: number) =>
      defineBehavior(`${pluginId}:${local}`, {
        store: "ephemeral",
        maxFacetBytes: chargedBytes - PLUGIN_LIMITS.BEHAVIOR_EPHEMERAL_ENVELOPE_BYTES,
      });
    const aId = "com.example.budget-a";
    const bId = "com.example.budget-b";
    const cId = "com.example.budget-c";
    const A = facet(aId, "facet", 32 * 1_024);
    const B1 = facet(bId, "facet-one", 10 * 1_024);
    const B2 = facet(bId, "facet-two", 10 * 1_024);
    const BDurable = defineBehavior(`${bId}:durable`, { store: "runtime" });
    const C = facet(cId, "facet", 8 * 1_024);
    const catalog = new BehaviorBindingCatalog();
    const aToken = publish(catalog, aId, [A]);
    publish(catalog, bId, [B1, B2, BDurable]);
    publish(catalog, cId, [C]);
    const engine = createCanvasEngine();
    const host = new BehaviorGenerationHost({
      engine,
      target: target("engine-budget"),
      presenceAvailable: () => true,
    });
    const connection = connectBehaviorGenerationHost(host, catalog);

    expect(host.lastReport).toMatchObject({
      state: "active",
      installed: [A.name, BDurable.name, C.name],
      blocked: [
        { declarationId: B1.name, reason: "presence-budget-exceeded" },
        { declarationId: B2.name, reason: "presence-budget-exceeded" },
      ],
    });
    expect(guest(engine, A.name)).toBeDefined();
    expect(guest(engine, B1.name)).toBeUndefined();
    expect(guest(engine, B2.name)).toBeUndefined();
    expect(guest(engine, BDurable.name)).toBeDefined();
    expect(guest(engine, C.name)).toBeDefined();

    catalog.withdrawCandidate(aId, aToken);
    expect(host.lastReport).toMatchObject({
      state: "active",
      installed: [B1.name, B2.name, BDurable.name, C.name],
      blocked: [],
    });

    connection.close();
    engine.dispose();
  });

  it("keeps an exact fully charged plugin below the independent transport ceiling", async () => {
    const pluginId = `a.${"b".repeat(62)}`;
    const claim =
      PLUGIN_LIMITS.BEHAVIOR_EPHEMERAL_WINDOW_BYTES / PLUGIN_LIMITS.BEHAVIORS_MAX -
      PLUGIN_LIMITS.BEHAVIOR_EPHEMERAL_ENVELOPE_BYTES;
    const emptyCellBytes = new TextEncoder().encode(JSON.stringify({ payload: "" })).byteLength;
    const payload = "x".repeat(claim - emptyCellBytes);
    expect(new TextEncoder().encode(JSON.stringify({ payload })).byteLength).toBe(claim);
    const facets = Array.from({ length: PLUGIN_LIMITS.BEHAVIORS_MAX }, (_, index) => {
      const local = `${index.toString().padStart(2, "0")}${"x".repeat(61)}`;
      return defineBehavior(`${pluginId}:${local}`, {
        store: "ephemeral",
        maxFacetBytes: claim,
        schema: { payload: p.string({ default: payload }) },
      });
    });
    const catalog = new BehaviorBindingCatalog();
    publish(catalog, pluginId, facets);
    const engine = createCanvasEngine();
    let detachPresence = (): void => undefined;
    let stopOutbound = (): void => undefined;
    let connection: ReturnType<typeof connectBehaviorGenerationHost> | undefined;
    const frameSizes: number[] = [];
    try {
      await engine.docs.create();
      detachPresence = engine.docs.attachPresence({
        peerId: "behavior-host-budget",
        name: "Behavior budget",
        color: "#111111",
      });
      const presence = engine.docs.presence();
      if (presence === undefined) throw new Error("presence did not attach");
      stopOutbound = presence.onOutbound((bytes) => frameSizes.push(bytes.byteLength));
      const host = new BehaviorGenerationHost({
        engine,
        target: target("engine-budget-wire"),
        presenceAvailable: () => engine.docs.presence() !== undefined,
      });
      connection = connectBehaviorGenerationHost(host, catalog);
      expect(host.lastReport).toMatchObject({
        state: "active",
        installed: facets.map((facet) => facet.name),
        blocked: [],
      });

      engine.step(16);
      await eventually(
        () => frameSizes.some((bytes) => bytes >= claim * facets.length),
        "ICE did not publish the fully charged aggregate facet frame",
      );
      expect(Math.max(...frameSizes)).toBeLessThanOrEqual(64 * 1_024);
    } finally {
      connection?.close("test-close");
      detachPresence();
      stopOutbound();
      engine.docs.close();
      engine.dispose();
    }
  });

  it("contains a throwing diagnostic sink", () => {
    const pluginId = "com.example.host-diagnostics-sink";
    const Behavior = defineBehavior(`${pluginId}:layout`, { store: "runtime" });
    const catalog = new BehaviorBindingCatalog();
    publish(catalog, pluginId, [Behavior]);
    const engine = createCanvasEngine();
    const host = new BehaviorGenerationHost({
      engine,
      target: target("engine-diagnostic-sink"),
      onEvent: () => {
        throw new Error("diagnostic sink failed");
      },
      onDiagnosticsChanged: () => {
        throw new Error("aggregate sink failed");
      },
    });
    const connection = connectBehaviorGenerationHost(host, catalog);
    expect(host.lastReport).toMatchObject({ state: "active", installed: [Behavior.name] });
    expect(() => connection.close()).not.toThrow();
    expect(guest(engine, Behavior.name)).toBeUndefined();
    engine.dispose();
  });

  it("closes a host when its catalog cannot be connected", () => {
    const catalog = new BehaviorBindingCatalog();
    catalog.close();
    const engine = createCanvasEngine();
    const host = new BehaviorGenerationHost({
      engine,
      target: target("engine-closed-catalog"),
    });
    expect(() => connectBehaviorGenerationHost(host, catalog)).toThrow(/catalog is closed/);
    expect(host.lastReport).toMatchObject({ state: "closed", installed: [] });
    engine.dispose();
  });

  it("routes ICE behavior logs and hook faults with plugin provenance", async () => {
    const previous = getRendererLogger();
    const events: Array<{ event: string; bindings: RendererLoggerBindings }> = [];
    setRendererLogger(recordingLogger(events));
    const pluginId = "com.example.host-diagnostics";
    const Faulty = defineBehavior(`${pluginId}:faulty`, {
      store: "runtime",
      on: {
        init(_entity, _data, ctx) {
          ctx.log("diagnostic hello", { answer: 42 });
          throw new Error("diagnostic boom");
        },
      },
    });
    const engine = createFieldEngine(new PluginRegistry<WidgetType>());
    try {
      engine.behaviors.register(Faulty);
      await engine.docs.create();
      const entity = engine.world.spawn({});
      engine.behaviors.attach(entity, Faulty);
      engine.step(16);
      expect(events).toContainEqual({
        event: "renderer.plugin.behavior_log",
        bindings: { component: "plugin.behavior", pluginId },
      });
      expect(events).toContainEqual({
        event: "renderer.plugin.behavior_fault",
        bindings: { component: "plugin.behavior", pluginId },
      });
    } finally {
      engine.dispose();
      setRendererLogger(previous);
    }
  });
});
