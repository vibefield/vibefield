import {
  PLUGIN_LIMITS,
  type PluginModuleUrls,
  type PluginRecord,
  type PluginRegistrySnapshot,
} from "@vibefield/contracts";
import type { Disposable, RendererPluginContext } from "@vibefield/plugin-sdk";
import { act, type ComponentType, createElement } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";
import { isCommandBound } from "../src/plugin-host/command-registry";
import {
  RendererPluginController,
  type RendererPluginControllerDeps,
  RendererWindowController,
} from "../src/plugin-host/renderer-controller";
import { getSurfacesSnapshot, subscribeSurfaces } from "../src/plugin-host/surface-registry";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

interface Deferred<T> {
  readonly promise: Promise<T>;
  resolve(value: T): void;
}

function deferred<T = void>(): Deferred<T> {
  let resolvePromise!: (value: T) => void;
  const promise = new Promise<T>((resolve) => {
    resolvePromise = resolve;
  });
  return { promise, resolve: resolvePromise };
}

function record(
  id: string,
  options: {
    readonly enabled?: boolean;
    readonly grantGeneration?: number;
    readonly grantedCapabilities?: readonly string[];
    readonly installRevision?: string;
    readonly commandsAndSurfaces?: boolean;
  } = {},
): PluginRecord {
  const commandsAndSurfaces = options.commandsAndSurfaces ?? true;
  const enabled = options.enabled ?? true;
  return {
    id,
    version: "1.0.0",
    title: `${id} plugin`,
    source: "bundled",
    manifestHash: `sha256:${"c".repeat(64)}`,
    installRevision: options.installRevision ?? "renderer-controller-a",
    state: enabled ? "enabled" : "disabled",
    compatible: true,
    enabled,
    requestedCapabilities: ["shell.open", "storage.self"],
    grantedCapabilities: [...(options.grantedCapabilities ?? ["shell.open"])],
    deniedCapabilities: [],
    grantGeneration: options.grantGeneration ?? 1,
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
      commands: commandsAndSurfaces ? [{ id: `${id}.run`, title: "Run" }] : [],
      surfaces: commandsAndSurfaces
        ? [{ id: `${id}.panel`, title: "Panel", slot: "hud.attention" }]
        : [],
      capabilities: [],
    },
    renderer: "inactive",
    service: "none",
  } as unknown as PluginRecord;
}

function moduleRow(id: string, styleUrl?: string): PluginModuleUrls {
  return {
    pluginId: id,
    moduleUrl: `vibefield-plugin://${id.replaceAll(".", "").padEnd(32, "0").slice(0, 32)}`,
    manifestHash: `sha256:${"c".repeat(64)}`,
    installRevision: "renderer-controller-a",
    ...(styleUrl === undefined ? {} : { styleUrl }),
  };
}

function snapshot(...plugins: PluginRecord[]): PluginRegistrySnapshot {
  return { generation: 1, plugins, problems: [] } as PluginRegistrySnapshot;
}

function hasSurface(surfaceId: string): boolean {
  return getSurfacesSnapshot().some((surface) => surface.surfaceId === surfaceId);
}

function withSecondSurface(plugin: PluginRecord): PluginRecord {
  return {
    ...plugin,
    contributions: {
      ...plugin.contributions,
      surfaces: [
        ...plugin.contributions.surfaces,
        { id: `${plugin.id}.attention`, title: "Attention", slot: "hud.attention" },
      ],
    },
  } as unknown as PluginRecord;
}

function withLateContributions(plugin: PluginRecord): PluginRecord {
  return {
    ...plugin,
    contributions: {
      ...plugin.contributions,
      widgets: [
        ...plugin.contributions.widgets,
        {
          type: `${plugin.id}.late`,
          title: "Late",
          schemaVersion: 1,
          surface: "dom",
          sizeMode: "fixed",
          defaultSize: { w: 100, h: 100 },
          props: {},
          groups: {},
        },
      ],
      commands: [...plugin.contributions.commands, { id: `${plugin.id}.late`, title: "Late" }],
      surfaces: [
        ...plugin.contributions.surfaces,
        { id: `${plugin.id}.late`, title: "Late", slot: "hud.attention" },
      ],
    },
  } as unknown as PluginRecord;
}

function testDeps(
  overrides: Partial<RendererPluginControllerDeps> = {},
): RendererPluginControllerDeps {
  return {
    refreshCredential: async () => undefined,
    retireCredential: () => undefined,
    ...overrides,
  };
}

describe("the renderer/window target controller", () => {
  it("keeps every host publication private through setup and withdraws it at the disable edge", async () => {
    const id = "prc.renderer.controller.private";
    const activated = deferred<void>();
    const release = deferred<void>();
    const doc = document.implementation.createHTMLDocument("renderer style");
    const styleUrl = "data:text/css,.plugin%7Bcolor%3Ared%7D";
    let signal: AbortSignal | undefined;
    const controller = new RendererPluginController(
      record(id),
      moduleRow(id, styleUrl),
      {
        async activate(ctx) {
          signal = ctx.signal;
          ctx.widgets.register({ type: `${id}.card`, binding: { component: () => null } });
          ctx.commands?.register(`${id}.run`, () => undefined);
          ctx.surfaces?.register(`${id}.panel`, () => null);
          activated.resolve();
          await release.promise;
        },
      },
      "field",
      testDeps({ style: { document: doc, href: styleUrl } }),
    );
    const runtime = new RendererWindowController("field");
    runtime.add(controller);

    const loading = runtime.reconcile(snapshot(record(id)));
    await activated.promise;
    expect(isCommandBound(`${id}.run`)).toBe(false);
    expect(hasSurface(`${id}.panel`)).toBe(false);
    expect(doc.querySelector("link[data-vf-plugin-style]")).toBeNull();

    release.resolve();
    await loading;
    expect(isCommandBound(`${id}.run`)).toBe(true);
    expect(hasSurface(`${id}.panel`)).toBe(true);
    expect(doc.querySelector("link[data-vf-plugin-style]")?.getAttribute("href")).toBe(styleUrl);

    const disabled = runtime.reconcile(
      snapshot(record(id, { enabled: false, grantGeneration: 2 })),
    );
    // No await: durable authority closes all public ingress before reconcile returns its promise.
    expect(signal?.aborted).toBe(true);
    expect(isCommandBound(`${id}.run`)).toBe(false);
    expect(hasSurface(`${id}.panel`)).toBe(false);
    expect(doc.querySelector("link[data-vf-plugin-style]")).toBeNull();
    await disabled;
    await runtime.close();
  });

  it("cannot resurrect an activation superseded while it is still loading", async () => {
    const id = "prc.renderer.controller.stale";
    const registered = deferred<void>();
    const release = deferred<void>();
    const signals: AbortSignal[] = [];
    let activations = 0;
    const controller = new RendererPluginController(
      record(id),
      moduleRow(id),
      {
        async activate(ctx) {
          activations += 1;
          signals.push(ctx.signal);
          ctx.widgets.register({ type: `${id}.card`, binding: { component: () => null } });
          ctx.commands?.register(`${id}.run`, () => undefined);
          ctx.surfaces?.register(`${id}.panel`, () => null);
          if (activations === 1) {
            registered.resolve();
            await release.promise;
          }
        },
      },
      "field",
      testDeps(),
    );
    const runtime = new RendererWindowController("field");
    runtime.add(controller);

    const loading = runtime.reconcile(snapshot(record(id)));
    await registered.promise;
    const disabling = runtime.reconcile(
      snapshot(record(id, { enabled: false, grantGeneration: 2 })),
    );
    expect(signals[0]?.aborted).toBe(true);
    release.resolve();
    await Promise.all([loading, disabling]);
    expect(isCommandBound(`${id}.run`)).toBe(false);
    expect(hasSurface(`${id}.panel`)).toBe(false);

    await runtime.reconcile(snapshot(record(id, { grantGeneration: 3 })));
    expect(activations).toBe(2);
    expect(signals[1]?.aborted).toBe(false);
    expect(isCommandBound(`${id}.run`)).toBe(true);
    await runtime.close();
  });

  it("publishes and withdraws a multi-surface activation as one observable batch", async () => {
    const id = "prc.renderer.controller.batch";
    const row = withSecondSurface(record(id));
    const observations: string[][] = [];
    const unsubscribe = subscribeSurfaces(() => {
      observations.push(
        getSurfacesSnapshot()
          .filter((surface) => surface.pluginId === id)
          .map((surface) => surface.surfaceId)
          .sort(),
      );
    });
    const controller = new RendererPluginController(
      row,
      moduleRow(id),
      {
        activate(ctx) {
          ctx.surfaces?.register(`${id}.panel`, () => null);
          ctx.surfaces?.register(`${id}.attention`, () => null);
        },
      },
      "field",
      testDeps(),
    );
    try {
      await controller.reconcile(row);
      expect(observations).toEqual([[`${id}.attention`, `${id}.panel`]]);

      observations.length = 0;
      const disabling = controller.reconcile(
        withSecondSurface(record(id, { enabled: false, grantGeneration: 2 })),
      );
      expect(observations).toEqual([[]]);
      await disabling;
      await controller.close();
    } finally {
      unsubscribe();
    }
  });

  it("publishes later acquisitions through the same open activation owner", async () => {
    const id = "prc.renderer.controller.late-binding";
    const row = withLateContributions(record(id));
    let retained: RendererPluginContext | undefined;
    const controller = new RendererPluginController(
      row,
      moduleRow(id),
      {
        activate(ctx) {
          retained = ctx;
          ctx.widgets.register({ type: `${id}.card`, binding: { component: () => null } });
        },
      },
      "field",
      testDeps(),
    );
    await controller.reconcile(row);

    // ICE asks once. The facade must still follow a binding acquired later by the same live scope.
    const binding = controller.widgetBinding(`${id}.late`, "dom");
    const host = document.createElement("div");
    const root = createRoot(host);
    await act(async () => {
      root.render(createElement(binding.component as ComponentType<Record<string, unknown>>, {}));
    });
    expect(host.textContent).not.toContain("late-live");

    const context = retained;
    if (context === undefined || context.commands === undefined || context.surfaces === undefined)
      throw new Error("activation did not retain its declared binding APIs");
    let widget!: Disposable;
    let command!: Disposable;
    let surface!: Disposable;
    await act(async () => {
      widget = context.widgets.register({
        type: `${id}.late`,
        binding: { component: () => createElement("span", null, "late-live") },
      });
      command = context.commands!.register(`${id}.late`, () => undefined);
      surface = context.surfaces!.register(`${id}.late`, () => null);
    });
    expect(host.textContent).toBe("late-live");
    expect(isCommandBound(`${id}.late`)).toBe(true);
    expect(hasSurface(`${id}.late`)).toBe(true);

    await act(async () => {
      await surface.dispose();
      await command.dispose();
      await widget.dispose();
    });
    expect(host.textContent).not.toContain("late-live");
    expect(isCommandBound(`${id}.late`)).toBe(false);
    expect(hasSurface(`${id}.late`)).toBe(false);

    await act(async () => root.unmount());
    await controller.close();
  });

  it("refreshes observation-only grants in place and swaps the stable widget facade on authority change", async () => {
    const id = "prc.renderer.controller.observation";
    const refreshes: number[] = [];
    const signals: AbortSignal[] = [];
    let activations = 0;
    const controller = new RendererPluginController(
      record(id),
      moduleRow(id),
      {
        activate(ctx) {
          activations += 1;
          const generation = activations;
          signals.push(ctx.signal);
          ctx.widgets.register({
            type: `${id}.card`,
            binding: {
              component: () => createElement("span", null, `generation-${generation}`),
            },
          });
        },
      },
      "field",
      testDeps({
        refreshCredential: async (_pluginId, observation) => {
          refreshes.push(observation.grantGeneration);
        },
      }),
    );
    await controller.reconcile(record(id));

    const binding = controller.widgetBinding(`${id}.card`, "dom");
    const host = document.createElement("div");
    const root = createRoot(host);
    await act(async () => {
      root.render(createElement(binding.component as ComponentType<Record<string, unknown>>, {}));
    });
    expect(host.textContent).toBe("generation-1");

    await controller.reconcile(record(id, { grantGeneration: 2 }));
    expect(activations).toBe(1);
    expect(refreshes).toEqual([2]);
    expect(signals[0]?.aborted).toBe(false);

    await act(async () => {
      await controller.reconcile(
        record(id, {
          grantGeneration: 3,
          grantedCapabilities: ["shell.open", "storage.self"],
        }),
      );
    });
    expect(activations).toBe(2);
    expect(signals[0]?.aborted).toBe(true);
    expect(signals[1]?.aborted).toBe(false);
    expect(host.textContent).toBe("generation-2");

    await act(async () => {
      root.unmount();
    });
    await controller.close();
  });

  it("fences boot-static artifact bytes instead of running them under a new install identity", async () => {
    const id = "prc.renderer.controller.artifact";
    let activations = 0;
    let signal: AbortSignal | undefined;
    const controller = new RendererPluginController(
      record(id),
      moduleRow(id),
      {
        activate(ctx) {
          activations += 1;
          signal = ctx.signal;
          ctx.widgets.register({ type: `${id}.card`, binding: { component: () => null } });
          ctx.commands?.register(`${id}.run`, () => undefined);
        },
      },
      "field",
      testDeps(),
    );
    await controller.reconcile(record(id));

    const changed = controller.reconcile(
      record(id, { grantGeneration: 2, installRevision: "renderer-controller-b" }),
    );
    expect(signal?.aborted).toBe(true);
    expect(isCommandBound(`${id}.run`)).toBe(false);
    await changed;
    await controller.reconcile(
      record(id, { grantGeneration: 3, installRevision: "renderer-controller-b" }),
    );
    expect(activations).toBe(1);
    expect(controller.snapshot.desired).toBeNull();
    await controller.close();
  });

  it("isolates the same plugin's exact per-window lifetimes", async () => {
    const id = "prc.renderer.controller.windows";
    const signals = new Map<string, AbortSignal>();
    const mod = (windowId: string) => ({
      activate(ctx: RendererPluginContext) {
        signals.set(windowId, ctx.signal);
        ctx.widgets.register({ type: `${id}.card`, binding: { component: () => null } });
      },
    });
    const row = record(id, { commandsAndSurfaces: false });
    const a = new RendererPluginController(
      row,
      moduleRow(id),
      mod("window-a"),
      "window-a",
      testDeps(),
    );
    const b = new RendererPluginController(
      row,
      moduleRow(id),
      mod("window-b"),
      "window-b",
      testDeps(),
    );
    const windowA = new RendererWindowController("window-a");
    const windowB = new RendererWindowController("window-b");
    windowA.add(a);
    windowB.add(b);
    await Promise.all([windowA.reconcile(snapshot(row)), windowB.reconcile(snapshot(row))]);
    const signalA = signals.get("window-a");
    const signalB = signals.get("window-b");
    expect(signalA?.aborted).toBe(false);
    expect(signalB?.aborted).toBe(false);

    const closeA = windowA.close();
    expect(signalA?.aborted).toBe(true);
    expect(signalB?.aborted).toBe(false);
    await closeA;
    expect(b.snapshot.state).toBe("active");
    await windowB.close();
    expect(signalB?.aborted).toBe(true);
  });

  it("awaits cooperative window cleanup after sealing ingress", async () => {
    const id = "prc.renderer.controller.window-close";
    const release = deferred<void>();
    let signal: AbortSignal | undefined;
    const controller = new RendererPluginController(
      record(id),
      moduleRow(id),
      {
        activate(ctx) {
          signal = ctx.signal;
          ctx.commands?.register(`${id}.run`, () => undefined);
          return { dispose: async () => release.promise } satisfies Disposable;
        },
      },
      "field",
      testDeps(),
    );
    const runtime = new RendererWindowController("field");
    runtime.add(controller);
    await runtime.reconcile(snapshot(record(id)));

    let closed = false;
    const closing = runtime.close().then(() => {
      closed = true;
    });
    expect(signal?.aborted).toBe(true);
    expect(isCommandBound(`${id}.run`)).toBe(false);
    await Promise.resolve();
    await Promise.resolve();
    expect(closed).toBe(false);
    release.resolve();
    await closing;
    expect(closed).toBe(true);
  });

  it("reports same-realm non-quiescence instead of claiming a bounded close terminated code", async () => {
    vi.useFakeTimers();
    const id = "prc.renderer.controller.nonquiescent";
    const release = deferred<void>();
    const controller = new RendererPluginController(
      record(id, { commandsAndSurfaces: false }),
      moduleRow(id),
      {
        activate() {
          return { dispose: async () => release.promise } satisfies Disposable;
        },
      },
      "field",
      testDeps(),
    );
    try {
      await controller.reconcile(record(id, { commandsAndSurfaces: false }));
      const closing = controller.close();
      const rejected = expect(closing).rejects.toThrow(/did not quiesce.*non-quiescent/);
      await vi.advanceTimersByTimeAsync(PLUGIN_LIMITS.DEACTIVATE_DEADLINE_MS + 1);
      await rejected;
      expect(controller.snapshot).toMatchObject({
        state: "non-quiescent",
        blocked: { phase: "unload" },
      });

      release.resolve();
      await vi.advanceTimersByTimeAsync(0);
      for (let turn = 0; turn < 200 && controller.snapshot.state !== "inactive"; turn += 1) {
        await Promise.resolve();
      }
      expect(controller.snapshot.state, JSON.stringify(controller.snapshot, null, 2)).toBe(
        "inactive",
      );
      await expect(controller.close()).resolves.toBeUndefined();
    } finally {
      release.resolve();
      vi.useRealTimers();
    }
  });
});
