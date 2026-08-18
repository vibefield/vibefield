import {
  type PluginModuleUrls,
  PluginRecord,
  type PluginRegistrySnapshot,
} from "@vibefield/contracts";
import { declareBehavior, defineBehavior } from "@vibefield/plugin-sdk/behavior";
import { describe, expect, it } from "vitest";
import {
  RendererPluginController,
  type RendererPluginControllerDeps,
  RendererWindowController,
} from "../src/plugin-host/renderer-controller";

function record(
  id: string,
  behavior: ReturnType<typeof declareBehavior>,
  options: {
    readonly authorized?: boolean;
    readonly enabled?: boolean;
    readonly grantGeneration?: number;
  } = {},
) {
  const authorized = options.authorized ?? true;
  const enabled = options.enabled ?? true;
  return PluginRecord.parse({
    id,
    version: "1.0.0",
    title: `${id} plugin`,
    source: "dev-linked",
    manifestHash: `sha256:${"b".repeat(64)}`,
    installRevision: "behavior-catalog-rev-1",
    state: enabled ? "enabled" : "disabled",
    compatible: true,
    enabled,
    requestedCapabilities: ["canvas.write"],
    grantedCapabilities: authorized ? ["canvas.write"] : [],
    deniedCapabilities: authorized ? [] : [{ capability: "canvas.write", reason: "revoked" }],
    grantGeneration: options.grantGeneration ?? 1,
    contributions: {
      widgets: [],
      behaviors: [behavior],
      commands: [],
      surfaces: [],
      capabilities: [],
    },
    renderer: "inactive",
    service: "none",
  });
}

function moduleRow(id: string): PluginModuleUrls {
  return {
    pluginId: id,
    moduleUrl: `vibefield-plugin://${id.replaceAll(".", "").padEnd(32, "0").slice(0, 32)}`,
    manifestHash: `sha256:${"b".repeat(64)}`,
    installRevision: "behavior-catalog-rev-1",
  };
}

function snapshot(...plugins: ReturnType<typeof record>[]): PluginRegistrySnapshot {
  return { generation: 1, plugins, problems: [] };
}

const controllerDeps: RendererPluginControllerDeps = {
  refreshCredential: async () => undefined,
  retireCredential: () => undefined,
};

describe("window behavior binding catalog", () => {
  it("publishes complete candidates in canonical order and withdraws authority synchronously", async () => {
    const aId = "com.example.catalog-a";
    const bId = "com.example.catalog-b";
    const A = defineBehavior(`${aId}:layout`, { store: "runtime" });
    const B = defineBehavior(`${bId}:layout`, { store: "durable" });
    const aGranted = record(aId, declareBehavior(A));
    const bGranted = record(bId, declareBehavior(B));
    const runtime = new RendererWindowController("field");
    const a = new RendererPluginController(
      aGranted,
      moduleRow(aId),
      { activate: (ctx) => void ctx.canvas?.behaviors.bind(A.name, A) },
      "field",
      controllerDeps,
    );
    const b = new RendererPluginController(
      bGranted,
      moduleRow(bId),
      { activate: (ctx) => void ctx.canvas?.behaviors.bind(B.name, B) },
      "field",
      controllerDeps,
    );
    // Add in the opposite order: catalog order is authority data, never activation timing.
    runtime.add(b);
    runtime.add(a);
    await runtime.reconcile(snapshot(bGranted, aGranted));

    const initial = runtime.behaviorCatalog.snapshot();
    expect(initial.map((binding) => binding.id)).toEqual([A.name, B.name]);
    expect(initial.map((binding) => binding.definition.store)).toEqual(["runtime", "durable"]);
    expect(initial.every((binding) => binding.authorized)).toBe(true);
    expect(
      initial.every((binding) => binding.rendererTarget.instanceKey.windowId === "field"),
    ).toBe(true);
    const firstAToken = initial[0]?.candidateToken;

    const observations: string[][] = [];
    const unsubscribe = runtime.behaviorCatalog.subscribe((rows) => {
      observations.push(rows.filter((row) => row.authorized).map((row) => row.id));
    });
    expect(runtime.behaviorCatalog.state()).toEqual({
      plugins: 2,
      bindings: 2,
      listeners: 1,
      closed: false,
    });
    try {
      const deniedA = record(aId, declareBehavior(A), {
        authorized: false,
        grantGeneration: 2,
      });
      const denying = runtime.reconcile(snapshot(bGranted, deniedA));
      // No await: semantic authority closes the exact old candidate at setDesired.
      expect(runtime.behaviorCatalog.snapshot().map((binding) => binding.id)).toEqual([B.name]);
      await denying;
      const denied = runtime.behaviorCatalog.snapshot();
      expect(denied.map((binding) => [binding.id, binding.authorized])).toEqual([
        [A.name, false],
        [B.name, true],
      ]);
      expect(denied[0]?.candidateToken).not.toBe(firstAToken);

      const disablingB = runtime.reconcile(
        snapshot(record(bId, declareBehavior(B), { enabled: false, grantGeneration: 2 }), deniedA),
      );
      expect(runtime.behaviorCatalog.snapshot().map((binding) => binding.id)).toEqual([A.name]);
      await disablingB;
      expect(observations).toContainEqual([B.name]);
      expect(observations).toContainEqual([]);
    } finally {
      unsubscribe();
      await runtime.close();
    }
    expect(runtime.behaviorCatalog.snapshot()).toEqual([]);
    expect(runtime.behaviorCatalog.state()).toEqual({
      plugins: 0,
      bindings: 0,
      listeners: 0,
      closed: true,
    });
    expect(() => runtime.behaviorCatalog.subscribe(() => undefined)).toThrow(/closed/);
  });

  it("keeps the candidate identity stable across observation-only credential refresh", async () => {
    const id = "com.example.catalog-refresh";
    const Behavior = defineBehavior(`${id}:layout`, { store: "runtime" });
    const first = record(id, declareBehavior(Behavior), { grantGeneration: 1 });
    const runtime = new RendererWindowController("field");
    const controller = new RendererPluginController(
      first,
      moduleRow(id),
      { activate: (ctx) => void ctx.canvas?.behaviors.bind(Behavior.name, Behavior) },
      "field",
      controllerDeps,
    );
    runtime.add(controller);
    await runtime.reconcile(snapshot(first));
    const token = runtime.behaviorCatalog.snapshot()[0]?.candidateToken;

    await runtime.reconcile(
      snapshot(record(id, declareBehavior(Behavior), { grantGeneration: 2 })),
    );
    expect(runtime.behaviorCatalog.snapshot()[0]?.candidateToken).toBe(token);
    expect(runtime.behaviorCatalog.snapshot()[0]?.authorized).toBe(true);
    await runtime.close();
  });
});
