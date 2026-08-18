import {
  PLUGIN_LIMITS,
  type PluginModuleUrls,
  type PluginRecord,
  type PluginRegistrySnapshot,
} from "@vibefield/contracts";
import type {
  Disposable,
  PluginProductClient,
  RendererPluginContext,
  RendererPluginModule,
} from "@vibefield/plugin-sdk";
import { act, type ComponentType, createElement } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";
import type { RendererLogger } from "../src/logging";
import { isCommandBound } from "../src/plugin-host/command-registry";
import {
  RendererPluginController,
  type RendererPluginControllerDeps,
  type RendererReplacementSource,
  RendererWindowController,
} from "../src/plugin-host/renderer-controller";
import { RendererUpdateParticipant } from "../src/plugin-host/renderer-update-participant";
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

function replacementRecord(
  old: PluginRecord,
  slotChar: string,
  overrides: Partial<PluginRecord> = {},
): PluginRecord {
  const slot = slotChar.repeat(64);
  return {
    ...old,
    version: "2.0.0",
    source: "registry",
    manifestHash: `sha256:${slot}`,
    installRevision: slot,
    grantGeneration: old.grantGeneration + 1,
    renderer: "inactive",
    ...overrides,
  } as PluginRecord;
}

function replacementModule(record: PluginRecord, token: string): PluginModuleUrls {
  return {
    pluginId: record.id,
    moduleUrl: `vibefield-plugin://${token}`,
    manifestHash: record.manifestHash,
    installRevision: record.installRevision,
  };
}

function artifact(record: PluginRecord) {
  return {
    pluginId: record.id,
    installRevision: record.installRevision,
    manifestHash: record.manifestHash,
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

function lifecycleLogger() {
  const calls = {
    trace: vi.fn(),
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    fatal: vi.fn(),
  };
  const logger: RendererLogger = {
    child: () => logger,
    ...calls,
    isLevelEnabled: () => true,
  };
  return { logger, calls };
}

describe("the renderer/window target controller", () => {
  it("logs each lifecycle transition once, reports latest state, and polling emits nothing", async () => {
    const id = "prc.renderer.controller.diagnostics";
    const { logger, calls } = lifecycleLogger();
    const reports = vi.fn();
    const controller = new RendererPluginController(
      record(id),
      moduleRow(id),
      {
        activate(ctx) {
          ctx.widgets.register({ type: `${id}.card`, binding: { component: () => null } });
        },
      },
      "field",
      testDeps({ logger, onDiagnosticsChanged: reports }),
    );

    await controller.reconcile(record(id));
    const logCount = () =>
      calls.trace.mock.calls.length +
      calls.debug.mock.calls.length +
      calls.info.mock.calls.length +
      calls.warn.mock.calls.length +
      calls.error.mock.calls.length +
      calls.fatal.mock.calls.length;
    expect(logCount()).toBe(controller.diagnostic().history.length);
    expect(reports).toHaveBeenCalledTimes(logCount());
    const beforePoll = logCount();
    for (let index = 0; index < 100; index += 1) controller.diagnostic();
    expect(logCount()).toBe(beforePoll);

    await controller.close();
    expect(logCount()).toBe(controller.diagnostic().history.length);
    expect(reports).toHaveBeenCalledTimes(logCount());
    for (const call of [
      ...calls.debug.mock.calls,
      ...calls.info.mock.calls,
      ...calls.warn.mock.calls,
      ...calls.error.mock.calls,
    ]) {
      expect(call[0]).toBe("renderer.plugin_runtime.lifecycle");
    }
  });

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
      testDeps({ style: { document: doc } }),
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

describe("PRC-5d renderer replacement participant", () => {
  it("imports only after old quiescence, uses candidate product authority, and commits through one stable facade", async () => {
    const id = "prc.renderer.replacement.commit";
    const oldRecord = record(id);
    const candidateRecord = replacementRecord(oldRecord, "b");
    const oldDisposed = deferred<void>();
    const oldDisposeStarted = deferred<void>();
    const events: string[] = [];
    let oldSignal: AbortSignal | undefined;
    const oldClient: PluginProductClient = {
      request: async () => "old-authority",
      subscribe: async () => ({ snapshot: null, unsubscribe: () => undefined }),
    };
    const candidateClient: PluginProductClient = {
      request: async () => "candidate-authority",
      subscribe: async () => ({ snapshot: null, unsubscribe: () => undefined }),
    };
    let candidateAuthorityReleases = 0;
    const candidateRefreshes: number[] = [];
    const controller = new RendererPluginController(
      oldRecord,
      moduleRow(id),
      {
        activate(ctx) {
          oldSignal = ctx.signal;
          ctx.widgets.register({
            type: `${id}.card`,
            binding: { component: () => createElement("span", null, "old-renderer") },
          });
          ctx.commands?.register(`${id}.run`, () => undefined);
          return {
            dispose: async () => {
              events.push("old-dispose-start");
              oldDisposeStarted.resolve();
              await oldDisposed.promise;
              events.push("old-disposed");
            },
          } satisfies Disposable;
        },
      },
      "field",
      testDeps({ productClient: oldClient }),
    );
    const runtime = new RendererWindowController("field");
    runtime.add(controller);
    const participant = new RendererUpdateParticipant(runtime);
    await runtime.reconcile(snapshot(oldRecord));

    const stableBinding = controller.widgetBinding(`${id}.card`, "dom");
    const host = document.createElement("div");
    const root = createRoot(host);
    await act(async () => {
      root.render(createElement(stableBinding.component as ComponentType<Record<string, unknown>>));
    });
    expect(host.textContent).toBe("old-renderer");

    const candidateRecordInput = structuredClone(candidateRecord);
    const candidateModuleInput = replacementModule(candidateRecord, "candidate-commit");
    const candidateSource: RendererReplacementSource = {
      record: candidateRecordInput,
      module: candidateModuleInput,
      productClient: candidateClient,
      refreshCredential: async (observation) => {
        candidateRefreshes.push(observation.grantGeneration);
      },
      releaseAuthority: () => {
        candidateAuthorityReleases += 1;
      },
      load: async () => {
        events.push("candidate-import");
        expect(events).toContain("old-disposed");
        return {
          async activate(ctx) {
            events.push(`client:${await ctx.client.request("authority.who", {})}`);
            ctx.widgets.register({
              type: `${id}.card`,
              binding: { component: () => createElement("span", null, "candidate-renderer") },
            });
            ctx.commands?.register(`${id}.run`, () => undefined);
          },
        } satisfies RendererPluginModule;
      },
    };
    let preparing!: ReturnType<typeof participant.prepare>;
    await act(async () => {
      preparing = participant.prepare(
        {
          kind: "prepare",
          updateId: "pupd_renderer_commit",
          oldArtifact: artifact(oldRecord),
          candidateArtifact: artifact(candidateRecord),
        },
        candidateSource,
      );
      await oldDisposeStarted.promise;
    });
    expect(oldSignal?.aborted).toBe(true);
    expect(isCommandBound(`${id}.run`)).toBe(false);
    expect(events).toContain("old-dispose-start");
    expect(events).not.toContain("candidate-import");

    // Delayed activation consumes the defensively copied source, not caller-owned objects that
    // can change after code-free validation and target projection.
    (candidateRecordInput.contributions.widgets[0] as { type: string }).type = `${id}.tampered`;
    (candidateModuleInput as { manifestHash: string }).manifestHash = `sha256:${"f".repeat(64)}`;

    oldDisposed.resolve();
    let prepared: Awaited<typeof preparing> | undefined;
    await act(async () => {
      prepared = await preparing;
    });
    expect(prepared?.kind).toBe("prepared");
    expect(events).toContain("client:candidate-authority");
    expect(isCommandBound(`${id}.run`)).toBe(false);
    expect(host.textContent).not.toBe("old-renderer");
    expect(host.textContent).not.toBe("candidate-renderer");

    // The registry/pointer observation arrives before the explicit commit command.
    await runtime.reconcile(snapshot(candidateRecord));
    expect(controller.snapshot.state).toBe("prepared");
    expect(isCommandBound(`${id}.run`)).toBe(false);
    expect(() =>
      runtime.commitReplacement({
        updateId: "pupd_renderer_commit",
        candidateArtifact: { ...artifact(candidateRecord), installRevision: "0".repeat(64) },
        commitEpoch: 2,
      }),
    ).toThrow(/candidate artifact identity/);
    expect(() =>
      runtime.commitReplacement({
        updateId: "pupd_renderer_commit",
        candidateArtifact: artifact(candidateRecord),
        commitEpoch: 0,
      }),
    ).toThrow(/epoch must be positive/);

    await act(async () => {
      expect(
        participant.commit({
          kind: "commit",
          updateId: "pupd_renderer_commit",
          candidateArtifact: artifact(candidateRecord),
          commitEpoch: 2,
        }),
      ).toMatchObject({
        kind: "committed",
        updateId: "pupd_renderer_commit",
        commitEpoch: 2,
      });
    });
    expect(controller.widgetBinding(`${id}.card`, "dom")).toBe(stableBinding);
    expect(host.textContent).toBe("candidate-renderer");
    expect(isCommandBound(`${id}.run`)).toBe(true);

    await controller.reconcile({ ...candidateRecord, grantGeneration: 3 });
    expect(candidateRefreshes).toEqual([3]);

    await act(async () => root.unmount());
    await runtime.close();
    expect(candidateAuthorityReleases).toBe(1);
  });

  it("refuses a changed fixed widget projection before old authority closes", async () => {
    const id = "prc.renderer.replacement.projection";
    const oldRecord = record(id);
    let oldSignal: AbortSignal | undefined;
    const controller = new RendererPluginController(
      oldRecord,
      moduleRow(id),
      {
        activate(ctx) {
          oldSignal = ctx.signal;
          ctx.widgets.register({ type: `${id}.card`, binding: { component: () => null } });
          ctx.commands?.register(`${id}.run`, () => undefined);
        },
      },
      "field",
      testDeps(),
    );
    const runtime = new RendererWindowController("field");
    runtime.add(controller);
    await runtime.reconcile(snapshot(oldRecord));
    const changed = replacementRecord(oldRecord, "c", {
      contributions: {
        ...oldRecord.contributions,
        widgets: oldRecord.contributions.widgets.map((widget) => ({
          ...widget,
          defaultSize: { w: 200, h: 100 },
        })),
      },
    });
    let imported = false;

    await expect(
      runtime.prepareReplacement({
        updateId: "pupd_renderer_projection",
        oldArtifact: artifact(oldRecord),
        candidateArtifact: artifact(changed),
        candidate: {
          record: changed,
          module: replacementModule(changed, "candidate-projection"),
          load: async () => {
            imported = true;
            return { activate: () => undefined };
          },
        },
      }),
    ).rejects.toThrow(/fixed widget projection/);
    expect(oldSignal?.aborted).toBe(false);
    expect(isCommandBound(`${id}.run`)).toBe(true);
    expect(imported).toBe(false);
    await runtime.close();
  });

  it("recovers retained old bytes through a fresh module URL after candidate failure", async () => {
    const id = "prc.renderer.replacement.recover";
    const oldRecord = record(id);
    const candidateRecord = replacementRecord(oldRecord, "d");
    const externalHistory: string[] = [];
    const controller = new RendererPluginController(
      oldRecord,
      moduleRow(id),
      {
        activate(ctx) {
          ctx.widgets.register({ type: `${id}.card`, binding: { component: () => null } });
          ctx.commands?.register(`${id}.run`, () => undefined);
        },
      },
      "field",
      testDeps(),
    );
    const runtime = new RendererWindowController("field");
    runtime.add(controller);
    await runtime.reconcile(snapshot(oldRecord));

    const failed = await runtime.prepareReplacement({
      updateId: "pupd_renderer_recover",
      oldArtifact: artifact(oldRecord),
      candidateArtifact: artifact(candidateRecord),
      candidate: {
        record: candidateRecord,
        module: replacementModule(candidateRecord, "candidate-fails"),
        load: async () => ({
          activate() {
            externalHistory.push("network:emitted");
            throw new Error("candidate exploded");
          },
        }),
      },
    });
    expect(failed.state).toBe("failed");
    expect(externalHistory).toEqual(["network:emitted"]);
    expect(isCommandBound(`${id}.run`)).toBe(false);

    await expect(
      runtime.recoverOld({
        updateId: "pupd_renderer_recover",
        oldArtifact: artifact(oldRecord),
        source: {
          record: oldRecord,
          module: moduleRow(id),
          load: async () => ({ activate: () => undefined }),
        },
      }),
    ).rejects.toThrow(/fresh module URL/);

    let oldRecoveryImports = 0;
    const recovered = await runtime.recoverOld({
      updateId: "pupd_renderer_recover",
      oldArtifact: artifact(oldRecord),
      source: {
        record: oldRecord,
        module: { ...moduleRow(id), moduleUrl: "vibefield-plugin://old-recovery-fresh" },
        load: async () => {
          oldRecoveryImports += 1;
          return {
            activate(ctx) {
              ctx.widgets.register({ type: `${id}.card`, binding: { component: () => null } });
              ctx.commands?.register(`${id}.run`, () => undefined);
            },
          };
        },
      },
    });
    expect(recovered.state).toBe("recovered-old");
    expect(oldRecoveryImports).toBe(1);
    expect(isCommandBound(`${id}.run`)).toBe(true);
    expect(externalHistory).toEqual(["network:emitted"]);
    await runtime.close();
  });

  it("invalidates a private candidate on an unrelated registry observation", async () => {
    const id = "prc.renderer.replacement.stale";
    const oldRecord = record(id);
    const candidateRecord = replacementRecord(oldRecord, "e");
    const controller = new RendererPluginController(
      oldRecord,
      moduleRow(id),
      {
        activate(ctx) {
          ctx.widgets.register({ type: `${id}.card`, binding: { component: () => null } });
        },
      },
      "field",
      testDeps(),
    );
    const runtime = new RendererWindowController("field");
    runtime.add(controller);
    await runtime.reconcile(snapshot(oldRecord));
    await runtime.prepareReplacement({
      updateId: "pupd_renderer_stale",
      oldArtifact: artifact(oldRecord),
      candidateArtifact: artifact(candidateRecord),
      candidate: {
        record: candidateRecord,
        module: replacementModule(candidateRecord, "candidate-stale"),
        load: async () => ({
          activate(ctx) {
            ctx.widgets.register({ type: `${id}.card`, binding: { component: () => null } });
          },
        }),
      },
    });

    const unrelated = replacementRecord(oldRecord, "f");
    await runtime.reconcile(snapshot(unrelated));
    expect(controller.snapshot.state).toBe("inactive");
    expect(() =>
      runtime.commitReplacement({
        updateId: "pupd_renderer_stale",
        candidateArtifact: artifact(candidateRecord),
        commitEpoch: 2,
      }),
    ).toThrow(/not prepared/);
    await runtime.close();
  });

  it("retains a committed candidate across a lagging old snapshot until candidate observation catches up", async () => {
    const id = "prc.renderer.replacement.snapshot-lag";
    const oldRecord = record(id);
    const candidateRecord = replacementRecord(oldRecord, "7");
    let candidateSignal: AbortSignal | undefined;
    const controller = new RendererPluginController(
      oldRecord,
      moduleRow(id),
      {
        activate(ctx) {
          ctx.widgets.register({ type: `${id}.card`, binding: { component: () => null } });
          ctx.commands?.register(`${id}.run`, () => undefined);
        },
      },
      "field",
      testDeps(),
    );
    const runtime = new RendererWindowController("field");
    runtime.add(controller);
    await runtime.reconcile(snapshot(oldRecord));
    await runtime.prepareReplacement({
      updateId: "pupd_renderer_snapshot_lag",
      oldArtifact: artifact(oldRecord),
      candidateArtifact: artifact(candidateRecord),
      candidate: {
        record: candidateRecord,
        module: replacementModule(candidateRecord, "candidate-snapshot-lag"),
        load: async () => ({
          activate(ctx) {
            candidateSignal = ctx.signal;
            ctx.widgets.register({ type: `${id}.card`, binding: { component: () => null } });
            ctx.commands?.register(`${id}.run`, () => undefined);
          },
        }),
      },
    });

    runtime.commitReplacement({
      updateId: "pupd_renderer_snapshot_lag",
      candidateArtifact: artifact(candidateRecord),
      commitEpoch: 2,
    });
    await runtime.reconcile(snapshot(oldRecord));
    expect(candidateSignal?.aborted).toBe(false);
    expect(controller.snapshot.state).toBe("active");
    expect(isCommandBound(`${id}.run`)).toBe(true);
    await expect(
      runtime.recoverOld({
        updateId: "pupd_renderer_snapshot_lag",
        oldArtifact: artifact(oldRecord),
        source: {
          record: oldRecord,
          module: { ...moduleRow(id), moduleUrl: "vibefield-plugin://forbidden-old-recovery" },
          load: async () => ({ activate: () => undefined }),
        },
      }),
    ).rejects.toThrow(/not available/);

    await runtime.reconcile(snapshot(candidateRecord));
    const nextRecord = replacementRecord(candidateRecord, "8");
    await expect(
      runtime.prepareReplacement({
        updateId: "pupd_renderer_after_catchup",
        oldArtifact: artifact(candidateRecord),
        candidateArtifact: artifact(nextRecord),
        candidate: {
          record: nextRecord,
          module: replacementModule(nextRecord, "candidate-after-catchup"),
          load: async () => ({
            activate(ctx) {
              ctx.widgets.register({ type: `${id}.card`, binding: { component: () => null } });
            },
          }),
        },
      }),
    ).resolves.toMatchObject({ state: "prepared" });
    await runtime.close();
  });

  it("requires renderer-boundary replacement when old same-realm cleanup does not quiesce", async () => {
    vi.useFakeTimers();
    const id = "prc.renderer.replacement.nonquiescent";
    const oldRecord = record(id, { commandsAndSurfaces: false });
    const candidateRecord = replacementRecord(oldRecord, "9");
    const release = deferred<void>();
    let imported = false;
    let authorityReleases = 0;
    const controller = new RendererPluginController(
      oldRecord,
      moduleRow(id),
      {
        activate(ctx) {
          ctx.widgets.register({ type: `${id}.card`, binding: { component: () => null } });
          return { dispose: async () => release.promise } satisfies Disposable;
        },
      },
      "field",
      testDeps(),
    );
    const runtime = new RendererWindowController("field");
    runtime.add(controller);
    try {
      await runtime.reconcile(snapshot(oldRecord));
      const preparing = runtime.prepareReplacement({
        updateId: "pupd_renderer_nonquiescent",
        oldArtifact: artifact(oldRecord),
        candidateArtifact: artifact(candidateRecord),
        candidate: {
          record: candidateRecord,
          module: replacementModule(candidateRecord, "candidate-must-not-import"),
          load: async () => {
            imported = true;
            return { activate: () => undefined };
          },
          releaseAuthority: () => {
            authorityReleases += 1;
          },
        },
      });
      await vi.advanceTimersByTimeAsync(PLUGIN_LIMITS.DEACTIVATE_DEADLINE_MS + 1);
      await expect(preparing).resolves.toMatchObject({ state: "boundary-required" });
      expect(imported).toBe(false);
      expect(authorityReleases).toBe(1);
      expect(controller.snapshot).toMatchObject({
        desired: null,
        blocked: { phase: "unload" },
      });
      await expect(
        runtime.recoverOld({
          updateId: "pupd_renderer_nonquiescent",
          oldArtifact: artifact(oldRecord),
          source: {
            record: oldRecord,
            module: { ...moduleRow(id), moduleUrl: "vibefield-plugin://old-after-block" },
            load: async () => ({ activate: () => undefined }),
          },
        }),
      ).resolves.toMatchObject({ state: "boundary-required" });

      release.resolve();
      await vi.advanceTimersByTimeAsync(0);
      for (let turn = 0; turn < 200 && controller.snapshot.state !== "inactive"; turn += 1) {
        await Promise.resolve();
      }
      expect(controller.snapshot.state).toBe("inactive");
      expect(imported).toBe(false);
      expect(authorityReleases).toBe(1);
      await expect(runtime.close()).resolves.toBeUndefined();
    } finally {
      release.resolve();
      vi.useRealTimers();
    }
  });
});
