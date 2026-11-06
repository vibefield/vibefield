import type { FielddHandle, FielddLiveness, FielddSupervisor } from "@vibefield/fieldd-supervisor";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  FielddCrashLoopError,
  FielddDaemonBootFence,
  FielddHandleCoordinator,
  type FielddRecoveryState,
} from "../src/main/fieldd-handle-coordinator";
import { RecoveringFielddObservers } from "../src/main/recovering-fieldd-observers";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

/** Item 212 (RV #67) — the liveness of a handle whose watch says nothing: every fake handle carries it, as every real
 * handle does (the coordinator listens to the liveness of each handle it adopts). */
const STEADY = {
  liveness: { kind: "responsive" },
  onLiveness: () => () => undefined,
} as const;

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
    ...STEADY,
  } as unknown as FielddHandle;
}

describe("fieldd main-process recovery", () => {
  it("treats only a changed daemon boot id as an authority transition", () => {
    const fence = new FielddDaemonBootFence();
    const first = handle("boot-1", []);
    const sameBootNewHandle = handle("boot-1", []);
    const restarted = handle("boot-2", []);

    expect(fence.observe(first)).toBeNull();
    expect(fence.observe(sameBootNewHandle)).toBeNull();
    expect(fence.observe(restarted)).toEqual({
      previousBootId: "boot-1",
      nextBootId: "boot-2",
    });
    expect(fence.observe(restarted)).toBeNull();
  });

  it("publishes a handle after an initial ensure failure and a later renderer retry", async () => {
    const readyHandle = handle("boot-2", []);
    const upstream = vi
      .fn()
      .mockRejectedValueOnce(new Error("first boot failed"))
      .mockResolvedValueOnce(readyHandle) as unknown as FielddSupervisor["ensure"];
    const failures: unknown[] = [];
    const coordinator = new FielddHandleCoordinator({
      upstreamEnsure: upstream,
      onEnsureError: (error) => failures.push(error),
    });
    const observed: FielddHandle[] = [];
    coordinator.onHandle((value) => observed.push(value));

    await expect(coordinator.ensure()).rejects.toThrow("first boot failed");
    expect(observed).toEqual([]);
    await expect(coordinator.ensure()).resolves.toBe(readyHandle);
    expect(observed).toEqual([readyHandle]);
    expect(failures).toHaveLength(1);
  });

  it("automatically replaces a handle that becomes terminal", async () => {
    const statusListeners = new Set<() => void>();
    const oldHandle = handle("boot-1", []);
    const oldClient = oldHandle.client as unknown as { status: string };
    oldHandle.client.onStatusChange = (listener) => {
      statusListeners.add(listener);
      return () => statusListeners.delete(listener);
    };
    const newHandle = handle("boot-2", []);
    const upstream = vi
      .fn()
      .mockResolvedValueOnce(oldHandle)
      .mockResolvedValueOnce(newHandle) as unknown as FielddSupervisor["ensure"];
    const coordinator = new FielddHandleCoordinator({ upstreamEnsure: upstream });
    const observed: FielddHandle[] = [];
    coordinator.onHandle((value) => observed.push(value));

    await coordinator.ensure();
    oldClient.status = "closed";
    for (const listener of [...statusListeners]) listener();

    await vi.waitFor(() => expect(observed).toEqual([oldHandle, newHandle]));
    expect(upstream).toHaveBeenCalledTimes(2);
  });

  // WP12c (L2b-ii; the PM's ruling 13:40Z: "after the daemon stop, nothing may call ensureFieldd(), which spawns") —
  // the update holds the coordinator BEFORE the stop: when fieldd goes, its closed client must start NOTHING (a pair
  // under a possibly armed install), and every ensure() refuses until the app exits.
  it("held for an update: a closed client recovers nothing and ensure() refuses — the no-spawn probe", async () => {
    const statusListeners = new Set<() => void>();
    const current = handle("boot-1", []);
    const client = current.client as unknown as { status: string };
    current.client.onStatusChange = (listener) => {
      statusListeners.add(listener);
      return () => statusListeners.delete(listener);
    };
    const upstream = vi.fn().mockResolvedValue(current) as unknown as FielddSupervisor["ensure"];
    const coordinator = new FielddHandleCoordinator({ upstreamEnsure: upstream });
    await coordinator.ensure();
    expect(upstream).toHaveBeenCalledTimes(1);

    expect(coordinator.holdForStop()).toBe(current); // the stop request rides the CURRENT handle
    client.status = "closed"; // fieldd stopped for the update
    for (const listener of [...statusListeners]) listener();
    await new Promise((resolve) => setTimeout(resolve, 20));
    await expect(coordinator.ensure()).rejects.toThrow(/held for a stop/);
    expect(upstream).toHaveBeenCalledTimes(1); // no spawn was attempted
  });

  it("an update that aborted BEFORE the stop releases the hold, and recovery works again", async () => {
    const current = handle("boot-1", []);
    const upstream = vi.fn().mockResolvedValue(current) as unknown as FielddSupervisor["ensure"];
    const coordinator = new FielddHandleCoordinator({ upstreamEnsure: upstream });
    await coordinator.ensure();
    coordinator.holdForStop();
    expect(coordinator.isHeld).toBe(true);
    coordinator.releaseHold();
    await expect(coordinator.ensure()).resolves.toBe(current);
    expect(upstream).toHaveBeenCalledTimes(2);
  });

  it("re-probes an adopted handle whose reconnect loop outlives the grace period", async () => {
    vi.useFakeTimers();
    try {
      let status = "ready";
      const statusListeners = new Set<() => void>();
      const close = vi.fn(() => {
        status = "closed";
        for (const listener of [...statusListeners]) listener();
      });
      const oldHandle = {
        info: { bootId: "boot-1", port: 4242 },
        client: {
          get status() {
            return status;
          },
          close,
          onStatusChange(listener: () => void) {
            statusListeners.add(listener);
            return () => statusListeners.delete(listener);
          },
        },
        ...STEADY,
      } as unknown as FielddHandle;
      const newHandle = handle("boot-2", []);
      const upstream = vi
        .fn()
        .mockResolvedValueOnce(oldHandle)
        .mockResolvedValueOnce(newHandle) as unknown as FielddSupervisor["ensure"];
      const coordinator = new FielddHandleCoordinator({
        upstreamEnsure: upstream,
        reprobeAfterMs: 25,
      });
      const observed: FielddHandle[] = [];
      coordinator.onHandle((value) => observed.push(value));

      await coordinator.ensure();
      status = "reconnecting";
      for (const listener of [...statusListeners]) listener();
      await vi.advanceTimersByTimeAsync(24);
      expect(close).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(1);
      await vi.waitFor(() => expect(observed).toEqual([oldHandle, newHandle]));
      expect(close).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("isolates observer failures from a healthy ensure and from sibling observers", async () => {
    const readyHandle = handle("boot-1", []);
    const upstream = vi.fn(async () => readyHandle) as unknown as FielddSupervisor["ensure"];
    const ensureFailures = vi.fn();
    const listenerFailures = vi.fn();
    const coordinator = new FielddHandleCoordinator({
      upstreamEnsure: upstream,
      onEnsureError: ensureFailures,
      onListenerError: listenerFailures,
    });
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
    const coordinator = new FielddHandleCoordinator({ upstreamEnsure: upstream });
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
      ...STEADY,
    } as unknown as FielddHandle;
    const coordinator = new FielddHandleCoordinator({
      upstreamEnsure: vi.fn(async () => readyHandle) as unknown as FielddSupervisor["ensure"],
    });
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

/** A handle whose client the test ends: `die()` closes it, as an owned child's exit or an adopted client's terminal
 * failure does. `tell()` is its liveness watch speaking (item 212, RV #67). */
function mortal(name: string) {
  let status = "ready";
  let liveness: FielddLiveness = { kind: "responsive" };
  const listeners = new Set<() => void>();
  const watchers = new Set<(next: FielddLiveness) => void>();
  const handle = {
    info: { bootId: name, port: 4242 },
    client: {
      get status() {
        return status;
      },
      onStatusChange(listener: () => void) {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
    },
    get liveness() {
      return liveness;
    },
    onLiveness(watcher: (next: FielddLiveness) => void) {
      watchers.add(watcher);
      return () => watchers.delete(watcher);
    },
  } as unknown as FielddHandle;
  return {
    handle,
    die(): void {
      status = "closed";
      for (const listener of [...listeners]) listener();
    },
    tell(next: FielddLiveness): void {
      liveness = next;
      for (const watcher of [...watchers]) watcher(next);
    },
    watching: () => watchers.size,
  };
}

/** `count` handles the upstream hands out in turn, one per spawn — and, as the supervisor does, the live one while it
 * lives. */
function lifetimes(count: number) {
  const lives = Array.from({ length: count }, (_, index) => mortal(`boot-${index + 1}`));
  let next = 0;
  const calls = vi.fn(async () => {
    const live = lives[next - 1];
    if (live !== undefined && live.handle.client.status === "ready") return live.handle;
    return lives[next++]!.handle;
  });
  return {
    lives,
    calls,
    upstream: calls as unknown as FielddSupervisor["ensure"],
    spawned: () => next,
  };
}

// Item 212 (RV #29) — recovery is a bounded loop under the house intensity: every AUTOMATIC attempt (the one at a
// death, and each after a failed one, spaced by the reprobe grace) is counted in a sliding window; past `max` main
// stops and says crash-loop, an incidental caller is refused typed, and only a person's ask starts fieldd again.
// Deterministic: fake timers drive the spacing, an injected clock the window.
describe("fieldd recovery under the house intensity (item 212, RV #29)", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("retries a respawn that failed after a death once the spacing has passed", async () => {
    const first = mortal("boot-1");
    const second = mortal("boot-2");
    const upstream = vi
      .fn()
      .mockResolvedValueOnce(first.handle)
      .mockRejectedValueOnce(new Error("spawn failed"))
      .mockResolvedValueOnce(second.handle) as unknown as FielddSupervisor["ensure"];
    const states: FielddRecoveryState[] = [];
    const coordinator = new FielddHandleCoordinator({
      upstreamEnsure: upstream,
      reprobeAfterMs: 25,
      onState: (state) => states.push(state),
    });
    const observed: FielddHandle[] = [];
    coordinator.onHandle((value) => observed.push(value));

    await coordinator.ensure();
    first.die();
    await vi.advanceTimersByTimeAsync(0);
    expect(upstream).toHaveBeenCalledTimes(2);
    expect(states).toEqual([{ kind: "recovering", attempt: 1, of: 3 }]);
    await vi.advanceTimersByTimeAsync(24);
    expect(upstream).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(1);
    expect(upstream).toHaveBeenCalledTimes(3);
    expect(observed).toEqual([first.handle, second.handle]);
    expect(states).toEqual([{ kind: "recovering", attempt: 1, of: 3 }, { kind: "ready" }]);
    expect(coordinator.recovery).toEqual({ kind: "ready" });
  });

  it("trips when every respawn fails: recovering twice, then crash-loop, and nothing more starts", async () => {
    const first = mortal("boot-1");
    const upstream = vi
      .fn()
      .mockResolvedValueOnce(first.handle)
      .mockRejectedValue(new Error("spawn failed")) as unknown as FielddSupervisor["ensure"];
    const states: FielddRecoveryState[] = [];
    const coordinator = new FielddHandleCoordinator({
      upstreamEnsure: upstream,
      reprobeAfterMs: 25,
      onState: (state) => states.push(state),
      now: () => 1_000,
    });

    await coordinator.ensure();
    first.die();
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(25);
    await vi.advanceTimersByTimeAsync(25);
    expect(upstream).toHaveBeenCalledTimes(4);
    expect(states).toEqual([
      { kind: "recovering", attempt: 1, of: 3 },
      { kind: "recovering", attempt: 2, of: 3 },
      { kind: "crash-loop", failures: 3, since: 1_000 },
    ]);
    await vi.advanceTimersByTimeAsync(600_000);
    expect(upstream).toHaveBeenCalledTimes(4);
  });

  it("trips a fieldd that keeps dying after it came up — every 61 s is still a crash loop — and refuses an incidental ensure typed", async () => {
    const { lives, calls, upstream } = lifetimes(5);
    const states: FielddRecoveryState[] = [];
    let now = 5_000;
    const coordinator = new FielddHandleCoordinator({
      upstreamEnsure: upstream,
      onState: (state) => states.push(state),
      now: () => now,
    });

    await coordinator.ensure();
    for (const life of lives.slice(0, 4)) {
      life.die();
      await vi.advanceTimersByTimeAsync(0);
      now += 61_000;
    }
    // the boot, then exactly max automatic attempts; the fourth death trips and starts nothing
    expect(calls).toHaveBeenCalledTimes(4);
    expect(states).toEqual([{ kind: "crash-loop", failures: 3, since: 5_000 + 3 * 61_000 }]);
    await expect(coordinator.ensure()).rejects.toBeInstanceOf(FielddCrashLoopError);
    expect(calls).toHaveBeenCalledTimes(4);
  });

  it("a person's ask runs one attempt at once and begins the count again (WG-D5's shape)", async () => {
    const { lives, calls, upstream } = lifetimes(8);
    const states: FielddRecoveryState[] = [];
    const coordinator = new FielddHandleCoordinator({
      upstreamEnsure: upstream,
      onState: (state) => states.push(state),
      now: () => 0,
    });

    await coordinator.ensure();
    for (const life of lives.slice(0, 4)) {
      life.die();
      await vi.advanceTimersByTimeAsync(0);
    }
    expect(coordinator.recovery.kind).toBe("crash-loop");
    expect(calls).toHaveBeenCalledTimes(4);

    await expect(coordinator.ensure({ person: true })).resolves.toBe(lives[4]!.handle);
    expect(calls).toHaveBeenCalledTimes(5);
    expect(coordinator.recovery).toEqual({ kind: "ready" });
    // a fresh count: three more deaths each get their automatic attempt, and the fourth trips again
    for (const life of lives.slice(4, 8)) {
      life.die();
      await vi.advanceTimersByTimeAsync(0);
    }
    expect(calls).toHaveBeenCalledTimes(8);
    expect(states.map((state) => state.kind)).toEqual([
      "crash-loop",
      "recovering",
      "ready",
      "crash-loop",
    ]);
  });

  it("a window booting while fieldd is up begins nothing again: the boot fence's reloads never reset the count", async () => {
    const { lives, upstream, spawned } = lifetimes(5);
    const states: FielddRecoveryState[] = [];
    const coordinator = new FielddHandleCoordinator({
      upstreamEnsure: upstream,
      onState: (state) => states.push(state),
      now: () => 0,
    });

    await coordinator.ensure({ person: true });
    for (const life of lives.slice(0, 3)) {
      life.die();
      await vi.advanceTimersByTimeAsync(0);
      // each recovery is a new boot, which fences every window; each reloaded window's bootstrap asks as a person
      await expect(coordinator.ensure({ person: true })).resolves.toBe(coordinator.currentHandle);
    }
    lives[3]!.die();
    await vi.advanceTimersByTimeAsync(0);
    // the boot, then three automatic attempts; the fourth death trips as it would with no window open
    expect(spawned()).toBe(4);
    expect(states).toEqual([{ kind: "crash-loop", failures: 3, since: 0 }]);
  });

  it("counts only the attempts inside its window: a fieldd dying more slowly than max per window never trips", async () => {
    const { lives, calls, upstream } = lifetimes(6);
    let now = 0;
    const coordinator = new FielddHandleCoordinator({
      upstreamEnsure: upstream,
      intensity: { max: 2, windowMs: 1_000 },
      now: () => now,
    });

    await coordinator.ensure();
    for (const life of lives.slice(0, 5)) {
      life.die();
      await vi.advanceTimersByTimeAsync(0);
      now += 600;
    }
    expect(calls).toHaveBeenCalledTimes(6);
    expect(coordinator.recovery).toEqual({ kind: "ready" });
  });

  it("while recovering, an incidental ensure joins the scheduled attempt, and starts and counts nothing of its own", async () => {
    const first = mortal("boot-1");
    const second = mortal("boot-2");
    const third = mortal("boot-3");
    const upstream = vi
      .fn()
      .mockResolvedValueOnce(first.handle)
      .mockRejectedValueOnce(new Error("spawn failed"))
      .mockResolvedValueOnce(second.handle)
      .mockResolvedValueOnce(third.handle) as unknown as FielddSupervisor["ensure"];
    const coordinator = new FielddHandleCoordinator({
      upstreamEnsure: upstream,
      reprobeAfterMs: 25,
      now: () => 0,
    });

    await coordinator.ensure();
    first.die();
    await vi.advanceTimersByTimeAsync(0);
    expect(coordinator.recovery).toEqual({ kind: "recovering", attempt: 1, of: 3 });
    const joined = coordinator.ensure();
    await vi.advanceTimersByTimeAsync(0);
    expect(upstream).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(25);
    await expect(joined).resolves.toBe(second.handle);
    expect(upstream).toHaveBeenCalledTimes(3);
    // two automatic attempts so far and the joiner's none: one more death gets the third, and the next trips
    second.die();
    await vi.advanceTimersByTimeAsync(0);
    expect(upstream).toHaveBeenCalledTimes(4);
    third.die();
    await vi.advanceTimersByTimeAsync(0);
    expect(upstream).toHaveBeenCalledTimes(4);
    expect(coordinator.recovery).toEqual({ kind: "crash-loop", failures: 3, since: 0 });
  });

  it("held for a stop during the spacing: the scheduled attempt never runs, and its joiner is told", async () => {
    const first = mortal("boot-1");
    const upstream = vi
      .fn()
      .mockResolvedValueOnce(first.handle)
      .mockRejectedValue(new Error("spawn failed")) as unknown as FielddSupervisor["ensure"];
    const coordinator = new FielddHandleCoordinator({
      upstreamEnsure: upstream,
      reprobeAfterMs: 25,
    });

    await coordinator.ensure();
    first.die();
    await vi.advanceTimersByTimeAsync(0);
    const joined = coordinator.ensure();
    coordinator.holdForStop();
    await expect(joined).rejects.toThrow(/held for a stop/);
    await vi.advanceTimersByTimeAsync(600_000);
    expect(upstream).toHaveBeenCalledTimes(2);
  });

  it("a hold released before any stop lets the recovery it paused go on, where it stood", async () => {
    const first = mortal("boot-1");
    const second = mortal("boot-2");
    const upstream = vi
      .fn()
      .mockResolvedValueOnce(first.handle)
      .mockRejectedValueOnce(new Error("spawn failed"))
      .mockResolvedValueOnce(second.handle) as unknown as FielddSupervisor["ensure"];
    const coordinator = new FielddHandleCoordinator({
      upstreamEnsure: upstream,
      reprobeAfterMs: 25,
      now: () => 0,
    });

    await coordinator.ensure();
    first.die();
    await vi.advanceTimersByTimeAsync(0);
    coordinator.holdForStop();
    await vi.advanceTimersByTimeAsync(25);
    expect(upstream).toHaveBeenCalledTimes(2);
    // the quit (or the update) aborted before it stopped anything
    coordinator.releaseHold();
    expect(coordinator.recovery).toEqual({ kind: "recovering", attempt: 1, of: 3 });
    await vi.advanceTimersByTimeAsync(25);
    expect(upstream).toHaveBeenCalledTimes(3);
    expect(coordinator.currentHandle).toBe(second.handle);
    expect(coordinator.recovery).toEqual({ kind: "ready" });
  });
});

// Item 212 (RV #67) — the coordinator forwards its current handle's liveness into the same `onState` the recovery
// speaks through (fieldd-link.ts projects it): `unresponsive` while a live handle's replies are silent, `ready` at its
// next reply. A silence is said only while the handle lives, so a crash loop or a recovery always outranks it. While
// held for a stop it is not heard (a stopping fieldd goes quiet), and it is read again when the hold is released.
describe("the field service's silence, forwarded (item 212, RV #67)", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("says unresponsive while the handle's replies are silent, once, and ready again at its next reply", async () => {
    const life = mortal("boot-1");
    const states: FielddRecoveryState[] = [];
    const coordinator = new FielddHandleCoordinator({
      upstreamEnsure: vi.fn(async () => life.handle) as unknown as FielddSupervisor["ensure"],
      onState: (state) => states.push(state),
    });

    await coordinator.ensure();
    life.tell({ kind: "unresponsive", silentMs: 10_000 });
    expect(coordinator.recovery).toEqual({ kind: "unresponsive" });
    life.tell({ kind: "wedged", silentMs: 60_000 }); // the same word for the person
    life.tell({ kind: "responsive" });
    expect(states).toEqual([{ kind: "unresponsive" }, { kind: "ready" }]);
    expect(coordinator.recovery).toEqual({ kind: "ready" });
  });

  it("hears nothing while held for a stop, and reads the handle again when the hold is released", async () => {
    const life = mortal("boot-1");
    const states: FielddRecoveryState[] = [];
    const coordinator = new FielddHandleCoordinator({
      upstreamEnsure: vi.fn(async () => life.handle) as unknown as FielddSupervisor["ensure"],
      onState: (state) => states.push(state),
    });

    await coordinator.ensure();
    coordinator.holdForStop();
    life.tell({ kind: "unresponsive", silentMs: 10_000 });
    expect(states).toEqual([]);
    // the quit (or the update) aborted before it stopped anything: the silence it did not hear is said now
    coordinator.releaseHold();
    expect(states).toEqual([{ kind: "unresponsive" }]);
  });

  it("after the wedge kill ends the child, the silence goes and the recovery starts a respawn", async () => {
    const { lives, calls, upstream } = lifetimes(2);
    const states: FielddRecoveryState[] = [];
    const coordinator = new FielddHandleCoordinator({
      upstreamEnsure: upstream,
      onState: (state) => states.push(state),
      now: () => 0,
    });

    await coordinator.ensure();
    lives[0]!.tell({ kind: "unresponsive", silentMs: 10_000 });
    lives[0]!.tell({ kind: "wedged", silentMs: 60_000 });
    // the supervisor ends an owned child at the bound; its exit closes the handle's client
    lives[0]!.die();
    await vi.advanceTimersByTimeAsync(0);
    expect(calls).toHaveBeenCalledTimes(2);
    expect(coordinator.currentHandle).toBe(lives[1]!.handle);
    expect(states).toEqual([{ kind: "unresponsive" }, { kind: "ready" }]);
    // the dead handle is no longer heard, and the live one is
    expect(lives[0]!.watching()).toBe(0);
    expect(lives[1]!.watching()).toBe(1);
  });

  it("a person's ask while it is silent is no recovery: nothing begins again and the silence is still said", async () => {
    const life = mortal("boot-1");
    const states: FielddRecoveryState[] = [];
    const upstream = vi.fn(async () => life.handle);
    const coordinator = new FielddHandleCoordinator({
      upstreamEnsure: upstream as unknown as FielddSupervisor["ensure"],
      onState: (state) => states.push(state),
    });

    await coordinator.ensure();
    life.tell({ kind: "unresponsive", silentMs: 10_000 });
    // a window reloading asks as a person: fieldd is up, so it gets the live handle and nothing is reset
    await expect(coordinator.ensure({ person: true })).resolves.toBe(life.handle);
    expect(upstream).toHaveBeenCalledTimes(2);
    expect(states).toEqual([{ kind: "unresponsive" }]);
    expect(coordinator.recovery).toEqual({ kind: "unresponsive" });
  });
});
