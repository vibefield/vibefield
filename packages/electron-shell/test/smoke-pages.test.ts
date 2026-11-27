import { EventEmitter } from "node:events";
import { readdirSync, readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import type {
  ControlAnswer,
  PagesEngineWitness,
  PeerVerdict,
  WitnessedEngine,
} from "../src/testing/pages-engine-witness";
import type { SocketRead } from "../src/testing/pages-listeners";
import type { CensusRow, Verdict } from "../src/testing/pages-witness-judge";
import {
  PAGES_FIXTURE_ENV,
  PAGES_RUN_LATCH,
  PAGES_RUN_OPEN,
  PAGES_RUN_PLANT,
  type PagesSmokeDoor,
  pagesFixture,
  pagesVerdict,
  runPagesRows,
} from "../src/testing/smoke-pages";

// Item 658 (2026-11-26): the pages smoke's legs, over a door and a witness of the test's own. No
// engine runs, nothing listens and no process is read: what the witness would have seen is scripted,
// and the rows hold what the smoke makes of it. The last describe holds the row's place in the
// scripts, the landing gate, the desk gates and main's source. The fake engines keep what they were
// handed (the bridge, the census's rows, the digest), so the rows hold the wiring too.

const execFileSync = vi.hoisted(() => vi.fn());
vi.mock("node:child_process", async (original) => ({
  ...(await original<typeof import("node:child_process")>()),
  execFileSync,
}));

const httpGet = vi.hoisted(() => vi.fn());
vi.mock("node:http", async (original) => ({
  ...(await original<typeof import("node:http")>()),
  get: httpGet,
}));

afterEach(() => {
  execFileSync.mockReset();
  httpGet.mockReset();
});

const FIXTURE = {
  url: "http://127.0.0.1:50999/0123456789abcdef/",
  hits: "http://127.0.0.1:50999/0123456789abcdef/hits",
  // the SHA-256 of the engine copy's path: the run is told no path
  engineIs: "e".repeat(64),
};
const BRIDGE = "127.0.0.1:5555";
const DONE = { status: "done", output: { success: true } } as const;
const READY = { event: "pages.engine.ready", reason: null, identity: "dev-source-build" };
// Main's close line as the ROWS see it: an event and no more. Whether the engine TOOK that close (any
// line but `not-sent`, by which the witness reads an engine as answered: no waiver, blind) is the
// witness's to decide, and its own rows hold it; a stand-in engine here says its class by its
// `answered` word, so this line stands for a close of whichever class the row scripts.
const CLOSE = { event: "pages.engine.close", reason: null, identity: null };
const STREAM_ON = { event: "pages.engine.refused", reason: "stream-on", identity: null };
const ok: Verdict = { verdict: "ok" };
const red = (why: string): Verdict => ({ verdict: "red", why });
const blind = (why: string): Verdict => ({ verdict: "blind", why });

const thrown = (kind: string, state: string): Error =>
  Object.assign(new Error(`pages: ${state}`), { kind, state });

interface Script {
  run: string;
  planted: boolean;
  alive: boolean;
  lines: { event: string; reason: string | null; identity: string | null }[];
  identity: Verdict;
  stream: ReturnType<WitnessedEngine["stream"]>;
  pidFile: Verdict;
  tcp: ReturnType<WitnessedEngine["tcp"]>;
  listeners: ReturnType<WitnessedEngine["listeners"]>;
  udp: Verdict;
  census: Verdict;
  /** whether a read of its sockets shows the engine's own connection to main's bridge */
  attached: boolean;
  /** what a read that was still under way shows once it is waited for */
  late: Partial<Script>;
  fileIs: boolean;
  rootLeft: boolean;
  plantAtAnswer: boolean;
  plantFailed: string | null;
  quiet: boolean;
  /** what the rows handed this engine: the bridge its reads are counted by, the census's rows */
  asked: {
    tcp: (string | null)[];
    udp: (string | null)[];
    listeners: number;
    census: (readonly CensusRow[])[];
  };
}

type Engine = WitnessedEngine & { readonly s: Script };

const STREAM_OK = {
  verdict: "ok",
  polls: 40,
  holes: 0,
  maxGapMs: 100,
  lifeMs: 4000,
  plantSeen: false,
  socketSeen: true,
} as const;
const TCP_OK = {
  verdict: "ok",
  counted: 5,
  bare: 1,
  discarded: 0,
  maxGapMs: 520,
  headMs: 40,
  tailMs: 12,
  listeners: [],
} as const;
const TIED =
  "1 read of its sockets showed no listener; the refused engine's TCP read has no bridge positive control; its life is tied by the unix read";
const UNLEASED_OK = {
  verdict: "ok",
  said: [TIED],
  inside: 1,
  discarded: 0,
  unborne: 1,
  listeners: [],
} as const;
const NEVER =
  "2 reads of its sockets inside its life showed no listener; the engine never answered main, so none could bear the bridge control";
/** An engine that never answered main: its reads stand on the exit's word, and that is said. */
const UNANSWERED_OK = {
  verdict: "ok",
  said: [NEVER],
  inside: 2,
  discarded: 0,
  unborne: 0,
  listeners: [],
} as const;
const NO_BRIDGE = {
  ...TCP_OK,
  verdict: "blind",
  why: "main's bridge is not known, so the engine's reads have no control",
  counted: 0,
} as const;
const listening = (name: string) => ({ ...red(`the engine holds a TCP listener: ${name}`) });

function engine(run: string, order: string[], over: Partial<Script> = {}): Engine {
  const s: Script = {
    run,
    planted: false,
    alive: true,
    lines: [],
    identity: ok,
    stream: STREAM_OK,
    pidFile: ok,
    tcp: TCP_OK,
    listeners: UNLEASED_OK,
    udp: ok,
    census: ok,
    attached: false,
    late: {},
    fileIs: true,
    rootLeft: true,
    plantAtAnswer: false,
    plantFailed: null,
    quiet: false,
    asked: { tcp: [], udp: [], listeners: 0, census: [] },
    ...over,
  };
  return {
    s,
    run,
    generation: 1,
    get planted() {
      return s.planted;
    },
    alive: () => s.alive,
    lines: () => [...s.lines],
    quiet: () => {
      s.quiet = true;
      order.push(`quiet:${run}`);
    },
    identity: () => s.identity,
    stream: () => s.stream,
    pidFile: () => s.pidFile,
    tcp: (bridge) => {
      s.asked.tcp.push(bridge);
      order.push(`tcp:${run}`);
      // In the judge's own order. A listener in any read is RED whatever else is not known; only
      // then, with no bridge to count by, a leased engine's reads have no control. (This fake said
      // blind first, whatever the engine held: kinder than the judge, so no row could hold that a
      // listener is red while main's control is blind.)
      // The stretch after the last counted read runs to the judgment while it lives, and to its exit after
      const judged = { ...s.tcp, tailMs: s.alive ? s.tcp.tailMs : 30 };
      if (s.tcp.verdict === "red") return judged;
      return bridge === null ? NO_BRIDGE : judged;
    },
    listeners: () => {
      s.asked.listeners += 1;
      return s.listeners;
    },
    udp: (bridge) => {
      s.asked.udp.push(bridge);
      return s.udp;
    },
    // by the bridge main's own reads named, and by no other
    attached: (bridge) => bridge === BRIDGE && s.attached,
    answered: () =>
      s.lines.some((l) => l.event === "pages.engine.ready")
        ? "ready"
        : s.lines.some((l) => l.event === "pages.engine.refused")
          ? "refused"
          : "none",
    census: (rows) => {
      s.asked.census.push(rows);
      return s.census;
    },
    // true only when asked by the digest the stager handed the run
    fileIs: (pathSha256) => pathSha256 === FIXTURE.engineIs && s.fileIs,
    rootLeft: () => s.rootLeft,
    plantAtAnswer: () => s.plantAtAnswer,
    plantFailed: () => s.plantFailed,
  };
}

/** The stage a run plays on: the hooked engines, main's lines, and every call in order. */
class Stage {
  readonly engines: Engine[] = [];
  readonly said: { event: string; reason: string | null }[] = [];
  readonly calls: string[] = [];
  readonly lines: string[] = [];
  readonly plants = new Set<string>();
  /** the witness's calls that must come in an order: quiet, drained, the TCP judgment */
  readonly order: string[] = [];
  samples = 0;
  udpReads = 0;
  clock = 0;
  /** false: the rows read the run's processes themselves, through their own `ps` */
  censusGiven = true;
  /** false: the rows ask the stager's page for its count themselves */
  hitsGiven = true;
  peer: PeerVerdict = {
    verdict: "ok",
    said: ["refused", "the probe's line was written"],
    foreignMs: 12,
    mainBefore: "answered",
    mainAfter: "answered",
    tie: "ok",
    mainPeers: 1,
    mainByPath: 0,
    childSockets: 2,
    ties: 1,
  };
  own: ControlAnswer = { exchange: "answered", pid: "match", browser: true };
  hits: number | null = 1;
  listeners: SocketRead[] = [
    { seen: "read", lines: [] },
    { seen: "read", lines: [{ name: BRIDGE, state: "listen" }] },
  ];
  census: (() => readonly CensusRow[]) | null = null;

  spawn(run: string, over: Partial<Script> = {}): Engine {
    const made = engine(run, this.order, over);
    this.engines.push(made);
    return made;
  }
  /** the run's live engine ends as main's ladder ends it: its close line, its exit, its root gone */
  end(run: string): void {
    for (const e of this.engines) {
      if (e.run !== run || !e.s.alive) continue;
      e.s.lines.push(CLOSE);
      e.s.alive = false;
      e.s.rootLeft = false;
    }
  }
  readonly on: Record<string, (stage: Stage) => unknown> = {
    [`${PAGES_RUN_OPEN}:navigate`]: (stage) => {
      // the engine main leased is attached to main's bridge, as its counted reads show: that is
      // nothing against it, and only an engine main never said ready may not be
      stage.spawn(PAGES_RUN_OPEN, { lines: [READY], attached: true });
      return DONE;
    },
    [`${PAGES_RUN_OPEN}:close`]: (stage) => {
      stage.end(PAGES_RUN_OPEN);
      return DONE;
    },
    [`${PAGES_RUN_PLANT}:navigate`]: (stage) => {
      const planted = stage.plants.delete(PAGES_RUN_PLANT);
      stage.spawn(PAGES_RUN_PLANT, {
        planted,
        alive: false,
        rootLeft: false,
        lines: [STREAM_ON],
        plantAtAnswer: planted,
        stream: { ...STREAM_OK, polls: 3, lifeMs: 300, plantSeen: planted },
      });
      throw thrown("UNAVAILABLE", "engine-refused");
    },
    [`${PAGES_RUN_LATCH}:navigate`]: () => {
      throw thrown("UNAVAILABLE", "engine-refused");
    },
  };
  onStop: (stage: Stage) => void = (stage) => {
    for (const e of stage.engines) stage.end(e.run);
    stage.said.push({ event: "pages.broker.stop", reason: null });
  };

  witness(): PagesEngineWitness {
    return {
      onSpawned: () => undefined,
      line: () => undefined,
      plantFor: (run) => {
        this.plants.add(run);
      },
      engines: () => [...this.engines],
      said: () => [...this.said],
      control: async () => this.own,
      sample: async (e) => {
        this.samples += 1;
        this.order.push(`sample:${e.run}`);
      },
      readUdp: async (e) => {
        this.udpReads += 1;
        this.order.push(`udp:${e.run}`);
      },
      drained: async (e) => {
        this.order.push(`drained:${e.run}`);
        // a read that was under way has ended: what it showed is in the engine's verdicts from here
        const s = (e as Engine).s;
        Object.assign(s, s.late);
      },
      probePeer: async () => this.peer,
      settled: async () => ({ unended: this.engines.filter((e) => e.s.alive).length }),
      dispose: () => undefined,
    };
  }

  door(): PagesSmokeDoor {
    return {
      witness: this.witness(),
      control: async (p) => {
        const key = `${p.run}:${p.command.action}`;
        this.calls.push(key);
        this.clock += 10;
        const handler = this.on[key];
        if (handler === undefined) throw new Error(`no handler for ${key}`);
        return handler(this) as never;
      },
      stop: async () => {
        this.calls.push("stop");
        this.onStop(this);
      },
      // the exit's, never the rows': a row that called it would say so
      closeSurfaces: () => {
        this.calls.push("closeSurfaces");
      },
    };
  }

  async run() {
    let read = 0;
    const result = await runPagesRows({
      door: this.door(),
      fixture: FIXTURE,
      mainPid: 4242,
      say: (line) => this.lines.push(line),
      listeners: async () => {
        const at = Math.min(read, this.listeners.length - 1);
        read += 1;
        return this.listeners[at] as SocketRead;
      },
      ...(this.censusGiven
        ? {
            census:
              this.census ??
              (() => [
                { pid: 4242, ppid: 1, name: "electron" },
                ...this.engines
                  .filter((e) => e.s.alive)
                  .map((_, i) => ({ pid: 9000 + i, ppid: 4242, name: "agent-browser" })),
              ]),
          }
        : { mark: "vf-smoke-x" }),
      ...(this.hitsGiven ? { hits: async () => this.hits } : {}),
      load: () => 7.4567,
      now: () => this.clock,
      sleep: async (ms) => {
        this.clock += ms;
      },
    });
    return result;
  }
  line(name: string): Record<string, unknown> {
    const found = this.lines.find((l) => l.startsWith(`${name} `));
    if (found === undefined) throw new Error(`no ${name} line among ${this.lines.join(" | ")}`);
    return JSON.parse(found.slice(name.length + 1)) as Record<string, unknown>;
  }
}

describe("the legs, in their order", () => {
  it("is ok when every leg is: one open on the stager's page, then the control and the latch, then the product's own stop", async () => {
    const stage = new Stage();
    const result = await stage.run();
    expect(result).toMatchObject({ verdict: "ok", exit: 0, spawns: 2 });
    expect(result.legs).toEqual({
      open: "ok",
      identity: "ok",
      census: "ok",
      peer: "ok",
      tcp: "ok",
      close: "ok",
      control: "ok",
      latch: "ok",
      stop: "ok",
      engines: "ok",
    });
    // the control comes only after the open's run has closed: its latch would refuse the open
    expect(stage.calls).toEqual([
      `${PAGES_RUN_OPEN}:navigate`,
      `${PAGES_RUN_OPEN}:close`,
      `${PAGES_RUN_PLANT}:navigate`,
      `${PAGES_RUN_LATCH}:navigate`,
      "stop",
    ]);
    expect(stage.lines.map((l) => l.split(" ")[0])).toEqual([
      "SMOKE_PAGES_OPEN",
      "SMOKE_PAGES_IDENTITY",
      "SMOKE_PAGES_CENSUS",
      "SMOKE_PAGES_PEER",
      "SMOKE_PAGES_TCP",
      "SMOKE_PAGES_CLOSE",
      "SMOKE_PAGES_CONTROL",
      "SMOKE_PAGES_LATCH",
      "SMOKE_PAGES_STOP",
      "SMOKE_PAGES_ENGINES",
      "SMOKE_PAGES",
    ]);
    // the host's 1-minute load at the open, to two places: a blind under a loaded host is read with it
    expect(stage.line("SMOKE_PAGES_OPEN")).toMatchObject({
      verdict: "ok",
      hits: 1,
      tries: 1,
      load1: 7.46,
    });
    // the reads that were counted, the ones that bore no control, and the stretches no counted read
    // covers. The last of them runs to THIS judgment, with the engine alive: the stretch to its
    // exit is the close's to say
    const tcp = stage.line("SMOKE_PAGES_TCP");
    expect(tcp).toMatchObject({
      verdict: "ok",
      bridge: BRIDGE,
      counted: 5,
      bare: 1,
      discarded: 0,
      maxGapMs: 520,
      headMs: 40,
      sinceLastMs: 12,
    });
    expect(tcp).not.toHaveProperty("tailMs");
    expect(stage.line("SMOKE_PAGES_PEER")).toMatchObject({
      verdict: "ok",
      browser: true,
      pid: "match",
      foreignMs: 12,
      mainBefore: "answered",
      mainAfter: "answered",
      // the kernel's tie as counts, never an address
      tie: "ok",
      mainPeers: 1,
      mainByPath: 0,
      childSockets: 2,
      ties: 1,
    });
    expect(stage.line("SMOKE_PAGES_CLOSE")).toMatchObject({ verdict: "ok", unreadMs: 30 });
    expect(stage.line("SMOKE_PAGES_CONTROL")).toMatchObject({
      verdict: "ok",
      refused: "stream-on",
    });
    expect(stage.line("SMOKE_PAGES")).toMatchObject({ verdict: "ok", spawns: 2 });
    // three reads of the engine's sockets by phase, one of its UDP and one more after it, and no
    // read asked once it is to close
    expect(stage.samples).toBe(4);
    expect(stage.udpReads).toBe(1);
    expect(stage.engines[0]?.s.quiet).toBe(true);
    // the UDP read, then a read of its TCP sockets that can show it still alive, then the engine is
    // told to be quiet, every read that was begun is waited for, and only then is it judged
    const at = (what: string) => stage.order.lastIndexOf(`${what}:${PAGES_RUN_OPEN}`);
    const first = (what: string) => stage.order.indexOf(`${what}:${PAGES_RUN_OPEN}`);
    expect(first("udp")).toBeGreaterThanOrEqual(0);
    expect(at("sample")).toBeGreaterThan(first("udp"));
    expect(first("quiet")).toBeGreaterThan(at("sample"));
    expect(first("drained")).toBeGreaterThan(first("quiet"));
    expect(first("tcp")).toBeGreaterThan(first("drained"));
    // nothing said names a path or a pid
    const all = stage.lines.join("\n");
    expect(all).not.toContain("/");
    expect(all).not.toContain("4242");
    expect(all).not.toContain("9000");
  });

  it("hands each engine what main's own reads found: the bridge to count its reads by, the census's rows, the stager's digest", async () => {
    const stage = new Stage();
    const rows = [
      { pid: 4242, ppid: 1, name: "electron" },
      { pid: 9000, ppid: 4242, name: "agent-browser" },
    ];
    let reads = 0;
    stage.census = () => {
      reads += 1;
      // the engine is gone from the census by the stop
      return reads === 1 ? rows : rows.slice(0, 1);
    };
    expect(await stage.run()).toMatchObject({ verdict: "ok", exit: 0 });
    const [serving, planted] = stage.engines;
    // the engine that served is counted by the ONE new loopback listener main showed after the first call
    expect(serving?.s.asked.tcp.length).toBeGreaterThanOrEqual(2);
    expect(new Set(serving?.s.asked.tcp)).toEqual(new Set([BRIDGE]));
    expect(serving?.s.asked.census).toEqual([rows]);
    // its UDP read is borne out by the same bridge
    expect(serving?.s.asked.udp).toEqual([BRIDGE]);
    // the planted engine was never leased: its listeners alone are judged, by no bridge
    expect(planted?.s.asked.tcp).toEqual([]);
    expect(planted?.s.asked.listeners).toBeGreaterThanOrEqual(1);
    expect(planted?.s.asked.census).toEqual([]);
  });

  it("judges EVERY engine the witness was told of, after the product's stop: its file, the record, its folders, its sockets, its pid file", async () => {
    const stage = new Stage();
    await stage.run();
    expect(stage.line("SMOKE_PAGES_ENGINES")).toMatchObject({
      verdict: "ok",
      // what a judge waived and said is in the line: the refused engine's named waiver
      said: [TIED],
      engines: [
        {
          run: PAGES_RUN_OPEN,
          planted: false,
          leased: true,
          answer: "ready",
          verdict: "ok",
          lifeMs: 4000,
          polls: 40,
          holes: 0,
          maxGapMs: 100,
          socketSeen: true,
          plantSeen: false,
          reads: 5,
          setAside: 0,
          // the engine's bare reads, and the stretch from its last counted read to its EXIT
          unborne: 1,
          tailMs: 30,
        },
        {
          run: PAGES_RUN_PLANT,
          planted: true,
          leased: false,
          answer: "refused",
          verdict: "ok",
          lifeMs: 300,
          polls: 3,
          plantSeen: true,
          // one read tied to its life by the unix read; one waited read said and not counted
          reads: 1,
          setAside: 0,
          unborne: 1,
          tailMs: null,
        },
      ],
    });
    // every engine's reads were waited for before it was judged, the planted one's too
    for (const run of [PAGES_RUN_OPEN, PAGES_RUN_PLANT]) {
      expect(stage.order.filter((step) => step === `drained:${run}`).length).toBeGreaterThanOrEqual(
        1,
      );
    }
    // after the stop: every engine has exited, so its whole life is judged
    expect(stage.lines.findIndex((l) => l.startsWith("SMOKE_PAGES_ENGINES "))).toBeGreaterThan(
      stage.lines.findIndex((l) => l.startsWith("SMOKE_PAGES_STOP ")),
    );
  });

  it("reads the run's processes through its own ps: by its absolute path, with an environment built from nothing", async () => {
    execFileSync.mockReturnValue("");
    const stage = new Stage();
    stage.censusGiven = false;
    await stage.run();
    expect(execFileSync.mock.calls.length).toBeGreaterThanOrEqual(2);
    for (const [file, args, options] of execFileSync.mock.calls) {
      expect(file).toBe("/bin/ps");
      // the census's own columns, handed on as it asked for them
      expect(args).toContain("pid=,ppid=,command=");
      expect((options as { env?: unknown }).env).toEqual({ PATH: "/usr/sbin:/usr/bin:/bin" });
      // main's own thread waits on it: it has a bound, and the bound ends it
      expect(options).toMatchObject({ timeout: 10_000, killSignal: "SIGKILL" });
    }
  });

  it("waits for EVERY engine's reads before it judges that engine: a listener a read still under way saw is the run's red", async () => {
    const stage = new Stage();
    // the planted engine's last read had not ended when the stop was done: it shows a listener
    stage.on[`${PAGES_RUN_PLANT}:navigate`] = (at) => {
      const was = at.plants.delete(PAGES_RUN_PLANT);
      at.spawn(PAGES_RUN_PLANT, {
        planted: was,
        alive: false,
        rootLeft: false,
        lines: [STREAM_ON],
        plantAtAnswer: was,
        stream: { ...STREAM_OK, polls: 3, lifeMs: 300, plantSeen: was },
        late: {
          listeners: {
            ...UNLEASED_OK,
            ...listening("127.0.0.1:9223"),
            listeners: ["127.0.0.1:9223"],
          },
        },
      });
      throw thrown("UNAVAILABLE", "engine-refused");
    };
    const got = await stage.run();
    expect(got).toMatchObject({ verdict: "red", exit: 1 });
    expect(got.legs.engines).toBe("red");
    expect(got.why).toContain("127.0.0.1:9223");
  });

  it("is BLIND when main said a testing hook threw: an engine it started may be watched by nobody", async () => {
    const stage = new Stage();
    const stop = stage.onStop;
    stage.onStop = (at) => {
      stop(at);
      at.said.push({ event: "pages.engine.hook", reason: null });
    };
    const got = await stage.run();
    expect(got).toMatchObject({ verdict: "blind", exit: 2 });
    expect(got.legs.engines).toBe("blind");
    expect(stage.line("SMOKE_PAGES_ENGINES")).toMatchObject({
      why: "main said its testing hook threw: an engine it started may be watched by nobody",
      hookThrew: 1,
    });
  });

  it("is BLIND when an engine main never said ready shows a connection to main's bridge: main's lines were laid to another engine", async () => {
    const stage = new Stage();
    stage.on[`${PAGES_RUN_PLANT}:navigate`] = (at) => {
      const was = at.plants.delete(PAGES_RUN_PLANT);
      at.spawn(PAGES_RUN_PLANT, {
        planted: was,
        alive: false,
        rootLeft: false,
        lines: [STREAM_ON],
        plantAtAnswer: was,
        stream: { ...STREAM_OK, polls: 3, lifeMs: 300, plantSeen: was },
        attached: true,
      });
      throw thrown("UNAVAILABLE", "engine-refused");
    };
    const got = await stage.run();
    expect(got.legs.engines).toBe("blind");
    expect(stage.line("SMOKE_PAGES_ENGINES")).toMatchObject({
      why: "an engine main never said ready shows a connection to main's bridge: its lines were laid to another engine",
    });
  });

  it("judges the folders of the engine that SERVED in the last leg too: a stream file in them is RED and a hole is BLIND; and the planted engine's pid file", async () => {
    const serving = (stream: Verdict) => {
      const stage = new Stage();
      stage.on[`${PAGES_RUN_OPEN}:navigate`] = (at) => {
        at.spawn(PAGES_RUN_OPEN, { lines: [READY], stream: { ...STREAM_OK, ...stream } });
        return DONE;
      };
      return stage;
    };
    const wrote = await serving(
      red("a stream file showed in the engine's folders: sock/x.stream"),
    ).run();
    expect(wrote).toMatchObject({ verdict: "red", exit: 1 });
    expect(wrote.legs).toMatchObject({ tcp: "ok", engines: "red" });
    const unread = await serving(
      blind("the engine's folders went unread for 1400 ms of its life"),
    ).run();
    expect(unread).toMatchObject({ verdict: "blind", exit: 2 });
    expect(unread.legs.engines).toBe("blind");
    const other = new Stage();
    other.on[`${PAGES_RUN_PLANT}:navigate`] = (at) => {
      const was = at.plants.delete(PAGES_RUN_PLANT);
      at.spawn(PAGES_RUN_PLANT, {
        planted: was,
        alive: false,
        rootLeft: false,
        lines: [STREAM_ON],
        plantAtAnswer: was,
        stream: { ...STREAM_OK, polls: 3, lifeMs: 300, plantSeen: was },
        pidFile: blind("the engine's pid file names another process than the child main spawned"),
      });
      throw thrown("UNAVAILABLE", "engine-refused");
    };
    expect((await other.run()).legs.engines).toBe("blind");
  });

  it("sends the run form's open as an agent's open sends it, and every call with a deadline of its own", async () => {
    const stage = new Stage();
    const sent: unknown[] = [];
    const door = stage.door();
    await runPagesRows({
      door: {
        ...door,
        control: async (p, ctx) => {
          sent.push({ p, left: ctx.deadlineAt - stage.clock, aborted: ctx.signal.aborted });
          return door.control(p, ctx);
        },
      },
      fixture: FIXTURE,
      mainPid: 4242,
      say: () => undefined,
      listeners: async () => ({ seen: "read", lines: [] }),
      census: () => [],
      hits: async () => 1,
      now: () => stage.clock,
      sleep: async (ms) => {
        stage.clock += ms;
      },
    });
    expect(sent[0]).toEqual({
      p: { run: PAGES_RUN_OPEN, window: "act", command: { action: "navigate", url: FIXTURE.url } },
      left: 30_000,
      aborted: false,
    });
    expect(sent[1]).toMatchObject({ p: { run: PAGES_RUN_OPEN, command: { action: "close" } } });
  });
});

describe("the open", () => {
  it("is RED when an engine answered and the witness was told of no child; the run is still closed and the product stopped, and no control is tried", async () => {
    const stage = new Stage();
    stage.on[`${PAGES_RUN_OPEN}:navigate`] = () => DONE;
    const result = await stage.run();
    expect(result).toMatchObject({
      verdict: "red",
      exit: 1,
      spawns: 0,
      why: "an engine answered and the witness was told of no child",
    });
    expect(stage.calls).toEqual([`${PAGES_RUN_OPEN}:navigate`, `${PAGES_RUN_OPEN}:close`, "stop"]);
    expect(result.legs).toMatchObject({
      open: "red",
      identity: "skipped",
      control: "skipped",
      latch: "skipped",
      stop: "ok",
      // no engine to judge is not "every engine was judged"
      engines: "blind",
    });
  });

  it("is RED when the run holds two living engines at the answer, and BLIND when the engine that answered has exited", async () => {
    const two = new Stage();
    two.on[`${PAGES_RUN_OPEN}:navigate`] = (stage) => {
      stage.spawn(PAGES_RUN_OPEN, { lines: [READY] });
      stage.spawn(PAGES_RUN_OPEN, { lines: [READY] });
      return DONE;
    };
    const both = await two.run();
    expect(both).toMatchObject({ verdict: "red", exit: 1, why: "the run holds two engines" });
    expect(both.legs).toMatchObject({ open: "red", identity: "skipped" });
    const gone = new Stage();
    gone.on[`${PAGES_RUN_OPEN}:navigate`] = (stage) => {
      stage.spawn(PAGES_RUN_OPEN, { lines: [READY], alive: false, rootLeft: false });
      return DONE;
    };
    const none = await gone.run();
    expect(none.legs).toMatchObject({ open: "blind", identity: "skipped" });
    expect(gone.line("SMOKE_PAGES_OPEN")).toMatchObject({
      why: "the engine that answered the open has exited",
    });
  });

  it("is RED on two living engines of the run WHATEVER the open came to: unanswered, refused or answered without success, the red is not hidden by the blind", async () => {
    const twice = (end: (stage: Stage) => unknown) => {
      const stage = new Stage();
      stage.on[`${PAGES_RUN_OPEN}:navigate`] = (at) => {
        at.spawn(PAGES_RUN_OPEN, { lines: [READY] });
        at.spawn(PAGES_RUN_OPEN, { lines: [READY] });
        return end(at);
      };
      return stage;
    };
    for (const end of [
      () => {
        throw thrown("UNAVAILABLE", "engine-refused");
      },
      () => ({ status: "refused", fact: "no-window" }),
      () => ({ status: "done", output: { success: false } }),
    ]) {
      const got = await twice(end).run();
      expect(got).toMatchObject({ verdict: "red", exit: 1, why: "the run holds two engines" });
      expect(got.legs.open).toBe("red");
    }
  });

  it("asks the stager's page for its count itself, and reads a response that broke, stalled or said no number as no count: BLIND, never an error nobody hears", async () => {
    type Res = EventEmitter & { setEncoding: () => void };
    const asking = (play: (res: Res, req: EventEmitter & { destroy: () => void }) => void) => {
      httpGet.mockImplementation((_url: string, _options: object, on: (res: Res) => void) => {
        const req = Object.assign(new EventEmitter(), {
          destroy: () => {
            req.emit("error", new Error("socket hang up"));
          },
        });
        const res = Object.assign(new EventEmitter(), { setEncoding: () => undefined });
        queueMicrotask(() => {
          on(res);
          play(res, req);
        });
        return req;
      });
      const stage = new Stage();
      stage.hitsGiven = false;
      return stage;
    };
    const counted = asking((res) => {
      res.emit("data", '{"hits":1}');
      res.emit("end");
    });
    expect((await counted.run()).legs.open).toBe("ok");
    expect(httpGet.mock.calls[0]?.[0]).toBe(FIXTURE.hits);
    expect(httpGet.mock.calls[0]?.[1]).toEqual({ timeout: 5000 });
    for (const play of [
      // began and then broke
      (res: Res) => {
        res.emit("data", '{"hi');
        res.emit("error", new Error("aborted"));
      },
      // began and stalled: the request's own bound ends it
      (_res: Res, req: EventEmitter) => {
        req.emit("timeout");
      },
      // ended with no number
      (res: Res) => {
        res.emit("data", '{"hits":"many"}');
        res.emit("end");
      },
      (res: Res) => {
        res.emit("data", "not json");
        res.emit("end");
      },
    ]) {
      httpGet.mockReset();
      const stage = asking(play);
      const got = await stage.run();
      expect(got.legs.open).toBe("blind");
      expect(stage.line("SMOKE_PAGES_OPEN")).toMatchObject({
        why: "the page's fetch count could not be read",
        hits: null,
      });
    }
  });

  it("is BLIND, never ok, when it is refused before any engine: no window, an address main does not open, an engine main has none of", async () => {
    for (const [kind, state] of [
      ["UNAVAILABLE", "no-window"],
      ["PRECONDITION_FAILED", "address"],
      ["UNAVAILABLE", "not-installed"],
      ["UNAVAILABLE", "engine-refused"],
    ] as const) {
      const stage = new Stage();
      stage.on[`${PAGES_RUN_OPEN}:navigate`] = () => {
        throw thrown(kind, state);
      };
      const result = await stage.run();
      expect(result, state).toMatchObject({ verdict: "blind", exit: 2 });
      expect(result.why, state).toContain(state);
      // one try: only a start that has not finished, or an answer that never came, is tried again
      expect(stage.calls.filter((c) => c === `${PAGES_RUN_OPEN}:navigate`)).toHaveLength(1);
      expect(stage.calls.at(-1)).toBe("stop");
    }
  });

  it("is tried again while the engine is starting or its answer never came, three times and no more, and inside its window", async () => {
    const twice = new Stage();
    let tries = 0;
    const first = twice.on[`${PAGES_RUN_OPEN}:navigate`];
    twice.on[`${PAGES_RUN_OPEN}:navigate`] = (stage) => {
      tries += 1;
      if (tries < 3) {
        stage.spawn(PAGES_RUN_OPEN, { alive: false, rootLeft: false, lines: [READY, CLOSE] });
        throw thrown("UNAVAILABLE", tries === 1 ? "engine-starting" : "no-answer");
      }
      return first?.(stage);
    };
    const result = await twice.run();
    expect(result).toMatchObject({ verdict: "ok", exit: 0, spawns: 4 });
    expect(twice.line("SMOKE_PAGES_OPEN")).toMatchObject({ verdict: "ok", tries: 3 });

    const never = new Stage();
    never.on[`${PAGES_RUN_OPEN}:navigate`] = () => {
      throw thrown("UNAVAILABLE", "engine-starting");
    };
    expect(await never.run()).toMatchObject({ verdict: "blind", exit: 2 });
    expect(never.calls.filter((c) => c === `${PAGES_RUN_OPEN}:navigate`)).toHaveLength(3);

    const slow = new Stage();
    slow.on[`${PAGES_RUN_OPEN}:navigate`] = (stage) => {
      stage.clock += 70_000;
      throw thrown("UNAVAILABLE", "engine-starting");
    };
    expect(await slow.run()).toMatchObject({ verdict: "blind", exit: 2 });
    // the second try ended past 120 s: there is no third
    expect(slow.calls.filter((c) => c === `${PAGES_RUN_OPEN}:navigate`)).toHaveLength(2);

    // an open that WAS answered, past the window: the tries left their bound, and that is blind
    const late = new Stage();
    const answer = late.on[`${PAGES_RUN_OPEN}:navigate`];
    late.on[`${PAGES_RUN_OPEN}:navigate`] = (stage) => {
      stage.clock += 130_000;
      return answer?.(stage);
    };
    const got = await late.run();
    expect(got.legs.open).toBe("blind");
    expect(late.line("SMOKE_PAGES_OPEN").why).toMatch(/window/u);
  });

  it("judges every engine the tries started: an earlier one's red is the run's, its blind is the run's blind, and only what a judge waived is said", async () => {
    let tries = 0;
    const retry = (stage: Stage, over: Partial<Script>) => {
      const first = stage.on[`${PAGES_RUN_OPEN}:navigate`];
      stage.on[`${PAGES_RUN_OPEN}:navigate`] = (played) => {
        tries += 1;
        if (tries === 1) {
          // never ready: main ended it for a slow start
          played.spawn(PAGES_RUN_OPEN, {
            alive: false,
            rootLeft: false,
            lines: [CLOSE],
            listeners: UNANSWERED_OK,
            ...over,
          });
          throw thrown("UNAVAILABLE", "engine-starting");
        }
        return first?.(played);
      };
      return stage;
    };
    const dirty = retry(new Stage(), {
      listeners: {
        ...listening("*:9222"),
        inside: 1,
        discarded: 0,
        unborne: 0,
        listeners: ["*:9222"],
      },
    });
    const result = await dirty.run();
    expect(result).toMatchObject({ verdict: "red", exit: 1 });
    expect(result.why).toContain("*:9222");
    expect(result.legs).toMatchObject({ open: "ok", engines: "red" });

    // what could not be seen of an earlier engine is the run's blind: it is never folded into ok
    for (const over of [
      {
        stream: {
          ...blind("the engine's folders went unread for 1300 ms of its life"),
          polls: 4,
          holes: 9,
          maxGapMs: 1300,
          lifeMs: 2000,
          plantSeen: false,
          socketSeen: false,
        },
      },
      { identity: blind("the spawned file could not be read as a file") },
      { pidFile: blind("the engine's pid file names another process than the child main spawned") },
      {
        listeners: {
          ...blind("no read of the engine's sockets fell wholly inside its life"),
          inside: 0,
          discarded: 1,
          unborne: 0,
          listeners: [],
        },
      },
    ] as Partial<Script>[]) {
      tries = 0;
      const unseen = retry(new Stage(), over);
      const got = await unseen.run();
      expect(got, JSON.stringify(over)).toMatchObject({ verdict: "blind", exit: 2 });
      expect(got.legs).toMatchObject({ open: "ok", engines: "blind" });
    }
    // a file that is not the stager's copy is red on an earlier engine as on the one that served
    tries = 0;
    const elsewhere = retry(new Stage(), { fileIs: false });
    expect(await elsewhere.run()).toMatchObject({
      verdict: "red",
      why: "the spawned file is not the stager's copy",
    });

    // the two things a judge waives for an engine that never answered are said in the line, not judged
    tries = 0;
    const waived = retry(new Stage(), {
      stream: {
        verdict: "ok",
        said: ["the engine never answered main and its socket was never seen"],
        polls: 4,
        holes: 0,
        maxGapMs: 100,
        lifeMs: 400,
        plantSeen: false,
        socketSeen: false,
      },
    });
    expect(await waived.run()).toMatchObject({ verdict: "ok", exit: 0, spawns: 3 });
    // each waiver in its own words, by the engine's class: the one that never answered, then the
    // refused one's named waiver
    const line = waived.line("SMOKE_PAGES_ENGINES");
    expect(line.said).toEqual([
      "the engine never answered main and its socket was never seen",
      NEVER,
      TIED,
    ]);
    expect(line.engines).toMatchObject([
      { answer: "none", leased: false, reads: 2, unborne: 0, tailMs: null },
      { answer: "ready", leased: true },
      { answer: "refused", leased: false },
    ]);
  });

  it("counts an earlier engine main had leased by the bridge like the one that served: ready is no waiver", async () => {
    const stage = new Stage();
    let tries = 0;
    const first = stage.on[`${PAGES_RUN_OPEN}:navigate`];
    stage.on[`${PAGES_RUN_OPEN}:navigate`] = (played) => {
      tries += 1;
      if (tries === 1) {
        played.spawn(PAGES_RUN_OPEN, {
          alive: false,
          rootLeft: false,
          lines: [READY, CLOSE],
          tcp: {
            ...blind("fewer than three reads inside the engine's life showed its own connection"),
            counted: 0,
            bare: 4,
            discarded: 0,
            maxGapMs: 0,
            headMs: null,
            tailMs: null,
            listeners: [],
          },
        });
        throw thrown("UNAVAILABLE", "no-answer");
      }
      return first?.(played);
    };
    const got = await stage.run();
    expect(got).toMatchObject({ verdict: "blind", exit: 2 });
    expect(got.legs.engines).toBe("blind");
    expect(stage.engines[0]?.s.asked.tcp).toEqual([BRIDGE]);
    expect(stage.engines[0]?.s.asked.listeners).toBe(0);
  });

  it("is BLIND when the page was never fetched, the count cannot be read, or the engine answered without success", async () => {
    const unfetched = new Stage();
    unfetched.hits = 0;
    expect(await unfetched.run()).toMatchObject({ verdict: "blind", exit: 2 });
    const unread = new Stage();
    unread.hits = null;
    expect(await unread.run()).toMatchObject({ verdict: "blind", exit: 2 });
    const failed = new Stage();
    failed.on[`${PAGES_RUN_OPEN}:navigate`] = (stage) => {
      stage.spawn(PAGES_RUN_OPEN, { lines: [READY] });
      return { status: "done", output: { success: false, error: "net::ERR_FAILED" } };
    };
    const result = await failed.run();
    expect(result).toMatchObject({ verdict: "blind", exit: 2 });
    expect(failed.calls.at(-1)).toBe("stop");
  });
});

describe("what is read of the engine that served the open", () => {
  it("is RED on a file that is not the stager's copy or not the recorded build, and BLIND on a ready line of another identity or none", async () => {
    const elsewhere = new Stage();
    elsewhere.on[`${PAGES_RUN_OPEN}:navigate`] = (stage) => {
      stage.spawn(PAGES_RUN_OPEN, { lines: [READY], fileIs: false });
      return DONE;
    };
    expect(await elsewhere.run()).toMatchObject({
      verdict: "red",
      why: "the spawned file is not the stager's copy",
    });
    const other = new Stage();
    other.on[`${PAGES_RUN_OPEN}:navigate`] = (stage) => {
      stage.spawn(PAGES_RUN_OPEN, {
        lines: [READY],
        identity: red("the spawned file is not the recorded source build"),
      });
      return DONE;
    };
    expect(await other.run()).toMatchObject({ verdict: "red", exit: 1 });
    const packaged = new Stage();
    packaged.on[`${PAGES_RUN_OPEN}:navigate`] = (stage) => {
      stage.spawn(PAGES_RUN_OPEN, { lines: [{ ...READY, identity: "packaged-team" }] });
      return DONE;
    };
    expect(await packaged.run()).toMatchObject({ verdict: "blind", exit: 2 });
    const unsaid = new Stage();
    unsaid.on[`${PAGES_RUN_OPEN}:navigate`] = (stage) => {
      stage.spawn(PAGES_RUN_OPEN, { lines: [] });
      return DONE;
    };
    expect(await unsaid.run()).toMatchObject({ verdict: "blind", exit: 2 });
  });

  it("is BLIND when main's bridge does not show as a new listener, and RED on a listener of the engine's whatever else is blind", async () => {
    const noBridge = new Stage();
    noBridge.listeners = [{ seen: "read", lines: [] }];
    const got = await noBridge.run();
    expect(got).toMatchObject({ verdict: "blind", exit: 2 });
    expect(got.legs.tcp).toBe("blind");
    // and the leg says WHY in main's control's own words, which name what was read: the engine's
    // judge can only say that it was handed no bridge
    expect(noBridge.line("SMOKE_PAGES_TCP")).toMatchObject({
      verdict: "blind",
      why: "main's bridge did not show as a new loopback listener: the read sees no listener",
      bridge: null,
    });
    const twoNew = new Stage();
    twoNew.listeners = [
      { seen: "read", lines: [] },
      {
        seen: "read",
        lines: [
          { name: BRIDGE, state: "listen" },
          { name: "127.0.0.1:5556", state: "listen" },
        ],
      },
    ];
    await twoNew.run();
    expect(twoNew.line("SMOKE_PAGES_TCP")).toMatchObject({
      verdict: "blind",
      why: "more than one new loopback listener showed in main: the bridge cannot be told",
    });
    // and the last leg, which judges the same engine over its whole life, has no bridge to count by either
    expect(got.legs.engines).toBe("blind");
    expect(noBridge.engines[0]?.s.asked.tcp.every((bridge) => bridge === null)).toBe(true);
    const listening = new Stage();
    listening.peer = { ...listening.peer, ...blind("the probe never reached the engine's socket") };
    listening.on[`${PAGES_RUN_OPEN}:navigate`] = (stage) => {
      stage.spawn(PAGES_RUN_OPEN, {
        lines: [READY],
        tcp: {
          ...TCP_OK,
          ...red("the engine holds a TCP listener: *:9222"),
          listeners: ["*:9222"],
        },
      });
      return DONE;
    };
    const result = await listening.run();
    expect(result).toMatchObject({ verdict: "red", exit: 1 });
    expect(result.legs).toMatchObject({ peer: "blind", tcp: "red" });
  });

  it("is RED on a listener of the serving engine's though main's bridge did not show: a red of the engine's outranks main's blind control, in the TCP leg and in the last", async () => {
    const stage = new Stage();
    // main's own two reads show no new listener: the control is blind, and names no bridge
    stage.listeners = [{ seen: "read", lines: [] }];
    stage.on[`${PAGES_RUN_OPEN}:navigate`] = (st) => {
      st.spawn(PAGES_RUN_OPEN, {
        lines: [READY],
        tcp: {
          ...TCP_OK,
          ...red("the engine holds a TCP listener: *:9222"),
          listeners: ["*:9222"],
        },
      });
      return DONE;
    };
    const got = await stage.run();
    expect(got).toMatchObject({ verdict: "red", exit: 1 });
    expect(got.legs).toMatchObject({ tcp: "red", engines: "red" });
    expect(stage.line("SMOKE_PAGES_TCP")).toMatchObject({
      verdict: "red",
      why: "the engine holds a TCP listener: *:9222",
      bridge: null,
    });
    // the engine's own judge was asked in both legs, with the bridge main did not show
    expect(stage.engines[0]?.s.asked.tcp.length).toBeGreaterThanOrEqual(2);
    expect(stage.engines[0]?.s.asked.tcp.every((bridge) => bridge === null)).toBe(true);
  });

  it("is RED on a UDP socket with no peer, and BLIND when the engine's pid file names another process", async () => {
    const udp = new Stage();
    udp.on[`${PAGES_RUN_OPEN}:navigate`] = (stage) => {
      stage.spawn(PAGES_RUN_OPEN, {
        lines: [READY],
        udp: red("the engine holds a UDP socket with no peer: *:5353"),
      });
      return DONE;
    };
    const bound = await udp.run();
    expect(bound).toMatchObject({ verdict: "red", exit: 1 });
    expect(bound.legs.tcp).toBe("red");
    expect(bound.why).toContain("*:5353");
    const other = new Stage();
    other.on[`${PAGES_RUN_OPEN}:navigate`] = (stage) => {
      stage.spawn(PAGES_RUN_OPEN, {
        lines: [READY],
        pidFile: blind("the engine's pid file names another process than the child main spawned"),
      });
      return DONE;
    };
    const got = await other.run();
    expect(got).toMatchObject({ verdict: "blind", exit: 2 });
    expect(got.legs.engines).toBe("blind");
  });

  it("is RED on a process beneath the engine or an answered foreign peer, and BLIND when the engine that answers says it holds no browser", async () => {
    const beneath = new Stage();
    beneath.on[`${PAGES_RUN_OPEN}:navigate`] = (stage) => {
      stage.spawn(PAGES_RUN_OPEN, {
        lines: [READY],
        census: red("the engine has a process beneath it: Google Chrome"),
      });
      return DONE;
    };
    expect(await beneath.run()).toMatchObject({ verdict: "red", exit: 1 });
    const answered = new Stage();
    answered.peer = {
      ...answered.peer,
      ...red("the engine answered a process that is not main"),
    };
    expect(await answered.run()).toMatchObject({
      verdict: "red",
      why: "the engine answered a process that is not main",
    });
    const bare = new Stage();
    bare.own = { exchange: "answered", pid: "match", browser: false };
    expect((await bare.run()).legs.peer).toBe("blind");
    const unreadable = new Stage();
    unreadable.census = () => {
      throw new Error("ps did not run");
    };
    expect((await unreadable.run()).legs.census).toBe("blind");
  });
});

describe("the pages' surfaces (item 658, 2026-11-26)", () => {
  it("are never closed by the rows: that is the exit's, after the verdict is said, and the stop leg reads what the product's own stop left", async () => {
    const stage = new Stage();
    const got = await stage.run();
    expect(got).toMatchObject({ verdict: "ok", exit: 0 });
    expect(stage.calls).toContain("stop");
    expect(stage.calls).not.toContain("closeSurfaces");
  });
});

describe("the close", () => {
  it("is RED when the engine's exit came without main's close line, when the close left it running, and when its root was left", async () => {
    const byItself = new Stage();
    byItself.on[`${PAGES_RUN_OPEN}:close`] = (stage) => {
      for (const e of stage.engines) {
        e.s.alive = false;
        e.s.rootLeft = false;
      }
      return DONE;
    };
    const result = await byItself.run();
    expect(result).toMatchObject({ verdict: "red", exit: 1 });
    expect(result.legs.close).toBe("red");

    const running = new Stage();
    running.on[`${PAGES_RUN_OPEN}:close`] = () => DONE;
    const left = await running.run();
    expect(left.legs).toMatchObject({ close: "red", control: "skipped", latch: "skipped" });
    // waited its ten seconds for the exit, then went on to the product's stop
    expect(running.clock).toBeGreaterThanOrEqual(10_000);
    expect(running.calls.at(-1)).toBe("stop");

    const rooted = new Stage();
    rooted.on[`${PAGES_RUN_OPEN}:close`] = (stage) => {
      for (const e of stage.engines) {
        e.s.lines.push(CLOSE);
        e.s.alive = false;
      }
      return DONE;
    };
    expect((await rooted.run()).legs.close).toBe("red");
  });

  it("tests its three reds before its one blind: a close that THREW is red when the engine was left running, left without main's close line, or left its root, and blind only when nothing read is wrong", async () => {
    const closeThrew = (ends: (stage: Stage) => void) => {
      const stage = new Stage();
      stage.on[`${PAGES_RUN_OPEN}:close`] = (st) => {
        ends(st);
        throw thrown("TIMEOUT", "deadline");
      };
      return stage;
    };
    // left running: the wait for its exit ran out
    const running = closeThrew(() => undefined);
    const left = await running.run();
    expect(left.legs.close).toBe("red");
    expect(running.line("SMOKE_PAGES_CLOSE")).toMatchObject({
      verdict: "red",
      why: "the run's close left its engine running",
    });
    // gone by itself: no close line of main's
    const byItself = closeThrew((st) => {
      for (const e of st.engines) {
        e.s.alive = false;
        e.s.rootLeft = false;
      }
    });
    await byItself.run();
    expect(byItself.line("SMOKE_PAGES_CLOSE")).toMatchObject({
      verdict: "red",
      why: "the engine's exit came without main's close line",
    });
    // ended by main's ladder, and its root left
    const rooted = closeThrew((st) => {
      for (const e of st.engines) {
        e.s.lines.push(CLOSE);
        e.s.alive = false;
      }
    });
    await rooted.run();
    expect(rooted.line("SMOKE_PAGES_CLOSE")).toMatchObject({
      verdict: "red",
      why: "the engine's root was left after its exit",
    });
    // nothing read is wrong, and the call was not answered: that alone is blind
    const clean = closeThrew((st) => st.end(PAGES_RUN_OPEN));
    const got = await clean.run();
    expect(got.legs.close).toBe("blind");
    expect(clean.line("SMOKE_PAGES_CLOSE")).toMatchObject({
      verdict: "blind",
      why: "the run's close was not answered: deadline",
    });
  });
});

describe("the control and the latch", () => {
  const planted = (over: Partial<Script>, answer: "refused" | "done") => (stage: Stage) => {
    const was = stage.plants.delete(PAGES_RUN_PLANT);
    stage.spawn(PAGES_RUN_PLANT, {
      planted: was,
      alive: false,
      rootLeft: false,
      lines: [STREAM_ON],
      plantAtAnswer: was,
      stream: { ...STREAM_OK, polls: 3, lifeMs: 300, plantSeen: was },
      ...over,
    });
    if (answer === "done") return DONE;
    throw thrown("UNAVAILABLE", "engine-refused");
  };

  it("asks the witness for the plant before the control's call", async () => {
    const stage = new Stage();
    const order: string[] = [];
    const door = stage.door();
    const witness = door.witness;
    await runPagesRows({
      door: {
        witness: {
          ...witness,
          plantFor: (run) => {
            order.push(`plant:${run}`);
            witness.plantFor(run);
          },
        },
        control: async (p, ctx) => {
          order.push(`${p.run}:${p.command.action}`);
          return door.control(p, ctx);
        },
        stop: door.stop,
        closeSurfaces: door.closeSurfaces,
      },
      fixture: FIXTURE,
      mainPid: 4242,
      say: () => undefined,
      listeners: async () => ({ seen: "read", lines: [] }),
      census: () => [],
      hits: async () => 1,
      now: () => stage.clock,
      sleep: async (ms) => {
        stage.clock += ms;
      },
    });
    expect(order.indexOf(`plant:${PAGES_RUN_PLANT}`)).toBeGreaterThan(
      order.indexOf(`${PAGES_RUN_OPEN}:close`),
    );
    expect(order.indexOf(`plant:${PAGES_RUN_PLANT}`)).toBe(
      order.indexOf(`${PAGES_RUN_PLANT}:navigate`) - 1,
    );
  });

  it("is BLIND when the control proved nothing: refused for another reason, refused before any engine, a plant not there at the refusal or never seen by the poll", async () => {
    for (const [name, handler] of [
      [
        "another reason",
        planted({ lines: [{ ...STREAM_ON, reason: "stream-unread" }] }, "refused"),
      ],
      ["not there at the refusal", planted({ plantAtAnswer: false }, "refused")],
      [
        "never seen by the poll",
        planted(
          {
            stream: {
              ...STREAM_OK,
              ...blind("the planted file was never seen: the poll does not read where main reads"),
              polls: 3,
              plantSeen: false,
            },
          },
          "refused",
        ),
      ],
      // a file of the plant's name was there already: the control's own file was never written
      ["a plant that could not be written", planted({ plantFailed: "EEXIST" }, "refused")],
      [
        "before any engine",
        () => {
          throw thrown("UNAVAILABLE", "engine-refused");
        },
      ],
      [
        "a start that did not finish",
        () => {
          throw thrown("UNAVAILABLE", "engine-starting");
        },
      ],
    ] as const) {
      const stage = new Stage();
      stage.on[`${PAGES_RUN_PLANT}:navigate`] = handler;
      const result = await stage.run();
      expect(result.legs.control, name).toBe("blind");
      expect(result, name).toMatchObject({ verdict: "blind", exit: 2 });
      // the latch is asked only after a control that was ok: after any other it would say nothing
      expect(result.legs.latch, name).toBe("skipped");
      expect(stage.calls, name).not.toContain(`${PAGES_RUN_LATCH}:navigate`);
    }
  });

  it("is RED when main answered an engine whose folder held the planted file at its answer, and BLIND when it answered one with no plant seen", async () => {
    const started = new Stage();
    started.on[`${PAGES_RUN_PLANT}:navigate`] = planted({ lines: [READY], alive: true }, "done");
    const result = await started.run();
    expect(result).toMatchObject({ verdict: "red", exit: 1 });
    expect(result.legs.control).toBe("red");
    const unplanted = new Stage();
    unplanted.on[`${PAGES_RUN_PLANT}:navigate`] = planted(
      { lines: [READY], plantAtAnswer: false },
      "done",
    );
    expect((await unplanted.run()).legs.control).toBe("blind");
  });

  it("is RED when main answered an engine whose folder held a file of the plant's name though the witness could not write its own: the red is not hidden by the blind", async () => {
    // a `control.stream` was there already (the witness's write failed, EEXIST), main's check let
    // the engine through, and the witness saw the file in the folder at the answer
    const answered = new Stage();
    answered.on[`${PAGES_RUN_PLANT}:navigate`] = planted(
      { lines: [READY], alive: true, plantFailed: "EEXIST", plantAtAnswer: true },
      "done",
    );
    const result = await answered.run();
    expect(result).toMatchObject({ verdict: "red", exit: 1 });
    expect(result.legs.control).toBe("red");
    expect(answered.line("SMOKE_PAGES_CONTROL")).toMatchObject({
      why: "main started an engine whose folder held a stream file",
    });
    // refused as it should be, the control is still blind: it was not the witness's file that was refused
    const refused = new Stage();
    refused.on[`${PAGES_RUN_PLANT}:navigate`] = planted(
      { plantFailed: "EEXIST", plantAtAnswer: true },
      "refused",
    );
    const got = await refused.run();
    expect(got.legs.control).toBe("blind");
    expect(refused.line("SMOKE_PAGES_CONTROL")).toMatchObject({
      why: "the control's file could not be planted (EEXIST)",
    });
  });

  it("is RED on a stream file that is not the plant whatever else of the control is blind: the folder judge's red is tested before the leg's blinds", async () => {
    const streaming = {
      ...STREAM_OK,
      ...red("the engine's folder held a stream file: sock/9223.stream"),
      polls: 3,
    };
    for (const [name, handler] of [
      // the witness could not write its own file, and the folder shows a stream file
      [
        "a plant that could not be written",
        planted({ plantFailed: "EEXIST", stream: streaming }, "refused"),
      ],
      [
        "refused for another reason",
        planted(
          { lines: [{ ...STREAM_ON, reason: "stream-unread" }], stream: streaming },
          "refused",
        ),
      ],
      [
        "a plant not there at the refusal",
        planted({ plantAtAnswer: false, stream: streaming }, "refused"),
      ],
      // answered, with no plant seen at the answer: the control proved nothing, and the folder is still read
      [
        "answered with no plant seen",
        planted({ lines: [READY], plantAtAnswer: false, stream: streaming }, "done"),
      ],
    ] as const) {
      const stage = new Stage();
      stage.on[`${PAGES_RUN_PLANT}:navigate`] = handler;
      const result = await stage.run();
      expect(result.legs.control, name).toBe("red");
      expect(stage.line("SMOKE_PAGES_CONTROL"), name).toMatchObject({
        verdict: "red",
        why: "the engine's folder held a stream file: sock/9223.stream",
      });
      expect(result, name).toMatchObject({ verdict: "red", exit: 1 });
    }
  });

  it("is RED when the refused engine was left running, or showed a stream file that is not the plant", async () => {
    const running = new Stage();
    running.on[`${PAGES_RUN_PLANT}:navigate`] = planted({ alive: true }, "refused");
    running.onStop = (stage) => {
      stage.said.push({ event: "pages.broker.stop", reason: null });
    };
    const result = await running.run();
    expect(result.legs.control).toBe("red");
    expect(result.legs.stop).toBe("red");
    // and it is red whatever else of the control is blind: refused for another reason, its plant
    // not there at the refusal, its plant never written
    for (const over of [
      { lines: [{ event: "pages.engine.refused", reason: "stream-unread", identity: null }] },
      { plantAtAnswer: false },
      { plantFailed: "EEXIST" },
      // no refusal line of main's laid to it: the call's own word that the engine was refused is enough
      { lines: [] },
    ] as Partial<Script>[]) {
      const left = new Stage();
      left.on[`${PAGES_RUN_PLANT}:navigate`] = planted({ alive: true, ...over }, "refused");
      left.onStop = (stage) => {
        stage.said.push({ event: "pages.broker.stop", reason: null });
      };
      await left.run();
      expect(left.line("SMOKE_PAGES_CONTROL"), JSON.stringify(over)).toMatchObject({
        verdict: "red",
        why: "the refused engine was left running",
      });
    }
    // MAIN'S OWN REFUSAL LINE is main's word that it refused the engine (item 658, 2026-11-27): left
    // running, that engine is red whatever the CALL came to, and whatever the line's reason. Keyed
    // on the call's state alone, a call that ended as anything but an engine refused read blind
    // ("refused as deadline, not by the stream check"). Read in main today, the one such ending is
    // its logger failing on the refusal line (the call is rejected with that error once the ladder
    // has run); the stand-in's timeout stands for any of them.
    const timedOut = (lines: Script["lines"]) => (stage: Stage) => {
      const was = stage.plants.delete(PAGES_RUN_PLANT);
      stage.spawn(PAGES_RUN_PLANT, {
        planted: was,
        alive: true,
        rootLeft: false,
        lines,
        plantAtAnswer: was,
        stream: { ...STREAM_OK, polls: 3, lifeMs: 300, plantSeen: was },
      });
      throw thrown("TIMEOUT", "deadline");
    };
    const leftAlive = (stage: Stage) => {
      stage.said.push({ event: "pages.broker.stop", reason: null });
    };
    const timed = new Stage();
    timed.on[`${PAGES_RUN_PLANT}:navigate`] = timedOut([STREAM_ON]);
    timed.onStop = leftAlive;
    expect(await timed.run()).toMatchObject({ verdict: "red", exit: 1 });
    expect(timed.line("SMOKE_PAGES_CONTROL")).toMatchObject({
      verdict: "red",
      why: "the refused engine was left running",
    });
    // a red path of the rows closes the pages' surfaces no more than the ok one does
    expect(timed.calls).not.toContain("closeSurfaces");
    // ANY refusal line of main's: an unread folder's as much as a stream's
    const unread = new Stage();
    unread.on[`${PAGES_RUN_PLANT}:navigate`] = timedOut([
      { ...STREAM_ON, reason: "stream-unread" },
    ]);
    unread.onStop = leftAlive;
    await unread.run();
    expect(unread.line("SMOKE_PAGES_CONTROL")).toMatchObject({
      verdict: "red",
      why: "the refused engine was left running",
    });
    // an engine main said NO refusal of, alive when the call timed out: main refused nothing, and
    // the control is blind by the call's own word
    const unsaid = new Stage();
    unsaid.on[`${PAGES_RUN_PLANT}:navigate`] = timedOut([]);
    unsaid.onStop = leftAlive;
    await unsaid.run();
    expect(unsaid.line("SMOKE_PAGES_CONTROL")).toMatchObject({
      verdict: "blind",
      why: "the control was refused as deadline, not by the stream check",
    });
    const second = new Stage();
    second.on[`${PAGES_RUN_PLANT}:navigate`] = planted(
      {
        stream: {
          ...STREAM_OK,
          ...red("a stream file showed in the engine's folders: sock/x.stream"),
          polls: 3,
          plantSeen: true,
        },
      },
      "refused",
    );
    expect(await second.run()).toMatchObject({ verdict: "red", exit: 1 });
  });

  it("is RED on a listener the planted engine held, and on one held by an engine the control started beside it", async () => {
    const held = new Stage();
    held.on[`${PAGES_RUN_PLANT}:navigate`] = planted(
      {
        listeners: {
          ...listening("*:9222"),
          inside: 1,
          discarded: 0,
          unborne: 0,
          listeners: ["*:9222"],
        },
      },
      "refused",
    );
    const got = await held.run();
    expect(got).toMatchObject({ verdict: "red", exit: 1 });
    expect(got.legs).toMatchObject({ control: "ok", engines: "red" });
    expect(got.why).toContain("*:9222");

    const beside = new Stage();
    const plant = planted({}, "refused");
    beside.on[`${PAGES_RUN_PLANT}:navigate`] = (stage) => {
      // an engine that is not the planted one, started by the same call
      stage.spawn(PAGES_RUN_PLANT, {
        alive: false,
        rootLeft: false,
        lines: [CLOSE],
        listeners: {
          ...listening("*:9333"),
          inside: 1,
          discarded: 0,
          unborne: 0,
          listeners: ["*:9333"],
        },
      });
      return plant(stage);
    };
    const stray = await beside.run();
    expect(stray).toMatchObject({ verdict: "red", exit: 1 });
    expect(stray.why).toContain("*:9333");
  });

  it("the latch is RED when an engine is started after the refusal or the call is answered, and BLIND when it is refused as anything else", async () => {
    const spawned = new Stage();
    spawned.on[`${PAGES_RUN_LATCH}:navigate`] = (stage) => {
      stage.spawn(PAGES_RUN_LATCH, { alive: false, rootLeft: false, lines: [STREAM_ON] });
      throw thrown("UNAVAILABLE", "engine-refused");
    };
    const started = await spawned.run();
    expect(started).toMatchObject({
      verdict: "red",
      exit: 1,
      why: "an engine was started after a stream that was on",
    });
    expect(started.legs.latch).toBe("red");
    // and that engine is judged like every other
    expect(spawned.line("SMOKE_PAGES_ENGINES").engines).toHaveLength(3);
    const answered = new Stage();
    answered.on[`${PAGES_RUN_LATCH}:navigate`] = () => DONE;
    expect(await answered.run()).toMatchObject({
      verdict: "red",
      why: "the call after the refusal was answered",
    });
    const other = new Stage();
    other.on[`${PAGES_RUN_LATCH}:navigate`] = () => {
      throw thrown("UNAVAILABLE", "engine-stopped");
    };
    const got = await other.run();
    expect(got).toMatchObject({ verdict: "blind", exit: 2 });
    expect(got.legs.latch).toBe("blind");
  });
});

describe("the product's own stop", () => {
  it("is RED when it leaves an engine to the smoke's teardown: a hooked child alive, an engine in the census, or main's own count of the unended", async () => {
    const why = "the product left its engine to the smoke's teardown";
    const alive = new Stage();
    alive.on[`${PAGES_RUN_OPEN}:close`] = () => DONE;
    alive.onStop = (stage) => {
      stage.said.push({ event: "pages.broker.stop", reason: null });
    };
    const first = await alive.run();
    expect(first.legs.stop).toBe("red");
    expect(JSON.stringify(alive.line("SMOKE_PAGES_STOP"))).toContain(why);

    const counted = new Stage();
    counted.census = () => [{ pid: 7, ppid: 1, name: "agent-browser" }];
    expect((await counted.run()).legs.stop).toBe("red");

    const unended = new Stage();
    const stop = unended.onStop;
    unended.onStop = (stage) => {
      stop(stage);
      stage.said.push({ event: "pages.engine.unended", reason: null });
    };
    expect((await unended.run()).legs.stop).toBe("red");
  });

  it("is RED when an engine's root is left after the stop, and an engine still living when it is judged is BLIND", async () => {
    const rooted = new Stage();
    const stop = rooted.onStop;
    rooted.onStop = (stage) => {
      stop(stage);
      const last = stage.engines.at(-1);
      if (last !== undefined) last.s.rootLeft = true;
    };
    const got = await rooted.run();
    expect(got.legs.stop).toBe("red");
    expect(rooted.line("SMOKE_PAGES_STOP")).toMatchObject({
      why: "an engine's root was left after the product's stop",
      rootsLeft: 1,
    });
    const alive = new Stage();
    alive.on[`${PAGES_RUN_OPEN}:close`] = () => DONE;
    alive.onStop = (stage) => {
      stage.said.push({ event: "pages.broker.stop", reason: null });
    };
    // its life is not over: its folders and sockets cannot be judged whole
    expect((await alive.run()).legs).toMatchObject({ stop: "red", engines: "blind" });
  });

  it("is BLIND when the run's processes cannot be read at the stop", async () => {
    const stage = new Stage();
    let reads = 0;
    stage.census = () => {
      reads += 1;
      if (reads > 1) throw new Error("ps did not run");
      return [
        { pid: 4242, ppid: 1, name: "electron" },
        { pid: 9000, ppid: 4242, name: "agent-browser" },
      ];
    };
    const got = await stage.run();
    expect(got.legs).toMatchObject({ census: "ok", stop: "blind" });
    expect(stage.line("SMOKE_PAGES_STOP")).toMatchObject({
      why: "the run's census could not be read",
      censusEngines: null,
    });
  });

  it("is BLIND when main said no stop line or the stop threw, and is always asked for", async () => {
    const silent = new Stage();
    silent.onStop = (stage) => {
      for (const e of stage.engines) stage.end(e.run);
    };
    expect((await silent.run()).legs.stop).toBe("blind");
    const threw = new Stage();
    threw.onStop = () => {
      throw new Error("stop failed");
    };
    const result = await threw.run();
    expect(result.legs.stop).toBe("blind");
    expect(threw.calls.at(-1)).toBe("stop");
  });
});

describe("the run's one verdict", () => {
  const all = (verdict: "ok" | "red" | "blind" | "skipped") => ({
    open: verdict,
    identity: verdict,
    census: verdict,
    peer: verdict,
    tcp: verdict,
    close: verdict,
    control: verdict,
    latch: verdict,
    stop: verdict,
    engines: verdict,
  });

  it("is ok only when every leg is: a leg that was not run is blind, and says which", () => {
    expect(pagesVerdict(all("ok"), {})).toEqual({ verdict: "ok", exit: 0 });
    expect(pagesVerdict({ ...all("ok"), latch: "skipped" }, {})).toEqual({
      verdict: "blind",
      why: "the latch leg was not run",
      exit: 2,
    });
    expect(pagesVerdict(all("skipped"), {})).toMatchObject({ verdict: "blind", exit: 2 });
  });

  it("is red on one red leg whatever is blind or not run before it, and speaks the first of the worst kind", () => {
    expect(
      pagesVerdict(
        { ...all("ok"), open: "blind", identity: "skipped", stop: "red", engines: "red" },
        { open: "no open was answered", engines: "a stream file showed", stop: "left" },
      ),
    ).toEqual({ verdict: "red", why: "left", exit: 1 });
    expect(
      pagesVerdict(
        { ...all("ok"), census: "skipped", peer: "blind" },
        { peer: "the probe could not be run" },
      ),
    ).toEqual({ verdict: "blind", why: "the probe could not be run", exit: 2 });
  });
});

describe("the fixture the stager hands the run", () => {
  it("is read from VF_PAGES_FIXTURE, and anything else is a problem said", () => {
    expect(PAGES_FIXTURE_ENV).toBe("VF_PAGES_FIXTURE");
    expect(pagesFixture({ [PAGES_FIXTURE_ENV]: JSON.stringify(FIXTURE) })).toEqual({
      fixture: FIXTURE,
    });
    for (const value of [
      undefined,
      "",
      "{",
      JSON.stringify({ ...FIXTURE, url: "https://example.com/" }),
      JSON.stringify({ ...FIXTURE, url: "http://127.0.0.1:1/x/", hits: "http://10.0.0.1/hits" }),
      JSON.stringify({ ...FIXTURE, engineIs: "abc" }),
      // a path is never handed to the run: main's children inherit its environment
      JSON.stringify({
        ...FIXTURE,
        engineIs: "/stage/pages-engine/f3a53cbc00000000/agent-browser",
      }),
      JSON.stringify({ url: FIXTURE.url, hits: FIXTURE.hits }),
    ]) {
      const got = pagesFixture(value === undefined ? {} : { [PAGES_FIXTURE_ENV]: value });
      expect("problem" in got, String(value)).toBe(true);
    }
  });
});

describe("smoke:pages's row (held in the sources)", () => {
  const root = new URL("../../../", import.meta.url);
  const read = (path: string): string => readFileSync(new URL(path, root), "utf8");
  const COMMAND =
    /^node packaging\/stage-pages-engine\.mjs -- node packaging\/run-smoke\.mjs --smoke-canvas --pages --disable-gpu$/u;

  it("is a script at both roots: the stager, then the canvas smoke with the flag, GPU-less, on the canvas smoke's build", () => {
    const desktop = JSON.parse(read("apps/desktop/package.json")) as {
      scripts: Record<string, string>;
    };
    expect(desktop.scripts["smoke:pages"]).toMatch(COMMAND);
    const rootScripts = (JSON.parse(read("package.json")) as { scripts: Record<string, string> })
      .scripts;
    expect(rootScripts["smoke:pages"]).toBe("pnpm --filter @vibefield/desktop smoke:pages");
  });

  it("is in the landing gate after the GPU-less canvas rows, and its verdict lines are quoted", () => {
    const gate = read("scripts/gate-landing.mjs");
    const at = gate.indexOf('{ name: "smoke:pages", run: pnpm("smoke:pages") }');
    expect(at).toBeGreaterThan(gate.indexOf('{ name: "smoke:canvas:no-webgpu"'));
    expect(at).toBeLessThan(gate.indexOf('{ name: "smoke:kind-faults"'));
    // the verdict (or the last leg said, when the rows were cut short) and never the exit's line of
    // counts, which is said after it (2026-11-27; the gate's own row holds what each quotes); an
    // exit that was held is quoted beside it
    expect(gate).toContain("/^SMOKE_PAGES(?:_(?!EXIT)\\w+)? (?!failed:).*$/u");
    expect(gate).toContain("/^SMOKE_PAGES_EXIT_HELD .*$/u");
    expect(gate).not.toContain("/^SMOKE_PAGES(?:_\\w+)? .*$/u");
    expect(gate).toContain("/^PAGES_ENGINE_STAGE(?:_DONE)? .*$/u");
  });

  it("is row 41 of the desk gates, and the order paragraph names it", () => {
    const gates = read("docs/desk-gates.md");
    expect(gates).toMatch(/^\| 41 \| smoke:pages \| `pnpm smoke:pages`/mu);
    expect(gates).toMatch(/`pnpm gate:landing` is rows 15–19, then 41, then 20–23,/u);
  });

  it("main makes the witness only unpackaged, in the canvas smoke, when asked, and hands the smoke its ONE pages plane", () => {
    const index = read("packages/electron-shell/src/main/index.ts");
    expect(index).toMatch(
      /const pagesWitness =\s+!app\.isPackaged && MODE === "smoke-canvas" && pagesWitnessAsked\(process\.env, process\.argv\)\s+\? \(await testing\(\)\)\.createPagesEngineWitness\(/u,
    );
    const start = index.indexOf("(await testing()).runSmokeCanvas({");
    const handed = index.slice(start, index.indexOf("onWindow:", start));
    expect(handed).toContain("...(pagesWitness === null");
    expect(handed).toContain("witness: pagesWitness");
    expect(handed).toMatch(/control: async \(p, ctx\) => \{\s+const plane = pagesPlane;/u);
    // one composition: the smoke drives the plane the shell provider's controlSurface reaches
    expect(index.match(/composePages\(\{/gu)).toHaveLength(1);
    // and main's pages lines reach the witness as main says them
    expect(index.match(/pagesWitness\?\.line\(event, fields\)/gu)).toHaveLength(2);
  });

  it("the read that makes main stand still is the witness's alone: only the witness and the socket reader name it, the witness takes it in one place, and main reaches the witness only where there may be none", () => {
    // Without the smoke's own flag main makes no witness (the row above), so its refusal line is
    // its logger's alone: nothing is read and nothing is waited for.
    const src = new URL("packages/electron-shell/src/", root);
    const naming = (readdirSync(src, { recursive: true }) as string[])
      .filter((name) => /\.(?:ts|tsx|mts|mjs)$/u.test(name))
      .filter((name) => /readSocketsNow|runLsofNow/u.test(readFileSync(new URL(name, src), "utf8")))
      .sort();
    expect(naming).toEqual(["testing/pages-engine-witness.ts", "testing/pages-listeners.ts"]);
    const witness = read("packages/electron-shell/src/testing/pages-engine-witness.ts");
    // taken in one function, which one line of the witness calls: at a refusal that is a first answer
    expect(witness.match(/\breadNow\(/gu)).toHaveLength(1);
    expect(witness.match(/\breadRefused\(/gu)).toHaveLength(1);
    expect(witness).toContain('if (answer === "refused") readRefused(w);');
    // and "refused" is a refusal main says of an engine it HAS spawned: for its stream, nothing else
    expect(witness).toContain(
      'event === "pages.engine.refused" && REFUSED_AFTER_SPAWN.includes(reason ?? "")',
    );
    expect(witness).toContain(
      'const REFUSED_AFTER_SPAWN: readonly string[] = ["stream-on", "stream-unread"];',
    );
    // which are the two reasons the supervisor gives once it has spawned a child, and its only two
    const supervisor = read("packages/electron-shell/src/main/pages/broker/engine-supervisor.ts");
    const afterSpawn = supervisor.slice(supervisor.indexOf("this.#deps.spawn("));
    expect(afterSpawn.match(/"pages\.engine\.refused"/gu)).toHaveLength(1);
    expect(afterSpawn).toContain('const reason = shown === "on" ? "stream-on" : "stream-unread";');
    expect(supervisor.match(/"pages\.engine\.refused"/gu)).toHaveLength(3);
    const index = read("packages/electron-shell/src/main/index.ts");
    // main tells the witness its lines in two places and no other, each through `?.`
    expect(index.match(/pagesWitness\??\.line\(/gu)).toHaveLength(2);
    expect(index.match(/pagesWitness\?\.line\(event, fields\)/gu)).toHaveLength(2);
    // and loads the witness's module only through the testing entry, when asked: never by an import of its own
    expect(index).not.toMatch(/pages-engine-witness|pages-listeners/u);
  });

  it("the line the gate quotes when the run around the rows had trouble says how many troubles and no trouble's own words: a message can hold a local path", () => {
    const smoke = read("packages/electron-shell/src/testing/smoke.ts");
    const at = smoke.indexOf("if (process.argv.includes(PAGES_WITNESS_FLAG)) {");
    const branch = smoke.slice(at, smoke.indexOf("\n  try {", at + 1));
    const said = [...branch.matchAll(/console\.(?:error|log)\(([^;]*)\);/gu)].map(
      (m) => m[1] ?? "",
    );
    const quoted = said.filter((text) => text.includes("SMOKE_PAGES"));
    expect(quoted.length).toBeGreaterThanOrEqual(2);
    for (const text of quoted) {
      expect(text, text).not.toMatch(/problems\.join|\.message|\$\{e\b/u);
    }
    // the words themselves go to a line of another name, which no gate quotes
    expect(branch).toContain("smoke-pages trouble:");
    expect(read("scripts/gate-landing.mjs")).not.toContain("smoke-pages trouble");
  });

  it("the canvas smoke's branch runs the rows under the flag and exits by their verdict", () => {
    const smoke = read("packages/electron-shell/src/testing/smoke.ts");
    expect(smoke).toContain("if (process.argv.includes(PAGES_WITNESS_FLAG)) {");
    expect(smoke).toMatch(
      /export \{[^}]*\bcreatePagesEngineWitness\b[^}]*\} from "\.\/pages-engine-witness";/u,
    );
    const at = smoke.indexOf("if (process.argv.includes(PAGES_WITNESS_FLAG)) {");
    const branch = smoke.slice(at, smoke.indexOf("\n  try {", at + 1));
    expect(branch).toContain("runPagesRows(");
    // by the rows' verdict, through the exit that is said and watched (smoke-exit.ts): Electron's own
    // exit with that code, asked for in one place
    expect(branch).toContain("exitSaid(code, exitDeps, { before, surfaces });");
    expect(branch).toContain("exit: (exitCode) => app.exit(exitCode),");
    expect(branch.match(/app\.exit\(/gu)).toHaveLength(1);
  });

  it("main hands its broker the witness's hook, in the pages plane's broker block and nowhere else", () => {
    const index = read("packages/electron-shell/src/main/index.ts");
    const start = index.indexOf("pagesPlane = composePages({");
    const broker = index.slice(index.indexOf("broker: {", start), index.indexOf("log: {", start));
    expect(broker).toContain(
      "...(pagesWitness === null ? {} : { onSpawned: pagesWitness.onSpawned }),",
    );
    // the hook is named once in main: a production start passes the supervisor none
    expect(index.match(/onSpawned/gu)).toHaveLength(2);
  });

  it("the hook is made in ONE place in the shell's whole source and handed on in one more; every file that names it is known", () => {
    // The row above reads main's index alone. The broker's own index and the composition carry the
    // hook between main and the supervisor: a hook made there would start no witness and redden no
    // row but this one.
    const src = new URL("packages/electron-shell/src/", root);
    const files = (readdirSync(src, { recursive: true }) as string[]).filter((name) =>
      /\.(?:ts|tsx|mts|mjs)$/u.test(name),
    );
    const text = (name: string): string => readFileSync(new URL(name, src), "utf8");
    expect(files.filter((name) => /\bonSpawned\b/u.test(text(name))).sort()).toEqual([
      "main/index.ts",
      "main/pages/broker/engine-supervisor.ts",
      "main/pages/broker/index.ts",
      "main/pages/compose.ts",
      "testing/pages-engine-kill.ts",
      "testing/pages-engine-witness.ts",
    ]);
    // an object handed a hook: main's, from the witness; the broker's index, handing on what it was given
    const handing = files
      .filter((name) => name.startsWith("main/"))
      .flatMap((name) =>
        [...text(name).matchAll(/\{ onSpawned: ([A-Za-z.]+) \}/gu)].map((m) => `${name}: ${m[1]}`),
      )
      .sort();
    expect(handing).toEqual([
      "main/index.ts: pagesWitness.onSpawned",
      "main/pages/broker/index.ts: deps.onSpawned",
    ]);
    // and the composition only names it among the broker's own fields it passes through
    expect(text("main/pages/compose.ts").match(/onSpawned/gu)).toHaveLength(1);
    // Every file of main's that names it, by its count of the name (item 658, 2026-11-26): the
    // handing form above is one spelling, and a hook made as a plain property, a method or a
    // default in a file already listed matched neither it nor the list.
    // - main's index: the one object it hands the composition (the name twice in it);
    // - the broker's index: its own field, and the one spread that hands on what it was given (thrice);
    // - the supervisor: its own field, and its one call.
    const named = (name: string): number => text(name).match(/onSpawned/gu)?.length ?? 0;
    expect({
      index: named("main/index.ts"),
      broker: named("main/pages/broker/index.ts"),
      supervisor: named("main/pages/broker/engine-supervisor.ts"),
    }).toEqual({ index: 2, broker: 4, supervisor: 2 });
    // and the two places that are not a field's own declaration, word for word: a default beside
    // either would keep the count and be a hook of that file's own making
    expect(text("main/pages/broker/index.ts")).toContain(
      "    ...(deps.onSpawned === undefined ? {} : { onSpawned: deps.onSpawned }),\n",
    );
    expect(text("main/pages/broker/engine-supervisor.ts")).toContain(
      "      this.#deps.onSpawned?.(run, state.generation, child, {\n",
    );
  });
});
