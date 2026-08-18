import {
  type PluginManifestV1,
  type PluginModuleUrls,
  type PluginRecord,
  type PluginUpdateArtifact,
  type PluginUpdateCommand,
  PluginUpdateSourceResult,
} from "@vibefield/contracts";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { PreparedCandidateModules, PreparedRecoveryModules } from "../src/plugin-modules";
import {
  type PluginRegistryUpdateCandidate,
  PluginUpdateManager,
  type PluginUpdateManagerOptions,
  type PluginUpdateSourceMintRequest,
  type PluginUpdateSourceRevokeRequest,
} from "../src/plugin-update-manager";
import type { PreparedServiceCandidate } from "../src/service-host";

const PLUGIN_ID = "com.example.update-manager";
const A = Object.freeze({
  participantId: "renderer:window-a",
  incarnation: "document-a1",
});
const B = Object.freeze({
  participantId: "renderer:window-b",
  incarnation: "document-b1",
});

afterEach(() => {
  vi.useRealTimers();
});

function record(character: string, overrides: Partial<PluginRecord> = {}): PluginRecord {
  const slot = character.repeat(64);
  return {
    id: PLUGIN_ID,
    version: character === "a" ? "1.0.0" : "2.0.0",
    title: "Update Manager Fixture",
    source: "registry",
    manifestHash: `sha256:${character.repeat(64)}`,
    installRevision: slot,
    registry: {
      indexRef: "file:///fixture/index.json",
      artifactSha256: `sha256:${slot}`,
      publisher: "fixture",
    },
    state: "enabled",
    compatible: true,
    enabled: true,
    requestedCapabilities: ["canvas.read"],
    grantedCapabilities: ["canvas.read"],
    deniedCapabilities: [],
    grantGeneration: 3,
    contributions: {
      widgets: [],
      behaviors: [],
      commands: [],
      surfaces: [],
      capabilities: [],
    },
    renderer: "active",
    service: "active",
    ...overrides,
  };
}

function artifact(value: PluginRecord): PluginUpdateArtifact {
  return {
    pluginId: value.id,
    installRevision: value.installRevision,
    manifestHash: value.manifestHash,
  };
}

function moduleFor(value: PluginRecord, character: string): PluginModuleUrls {
  return {
    pluginId: value.id,
    moduleUrl: `vibefield-plugin://${character.repeat(32)}`,
    styleUrl: `vibefield-plugin://${character.repeat(31)}0`,
    manifestHash: value.manifestHash,
    installRevision: value.installRevision,
  };
}

function manifest(value: PluginRecord): PluginManifestV1 {
  return {
    manifestVersion: 1,
    id: value.id,
    version: value.version,
    title: value.title,
    engines: { app: ">=0.0.0", contracts: "^0.1.0" },
    entries: { renderer: "./dist/renderer.js", service: "./dist/service.js" },
    activation: ["onStartup"],
    capabilities: ["canvas.read"],
    contributes: {},
  } as PluginManifestV1;
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

async function eventually(predicate: () => boolean, message = "condition did not become true") {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (predicate()) return;
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
  }
  throw new Error(message);
}

function fixture(
  options: { readonly leaseMs?: number; readonly candidateModuleGate?: Promise<void> } = {},
) {
  const oldRecord = record("a");
  const candidateRecord = record("b");
  const oldLiveModule = moduleFor(oldRecord, "a");
  const candidateModule = moduleFor(candidateRecord, "b");
  const recoveryModule = moduleFor(oldRecord, "c");
  const events: string[] = [];
  const commands: PluginUpdateCommand[] = [];
  const mints: PluginUpdateSourceMintRequest[] = [];
  const revocations: PluginUpdateSourceRevokeRequest[] = [];
  let current = oldRecord;
  let tokenSequence = 0;

  const candidateModulesDisposed = vi.fn(() => events.push("modules.candidate.dispose"));
  const recoveryModulesDisposed = vi.fn(() => events.push("modules.recovery.dispose"));
  const preparedModules: PreparedCandidateModules = {
    updateId: "bound-by-prepare",
    pluginId: PLUGIN_ID,
    module: candidateModule,
    promote: () => {
      if (current !== candidateRecord) throw new Error("candidate module promoted before pointer");
      events.push("modules.candidate.promote");
    },
    dispose: candidateModulesDisposed,
  };
  const preparedRecovery: PreparedRecoveryModules = {
    updateId: "bound-by-recovery",
    pluginId: PLUGIN_ID,
    module: recoveryModule,
    dispose: recoveryModulesDisposed,
  };
  const modules: PluginUpdateManagerOptions["modules"] = {
    prepareCandidate: vi.fn(async (input) => {
      events.push(`modules.candidate.prepare:${input.updateId}`);
      await options.candidateModuleGate;
      return { ...preparedModules, updateId: input.updateId };
    }),
    prepareRecovery: vi.fn(async (input) => {
      events.push(`modules.recovery.prepare:${input.updateId}`);
      return { ...preparedRecovery, updateId: input.updateId };
    }),
  };

  const serviceDiscard = vi.fn(async () => {
    events.push("service.candidate.discard");
  });
  const serviceRelease = vi.fn(() => events.push("service.candidate.release"));
  const serviceCandidate = {
    updateId: "bound-by-prepare",
    pluginId: PLUGIN_ID,
    target: {} as PreparedServiceCandidate["target"],
    commit: () => {
      if (current !== candidateRecord)
        throw new Error("candidate service committed before pointer");
      events.push("service.candidate.commit");
    },
    discard: serviceDiscard,
    release: serviceRelease,
  } satisfies PreparedServiceCandidate;
  const serviceHost: NonNullable<ReturnType<PluginUpdateManagerOptions["serviceHost"]>> = {
    prepareCandidate: vi.fn(async (input) => {
      events.push(`service.candidate.prepare:${input.updateId}`);
      return { ...serviceCandidate, updateId: input.updateId };
    }),
    restartFresh: vi.fn(async (pluginId) => {
      events.push(`service.old.restart:${pluginId}`);
    }),
    stop: vi.fn(async (pluginId) => {
      events.push(`service.old.stop:${pluginId}`);
    }),
  };

  const runtime = {
    record: candidateRecord,
    manifest: manifest(candidateRecord),
    root: "/private/immutable/candidate",
    artifactSha256: `sha256:${candidateRecord.installRevision}`,
  };
  const candidate: PluginRegistryUpdateCandidate = {
    runtime,
    async commitArtifact() {
      // Deliberately read through `this`: the manager must preserve installer method binding.
      current = this.runtime.record;
      events.push("pointer.commit");
    },
    async discardArtifact() {
      if (this.runtime !== runtime) throw new Error("candidate receiver was lost");
      events.push("artifact.candidate.discard");
    },
  };
  const manager = new PluginUpdateManager({
    plugins: {
      get: (pluginId) => (pluginId === PLUGIN_ID ? current : undefined),
    },
    modules,
    serviceHost: () => serviceHost,
    retireOldAuthority: async (pluginId) => {
      events.push(`authority.old.retire:${pluginId}`);
    },
    mintSourceLease: async (request) => {
      mints.push(request);
      tokenSequence += 1;
      const tokenId = `tk_${tokenSequence.toString(16).padStart(12, "0")}`;
      return {
        tokenId,
        token: `secret-${tokenSequence}`,
        pluginId: request.record.id,
        expiresAt: Date.now() + (options.leaseMs ?? 60_000),
      };
    },
    revokeSourceLease: async (request) => {
      revocations.push(request);
      events.push(`source.${request.purpose}.revoke:${request.reason}`);
    },
  });
  const coordinator = manager.coordinatorFor(PLUGIN_ID)!;
  coordinator.registerRenderer({
    identity: A,
    artifact: artifact(oldRecord),
    send: (command) => {
      commands.push(command);
      events.push(`renderer.command:${command.kind}`);
    },
  });
  return {
    manager,
    coordinator,
    candidate,
    oldRecord,
    candidateRecord,
    oldLiveModule,
    candidateModule,
    recoveryModule,
    events,
    commands,
    mints,
    revocations,
    candidateModulesDisposed,
    recoveryModulesDisposed,
    serviceDiscard,
    serviceRelease,
    current: () => current,
  };
}

function prepared(updateId: string, candidate: PluginRecord) {
  return {
    kind: "prepared" as const,
    updateId,
    pluginId: PLUGIN_ID,
    candidateArtifact: artifact(candidate),
  };
}

function committed(updateId: string, candidate: PluginRecord) {
  return {
    kind: "committed" as const,
    updateId,
    pluginId: PLUGIN_ID,
    candidateArtifact: artifact(candidate),
    commitEpoch: 2,
  };
}

describe("PluginUpdateManager (PRC-5e)", () => {
  it("owns private module/service/source authority through one committed barrier", async () => {
    const rig = fixture();
    const started = rig.manager.beginRegistryUpdate(rig.candidate);

    expect(rig.coordinator.routeOpen).toBe(false);
    expect(rig.commands.map((command) => command.kind)).toEqual(["prepare"]);
    const sourceHandle = await rig.manager.acquireSource({
      identity: A,
      fence: rig.coordinator.sourceFence(A, started.updateId, "candidate"),
    });
    const source = PluginUpdateSourceResult.parse(sourceHandle.value);
    expect(source).toMatchObject({
      updateId: started.updateId,
      purpose: "candidate",
      artifact: artifact(rig.candidateRecord),
      module: rig.candidateModule,
      lease: { leaseId: "tk_000000000001", token: "secret-1" },
    });
    expect(JSON.stringify(source)).not.toContain("/private/");
    expect(rig.mints[0]).toMatchObject({
      updateId: started.updateId,
      purpose: "candidate",
      identity: A,
      record: rig.candidateRecord,
    });
    await expect(
      rig.manager.releaseSource({
        identity: B,
        pluginId: PLUGIN_ID,
        updateId: started.updateId,
        leaseId: source.lease.leaseId,
      }),
    ).rejects.toMatchObject({ kind: "CONFLICT" });

    await rig.coordinator.acknowledge(A, prepared(started.updateId, rig.candidateRecord));
    expect(rig.current()).toBe(rig.candidateRecord);
    expect(rig.commands.map((command) => command.kind)).toEqual(["prepare", "commit"]);
    await rig.coordinator.acknowledge(A, committed(started.updateId, rig.candidateRecord));
    await expect(started.completion).resolves.toMatchObject({
      outcome: "committed",
      currentArtifact: artifact(rig.candidateRecord),
      commitEpoch: 2,
    });

    expect(rig.events).toEqual([
      "renderer.command:prepare",
      `authority.old.retire:${PLUGIN_ID}`,
      `modules.candidate.prepare:${started.updateId}`,
      `service.candidate.prepare:${started.updateId}`,
      "pointer.commit",
      "modules.candidate.promote",
      "service.candidate.commit",
      "renderer.command:commit",
      "service.candidate.release",
      "modules.candidate.dispose",
    ]);
    expect(rig.revocations).toEqual([]);
    expect(rig.candidateModulesDisposed).toHaveBeenCalledOnce();
    expect(rig.serviceRelease).toHaveBeenCalledOnce();

    await expect(
      rig.manager.releaseSource({
        identity: A,
        pluginId: PLUGIN_ID,
        updateId: started.updateId,
        leaseId: source.lease.leaseId,
      }),
    ).resolves.toBe(true);
    expect(rig.revocations).toEqual([
      expect.objectContaining({
        tokenId: source.lease.leaseId,
        updateId: started.updateId,
        purpose: "candidate",
        reason: "released",
      }),
    ]);
    await expect(
      rig.manager.releaseSource({
        identity: A,
        pluginId: PLUGIN_ID,
        updateId: started.updateId,
        leaseId: source.lease.leaseId,
      }),
    ).resolves.toBe(false);
    await rig.manager.dispose();
  });

  it("revokes failed candidate clients before fresh retained-old recovery", async () => {
    const rig = fixture();
    const started = rig.manager.beginRegistryUpdate(rig.candidate);
    const candidateHandle = await rig.manager.acquireSource({
      identity: A,
      fence: rig.coordinator.sourceFence(A, started.updateId, "candidate"),
    });
    const candidateSource = PluginUpdateSourceResult.parse(candidateHandle.value);

    await rig.coordinator.acknowledge(A, {
      kind: "failed",
      updateId: started.updateId,
      pluginId: PLUGIN_ID,
      at: "prepare",
      error: { code: "candidate-failed", message: "fixture failure" },
    });
    expect(rig.commands.map((command) => command.kind)).toEqual(["prepare", "recover-old"]);
    expect(rig.events.indexOf("source.candidate.revoke:candidate-failed")).toBeLessThan(
      rig.events.indexOf("renderer.command:recover-old"),
    );
    expect(rig.events.indexOf("modules.candidate.dispose")).toBeLessThan(
      rig.events.indexOf("renderer.command:recover-old"),
    );
    expect(rig.revocations).toEqual([
      expect.objectContaining({
        tokenId: candidateSource.lease.leaseId,
        purpose: "candidate",
        reason: "candidate-failed",
      }),
    ]);

    const recoveryHandle = await rig.manager.acquireSource({
      identity: A,
      fence: rig.coordinator.sourceFence(A, started.updateId, "recover-old"),
    });
    const recoverySource = PluginUpdateSourceResult.parse(recoveryHandle.value);
    expect(recoverySource).toMatchObject({
      purpose: "recover-old",
      artifact: artifact(rig.oldRecord),
      module: rig.recoveryModule,
    });
    expect(recoverySource.module.moduleUrl).not.toBe(rig.oldLiveModule.moduleUrl);
    await eventually(() => rig.events.includes(`service.old.restart:${PLUGIN_ID}`));

    await rig.coordinator.acknowledge(A, {
      kind: "recovered-old",
      updateId: started.updateId,
      pluginId: PLUGIN_ID,
      oldArtifact: artifact(rig.oldRecord),
    });
    await expect(started.completion).resolves.toMatchObject({
      outcome: "candidate-failed-old-recovered",
      currentArtifact: artifact(rig.oldRecord),
      commitEpoch: 1,
    });
    expect(rig.current()).toBe(rig.oldRecord);
    expect(rig.events).toContain("service.candidate.discard");
    expect(rig.events).toContain("artifact.candidate.discard");
    expect(rig.recoveryModulesDisposed).toHaveBeenCalledOnce();
    expect(rig.serviceDiscard).toHaveBeenCalledOnce();

    await expect(
      rig.manager.releaseSource({
        identity: A,
        pluginId: PLUGIN_ID,
        updateId: started.updateId,
        leaseId: recoverySource.lease.leaseId,
      }),
    ).resolves.toBe(true);
    expect(rig.revocations.at(-1)).toMatchObject({
      purpose: "recover-old",
      reason: "released",
    });
    await rig.manager.dispose();
  });

  it("disposes candidate authority that finishes preparing after recovery starts", async () => {
    const gate = deferred<void>();
    const rig = fixture({ candidateModuleGate: gate.promise });
    const started = rig.manager.beginRegistryUpdate(rig.candidate);

    await rig.coordinator.acknowledge(A, {
      kind: "failed",
      updateId: started.updateId,
      pluginId: PLUGIN_ID,
      at: "prepare",
      error: { code: "early-failure", message: "fail before module preparation settles" },
    });
    expect(rig.commands.map((command) => command.kind)).toEqual(["prepare", "recover-old"]);
    expect(rig.candidateModulesDisposed).not.toHaveBeenCalled();

    gate.resolve();
    await eventually(() => rig.candidateModulesDisposed.mock.calls.length === 1);
    await eventually(() => rig.events.includes(`service.old.restart:${PLUGIN_ID}`));
    await rig.coordinator.acknowledge(A, {
      kind: "recovered-old",
      updateId: started.updateId,
      pluginId: PLUGIN_ID,
      oldArtifact: artifact(rig.oldRecord),
    });
    await expect(started.completion).resolves.toMatchObject({
      outcome: "candidate-failed-old-recovered",
    });
    expect(rig.candidateModulesDisposed).toHaveBeenCalledOnce();
    expect(rig.serviceDiscard).toHaveBeenCalledOnce();
    await rig.manager.dispose();
  });

  it("expires an unreleased source once and makes its inverse idempotent", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-17T12:00:00.000Z"));
    const rig = fixture({ leaseMs: 1_000 });
    const started = rig.manager.beginRegistryUpdate(rig.candidate);
    const sourceHandle = await rig.manager.acquireSource({
      identity: A,
      fence: rig.coordinator.sourceFence(A, started.updateId, "candidate"),
    });
    const source = PluginUpdateSourceResult.parse(sourceHandle.value);

    await vi.advanceTimersByTimeAsync(1_000);
    expect(rig.revocations).toEqual([
      expect.objectContaining({
        tokenId: source.lease.leaseId,
        purpose: "candidate",
        reason: "expired",
      }),
    ]);
    await expect(
      rig.manager.releaseSource({
        identity: A,
        pluginId: PLUGIN_ID,
        updateId: started.updateId,
        leaseId: source.lease.leaseId,
      }),
    ).resolves.toBe(false);
    expect(rig.revocations).toHaveLength(1);
    await rig.manager.dispose();
    expect(rig.revocations).toHaveLength(1);
  });
});
