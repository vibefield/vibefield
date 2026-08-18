import type {
  CallerContext,
  PluginUpdateAckParams,
  PluginUpdateArtifact,
  PluginUpdateParticipantEvent,
  RendererParticipantIdentity,
} from "@vibefield/contracts";
import { describe, expect, it, vi } from "vitest";
import {
  type PluginUpdateCandidate,
  PluginUpdateCoordinator,
  type PluginUpdateSourceFence,
} from "../src/plugin-update-coordinator";
import {
  type AcquiredPluginUpdateSource,
  type PluginUpdateRegistrar,
  PluginUpdateTransport,
} from "../src/plugin-update-transport";
import type { Handler, SubscriptionHandler, SubscriptionInstall } from "../src/product-api";

const PLUGIN_ID = "com.example.update-transport";
const artifact = (character: string): PluginUpdateArtifact => ({
  pluginId: PLUGIN_ID,
  installRevision: character.repeat(64),
  manifestHash: `sha256:${character.repeat(64)}`,
});
const OLD = artifact("a");
const CANDIDATE = artifact("b");
const A = Object.freeze({
  participantId: "renderer:window-a",
  incarnation: "document-a1",
});
const B = Object.freeze({
  participantId: "renderer:window-b",
  incarnation: "document-b1",
});

class FakeRegistrar implements PluginUpdateRegistrar {
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
    emit: (payload: unknown, kind?: "delta" | "snapshot") => void = () => undefined,
  ): Promise<SubscriptionInstall> {
    const handler = this.subscriptions.get("plugins.update.subscribe");
    if (handler === undefined) throw new Error("missing update subscription handler");
    return await handler(ctx, params, emit);
  }
}

function coordinator(updateId = "pupd_transport_1"): PluginUpdateCoordinator {
  return new PluginUpdateCoordinator({
    pluginId: PLUGIN_ID,
    currentArtifact: OLD,
    makeUpdateId: () => updateId,
  });
}

function candidate(overrides: Partial<PluginUpdateCandidate> = {}): PluginUpdateCandidate {
  return {
    oldArtifact: OLD,
    candidateArtifact: CANDIDATE,
    commitArtifact: async () => undefined,
    discardArtifact: async () => undefined,
    ...overrides,
  };
}

function context(
  identity: RendererParticipantIdentity = A,
  options: { signal?: AbortSignal } = {},
): CallerContext {
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
    ...(options.signal === undefined ? {} : { signal: options.signal }),
  };
}

function prepared(updateId: string): PluginUpdateAckParams {
  return {
    kind: "prepared",
    updateId,
    pluginId: PLUGIN_ID,
    candidateArtifact: CANDIDATE,
  };
}

function committed(updateId: string): PluginUpdateAckParams {
  return {
    kind: "committed",
    updateId,
    pluginId: PLUGIN_ID,
    candidateArtifact: CANDIDATE,
    commitEpoch: 2,
  };
}

function sourceValue(fence: PluginUpdateSourceFence): unknown {
  return {
    updateId: fence.updateId,
    purpose: fence.purpose,
    artifact: fence.artifact,
    record: {
      id: PLUGIN_ID,
      version: "1.0.0",
      title: "Update transport",
      source: "registry",
      manifestHash: fence.artifact.manifestHash,
      installRevision: fence.artifact.installRevision,
      state: "enabled",
      compatible: true,
      enabled: true,
      requestedCapabilities: [],
      grantedCapabilities: [],
      deniedCapabilities: [],
      grantGeneration: 3,
      contributions: {},
      renderer: "active",
      service: "none",
    },
    module: {
      pluginId: PLUGIN_ID,
      moduleUrl: `vibefield-plugin://${"c".repeat(32)}`,
      manifestHash: fence.artifact.manifestHash,
      installRevision: fence.artifact.installRevision,
    },
    lease: {
      token: "candidate-token",
      pluginId: PLUGIN_ID,
      manifestHash: fence.artifact.manifestHash,
      grantGeneration: 3,
      expiresAt: 10_000,
    },
  };
}

function installTransport(
  update: PluginUpdateCoordinator,
  acquireSource: (
    input: Parameters<ConstructorParameters<typeof PluginUpdateTransport>[0]["acquireSource"]>[0],
  ) => AcquiredPluginUpdateSource | Promise<AcquiredPluginUpdateSource> = ({ fence }) => ({
    value: sourceValue(fence),
    discard: () => undefined,
  }),
): FakeRegistrar {
  const registrar = new FakeRegistrar();
  new PluginUpdateTransport({
    coordinatorFor: (pluginId) => (pluginId === PLUGIN_ID ? update : undefined),
    acquireSource,
  }).register(registrar);
  return registrar;
}

function eventsOf(spy: ReturnType<typeof vi.fn>): PluginUpdateParticipantEvent[] {
  return spy.mock.calls.map(([event]) => event as PluginUpdateParticipantEvent);
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
}

describe("PluginUpdateTransport (PRC-5e)", () => {
  it("derives exact identity from the bearer and rejects identity in request bodies", async () => {
    const update = coordinator();
    const registrar = installTransport(update);

    await expect(
      registrar.subscribe(context(), { pluginId: PLUGIN_ID, participantId: "renderer:forged" }),
    ).rejects.toMatchObject({ kind: "PRECONDITION_FAILED" });

    const subscription = await registrar.subscribe(context(), { pluginId: PLUGIN_ID });
    subscription.start?.();
    const started = update.begin(candidate());
    expect(update.snapshot().episode?.participants).toEqual([
      expect.objectContaining({
        kind: "renderer",
        participantId: A.participantId,
        incarnation: A.incarnation,
      }),
    ]);
    await expect(
      registrar.call("plugins.update.ack", context(), {
        ...prepared(started.updateId),
        participantId: "renderer:forged",
      }),
    ).rejects.toMatchObject({ kind: "PRECONDITION_FAILED" });
    subscription.dispose();
  });

  it("refuses a duplicate subscription without disconnecting the incumbent", async () => {
    const update = coordinator();
    const registrar = installTransport(update);
    const emit = vi.fn();
    const incumbent = await registrar.subscribe(context(), { pluginId: PLUGIN_ID }, emit);
    incumbent.start?.();

    await expect(registrar.subscribe(context(), { pluginId: PLUGIN_ID })).rejects.toMatchObject({
      kind: "CONFLICT",
    });
    expect(update.begin(candidate())).toMatchObject({ updateId: "pupd_transport_1" });
    expect(eventsOf(emit)[0]).toMatchObject({
      kind: "command",
      command: { kind: "prepare", updateId: "pupd_transport_1" },
    });
    expect(update.snapshot().episode?.participants[0]).toMatchObject({ connected: true });
    incumbent.dispose();
  });

  it("puts a reconnect's pending command in the snapshot and flushes later commands after start", async () => {
    const update = coordinator();
    update.registerRenderer({ identity: A, artifact: OLD, send: () => undefined });
    const started = update.begin(candidate());
    update.disconnectRenderer(A);
    const registrar = installTransport(update);
    const emit = vi.fn();

    const subscription = await registrar.subscribe(context(), { pluginId: PLUGIN_ID }, emit);
    expect(subscription.snapshot).toMatchObject({
      status: "live",
      pendingCommand: { kind: "prepare", updateId: started.updateId },
    });
    expect(emit).not.toHaveBeenCalled();

    await registrar.call("plugins.update.ack", context(), prepared(started.updateId));
    expect(emit).not.toHaveBeenCalled();
    subscription.start?.();
    expect(eventsOf(emit)).toEqual([
      expect.objectContaining({
        kind: "command",
        command: expect.objectContaining({ kind: "commit", updateId: started.updateId }),
      }),
    ]);
    subscription.dispose();
  });

  it("treats disconnect as reachability only and replays only to the exact incarnation", async () => {
    const update = coordinator();
    const registrar = installTransport(update);
    const firstEmit = vi.fn();
    const first = await registrar.subscribe(context(), { pluginId: PLUGIN_ID }, firstEmit);
    first.start?.();
    const started = update.begin(candidate());
    expect(eventsOf(firstEmit)[0]).toMatchObject({
      kind: "command",
      command: { kind: "prepare", updateId: started.updateId },
    });
    first.dispose();
    expect(update.snapshot().episode?.participants[0]).toMatchObject({ connected: false });

    await expect(
      registrar.subscribe(context({ ...A, incarnation: "document-a2" }), { pluginId: PLUGIN_ID }),
    ).rejects.toMatchObject({ kind: "CONFLICT" });

    const exactEmit = vi.fn();
    const exact = await registrar.subscribe(context(), { pluginId: PLUGIN_ID }, exactEmit);
    expect(exact.snapshot).toMatchObject({
      status: "live",
      pendingCommand: { kind: "prepare", updateId: started.updateId },
    });
    expect(exactEmit).not.toHaveBeenCalled();
    exact.start?.();
    expect(exactEmit).not.toHaveBeenCalled();
    exact.dispose();
  });

  it("holds a newcomer authority-free and admits it only after final convergence", async () => {
    const update = coordinator();
    const acquireSource = vi.fn(({ fence }) => ({
      value: sourceValue(fence),
      discard: () => undefined,
    }));
    const registrar = installTransport(update, acquireSource);
    const aEmit = vi.fn();
    const a = await registrar.subscribe(context(A), { pluginId: PLUGIN_ID }, aEmit);
    a.start?.();
    const started = update.begin(candidate());

    const bEmit = vi.fn();
    const b = await registrar.subscribe(context(B), { pluginId: PLUGIN_ID }, bEmit);
    expect(b.snapshot).toEqual({
      pluginId: PLUGIN_ID,
      status: "held",
      artifact: null,
      commitEpoch: null,
      pendingCommand: null,
    });
    b.start?.();
    await expect(
      registrar.call("plugins.update.source", context(B), {
        pluginId: PLUGIN_ID,
        updateId: started.updateId,
        purpose: "candidate",
      }),
    ).rejects.toMatchObject({ kind: "CONFLICT" });
    expect(acquireSource).not.toHaveBeenCalled();
    expect(bEmit).not.toHaveBeenCalled();

    await registrar.call("plugins.update.ack", context(A), prepared(started.updateId));
    await registrar.call("plugins.update.ack", context(A), committed(started.updateId));
    await expect(started.completion).resolves.toMatchObject({ outcome: "committed" });
    expect(eventsOf(bEmit)).toEqual([
      {
        kind: "admitted",
        artifact: CANDIDATE,
        commitEpoch: 2,
      },
    ]);
    a.dispose();
    b.dispose();
  });

  it("admits an exact held reconnect even when it missed the final active event", async () => {
    const update = coordinator();
    const registrar = installTransport(update);
    const a = await registrar.subscribe(context(A), { pluginId: PLUGIN_ID });
    a.start?.();
    const started = update.begin(candidate());
    const held = await registrar.subscribe(context(B), { pluginId: PLUGIN_ID });
    expect(held.snapshot).toMatchObject({ status: "held", artifact: null });
    held.dispose();

    await registrar.call("plugins.update.ack", context(A), prepared(started.updateId));
    await registrar.call("plugins.update.ack", context(A), committed(started.updateId));
    await started.completion;

    const emit = vi.fn();
    const reconnected = await registrar.subscribe(context(B), { pluginId: PLUGIN_ID }, emit);
    expect(reconnected.snapshot).toMatchObject({
      status: "live",
      artifact: CANDIDATE,
      commitEpoch: 2,
      pendingCommand: null,
    });
    reconnected.start?.();
    expect(emit).not.toHaveBeenCalled();
    a.dispose();
    reconnected.dispose();
  });

  it("acquires a source only behind the exact pending member and purpose fence", async () => {
    const update = coordinator();
    const discard = vi.fn();
    const acquireSource = vi.fn(({ fence }) => ({ value: sourceValue(fence), discard }));
    const registrar = installTransport(update, acquireSource);
    const subscription = await registrar.subscribe(context(), { pluginId: PLUGIN_ID });
    subscription.start?.();
    const started = update.begin(candidate());

    const result = await registrar.call("plugins.update.source", context(), {
      pluginId: PLUGIN_ID,
      updateId: started.updateId,
      purpose: "candidate",
    });
    expect(result).toMatchObject({
      updateId: started.updateId,
      purpose: "candidate",
      artifact: CANDIDATE,
    });
    expect(acquireSource).toHaveBeenCalledWith(
      expect.objectContaining({
        identity: A,
        fence: { updateId: started.updateId, purpose: "candidate", artifact: CANDIDATE },
      }),
    );
    expect(discard).not.toHaveBeenCalled();

    await expect(
      registrar.call("plugins.update.source", context(), {
        pluginId: PLUGIN_ID,
        updateId: started.updateId,
        purpose: "recover-old",
      }),
    ).rejects.toMatchObject({ kind: "CONFLICT" });
    await expect(
      registrar.call("plugins.update.source", context(), {
        pluginId: PLUGIN_ID,
        updateId: started.updateId,
        purpose: "candidate",
        participantId: A.participantId,
      }),
    ).rejects.toMatchObject({ kind: "PRECONDITION_FAILED" });
    expect(acquireSource).toHaveBeenCalledTimes(1);
    subscription.dispose();
  });

  it("discards a source whose member barrier advances while acquisition is pending", async () => {
    const update = coordinator();
    const pending = deferred<AcquiredPluginUpdateSource>();
    const acquireSource = vi.fn(() => pending.promise);
    const registrar = installTransport(update, acquireSource);
    const subscription = await registrar.subscribe(context(), { pluginId: PLUGIN_ID });
    subscription.start?.();
    const started = update.begin(candidate());
    const source = registrar.call("plugins.update.source", context(), {
      pluginId: PLUGIN_ID,
      updateId: started.updateId,
      purpose: "candidate",
    });
    await vi.waitFor(() => expect(acquireSource).toHaveBeenCalledOnce());

    await registrar.call("plugins.update.ack", context(), prepared(started.updateId));
    const discard = vi.fn();
    pending.resolve({
      value: sourceValue({
        updateId: started.updateId,
        purpose: "candidate",
        artifact: CANDIDATE,
      }),
      discard,
    });

    await expect(source).rejects.toMatchObject({ kind: "CONFLICT" });
    expect(discard).toHaveBeenCalledOnce();
    subscription.dispose();
  });

  it("refuses non-window doors and missing plugin coordinators with typed errors", async () => {
    const update = coordinator();
    const registrar = installTransport(update);
    const wrongDoor: CallerContext = { ...context(), transport: "ws-tailnet" };

    await expect(registrar.subscribe(wrongDoor, { pluginId: PLUGIN_ID })).rejects.toMatchObject({
      kind: "PRECONDITION_FAILED",
    });
    await expect(registrar.call("plugins.update.ack", wrongDoor, {})).rejects.toMatchObject({
      kind: "PRECONDITION_FAILED",
    });
    await expect(registrar.call("plugins.update.source", wrongDoor, {})).rejects.toMatchObject({
      kind: "PRECONDITION_FAILED",
    });
    await expect(
      registrar.subscribe(context(), { pluginId: "com.example.missing" }),
    ).rejects.toMatchObject({ kind: "NOT_FOUND" });
  });

  it("disconnects exactly once when abort and subscription disposal race", async () => {
    const update = coordinator();
    const disconnect = vi.spyOn(update, "disconnectRenderer");
    const registrar = installTransport(update);
    const abort = new AbortController();
    const subscription = await registrar.subscribe(context(A, { signal: abort.signal }), {
      pluginId: PLUGIN_ID,
    });

    abort.abort();
    subscription.dispose();
    abort.abort();
    expect(disconnect).toHaveBeenCalledOnce();
    expect(disconnect).toHaveBeenCalledWith(A);
  });
});
