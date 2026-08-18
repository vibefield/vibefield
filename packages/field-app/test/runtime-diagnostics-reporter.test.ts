import { PluginRuntimeBehaviorGenerationDiagnostic } from "@vibefield/contracts";
import {
  type RendererRuntimeTarget,
  type RuntimeTargetCandidate,
  RuntimeTargetController,
} from "@vibefield/plugin-runtime";
import { describe, expect, it, vi } from "vitest";
import type { RendererLogger } from "../src/logging";
import { RendererRuntimeDiagnosticsReporter } from "../src/plugin-host/runtime-diagnostics-reporter";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
}

function logger() {
  const methods = {
    trace: vi.fn(),
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    fatal: vi.fn(),
  };
  const value: RendererLogger = {
    child: () => value,
    ...methods,
    isLevelEnabled: () => true,
  };
  return { value, ...methods };
}

function diagnostic() {
  const controller = new RuntimeTargetController<RendererRuntimeTarget, RuntimeTargetCandidate>(
    "renderer:com.example.reporter:field",
    {
      activate: () => ({ commit: () => undefined, dispose: () => undefined }),
    },
  );
  return controller.diagnostic();
}

function behaviorDiagnostic() {
  const pluginId = "com.example.reporter";
  return PluginRuntimeBehaviorGenerationDiagnostic.parse({
    pluginId,
    state: "active",
    target: { windowId: "field", documentId: "doc-a", runtimeGeneration: "engine-a" },
    rendererTargets: [
      {
        face: "renderer",
        pluginId,
        artifact: { installRevision: "revision-1", manifestHash: "sha256:artifact-1" },
        authorityFingerprint: "[]",
        observedGrantGeneration: 0,
        instanceKey: { windowId: "field" },
      },
    ],
    desiredCount: 1,
    installedCount: 1,
    blockedCount: 0,
    failedCount: 0,
    suspendedCount: 0,
    declarations: [
      {
        declarationId: `${pluginId}:layout`,
        rendererTarget: 0,
        status: "installed",
        breaker: null,
      },
    ],
    omittedDeclarations: 0,
  });
}

describe("RendererRuntimeDiagnosticsReporter (PRC-6b)", () => {
  it("retains one in-flight request and only the latest plain report behind it", async () => {
    const first = deferred<unknown>();
    const requests: unknown[] = [];
    const log = logger();
    const request = vi.fn(async (_method: string, params?: unknown) => {
      requests.push(params);
      if (requests.length === 1) return await first.promise;
      return { accepted: true, generation: requests.length };
    });
    const reporter = new RendererRuntimeDiagnosticsReporter({ request, logger: log.value });
    const value = diagnostic();

    reporter.publish("com.example.reporter", value, behaviorDiagnostic());
    await Promise.resolve();
    for (let index = 0; index < 10_000; index += 1) {
      reporter.publish("com.example.reporter", value);
    }
    expect(reporter.state()).toEqual({
      inFlight: 1,
      pending: 1,
      trackedPlugins: 1,
      closed: false,
    });
    expect(requests).toHaveLength(1);
    expect(JSON.stringify(requests[0])).not.toMatch(/candidate|dispose|promise|scopeFactory/);

    first.resolve({ accepted: true, generation: 1 });
    await vi.waitFor(() => expect(requests).toHaveLength(2));
    expect(requests[0]).toMatchObject({ sequence: 1 });
    expect(requests[0]).toMatchObject({
      behaviorGeneration: { pluginId: "com.example.reporter", installedCount: 1 },
    });
    expect(requests[1]).toMatchObject({ sequence: 10_001 });
    await vi.waitFor(() =>
      expect(reporter.state()).toEqual({
        inFlight: 0,
        pending: 0,
        trackedPlugins: 1,
        closed: false,
      }),
    );
  });

  it("bounds sequence state as well as pending reports across distinct plugins", async () => {
    const first = deferred<unknown>();
    const log = logger();
    const request = vi.fn(async () => await first.promise);
    const reporter = new RendererRuntimeDiagnosticsReporter({ request, logger: log.value });
    const value = diagnostic();

    for (let index = 0; index < 256; index += 1) {
      reporter.publish(`com.example.reporter-${index}`, value);
    }
    await Promise.resolve();
    reporter.publish("com.example.reporter-overflow", value);

    expect(reporter.state()).toEqual({
      inFlight: 1,
      pending: 255,
      trackedPlugins: 256,
      closed: false,
    });
    expect(log.warn).toHaveBeenCalledWith(
      "renderer.plugin_runtime.report_queue_bounded",
      expect.any(String),
      { pluginLimit: 256 },
    );
    first.resolve({ accepted: true, generation: 1 });
    reporter.close();
  });

  it("contains rejection, logs one outage, and announces recovery once", async () => {
    const log = logger();
    let fail = true;
    const reporter = new RendererRuntimeDiagnosticsReporter({
      request: async () => {
        if (fail) throw new Error("offline");
        return { accepted: true, generation: 2 };
      },
      logger: log.value,
    });
    const value = diagnostic();

    reporter.publish("com.example.reporter", value);
    reporter.publish("com.example.reporter", value);
    await vi.waitFor(() => expect(reporter.state().inFlight).toBe(0));
    expect(log.warn).toHaveBeenCalledTimes(1);

    fail = false;
    reporter.publish("com.example.reporter", value);
    await vi.waitFor(() => expect(reporter.state().inFlight).toBe(0));
    expect(log.info).toHaveBeenCalledWith(
      "renderer.plugin_runtime.report_recovered",
      expect.any(String),
      { pluginId: "com.example.reporter" },
    );
  });

  it("drops pending plain reports on close without awaiting a stuck request", async () => {
    const stuck = deferred<unknown>();
    const log = logger();
    const reporter = new RendererRuntimeDiagnosticsReporter({
      request: async () => await stuck.promise,
      logger: log.value,
    });
    const value = diagnostic();
    reporter.publish("com.example.reporter", value);
    await Promise.resolve();
    reporter.publish("com.example.reporter", value);
    reporter.close();

    expect(reporter.state()).toEqual({
      inFlight: 1,
      pending: 0,
      trackedPlugins: 0,
      closed: true,
    });
    stuck.resolve({ accepted: true, generation: 1 });
    await vi.waitFor(() =>
      expect(reporter.state()).toEqual({
        inFlight: 0,
        pending: 0,
        trackedPlugins: 0,
        closed: true,
      }),
    );
  });
});
