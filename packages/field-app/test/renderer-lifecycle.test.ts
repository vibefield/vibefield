import { PLUGIN_LIMITS, type PluginModuleUrls, type PluginRecord } from "@vibefield/contracts";
import type { Disposable, RendererPluginContext } from "@vibefield/plugin-sdk";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { isCommandBound } from "../src/plugin-host/command-registry";
import {
  activateStagedRenderer,
  rendererActivationState,
} from "../src/plugin-host/renderer-harness";
import { getSurfacesSnapshot } from "../src/plugin-host/surface-registry";

const productSubscriptions = { active: 0, unsubscribes: 0 };

function productClient() {
  return {
    request: async () => ({}),
    subscribe: async () => {
      productSubscriptions.active += 1;
      let live = true;
      return {
        snapshot: { values: {} },
        unsubscribe() {
          if (!live) return;
          live = false;
          productSubscriptions.active -= 1;
          productSubscriptions.unsubscribes += 1;
        },
      };
    },
  };
}

interface Deferred<T> {
  readonly promise: Promise<T>;
  resolve(value: T): void;
}

function deferred<T>(): Deferred<T> {
  let resolvePromise: ((value: T) => void) | undefined;
  const promise = new Promise<T>((resolve) => {
    resolvePromise = resolve;
  });
  return { promise, resolve: (value) => resolvePromise?.(value) };
}

function record(id: string, capabilities: readonly string[] = []): PluginRecord {
  return {
    id,
    version: "1.0.0",
    title: `${id} plugin`,
    source: "bundled",
    manifestHash: `sha256:${"a".repeat(64)}`,
    installRevision: "revision-1",
    state: "enabled",
    compatible: true,
    enabled: true,
    requestedCapabilities: capabilities,
    grantedCapabilities: capabilities,
    deniedCapabilities: [],
    grantGeneration: 1,
    contributions: {
      widgets: [
        {
          type: `${id}.card`,
          title: "Card",
          schemaVersion: 1,
          surface: "dom",
          sizeMode: "fixed",
          defaultSize: { w: 100, h: 100 },
          props: {},
          groups: {},
        },
      ],
      commands: [
        { id: `${id}.root`, title: "Root" },
        { id: `${id}.outer`, title: "Outer" },
      ],
      surfaces: [{ id: `${id}.panel`, title: "Panel", slot: "hud.attention" }],
      capabilities: [],
    },
    renderer: "inactive",
    service: "none",
  } as unknown as PluginRecord;
}

function moduleRow(id: string): PluginModuleUrls {
  return {
    pluginId: id,
    moduleUrl: `vibefield-plugin://${id.padEnd(32, "0").slice(0, 32)}`,
    manifestHash: `sha256:${"a".repeat(64)}`,
    installRevision: "revision-1",
  };
}

function hasSurface(surfaceId: string): boolean {
  return getSurfacesSnapshot().some((surface) => surface.surfaceId === surfaceId);
}

describe("renderer activation ownership", () => {
  beforeEach(() => {
    productSubscriptions.active = 0;
    productSubscriptions.unsubscribes = 0;
  });

  it("rolls every host registration back, awaits cleanup, and preserves the primary failure", async () => {
    const id = "prc.renderer.failure";
    let cleanupFinished = false;
    const activation = await activateStagedRenderer(
      record(id, ["storage.self"]),
      moduleRow(id),
      {
        async activate(ctx) {
          ctx.widgets.register({ type: `${id}.card`, binding: { component: () => null } });
          ctx.commands?.register(`${id}.root`, () => {});
          ctx.surfaces?.register(`${id}.panel`, () => null);
          await ctx.client.subscribe("events.subscribe", {}, () => {});
          ctx.settings?.subscribe("theme", () => {});
          ctx.track("failing-cleanup", {
            async dispose() {
              await Promise.resolve();
              cleanupFinished = true;
              throw new Error("cleanup failed");
            },
          });
          throw new Error("activation failed");
        },
      },
      { productClient: productClient() },
    );

    expect(activation.state).toBe("failed");
    expect(activation.error).toBe("activation failed");
    expect(cleanupFinished).toBe(true);
    expect(activation.bindings.size).toBe(0);
    expect(isCommandBound(`${id}.root`)).toBe(false);
    expect(hasSurface(`${id}.panel`)).toBe(false);
    expect(productSubscriptions).toEqual({ active: 0, unsubscribes: 2 });
    expect(activation.cleanup).toMatchObject({
      quiescent: true,
      liveCount: 0,
      errors: [{ label: "activate/failing-cleanup", message: "cleanup failed" }],
    });
  });

  it("returns a close handle, deduplicates exact resources, and drains successful activation", async () => {
    const id = "prc.renderer.success";
    const release = deferred<void>();
    let disposeCalls = 0;
    const shared: Disposable = {
      async dispose() {
        disposeCalls += 1;
        await release.promise;
      },
    };
    let retainedContext: RendererPluginContext | undefined;
    const activation = await activateStagedRenderer(record(id), moduleRow(id), {
      activate(ctx) {
        retainedContext = ctx;
        ctx.widgets.register({ type: `${id}.card`, binding: { component: () => null } });
        ctx.commands?.register(`${id}.root`, () => {});
        ctx.surfaces?.register(`${id}.panel`, () => null);
        ctx.track("shared", shared);
        ctx.track(shared);
        return shared;
      },
    });

    expect(activation.state).toBe("active");
    expect(activation.bindings.has(`${id}.card`)).toBe(true);
    expect(isCommandBound(`${id}.root`)).toBe(true);
    expect(hasSurface(`${id}.panel`)).toBe(true);
    const lifetime = activation.lifetime;
    expect(lifetime).toBeDefined();
    if (lifetime === undefined) throw new Error("active renderer has no lifetime");

    lifetime.close({ kind: "disable" });
    expect(activation.bindings.size).toBe(0);
    expect(retainedContext?.signal.aborted).toBe(true);
    expect(() =>
      retainedContext?.widgets.register({
        type: `${id}.card`,
        binding: { component: () => null },
      }),
    ).toThrow(/no longer open/);
    let quiescent = false;
    const closing = lifetime.whenQuiescent().then((report) => {
      quiescent = true;
      return report;
    });
    await Promise.resolve();
    await Promise.resolve();
    expect(quiescent).toBe(false);
    expect(disposeCalls).toBe(1);
    // Publication withdrawal is synchronous even while later LIFO resource cleanup is stalled.
    expect(isCommandBound(`${id}.root`)).toBe(false);
    expect(hasSurface(`${id}.panel`)).toBe(false);

    release.resolve();
    await expect(closing).resolves.toMatchObject({ quiescent: true, liveCount: 0 });
    expect(disposeCalls).toBe(1);
    expect(isCommandBound(`${id}.root`)).toBe(false);
    expect(hasSurface(`${id}.panel`)).toBe(false);
    expect(rendererActivationState(id)).toBeUndefined();
  });

  it("rolls back a child-bound effect without taking outer-context acquisitions with it", async () => {
    const id = "prc.renderer.child";
    let retainedChild: RendererPluginContext | undefined;
    let childDisposeCalls = 0;
    const activation = await activateStagedRenderer(record(id), moduleRow(id), {
      async activate(ctx) {
        ctx.commands?.register(`${id}.root`, () => {});
        await ctx
          .effect("optional-panel", async (fx) => {
            retainedChild = fx;
            fx.surfaces?.register(`${id}.panel`, () => null);
            fx.track("child-listener", {
              dispose() {
                childDisposeCalls += 1;
              },
            });
            // The outer context deliberately gives this registration root activation lifetime.
            ctx.commands?.register(`${id}.outer`, () => {});
            throw new Error("optional setup failed");
          })
          .catch(() => undefined);
      },
    });

    expect(activation.state).toBe("active");
    expect(childDisposeCalls).toBe(1);
    expect(hasSurface(`${id}.panel`)).toBe(false);
    expect(isCommandBound(`${id}.root`)).toBe(true);
    expect(isCommandBound(`${id}.outer`)).toBe(true);
    const child = retainedChild;
    if (child === undefined) throw new Error("effect did not expose its child context");
    const late = { dispose: vi.fn() };
    expect(() => child.track("too-late", late)).toThrow(/no longer open/);
    await Promise.resolve();
    await Promise.resolve();
    expect(late.dispose).toHaveBeenCalledTimes(1);

    activation.lifetime?.close({ kind: "disable" });
    await activation.lifetime?.whenQuiescent();
    expect(isCommandBound(`${id}.root`)).toBe(false);
    expect(isCommandBound(`${id}.outer`)).toBe(false);
  });

  it("blocks replacement while a timed-out activation is live, then admits retry after late cleanup", async () => {
    vi.useFakeTimers();
    const id = "prc.renderer.late";
    const lateResult = deferred<Disposable>();
    const late = { dispose: vi.fn() };
    let replacementCalls = 0;
    try {
      const pending = activateStagedRenderer(record(id), moduleRow(id), {
        activate(ctx) {
          ctx.widgets.register({ type: `${id}.card`, binding: { component: () => null } });
          return lateResult.promise;
        },
      });
      await vi.advanceTimersByTimeAsync(PLUGIN_LIMITS.RENDERER_ACTIVATE_DEADLINE_MS + 1);
      const overdue = await pending;
      expect(overdue).toMatchObject({
        state: "non-quiescent",
        cleanup: { quiescent: false, pendingSetups: 1 },
      });
      expect(overdue.bindings.size).toBe(0);

      const blocked = await activateStagedRenderer(record(id), moduleRow(id), {
        activate() {
          replacementCalls += 1;
        },
      });
      expect(blocked.state).toBe("non-quiescent");
      expect(replacementCalls).toBe(0);

      lateResult.resolve(late);
      await overdue.lifetime?.whenQuiescent();
      expect(late.dispose).toHaveBeenCalledTimes(1);

      const retried = await activateStagedRenderer(record(id), moduleRow(id), {
        activate() {
          replacementCalls += 1;
        },
      });
      expect(retried.state).toBe("active");
      expect(replacementCalls).toBe(1);
      retried.lifetime?.close({ kind: "disable" });
      await retried.lifetime?.whenQuiescent();
    } finally {
      vi.useRealTimers();
    }
  });
});
