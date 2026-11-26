import { EventEmitter } from "node:events";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { exchangeDaemon } from "../src/main/pages/broker/daemon-client";
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
    });
    // none given: the peer is this process, which is main in the product
    const own = harness({ deps: { peerPid: undefined } });
    await own.supervisor.ensure("run-1");
    expect(own.spawn.mock.calls[0]?.[2].env.AGENT_BROWSER_PEER_PIDS).toBe(String(process.pid));
  });

  it("tells a testing hook each child it spawns, with its run and generation", async () => {
    const onSpawned = vi.fn();
    const { supervisor, made } = harness({ deps: { onSpawned } });
    await supervisor.ensure("run-1");
    await supervisor.ensure("run-2");
    expect(onSpawned.mock.calls).toEqual([
      ["run-1", 1, made[0]],
      ["run-2", 1, made[1]],
    ]);
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
    // stopped by the ladder: its own close first, and it is gone
    expect(exchange.mock.calls[0]?.[1]).toMatchObject({ action: "close" });
    expect(made[0]?.exited).toBe(true);
    expect(supervisor.stats().engines).toBe(0);
    // the same file would open the same listener: this run and every other get no engine
    expect(await supervisor.ensure("run-1")).toEqual({ ok: false, unavailable: "engine-refused" });
    expect(await supervisor.ensure("run-2")).toEqual({ ok: false, unavailable: "engine-refused" });
    expect(spawn).toHaveBeenCalledTimes(1);
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
