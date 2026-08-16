import { EventEmitter } from "node:events";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Worker, WorkerOptions } from "node:worker_threads";
import { describe, expect, it } from "vitest";
import type { PluginRegistryService } from "../src/plugin-registry";
import { ServiceHost } from "../src/service-host";
import type { ServiceProviderBinding, ServiceProviderHandlers } from "../src/service-registry";
import type { TokenService } from "../src/token-service";

const here = dirname(fileURLToPath(import.meta.url));
const fixtureRoot = join(here, "fixtures", "service-roots", "drain", "control");
const id = "vibefield.prc.drain-control";
const namespace = "x.vibefield.prc.drain-control";

class ProtocolWorker extends EventEmitter {
  readonly stdout = null;
  readonly stderr = null;
  readonly posted: Array<Record<string, unknown>> = [];
  terminateCalls = 0;

  constructor(private readonly callDelayMs: number | null) {
    super();
  }

  postMessage(message: Record<string, unknown>): void {
    this.posted.push(message);
    if (message["t"] !== "call" || this.callDelayMs === null) return;
    setTimeout(() => {
      this.emit("message", {
        t: "result",
        id: message["id"],
        ok: true,
        value: { echo: "old" },
      });
    }, this.callDelayMs);
  }

  async terminate(): Promise<number> {
    this.terminateCalls += 1;
    this.emit("exit", 0);
    return 0;
  }
}

async function createHarness(callDelayMs: number | null): Promise<{
  host: ServiceHost;
  worker: ProtocolWorker;
  handlers: ServiceProviderHandlers;
  drainCalls: () => number;
}> {
  const worker = new ProtocolWorker(callDelayMs);
  let handlers: ServiceProviderHandlers | undefined;
  let drainCount = 0;
  const registry = {
    stage(binding: ServiceProviderBinding) {
      handlers = binding.handlers;
      return { commit() {}, dispose() {} };
    },
    beginDrainPlugin() {
      drainCount += 1;
    },
    withdrawPlugin() {},
  };
  const record = {
    id,
    version: "0.1.0",
    enabled: true,
    grantedCapabilities: ["services.provide", "background"],
  };
  const plugins = {
    get(pluginId: string) {
      return pluginId === id ? record : undefined;
    },
    list() {
      return [record];
    },
    rootPath(pluginId: string) {
      return pluginId === id ? fixtureRoot : undefined;
    },
    setServiceEntryState() {},
  };
  const factory = (_harnessPath: string, _options: WorkerOptions): Worker => {
    setTimeout(() => {
      worker.emit("message", {
        t: "provide",
        namespace,
        implemented: [
          { name: "echo", kind: "query" },
          { name: "slow", kind: "query" },
          { name: "ticks", kind: "subscription" },
        ],
      });
      worker.emit("message", { t: "activated" });
    }, 0);
    return worker as unknown as Worker;
  };
  const host = new ServiceHost({
    registry: registry as never,
    plugins: plugins as unknown as PluginRegistryService,
    tokens: {} as TokenService,
    controlPort: () => 1,
    workerFactory: factory,
    deadlines: { activateMs: 500, deactivateMs: 100 },
    mintServiceLease: async (_pluginId, scopes) => ({
      tokenId: "lease-1",
      token: "lease-secret",
      scopes,
      label: "test service lease",
      pluginId: id,
    }),
    revokeServiceLease: async () => undefined,
  });
  await host.start(id);
  if (handlers === undefined) throw new Error("fixture provider did not register");
  return { host, worker, handlers, drainCalls: () => drainCount };
}

describe("ServiceHost absolute drain deadline (PRC-2)", () => {
  it("shares one deadline between admitted-call drain and worker cleanup", async () => {
    const { host, worker, handlers } = await createHarness(55);
    const admitted = handlers.call("slow", {}, { kind: "shell-main" });
    const startedAt = Date.now();

    await Promise.all([host.stop(id), host.stop(id)]);
    const elapsed = Date.now() - startedAt;

    await expect(admitted).resolves.toEqual({ echo: "old" });
    expect(elapsed).toBeGreaterThanOrEqual(80);
    expect(elapsed).toBeLessThan(175);
    expect(worker.posted.filter((message) => message["t"] === "deactivate")).toHaveLength(1);
    expect(worker.terminateCalls).toBe(1);
  });

  it("fails a stuck admitted call at the deadline and force-terminates once", async () => {
    const { host, worker, handlers, drainCalls } = await createHarness(null);
    const admitted = handlers.call("slow", {}, { kind: "shell-main" });
    const outcome = admitted.catch((error: unknown) => error);
    const startedAt = Date.now();

    await Promise.all([host.stop(id), host.stop(id)]);
    const elapsed = Date.now() - startedAt;

    await expect(outcome).resolves.toMatchObject({ message: "provider drain deadline exceeded" });
    expect(elapsed).toBeGreaterThanOrEqual(80);
    expect(elapsed).toBeLessThan(175);
    expect(worker.posted.filter((message) => message["t"] === "deactivate")).toHaveLength(0);
    expect(worker.terminateCalls).toBe(1);
    expect(drainCalls()).toBe(1);
  });
});
