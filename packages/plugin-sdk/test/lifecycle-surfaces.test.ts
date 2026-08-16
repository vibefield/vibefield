import { describe, expect, it } from "vitest";
import {
  createProcessSurfaces,
  createStorageSurfaces,
  type PluginProductClient,
} from "../src/index";

function deferred<T>(): { promise: Promise<T>; resolve(value: T): void } {
  let resolvePromise: ((value: T) => void) | undefined;
  const promise = new Promise<T>((resolve) => {
    resolvePromise = resolve;
  });
  return { promise, resolve: (value) => resolvePromise?.(value) };
}

describe("SDK host-issued lifecycle handles", () => {
  it("awaits process and endpoint release requests", async () => {
    const processRelease = deferred<unknown>();
    const endpointRelease = deferred<unknown>();
    const client: PluginProductClient = {
      async request(method) {
        if (method === "process.spawn") return { proc: { procId: "proc-1" } };
        if (method === "process.signal") return processRelease.promise;
        if (method === "services.registerEndpoint") return { ok: true };
        if (method === "services.unregisterEndpoint") return endpointRelease.promise;
        throw new Error(`unexpected request: ${method}`);
      },
      subscribe: () => Promise.reject(new Error("not used")),
    };
    const surfaces = createProcessSurfaces(client);
    const processHandle = await surfaces.process.spawn({
      executable: "/fixture",
      restart: "never",
    });
    const endpointHandle = await surfaces.endpoints.register({
      serviceId: "x.vibefield.mock.http",
      endpoint: { protocol: "http", port: 1234 },
      health: { path: "/health", intervalMs: 1000 },
      expose: { app: true, mesh: false, mcp: false },
    });

    let processDisposed = false;
    let endpointDisposed = false;
    const processTask = Promise.resolve(processHandle.dispose()).then(() => {
      processDisposed = true;
    });
    const endpointTask = Promise.resolve(endpointHandle.dispose()).then(() => {
      endpointDisposed = true;
    });
    await Promise.resolve();
    expect({ processDisposed, endpointDisposed }).toEqual({
      processDisposed: false,
      endpointDisposed: false,
    });

    processRelease.resolve({ ok: true });
    endpointRelease.resolve({ ok: true });
    await Promise.all([processTask, endpointTask]);
    expect({ processDisposed, endpointDisposed }).toEqual({
      processDisposed: true,
      endpointDisposed: true,
    });
  });

  it("keeps settings disposal pending until an in-flight subscription can release", async () => {
    const subscribed = deferred<{
      snapshot: unknown;
      unsubscribe: () => void;
    }>();
    let unsubscribeCalls = 0;
    const client: PluginProductClient = {
      request: () => Promise.reject(new Error("not used")),
      subscribe: () => subscribed.promise,
    };
    const resource = createStorageSurfaces(client).settings.subscribe("theme", () => undefined);

    let disposed = false;
    const disposeTask = Promise.resolve(resource.dispose()).then(() => {
      disposed = true;
    });
    await Promise.resolve();
    expect(disposed).toBe(false);

    subscribed.resolve({
      snapshot: { values: { theme: "dark" } },
      unsubscribe() {
        unsubscribeCalls += 1;
      },
    });
    await disposeTask;
    expect(disposed).toBe(true);
    expect(unsubscribeCalls).toBe(1);
  });
});
