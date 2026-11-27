import { EventEmitter } from "node:events";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { daemonReady, exchangeDaemon } from "../src/main/pages/broker/daemon-client";
import type { PagesEngineIdentityResult } from "../src/main/pages/broker/engine-identity";
import {
  type EngineChild,
  PagesEngineSupervisor,
  type PagesEngineSupervisorDeps,
  type SpawnEngine,
} from "../src/main/pages/broker/engine-supervisor";
import { type PagesSurroundings, pagesEngineEnv } from "../src/main/pages/broker/surroundings";

// EY-1 (2026-11-19): one page engine per run, main's own child, started once at a time, restarted
// lazily, stopped by a ladder. Every child and socket is a fake: nothing runs and nothing is made.
// The release binary's stream port (2026-11-24): the engine starts with the three switches on,
// names main alone as its socket's peer, and is refused once ready if its folder shows a stream.

// Item 658 (2026-11-26): every way node starts a process, as a spy. The supervisor starts its engine
// through the spawner it is handed and nothing else; the row of its refusal holds that it uses none
// of these, so that nothing it does can stand between its refusal and its ladder.
const childProcess = vi.hoisted(() => ({
  spawn: vi.fn(),
  spawnSync: vi.fn(),
  exec: vi.fn(),
  execSync: vi.fn(),
  execFile: vi.fn(),
  execFileSync: vi.fn(),
  fork: vi.fn(),
}));
vi.mock("node:child_process", () => childProcess);

/** The one peer the engine admits: main's own pid in the product, the rows' number here. */
const PEER = 4141;

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

const ok = (path: string): PagesEngineIdentityResult => ({
  ok: true,
  kind: "dev-source-build",
  path,
  version: "0.41.0",
});

function harness(o: {
  readonly children?: (() => FakeChild)[];
  readonly identity?: PagesEngineIdentityResult;
  readonly ready?: boolean;
  readonly closeExits?: boolean;
  readonly path?: string | null;
  /** what the engine's socket folder shows once it is ready: no stream file (the default), or one */
  readonly streamOff?: boolean;
  readonly deps?: Partial<PagesEngineSupervisorDeps>;
}) {
  const made: FakeChild[] = [];
  const byRoot = new Map<string, FakeChild>();
  const spawn = vi.fn<SpawnEngine>((_file, _args, so) => {
    const child = (o.children?.[made.length] ?? (() => new FakeChild()))();
    made.push(child);
    byRoot.set(so.cwd.slice(0, -"/cwd".length), child);
    return child;
  });
  // The engine's own `close`: that engine exits after answering, unless told it ignores it.
  const exchange = vi.fn<typeof exchangeDaemon>(async (path) => {
    const child = [...byRoot].find(([root]) => path.startsWith(`${root}/`))?.[1];
    if (o.closeExits !== false && child !== undefined) setImmediate(() => child.exit(0));
    return { ok: true, reply: { success: true } };
  });
  const deps: PagesEngineSupervisorDeps = {
    enginePath: () => (o.path === undefined ? "/pinned/agent-browser" : o.path),
    identity: async (path) => o.identity ?? ok(path),
    surroundings,
    spawn,
    exchange,
    ready: vi.fn(async () => o.ready ?? true),
    readyMs: 50,
    stopRungMs: 20,
    peerPid: PEER,
    // every root here is a made-up path, so each row says what the folder shows
    stream: () => ((o.streamOff ?? true) ? "off" : "on"),
    ...o.deps,
  };
  return { supervisor: new PagesEngineSupervisor(deps), spawn, exchange, made };
}

afterEach(() => {
  vi.restoreAllMocks();
  for (const spy of Object.values(childProcess)) spy.mockClear();
});

describe("one engine per run", () => {
  it("starts once, as main's direct child in daemon mode, and reuses it", async () => {
    const { supervisor, spawn } = harness({});
    const [a, b] = await Promise.all([supervisor.ensure("run-1"), supervisor.ensure("run-1")]);
    expect(a).toEqual(b);
    expect(spawn).toHaveBeenCalledTimes(1);
    const [file, args, o] = spawn.mock.calls[0] ?? [];
    expect(file).toBe("/pinned/agent-browser");
    expect(args).toEqual([]);
    const lease = a.ok ? a.engine : null;
    expect(o?.cwd).toBe(lease?.surroundings.cwd);
    expect(o?.env).toEqual(
      pagesEngineEnv(lease?.surroundings as PagesSurroundings, { peerPid: PEER }),
    );
    await supervisor.ensure("run-1");
    expect(spawn).toHaveBeenCalledTimes(1);
    expect(supervisor.stats()).toEqual({ engines: 1, starts: 1, exits: 0 });
  });

  it("starts it with the stream off, the address withheld, and main alone as its socket's peer", async () => {
    const { supervisor, spawn } = harness({});
    await supervisor.ensure("run-1");
    expect(spawn.mock.calls[0]?.[2].env).toMatchObject({
      AGENT_BROWSER_NO_STREAM: "1",
      AGENT_BROWSER_PEER_PIDS: String(PEER),
      AGENT_BROWSER_HIDE_CDP_URL: "1",
      // item 658 (2026-11-26): and with no browser file it could start by itself
      AGENT_BROWSER_EXECUTABLE_PATH: "/dev/null/vibefield-no-browser",
    });
    // none given: the peer is this process, which is main in the product
    const own = harness({ deps: { peerPid: undefined } });
    await own.supervisor.ensure("run-1");
    expect(own.spawn.mock.calls[0]?.[2].env.AGENT_BROWSER_PEER_PIDS).toBe(String(process.pid));
  });

  it("tells a testing hook each child it spawns, with its run, its generation and what was spawned (item 658, 2026-11-26)", async () => {
    const onSpawned = vi.fn();
    const { supervisor, made } = harness({ deps: { onSpawned } });
    const a = await supervisor.ensure("run-1");
    const b = await supervisor.ensure("run-2");
    if (!a.ok || !b.ok) throw new Error("both runs get an engine");
    expect(a.engine.surroundings.root).not.toBe(b.engine.surroundings.root);
    expect(onSpawned.mock.calls).toEqual([
      ["run-1", 1, made[0], { file: "/pinned/agent-browser", surroundings: a.engine.surroundings }],
      ["run-2", 1, made[1], { file: "/pinned/agent-browser", surroundings: b.engine.surroundings }],
    ]);
  });

  it("spawns the file its identity check answered, never the path it was configured with, and tells the hook that file (item 658, 2026-11-26)", async () => {
    const onSpawned = vi.fn();
    const { supervisor, spawn } = harness({
      identity: ok("/checked/copy/agent-browser"),
      deps: { onSpawned },
    });
    expect((await supervisor.ensure("run-1")).ok).toBe(true);
    expect(spawn.mock.calls[0]?.[0]).toBe("/checked/copy/agent-browser");
    expect(onSpawned.mock.calls[0]?.[3]?.file).toBe("/checked/copy/agent-browser");
  });

  it("tells the hook before the ready wait, with the socket the wait is then given (item 658, 2026-11-26)", async () => {
    const onSpawned = vi.fn();
    const ready = vi.fn<typeof daemonReady>(async () => true);
    const { supervisor } = harness({ deps: { onSpawned, ready } });
    const got = await supervisor.ensure("run-1");
    if (!got.ok) throw new Error("the run gets an engine");
    expect(onSpawned).toHaveBeenCalledTimes(1);
    expect(ready).toHaveBeenCalledTimes(1);
    const told = onSpawned.mock.calls[0]?.[3]?.surroundings;
    expect(told?.socketPath).toBe(got.engine.socketPath);
    expect(ready.mock.calls[0]?.[0]).toBe(told?.socketPath);
    expect(onSpawned.mock.invocationCallOrder[0]).toBeLessThan(
      ready.mock.invocationCallOrder[0] as number,
    );
  });

  it("tells the hook of an engine that is then refused, and of one that never becomes ready: every spawn, not only a leased one (item 658, 2026-11-26)", async () => {
    for (const o of [{ streamOff: false }, { ready: false, closeExits: false }]) {
      const onSpawned = vi.fn();
      const { supervisor, spawn, made } = harness({ ...o, deps: { onSpawned } });
      const got = await supervisor.ensure("run-1");
      expect(got.ok).toBe(false);
      expect(onSpawned).toHaveBeenCalledTimes(1);
      const [run, generation, child, spawned] = onSpawned.mock.calls[0] ?? [];
      expect([run, generation, child]).toEqual(["run-1", 1, made[0]]);
      expect(spawned?.file).toBe(spawn.mock.calls[0]?.[0]);
      // the surroundings are the ones the child was started in: its own cwd, and a socket under it
      expect(spawned?.surroundings.cwd).toBe(spawn.mock.calls[0]?.[2].cwd);
      expect(spawned?.surroundings.socketPath.startsWith(`${spawned?.surroundings.root}/`)).toBe(
        true,
      );
    }
  });

  it("tells the hook once of an engine its run reuses: a later call for the run starts nothing and tells nobody (item 658, 2026-11-26)", async () => {
    const onSpawned = vi.fn();
    const { supervisor, spawn } = harness({ deps: { onSpawned } });
    const first = await supervisor.ensure("run-1");
    const [a, b] = await Promise.all([supervisor.ensure("run-1"), supervisor.ensure("run-1")]);
    expect(a).toEqual(first);
    expect(b).toEqual(first);
    expect(spawn).toHaveBeenCalledTimes(1);
    expect(onSpawned).toHaveBeenCalledTimes(1);
  });

  it("hands a call that comes during the ready wait nothing until the wait and the stream check have ended: it joins the start, and the hook is told once (item 658, 2026-11-26)", async () => {
    // The run holds its engine from the spawn on. A call that came between the spawn and the end
    // of the checks was handed that engine at once: not ready, and not read for a stream.
    let answer: (ready: boolean) => void = () => undefined;
    const ready = vi.fn<typeof daemonReady>(
      () =>
        new Promise<boolean>((resolve) => {
          answer = resolve;
        }),
    );
    const onSpawned = vi.fn();
    const { supervisor, spawn } = harness({ streamOff: false, deps: { ready, onSpawned } });
    const first = supervisor.ensure("run-1");
    await vi.waitFor(() => expect(ready).toHaveBeenCalledTimes(1));
    expect(spawn).toHaveBeenCalledTimes(1);
    let second: Awaited<ReturnType<PagesEngineSupervisor["ensure"]>> | "waiting" = "waiting";
    const joined = supervisor.ensure("run-1").then((answered) => {
      second = answered;
      return answered;
    });
    await new Promise((resolve) => setImmediate(resolve));
    expect(second).toBe("waiting");
    answer(true);
    // the engine's stream is on: both calls are answered its refusal, and neither a lease
    expect(await first).toEqual({ ok: false, unavailable: "engine-refused" });
    expect(await joined).toEqual({ ok: false, unavailable: "engine-refused" });
    expect(spawn).toHaveBeenCalledTimes(1);
    expect(onSpawned).toHaveBeenCalledTimes(1);
  });

  it("goes on when a testing hook throws: the engine is still waited ready and read for a stream, and leased only then (item 658, 2026-11-26)", async () => {
    const failing = () =>
      vi.fn(() => {
        throw new Error("the hook failed");
      });
    const ready = vi.fn<typeof daemonReady>(async () => true);
    const stream = vi.fn(() => "off" as const);
    const log = vi.fn();
    const { supervisor, spawn } = harness({ deps: { onSpawned: failing(), ready, stream, log } });
    const got = await supervisor.ensure("run-1");
    expect(got.ok).toBe(true);
    expect(ready).toHaveBeenCalledTimes(1);
    expect(stream).toHaveBeenCalledTimes(1);
    // and the throw is SAID, by a count-free line no production start can say (it passes no hook):
    // whoever holds the hook reads it, since an engine it was not told of is an engine nobody watches
    expect(log).toHaveBeenCalledWith("pages.engine.hook", { threw: "yes" });
    expect(log.mock.calls.filter(([event]) => event === "pages.engine.hook")).toHaveLength(1);
    // the run holds that engine and no other: the next call starts nothing
    expect(await supervisor.ensure("run-1")).toEqual(got);
    expect(spawn).toHaveBeenCalledTimes(1);
    // and a hook's throw is no way past the stream check: an engine whose stream is on is refused all the same
    const on = harness({ streamOff: false, deps: { onSpawned: failing() } });
    expect(await on.supervisor.ensure("run-1")).toEqual({
      ok: false,
      unavailable: "engine-refused",
    });
    expect(on.made[0]?.exited).toBe(true);
  });

  it("gives each run its own engine", async () => {
    const { supervisor, spawn } = harness({});
    const a = await supervisor.ensure("run-1");
    const b = await supervisor.ensure("run-2");
    expect(spawn).toHaveBeenCalledTimes(2);
    expect(a.ok && b.ok && a.engine.socketPath !== b.engine.socketPath).toBe(true);
  });
});

describe("what keeps an engine from starting", () => {
  it("answers not-installed with no path, and engine-refused on a failed identity", async () => {
    const none = harness({ path: null });
    expect(await none.supervisor.ensure("run-1")).toEqual({
      ok: false,
      unavailable: "not-installed",
    });
    const refused = harness({ identity: { ok: false, reason: "sha256-mismatch" } });
    expect(await refused.supervisor.ensure("run-1")).toEqual({
      ok: false,
      unavailable: "engine-refused",
    });
    expect(none.spawn).not.toHaveBeenCalled();
    expect(refused.spawn).not.toHaveBeenCalled();
  });

  it("stops an engine whose socket never answers, and says engine-starting", async () => {
    const { supervisor, made } = harness({ ready: false, closeExits: false });
    expect(await supervisor.ensure("run-1")).toEqual({ ok: false, unavailable: "engine-starting" });
    expect(made[0]?.signals).toEqual(["SIGTERM"]);
  });
});

describe("an engine that is not usable after its ready wait (item 658, 2026-11-26)", () => {
  // Main said nothing of it: the caller was answered engine-starting and the log held no line. An
  // engine that took main's connection and then left is a state of its own, and is said as one.
  it("is said as it is, before the ladder: whether it answered the wait, and whether it is gone", async () => {
    const cases: {
      readonly answered: boolean;
      readonly gone: boolean;
      readonly said: { readonly answered: string; readonly gone: string };
    }[] = [
      // slow: never ready in time and still running, so main ends it
      { answered: false, gone: false, said: { answered: "no", gone: "no" } },
      // left before it was ever ready
      { answered: false, gone: true, said: { answered: "no", gone: "yes" } },
      // took main's connection, and was gone before main read its folder
      { answered: true, gone: true, said: { answered: "yes", gone: "yes" } },
    ];
    for (const c of cases) {
      const log = vi.fn();
      const stream = vi.fn(() => "off" as const);
      const ready = vi.fn<typeof daemonReady>(async () => {
        if (c.gone) h.made[0]?.exit(1);
        return c.answered;
      });
      const h = harness({ closeExits: false, deps: { log, ready, stream } });
      expect(await h.supervisor.ensure("run-1"), JSON.stringify(c)).toEqual({
        ok: false,
        unavailable: "engine-starting",
      });
      const lines = log.mock.calls.filter(([event]) => event === "pages.engine.unready");
      expect(lines, JSON.stringify(c)).toEqual([["pages.engine.unready", c.said]]);
      // never read for a stream, never said ready, never leased
      expect(stream).not.toHaveBeenCalled();
      expect(log.mock.calls.some(([event]) => event === "pages.engine.ready")).toBe(false);
      if (!c.gone) {
        // said before the ladder's first rung
        const at = log.mock.calls.findIndex(([event]) => event === "pages.engine.unready");
        expect(log.mock.invocationCallOrder[at]).toBeLessThan(
          h.exchange.mock.invocationCallOrder[0] as number,
        );
      }
    }
  });

  it("retires a slow engine and ends it whatever the line's logger does: a logger that throws there leaves no engine a later call is handed, and none running", async () => {
    let thrown = false;
    const log = vi.fn((event: string) => {
      if (event !== "pages.engine.unready" || thrown) return;
      thrown = true;
      throw new Error("the logger failed");
    });
    // an engine that will not stop: it is still running after every rung, so only its being
    // RETIRED keeps it from the next call (item 658, 2026-11-27: with a child that died on a
    // signal, this row passed with the retire placed after the line)
    const { supervisor, spawn, exchange, made } = harness({
      children: [() => new FakeChild([])],
      ready: false,
      closeExits: false,
      deps: { log },
    });
    await expect(supervisor.ensure("run-1")).rejects.toThrow("the logger failed");
    // the whole ladder all the same: its close, then both signals
    expect(exchange.mock.calls[0]?.[1]).toMatchObject({ action: "close" });
    expect(made[0]?.signals).toEqual(["SIGTERM", "SIGKILL"]);
    expect(made[0]?.exited).toBe(false);
    // and the next call starts an engine of its own: it is never handed the one that was not ready
    expect(await supervisor.ensure("run-1")).toEqual({ ok: false, unavailable: "engine-starting" });
    expect(spawn).toHaveBeenCalledTimes(2);
  });

  it("signals a slow engine though EVERY line's logger fails: the ladder's own line stops no rung (item 658, 2026-11-27)", async () => {
    const log = vi.fn((_event: string) => {
      throw new Error("the sink is broken");
    });
    const { supervisor, exchange, made } = harness({
      ready: false,
      closeExits: false,
      deps: { log },
    });
    await expect(supervisor.ensure("run-1")).rejects.toThrow("the sink is broken");
    expect(exchange.mock.calls[0]?.[1]).toMatchObject({ action: "close" });
    // the close line's logger threw after the engine's close was sent: the signal still goes
    expect(log.mock.calls.map(([event]) => event)).toContain("pages.engine.close");
    expect(made[0]?.signals).toEqual(["SIGTERM"]);
    expect(made[0]?.exited).toBe(true);
  });

  it("is not said of an engine that is ready and stays: its line is the ready line alone", async () => {
    const log = vi.fn();
    const { supervisor } = harness({ deps: { log } });
    expect((await supervisor.ensure("run-1")).ok).toBe(true);
    expect(log.mock.calls.map(([event]) => event)).toEqual(["pages.engine.ready"]);
  });
});

describe("an engine whose stream is on", () => {
  it("is read once it is ready, on its own folder, and said off in the ready line", async () => {
    const order: string[] = [];
    const seen: PagesSurroundings[] = [];
    const log = vi.fn(
      (_event: string, _fields: Readonly<Record<string, number | string>>) => undefined,
    );
    const { supervisor } = harness({
      deps: {
        log,
        ready: async () => {
          order.push("ready");
          return true;
        },
        stream: (s) => {
          order.push("stream");
          seen.push(s);
          return "off";
        },
      },
    });
    const started = await supervisor.ensure("run-1");
    expect(order).toEqual(["ready", "stream"]);
    expect(seen).toEqual([started.ok ? started.engine.surroundings : null]);
    expect(log).toHaveBeenCalledWith("pages.engine.ready", {
      ms: expect.any(Number),
      identity: "dev-source-build",
      stream: "off",
    });
  });

  it("is refused and stopped, never leased, and no engine is started after it", async () => {
    const log = vi.fn(
      (_event: string, _fields: Readonly<Record<string, number | string>>) => undefined,
    );
    const { supervisor, spawn, exchange, made } = harness({ streamOff: false, deps: { log } });
    expect(await supervisor.ensure("run-1")).toEqual({ ok: false, unavailable: "engine-refused" });
    expect(log).toHaveBeenCalledWith("pages.engine.refused", { reason: "stream-on" });
    expect(log.mock.calls.map(([event]) => event)).not.toContain("pages.engine.ready");
    // a refused engine answered main and was read: it is no engine that was not usable after its wait
    expect(log.mock.calls.map(([event]) => event)).not.toContain("pages.engine.unready");
    // stopped by the ladder: its own close first, and it is gone
    expect(exchange.mock.calls[0]?.[1]).toMatchObject({ action: "close" });
    expect(made[0]?.exited).toBe(true);
    expect(supervisor.stats().engines).toBe(0);
    // the same file would open the same listener: this run and every other get no engine
    expect(await supervisor.ensure("run-1")).toEqual({ ok: false, unavailable: "engine-refused" });
    expect(await supervisor.ensure("run-2")).toEqual({ ok: false, unavailable: "engine-refused" });
    expect(spawn).toHaveBeenCalledTimes(1);
  });

  it("says its refusal and begins its ladder in the same turn, and starts nothing of its own between them: told by a plain logger, as in every run but the pages smoke's, the line returns and the engine's close is sent at once (item 658, 2026-11-26)", async () => {
    // The pages smoke's witness reads a refused engine INSIDE this line, and main stands still for
    // it. That is the witness's, behind the smoke's own flag; the supervisor itself puts nothing
    // between the line and the ladder, and this row keeps it so.
    const order: string[] = [];
    const log = vi.fn((event: string) => {
      if (event !== "pages.engine.refused") return;
      order.push("refused");
      // the loop's next turn, asked for from inside the line
      setImmediate(() => order.push("turn"));
    });
    const { supervisor, spawn, exchange } = harness({ streamOff: false, deps: { log } });
    const close = exchange.getMockImplementation();
    if (close === undefined) throw new Error("the harness answers the engine's close");
    exchange.mockImplementation(async (...sent) => {
      order.push("close");
      return close(...sent);
    });
    expect(await supervisor.ensure("run-1")).toEqual({ ok: false, unavailable: "engine-refused" });
    await new Promise((resolve) => setImmediate(resolve));
    expect(order).toEqual(["refused", "close", "turn"]);
    expect(exchange.mock.calls[0]?.[1]).toMatchObject({ action: "close" });
    // one process in all: the engine itself, through the spawner the supervisor was handed
    expect(spawn).toHaveBeenCalledTimes(1);
    // and nothing by any of node's own ways of starting one, from the start to the engine's end
    for (const [name, spy] of Object.entries(childProcess)) {
      expect(spy, name).not.toHaveBeenCalled();
    }
  });

  it("is refused though it outlives every rung: an engine that will not stop is still never leased", async () => {
    const never = () => new FakeChild([]);
    const { supervisor, spawn } = harness({
      children: [never],
      closeExits: false,
      streamOff: false,
    });
    expect(await supervisor.ensure("run-1")).toEqual({ ok: false, unavailable: "engine-refused" });
    expect(await supervisor.ensure("run-1")).toEqual({ ok: false, unavailable: "engine-refused" });
    expect(spawn).toHaveBeenCalledTimes(1);
  });

  it("a folder main cannot read, and an engine that outlives every rung: the next call is NOT handed it, and it counts against the run (item 658, 2026-11-27)", async () => {
    // Older than item 658: the stream-on refusal is latched for main's whole life, so its next
    // call is refused whatever became of the engine. An unread folder latches nothing, and an
    // engine that was refused for it and would not stop was neither gone nor retired: the run's
    // next call was handed its lease.
    const never = () => new FakeChild([]);
    const { supervisor, spawn, made } = harness({
      children: [never, never, never],
      closeExits: false,
      deps: { stream: undefined },
    });
    expect(await supervisor.ensure("run-1")).toEqual({ ok: false, unavailable: "engine-refused" });
    expect(made[0]?.signals).toEqual(["SIGTERM", "SIGKILL"]);
    expect(made[0]?.exited).toBe(false);
    // the next call starts an engine of its own, and is answered for THAT one
    expect(await supervisor.ensure("run-1")).toEqual({ ok: false, unavailable: "engine-refused" });
    expect(spawn).toHaveBeenCalledTimes(2);
    // each such engine counts against the run as one that exited does: the third stops it
    expect(await supervisor.ensure("run-1")).toEqual({ ok: false, unavailable: "engine-refused" });
    expect(spawn).toHaveBeenCalledTimes(3);
    expect(await supervisor.ensure("run-1")).toEqual({ ok: false, unavailable: "engine-stopped" });
    expect(spawn).toHaveBeenCalledTimes(3);
  });

  it("a refused engine is ended whatever the refusal line's logger does (item 658, 2026-11-27)", async () => {
    const log = vi.fn((event: string) => {
      if (event === "pages.engine.refused") throw new Error("the logger failed");
    });
    const { supervisor, exchange, made } = harness({
      streamOff: false,
      closeExits: false,
      deps: { log },
    });
    await expect(supervisor.ensure("run-1")).rejects.toThrow("the logger failed");
    expect(exchange.mock.calls[0]?.[1]).toMatchObject({ action: "close" });
    expect(made[0]?.signals).toEqual(["SIGTERM"]);
    expect(made[0]?.exited).toBe(true);
    // and the latch stands: the stream that is on starts no engine again
    expect(await supervisor.ensure("run-1")).toEqual({ ok: false, unavailable: "engine-refused" });
  });

  it("a refused engine is RETIRED and COUNTED though its refusal line's logger throws: with nothing latched and an engine that will not stop, the next call is still not handed it (item 658, 2026-11-27)", async () => {
    // The row above is a stream that is ON: its latch answers the next call, so it cannot see an
    // engine that was never retired, and nobody reads its count. Here the folder is unread (nothing
    // is latched) and the engine outlives every rung: only its being retired BEFORE the line keeps
    // it from the next call, and only its being counted there stops the run at the third.
    const never = () => new FakeChild([]);
    const log = vi.fn((event: string) => {
      if (event === "pages.engine.refused") throw new Error("the logger failed");
    });
    const { supervisor, spawn, made } = harness({
      children: [never, never, never],
      closeExits: false,
      deps: { stream: undefined, log },
    });
    await expect(supervisor.ensure("run-1")).rejects.toThrow("the logger failed");
    expect(made[0]?.signals).toEqual(["SIGTERM", "SIGKILL"]);
    expect(made[0]?.exited).toBe(false);
    await expect(supervisor.ensure("run-1")).rejects.toThrow("the logger failed");
    expect(spawn).toHaveBeenCalledTimes(2);
    await expect(supervisor.ensure("run-1")).rejects.toThrow("the logger failed");
    expect(spawn).toHaveBeenCalledTimes(3);
    expect(await supervisor.ensure("run-1")).toEqual({ ok: false, unavailable: "engine-stopped" });
    expect(spawn).toHaveBeenCalledTimes(3);
  });

  it("a testing hook that throws, and a logger that fails on every line: the engine still goes through its ready wait and its stream check before any call can be handed it (item 658, 2026-11-27)", async () => {
    // The hook's own line is said while the run already holds the engine. Unguarded, a logger that
    // threw there ended the start before the ready wait: an engine that had passed neither check,
    // neither retired nor ended, and the run's next call was handed its lease.
    const log = vi.fn((_event: string) => {
      throw new Error("the sink is broken");
    });
    const ready = vi.fn(async () => true);
    const stream = vi.fn((): "off" => "off");
    const { supervisor, spawn } = harness({
      deps: {
        log,
        ready,
        stream,
        onSpawned: () => {
          throw new Error("the hook failed");
        },
      },
    });
    // the ready line's logger throws too, AFTER both checks: that call is rejected for it
    await expect(supervisor.ensure("run-1")).rejects.toThrow("the sink is broken");
    expect(log.mock.calls.map(([event]) => event)).toEqual([
      "pages.engine.hook",
      "pages.engine.ready",
    ]);
    expect(ready).toHaveBeenCalledTimes(1);
    expect(stream).toHaveBeenCalledTimes(1);
    // the engine the next call is handed is one that passed both
    expect((await supervisor.ensure("run-1")).ok).toBe(true);
    expect(spawn).toHaveBeenCalledTimes(1);
  });

  it("a folder main cannot read refuses THAT engine, under a reason of its own; it says nothing of the build, so the next call starts another", async () => {
    // 2026-11-24: the product's own read of the instance's folder, which no row here makes. It was taken for a
    // stream that is on, which starts no engine again for main's whole life
    const log = vi.fn(
      (_event: string, _fields: Readonly<Record<string, number | string>>) => undefined,
    );
    const { supervisor, spawn, exchange, made } = harness({
      deps: { stream: undefined, log },
    });
    expect(await supervisor.ensure("run-1")).toEqual({ ok: false, unavailable: "engine-refused" });
    expect(log).toHaveBeenCalledWith("pages.engine.refused", { reason: "stream-unread" });
    expect(log).not.toHaveBeenCalledWith("pages.engine.refused", { reason: "stream-on" });
    expect(log.mock.calls.map(([event]) => event)).not.toContain("pages.engine.ready");
    // what main cannot tell, it refuses: stopped by the ladder and never leased
    expect(exchange.mock.calls[0]?.[1]).toMatchObject({ action: "close" });
    expect(made[0]?.exited).toBe(true);
    // another run gets an engine of its own, read afresh
    await supervisor.ensure("run-2");
    expect(spawn).toHaveBeenCalledTimes(2);
    // and it is bounded as any engine that keeps exiting is: three in the window stop the run's engine
    await supervisor.ensure("run-1");
    await supervisor.ensure("run-1");
    expect(spawn).toHaveBeenCalledTimes(4);
    expect(await supervisor.ensure("run-1")).toEqual({ ok: false, unavailable: "engine-stopped" });
    expect(spawn).toHaveBeenCalledTimes(4);
  });
});

describe("exits and restarts", () => {
  it("tells the exit at once, and starts a new generation at the next call", async () => {
    const { supervisor, made, spawn } = harness({});
    const told: [string, number][] = [];
    supervisor.onExit((run, generation) => told.push([run, generation]));
    const first = await supervisor.ensure("run-1");
    made[0]?.exit(1);
    expect(told).toEqual([["run-1", 1]]);
    const second = await supervisor.ensure("run-1");
    expect(spawn).toHaveBeenCalledTimes(2);
    expect(first.ok && first.engine.generation).toBe(1);
    expect(second.ok && second.engine.generation).toBe(2);
  });

  // 2026-11-24, an exit's number: a run the supervisor stopped is forgotten, and its next engine is generation one
  // again. The stopped engine may still be leaving by the ladder then, and its exit carries that same number.
  it("tells nobody of the exit of an engine its run no longer holds: the number may be its successor's", async () => {
    // this engine ignores its own close and leaves only on the ladder's signal, after the run's next one has started
    const { supervisor, made } = harness({ closeExits: false });
    const told: [string, number][] = [];
    supervisor.onExit((run, generation) => told.push([run, generation]));
    const first = await supervisor.ensure("run-1");
    const stopping = supervisor.stop("run-1");
    const second = await supervisor.ensure("run-1");
    expect(first.ok && first.engine.generation).toBe(1);
    expect(second.ok && second.engine.generation).toBe(1);
    await stopping;
    expect(made[0]?.exited).toBe(true);
    expect(made[1]?.exited).toBe(false);
    // the stopped engine's exit is not its successor's
    expect(told).toEqual([]);
    // the successor's own exit is told, and counted
    made[1]?.exit(1);
    expect(told).toEqual([["run-1", 1]]);
  });

  it("does not count a slow start that main itself ended: any number of them leaves the run able to start again (item 658, 2026-11-26)", async () => {
    // main retires an engine that was not ready in time before it ends it, and a retired engine's
    // exit is no crash. Held by no row before: an engine not retired there was counted, and three
    // slow starts on a loaded host stopped the run for good.
    const { supervisor, spawn } = harness({ ready: false, closeExits: false });
    for (let i = 0; i < 4; i += 1) {
      expect(await supervisor.ensure("run-1")).toEqual({
        ok: false,
        unavailable: "engine-starting",
      });
    }
    expect(spawn).toHaveBeenCalledTimes(4);
  });

  it("stops the run's engine for good after too many exits in the window", async () => {
    const { supervisor, made, spawn } = harness({});
    for (let i = 0; i < 3; i += 1) {
      expect((await supervisor.ensure("run-1")).ok).toBe(true);
      made[i]?.exit(1);
    }
    expect(await supervisor.ensure("run-1")).toEqual({ ok: false, unavailable: "engine-stopped" });
    expect(spawn).toHaveBeenCalledTimes(3);
  });
});

describe("the stop ladder", () => {
  it("closes first; an engine that leaves on its close gets no signal", async () => {
    const { supervisor, exchange, made } = harness({});
    await supervisor.ensure("run-1");
    await supervisor.stop("run-1");
    expect(exchange).toHaveBeenCalledTimes(1);
    expect(exchange.mock.calls[0]?.[1]).toMatchObject({ action: "close" });
    expect(made[0]?.signals).toEqual([]);
  });

  it("then TERM, then KILL, resolving only after the child's exit, and to it alone", async () => {
    const stubborn = () => new FakeChild(["SIGKILL"]);
    const { supervisor, made } = harness({ children: [stubborn], closeExits: false });
    // held, never passed through: no signal is ever sent from a test
    const kill = vi.spyOn(process, "kill").mockImplementation(() => true);
    await supervisor.ensure("run-1");
    let exited = false;
    made[0]?.once("exit", () => {
      exited = true;
    });
    await supervisor.stop("run-1");
    expect(made[0]?.signals).toEqual(["SIGTERM", "SIGKILL"]);
    expect(exited).toBe(true);
    expect(kill).not.toHaveBeenCalled();
  });

  it("stops every engine at stopAll, and starts none after", async () => {
    const { supervisor, made, spawn } = harness({});
    await supervisor.ensure("run-1");
    await supervisor.ensure("run-2");
    await supervisor.stopAll();
    expect(made.map((child) => child.exited)).toEqual([true, true]);
    expect(supervisor.stats().engines).toBe(0);
    expect(await supervisor.ensure("run-3")).toEqual({ ok: false, unavailable: "engine-stopped" });
    expect(spawn).toHaveBeenCalledTimes(2);
  });
});

describe("an engine's life across main's runs", () => {
  it("sweeps once, before the first root is made, and never again", async () => {
    const order: string[] = [];
    const sweep = vi.fn(async () => {
      order.push("sweep");
    });
    const made = (): PagesSurroundings => {
      order.push("surroundings");
      return surroundings();
    };
    const { supervisor } = harness({ deps: { sweep, surroundings: made } });
    await Promise.all([supervisor.ensure("run-1"), supervisor.ensure("run-2")]);
    await supervisor.ensure("run-3");
    expect(sweep).toHaveBeenCalledTimes(1);
    expect(order[0]).toBe("sweep");
    expect(order.filter((step) => step === "surroundings")).toHaveLength(3);
  });

  it("forgets a root once its engine's exit is seen, and a root whose start failed", async () => {
    const forget = vi.fn((_s: PagesSurroundings) => undefined);
    const { supervisor, made } = harness({ deps: { forget } });
    const started = await supervisor.ensure("run-1");
    expect(forget).not.toHaveBeenCalled();
    made[0]?.exit(1);
    expect(forget).toHaveBeenCalledWith(started.ok ? started.engine.surroundings : null);
    const refused = harness({
      identity: { ok: false, reason: "sha256-mismatch" },
      deps: { forget },
    });
    await refused.supervisor.ensure("run-1");
    expect(forget).toHaveBeenCalledTimes(2);
    const throwing = harness({
      deps: {
        forget,
        spawn: () => {
          throw new Error("EACCES");
        },
      },
    });
    expect(await throwing.supervisor.ensure("run-1")).toEqual({
      ok: false,
      unavailable: "engine-refused",
    });
    expect(forget).toHaveBeenCalledTimes(3);
  });

  it("an engine that exits during its ready wait, with a root that cannot be forgotten and a logger that fails on every line: its exit is still counted and told, and nothing escapes the exit's listener (item 658, 2026-11-27)", async () => {
    // The root's own line is said from the child's exit listener. Unguarded, a forget that threw and
    // a logger that threw there escaped the listener: the exit was never counted against the run,
    // the broker was never told of it, and the throw was main's, uncaught.
    const log = vi.fn((_event: string) => {
      throw new Error("the sink is broken");
    });
    const forget = vi.fn((_s: PagesSurroundings) => {
      throw new Error("EACCES");
    });
    const children: FakeChild[] = [];
    const escaped: unknown[] = [];
    const ready = vi.fn(async () => {
      // the engine exits while main waits for it to be ready
      try {
        children.at(-1)?.exit(1);
      } catch (error) {
        escaped.push(error);
      }
      return false;
    });
    const { supervisor } = harness({
      children: [0, 1, 2].map(() => () => {
        const child = new FakeChild();
        children.push(child);
        return child;
      }),
      deps: { log, forget, ready },
    });
    const told: [string, number][] = [];
    supervisor.onExit((run, generation) => told.push([run, generation]));
    for (const _ of [0, 1, 2]) {
      await expect(supervisor.ensure("run-1")).rejects.toThrow("the sink is broken");
    }
    expect(escaped).toEqual([]);
    expect(forget).toHaveBeenCalledTimes(3);
    expect(log.mock.calls.map(([event]) => event)).toContain("pages.engine.root");
    // each told, and each counted against the run: the third stops it
    expect(told.map(([run]) => run)).toEqual(["run-1", "run-1", "run-1"]);
    expect(await supervisor.ensure("run-1")).toEqual({ ok: false, unavailable: "engine-stopped" });
  });

  it("never lets the sweep stop the first start, whatever it meets", async () => {
    const sweep = vi.fn(async () => {
      throw new Error("EACCES");
    });
    const { supervisor, spawn } = harness({ deps: { sweep } });
    expect((await supervisor.ensure("run-1")).ok).toBe(true);
    expect(sweep).toHaveBeenCalledTimes(1);
    expect(spawn).toHaveBeenCalledTimes(1);
  });

  it("answers engine-refused when its surroundings cannot be made, and spawns nothing", async () => {
    const { supervisor, spawn } = harness({
      deps: {
        surroundings: () => {
          throw new Error("the parent is writable by others");
        },
      },
    });
    expect(await supervisor.ensure("run-1")).toEqual({ ok: false, unavailable: "engine-refused" });
    expect(spawn).not.toHaveBeenCalled();
  });

  it("stops every engine at once, and says by count the ones that did not end", async () => {
    const log = vi.fn(
      (_event: string, _fields: Readonly<Record<string, number | string>>) => undefined,
    );
    const ends = () => new FakeChild();
    const never = () => new FakeChild([]);
    const { supervisor } = harness({ children: [ends, never], closeExits: false, deps: { log } });
    await supervisor.ensure("run-1");
    await supervisor.ensure("run-2");
    expect(await supervisor.stopAll()).toEqual({ ended: 1, unended: 1 });
    expect(log).toHaveBeenCalledWith("pages.engine.unended", { unended: 1 });
  });
});
