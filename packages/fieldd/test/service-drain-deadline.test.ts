import { EventEmitter } from "node:events";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Worker, WorkerOptions } from "node:worker_threads";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { PluginRegistryService } from "../src/plugin-registry";
import { ServiceHost } from "../src/service-host";
import type { ServiceProviderBinding, ServiceProviderHandlers } from "../src/service-registry";
import type { TokenService } from "../src/token-service";

const here = dirname(fileURLToPath(import.meta.url));

/** A stalled host: this thread blocked for `ms` of real time, as a loaded
 * machine stalls the daemon's event loop. */
function stall(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}
const fixtureRoot = join(here, "fixtures", "service-roots", "drain", "control");
const id = "vibefield.prc.drain-control";
const namespace = "x.vibefield.prc.drain-control";
/** the host's drain deadline (`deadlines.deactivateMs`) */
const DEADLINE_MS = 100;

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
    deadlines: { activateMs: 500, deactivateMs: DEADLINE_MS },
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

// DEBTS (s-debts-fieldd.md Appendix 3) — the deadline is measured on the
// host's own clocks, and these rows fake them (`setTimeout` and `Date` only:
// the harness's activation and every promise stay real). On real timers a
// stalled host slipped the 55 ms call past the 100 ms deadline (LANDED :5375,
// :7259; lanes/pins 10-08; the MV lead's gate of 2026-10-14). Each row stalls
// this thread 200 ms of REAL time after the stop begins, the load that broke
// them, and the window is asserted exact: the stop settles at the deadline.
/** The stop under the host's own clocks, faked: when it settled, from its start. */
async function stopOnHostClock(host: ServiceHost): Promise<number> {
  const startedAt = Date.now();
  const settledAt = Promise.all([host.stop(id), host.stop(id)]).then(() => Date.now());
  stall(200);
  await vi.advanceTimersByTimeAsync(DEADLINE_MS * 3);
  return (await settledAt) - startedAt;
}

describe("ServiceHost absolute drain deadline (PRC-2)", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("shares one deadline between admitted-call drain and worker cleanup", async () => {
    const { host, worker, handlers } = await createHarness(55);
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
    const admitted = handlers.call("slow", {}, { kind: "shell-main" });

    const elapsed = await stopOnHostClock(host);

    // the call drained at 55 ms inside the deadline; the worker, asked to
    // deactivate, never exits — it is ended at the deadline, once
    await expect(admitted).resolves.toEqual({ echo: "old" });
    expect(elapsed).toBe(DEADLINE_MS);
    expect(worker.posted.filter((message) => message["t"] === "deactivate")).toHaveLength(1);
    expect(worker.terminateCalls).toBe(1);
  });

  it("fails a stuck admitted call at the deadline and force-terminates once", async () => {
    const { host, worker, handlers, drainCalls } = await createHarness(null);
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
    const admitted = handlers.call("slow", {}, { kind: "shell-main" });
    const outcome = admitted.catch((error: unknown) => error);

    const elapsed = await stopOnHostClock(host);

    await expect(outcome).resolves.toMatchObject({ message: "provider drain deadline exceeded" });
    expect(elapsed).toBe(DEADLINE_MS);
    expect(worker.posted.filter((message) => message["t"] === "deactivate")).toHaveLength(0);
    expect(worker.terminateCalls).toBe(1);
    expect(drainCalls()).toBe(1);
  });
});
