import type { FielddClient } from "@vibefield/fieldd-client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { BootMachineDeps, BootPhase, WorkspaceModule } from "../src/boot/machine";
import { createBootMachine } from "../src/boot/machine";
import type { FieldHost } from "../src/host";

// The §12.5 regression suite for the central boot decisions (ESR §5.4.2 + §12.4–12.5;
// design-03 §4.3 v0.3). The machine is framework-free and every seam is injected, so
// these drive it with no DOM: a fake FieldHost, a fake workspace module whose DocManager
// is a hand-driven store, a scripted `now`/`raf` pair (the frame-stability streak is exact),
// a recorded `mark`, and fake timers so the stability cap fires on command. The reveal law
// under test: `interactive` only after the document warms (DocManager phase "ready") AND the
// frame gate passes — or its bounded cap forces a logged degraded reveal.

type FakeState = {
  phase: "loading" | "ready";
  loading: { stage: string; progress: number } | null;
};

/** The workspace module's DocManager, hand-driven: the machine constructs it via
 * `new mod.DocManager(client)`, so each instance registers itself for the test to reach. */
class FakeManager {
  static instances: FakeManager[] = [];
  state: FakeState = { phase: "loading", loading: { stage: "opening doc", progress: 0 } };
  private readonly listeners = new Set<() => void>();
  constructor(readonly client: unknown) {
    FakeManager.instances.push(this);
  }
  getState = (): FakeState => this.state;
  subscribe = (fn: () => void): (() => void) => {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  };
  /** Test control: advance the warm pipeline and notify the machine's warming subscriber. */
  emit(next: FakeState): void {
    this.state = next;
    for (const fn of [...this.listeners]) fn();
  }
}

const workspaceModule = {
  DocManager: FakeManager,
  FieldView: () => null,
  FielddProvider: ({ children }: { children?: unknown }) => children,
} as unknown as WorkspaceModule;

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

/** Flush the microtask queue. The boot path is pure microtasks up to `await stabilize()`
 * (the only real timer is the cap), so this deterministically advances run() as far as its
 * pending awaits allow — it can never overrun a genuinely-pending promise. */
async function flush(): Promise<void> {
  for (let i = 0; i < 25; i++) await Promise.resolve();
}

function harness(
  opts: { stableFrames?: number; frameBudgetMs?: number; stabilityCapMs?: number } = {},
) {
  const marks: string[] = [];
  const rafCbs: Array<() => void> = [];
  let clock = 0;

  const getConnection = vi.fn();
  const importWorkspace = vi.fn();
  const clientStub = { close: () => {} } as unknown as FielddClient;
  const makeClient = vi.fn(() => clientStub);
  const host = {
    getConnection,
    onPrepareClose: () => () => {},
    completeClose: () => {},
  } as unknown as FieldHost;

  const deps: BootMachineDeps = {
    host,
    importWorkspace: importWorkspace as unknown as () => Promise<WorkspaceModule>,
    makeClient,
    raf: (cb) => {
      rafCbs.push(cb);
    },
    now: () => clock,
    mark: (name) => {
      marks.push(name);
    },
    frameBudgetMs: opts.frameBudgetMs ?? 16,
    stableFrames: opts.stableFrames ?? 3,
    stabilityCapMs: opts.stabilityCapMs ?? 100_000,
  };

  const machine = createBootMachine(deps);
  return {
    machine,
    marks,
    getConnection,
    importWorkspace,
    makeClient,
    clientStub,
    /** Set the scripted clock to `at`, then run the next queued rAF tick. */
    fireFrame(at: number) {
      clock = at;
      const cb = rafCbs.shift();
      if (cb === undefined) throw new Error("no raf frame queued");
      cb();
    },
  };
}

type Harness = ReturnType<typeof harness>;

/** The DocManager the machine constructed — throws (and narrows away `undefined`) if the
 * boot never reached opening-document. */
function firstManager(): FakeManager {
  const mgr = FakeManager.instances[0];
  if (mgr === undefined) throw new Error("DocManager was never constructed");
  return mgr;
}

/** start() → bootstrap resolves → workspace resolves → warm to "ready" → parked at
 * `await stabilize()` (view "stabilizing", one rAF tick queued, clock at 0 = `last`). */
async function bootToStabilizing(h: Harness): Promise<FakeManager> {
  h.getConnection.mockResolvedValue({ port: 4242, token: "abc" });
  h.importWorkspace.mockResolvedValue(workspaceModule);
  h.machine.start();
  await flush();
  const mgr = firstManager();
  mgr.emit({ phase: "ready", loading: null });
  await flush();
  return mgr;
}

/** Fire `need` frames whose deltas stay under budget — the clean streak that reveals. */
async function feedCleanFrames(h: Harness, need = 3, budget = 16): Promise<void> {
  const step = Math.floor(budget / 2);
  for (let i = 1; i <= need; i++) h.fireFrame(i * step);
  await flush();
}

beforeEach(() => {
  vi.useFakeTimers();
  FakeManager.instances = [];
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("boot machine (ESR slice 4 — splash-gated boot)", () => {
  it("paints a splash face with an honest stage before bootstrap resolves (delayed fieldd)", async () => {
    const h = harness();
    const conn = deferred<{ port: number; token: string }>();
    const ws = deferred<WorkspaceModule>();
    h.getConnection.mockReturnValue(conn.promise);
    h.importWorkspace.mockReturnValue(ws.promise);

    h.machine.start();
    // The workspace import fired concurrently, BEFORE the connection could resolve.
    expect(h.importWorkspace).toHaveBeenCalledTimes(1);
    const view = h.machine.view();
    expect(view.phase).toBe("requesting-bootstrap");
    expect(view.stage).toBe("waking the daemon");
    expect(view.unavailable).toBeNull();

    // Resolve later → the machine proceeds; the concurrent import is not repeated.
    conn.resolve({ port: 4242, token: "abc" });
    await flush();
    ws.resolve(workspaceModule);
    await flush();
    expect(h.machine.ready).not.toBeNull();
    expect(h.importWorkspace).toHaveBeenCalledTimes(1);
  });

  it("full happy path: bootstrap → client → workspace → document → warm → stabilize → interactive", async () => {
    const h = harness();
    const conn = deferred<{ port: number; token: string }>();
    const ws = deferred<WorkspaceModule>();
    h.getConnection.mockReturnValue(conn.promise);
    h.importWorkspace.mockReturnValue(ws.promise);

    const phases: BootPhase[] = [];
    h.machine.subscribe(() => {
      const p = h.machine.view().phase;
      if (phases[phases.length - 1] !== p) phases.push(p);
    });

    h.machine.start();
    await flush();
    conn.resolve({ port: 4242, token: "abc" });
    await flush();
    ws.resolve(workspaceModule);
    await flush();

    // opening-document: ready is set, DocManager constructed with the made client.
    const mgr = firstManager();
    expect(mgr.client).toBe(h.clientStub);
    expect(h.machine.client).toBe(h.clientStub);
    expect(h.machine.ready?.manager).toBe(mgr);
    expect(h.machine.ready?.mod).toBe(workspaceModule);

    // warming: the DocManager's honest stage/progress pass through the view verbatim.
    mgr.emit({ phase: "loading", loading: { stage: "fetching board", progress: 0.25 } });
    expect(h.machine.view()).toMatchObject({
      phase: "warming",
      stage: "fetching board",
      progress: 0.25,
    });
    mgr.emit({ phase: "loading", loading: { stage: "preparing previews", progress: 0.6 } });
    expect(h.machine.view()).toMatchObject({
      phase: "warming",
      stage: "preparing previews",
      progress: 0.6,
    });

    // phase "ready" → stabilizing gate.
    mgr.emit({ phase: "ready", loading: null });
    await flush();
    expect(h.machine.view()).toMatchObject({
      phase: "stabilizing",
      stage: "settling",
      progress: 1,
    });

    // N clean frames → interactive, un-degraded.
    await feedCleanFrames(h);
    expect(h.machine.view().phase).toBe("interactive");
    expect(h.machine.view().degradedReveal).toBe(false);
    expect(h.machine.view().stage).toBe("");

    expect(phases).toEqual([
      "requesting-bootstrap",
      "connecting-fieldd",
      "opening-document",
      "warming",
      "stabilizing",
      "interactive",
    ]);
  });

  it("emits the boot performance marks in order (bootstrap before the later workspace resolve)", async () => {
    const h = harness();
    const conn = deferred<{ port: number; token: string }>();
    const ws = deferred<WorkspaceModule>();
    h.getConnection.mockReturnValue(conn.promise);
    h.importWorkspace.mockReturnValue(ws.promise);

    h.machine.start();
    await flush();
    conn.resolve({ port: 4242, token: "abc" }); // fieldd-ready before...
    await flush();
    ws.resolve(workspaceModule); // ...workspace-import-end (scripted: connection first)
    await flush();
    firstManager().emit({ phase: "ready", loading: null });
    await flush();
    await feedCleanFrames(h);

    expect(h.machine.view().phase).toBe("interactive");
    expect(h.marks).toEqual([
      "vf:renderer:workspace-import-start",
      "vf:renderer:fieldd-ready",
      "vf:renderer:workspace-import-end",
      "vf:renderer:document-ready",
      "vf:renderer:warm-end",
      "vf:renderer:stable",
      "vf:renderer:interactive",
    ]);
  });

  it("resets the stability streak on a long frame, then reveals after N consecutive clean frames", async () => {
    const h = harness({ stableFrames: 3, frameBudgetMs: 16 });
    await bootToStabilizing(h);
    expect(h.machine.view().phase).toBe("stabilizing");

    h.fireFrame(10); // clean (Δ10 ≤ 16) → streak 1
    expect(h.machine.view().phase).toBe("stabilizing");
    h.fireFrame(100); // hitch (Δ90 > 16) → streak resets to 0
    expect(h.machine.view().phase).toBe("stabilizing"); // no reveal mid-hitch

    h.fireFrame(110); // streak 1
    h.fireFrame(120); // streak 2
    h.fireFrame(130); // streak 3 → reveal
    await flush();
    expect(h.machine.view().phase).toBe("interactive");
    expect(h.machine.view().degradedReveal).toBe(false);
  });

  it("forces a logged degraded reveal when the stability cap expires without enough clean frames", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const h = harness({ stableFrames: 10, frameBudgetMs: 16, stabilityCapMs: 50 });
    await bootToStabilizing(h);

    h.fireFrame(5); // one clean frame — never reaches the 10-frame streak
    expect(h.machine.view().phase).toBe("stabilizing");

    await vi.advanceTimersByTimeAsync(50); // the cap fires
    await flush();
    expect(h.machine.view().phase).toBe("interactive");
    expect(h.machine.view().degradedReveal).toBe(true);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("stability cap hit"));
  });

  it("surfaces an unavailable+retryable state when bootstrap fails, and retry resumes from the failed step", async () => {
    const h = harness();
    h.getConnection
      .mockRejectedValueOnce(new Error("daemon unreachable"))
      .mockResolvedValue({ port: 4242, token: "abc" });
    const ws = deferred<WorkspaceModule>();
    h.importWorkspace.mockReturnValue(ws.promise);

    h.machine.start();
    await flush();
    const failed = h.machine.view().unavailable;
    expect(failed).not.toBeNull();
    expect(failed?.phase).toBe("requesting-bootstrap");
    expect(failed?.reason).toContain("daemon unreachable");
    expect(failed?.retryable).toBe(true);

    // retry() re-enters run() — completed checkpoints skip, so the workspace import (which
    // already fired on the first attempt) is NOT repeated; only the failed connection retries.
    h.machine.retry();
    ws.resolve(workspaceModule);
    await flush();
    const mgr = firstManager();
    mgr.emit({ phase: "ready", loading: null });
    await flush();
    await feedCleanFrames(h);

    expect(h.machine.view().phase).toBe("interactive");
    expect(h.machine.view().unavailable).toBeNull();
    expect(h.importWorkspace).toHaveBeenCalledTimes(1);
    expect(h.getConnection).toHaveBeenCalledTimes(2);
  });

  it("retries a failed workspace import from scratch — the failed fetch does not poison retry", async () => {
    // The design gap this slot originally anticipated (a cached rejected workspacePromise
    // making a failed import permanently un-retryable) is CLOSED in the current machine:
    // the `mod = await workspacePromise` catch resets `workspacePromise = null` ("a failed
    // fetch must not poison retry"). This pins that actual behavior — retry re-imports and
    // proceeds — while the connection checkpoint (which already succeeded) stays resumed.
    const h = harness();
    h.getConnection.mockResolvedValue({ port: 4242, token: "abc" });
    h.importWorkspace
      .mockRejectedValueOnce(new Error("workspace chunk failed"))
      .mockResolvedValue(workspaceModule);

    h.machine.start();
    await flush();
    const first = h.machine.view().unavailable;
    expect(first).not.toBeNull();
    expect(first?.reason).toContain("workspace chunk failed");
    expect(first?.phase).toBe("connecting-fieldd"); // failed at the workspace await, client made

    h.machine.retry();
    await flush();
    const mgr = firstManager(); // the retry re-imported and constructed the DocManager
    mgr.emit({ phase: "ready", loading: null });
    await flush();
    await feedCleanFrames(h);

    expect(h.machine.view().phase).toBe("interactive");
    expect(h.machine.view().unavailable).toBeNull();
    expect(h.importWorkspace).toHaveBeenCalledTimes(2); // re-imported — the reset let retry re-fetch
    expect(h.getConnection).toHaveBeenCalledTimes(1); // bootstrap checkpoint stayed resumed
  });

  it("start() is idempotent and retry() is a no-op unless unavailable", async () => {
    const h = harness();
    h.getConnection.mockReturnValue(new Promise<{ port: number; token: string }>(() => {}));
    h.importWorkspace.mockReturnValue(new Promise<WorkspaceModule>(() => {}));

    h.machine.start();
    h.machine.start(); // second call must not re-run
    expect(h.importWorkspace).toHaveBeenCalledTimes(1);
    expect(h.getConnection).toHaveBeenCalledTimes(1);

    // parked in requesting-bootstrap (not unavailable) → retry() does nothing
    h.machine.retry();
    expect(h.getConnection).toHaveBeenCalledTimes(1);
    expect(h.importWorkspace).toHaveBeenCalledTimes(1);

    // retry() on a machine that never started is equally inert
    const fresh = harness();
    fresh.machine.retry();
    expect(fresh.importWorkspace).not.toHaveBeenCalled();
    expect(fresh.machine.view().phase).toBe("requesting-bootstrap");
  });

  it("view() returns a stable reference between notifications (useSyncExternalStore contract)", () => {
    const h = harness();
    h.getConnection.mockReturnValue(new Promise<{ port: number; token: string }>(() => {}));
    h.importWorkspace.mockReturnValue(new Promise<WorkspaceModule>(() => {}));

    const before = h.machine.view();
    expect(h.machine.view()).toBe(before); // no state change → identical snapshot

    h.machine.start(); // patches the view → a fresh snapshot replaces it
    expect(h.machine.view()).not.toBe(before);

    const parked = h.machine.view();
    expect(h.machine.view()).toBe(parked); // stable again while bootstrap is pending
  });
});
