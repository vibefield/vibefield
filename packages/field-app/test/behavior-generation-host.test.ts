import {
  createCanvasEngine,
  defineBehavior,
  describeBehavior,
  type GuestLedgerRecord,
  p,
  type WidgetType,
} from "@vibecook/ice";
import type { BehaviorDefinition } from "@vibefield/contracts";
import { PluginRegistry } from "@vibefield/plugin-runtime";
import { describe, expect, it } from "vitest";
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
