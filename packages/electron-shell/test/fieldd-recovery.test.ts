import type { FielddHandle, FielddSupervisor } from "@vibefield/fieldd-supervisor";
import { describe, expect, it, vi } from "vitest";
import { FielddHandleCoordinator } from "../src/main/fieldd-handle-coordinator";
import { RecoveringFielddObservers } from "../src/main/recovering-fieldd-observers";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function handle(
  name: string,
  subscriptions: Array<{
    method: string;
    result: ReturnType<typeof deferred<{ snapshot: unknown; unsubscribe: () => void }>>;
  }>,
): FielddHandle {
  const statusListeners = new Set<() => void>();
  const client = {
    status: "ready",
    onStatusChange: vi.fn((listener: () => void) => {
      statusListeners.add(listener);
      return () => statusListeners.delete(listener);
    }),
    subscribe: vi.fn((method: string) => {
      const result = deferred<{ snapshot: unknown; unsubscribe: () => void }>();
      subscriptions.push({ method: `${name}:${method}`, result });
      return result.promise;
    }),
  };
  return {
    info: { bootId: name, port: 4242 },
    client,
  } as unknown as FielddHandle;
}

describe("fieldd main-process recovery", () => {
  it("publishes a handle after an initial ensure failure and a later renderer retry", async () => {
    const readyHandle = handle("boot-2", []);
    const upstream = vi
      .fn()
      .mockRejectedValueOnce(new Error("first boot failed"))
      .mockResolvedValueOnce(readyHandle) as unknown as FielddSupervisor["ensure"];
    const failures: unknown[] = [];
    const coordinator = new FielddHandleCoordinator(upstream, (error) => failures.push(error));
    const observed: FielddHandle[] = [];
    coordinator.onHandle((value) => observed.push(value));

    await expect(coordinator.ensure()).rejects.toThrow("first boot failed");
    expect(observed).toEqual([]);
    await expect(coordinator.ensure()).resolves.toBe(readyHandle);
    expect(observed).toEqual([readyHandle]);
    expect(failures).toHaveLength(1);
  });

  it("isolates observer failures from a healthy ensure and from sibling observers", async () => {
    const readyHandle = handle("boot-1", []);
    const upstream = vi.fn(async () => readyHandle) as unknown as FielddSupervisor["ensure"];
    const ensureFailures = vi.fn();
    const listenerFailures = vi.fn();
    const coordinator = new FielddHandleCoordinator(upstream, ensureFailures, listenerFailures);
    const observed = vi.fn();
    coordinator.onHandle(() => {
      throw new Error("observer bind exploded");
    });
    coordinator.onHandle(observed);

    await expect(coordinator.ensure()).resolves.toBe(readyHandle);
    expect(observed).toHaveBeenCalledWith(readyHandle);
    expect(listenerFailures).toHaveBeenCalledTimes(1);
    expect(ensureFailures).not.toHaveBeenCalled();
  });

  it("rebinds every observer and disposes late subscriptions from the stale handle", async () => {
    const oldSubscriptions: Array<{
      method: string;
      result: ReturnType<typeof deferred<{ snapshot: unknown; unsubscribe: () => void }>>;
    }> = [];
    const newSubscriptions: typeof oldSubscriptions = [];
    const oldHandle = handle("old", oldSubscriptions);
    const newHandle = handle("new", newSubscriptions);
    const upstream = vi
      .fn()
      .mockResolvedValueOnce(oldHandle)
      .mockResolvedValueOnce(newHandle) as unknown as FielddSupervisor["ensure"];
    const coordinator = new FielddHandleCoordinator(upstream);
    const pluginStops: Record<string, ReturnType<typeof vi.fn>> = {};
    const pluginPending = new Map<string, ReturnType<typeof deferred<() => void>>>();
    const preferences: unknown[] = [];
    const health: unknown[] = [];
    const observers = new RecoveringFielddObservers(coordinator, {
      onStatus: vi.fn(),
      observePlugins: async (client) => {
        const boot = client === oldHandle.client ? "old" : "new";
        const pending = deferred<() => void>();
        pluginPending.set(boot, pending);
        return await pending.promise;
      },
      onPreferences: (value) => preferences.push(value),
      onHealth: (value) => health.push(value),
      onError: vi.fn(),
    });

    await coordinator.ensure();
    expect(oldSubscriptions.map(({ method }) => method)).toEqual([
      "old:storage.appPreferences.subscribe",
      "old:system.health.subscribe",
    ]);
    await coordinator.ensure();
    expect(newSubscriptions.map(({ method }) => method)).toEqual([
      "new:storage.appPreferences.subscribe",
      "new:system.health.subscribe",
    ]);

    for (const subscription of oldSubscriptions) {
      const unsubscribe = vi.fn();
      subscription.result.resolve({ snapshot: "stale", unsubscribe });
      await vi.waitFor(() => expect(unsubscribe).toHaveBeenCalledTimes(1));
    }
    pluginStops.old = vi.fn();
    pluginPending.get("old")?.resolve(pluginStops.old);
    await vi.waitFor(() => expect(pluginStops.old).toHaveBeenCalledTimes(1));
    expect(preferences).toEqual([]);
    expect(health).toEqual([]);

    for (const subscription of newSubscriptions) {
      subscription.result.resolve({
        snapshot: subscription.method.includes("Preferences") ? "prefs-new" : "health-new",
        unsubscribe: vi.fn(),
      });
    }
    pluginStops.new = vi.fn();
    pluginPending.get("new")?.resolve(pluginStops.new);
    await vi.waitFor(() => {
      expect(preferences).toEqual(["prefs-new"]);
      expect(health).toEqual(["health-new"]);
    });

    observers.dispose();
    await vi.waitFor(() => expect(pluginStops.new).toHaveBeenCalledTimes(1));
  });

  it("repairs an initial subscription failure when the same client becomes ready again", async () => {
    let status = "ready";
    const statusListeners = new Set<() => void>();
    let preferenceAttempts = 0;
    const unsubscribeHealth = vi.fn();
    const unsubscribePreferences = vi.fn();
    const subscribe = vi.fn(async (method: string) => {
      if (method === "storage.appPreferences.subscribe") {
        preferenceAttempts += 1;
        if (preferenceAttempts === 1) throw new Error("transport dropped during subscribe");
        return { snapshot: "prefs-recovered", unsubscribe: unsubscribePreferences };
      }
      return { snapshot: "health-ready", unsubscribe: unsubscribeHealth };
    });
    const client = {
      get status() {
        return status;
      },
      onStatusChange: vi.fn((listener: () => void) => {
        statusListeners.add(listener);
        return () => statusListeners.delete(listener);
      }),
      subscribe,
    };
    const readyHandle = {
      info: { bootId: "same-boot", port: 4242 },
      client,
    } as unknown as FielddHandle;
    const coordinator = new FielddHandleCoordinator(
      vi.fn(async () => readyHandle) as unknown as FielddSupervisor["ensure"],
    );
    const preferences: unknown[] = [];
    const health: unknown[] = [];
    const observePlugins = vi.fn(async () => vi.fn());
    const onError = vi.fn();
    const observers = new RecoveringFielddObservers(coordinator, {
      onStatus: vi.fn(),
      observePlugins,
      onPreferences: (value) => preferences.push(value),
      onHealth: (value) => health.push(value),
      onError,
    });

    await coordinator.ensure();
    await vi.waitFor(() => expect(onError).toHaveBeenCalledWith("preferences", expect.any(Error)));
    expect(preferences).toEqual([]);
    expect(health).toEqual(["health-ready"]);

    status = "reconnecting";
    for (const listener of [...statusListeners]) listener();
    status = "ready";
    for (const listener of [...statusListeners]) listener();

    await vi.waitFor(() => expect(preferences).toEqual(["prefs-recovered"]));
    expect(observePlugins).toHaveBeenCalledTimes(1);
    expect(
      subscribe.mock.calls.filter(([method]) => method === "storage.appPreferences.subscribe"),
    ).toHaveLength(2);
    expect(
      subscribe.mock.calls.filter(([method]) => method === "system.health.subscribe"),
    ).toHaveLength(1);

    observers.dispose();
    expect(unsubscribePreferences).toHaveBeenCalledTimes(1);
    expect(unsubscribeHealth).toHaveBeenCalledTimes(1);
  });
});
