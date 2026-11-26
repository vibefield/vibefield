import { EventEmitter } from "node:events";
import { describe, expect, it, vi } from "vitest";
import {
  PAGES_HUNG_CALLS,
  type PagesBinding,
  PagesBrokerCore,
  PagesBrokerError,
  type PagesWindowsPort,
} from "../src/main/pages/broker/broker";
import type { exchangeDaemon, PagesDaemonExchange } from "../src/main/pages/broker/daemon-client";
import {
  ENGINE_CRASH_LOOP,
  type EngineChild,
  PagesEngineSupervisor,
  type PagesEngineSupervisorDeps,
  type SpawnEngine,
} from "../src/main/pages/broker/engine-supervisor";
import type { PagesSurroundings } from "../src/main/pages/broker/surroundings";
import type { CallWindow } from "../src/main/pages/core/types";

// EY-1 (2026-11-24, an engine's exits and restarts): the supervisor's own count of a run's exits, and the broker on
// the REAL supervisor, so an exit the supervisor sees is one the broker hears. Every child and socket is a fake:
// nothing runs, nothing listens and nothing is signalled.

/** A fake child: it exits when told to by `exit`, or on the signals listed in `diesOn`. */
class FakeChild extends EventEmitter implements EngineChild {
  readonly pid = 4242;
  readonly signals: string[] = [];
  exited = false;
  constructor(private readonly diesOn: readonly string[] = ["SIGTERM", "SIGKILL"]) {
    super();
  }
  kill(signal: "SIGTERM" | "SIGKILL"): boolean {
    this.signals.push(signal);
    if (this.diesOn.includes(signal)) setImmediate(() => this.exit(null, signal));
    return true;
  }
  exit(code: number | null, signal: string | null = null): void {
    if (this.exited) return;
    this.exited = true;
    this.emit("exit", code, signal);
  }
}

let n = 0;
function surroundings(): PagesSurroundings {
  n += 1;
  const root = `/r/pg-${String(n).padStart(8, "0")}`;
  return {
    root,
    socketDir: `${root}/sock`,
    home: `${root}/home`,
    tmp: `${root}/tmp`,
    cwd: `${root}/cwd`,
    session: "0123456789abcdef",
    socketPath: `${root}/sock/namespaces/pages/run/0123456789abcdef.sock`,
  };
}

const ok = (data: unknown): PagesDaemonExchange => ({ ok: true, reply: { success: true, data } });

/** The real supervisor on fake children. `ready` says whether each start's socket answers in time; the engine's own
 * `close` ends the child it reaches unless `closeExits` is false. */
function supervised(
  o: {
    readonly ready?: () => boolean;
    readonly closeExits?: boolean;
    readonly deps?: Partial<PagesEngineSupervisorDeps>;
  } = {},
) {
  const made: FakeChild[] = [];
  const byRoot = new Map<string, FakeChild>();
  const spawn = vi.fn<SpawnEngine>((_file, _args, so) => {
    const child = new FakeChild();
    made.push(child);
    byRoot.set(so.cwd.slice(0, -"/cwd".length), child);
    return child;
  });
  const childAt = (path: string) => [...byRoot].find(([root]) => path.startsWith(`${root}/`))?.[1];
  const closes = vi.fn<typeof exchangeDaemon>(async (path) => {
    const child = childAt(path);
    if (o.closeExits !== false && child !== undefined) setImmediate(() => child.exit(0));
    return { ok: true, reply: { success: true } };
  });
  const supervisor = new PagesEngineSupervisor({
    enginePath: () => "/pinned/agent-browser",
    identity: async (path) => ({ ok: true, kind: "dev-source-build", path, version: "0.41.0" }),
    surroundings,
    spawn,
    exchange: closes,
    ready: vi.fn(async () => o.ready?.() ?? true),
    // the surroundings here are names, not folders: the ready engine's folder is said to show no stream (the
    // supervisor reads the real one otherwise, and refuses an engine whose folder it cannot read)
    stream: () => "off",
    readyMs: 50,
    stopRungMs: 20,
    ...o.deps,
  });
  return { supervisor, spawn, made, closes, childAt };
}

describe("a start that is slow, and an engine main replaces", () => {
  it("ends a start that misses its ready deadline, and does not count it as a crash: the run's engine still starts", async () => {
    let ready = false;
    const { supervisor, made } = supervised({ ready: () => ready });
    for (let i = 0; i < ENGINE_CRASH_LOOP.exits; i += 1) {
      expect(await supervisor.ensure("run-1")).toEqual({
        ok: false,
        unavailable: "engine-starting",
      });
      // main ended it: its exit is seen, and it is not a crash
      expect(made[i]?.exited).toBe(true);
    }
    ready = true;
    expect(await supervisor.ensure("run-1")).toMatchObject({ ok: true });
    expect(made).toHaveLength(ENGINE_CRASH_LOOP.exits + 1);
  });

  it("still counts an engine that exits by itself before it is ready", async () => {
    const { supervisor, made } = supervised({
      ready: () => {
        made.at(-1)?.exit(1);
        return false;
      },
    });
    for (let i = 0; i < ENGINE_CRASH_LOOP.exits; i += 1) {
      expect(await supervisor.ensure("run-1")).toEqual({
        ok: false,
        unavailable: "engine-starting",
      });
    }
    expect(await supervisor.ensure("run-1")).toEqual({ ok: false, unavailable: "engine-stopped" });
    expect(made).toHaveLength(ENGINE_CRASH_LOOP.exits);
  });

  it("replace ends the run's engine by the ladder and keeps the run: its next call starts the next generation", async () => {
    const { supervisor, made, closes } = supervised();
    const first = await supervisor.ensure("run-1");
    await supervisor.replace("run-1");
    expect(closes.mock.calls[0]?.[1]).toMatchObject({ action: "close" });
    expect(made[0]?.exited).toBe(true);
    const second = await supervisor.ensure("run-1");
    expect(first.ok && first.engine.generation).toBe(1);
    expect(second.ok && second.engine.generation).toBe(2);
    // a run with no engine, and one whose engine is gone already, have nothing to replace
    await supervisor.replace("run-9");
    made[1]?.exit(1);
    await supervisor.replace("run-1");
    expect(closes).toHaveBeenCalledTimes(1);
  });

  it("never hands out an engine it is replacing: a call that comes while it ends starts another", async () => {
    // this engine ignores its own close and leaves only on a signal
    const { supervisor, made } = supervised({ closeExits: false });
    await supervisor.ensure("run-1");
    const replacing = supervisor.replace("run-1");
    const next = await supervisor.ensure("run-1");
    expect(next.ok && next.engine.generation).toBe(2);
    expect(made).toHaveLength(2);
    await replacing;
    expect(made[0]?.signals).toEqual(["SIGTERM"]);
    expect(made[1]?.exited).toBe(false);
  });

  it("counts an engine main replaced once, as an exit: one it keeps replacing is stopped as one that keeps exiting is", async () => {
    const { supervisor, made } = supervised();
    for (let i = 0; i < ENGINE_CRASH_LOOP.exits - 1; i += 1) {
      expect((await supervisor.ensure("run-1")).ok).toBe(true);
      await supervisor.replace("run-1");
    }
    // two replaced: each counted once, though each also exited
    expect((await supervisor.ensure("run-1")).ok).toBe(true);
    made.at(-1)?.exit(1);
    expect(await supervisor.ensure("run-1")).toEqual({ ok: false, unavailable: "engine-stopped" });
    expect(made).toHaveLength(ENGINE_CRASH_LOOP.exits);
  });
});

/** The windows a call needs, standing open for whoever asks. */
function openWindows(): PagesWindowsPort {
  const open = new Map<string, CallWindow>();
  return {
    lease: () => undefined,
    unlease: () => null,
    open: (pageId, w) => {
      open.set(pageId, { pageId, ...w, openedAt: 0, stillsTaken: 0 });
      return { ok: true };
    },
    adopt: () => ({ ok: true }),
    close: (pageId) => {
      const w = open.get(pageId) ?? null;
      open.delete(pageId);
      return w === null ? null : { ...w, closedAt: 1, closedBy: "call-end" };
    },
    closeCall: () => [],
    hold: () => ({ closed: null }),
    putDown: () => undefined,
    drain: () => undefined,
    drained: () => undefined,
    history: () => [],
    state: (pageId) => ({
      leased: true,
      held: false,
      window: open.get(pageId) ?? null,
      paused: 0,
      draining: false,
    }),
  };
}

/** The real broker on the real supervisor: a fake child per engine, and a socket that answers as `reply` says. */
function brokered(
  o: {
    readonly closeExits?: boolean;
    /** the broker's idle reap, when a row wants it soon */
    readonly idleReapMs?: number;
    readonly deps?: Partial<PagesEngineSupervisorDeps>;
  } = {},
) {
  const s = supervised(o);
  const page = { held: false, onHeld: () => () => undefined };
  const binding: PagesBinding = { producerEpoch: 1, controlBindingRevision: 1, page };
  const sent: string[] = [];
  const state = {
    live: true,
    reply: (_action: string): PagesDaemonExchange | Promise<PagesDaemonExchange> => ok({}),
  };
  let epoch = 0;
  const broker = new PagesBrokerCore({
    targets: {
      lookup: () => binding,
      parked: () => false,
      describe: () => null,
      pageClass: () => "own",
    },
    bridge: {
      addRun: () => undefined,
      arm: () => {
        epoch += 1;
        return { url: `ws://127.0.0.1:9/browser/route/key-${epoch}`, epoch };
      },
      raced: () => false,
      revokeRun: async () => undefined,
      grant: async () => ({ ok: true, targetId: "A".repeat(32) }),
      endGrant: async () => undefined,
      introduce: () => 0,
      refusals: () => [],
    },
    link: { liveAt: () => state.live },
    windows: openWindows(),
    engines: s.supervisor,
    ...(o.idleReapMs === undefined ? {} : { idleReapMs: o.idleReapMs }),
    // the broker's own commands; the supervisor's close goes by its own socket fake
    exchange: async (_path, command) => {
      sent.push(command.action);
      if (command.action === "launch") return ok({ launched: true });
      if (command.action === "tab_list") {
        return ok({ tabs: [{ tabId: "t1", targetId: "A".repeat(32), active: true }] });
      }
      return state.reply(command.action);
    },
  });
  const call = (action = "snapshot", window: "read" | "act" = "read") =>
    broker.control(
      { run: "run-1", surfaceId: "surface_0123456789abcdef", window, command: { action } },
      { signal: new AbortController().signal, deadlineAt: Date.now() + 5_000 },
    );
  const failed = async (p: Promise<unknown>) => {
    const error = await p.then(
      () => null,
      (e: unknown) => e,
    );
    if (!(error instanceof PagesBrokerError)) throw new Error("the call was to fail");
    return { kind: error.kind, state: error.state };
  };
  return { ...s, broker, sent, state, call, failed };
}

describe("the broker on the real supervisor", () => {
  it("hears an engine's exit from the supervisor: the call in flight fails at once, and the next call starts and launches another", async () => {
    const h = brokered();
    await h.call();
    let answer: (value: PagesDaemonExchange) => void = () => undefined;
    h.state.reply = () =>
      new Promise<PagesDaemonExchange>((resolve) => {
        answer = resolve;
      });
    const pending = h.failed(h.call("title"));
    await vi.waitFor(() => expect(h.sent.at(-1)).toBe("title"));
    h.made[0]?.exit(1);
    expect(await pending).toEqual({ kind: "UNAVAILABLE", state: "engine-starting" });
    answer({ ok: false, failure: "outcome-unknown" });
    h.state.reply = () => ok({ snapshot: "ok" });
    expect(await h.call()).toMatchObject({ status: "done" });
    expect(h.made).toHaveLength(2);
    expect(h.sent.filter((action) => action === "launch")).toHaveLength(2);
    await h.broker.stop("quit");
  });

  it("an act in flight when its engine exits is no-answer, never a word that asks for the act again", async () => {
    const h = brokered();
    await h.call();
    let answer: (value: PagesDaemonExchange) => void = () => undefined;
    h.state.reply = () =>
      new Promise<PagesDaemonExchange>((resolve) => {
        answer = resolve;
      });
    const pending = h.failed(h.call("reload", "act"));
    await vi.waitFor(() => expect(h.sent.at(-1)).toBe("reload"));
    // the engine had the command and exits before its answer: the supervisor's word comes first here
    h.made[0]?.exit(1);
    expect(await pending).toEqual({ kind: "UNAVAILABLE", state: "no-answer" });
    answer({ ok: false, failure: "outcome-unknown" });
    await h.broker.stop("quit");
  });

  it("an act in flight when its engine dies is no-answer whichever is seen first, its socket's close or its exit", async () => {
    const h = brokered();
    await h.call();
    let answer: (value: PagesDaemonExchange) => void = () => undefined;
    h.state.reply = () =>
      new Promise<PagesDaemonExchange>((resolve) => {
        answer = resolve;
      });
    const pending = h.failed(h.call("reload", "act"));
    await vi.waitFor(() => expect(h.sent.at(-1)).toBe("reload"));
    // the socket's close is seen first: the line went out and no whole reply came back
    answer({ ok: false, failure: "outcome-unknown" });
    expect(await pending).toEqual({ kind: "UNAVAILABLE", state: "no-answer" });
    h.made[0]?.exit(1);
    // the exit after it starts the next engine as any exit does
    h.state.reply = () => ok({});
    expect(await h.call()).toMatchObject({ status: "done" });
    expect(h.made).toHaveLength(2);
    await h.broker.stop("quit");
  });

  it("an engine main stopped and forgot does not fail its successor's call when its exit comes late, though both are generation one", async () => {
    // this engine ignores its own close, and the ladder's signal is far off: it leaves when the row says
    const h = brokered({ closeExits: false, idleReapMs: 1, deps: { stopRungMs: 5_000 } });
    await h.call();
    // idle: the broker reaps the engine, and the supervisor forgets the run while the engine is still leaving
    await vi.waitFor(() => expect(h.closes).toHaveBeenCalledTimes(1), { interval: 1 });
    let answer: (value: PagesDaemonExchange) => void = () => undefined;
    h.state.reply = () =>
      new Promise<PagesDaemonExchange>((resolve) => {
        answer = resolve;
      });
    const pending = h.call("reload", "act");
    await vi.waitFor(() => expect(h.sent.at(-1)).toBe("reload"), { interval: 1 });
    expect(h.made).toHaveLength(2);
    // the first engine leaves now, under the second's call
    h.made[0]?.exit(0);
    expect(h.made[1]?.exited).toBe(false);
    answer(ok({ reloaded: true }));
    expect(await pending).toMatchObject({ status: "done" });
    expect(h.sent.filter((action) => action === "launch")).toHaveLength(2);
    // its own exit is heard as ever, and leaves the quit nothing to wait for
    h.made[1]?.exit(0);
    await h.broker.stop("quit");
  });

  it("an engine that hangs is ended by the ladder and another started; one that keeps hanging is stopped as a crash loop is", async () => {
    const h = brokered();
    const hung = (): PagesDaemonExchange => ({ ok: false, failure: "timeout", written: true });
    const loops = ENGINE_CRASH_LOOP.exits;
    for (let engine = 1; engine <= loops; engine += 1) {
      h.state.reply = () => ok({});
      await h.call();
      expect(h.made).toHaveLength(engine);
      h.state.reply = hung;
      for (let i = 0; i < PAGES_HUNG_CALLS; i += 1) {
        expect(await h.failed(h.call())).toEqual({ kind: "TIMEOUT", state: "deadline" });
      }
      // replaced: its own close ends it
      await vi.waitFor(() => expect(h.made[engine - 1]?.exited).toBe(true));
    }
    expect(await h.failed(h.call())).toEqual({ kind: "UNAVAILABLE", state: "engine-stopped" });
    expect(h.made).toHaveLength(loops);
    await h.broker.stop("quit");
  });

  it("an engine off the bridge is ended though it is still running, and the run's exits stay counted", async () => {
    const h = brokered();
    await h.call();
    h.state.live = false;
    h.broker.bridgeClosed("run-1");
    await vi.waitFor(() => expect(h.made[0]?.exited).toBe(true));
    h.state.live = true;
    await h.call();
    expect(h.made).toHaveLength(2);
    // that one, and two that exit by themselves: three in the window
    h.made[1]?.exit(1);
    await h.call();
    h.made[2]?.exit(1);
    expect(await h.failed(h.call())).toEqual({ kind: "UNAVAILABLE", state: "engine-stopped" });
    await h.broker.stop("quit");
  });
});
