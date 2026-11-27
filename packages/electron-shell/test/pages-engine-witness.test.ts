import { createHash } from "node:crypto";
import { EventEmitter } from "node:events";
import {
  chmodSync,
  existsSync,
  fstatSync,
  mkdirSync,
  mkdtempSync,
  renameSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { createServer, type Server } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { SOCKET_ALIAS_PARENT, SUN_PATH_MAX_BYTES, socketPathBytes } from "@vibefield/contracts";
import { PAGES_ENGINE_RECORD } from "@vibefield/contracts/pages-record";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { exchangeDaemon } from "../src/main/pages/broker/daemon-client";
import type { EngineChild } from "../src/main/pages/broker/engine-supervisor";
import {
  PAGES_ENGINE_PATH,
  type PagesSurroundings,
  pagesStreamShown,
} from "../src/main/pages/broker/surroundings";
import {
  createPagesEngineWitness,
  holdPagesSocketOpen,
  PAGES_WITNESS_PLANT,
  PAGES_WITNESS_PROBE,
  type PagesEngineWitnessDeps,
  type SpawnProbe,
  WITNESS_ROOT_WALK_MAX,
} from "../src/testing/pages-engine-witness";
import type { SocketRead } from "../src/testing/pages-listeners";

// Item 658 (2026-11-26): the pages smoke's witness, on folders of the test's own and fake children.
// No engine runs and no process is read; the one real process is the witness's own probe, sent at
// unix servers this file makes.

const PID = 424242;
const SESSION = "0123456789abcdef";

class FakeChild extends EventEmitter implements EngineChild {
  constructor(readonly pid: number = PID) {
    super();
  }
  kill(): boolean {
    return true;
  }
  exit(): void {
    this.emit("exit", 0, null);
  }
}

/** A child with no pid, as node hands one whose spawn failed. */
class PidlessChild extends EventEmitter implements EngineChild {
  readonly pid = undefined;
  kill(): boolean {
    return true;
  }
  exit(): void {
    this.emit("exit", 0, null);
  }
}

const sha256 = (text: string) => createHash("sha256").update(text).digest("hex");

const cleanup: string[] = [];
const servers: Server[] = [];

/** A fake engine's root, under the parent the product's own roots are made under (the socket alias
 * parent, /tmp on unix): a row binds a real unix socket inside it, and the OS temp folder alone is
 * about fifty bytes on macOS, which leaves the socket's path no room. */
function root(): PagesSurroundings {
  const parent = process.platform === "win32" ? tmpdir() : SOCKET_ALIAS_PARENT;
  const dir = mkdtempSync(join(parent, "vfw-"));
  cleanup.push(dir);
  const run = join(dir, "sock", "namespaces", "pages", "run");
  for (const name of [run, join(dir, "home"), join(dir, "tmp"), join(dir, "cwd")]) {
    mkdirSync(name, { recursive: true });
  }
  return {
    root: dir,
    socketDir: join(dir, "sock"),
    home: join(dir, "home"),
    tmp: join(dir, "tmp"),
    cwd: join(dir, "cwd"),
    session: SESSION,
    socketPath: join(run, `${SESSION}.sock`),
  };
}

const noSockets = async (): Promise<SocketRead> => ({ seen: "read", lines: [] });
/** Main's own pid, as the witness is told it: the rows' number, never this process's. */
const MAIN_PID = 515151;
/** The descriptor of the connection main holds open for the kernel's tie, as the rows' stand-in
 * for that connection says it. */
const HELD_FD = 31;
/** The child holds the session's socket, as the kernel's list of its unix sockets would say, and
 * main's held connection, by its descriptor, names that socket's kernel address as its peer. */
const holding =
  (s: PagesSurroundings) =>
  async (kind: "tcp" | "udp" | "unix", pid: number): Promise<SocketRead> => ({
    seen: "read",
    lines:
      kind !== "unix"
        ? []
        : pid === MAIN_PID
          ? [{ name: "->0xc1", state: "none", device: "0xa1", fd: HELD_FD }]
          : [{ name: s.socketPath, state: "none", device: "0xc1" }],
  });

/** The read taken at once, inside main's refusal line: no row lets the real one run (it would read
 * a process), so every witness here has this one unless a row gives its own. */
const noSocketsNow = (): SocketRead => ({ seen: "read", lines: [] });

function witness(deps: PagesEngineWitnessDeps = {}) {
  const w = createPagesEngineWitness({
    readSockets: noSockets,
    readSocketsNow: noSocketsNow,
    sourceBuildSha256: null,
    mainPid: MAIN_PID,
    // main's held connection for the kernel tie: no row lets the real one connect anywhere
    connect: async () => ({ close: () => undefined, fd: HELD_FD, open: () => true }),
    ...deps,
  });
  disposers.push(() => w.dispose());
  return w;
}
const disposers: (() => void)[] = [];

afterEach(async () => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  for (const dispose of disposers.splice(0)) dispose();
  await Promise.all(
    servers.splice(0).map((s) => new Promise((resolve) => s.close(() => resolve(undefined)))),
  );
  for (const dir of cleanup.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("the test's own engine roots (item 658, 2026-11-26)", () => {
  it("keep the socket's path inside a unix socket's bound whatever the OS temp folder is, as the product's roots do", async () => {
    // the OS temp folder as a person's shell has it on macOS is about fifty bytes; here it is longer still
    const long = mkdtempSync(join(SOCKET_ALIAS_PARENT, "vfw-long-"));
    cleanup.push(long);
    const deep = join(long, "t".repeat(60), "T");
    mkdirSync(deep, { recursive: true });
    vi.stubEnv("TMPDIR", deep);
    expect(tmpdir()).toBe(deep);
    const s = root();
    expect(socketPathBytes(s.socketPath)).toBeLessThanOrEqual(SUN_PATH_MAX_BYTES);
    // and a server binds there
    await new Promise<void>((resolve, reject) => {
      const server = createServer();
      server.once("error", reject);
      server.listen(s.socketPath, () => {
        servers.push(server);
        resolve();
      });
    });
  });
});

describe("the control's planted file (item 658, 2026-11-26)", () => {
  it("lands in the socket's folder inside the hook, for the marked run's next engine alone, and is what main's own check reads as a stream that is on", () => {
    const w = witness();
    const plain = root();
    w.onSpawned("run-a", 1, new FakeChild(), { file: "/x/agent-browser", surroundings: plain });
    expect(pagesStreamShown(plain)).toBe("off");
    const planted = root();
    w.plantFor("run-c");
    w.onSpawned("run-c", 1, new FakeChild(), { file: "/x/agent-browser", surroundings: planted });
    // inside the hook: there before the supervisor's ready wait can read the folder
    const file = join(dirname(planted.socketPath), PAGES_WITNESS_PLANT);
    expect(PAGES_WITNESS_PLANT).toBe("control.stream");
    expect(existsSync(file)).toBe(true);
    expect(statSync(file).mode & 0o777).toBe(0o600);
    expect(pagesStreamShown(planted)).toBe("on");
    expect(w.engines().map((e) => [e.run, e.planted])).toEqual([
      ["run-a", false],
      ["run-c", true],
    ]);
    // one engine's worth: the run's next engine gets none
    const again = root();
    w.onSpawned("run-c", 2, new FakeChild(), { file: "/x/agent-browser", surroundings: again });
    expect(pagesStreamShown(again)).toBe("off");
    expect(w.engines().map((e) => e.plantFailed())).toEqual([null, null, null]);
  });

  it("never throws inside the hook: a plant that cannot be written is said by its code, and the engine is watched all the same", () => {
    const w = witness();
    const s = root();
    // a file of the plant's name is there already: one this witness did not write
    writeFileSync(join(dirname(s.socketPath), PAGES_WITNESS_PLANT), "");
    w.plantFor("run-c");
    expect(() =>
      w.onSpawned("run-c", 1, new FakeChild(), { file: "/x/agent-browser", surroundings: s }),
    ).not.toThrow();
    const engine = w.engines()[0];
    expect(engine?.planted).toBe(true);
    expect(engine?.plantFailed()).toBe("EEXIST");
    expect(engine?.alive()).toBe(true);
    // and that file is no plant of the witness's: it is a stream file in the engine's folder, read as one
    const seen = engine?.stream();
    expect(seen?.verdict).toBe("red");
    expect(seen?.why).toContain(PAGES_WITNESS_PLANT);
    expect(seen?.plantSeen).toBe(false);
  });
});

describe("the stream file, watched from the spawn to the exit", () => {
  const live = (s: PagesSurroundings, w: ReturnType<typeof witness>) => {
    // the engine binds its socket, then main hears it ready
    vi.advanceTimersByTime(200);
    writeFileSync(s.socketPath, "");
    vi.advanceTimersByTime(200);
    w.line("pages.engine.ready", { ms: 400, identity: "dev-source-build", stream: "off" });
  };

  it("is ok over a quiet life, and says how it looked", () => {
    vi.useFakeTimers();
    const w = witness();
    const s = root();
    const child = new FakeChild();
    w.onSpawned("run-a", 1, child, { file: "/x/agent-browser", surroundings: s });
    live(s, w);
    vi.advanceTimersByTime(2600);
    child.exit();
    const got = w.engines()[0]?.stream();
    expect(got).toMatchObject({
      verdict: "ok",
      holes: 0,
      lifeMs: 3000,
      socketSeen: true,
      plantSeen: false,
    });
    expect(got?.maxGapMs).toBeLessThanOrEqual(100);
    expect(got?.polls).toBeGreaterThanOrEqual(30);
  });

  it("is red on a stream file written mid-life, beside the socket or anywhere else under the root", () => {
    for (const place of [
      (s: PagesSurroundings) => join(dirname(s.socketPath), `${SESSION}.stream`),
      (s: PagesSurroundings) => join(s.home, "deep", "x.stream"),
    ]) {
      vi.useFakeTimers();
      const w = witness();
      const s = root();
      const child = new FakeChild();
      w.onSpawned("run-a", 1, child, { file: "/x/agent-browser", surroundings: s });
      live(s, w);
      mkdirSync(dirname(place(s)), { recursive: true });
      writeFileSync(place(s), "53999");
      // every read is of the whole root: a file that comes and goes inside two polls' time is caught
      // beside the socket and anywhere else under the root alike
      vi.advanceTimersByTime(250);
      rmSync(place(s));
      vi.advanceTimersByTime(500);
      child.exit();
      const got = w.engines()[0]?.stream();
      expect(got?.verdict).toBe("red");
      expect(got?.why).toContain(".stream");
      expect(got?.why).not.toContain(s.root);
      vi.useRealTimers();
    }
  });

  it("takes the planted file on the planted engine alone: the same name on any other engine is a stream file", () => {
    vi.useFakeTimers();
    const w = witness();
    const planted = root();
    const a = new FakeChild();
    w.plantFor("run-c");
    w.onSpawned("run-c", 1, a, { file: "/x/agent-browser", surroundings: planted });
    live(planted, w);
    a.exit();
    expect(w.engines()[0]?.stream()).toMatchObject({ verdict: "ok", plantSeen: true });
    const other = root();
    const b = new FakeChild();
    w.onSpawned("run-a", 1, b, { file: "/x/agent-browser", surroundings: other });
    live(other, w);
    writeFileSync(join(dirname(other.socketPath), PAGES_WITNESS_PLANT), "");
    vi.advanceTimersByTime(200);
    b.exit();
    expect(w.engines()[1]?.stream().verdict).toBe("red");
  });

  it("is blind for an engine that answered and whose socket never showed, and stops looking at the exit", () => {
    vi.useFakeTimers();
    const w = witness();
    const s = root();
    const child = new FakeChild();
    w.onSpawned("run-a", 1, child, { file: "/x/agent-browser", surroundings: s });
    vi.advanceTimersByTime(900);
    w.line("pages.engine.ready", { ms: 900 });
    child.exit();
    const got = w.engines()[0]?.stream();
    expect(got).toMatchObject({ verdict: "blind", socketSeen: false });
    const polls = got?.polls;
    vi.advanceTimersByTime(3000);
    expect(w.engines()[0]?.stream().polls).toBe(polls);
  });

  it("says, and does not judge, the socket of an engine that never answered main", () => {
    vi.useFakeTimers();
    const w = witness();
    const child = new FakeChild();
    w.onSpawned("run-a", 1, child, { file: "/x/agent-browser", surroundings: root() });
    vi.advanceTimersByTime(900);
    child.exit();
    const got = w.engines()[0]?.stream();
    expect(got).toMatchObject({ verdict: "ok", socketSeen: false, lifeMs: 900 });
    expect(got?.said?.[0]).toMatch(/never answered/u);
  });

  it("counts a folder it could not read as a hole, never as a poll that saw no stream file", () => {
    if (process.platform === "win32" || process.getuid?.() === 0) return;
    vi.useFakeTimers();
    const w = witness();
    const s = root();
    const child = new FakeChild();
    w.onSpawned("run-a", 1, child, { file: "/x/agent-browser", surroundings: s });
    live(s, w);
    // a process of this uid takes the read bit off the socket's folder: the engine can still write
    // there, and nothing reads what it writes
    const run = dirname(s.socketPath);
    chmodSync(run, 0o300);
    try {
      writeFileSync(join(run, `${SESSION}.stream`), "53999");
      vi.advanceTimersByTime(1500);
      child.exit();
    } finally {
      chmodSync(run, 0o700);
    }
    const got = w.engines()[0]?.stream();
    expect(got?.verdict).toBe("blind");
    expect(got?.holes).toBeGreaterThanOrEqual(14);
    expect(got?.maxGapMs).toBeGreaterThan(1000);
  });

  it("counts a walk cut at its bound as a hole: the folders it never reached were not read", () => {
    vi.useFakeTimers();
    const w = witness();
    const s = root();
    const child = new FakeChild();
    mkdirSync(join(s.home, "many"));
    for (let i = 0; i <= WITNESS_ROOT_WALK_MAX; i += 1) {
      writeFileSync(join(s.home, "many", `f${i}`), "");
    }
    w.onSpawned("run-a", 1, child, { file: "/x/agent-browser", surroundings: s });
    live(s, w);
    vi.advanceTimersByTime(300);
    child.exit();
    expect(w.engines()[0]?.stream()).toMatchObject({ verdict: "blind", polls: 0 });
    expect(w.engines()[0]?.stream().holes).toBeGreaterThanOrEqual(5);
  });

  it("takes its last look BEFORE main's own exit listener removes the root, as the listeners stand in the product", () => {
    vi.useFakeTimers();
    const w = witness();
    const s = root();
    const child = new FakeChild();
    // the supervisor's listener is on the child before the hook is called, and removes the root
    child.once("exit", () => rmSync(s.root, { recursive: true, force: true }));
    w.onSpawned("run-a", 1, child, { file: "/x/agent-browser", surroundings: s });
    live(s, w);
    vi.advanceTimersByTime(310);
    // written after the last poll and there at the exit: only a look at the exit sees it
    writeFileSync(join(dirname(s.socketPath), `${SESSION}.stream`), "53999");
    child.exit();
    expect(existsSync(s.root)).toBe(false);
    const got = w.engines()[0]?.stream();
    expect(got?.verdict).toBe("red");
    expect(got?.holes).toBe(0);
  });

  it("does not follow a link, and counts every read that met one as a hole: what lies behind a link was not read", () => {
    vi.useFakeTimers();
    const w = witness();
    const s = root();
    const outside = mkdtempSync(join(tmpdir(), "vfw-out-"));
    cleanup.push(outside);
    writeFileSync(join(outside, "x.stream"), "53999");
    const child = new FakeChild();
    w.onSpawned("run-a", 1, child, { file: "/x/agent-browser", surroundings: s });
    live(s, w);
    vi.advanceTimersByTime(300);
    const engine = w.engines()[0];
    const before = engine?.stream();
    expect(before).toMatchObject({ holes: 0 });
    // a link put under the root mid-life, to a folder that holds a stream file: every read from
    // then on is a hole, and a stretch of them over the bound is BLIND, never a clean life
    symlinkSync(outside, join(s.home, "linked"));
    vi.advanceTimersByTime(1500);
    const after = engine?.stream();
    expect(after?.verdict).toBe("blind");
    expect(after?.holes).toBeGreaterThanOrEqual(14);
    expect(after?.polls).toBe(before?.polls);
    child.exit();
  });

  it("counts a link that stands where the socket's folder stood as a hole, and a root that is a link as never read", () => {
    vi.useFakeTimers();
    const w = witness();
    const s = root();
    const child = new FakeChild();
    w.onSpawned("run-a", 1, child, { file: "/x/agent-browser", surroundings: s });
    live(s, w);
    vi.advanceTimersByTime(300);
    // the socket's folder is moved out of the root and a link of its name left in its place: the
    // engine's own writes still land in the folder, through the link, where no read looks
    const aside = mkdtempSync(join(tmpdir(), "vfw-aside-"));
    cleanup.push(aside);
    const run = dirname(s.socketPath);
    renameSync(run, join(aside, "run"));
    symlinkSync(join(aside, "run"), run);
    writeFileSync(join(aside, "run", `${SESSION}.stream`), "53999");
    vi.advanceTimersByTime(1500);
    const got = w.engines()[0]?.stream();
    expect(got?.verdict).toBe("blind");
    expect(got?.why).toMatch(/went unread for \d+ ms/u);
    child.exit();
    // a root that is itself a link from its spawn on
    const linked = root();
    const real = `${linked.root}.real`;
    renameSync(linked.root, real);
    cleanup.push(real);
    symlinkSync(real, linked.root);
    const second = new FakeChild();
    w.onSpawned("run-b", 1, second, { file: "/x/agent-browser", surroundings: linked });
    vi.advanceTimersByTime(400);
    second.exit();
    expect(w.engines()[1]?.stream()).toMatchObject({
      verdict: "blind",
      polls: 0,
      why: "the engine's folders were never read while it lived",
    });
  });

  it("takes a child's error for its exit, and its last look then too is taken before the root is removed", () => {
    vi.useFakeTimers();
    const w = witness();
    const s = root();
    const child = new FakeChild();
    // as the supervisor's own listeners stand: on the child before the hook is called
    child.once("error", () => rmSync(s.root, { recursive: true, force: true }));
    w.onSpawned("run-a", 1, child, { file: "/x/agent-browser", surroundings: s });
    live(s, w);
    vi.advanceTimersByTime(310);
    writeFileSync(join(dirname(s.socketPath), `${SESSION}.stream`), "53999");
    child.emit("error", new Error("the child could not be kept"));
    const engine = w.engines()[0];
    expect(engine?.alive()).toBe(false);
    expect(existsSync(s.root)).toBe(false);
    expect(engine?.stream()).toMatchObject({ verdict: "red", holes: 0 });
    const polls = engine?.stream().polls;
    vi.advanceTimersByTime(1000);
    expect(engine?.stream().polls).toBe(polls);
  });
});

describe("the engine's pid file and what is told of the child", () => {
  it("is ok when it names the child or is never seen, blind when it names another, and no verdict holds the pid", () => {
    vi.useFakeTimers();
    const w = witness();
    const says: string[] = [];
    for (const [text, verdict] of [
      [String(PID), "ok"],
      [null, "ok"],
      ["777777", "blind"],
    ] as const) {
      const s = root();
      const child = new FakeChild();
      w.onSpawned("run-a", 1, child, { file: "/x/agent-browser", surroundings: s });
      if (text !== null) writeFileSync(join(dirname(s.socketPath), `${SESSION}.pid`), `${text}\n`);
      vi.advanceTimersByTime(300);
      child.exit();
      const engine = w.engines().at(-1);
      expect(engine?.pidFile().verdict, String(text)).toBe(verdict);
      says.push(JSON.stringify([engine?.pidFile(), engine?.stream(), engine?.listeners()]));
    }
    expect(says.join(" ")).not.toContain(String(PID));
  });

  it("keeps two children of one run apart though both arrive as generation one", () => {
    const w = witness();
    const first = new FakeChild(1001);
    const second = new FakeChild(1002);
    w.onSpawned("run-a", 1, first, { file: "/x/agent-browser", surroundings: root() });
    first.exit();
    w.onSpawned("run-a", 1, second, { file: "/x/agent-browser", surroundings: root() });
    expect(w.engines().map((e) => [e.run, e.generation, e.alive()])).toEqual([
      ["run-a", 1, false],
      ["run-a", 1, true],
    ]);
  });

  it("says a child that never exits, and one that has", async () => {
    const w = witness();
    const child = new FakeChild();
    w.onSpawned("run-a", 1, child, { file: "/x/agent-browser", surroundings: root() });
    expect(await w.settled(120)).toEqual({ unended: 1 });
    child.exit();
    expect(await w.settled(120)).toEqual({ unended: 0 });
  });
});

describe("the spawned file", () => {
  it("is ok only as the recorded source build, read as a file and never through a link", () => {
    const dir = mkdtempSync(join(tmpdir(), "vfw-"));
    cleanup.push(dir);
    const file = join(dir, "agent-browser");
    writeFileSync(file, "the source build's bytes");
    const sum = createHash("sha256").update("the source build's bytes").digest("hex");
    const link = join(dir, "link");
    symlinkSync(file, link);
    const verdict = (path: string, sourceBuildSha256: string | null) => {
      const w = witness({ sourceBuildSha256 });
      w.onSpawned("run-a", 1, new FakeChild(), { file: path, surroundings: root() });
      return w.engines()[0]?.identity();
    };
    expect(verdict(file, sum)?.verdict).toBe("ok");
    expect(verdict(file, "0".repeat(64))).toMatchObject({
      verdict: "red",
      why: "the spawned file is not the recorded source build",
    });
    // a link to the right bytes is still not the file that was checked
    expect(verdict(link, sum)?.verdict).toBe("blind");
    expect(verdict(join(dir, "absent"), sum)?.verdict).toBe("blind");
    // a host the record names no source build for cannot be judged
    expect(verdict(file, null)?.verdict).toBe("blind");
  });
});

describe("the spawned file, by the record itself", () => {
  it("is held to the record's own source build for this host when the witness is given no other sum", () => {
    const dir = mkdtempSync(join(tmpdir(), "vfw-"));
    cleanup.push(dir);
    const file = join(dir, "agent-browser");
    writeFileSync(file, "bytes that are no source build");
    const w = createPagesEngineWitness({ readSockets: noSockets });
    disposers.push(() => w.dispose());
    w.onSpawned("run-a", 1, new FakeChild(), { file, surroundings: root() });
    const host = `${process.platform}-${process.arch}`;
    const recorded = Object.hasOwn(PAGES_ENGINE_RECORD.sourceBuild.binarySha256, host);
    // THIS ROW BITES ONLY ON A HOST THE RECORD NAMES A BUILD FOR, which is darwin-arm64 and no other
    // today: there other bytes are red, and a witness that never read the record would say blind.
    // On any other host the row expects blind, and such a witness passes it there.
    if (host === "darwin-arm64") expect(recorded).toBe(true);
    expect(Object.keys(PAGES_ENGINE_RECORD.sourceBuild.binarySha256)).toEqual(["darwin-arm64"]);
    expect(w.engines()[0]?.identity().verdict).toBe(recorded ? "red" : "blind");
  });
});

describe("the engine's sockets", () => {
  const BRIDGE = "127.0.0.1:53211";

  it("are read one read at a time from the SPAWN to the exit, the watch's own reads half a second apart, on the child's pid alone", async () => {
    vi.useFakeTimers();
    let open = 0;
    let most = 0;
    const starts: number[] = [];
    const readSockets = vi.fn(
      async (_kind: "tcp" | "udp" | "unix", _pid: number): Promise<SocketRead> => {
        open += 1;
        most = Math.max(most, open);
        starts.push(Date.now());
        await new Promise((resolve) => setTimeout(resolve, 40));
        open -= 1;
        return { seen: "read", lines: [] };
      },
    );
    const w = witness({ readSockets });
    const s = root();
    const child = new FakeChild();
    const spawnedAt = Date.now();
    w.onSpawned("run-a", 1, child, { file: "/x/agent-browser", surroundings: s });
    await vi.advanceTimersByTimeAsync(600);
    // no socket yet, and the engine is read all the same, from the instant of its spawn: an engine
    // that never shows a socket is not unread
    expect(readSockets.mock.calls.length).toBeGreaterThanOrEqual(2);
    expect(starts[0]).toBe(spawnedAt);
    // to an instant when one of the watch's own reads is under way
    await vi.advanceTimersByTimeAsync(2110);
    const engine = w.engines()[0];
    if (engine === undefined) throw new Error("the engine was told");
    // a read the smoke asks for by phase waits its turn behind it: never two reads of the child at once
    await Promise.all([w.sample(engine), vi.advanceTimersByTimeAsync(200)]);
    const made = readSockets.mock.calls.length;
    child.exit();
    await vi.advanceTimersByTimeAsync(3000);
    expect(readSockets.mock.calls.length).toBe(made);
    expect(made).toBeGreaterThanOrEqual(6);
    expect(most).toBe(1);
    expect(readSockets.mock.calls.every(([kind, pid]) => kind === "tcp" && pid === PID)).toBe(true);
    const loop = starts.slice(0, -1);
    for (let i = 1; i < loop.length; i += 1) {
      expect((loop[i] as number) - (loop[i - 1] as number)).toBeGreaterThanOrEqual(540);
    }
    // every one of them fell inside its life; main never leased it, so none is a counted read
    expect(engine.listeners()).toMatchObject({ verdict: "ok", inside: made, discarded: 0 });
    expect(engine.tcp(BRIDGE)).toMatchObject({ verdict: "blind", counted: 0, bare: made });
  });

  it("marks a read the child's exit fell inside, and one begun after it: neither is a read of its life", async () => {
    vi.useFakeTimers();
    const readSockets = vi.fn(async (): Promise<SocketRead> => {
      await new Promise((resolve) => setTimeout(resolve, 40));
      return { seen: "read", lines: [] };
    });
    const w = witness({ readSockets });
    const child = new FakeChild();
    w.onSpawned("run-a", 1, child, { file: "/x/agent-browser", surroundings: root() });
    const engine = w.engines()[0];
    if (engine === undefined) throw new Error("the engine was told");
    // the first read ends at 40 ms; the second begins at 540 ms and the child exits inside it
    await vi.advanceTimersByTimeAsync(560);
    child.exit();
    await vi.advanceTimersByTimeAsync(100);
    expect(engine.listeners()).toMatchObject({ inside: 1, discarded: 1 });
    // a read asked for after the exit is kept as one outside its life, and nothing is run for it:
    // the pid is the system's to hand out again
    await Promise.all([w.sample(engine), vi.advanceTimersByTimeAsync(100)]);
    expect(engine.listeners()).toMatchObject({ inside: 1, discarded: 2 });
    expect(readSockets).toHaveBeenCalledTimes(2);
  });

  it("counts a read by the engine's own connection to main's bridge, and says the stretches no counted read covers", async () => {
    vi.useFakeTimers();
    let attached = false;
    const readSockets = vi.fn(
      async (): Promise<SocketRead> => ({
        seen: "read",
        lines: attached ? [{ name: `127.0.0.1:53300->${BRIDGE}`, state: "established" }] : [],
      }),
    );
    const w = witness({ readSockets });
    const child = new FakeChild();
    w.onSpawned("run-a", 1, child, { file: "/x/agent-browser", surroundings: root() });
    const engine = w.engines()[0];
    if (engine === undefined) throw new Error("the engine was told");
    await vi.advanceTimersByTimeAsync(700);
    attached = true;
    await vi.advanceTimersByTimeAsync(1700);
    child.exit();
    // judged well after its exit: its life ended at the exit, not at the judgment
    await vi.advanceTimersByTimeAsync(700);
    const got = engine.tcp(BRIDGE);
    expect(got).toMatchObject({ verdict: "ok", counted: 3, bare: 2, discarded: 0 });
    // the first counted read began a second into its life, the last ended four tenths before its end
    expect(got.headMs).toBe(1000);
    expect(got.tailMs).toBe(400);
  });

  it("stops starting reads once told the engine is to be closed, and says when every read it began has ended", async () => {
    vi.useFakeTimers();
    const readSockets = vi.fn(async (): Promise<SocketRead> => {
      await new Promise((resolve) => setTimeout(resolve, 300));
      return { seen: "read", lines: [{ name: "127.0.0.1:53999", state: "listen" }] };
    });
    const w = witness({ readSockets });
    w.onSpawned("run-a", 1, new FakeChild(), { file: "/x/agent-browser", surroundings: root() });
    const engine = w.engines()[0];
    if (engine === undefined) throw new Error("the engine was told");
    // the first read is under way and has said nothing yet
    await vi.advanceTimersByTimeAsync(100);
    expect(engine.listeners().listeners).toEqual([]);
    engine.quiet();
    let drained = false;
    const wait = w.drained(engine).then(() => {
      drained = true;
    });
    await vi.advanceTimersByTimeAsync(100);
    expect(drained).toBe(false);
    await vi.advanceTimersByTimeAsync(200);
    await wait;
    // the read that was under way is in the verdict: a listener it saw is not lost
    expect(engine.listeners()).toMatchObject({ verdict: "red", listeners: ["127.0.0.1:53999"] });
    const made = readSockets.mock.calls.length;
    await vi.advanceTimersByTimeAsync(3000);
    expect(readSockets.mock.calls.length).toBe(made);
    expect(made).toBe(1);
  });

  it("keeps every UDP read it was asked for: a socket bound with no peer is red whatever a later read shows", async () => {
    vi.useFakeTimers();
    let bound = true;
    const readSockets = vi.fn(
      async (kind: "tcp" | "udp" | "unix"): Promise<SocketRead> => ({
        seen: "read",
        lines:
          kind === "udp"
            ? bound
              ? [{ name: "*:5353", state: "none" }]
              : []
            : kind === "tcp"
              ? [{ name: `127.0.0.1:50001->${BRIDGE}`, state: "established" }]
              : [],
      }),
    );
    const w = witness({ readSockets });
    const child = new FakeChild();
    w.onSpawned("run-a", 1, child, { file: "/x/agent-browser", surroundings: root() });
    const engine = w.engines()[0];
    if (engine === undefined) throw new Error("the engine was told");
    expect(engine.udp(BRIDGE)).toEqual({
      verdict: "blind",
      why: "the engine's UDP sockets were not read",
    });
    await w.readUdp(engine);
    expect(readSockets.mock.calls.filter(([kind]) => kind === "udp")).toEqual([["udp", PID]]);
    expect(engine.udp(BRIDGE).verdict).toBe("red");
    // a second read that shows none, and a third after the exit, undo nothing
    bound = false;
    await w.readUdp(engine);
    await w.sample(engine);
    expect(engine.udp(BRIDGE).verdict).toBe("red");
    child.exit();
    await w.readUdp(engine);
    expect(engine.udp(BRIDGE).verdict).toBe("red");
  });

  it("takes an empty UDP read for a read of the engine only when a read of its TCP sockets begun after it shows the engine's own connection to main's bridge", async () => {
    vi.useFakeTimers();
    let attached = true;
    const readSockets = vi.fn(async (kind: "tcp" | "udp" | "unix"): Promise<SocketRead> => {
      await new Promise((resolve) => setTimeout(resolve, 20));
      return {
        seen: "read",
        lines:
          kind === "tcp" && attached
            ? [{ name: `127.0.0.1:50001->${BRIDGE}`, state: "established" }]
            : [],
      };
    });
    const w = witness({ readSockets });
    const child = new FakeChild();
    w.onSpawned("run-a", 1, child, { file: "/x/agent-browser", surroundings: root() });
    const engine = w.engines()[0];
    if (engine === undefined) throw new Error("the engine was told");
    engine.quiet();
    await vi.advanceTimersByTimeAsync(100);
    await Promise.all([w.readUdp(engine), vi.advanceTimersByTimeAsync(50)]);
    // counted reads there were, before it: none after it, so lsof's silence may be a process that is gone
    expect(engine.udp(BRIDGE)).toEqual({
      verdict: "blind",
      why: "no read of the engine's sockets after its UDP read showed it alive",
    });
    await Promise.all([w.sample(engine), vi.advanceTimersByTimeAsync(50)]);
    expect(engine.udp(BRIDGE)).toEqual({ verdict: "ok" });
    // by the bridge the smoke names, and by no other
    expect(engine.udp("127.0.0.1:1").verdict).toBe("blind");
    expect(engine.udp(null).verdict).toBe("blind");
    // a later read that is bare does not undo the sight of it alive
    attached = false;
    await Promise.all([w.sample(engine), vi.advanceTimersByTimeAsync(50)]);
    expect(engine.udp(BRIDGE)).toEqual({ verdict: "ok" });
  });

  it("says whether any read of it showed a connection to the bridge it is asked about: an engine main never said ready has none", async () => {
    vi.useFakeTimers();
    const lines = (name: string, state: "established" | "other"): SocketRead => ({
      seen: "read",
      lines: [{ name, state }],
    });
    const shown = async (read: SocketRead) => {
      const w = witness({ readSockets: async () => read });
      const child = new FakeChild();
      w.onSpawned("run-a", 1, child, { file: "/x/agent-browser", surroundings: root() });
      await vi.advanceTimersByTimeAsync(10);
      const engine = w.engines()[0];
      if (engine === undefined) throw new Error("the engine was told");
      child.exit();
      return engine;
    };
    const attached = await shown(lines(`127.0.0.1:50001->${BRIDGE}`, "established"));
    expect(attached.attached(BRIDGE)).toBe(true);
    // by that bridge and no other; and with no bridge known, nothing is shown
    expect(attached.attached("127.0.0.1:1")).toBe(false);
    expect(attached.attached(null)).toBe(false);
    // a connection in another state, a connection elsewhere, a read that did not answer, no read
    expect((await shown(lines(`127.0.0.1:50001->${BRIDGE}`, "other"))).attached(BRIDGE)).toBe(
      false,
    );
    expect(
      (await shown(lines("127.0.0.1:50001->127.0.0.1:9", "established"))).attached(BRIDGE),
    ).toBe(false);
    expect((await shown({ seen: "blind", why: "lsof did not answer" })).attached(BRIDGE)).toBe(
      false,
    );
  });

  it("keeps nothing of a child that has no pid: no read is run, and its sockets are blind for want of one", async () => {
    const readSockets = vi.fn(noSockets);
    const w = witness({ readSockets });
    // a child the system gave no pid: a spawn that failed
    const child = new PidlessChild();
    w.onSpawned("run-a", 1, child, { file: "/x/agent-browser", surroundings: root() });
    const engine = w.engines()[0];
    if (engine === undefined) throw new Error("the engine was told");
    await w.sample(engine);
    await w.readUdp(engine);
    expect(readSockets).not.toHaveBeenCalled();
    expect(engine.listeners()).toMatchObject({ verdict: "blind", inside: 0 });
    expect(engine.udp(BRIDGE).verdict).toBe("blind");
    child.exit();
  });

  it("waits for a read asked for while it waits: every read begun has ended when it says so", async () => {
    vi.useFakeTimers();
    const readSockets = vi.fn(async (): Promise<SocketRead> => {
      await new Promise((resolve) => setTimeout(resolve, 100));
      return { seen: "read", lines: [] };
    });
    const w = witness({ readSockets });
    w.onSpawned("run-a", 1, new FakeChild(), { file: "/x/agent-browser", surroundings: root() });
    const engine = w.engines()[0];
    if (engine === undefined) throw new Error("the engine was told");
    // the watch's first read runs from 0 to 100, and it starts no other
    engine.quiet();
    await vi.advanceTimersByTimeAsync(50);
    let drainedAt: number | null = null;
    const wait = w.drained(engine).then(() => {
      drainedAt = Date.now();
    });
    const asked = Date.now();
    await vi.advanceTimersByTimeAsync(10);
    // a read asked for now waits its turn behind the first: it runs from 100 to 200
    void w.sample(engine);
    await vi.advanceTimersByTimeAsync(90);
    expect(drainedAt).toBeNull();
    await vi.advanceTimersByTimeAsync(100);
    await wait;
    expect((drainedAt ?? 0) - asked).toBe(150);
    expect(readSockets).toHaveBeenCalledTimes(2);
  });

  it("judges the census only while the child lives", () => {
    const w = witness();
    const child = new FakeChild();
    w.onSpawned("run-a", 1, child, { file: "/x/agent-browser", surroundings: root() });
    const engine = w.engines()[0];
    const rows = [
      { pid: 100, ppid: 1, name: "electron" },
      { pid: PID, ppid: 100, name: "agent-browser" },
    ];
    expect(engine?.census(rows).verdict).toBe("ok");
    expect(engine?.census([...rows, { pid: 6000, ppid: PID, name: "Google Chrome" }]).verdict).toBe(
      "red",
    );
    child.exit();
    // a census read after its exit shows nothing of what was beneath it (an orphan has another
    // parent), and a row with its pid may be another process by now
    expect(engine?.census(rows).verdict).toBe("blind");
    expect(engine?.census(rows.slice(0, 1)).verdict).toBe("blind");
    expect(engine?.census([...rows, { pid: 6000, ppid: PID, name: "Google Chrome" }]).verdict).toBe(
      "blind",
    );
    // A SECOND engine in the run is red whether or not the first still lives (item 658, 2026-11-27:
    // the blind of an engine that had exited was tested first, and hid it). An engine that forks
    // itself away and exits is this shape.
    expect(engine?.census([...rows, { pid: 7000, ppid: 1, name: "agent-browser" }])).toEqual({
      verdict: "red",
      why: "the run holds a second engine",
    });
    expect(engine?.census([{ pid: 7000, ppid: 1, name: "agent-browser" }]).verdict).toBe("red");
  });
});

describe("an engine main refuses (item 658, 2026-11-26)", () => {
  // Main says its refusal and then ends the engine by its ladder: on a real run such an engine lived
  // 54 ms, and no waited read, each a process of its own, fell inside that life.
  type Now = (kind: "tcp" | "unix", pid: number) => SocketRead;
  /** The watch's own read, a process: `ms` long. */
  const waited = (ms: number) =>
    vi.fn(async (): Promise<SocketRead> => {
      await new Promise((resolve) => setTimeout(resolve, ms));
      return { seen: "read", lines: [] };
    });
  /** An engine spawned, refused 40 ms on and exited 14 ms after that. The watch's read takes 80 ms
   * (it straddles the exit) unless a row gives another length. */
  async function refused(readSocketsNow: Now, s = root(), readMs = 80) {
    const now = vi.fn(readSocketsNow);
    const w = witness({ readSockets: waited(readMs), readSocketsNow: now });
    const child = new FakeChild();
    w.onSpawned("run-c", 1, child, { file: "/x/agent-browser", surroundings: s });
    await vi.advanceTimersByTimeAsync(40);
    const before = now.mock.calls.length;
    w.line("desktop.pages.engine.refused", { reason: "stream-on" });
    // inside the line: whatever was read, was read before it returned
    const inLine = now.mock.calls.slice(before);
    await vi.advanceTimersByTimeAsync(14);
    child.exit();
    await vi.advanceTimersByTimeAsync(300);
    const engine = w.engines()[0];
    if (engine === undefined) throw new Error("the engine was told");
    return { engine, now, inLine, w, s };
  }
  const empty: SocketRead = { seen: "read", lines: [] };
  const holds =
    (s: PagesSurroundings, tcp: SocketRead = empty): Now =>
    (kind) =>
      kind === "unix" ? { seen: "read", lines: [{ name: s.socketPath, state: "none" }] } : tcp;
  const TIED =
    "1 read of its sockets showed no listener; the refused engine's TCP read has no bridge positive control; its life is tied by the unix read";

  it("is read where main says its refusal, before that line returns and so before main's ladder: its TCP sockets, then its unix sockets, on the child's pid alone", async () => {
    vi.useFakeTimers();
    const s = root();
    const { engine, inLine } = await refused(holds(s), s);
    expect(inLine).toEqual([
      ["tcp", PID],
      ["unix", PID],
    ]);
    expect(engine.answered()).toBe("refused");
    // the watch's own read straddled the exit and is no read of its life; the one taken at once is
    const got = engine.listeners();
    expect(got).toMatchObject({
      verdict: "ok",
      inside: 1,
      discarded: 1,
      unborne: 0,
      listeners: [],
    });
    expect(got.said).toEqual([TIED]);
  });

  it("stands on that read ALONE: a waited read that fell inside its life is said, and is no read of a refused engine", async () => {
    vi.useFakeTimers();
    // the watch's read takes 10 ms here: begun at the spawn, ended long before the exit
    const s = root();
    const tied = await refused(holds(s), s, 10);
    expect(tied.engine.listeners()).toMatchObject({ verdict: "ok", inside: 1, unborne: 1 });
    expect(tied.engine.listeners().said).toEqual([TIED]);
    // with BOTH reads at the refusal unanswered, that waited read makes nothing ok: the leg is BLIND
    const unread: SocketRead = { seen: "blind", why: "lsof could not be run (ETIMEDOUT)" };
    const both = await refused(() => unread, root(), 10);
    expect(both.engine.listeners()).toMatchObject({ verdict: "blind", inside: 0, unborne: 1 });
    // and so with the TCP read answered and the unix read after it not taken
    const half = await refused((kind) => (kind === "unix" ? unread : empty), root(), 10);
    expect(half.engine.listeners()).toMatchObject({
      verdict: "blind",
      why: "the read of the refused engine's unix sockets could not be taken: its TCP read is not known to be of a living engine",
      inside: 0,
      unborne: 1,
    });
  });

  it("sets that read aside only when the unix read after it READ and did not show the session's socket: lsof says no sockets of a process that is gone", async () => {
    vi.useFakeTimers();
    const elsewhere: SocketRead = {
      seen: "read",
      lines: [{ name: "/tmp/other.sock", state: "none" }],
    };
    for (const unix of [empty, elsewhere]) {
      const { engine } = await refused((kind) => (kind === "unix" ? unix : empty));
      expect(engine.listeners(), JSON.stringify(unix)).toMatchObject({
        verdict: "blind",
        why: "no read of the refused engine's sockets was tied to its life by a read of its unix sockets after it",
        inside: 0,
        discarded: 2,
      });
    }
    // the system may name the same place under /private
    const s = root();
    const { engine } = await refused(
      (kind) =>
        kind === "unix"
          ? { seen: "read", lines: [{ name: `/private${s.socketPath}`, state: "none" }] }
          : empty,
      s,
    );
    expect(engine.listeners()).toMatchObject({ verdict: "ok", inside: 1 });
  });

  it("is red on a listener in that read, whatever the unix read says; and blind on a read that did not answer or that threw", async () => {
    vi.useFakeTimers();
    const listening: SocketRead = {
      seen: "read",
      lines: [{ name: "127.0.0.1:9223", state: "listen" }],
    };
    const unread: SocketRead = { seen: "blind", why: "lsof could not be run (ETIMEDOUT)" };
    for (const unix of [empty, unread]) {
      const gone = await refused((kind) => (kind === "unix" ? unix : listening));
      expect(gone.engine.listeners()).toMatchObject({
        verdict: "red",
        listeners: ["127.0.0.1:9223"],
      });
    }
    const s = root();
    const held = await refused(holds(s, listening), s);
    expect(held.engine.listeners()).toMatchObject({
      verdict: "red",
      listeners: ["127.0.0.1:9223"],
    });
    const t = root();
    const silent = await refused(holds(t, unread), t);
    expect(silent.engine.listeners()).toMatchObject({
      verdict: "blind",
      why: "a read of the engine's sockets did not answer",
    });
  });

  it("takes no such read at a ready line, at a second line of the same engine, at a refusal that came before any spawn, or once the engine's exit was seen; and a read that throws is thrown nowhere", async () => {
    vi.useFakeTimers();
    const s = root();
    const now = vi.fn(holds(s));
    const w = witness({ readSockets: waited(80), readSocketsNow: now });
    const child = new FakeChild();
    w.onSpawned("run-a", 1, child, { file: "/x/agent-browser", surroundings: s });
    // a refusal main says BEFORE it spawns anything (its surroundings, its identity check) is said
    // while an older engine may live: it is no answer of that engine, and reads nothing
    for (const reason of ["surroundings", "digest-mismatch", "no-path"]) {
      w.line("desktop.pages.engine.refused", { reason });
    }
    expect(now).not.toHaveBeenCalled();
    expect(w.engines()[0]?.answered()).toBe("none");
    w.line("desktop.pages.engine.ready", { ms: 1, identity: "dev-source-build" });
    expect(now).not.toHaveBeenCalled();
    expect(w.engines()[0]?.answered()).toBe("ready");
    // a refusal after the ready line is no first answer
    w.line("desktop.pages.engine.refused", { reason: "stream-on" });
    expect(now).not.toHaveBeenCalled();
    // the next engine: read once, at its first refusal alone; a folder main could not read refuses too
    const second = new FakeChild();
    w.onSpawned("run-b", 1, second, { file: "/x/agent-browser", surroundings: s });
    w.line("desktop.pages.engine.refused", { reason: "stream-unread" });
    w.line("desktop.pages.engine.refused", { reason: "stream-on" });
    expect(now).toHaveBeenCalledTimes(2);
    expect(w.engines()[1]?.answered()).toBe("refused");
    // an engine whose exit was seen: nothing is run, the pid is the system's to hand out again
    const third = new FakeChild();
    w.onSpawned("run-d", 1, third, { file: "/x/agent-browser", surroundings: s });
    third.exit();
    w.line("desktop.pages.engine.refused", { reason: "stream-on" });
    expect(now).toHaveBeenCalledTimes(2);
    // a read that throws: the line is main's own log call, and nothing is thrown into it
    const thrower = witness({
      readSockets: waited(80),
      readSocketsNow: () => {
        throw new Error("the read threw");
      },
    });
    const fourth = new FakeChild();
    thrower.onSpawned("run-e", 1, fourth, { file: "/x/agent-browser", surroundings: s });
    expect(() =>
      thrower.line("desktop.pages.engine.refused", { reason: "stream-on" }),
    ).not.toThrow();
    fourth.exit();
    await vi.advanceTimersByTimeAsync(300);
    expect(thrower.engines()[0]?.listeners().verdict).toBe("blind");
  });
});

describe("an engine that took main's ready connect and was gone (item 658, 2026-11-26)", () => {
  // Main says so by a line of its own, after the engine's exit. Such an engine ANSWERED main: its
  // unseen socket is waived by nothing, and no read of its sockets has a control.
  it("is told apart by main's own line though the line follows its exit: nothing of it is waived", async () => {
    vi.useFakeTimers();
    const w = witness();
    const child = new FakeChild();
    w.onSpawned("run-a", 1, child, { file: "/x/agent-browser", surroundings: root() });
    await vi.advanceTimersByTimeAsync(250);
    child.exit();
    w.line("desktop.pages.engine.unready", { answered: "yes", gone: "yes" });
    const engine = w.engines()[0];
    if (engine === undefined) throw new Error("the engine was told");
    expect(engine.answered()).toBe("gone");
    // it made a socket (main connected to it) and no read saw one: the folder reads are not the engine's
    expect(engine.stream()).toMatchObject({
      verdict: "blind",
      socketSeen: false,
      why: "the engine's own socket never showed in time: the folder read is not the engine's",
    });
    expect(engine.listeners()).toMatchObject({
      verdict: "blind",
      why: "the engine answered main and was gone before main read it: no read of its sockets has a control",
    });
  });

  it("leaves an engine that never answered as one: gone before it was ready, or slow and still running", async () => {
    vi.useFakeTimers();
    const w = witness();
    const early = new FakeChild();
    w.onSpawned("run-a", 1, early, { file: "/x/agent-browser", surroundings: root() });
    await vi.advanceTimersByTimeAsync(250);
    early.exit();
    w.line("desktop.pages.engine.unready", { answered: "no", gone: "yes" });
    const first = w.engines()[0];
    expect(first?.answered()).toBe("none");
    // its socket never seen is said and not judged; its reads stand on the exit's word, and that is said
    expect(first?.stream()).toMatchObject({ verdict: "ok", socketSeen: false });
    expect(first?.stream().said?.[0]).toMatch(/never answered main/u);
    expect(first?.listeners()).toMatchObject({ verdict: "ok" });
    expect(first?.listeners().said?.[0]).toMatch(/the engine never answered main/u);
    const slow = new FakeChild();
    w.onSpawned("run-b", 1, slow, { file: "/x/agent-browser", surroundings: root() });
    w.line("desktop.pages.engine.unready", { answered: "no", gone: "no" });
    expect(w.engines()[1]?.answered()).toBe("none");
    // and the line is no answer of an engine that came before it
    expect(first?.answered()).toBe("none");
    slow.exit();
  });
});

describe("an engine that was not ready in time and took main's close (item 658, 2026-11-26)", () => {
  // Main ends an engine that was not ready in time by its ladder, whose first rung is a `close` sent
  // to the engine's socket. An engine that bound its socket late TAKES that connect: it answered
  // main. Nothing of it is waived, and "the engine never answered main" is said of it nowhere.
  const slow = async (w: ReturnType<typeof witness>) => {
    const child = new FakeChild();
    w.onSpawned("run-a", 1, child, { file: "/x/agent-browser", surroundings: root() });
    await vi.advanceTimersByTimeAsync(250);
    w.line("desktop.pages.engine.unready", { answered: "no", gone: "no" });
    const engine = w.engines().at(-1);
    if (engine === undefined) throw new Error("the engine was told");
    expect(engine.answered()).toBe("none");
    return { child, engine };
  };
  const UNWAIVED = {
    verdict: "blind",
    why: "the engine answered main and was gone before main read it: no read of its sockets has a control",
  };

  it("is one that answered, whatever came of the close once the connect was taken: its listeners have no waiver, and its unseen socket none", async () => {
    vi.useFakeTimers();
    // every word main's close line may say but `not-sent`: main's line does not tell a timeout
    // whose command was written from one whose connect never came, so a timeout is read as taken
    for (const answered of ["yes", "outcome-unknown", "timeout", "bad-reply", "too-large"]) {
      const w = witness();
      const { child, engine } = await slow(w);
      w.line("desktop.pages.engine.close", { answered });
      expect(engine.answered(), answered).toBe("gone");
      child.exit();
      await vi.advanceTimersByTimeAsync(300);
      expect(engine.listeners(), answered).toMatchObject(UNWAIVED);
      expect(engine.listeners().said, answered).toBeUndefined();
      // it made a socket (main connected to it) and no read saw one
      expect(engine.stream(), answered).toMatchObject({
        verdict: "blind",
        socketSeen: false,
        why: "the engine's own socket never showed in time: the folder read is not the engine's",
      });
    }
  });

  it("is told so though the close line follows its exit, as it may: the engine left on the close it took", async () => {
    vi.useFakeTimers();
    const w = witness();
    const { child, engine } = await slow(w);
    child.exit();
    w.line("desktop.pages.engine.close", { answered: "yes" });
    expect(engine.answered()).toBe("gone");
    await vi.advanceTimersByTimeAsync(300);
    expect(engine.listeners()).toMatchObject(UNWAIVED);
  });

  it("stays one that never answered when the close was never sent: the socket refused it, or was not there", async () => {
    vi.useFakeTimers();
    const w = witness();
    const { child, engine } = await slow(w);
    w.line("desktop.pages.engine.close", { answered: "not-sent" });
    expect(engine.answered()).toBe("none");
    child.exit();
    await vi.advanceTimersByTimeAsync(300);
    expect(engine.listeners()).toMatchObject({ verdict: "ok" });
    expect(engine.listeners().said?.[0]).toMatch(/the engine never answered main/u);
    // a line with no word of its own is no close that was taken
    const bare = witness();
    const second = await slow(bare);
    bare.line("desktop.pages.engine.close", {});
    expect(second.engine.answered()).toBe("none");
    second.child.exit();
  });

  it("changes nothing of an engine main had leased or refused: the close that ends one is no new answer", async () => {
    vi.useFakeTimers();
    const leased = witness();
    const a = new FakeChild();
    leased.onSpawned("run-a", 1, a, { file: "/x/agent-browser", surroundings: root() });
    leased.line("desktop.pages.engine.ready", { identity: "dev-source-build" });
    leased.line("desktop.pages.engine.close", { answered: "yes" });
    expect(leased.engines()[0]?.answered()).toBe("ready");
    a.exit();
    const refused = witness();
    const b = new FakeChild();
    refused.onSpawned("run-b", 1, b, { file: "/x/agent-browser", surroundings: root() });
    refused.line("desktop.pages.engine.refused", { reason: "stream-on" });
    refused.line("desktop.pages.engine.close", { answered: "yes" });
    expect(refused.engines()[0]?.answered()).toBe("refused");
    b.exit();
  });
});

describe("main's own line, and the foreign peer", () => {
  const answering = (data: Record<string, unknown>) =>
    vi.fn<typeof exchangeDaemon>(async () => ({ ok: true, reply: { success: true, data } }));
  const told = (w: ReturnType<typeof witness>, s: PagesSurroundings = root()) => {
    w.onSpawned("run-a", 1, new FakeChild(), { file: "/x/agent-browser", surroundings: s });
    const engine = w.engines().at(-1);
    if (engine === undefined) throw new Error("the engine was told");
    return engine;
  };

  it("sends session_info and nothing that needs a browser, and holds what the engine says of itself to the child", async () => {
    const exchange = answering({ backgroundPid: PID, browserLaunched: true });
    const w = witness({ exchange });
    const s = root();
    const engine = told(w, s);
    expect(await w.control(engine)).toEqual({ exchange: "answered", pid: "match", browser: true });
    const [path, command] = exchange.mock.calls[0] ?? [];
    expect(path).toBe(s.socketPath);
    expect(command).toMatchObject({ action: "session_info" });
    expect(Object.keys(command ?? {}).sort()).toEqual(["action", "id"]);
    const other = witness({ exchange: answering({ backgroundPid: 777777 }) });
    expect(await other.control(told(other))).toEqual({
      exchange: "answered",
      pid: "other",
      browser: null,
    });
    const refused = witness({
      exchange: vi.fn<typeof exchangeDaemon>(async () => ({ ok: true, reply: { success: false } })),
    });
    expect((await refused.control(told(refused))).exchange).toBe("refused");
    const silent = witness({
      exchange: vi.fn<typeof exchangeDaemon>(async () => ({ ok: false, failure: "not-sent" })),
    });
    expect((await silent.control(told(silent))).exchange).toBe("unanswered");
  });

  it("starts the probe as node by main's own executable, with an environment of three names built from nothing", async () => {
    vi.stubEnv("FIELD_TOKEN", "s3cret-value");
    const spawnProbe = vi.fn<SpawnProbe>(async () => ({
      connected: true,
      wrote: true,
      bytesRead: 0,
      closed: true,
      error: null,
      ms: 12,
    }));
    const exchange = answering({ backgroundPid: PID });
    const s = root();
    const readSockets = vi.fn(holding(s));
    const w = witness({
      exchange,
      spawnProbe,
      readSockets,
      mark: "vf-smoke-x",
      execPath: "/the/electron",
    });
    const got = await w.probePeer(told(w, s));
    expect(got).toMatchObject({
      verdict: "ok",
      foreignMs: 12,
      mainBefore: "answered",
      mainAfter: "answered",
    });
    // no path and no pid in what the leg says
    expect(JSON.stringify(got)).not.toContain(s.root);
    expect(JSON.stringify(got)).not.toContain(String(PID));
    // the kernel's lists, each asked once: main's own unix sockets, then the child's
    expect(readSockets.mock.calls.filter(([kind]) => kind === "unix")).toEqual([
      ["unix", MAIN_PID],
      ["unix", PID],
    ]);
    expect(got).toMatchObject({
      tie: "ok",
      mainPeers: 1,
      mainByPath: 0,
      childSockets: 1,
      ties: 1,
    });
    const [file, args, env] = spawnProbe.mock.calls[0] ?? [];
    expect(file).toBe("/the/electron");
    expect(args).toEqual(["-e", PAGES_WITNESS_PROBE, s.socketPath, "4000"]);
    expect(env).toEqual({
      ELECTRON_RUN_AS_NODE: "1",
      PATH: PAGES_ENGINE_PATH,
      VF_SMOKE_RUN: "vf-smoke-x",
    });
    // main's own line went before and after the probe: the sandwich
    expect(exchange).toHaveBeenCalledTimes(2);
    expect(PAGES_WITNESS_PROBE).toContain('action: "session_info"');
    expect(PAGES_WITNESS_PROBE).not.toMatch(/"url"|navigate|snapshot/u);
    vi.unstubAllEnvs();
  });

  it("lays main's own line before the foreign process and again after it, and only then holds a connection of main's open while the kernel's two lists are read", async () => {
    const order: string[] = [];
    const s = root();
    const exchange = vi.fn<typeof exchangeDaemon>(async () => {
      order.push("main's line");
      return { ok: true, reply: { success: true, data: { backgroundPid: PID } } };
    });
    const spawnProbe = vi.fn<SpawnProbe>(async () => {
      order.push("the foreign process");
      return { connected: true, wrote: false, bytesRead: 0, closed: true, error: null, ms: 3 };
    });
    const tie = holding(s);
    const readSockets = vi.fn(async (kind: "tcp" | "udp" | "unix", pid: number) => {
      if (kind === "unix") order.push(pid === MAIN_PID ? "main's unix sockets" : "the child's");
      return tie(kind, pid);
    });
    const connect = vi.fn(async (path: string) => {
      order.push(`held open:${path === s.socketPath ? "the session's socket" : "another"}`);
      return {
        close: () => {
          order.push("let go");
        },
        fd: HELD_FD,
        // asked once both lists are read, and before it is let go (item 658, 2026-11-27)
        open: () => {
          order.push("still open?");
          return true;
        },
      };
    });
    const w = witness({ exchange, spawnProbe, readSockets, connect });
    const engine = told(w, s);
    engine.quiet();
    const got = await w.probePeer(engine);
    expect(got.verdict).toBe("ok");
    expect(order.filter((step) => step !== "tcp")).toEqual([
      "main's line",
      "the foreign process",
      "main's line",
      "held open:the session's socket",
      "main's unix sockets",
      "the child's",
      "still open?",
      "let go",
    ]);
  });

  it("is blind when no socket of main's names one of the child's as its peer, when main's connection cannot be held, or when main's list cannot be read; and lets go of the connection all the same", async () => {
    const dropped: SpawnProbe = async () => ({
      connected: true,
      wrote: true,
      bytesRead: 0,
      closed: true,
      error: null,
      ms: 12,
    });
    const s = root();
    const exchange = answering({ backgroundPid: PID });
    // the child holds the session's socket, and main is connected to something else
    const strangers = async (kind: "tcp" | "udp" | "unix", pid: number): Promise<SocketRead> => ({
      seen: "read",
      lines:
        kind !== "unix"
          ? []
          : pid === MAIN_PID
            ? [{ name: "->0xffff", state: "none", device: "0xa1", fd: HELD_FD }]
            : [{ name: s.socketPath, state: "none", device: "0xc1" }],
    });
    const close = vi.fn();
    const untied = witness({
      exchange,
      spawnProbe: dropped,
      readSockets: strangers,
      connect: async () => ({ close, fd: HELD_FD, open: () => true }),
    });
    const got = await untied.probePeer(told(untied, s));
    expect(got).toMatchObject({
      verdict: "blind",
      tie: "blind",
      why: "the peer of main's held connection is no socket of the child's: main's connection is not tied to the child",
      ties: 0,
    });
    expect(JSON.stringify(got)).not.toMatch(/0x[0-9a-f]+/u);
    expect(close).toHaveBeenCalledTimes(1);
    // ANOTHER socket of main's names the child's socket, and the held connection names a stranger's:
    // the leg's own connection is the one that must be tied, found by its descriptor
    const letGo = vi.fn();
    const other = witness({
      exchange,
      spawnProbe: dropped,
      readSockets: async (kind, pid) => ({
        seen: "read",
        lines:
          kind !== "unix"
            ? []
            : pid === MAIN_PID
              ? [
                  { name: "->0xc1", state: "none", device: "0xa1", fd: 12 },
                  { name: "->0xffff", state: "none", device: "0xa2", fd: HELD_FD },
                ]
              : [{ name: s.socketPath, state: "none", device: "0xc1" }],
      }),
      connect: async () => ({ close: letGo, fd: HELD_FD, open: () => true }),
    });
    const others = await other.probePeer(told(other, s));
    expect(others).toMatchObject({
      verdict: "blind",
      tie: "blind",
      why: "the peer of main's held connection is no socket of the child's: main's connection is not tied to the child",
      mainPeers: 2,
      ties: 1,
    });
    expect(JSON.stringify(others)).not.toContain(String(HELD_FD));
    expect(letGo).toHaveBeenCalledTimes(1);
    // the held connection's own descriptor could not be read: nothing says which line is it
    const unnumbered = witness({
      exchange,
      spawnProbe: dropped,
      readSockets: holding(s),
      connect: async () => ({ close: () => undefined, fd: null, open: () => true }),
    });
    expect(await unnumbered.probePeer(told(unnumbered, s))).toMatchObject({
      verdict: "blind",
      tie: "blind",
      why: "the descriptor of main's held connection could not be read",
    });
    // an lsof that names main's peer by the socket's PATH and by no kernel address ties nothing:
    // how many of main's sockets it named so is counted, and neither the path nor an address is said
    const named = witness({
      exchange,
      spawnProbe: dropped,
      readSockets: async (kind, pid) => ({
        seen: "read",
        lines:
          kind !== "unix"
            ? []
            : pid === MAIN_PID
              ? [
                  { name: `->${s.socketPath}`, state: "none", device: "0xa1", fd: HELD_FD },
                  { name: `->/private${s.socketPath}`, state: "none", device: "0xa2" },
                  { name: `->${s.socketPath}.other`, state: "none", device: "0xa3" },
                ]
              : [{ name: s.socketPath, state: "none", device: "0xc1" }],
      }),
    });
    const byPath = await named.probePeer(told(named, s));
    expect(byPath).toMatchObject({
      verdict: "blind",
      tie: "blind",
      mainPeers: 0,
      mainByPath: 2,
      childSockets: 1,
    });
    expect(JSON.stringify(byPath)).not.toContain(s.root);
    // main's connection could not be opened: nothing to tie
    const unheld = witness({
      exchange,
      spawnProbe: dropped,
      readSockets: holding(s),
      connect: async () => null,
    });
    expect(await unheld.probePeer(told(unheld, s))).toMatchObject({
      verdict: "blind",
      tie: "blind",
      why: "main's own connection to the session's socket could not be held open",
    });
    const thrown = witness({
      exchange,
      spawnProbe: dropped,
      readSockets: holding(s),
      connect: async () => {
        throw new Error("ECONNREFUSED");
      },
    });
    expect((await thrown.probePeer(told(thrown, s))).tie).toBe("blind");
    // main's own list did not answer
    const closed = vi.fn();
    const unread = witness({
      exchange,
      spawnProbe: dropped,
      readSockets: async (kind, pid) =>
        kind === "unix" && pid === MAIN_PID
          ? { seen: "blind", why: "lsof could not be run" }
          : holding(s)(kind, pid),
      connect: async () => ({ close: closed, fd: HELD_FD, open: () => true }),
    });
    expect(await unread.probePeer(told(unread, s))).toMatchObject({
      verdict: "blind",
      tie: "blind",
    });
    expect(closed).toHaveBeenCalledTimes(1);
  });

  it("is blind when main's held connection is no longer open when it is asked, after both lists are read: the line that holds its number may then be nobody's (item 658, 2026-11-27)", async () => {
    const dropped: SpawnProbe = async () => ({
      connected: true,
      wrote: false,
      bytesRead: 0,
      closed: true,
      error: null,
      ms: 2,
    });
    const s = root();
    const close = vi.fn();
    // both lists tie, by the very number: only the connection's own word that it is no longer open
    // says the line with that number may be another socket's by now
    const w = witness({
      exchange: answering({ backgroundPid: PID }),
      spawnProbe: dropped,
      readSockets: holding(s),
      connect: async () => ({ close, fd: HELD_FD, open: () => false }),
    });
    expect(await w.probePeer(told(w, s))).toMatchObject({
      verdict: "blind",
      tie: "blind",
      // what is KNOWN, and no more (2026-11-27): it is asked once, after both lists are read, so it
      // may have been let go before main's read, between the two reads, or after both and before the
      // ask; the words name no time but the ask's
      why: "main's held connection was no longer open when it was asked, after both lists had been read",
      ties: 1,
    });
    expect(close).toHaveBeenCalledTimes(1);
    // asked AFTER both lists were read: a connection that was open when it was made and let go
    // during the reads is let go
    const asked: string[] = [];
    const late = witness({
      exchange: answering({ backgroundPid: PID }),
      spawnProbe: dropped,
      readSockets: async (kind, pid) => {
        if (kind === "unix") asked.push(pid === MAIN_PID ? "main" : "child");
        return holding(s)(kind, pid);
      },
      connect: async () => ({
        close: () => undefined,
        fd: HELD_FD,
        open: () => {
          asked.push("open?");
          return asked.filter((a) => a !== "open?").length < 2;
        },
      }),
    });
    expect(await late.probePeer(told(late, s))).toMatchObject({
      verdict: "blind",
      tie: "blind",
      why: "main's held connection was no longer open when it was asked, after both lists had been read",
    });
    expect(asked.at(-1)).toBe("open?");
    expect(asked.slice(0, 2)).toEqual(["main", "child"]);
  });

  it("reads main's own sockets by this process's pid when it is told no other: the product tells it none", async () => {
    const s = root();
    const readSockets = vi.fn(holding(s));
    const w = createPagesEngineWitness({
      readSockets,
      readSocketsNow: noSocketsNow,
      sourceBuildSha256: null,
      connect: async () => ({ close: () => undefined, fd: HELD_FD, open: () => true }),
      exchange: answering({ backgroundPid: PID }),
      spawnProbe: async () => ({
        connected: true,
        wrote: false,
        bytesRead: 0,
        closed: true,
        error: null,
        ms: 3,
      }),
    });
    disposers.push(() => w.dispose());
    w.onSpawned("run-a", 1, new FakeChild(), { file: "/x/agent-browser", surroundings: s });
    const engine = w.engines().at(-1);
    if (engine === undefined) throw new Error("the engine was told");
    await w.probePeer(engine);
    expect(readSockets.mock.calls.filter(([kind]) => kind === "unix")).toEqual([
      ["unix", process.pid],
      ["unix", PID],
    ]);
  });

  it("the real held connection: one connection to the socket, its own descriptor said, let go when closed; none where nothing listens", async () => {
    const s = root();
    const taken: import("node:net").Socket[] = [];
    let gone = 0;
    await new Promise<void>((resolve, reject) => {
      const server = createServer((socket) => {
        taken.push(socket);
        // read whatever comes, so that a byte sent on the held connection is counted
        socket.resume();
        socket.on("error", () => undefined);
        socket.on("close", () => {
          gone += 1;
        });
      });
      server.once("error", reject);
      server.listen(s.socketPath, () => {
        servers.push(server);
        resolve();
      });
    });
    const held = await holdPagesSocketOpen(s.socketPath);
    if (held === null) throw new Error("the connection was not held");
    await vi.waitFor(() => expect(taken).toHaveLength(1));
    // a descriptor of this process's own: a whole number past the three every process starts with
    expect(Number.isInteger(held.fd)).toBe(true);
    expect(held.fd).toBeGreaterThan(2);
    // and the CONNECTION'S OWN (item 658, 2026-11-27: the two lines above pass any number over 2):
    // a socket of this process while it is held, and the very descriptor its close gives back
    const fd = held.fd as number;
    expect(fstatSync(fd).isSocket()).toBe(true);
    const ino = fstatSync(fd).ino;
    expect(held.open()).toBe(true);
    // held: nothing was sent on it and it is still open, a while after it was taken
    await new Promise((resolve) => setTimeout(resolve, 60));
    expect(gone).toBe(0);
    expect(taken[0]?.bytesRead).toBe(0);
    expect(held.open()).toBe(true);
    held.close();
    // at once, before the other end has seen anything: the other end's own socket of this
    // connection, which this process holds too, is still open
    // (no descriptor there, or, if another thread of this process took the number in that instant,
    // another file's: never the connection's own any more)
    let after: number | null = null;
    try {
      after = fstatSync(fd).ino;
    } catch (error) {
      expect((error as NodeJS.ErrnoException).code).toBe("EBADF");
    }
    expect(after).not.toBe(ino);
    expect(held.open()).toBe(false);
    expect(gone).toBe(0);
    await vi.waitFor(() => expect(gone).toBe(1));
    // a connection the OTHER end lets go says so itself
    const second = await holdPagesSocketOpen(s.socketPath);
    if (second === null) throw new Error("the second connection was not held");
    await vi.waitFor(() => expect(taken).toHaveLength(2));
    expect(second.open()).toBe(true);
    taken[1]?.destroy();
    await vi.waitFor(() => expect(second.open()).toBe(false));
    second.close();
    // and a path nothing listens at holds nothing
    expect(await holdPagesSocketOpen(join(dirname(s.socketPath), "none.sock"))).toBeNull();
  });

  it("is blind when the socket is answered by another process than the child, by one that does not say its pid, or main's own line goes unanswered", async () => {
    const dropped: SpawnProbe = async () => ({
      connected: true,
      wrote: true,
      bytesRead: 0,
      closed: true,
      error: null,
      ms: 12,
    });
    const peer = async (deps: PagesEngineWitnessDeps) => {
      const s = root();
      const w = witness({ spawnProbe: dropped, readSockets: holding(s), ...deps });
      return w.probePeer(told(w, s));
    };
    expect((await peer({ exchange: answering({ backgroundPid: PID }) })).verdict).toBe("ok");
    expect((await peer({ exchange: answering({ backgroundPid: 777777 }) })).verdict).toBe("blind");
    // an answer with no pid in it ties the socket to nothing
    const unsaid = await peer({ exchange: answering({ browserLaunched: true }) });
    expect(unsaid.verdict).toBe("blind");
    expect(unsaid.why).toMatch(/did not say its pid/u);
    expect(
      (
        await peer({
          exchange: vi.fn<typeof exchangeDaemon>(async () => ({ ok: false, failure: "not-sent" })),
        })
      ).verdict,
    ).toBe("blind");
    expect(
      (await peer({ exchange: answering({ backgroundPid: PID }), spawnProbe: async () => null }))
        .verdict,
    ).toBe("blind");
  });

  it("is blind when the kernel's list of the child's unix sockets does not hold the session's socket", async () => {
    const dropped: SpawnProbe = async () => ({
      connected: true,
      wrote: true,
      bytesRead: 0,
      closed: true,
      error: null,
      ms: 12,
    });
    const exchange = answering({ backgroundPid: PID });
    // the child holds no socket there: whoever answers at the path, it is not shown to be the child
    const none = witness({ exchange, spawnProbe: dropped, readSockets: noSockets });
    const got = await none.probePeer(told(none));
    expect(got.verdict).toBe("blind");
    expect(got.why).toMatch(/holds no unix socket/u);
    // a read that did not answer
    const unread = witness({
      exchange,
      spawnProbe: dropped,
      readSockets: async () => ({ seen: "blind", why: "lsof could not be run" }),
    });
    expect((await unread.probePeer(told(unread))).verdict).toBe("blind");
    // a byte read by the stranger is red whatever the kernel's list says
    const answered = witness({
      exchange,
      spawnProbe: async () => ({
        connected: true,
        wrote: true,
        bytesRead: 37,
        closed: true,
        error: null,
        ms: 12,
      }),
      readSockets: noSockets,
    });
    expect((await answered.probePeer(told(answered))).verdict).toBe("red");
  });

  it("the real probe: answered is red, dropped is refused, held open is blind", async () => {
    const listen = (name: string, on: (socket: import("node:net").Socket) => void) =>
      new Promise<PagesSurroundings>((resolve, reject) => {
        const s = root();
        const server = createServer(on);
        // a bind that fails is the row's failure at once, with its cause
        server.once("error", (error) => reject(new Error(`${name}: ${error.message}`)));
        server.listen(s.socketPath, () => {
          servers.push(server);
          resolve(s);
        });
      });
    const answers = await listen("answers", (socket) => {
      socket.on("data", () => socket.end('{"success":true}\n'));
    });
    const drops = await listen("drops", (socket) => socket.destroy());
    const holds = await listen("holds", (socket) => {
      socket.on("data", () => undefined);
    });
    const verdict = async (s: PagesSurroundings) => {
      const w = witness({
        exchange: answering({ backgroundPid: PID }),
        probeMs: 400,
        readSockets: holding(s),
      });
      return (await w.probePeer(told(w, s))).verdict;
    };
    expect(await verdict(answers)).toBe("red");
    expect(await verdict(drops)).toBe("ok");
    expect(await verdict(holds)).toBe("blind");
    // no socket there at all: the probe never connects, which is no refusal
    expect(await verdict(root())).toBe("blind");
  }, 20_000);
});

describe("what the smoke reads of an engine besides its verdicts (item 658, 2026-11-26)", () => {
  it("takes main's own names for the lines, and keeps each line's reason and the ready line's identity", () => {
    const w = witness();
    const child = new FakeChild();
    w.onSpawned("run-a", 1, child, { file: "/x/agent-browser", surroundings: root() });
    // main says a part's line under its own `desktop.` name; a part's own name is the same line
    w.line("desktop.pages.engine.ready", { ms: 12, identity: "dev-source-build", stream: "off" });
    w.line("pages.engine.close", { answered: "yes" });
    expect(w.engines()[0]?.lines()).toEqual([
      { event: "pages.engine.ready", reason: null, identity: "dev-source-build" },
      { event: "pages.engine.close", reason: null, identity: null },
    ]);
    // a line said once the newest engine has exited is no engine's; the run keeps every line in order
    child.exit();
    w.line("desktop.pages.broker.stop", {});
    w.line("desktop.pages.engine.refused", { reason: "surroundings" });
    expect(w.engines()[0]?.lines()).toHaveLength(2);
    expect(w.said()).toEqual([
      { event: "pages.engine.ready", reason: null },
      { event: "pages.engine.close", reason: null },
      { event: "pages.broker.stop", reason: null },
      { event: "pages.engine.refused", reason: "surroundings" },
    ]);
  });

  it("looks at the socket's folder at the engine's first answer: an engine that answers and ends between two polls is still seen with its socket, and its plant", () => {
    vi.useFakeTimers();
    const w = witness();
    const s = root();
    const child = new FakeChild();
    w.plantFor("run-c");
    w.onSpawned("run-c", 1, child, { file: "/x/agent-browser", surroundings: s });
    vi.advanceTimersByTime(30);
    // the engine binds its socket, main reads its folder and refuses it, and the ladder ends it: all
    // inside one poll's gap
    writeFileSync(s.socketPath, "");
    w.line("desktop.pages.engine.refused", { reason: "stream-on" });
    rmSync(s.socketPath);
    vi.advanceTimersByTime(20);
    child.exit();
    const engine = w.engines()[0];
    expect(engine?.stream()).toMatchObject({ verdict: "ok", socketSeen: true, plantSeen: true });
    expect(engine?.plantAtAnswer()).toBe(true);
    // an engine with no plant, and one whose plant was gone by the answer, say false
    const plain = root();
    w.onSpawned("run-a", 1, new FakeChild(), { file: "/x/agent-browser", surroundings: plain });
    writeFileSync(plain.socketPath, "");
    w.line("desktop.pages.engine.ready", { ms: 1, identity: "dev-source-build" });
    expect(w.engines()[1]?.plantAtAnswer()).toBe(false);
    const gone = root();
    w.plantFor("run-d");
    w.onSpawned("run-d", 1, new FakeChild(), { file: "/x/agent-browser", surroundings: gone });
    rmSync(join(dirname(gone.socketPath), PAGES_WITNESS_PLANT));
    w.line("desktop.pages.engine.refused", { reason: "stream-on" });
    expect(w.engines()[2]?.plantAtAnswer()).toBe(false);
  });

  it("says whether the spawned file is the one a digest of its path names, and whether the engine's root is left, and nothing it says holds either path", () => {
    const w = witness();
    const s = root();
    const child = new FakeChild();
    w.onSpawned("run-a", 1, child, { file: "/stage/agent-browser", surroundings: s });
    const engine = w.engines()[0];
    if (engine === undefined) throw new Error("the engine was told");
    // asked by the SHA-256 of the path, so the asker never needs the path in its environment
    expect(engine.fileIs(sha256("/stage/agent-browser"))).toBe(true);
    expect(engine.fileIs(sha256("/elsewhere/agent-browser"))).toBe(false);
    expect(engine.fileIs("/stage/agent-browser")).toBe(false);
    expect(engine.rootLeft()).toBe(true);
    const said = () =>
      JSON.stringify([
        engine.identity(),
        engine.stream(),
        engine.pidFile(),
        engine.listeners(),
        engine.tcp("127.0.0.1:53211"),
        engine.udp("127.0.0.1:53211"),
        engine.attached("127.0.0.1:53211"),
        engine.answered(),
        engine.census([{ pid: PID, ppid: 1, name: "agent-browser" }]),
        engine.lines(),
        w.said(),
      ]);
    const alive = said();
    child.exit();
    rmSync(s.root, { recursive: true, force: true });
    expect(engine.rootLeft()).toBe(false);
    for (const text of [alive, said()]) {
      expect(text).not.toContain(s.root);
      expect(text).not.toContain("/stage");
      expect(text).not.toContain(String(PID));
    }
  });
});
