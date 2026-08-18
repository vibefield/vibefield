import {
  type CallerContext,
  PLUGIN_RUNTIME_DIAGNOSTIC_LIMITS,
  PluginRecord,
  PluginRuntimeDiagnosticsSnapshot,
  PluginRuntimeReportParams,
  type PluginUpdateArtifact,
  type RendererParticipantIdentity,
} from "@vibefield/contracts";
import type {
  RendererRuntimeTarget,
  RuntimeTargetControllerDiagnostic,
  ServiceRuntimeTarget,
} from "@vibefield/plugin-runtime";
import { describe, expect, it, vi } from "vitest";
import { PluginRuntimeDiagnostics } from "../src/plugin-runtime-diagnostics";
import { PluginUpdateCoordinator } from "../src/plugin-update-coordinator";
import type { Handler, SubscriptionHandler, SubscriptionInstall } from "../src/product-api";

const PLUGIN_ID = "com.example.runtime-diagnostics";
const OLD: PluginUpdateArtifact = {
  pluginId: PLUGIN_ID,
  installRevision: "a".repeat(64),
  manifestHash: `sha256:${"a".repeat(64)}`,
};
const A = Object.freeze({
  participantId: "renderer:window-a",
  incarnation: "document-a1",
});

class FakeRegistrar {
  readonly calls = new Map<string, Handler>();
  readonly subscriptions = new Map<string, SubscriptionHandler>();

  register(method: string, handler: Handler): void {
    this.calls.set(method, handler);
  }

  registerSubscription(method: string, handler: SubscriptionHandler): void {
    this.subscriptions.set(method, handler);
  }

  async call(method: string, ctx: CallerContext, params: unknown): Promise<unknown> {
    const handler = this.calls.get(method);
    if (handler === undefined) throw new Error(`missing call handler ${method}`);
    return await handler(ctx, params);
  }

  async subscribe(
    ctx: CallerContext,
    params: unknown,
    emit: (payload: unknown, kind?: "delta" | "snapshot") => void,
  ): Promise<SubscriptionInstall> {
    const handler = this.subscriptions.get("plugins.runtime.subscribe");
    if (handler === undefined) throw new Error("missing runtime subscription handler");
    return await handler(ctx, params, emit);
  }
}

function record() {
  return PluginRecord.parse({
    id: PLUGIN_ID,
    version: "1.0.0",
    title: "Runtime diagnostics",
    source: "registry",
    manifestHash: OLD.manifestHash,
    installRevision: OLD.installRevision,
    state: "enabled",
    compatible: true,
    enabled: true,
    requestedCapabilities: [],
    grantedCapabilities: [],
    contributions: {},
    renderer: "active",
    service: "active",
  });
}

function context(identity: RendererParticipantIdentity = A): CallerContext {
  return {
    principal: {
      kind: "local-token",
      tokenId: `tk_${identity.participantId}`,
      scopes: ["plugins.read"],
      rendererParticipant: identity,
    },
    transport: "ws-loopback",
    receivedAt: 0,
    clientKind: "renderer",
  };
}

function target(face: "renderer"): RendererRuntimeTarget;
function target(face: "service"): ServiceRuntimeTarget;
function target(face: "renderer" | "service"): RendererRuntimeTarget | ServiceRuntimeTarget {
  const base = {
    pluginId: PLUGIN_ID,
    artifact: {
      installRevision: OLD.installRevision,
      manifestHash: OLD.manifestHash,
    },
    authorityFingerprint: "[]",
    observedGrantGeneration: 0,
  } as const;
  return face === "renderer"
    ? { ...base, face, instanceKey: { windowId: A.participantId } }
    : { ...base, face, instanceKey: { deviceId: "device-a" } };
}

function controller(
  face: "renderer" | "service" = "renderer",
  overrides: Partial<RuntimeTargetControllerDiagnostic> = {},
): RuntimeTargetControllerDiagnostic {
  const runtimeTarget = face === "renderer" ? target("renderer") : target("service");
  return {
    label: `${face}:${PLUGIN_ID}`,
    state: "active",
    desired: runtimeTarget,
    committed: runtimeTarget,
    desiredRevision: 1,
    blocked: null,
    scope: null,
    lastClose: null,
    force: { confirmedCount: 0, last: null },
    history: [],
    omittedHistory: 0,
    ...overrides,
  };
}

function report(sequence: number, value = controller(), behaviorGeneration?: unknown) {
  return PluginRuntimeReportParams.parse({
    pluginId: PLUGIN_ID,
    sequence,
    controller: value,
    ...(behaviorGeneration === undefined ? {} : { behaviorGeneration }),
  });
}

function behaviorDiagnostic() {
  return {
    pluginId: PLUGIN_ID,
    state: "failed",
    target: { windowId: A.participantId, documentId: "doc-a", runtimeGeneration: "engine-a" },
    rendererTargets: [target("renderer")],
    desiredCount: 2,
    installedCount: 0,
    blockedCount: 1,
    failedCount: 1,
    suspendedCount: 1,
    declarations: [
      {
        declarationId: `${PLUGIN_ID}:faulty`,
        rendererTarget: 0,
        status: "failed",
        error: { operation: "register", message: "behavior registration failed" },
        breaker: { strikes: 3, suspended: true },
      },
      {
        declarationId: `${PLUGIN_ID}:presence`,
        rendererTarget: 0,
        status: "blocked",
        blockedReason: "presence-unavailable",
        breaker: null,
      },
    ],
    omittedDeclarations: 0,
  } as const;
}

function fixture(options: { service?: RuntimeTargetControllerDiagnostic | null } = {}) {
  const plugin = record();
  const update = new PluginUpdateCoordinator({
    pluginId: PLUGIN_ID,
    currentArtifact: OLD,
    commitEpoch: 1,
  });
  const coordinators = new Map([[PLUGIN_ID, update]]);
  let now = 100;
  const diagnostics = new PluginRuntimeDiagnostics({
    plugins: {
      list: () => [plugin],
      get: (pluginId) => (pluginId === PLUGIN_ID ? plugin : undefined),
      commitEpoch: (pluginId) => (pluginId === PLUGIN_ID ? 1 : undefined),
    },
    serviceDiagnostic: () => options.service ?? null,
    existingCoordinatorFor: (pluginId) => coordinators.get(pluginId),
    now: () => now++,
  });
  const registrar = new FakeRegistrar();
  diagnostics.register(registrar);
  return { diagnostics, registrar, update, coordinators };
}

function register(update: PluginUpdateCoordinator, identity: RendererParticipantIdentity = A) {
  update.registerRenderer({ identity, artifact: OLD, send: () => undefined });
}

describe("PluginRuntimeDiagnostics (PRC-6b)", () => {
  it("derives report identity from an already-current renderer and refuses body forgery", async () => {
    const { registrar, update } = fixture();
    register(update);

    await expect(
      registrar.call("plugins.runtime.report", context(), {
        ...report(1),
        participantId: "renderer:forged",
      }),
    ).rejects.toMatchObject({ kind: "PRECONDITION_FAILED" });

    await expect(
      registrar.call(
        "plugins.runtime.report",
        context({
          participantId: "renderer:window-b",
          incarnation: "document-b1",
        }),
        report(1),
      ),
    ).rejects.toMatchObject({ kind: "CONFLICT" });

    await expect(
      registrar.call("plugins.runtime.report", context(), {
        ...report(1),
        controller: controller("renderer", {
          desired: {
            ...target("renderer"),
            instanceKey: { windowId: "renderer:forged-window" },
          },
        }),
      }),
    ).rejects.toMatchObject({ kind: "PRECONDITION_FAILED" });

    const forgedBehavior = behaviorDiagnostic();
    await expect(
      registrar.call(
        "plugins.runtime.report",
        context(),
        report(1, controller(), {
          ...forgedBehavior,
          target: { ...forgedBehavior.target, windowId: "renderer:forged-window" },
          rendererTargets: [
            {
              ...target("renderer"),
              instanceKey: { windowId: "renderer:forged-window" },
            },
          ],
        }),
      ),
    ).rejects.toMatchObject({ kind: "PRECONDITION_FAILED" });

    await expect(registrar.call("plugins.runtime.report", context(), report(1))).resolves.toEqual({
      accepted: true,
      generation: 1,
    });
    const snapshot = PluginRuntimeDiagnosticsSnapshot.parse(
      await registrar.call("plugins.runtime.get", context(), { pluginId: PLUGIN_ID }),
    );
    expect(snapshot.plugins[0]?.renderers).toEqual([
      expect.objectContaining({
        participantId: A.participantId,
        incarnation: A.incarnation,
        connected: true,
        sequence: 1,
      }),
    ]);
  });

  it("retains disconnected evidence, rejects stale sequence, and deletes positive retirement", async () => {
    const { diagnostics, registrar, update } = fixture();
    register(update);
    await registrar.call("plugins.runtime.report", context(), report(2));
    await expect(registrar.call("plugins.runtime.report", context(), report(1))).resolves.toEqual({
      accepted: false,
      generation: 1,
    });

    update.disconnectRenderer(A);
    diagnostics.notifyHostChanged();
    expect(diagnostics.snapshot(PLUGIN_ID).plugins[0]?.renderers[0]?.connected).toBe(false);

    await update.retireRenderer(A);
    diagnostics.retireRenderer(PLUGIN_ID, A);
    expect(diagnostics.snapshot(PLUGIN_ID).plugins[0]?.renderers).toEqual([]);
  });

  it("replaces a retired stable participant with its newly accepted incarnation", async () => {
    const { diagnostics, registrar, update } = fixture();
    register(update);
    await registrar.call("plugins.runtime.report", context(), report(9));
    await update.retireRenderer(A);
    const next = { ...A, incarnation: "document-a2" };
    register(update, next);
    await registrar.call("plugins.runtime.report", context(next), report(1));

    expect(diagnostics.snapshot(PLUGIN_ID).plugins[0]?.renderers).toEqual([
      expect.objectContaining({ incarnation: "document-a2", sequence: 1 }),
    ]);
  });

  it("deletes all retained renderer evidence only on positive plugin retirement", async () => {
    const { diagnostics, registrar, update } = fixture();
    register(update);
    await registrar.call("plugins.runtime.report", context(), report(1));

    diagnostics.retirePlugin(PLUGIN_ID);

    expect(diagnostics.snapshot(PLUGIN_ID).plugins[0]?.renderers).toEqual([]);
  });

  it("bounds retained plugin keys and admits a new key after positive retirement", async () => {
    const records = new Map<string, ReturnType<typeof record>>();
    const coordinators = new Map<string, PluginUpdateCoordinator>();
    for (let index = 0; index <= PLUGIN_RUNTIME_DIAGNOSTIC_LIMITS.PLUGINS; index += 1) {
      const pluginId = `com.example.runtime-cache-${index}`;
      const pluginRecord = PluginRecord.parse({
        ...record(),
        id: pluginId,
        title: `Runtime cache ${index}`,
      });
      const artifact = { ...OLD, pluginId };
      const coordinator = new PluginUpdateCoordinator({
        pluginId,
        currentArtifact: artifact,
        commitEpoch: 1,
      });
      coordinator.registerRenderer({ identity: A, artifact, send: () => undefined });
      records.set(pluginId, pluginRecord);
      coordinators.set(pluginId, coordinator);
    }
    const diagnostics = new PluginRuntimeDiagnostics({
      plugins: {
        list: () => [...records.values()],
        get: (pluginId) => records.get(pluginId),
        commitEpoch: () => 1,
      },
      serviceDiagnostic: () => null,
      existingCoordinatorFor: (pluginId) => coordinators.get(pluginId),
      now: () => 100,
    });
    const registrar = new FakeRegistrar();
    diagnostics.register(registrar);
    const plainController = controller("renderer", {
      state: "inactive",
      desired: null,
      committed: null,
    });

    for (let index = 0; index < PLUGIN_RUNTIME_DIAGNOSTIC_LIMITS.PLUGINS; index += 1) {
      const pluginId = `com.example.runtime-cache-${index}`;
      await registrar.call("plugins.runtime.report", context(), {
        pluginId,
        sequence: 1,
        controller: plainController,
      });
    }
    const overflowId = `com.example.runtime-cache-${PLUGIN_RUNTIME_DIAGNOSTIC_LIMITS.PLUGINS}`;
    await expect(
      registrar.call("plugins.runtime.report", context(), {
        pluginId: overflowId,
        sequence: 1,
        controller: plainController,
      }),
    ).rejects.toMatchObject({ kind: "RESOURCE_EXHAUSTED" });

    diagnostics.retirePlugin("com.example.runtime-cache-0");
    await expect(
      registrar.call("plugins.runtime.report", context(), {
        pluginId: overflowId,
        sequence: 1,
        controller: plainController,
      }),
    ).resolves.toMatchObject({ accepted: true });
  });

  it("reads only the existing coordinator and never creates update state", async () => {
    const { diagnostics, registrar, coordinators } = fixture();
    coordinators.clear();
    expect(coordinators.size).toBe(0);
    await registrar.call("plugins.runtime.get", context(), { pluginId: PLUGIN_ID });
    expect(coordinators.size).toBe(0);
    await expect(
      registrar.call("plugins.runtime.report", context(), report(1)),
    ).rejects.toMatchObject({ kind: "CONFLICT" });
    expect(coordinators.size).toBe(0);
    expect(diagnostics.snapshot(PLUGIN_ID).plugins[0]?.update).toBeNull();
  });

  it("coalesces bounded snapshots to passive subscribers", async () => {
    const { diagnostics, registrar, update } = fixture();
    register(update);
    const emit = vi.fn();
    const subscription = await registrar.subscribe(context(), { pluginId: PLUGIN_ID }, emit);
    expect(PluginRuntimeDiagnosticsSnapshot.parse(subscription.snapshot).generation).toBe(0);
    await registrar.call("plugins.runtime.report", context(), report(1));
    expect(emit).toHaveBeenCalledTimes(1);
    expect(PluginRuntimeDiagnosticsSnapshot.parse(emit.mock.calls[0]?.[0]).generation).toBe(1);
    subscription.dispose();
    diagnostics.notifyHostChanged();
    expect(emit).toHaveBeenCalledTimes(1);
  });

  it("reports and releases every retained report/listener at disposal", async () => {
    const { diagnostics, registrar, update } = fixture();
    register(update);
    const subscription = await registrar.subscribe(context(), {}, () => undefined);
    await registrar.call("plugins.runtime.report", context(), report(1));
    await Promise.resolve();
    expect(diagnostics.state()).toEqual({
      plugins: 1,
      reports: 1,
      listeners: 1,
      flushScheduled: false,
      disposed: false,
    });

    diagnostics.dispose();
    expect(diagnostics.state()).toEqual({
      plugins: 0,
      reports: 0,
      listeners: 0,
      flushScheduled: false,
      disposed: true,
    });
    subscription.dispose();
    await expect(registrar.subscribe(context(), {}, () => undefined)).rejects.toMatchObject({
      kind: "UNAVAILABLE",
    });
  });

  it("cancels a queued diagnostic flush structurally at disposal", async () => {
    const { diagnostics, registrar, update } = fixture();
    register(update);
    await registrar.subscribe(context(), {}, () => undefined);
    diagnostics.notifyHostChanged();
    expect(diagnostics.state().flushScheduled).toBe(true);

    diagnostics.dispose();
    expect(diagnostics.state()).toMatchObject({
      plugins: 0,
      reports: 0,
      listeners: 0,
      flushScheduled: false,
      disposed: true,
    });
    await Promise.resolve();
    expect(diagnostics.state().flushScheduled).toBe(false);
  });

  it("derives Doctor issues without dropping the underlying exact reports", async () => {
    const failedService = controller("service", {
      state: "failed",
      error: "service activation failed",
      desired: target("service"),
      committed: null,
      lastClose: {
        label: "service-scope",
        state: "closed",
        quiescent: false,
        liveCount: 1,
        pendingSetups: 0,
        lateCleanups: 0,
        stats: { acquired: 1, disposed: 0, disposeErrors: 1, lateArrivals: 0 },
        errors: [{ label: "route", name: "Error", message: "could not drain" }],
        omittedErrors: 0,
      },
    });
    const { diagnostics, registrar, update } = fixture({ service: failedService });
    register(update);
    await registrar.call(
      "plugins.runtime.report",
      context(),
      report(1, controller(), behaviorDiagnostic()),
    );
    update.disconnectRenderer(A);

    const plugin = diagnostics.snapshot(PLUGIN_ID).plugins[0];
    expect(plugin?.serviceController).toEqual(failedService);
    expect(plugin?.issues.map((issue) => issue.code)).toEqual(
      expect.arrayContaining([
        "controller-failed",
        "scope-non-quiescent",
        "cleanup-errors",
        "behavior-generation-failed",
        "behavior-blocked",
        "behavior-suspended",
        "renderer-disconnected",
      ]),
    );
  });
});
