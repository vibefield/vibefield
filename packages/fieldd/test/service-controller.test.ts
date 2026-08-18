import { EventEmitter } from "node:events";
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Worker, WorkerOptions } from "node:worker_threads";
import type {
  CallerContext,
  PluginManifestV1,
  PluginRecord,
  PublicEntryState,
} from "@vibefield/contracts";
import type { Logger } from "@vibefield/logging";
import { describe, expect, it, vi } from "vitest";
import type { PluginRegistryService } from "../src/plugin-registry";
import { ServiceHost, type ServiceLeaseObservation } from "../src/service-host";
import { ServiceRegistry } from "../src/service-registry";
import type { TokenGrant, TokenService } from "../src/token-service";

const pluginId = "vibefield.prc.drain-control";
const namespace = `x.${pluginId}`;
const method = `${namespace}.echo`;
const fixtureRoot = join(
  dirname(fileURLToPath(import.meta.url)),
  "fixtures",
  "service-roots",
  "drain",
  "control",
);

function deferred<T>(): { promise: Promise<T>; resolve(value: T): void } {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

class ControllerWorker extends EventEmitter {
  readonly stdout = null;
  readonly stderr = null;
  readonly provided = deferred<void>();
  readonly posted: Array<Record<string, unknown>> = [];
  terminateCalls = 0;

  provide(): void {
    this.emit("message", {
      t: "provide",
      namespace,
      implemented: [
        { name: "echo", kind: "query" },
        { name: "slow", kind: "query" },
        { name: "ticks", kind: "subscription" },
      ],
    });
    this.provided.resolve(undefined);
  }

  activate(): void {
    this.emit("message", { t: "activated" });
  }

  postMessage(message: Record<string, unknown>): void {
    this.posted.push(message);
    if (message["t"] === "call") {
      queueMicrotask(() =>
        this.emit("message", {
          t: "result",
          id: message["id"],
          ok: true,
          value: { echo: "worker-ran" },
        }),
      );
    }
    if (message["t"] === "deactivate") {
      queueMicrotask(() =>
        this.emit("message", {
          t: "deactivated",
          requestId: message["requestId"],
          generation: message["generation"],
        }),
      );
    }
    if (message["t"] === "credential") {
      queueMicrotask(() =>
        this.emit("message", {
          t: "credential-rotated",
          requestId: message["requestId"],
          grantGeneration: message["grantGeneration"],
        }),
      );
    }
  }

  async terminate(): Promise<number> {
    this.terminateCalls += 1;
    this.emit("exit", 0);
    return 0;
  }
}

interface TestRecord {
  id: string;
  version: string;
  installRevision: string;
  manifestHash: string;
  grantGeneration: number;
  enabled: boolean;
  service: PublicEntryState;
  grantedCapabilities: string[];
}

function createRig(
  onWorker: (worker: ControllerWorker, index: number) => void = (worker) => {
    queueMicrotask(() => {
      worker.provide();
      worker.activate();
    });
  },
  mintLease?: (scopes: TokenGrant["scopes"], generation: number) => Promise<TokenGrant>,
  observation?: { readonly logger: Logger; readonly changed: () => void },
): {
  host: ServiceHost;
  registry: ServiceRegistry;
  workers: ControllerWorker[];
  minted: number[];
  observations: ServiceLeaseObservation[];
  revoked: string[];
  states: string[];
  workerOptions: WorkerOptions[];
  firstWorker: Promise<ControllerWorker>;
  record(): TestRecord;
  update(change: (record: TestRecord) => TestRecord): void;
} {
  let record: TestRecord = {
    id: pluginId,
    version: "0.1.0",
    installRevision: "prc3c-a",
    manifestHash: `sha256:${"d".repeat(64)}`,
    grantGeneration: 1,
    enabled: true,
    service: "inactive",
    grantedCapabilities: ["services.provide", "background"],
  };
  const states: string[] = [];
  const workerOptions: WorkerOptions[] = [];
  const plugins = {
    get(id: string) {
      return id === pluginId ? record : undefined;
    },
    list() {
      return [record];
    },
    rootPath(id: string) {
      return id === pluginId ? fixtureRoot : undefined;
    },
    setServiceEntryState(id: string, state: PublicEntryState) {
      states.push(state);
      if (id === pluginId) record = { ...record, service: state };
    },
  };
  const registry = new ServiceRegistry({ grantedCapabilities: () => [] });
  const workers: ControllerWorker[] = [];
  const minted: number[] = [];
  const observations: ServiceLeaseObservation[] = [];
  const revoked: string[] = [];
  const firstWorker = deferred<ControllerWorker>();
  const host = new ServiceHost({
    registry,
    plugins: plugins as unknown as PluginRegistryService,
    tokens: {} as TokenService,
    controlPort: () => 1,
    deviceId: () => "device-prc3c",
    workerFactory: (_path: string, options: WorkerOptions): Worker => {
      const worker = new ControllerWorker();
      workers.push(worker);
      workerOptions.push(options);
      if (workers.length === 1) firstWorker.resolve(worker);
      onWorker(worker, workers.length - 1);
      return worker as unknown as Worker;
    },
    mintServiceLease: async (_id, scopes, observation) => {
      minted.push(observation.grantGeneration);
      observations.push({ ...observation });
      if (mintLease !== undefined) return await mintLease(scopes, observation.grantGeneration);
      return {
        tokenId: `lease-${observation.grantGeneration}`,
        token: `secret-${observation.grantGeneration}`,
        scopes,
        label: "PRC-3c controller",
        pluginId,
      };
    },
    revokeServiceLease: async (_id, tokenId) => {
      revoked.push(tokenId);
    },
    deadlines: { activateMs: 500, deactivateMs: 100 },
    ...(observation === undefined
      ? {}
      : { logger: observation.logger, onDiagnosticsChanged: observation.changed }),
  });
  return {
    host,
    registry,
    workers,
    minted,
    observations,
    revoked,
    states,
    workerOptions,
    firstWorker: firstWorker.promise,
    record: () => record,
    update(change) {
      record = change(record);
    },
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
  const logger: Logger = {
    child: () => logger,
    ...calls,
    isLevelEnabled: () => true,
  };
  return { logger, calls };
}

function localCaller(): CallerContext {
  return {
    principal: { kind: "local-token", tokenId: "tk_prc3c", scopes: [] },
    transport: "ws-loopback",
    receivedAt: Date.now(),
  };
}

function candidateRecord(base: TestRecord, slot: string): PluginRecord {
  return {
    ...base,
    installRevision: slot,
    source: "registry",
    title: base.id,
    state: "enabled",
    compatible: true,
    requestedCapabilities: [...base.grantedCapabilities],
    deniedCapabilities: [],
    contributions: {
      widgets: [],
      behaviors: [],
      commands: [],
      surfaces: [],
      capabilities: [],
    },
    renderer: "none",
    registry: {
      indexRef: "file:///registry/index.json",
      artifactSha256: `sha256:${slot}`,
      publisher: "service-candidate-test",
    },
  };
}

describe("ServiceHost exact target controller (PRC-3c)", () => {
  it("projects passively and logs exactly once per service lifecycle transition", async () => {
    const { logger, calls } = lifecycleLogger();
    const changed = vi.fn();
    const rig = createRig(undefined, undefined, { logger, changed });
    expect(rig.host.diagnostic(pluginId)).toBeNull();

    await rig.host.start(pluginId);
    const lifecycleCalls = () =>
      [
        ...calls.trace.mock.calls,
        ...calls.debug.mock.calls,
        ...calls.info.mock.calls,
        ...calls.warn.mock.calls,
        ...calls.error.mock.calls,
        ...calls.fatal.mock.calls,
      ].filter((call) => call[0] === "fieldd.plugin_runtime.lifecycle");
    const logCount = () => lifecycleCalls().length;
    expect(rig.host.diagnostic(pluginId)?.state).toBe("active");
    expect(rig.host.census()).toMatchObject({
      entries: 1,
      workers: 1,
      activeControllerCandidates: 1,
      providerCandidates: 1,
      routeUnregisters: 1,
      activeLeases: 1,
      disposed: false,
    });
    expect(logCount()).toBe(rig.host.diagnostic(pluginId)?.history.length);
    expect(changed).toHaveBeenCalledTimes(logCount());

    const beforePoll = logCount();
    for (let index = 0; index < 100; index += 1) rig.host.diagnostic(pluginId);
    expect(logCount()).toBe(beforePoll);
    await rig.host.stop(pluginId);
    expect(logCount()).toBe(rig.host.diagnostic(pluginId)?.history.length);
    expect(changed).toHaveBeenCalledTimes(logCount());
    expect(rig.host.census()).toEqual({
      entries: 1,
      candidateEpisodes: 0,
      workers: 0,
      activeControllerCandidates: 0,
      preparedControllerCandidates: 0,
      providerCandidates: 0,
      routeUnregisters: 0,
      pendingCalls: 0,
      subscriptions: 0,
      restartTimers: 0,
      stopTasks: 0,
      drainWaiters: 0,
      outputCaptures: 0,
      activeLeases: 0,
      leaseReleases: 0,
      credentialWaiters: 0,
      disposed: false,
    });
    for (const call of lifecycleCalls()) {
      expect(call[0]).toBe("fieldd.plugin_runtime.lifecycle");
    }
    await rig.host.stopAll();
    expect(rig.host.diagnostic(pluginId)).toBeNull();
    expect(rig.host.census()).toEqual({
      entries: 0,
      candidateEpisodes: 0,
      workers: 0,
      activeControllerCandidates: 0,
      preparedControllerCandidates: 0,
      providerCandidates: 0,
      routeUnregisters: 0,
      pendingCalls: 0,
      subscriptions: 0,
      restartTimers: 0,
      stopTasks: 0,
      drainWaiters: 0,
      outputCaptures: 0,
      activeLeases: 0,
      leaseReleases: 0,
      credentialWaiters: 0,
      disposed: true,
    });
  });

  it("keeps failed shutdown boundaries counted instead of dropping their last owner", async () => {
    const rig = createRig();
    await rig.host.start(pluginId);
    const worker = rig.workers[0]!;
    const terminate = vi
      .spyOn(worker, "terminate")
      .mockRejectedValue(new Error("boundary refused"));

    await expect(rig.host.stopAll()).rejects.toThrow(/did not stop cleanly/);
    expect(rig.host.census()).toMatchObject({
      entries: 1,
      workers: 1,
      activeLeases: 1,
      disposed: true,
    });

    terminate.mockRestore();
    await worker.terminate();
    await Promise.resolve();
    await Promise.resolve();
    await expect(rig.host.stopAll()).resolves.toBeUndefined();
    expect(rig.host.census()).toMatchObject({ entries: 0, workers: 0, disposed: true });
  });

  it("keeps provider handlers private behind typed UNAVAILABLE until activated", async () => {
    const rig = createRig((worker) => queueMicrotask(() => worker.provide()));
    const start = rig.host.start(pluginId);
    const worker = await rig.firstWorker;
    await worker.provided.promise;

    expect(rig.registry.snapshot().providers).toEqual([]);
    expect(rig.registry.kindOf(method)).toBe("call");
    await expect(rig.registry.call(localCaller(), method, { msg: "early" })).rejects.toMatchObject({
      kind: "UNAVAILABLE",
    });
    expect(worker.posted.filter((message) => message["t"] === "call")).toEqual([]);

    worker.activate();
    await start;
    expect(rig.registry.snapshot().providers.map((provider) => provider.namespace)).toEqual([
      namespace,
    ]);
    await rig.host.stop(pluginId);
  });

  it("rotates an observation-only lease in place and replaces changed service authority", async () => {
    const rig = createRig();
    await rig.host.start(pluginId);
    rig.update((record) => ({
      ...record,
      grantGeneration: 2,
      grantedCapabilities: [...record.grantedCapabilities, "shell.open"],
    }));
    await rig.host.start(pluginId);

    expect(rig.workers).toHaveLength(1);
    expect(rig.minted).toEqual([1, 2]);
    expect(rig.revoked).toEqual(["lease-1"]);
    expect(rig.workers[0]?.posted).toContainEqual(
      expect.objectContaining({ t: "credential", token: "secret-2", grantGeneration: 2 }),
    );

    rig.update((record) => ({
      ...record,
      grantGeneration: 3,
      grantedCapabilities: [...record.grantedCapabilities, "process.spawn"],
    }));
    await rig.host.start(pluginId);

    expect(rig.workers).toHaveLength(2);
    expect(rig.workers[0]?.terminateCalls).toBe(1);
    expect(rig.minted).toEqual([1, 2, 3]);
    expect(rig.registry.snapshot().providers.map((provider) => provider.namespace)).toEqual([
      namespace,
    ]);
    await rig.host.stop(pluginId);
  });

  it("cannot commit an activation superseded by a newer observation", async () => {
    const rig = createRig((worker, index) => {
      queueMicrotask(() => {
        worker.provide();
        if (index > 0) worker.activate();
      });
    });
    const firstStart = rig.host.start(pluginId);
    const firstWorker = await rig.firstWorker;
    await firstWorker.provided.promise;
    expect(rig.registry.snapshot().providers).toEqual([]);

    rig.update((record) => ({
      ...record,
      grantGeneration: 2,
      grantedCapabilities: [...record.grantedCapabilities, "shell.open"],
    }));
    await rig.host.start(pluginId);
    await firstStart;

    expect(rig.workers).toHaveLength(2);
    expect(firstWorker.terminateCalls).toBe(1);
    expect(rig.minted).toEqual([1, 2]);
    expect(rig.registry.snapshot().providers.map((provider) => provider.namespace)).toEqual([
      namespace,
    ]);
    await rig.host.stop(pluginId);
  });

  it("revokes a superseded refresh mint and installs only the newest observation", async () => {
    const secondMint = deferred<TokenGrant>();
    const secondMintStarted = deferred<void>();
    const rig = createRig(
      (worker) => {
        queueMicrotask(() => {
          worker.provide();
          worker.activate();
        });
      },
      async (scopes, generation) => {
        if (generation === 2) {
          secondMintStarted.resolve(undefined);
          return await secondMint.promise;
        }
        return {
          tokenId: `lease-${generation}`,
          token: `secret-${generation}`,
          scopes,
          label: "PRC-3c refresh fence",
          pluginId,
        };
      },
    );
    await rig.host.start(pluginId);

    rig.update((record) => ({
      ...record,
      grantGeneration: 2,
      grantedCapabilities: [...record.grantedCapabilities, "shell.open"],
    }));
    const secondStart = rig.host.start(pluginId);
    await secondMintStarted.promise;
    rig.update((record) => ({
      ...record,
      grantGeneration: 3,
      grantedCapabilities: [...record.grantedCapabilities, "shell.dialog"],
    }));
    const thirdStart = rig.host.start(pluginId);
    secondMint.resolve({
      tokenId: "lease-2",
      token: "secret-2",
      scopes: ["services.provide", "background"],
      label: "superseded refresh",
      pluginId,
    });
    await Promise.all([secondStart, thirdStart]);

    expect(rig.workers).toHaveLength(1);
    expect(rig.minted).toEqual([1, 2, 3]);
    expect(rig.revoked).toEqual(["lease-2", "lease-1"]);
    expect(
      rig.workers[0]?.posted
        .filter((message) => message["t"] === "credential")
        .map((message) => message["grantGeneration"]),
    ).toEqual([3]);
    await rig.host.stop(pluginId);
  });

  it("activates an explicit immutable service candidate without publishing or moving live", async () => {
    const rig = createRig();
    await rig.host.start(pluginId);
    const candidateRoot = mkdtempSync(join(tmpdir(), "vf-service-candidate-"));
    try {
      cpSync(fixtureRoot, candidateRoot, { recursive: true });
      writeFileSync(join(candidateRoot, "service.js"), "// distinct candidate bytes\n");
      const candidateManifest = JSON.parse(
        readFileSync(join(candidateRoot, "vibefield.plugin.json"), "utf8"),
      ) as PluginManifestV1;
      const nextRecord = candidateRecord(rig.record(), "b".repeat(64));
      const stateMark = rig.states.length;
      const prepared = await rig.host.prepareCandidate({
        updateId: "pupd_service_candidate",
        baseInstallRevision: rig.record().installRevision,
        candidate: {
          record: nextRecord,
          manifest: candidateManifest,
          root: candidateRoot,
          artifactSha256: `sha256:${nextRecord.installRevision}`,
        },
      });
      expect(prepared).not.toBeNull();

      // Old provider is drained. Candidate declarations are typed but handlers
      // remain unavailable, and candidate entry state never impersonates live.
      expect(rig.registry.snapshot().providers).toEqual([]);
      expect(rig.registry.kindOf(method)).toBe("call");
      await expect(
        rig.registry.call(localCaller(), method, { msg: "early" }),
      ).rejects.toMatchObject({ kind: "UNAVAILABLE" });
      expect(rig.record().installRevision).toBe("prc3c-a");
      expect(rig.states.slice(stateMark)).toEqual(["inactive"]);
      expect(
        (rig.workerOptions[1]?.workerData as { entryPath?: string } | undefined)?.entryPath,
      ).toBe(join(candidateRoot, "service.js"));
      expect(rig.observations[1]).toMatchObject({
        installRevision: nextRecord.installRevision,
        manifestHash: nextRecord.manifestHash,
        grantGeneration: nextRecord.grantGeneration,
        updateId: "pupd_service_candidate",
      });
      expect(() => prepared!.commit()).toThrow(/stale service candidate/);

      // Pointer/registry movement is simulated only now; the exact prepared
      // worker publishes synchronously and becomes the controller's live face.
      rig.update(() => nextRecord as TestRecord);
      prepared!.commit();
      expect(rig.registry.snapshot().providers.map((provider) => provider.namespace)).toEqual([
        namespace,
      ]);
      await expect(rig.registry.call(localCaller(), method, { msg: "after" })).resolves.toEqual({
        echo: "worker-ran",
      });
      expect(rig.states.at(-1)).toBe("active");
      prepared!.release();
      await rig.host.stop(pluginId);
    } finally {
      rmSync(candidateRoot, { recursive: true, force: true });
    }
  });

  it("discards a private service candidate and can restart retained old authority", async () => {
    const rig = createRig();
    await rig.host.start(pluginId);
    const candidateRoot = mkdtempSync(join(tmpdir(), "vf-service-candidate-discard-"));
    try {
      cpSync(fixtureRoot, candidateRoot, { recursive: true });
      const nextRecord = candidateRecord(rig.record(), "c".repeat(64));
      const prepared = await rig.host.prepareCandidate({
        updateId: "pupd_service_discard",
        baseInstallRevision: rig.record().installRevision,
        candidate: {
          record: nextRecord,
          manifest: JSON.parse(
            readFileSync(join(candidateRoot, "vibefield.plugin.json"), "utf8"),
          ) as PluginManifestV1,
          root: candidateRoot,
          artifactSha256: `sha256:${nextRecord.installRevision}`,
        },
      });
      await prepared!.discard();

      expect(rig.record().installRevision).toBe("prc3c-a");
      expect(rig.registry.snapshot().providers).toEqual([]);
      expect(rig.workers[1]?.terminateCalls).toBe(1);

      await rig.host.start(pluginId);
      expect(rig.workers).toHaveLength(3);
      expect(rig.registry.snapshot().providers.map((provider) => provider.namespace)).toEqual([
        namespace,
      ]);
      await rig.host.stop(pluginId);
    } finally {
      rmSync(candidateRoot, { recursive: true, force: true });
    }
  });

  it("refuses candidate commit when the current row is not the prepared authority observation", async () => {
    const rig = createRig();
    await rig.host.start(pluginId);
    const candidateRoot = mkdtempSync(join(tmpdir(), "vf-service-candidate-stale-"));
    try {
      cpSync(fixtureRoot, candidateRoot, { recursive: true });
      const nextRecord = candidateRecord(rig.record(), "e".repeat(64));
      const prepared = await rig.host.prepareCandidate({
        updateId: "pupd_service_stale",
        baseInstallRevision: rig.record().installRevision,
        candidate: {
          record: nextRecord,
          manifest: JSON.parse(
            readFileSync(join(candidateRoot, "vibefield.plugin.json"), "utf8"),
          ) as PluginManifestV1,
          root: candidateRoot,
          artifactSha256: `sha256:${nextRecord.installRevision}`,
        },
      });
      rig.update(() => ({ ...nextRecord, grantGeneration: 2 }) as TestRecord);

      expect(() => prepared!.commit()).toThrow(/stale service candidate/);
      expect(rig.registry.snapshot().providers).toEqual([]);
      await prepared!.discard();
    } finally {
      rmSync(candidateRoot, { recursive: true, force: true });
    }
  });
});
