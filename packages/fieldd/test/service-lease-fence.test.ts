import { EventEmitter } from "node:events";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Worker, WorkerOptions } from "node:worker_threads";
import { describe, expect, it } from "vitest";
import type { PluginRegistryService } from "../src/plugin-registry";
import { ServiceHost } from "../src/service-host";
import type { TokenGrant, TokenService } from "../src/token-service";

const pluginId = "vibefield.prc.drain-control";
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

class NeverStartedWorker extends EventEmitter {
  readonly stdout = null;
  readonly stderr = null;
  postMessage(): void {}
  async terminate(): Promise<number> {
    this.emit("exit", 0);
    return 0;
  }
}

describe("ServiceHost lease mint fence", () => {
  it("revokes a mint superseded by drain and never constructs its worker", async () => {
    let record = {
      id: pluginId,
      version: "0.1.0",
      enabled: true,
      manifestHash: `sha256:${"a".repeat(64)}`,
      grantGeneration: 1,
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
    const mint = deferred<TokenGrant>();
    const mintStarted = deferred<void>();
    const revoked: string[] = [];
    let workerConstructions = 0;
    const host = new ServiceHost({
      registry: {
        register() {
          throw new Error("stale worker must not register");
        },
        beginDrainPlugin() {},
        withdrawPlugin() {},
      } as never,
      plugins: plugins as unknown as PluginRegistryService,
      tokens: {} as TokenService,
      controlPort: () => 1,
      mintServiceLease: async () => {
        mintStarted.resolve();
        return await mint.promise;
      },
      revokeServiceLease: async (_id, tokenId) => {
        revoked.push(tokenId);
      },
      workerFactory: (_path: string, _options: WorkerOptions): Worker => {
        workerConstructions += 1;
        const worker = new NeverStartedWorker();
        setTimeout(() => worker.emit("message", { t: "activated" }), 0);
        return worker as unknown as Worker;
      },
      deadlines: { activateMs: 100, deactivateMs: 50 },
    });

    const started = host.start(pluginId);
    await mintStarted.promise;
    record = { ...record, grantGeneration: 2, grantedCapabilities: ["services.provide"] };
    host.beginDrain(pluginId);
    await host.stop(pluginId);
    mint.resolve({
      tokenId: "lease-stale",
      token: "secret",
      scopes: ["services.provide", "background"],
      label: "stale",
      pluginId,
    });

    await expect(started).resolves.toBeUndefined();
    expect(revoked).toEqual(["lease-stale"]);
    expect(workerConstructions).toBe(0);
    expect(host.state(pluginId)).toBe("inactive");
  });

  it("a stop in activation ends after the worker-exit lease release (item 485)", async () => {
    // A stop that lands while the service is still activating (its worker built, no `activated`
    // yet): the abort terminates the worker, and the worker's exit begins the lease's release. No
    // candidate exists to join that release, so the stop must, or stopAll finds it in flight and
    // throws. The gate holds the release open on purpose; on a slow machine the audit write does.
    const record = {
      id: pluginId,
      version: "0.1.0",
      enabled: true,
      manifestHash: `sha256:${"a".repeat(64)}`,
      grantGeneration: 1,
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
    const built = deferred<void>();
    const gate = deferred<void>();
    const revoked: string[] = [];
    const host = new ServiceHost({
      registry: {
        register() {
          throw new Error("a worker that never activated must not register");
        },
        beginDrainPlugin() {},
        withdrawPlugin() {},
      } as never,
      plugins: plugins as unknown as PluginRegistryService,
      tokens: {} as TokenService,
      controlPort: () => 1,
      mintServiceLease: async () => ({
        tokenId: "lease-live",
        token: "secret",
        scopes: ["services.provide", "background"],
        label: "live",
        pluginId,
      }),
      revokeServiceLease: async (_id, tokenId, reason) => {
        revoked.push(`${tokenId} by ${reason}`);
        await gate.promise;
      },
      workerFactory: (_path: string, _options: WorkerOptions): Worker => {
        built.resolve();
        return new NeverStartedWorker() as unknown as Worker;
      },
      deadlines: { activateMs: 1_000, deactivateMs: 50 },
    });
    const end = (error: unknown): string =>
      error instanceof AggregateError
        ? `rejected: ${error.errors.map(String).join("; ")}`
        : `rejected: ${String(error)}`;

    const started = host.start(pluginId).then(() => "resolved", end);
    await built.promise;
    const stopped = host.stopAll().then(() => "resolved", end);
    const early = await Promise.race([
      stopped,
      new Promise<string>((done) => setTimeout(() => done("pending"), 50)),
    ]);
    gate.resolve();
    await started;

    expect(early, early).toBe("pending");
    expect(await stopped).toBe("resolved");
    expect(revoked).toEqual(["lease-live by worker-exit"]);
    // stopAll drops an entry that stopped clean, so "none" is itself the witness that no
    // residue stood.
    expect(host.state(pluginId)).toBe("none");
  });
});
