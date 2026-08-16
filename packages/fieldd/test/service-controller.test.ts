import { EventEmitter } from "node:events";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Worker, WorkerOptions } from "node:worker_threads";
import type { CallerContext } from "@vibefield/contracts";
import { describe, expect, it } from "vitest";
import type { PluginRegistryService } from "../src/plugin-registry";
import { ServiceHost } from "../src/service-host";
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
  service: "inactive";
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
): {
  host: ServiceHost;
  registry: ServiceRegistry;
  workers: ControllerWorker[];
  minted: number[];
  revoked: string[];
  firstWorker: Promise<ControllerWorker>;
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
    setServiceEntryState() {},
  };
  const registry = new ServiceRegistry({ grantedCapabilities: () => [] });
  const workers: ControllerWorker[] = [];
  const minted: number[] = [];
  const revoked: string[] = [];
  const firstWorker = deferred<ControllerWorker>();
  const host = new ServiceHost({
    registry,
    plugins: plugins as unknown as PluginRegistryService,
    tokens: {} as TokenService,
    controlPort: () => 1,
    deviceId: () => "device-prc3c",
    workerFactory: (_path: string, _options: WorkerOptions): Worker => {
      const worker = new ControllerWorker();
      workers.push(worker);
      if (workers.length === 1) firstWorker.resolve(worker);
      onWorker(worker, workers.length - 1);
      return worker as unknown as Worker;
    },
    mintServiceLease: async (_id, scopes, observation) => {
      minted.push(observation.grantGeneration);
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
  });
  return {
    host,
    registry,
    workers,
    minted,
    revoked,
    firstWorker: firstWorker.promise,
    update(change) {
      record = change(record);
    },
  };
}

function localCaller(): CallerContext {
  return {
    principal: { kind: "local-token", tokenId: "tk_prc3c", scopes: [] },
    transport: "ws-loopback",
    receivedAt: Date.now(),
  };
}

describe("ServiceHost exact target controller (PRC-3c)", () => {
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
});
