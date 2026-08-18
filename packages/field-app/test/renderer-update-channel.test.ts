import type {
  PluginRecord,
  PluginUpdateArtifact,
  PluginUpdateCommand,
  PluginUpdateParticipantSnapshot,
  PluginUpdateSourceResult,
} from "@vibefield/contracts";
import { describe, expect, it, vi } from "vitest";
import {
  type PluginClientBackend,
  PluginClientLeaseBroker,
} from "../src/plugin-host/plugin-client";
import type {
  CommitRendererReplacementInput,
  PrepareRendererReplacementInput,
  RecoverOldRendererInput,
} from "../src/plugin-host/renderer-controller";
import { RendererUpdateChannel } from "../src/plugin-host/renderer-update-channel";
import type { RendererUpdateParticipantRuntime } from "../src/plugin-host/renderer-update-participant";

const pluginId = "vibefield.renderer.channel";
const updateId = "pupd_renderer_channel";

const artifact = (char: string): PluginUpdateArtifact => ({
  pluginId,
  installRevision: `rev-${char}`,
  manifestHash: `sha256:${char.repeat(64)}`,
});

const oldArtifact = artifact("a");
const candidateArtifact = artifact("b");

const prepareCommand: Extract<PluginUpdateCommand, { kind: "prepare" }> = {
  kind: "prepare",
  updateId,
  oldArtifact,
  candidateArtifact,
};

const record = (identity: PluginUpdateArtifact): PluginRecord => ({
  id: pluginId,
  version: "1.0.0",
  title: "Renderer channel",
  source: "bundled",
  manifestHash: identity.manifestHash,
  installRevision: identity.installRevision,
  state: "enabled",
  compatible: true,
  enabled: true,
  requestedCapabilities: [],
  grantedCapabilities: [],
  deniedCapabilities: [],
  grantGeneration: 3,
  contributions: { widgets: [], commands: [], surfaces: [], behaviors: [], capabilities: [] },
  renderer: "inactive",
  service: "none",
});

const sourceResult = (): PluginUpdateSourceResult => ({
  updateId,
  purpose: "candidate",
  artifact: candidateArtifact,
  record: record(candidateArtifact),
  module: {
    pluginId,
    moduleUrl: `vibefield-plugin://${"c".repeat(32)}`,
    manifestHash: candidateArtifact.manifestHash,
    installRevision: candidateArtifact.installRevision,
  },
  lease: {
    leaseId: `tk_${"d".repeat(12)}`,
    token: "candidate-secret",
    pluginId,
    manifestHash: candidateArtifact.manifestHash,
    grantGeneration: 3,
    expiresAt: 100_000,
  },
});

const activation = { state: "active", bindings: new Map(), behaviors: new Map() } as const;

class FakeRuntime implements RendererUpdateParticipantRuntime {
  readonly prepares: PrepareRendererReplacementInput[] = [];
  readonly commits: CommitRendererReplacementInput[] = [];
  readonly recoveries: RecoverOldRendererInput[] = [];

  async prepareReplacement(input: PrepareRendererReplacementInput) {
    this.prepares.push(input);
    return { state: "prepared", activation } as const;
  }

  commitReplacement(input: CommitRendererReplacementInput): void {
    this.commits.push(input);
  }

  async recoverOld(input: RecoverOldRendererInput) {
    this.recoveries.push(input);
    return { state: "recovered-old", activation } as const;
  }

  isActiveArtifact(input: PluginUpdateArtifact): boolean {
    return input.installRevision === oldArtifact.installRevision;
  }
}

const backend = {
  windowClient: {
    url: "ws://127.0.0.1:1",
    request: async () => ({}),
  },
} as PluginClientBackend;

describe("RendererUpdateChannel", () => {
  it("queues prepare until attach, replays a lost ack without rerunning lifecycle, and releases source authority once", async () => {
    const snapshot: PluginUpdateParticipantSnapshot = {
      pluginId,
      status: "live",
      artifact: oldArtifact,
      commitEpoch: 1,
      pendingCommand: prepareCommand,
    };
    let emit!: (payload: unknown, kind: "snapshot" | "delta") => void;
    const unsubscribe = vi.fn();
    const subscribe = vi.fn(async (_method, _params, onEvent) => {
      emit = onEvent;
      return { snapshot, unsubscribe };
    });
    const calls: Array<{ method: string; params: unknown }> = [];
    let ackAttempts = 0;
    const request = vi.fn(async (method: string, params?: unknown) => {
      calls.push({ method, params });
      if (method === "plugins.update.source") return sourceResult();
      if (method === "plugins.update.source.release") return { released: true };
      if (method === "plugins.update.leave") return { retired: true };
      if (method === "plugins.update.ack") {
        ackAttempts += 1;
        if (ackAttempts === 1) throw new Error("ack response was lost");
        return { accepted: true };
      }
      throw new Error(`unexpected method ${method}`);
    });
    const closeCredential = vi.fn();
    const connectCredential = vi.fn();
    const broker = new PluginClientLeaseBroker({
      now: () => 1_000,
      createClient: () => ({
        connect: connectCredential,
        rotateCredential: vi.fn(),
        ready: async () => undefined,
        close: closeCredential,
        request: async () => ({}),
        subscribe: async () => ({ snapshot: {}, unsubscribe: () => undefined }),
      }),
    });
    const runtime = new FakeRuntime();
    const channel = await RendererUpdateChannel.open(pluginId, {
      request,
      subscribe,
      backend,
      makeLeaseBroker: () => broker,
    });

    await expect(channel.artifact()).resolves.toEqual(oldArtifact);
    expect(runtime.prepares).toEqual([]);
    expect(calls.filter(({ method }) => method === "plugins.update.source")).toHaveLength(0);

    channel.attach(runtime);
    await vi.waitFor(() => {
      expect(calls.filter(({ method }) => method === "plugins.update.ack")).toHaveLength(1);
    });
    expect(runtime.prepares).toHaveLength(1);
    expect(connectCredential).toHaveBeenCalledOnce();
    expect(calls.find(({ method }) => method === "plugins.update.ack")?.params).toEqual({
      kind: "prepared",
      updateId,
      pluginId,
      candidateArtifact,
    });

    emit({ kind: "command", command: prepareCommand }, "delta");
    await vi.waitFor(() => {
      expect(calls.filter(({ method }) => method === "plugins.update.ack")).toHaveLength(2);
    });
    expect(runtime.prepares).toHaveLength(1);
    expect(calls.filter(({ method }) => method === "plugins.update.source")).toHaveLength(1);

    const candidate = runtime.prepares[0]?.candidate;
    await Promise.all([candidate?.releaseAuthority?.(), candidate?.releaseAuthority?.()]);
    expect(closeCredential).toHaveBeenCalledOnce();
    expect(calls.filter(({ method }) => method === "plugins.update.source.release")).toHaveLength(
      1,
    );

    await Promise.all([channel.close(), channel.close()]);
    expect(unsubscribe).toHaveBeenCalledOnce();
    expect(calls.filter(({ method }) => method === "plugins.update.leave")).toEqual([
      { method: "plugins.update.leave", params: { pluginId } },
    ]);
  });

  it("holds boot authorization until the coordinator explicitly admits this renderer", async () => {
    let emit!: (payload: unknown, kind: "snapshot" | "delta") => void;
    const unsubscribe = vi.fn();
    const request = vi.fn(async (method: string) => {
      if (method === "plugins.update.leave") return { retired: false };
      throw new Error(`unexpected method ${method}`);
    });
    const channel = await RendererUpdateChannel.open(pluginId, {
      request,
      subscribe: async (_method, _params, onEvent) => {
        emit = onEvent;
        return {
          snapshot: {
            pluginId,
            status: "held",
            artifact: null,
            commitEpoch: null,
            pendingCommand: null,
          },
          unsubscribe,
        };
      },
      backend,
    });
    let authorized = false;
    void channel.artifact().then(() => {
      authorized = true;
    });
    await Promise.resolve();
    expect(authorized).toBe(false);

    emit({ kind: "admitted", artifact: candidateArtifact, commitEpoch: 2 }, "delta");
    await expect(channel.artifact()).resolves.toEqual(candidateArtifact);
    await channel.close();
    expect(unsubscribe).toHaveBeenCalledOnce();
    expect(request).toHaveBeenCalledWith("plugins.update.leave", { pluginId });
  });

  it("turns an episode-mismatched source into a failed ack without invoking plugin lifecycle", async () => {
    const runtime = new FakeRuntime();
    const calls: Array<{ method: string; params: unknown }> = [];
    const request = vi.fn(async (method: string, params?: unknown) => {
      calls.push({ method, params });
      if (method === "plugins.update.source") {
        return { ...sourceResult(), updateId: "pupd_another_episode" };
      }
      if (method === "plugins.update.ack") return { accepted: true };
      if (method === "plugins.update.leave") return { retired: true };
      throw new Error(`unexpected method ${method}`);
    });
    const channel = await RendererUpdateChannel.open(pluginId, {
      request,
      subscribe: async () => ({
        snapshot: {
          pluginId,
          status: "live",
          artifact: oldArtifact,
          commitEpoch: 1,
          pendingCommand: prepareCommand,
        },
        unsubscribe: () => undefined,
      }),
      backend,
    });

    channel.attach(runtime);
    await vi.waitFor(() => {
      expect(calls.filter(({ method }) => method === "plugins.update.ack")).toHaveLength(1);
    });
    expect(runtime.prepares).toEqual([]);
    expect(calls.find(({ method }) => method === "plugins.update.ack")?.params).toMatchObject({
      kind: "failed",
      at: "prepare",
      error: { code: "renderer-source-unavailable" },
    });
    await channel.close();
  });
});
