import type { ExecFileException } from "node:child_process";
import {
  chmodSync,
  existsSync,
  linkSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  realpathSync,
  rmSync,
  symlinkSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type {
  PagesBridgePort,
  PagesTargetsPort,
  PagesWindowsPort,
} from "../src/main/pages/broker/broker";
import type { EngineChild } from "../src/main/pages/broker/engine-supervisor";
import {
  createPagesBroker,
  type ExecFileLike,
  engineSpawnOptions,
  PAGES_DAEMON_KILL_FLAG,
  PAGES_WITNESS_FLAG,
  pagesDaemonKillAsked,
  pagesWitnessAsked,
  productionRunFile,
  productionSpawnEngine,
  productionStills,
  RUN_FILE_MAX_BUFFER,
  runFileOptions,
  type SpawnLike,
} from "../src/main/pages/broker/index";
import { resolvePackagedResources } from "../src/main/resources";

// EY-1 (2026-11-19): the broker as main makes it. The spawn and the runner are fakes: nothing here
// starts a process. Every build's socket parent is the test's own temp folder, never /tmp.

const env = { PATH: "/usr/bin:/bin", HOME: "/r/home" };
const UID = process.getuid?.() ?? 0;
const cleanup: string[] = [];

afterEach(() => {
  for (const dir of cleanup.splice(0)) rmSync(dir, { recursive: true, force: true });
});

/** A socket parent of the test's own. */
function parent(): string {
  const dir = mkdtempSync(join(tmpdir(), "vf-pages-index-"));
  chmodSync(dir, 0o700);
  cleanup.push(dir);
  return dir;
}

function ports() {
  const page = { held: false, onHeld: () => () => undefined };
  const targets: PagesTargetsPort = {
    lookup: () => ({ producerEpoch: 1, controlBindingRevision: 1, page }),
    parked: () => false,
    describe: () => null,
    pageClass: () => "own",
  };
  const bridge = {
    addRun: vi.fn((_run: string) => undefined),
    arm: vi.fn((_run: string) => ({ url: "ws://127.0.0.1:9/browser/route/key", epoch: 1 })),
    raced: () => false,
    revokeRun: vi.fn(async (_run: string) => undefined),
    grant: vi.fn(async () => ({ ok: true as const, targetId: "A".repeat(32) })),
    endGrant: vi.fn(async () => undefined),
    introduce: () => 0,
    refusals: () => [],
  } satisfies PagesBridgePort;
  // the call's window opens before the engine is asked for (2026-11-24), and closes when no engine comes
  const windows = {
    lease: vi.fn(),
    open: vi.fn(() => ({ ok: true })),
    close: vi.fn(() => null),
    closeCall: vi.fn(() => []),
  } as unknown as PagesWindowsPort;
  // the engine on the bridge at the epoch its launch armed (2026-11-24): these rows start none
  const link = { liveAt: vi.fn(() => true) };
  return { targets, bridge, link, windows };
}

describe("the engine's spawn", () => {
  it("makes the engine main's direct child, with exactly its env and cwd, every stream ignored", () => {
    const options = engineSpawnOptions("/r/cwd", env);
    expect(options).toEqual({
      cwd: "/r/cwd",
      env,
      detached: false,
      stdio: ["ignore", "ignore", "ignore"],
    });
    expect(options.env).not.toBe(env);
    const child = {} as EngineChild;
    const spawn = vi.fn<SpawnLike>(() => child);
    const start = productionSpawnEngine(spawn);
    const started = start("/pinned/agent-browser", [], { cwd: "/r/cwd", env });
    expect(started).toBe(child);
    expect(spawn).toHaveBeenCalledWith("/pinned/agent-browser", [], options);
  });
});

describe("the identity check's runner", () => {
  it("runs with exactly the env and cwd given, bounded in time and output", () => {
    expect(runFileOptions({ env, cwd: "/c", timeoutMs: 10_000 })).toEqual({
      cwd: "/c",
      env,
      timeout: 10_000,
      killSignal: "SIGKILL",
      maxBuffer: RUN_FILE_MAX_BUFFER,
      encoding: "utf8",
    });
  });

  it("answers the exit code, or null when the run was ended or never started", async () => {
    const answers: [ExecFileException | null, string, string][] = [
      [null, "agent-browser 0.41.0\n", ""],
      [Object.assign(new Error("exit 3"), { code: 3 }), "", "refused"],
      [Object.assign(new Error("ended"), { killed: true, signal: "SIGKILL" as const }), "", ""],
      [Object.assign(new Error("not started"), { code: "ENOENT" }), "", ""],
    ];
    const exec = vi.fn<ExecFileLike>((_file, _args, _options, done) => {
      const [error, stdout, stderr] = answers.shift() ?? [null, "", ""];
      done(error, stdout, stderr);
    });
    const run = productionRunFile(exec);
    const o = { env, cwd: "/c", timeoutMs: 5 };
    expect(await run("/e", ["--version"], o)).toEqual({
      code: 0,
      stdout: "agent-browser 0.41.0\n",
      stderr: "",
    });
    expect(await run("/e", ["--version"], o)).toMatchObject({ code: 3, stderr: "refused" });
    expect(await run("/e", ["--version"], o)).toMatchObject({ code: null });
    expect(await run("/e", ["--version"], o)).toMatchObject({ code: null });
  });
});

describe("a still's disk, as the product reads it (2026-11-24)", () => {
  /** A whole small PNG's first bytes: its signature and its IHDR, 3 wide and 2 high. */
  const PNG = Buffer.from([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0x0d, 0x49, 0x48, 0x44, 0x52, 0, 0, 0,
    3, 0, 0, 0, 2, 8, 6, 0, 0, 0,
  ]);

  it("says what lstat says of a path, never through a link, and null for nothing there", async () => {
    const stills = productionStills();
    const dir = realpathSync(parent());
    writeFileSync(join(dir, "file.png"), PNG);
    symlinkSync(join(dir, "file.png"), join(dir, "link.png"));
    expect(stills.uid).toBe(UID);
    expect(await stills.lstat(dir)).toEqual({ kind: "directory", uid: UID, mode: 0o700 });
    expect(await stills.lstat(join(dir, "file.png"))).toMatchObject({ kind: "file", uid: UID });
    expect(await stills.lstat(join(dir, "link.png"))).toMatchObject({ kind: "link" });
    expect(await stills.lstat(join(dir, "none.png"))).toBeNull();
    expect(stills.random(16)).toHaveLength(16);
    expect(Buffer.from(stills.random(16)).equals(Buffer.from(stills.random(16)))).toBe(false);
  });

  it("opens the written file by its handle, never through a link, and reads only its first bytes", async () => {
    const stills = productionStills();
    const dir = realpathSync(parent());
    const file = join(dir, "still.png");
    writeFileSync(file, PNG);
    expect(await stills.opened(file, 24)).toEqual({
      facts: { kind: "file", uid: UID, nlink: 1, size: PNG.length },
      head: new Uint8Array(PNG.subarray(0, 24)),
    });
    // a second name for the file is seen on its handle
    linkSync(file, join(dir, "again.png"));
    expect((await stills.opened(file, 24))?.facts.nlink).toBe(2);
    // a link at the name opens nothing, whatever it points at; nor does nothing, nor a folder's bytes
    symlinkSync(file, join(dir, "link.png"));
    expect(await stills.opened(join(dir, "link.png"), 24)).toBeNull();
    expect(await stills.opened(join(dir, "none.png"), 24)).toBeNull();
    mkdirSync(join(dir, "sub"));
    expect(await stills.opened(join(dir, "sub"), 24)).toMatchObject({
      facts: { kind: "directory" },
      head: new Uint8Array(0),
    });
  });

  it("removes a file by its name alone: a link goes, and what it pointed at stays", async () => {
    const stills = productionStills();
    const dir = realpathSync(parent());
    const kept = join(dir, "kept.png");
    writeFileSync(kept, PNG);
    symlinkSync(kept, join(dir, "link.png"));
    await stills.remove(join(dir, "link.png"));
    await stills.remove(join(dir, "none.png"));
    expect(existsSync(kept)).toBe(true);
    expect(readdirSync(dir)).toEqual(["kept.png"]);
    await stills.remove(kept);
    expect(readdirSync(dir)).toEqual([]);
  });
});

describe("createPagesBroker", () => {
  it("builds the broker with nothing started, and refuses a relative socket parent", () => {
    const spawn = vi.fn<SpawnLike>();
    const exec = vi.fn<ExecFileLike>();
    const broker = createPagesBroker({
      enginePath: () => "/pinned/agent-browser",
      packaged: false,
      appBundlePath: null,
      env: { FIELD_SOCKET_ALIAS_PARENT: parent() },
      ...ports(),
      spawn,
      exec,
    });
    expect(broker.stats()).toEqual({ engines: 0, starts: 0, exits: 0, raced: 0, calls: 0 });
    expect(spawn).not.toHaveBeenCalled();
    expect(exec).not.toHaveBeenCalled();
    expect(() =>
      createPagesBroker({
        enginePath: () => null,
        packaged: false,
        appBundlePath: null,
        env: { FIELD_SOCKET_ALIAS_PARENT: "tmp" },
        ...ports(),
      }),
    ).toThrow(/absolute/u);
  });

  it("answers a build with no engine UNAVAILABLE, minting no key and running nothing", async () => {
    const spawn = vi.fn<SpawnLike>();
    const exec = vi.fn<ExecFileLike>();
    const p = ports();
    const broker = createPagesBroker({
      enginePath: () => null,
      packaged: false,
      appBundlePath: null,
      env: { FIELD_SOCKET_ALIAS_PARENT: parent() },
      ...p,
      spawn,
      exec,
    });
    const answer = broker.control(
      {
        run: "run-1",
        surfaceId: "surface_0123456789abcdef",
        window: "read",
        command: { action: "snapshot" },
      },
      { signal: new AbortController().signal, deadlineAt: Date.now() + 5_000 },
    );
    await expect(answer).rejects.toMatchObject({ kind: "UNAVAILABLE", state: "not-installed" });
    expect(p.bridge.arm).not.toHaveBeenCalled();
    expect(spawn).not.toHaveBeenCalled();
    expect(exec).not.toHaveBeenCalled();
  });

  it("sweeps an earlier main's stale root first, and keeps no root of a refused start", async () => {
    const dir = parent();
    const uidFolder = join(dir, `vf-${UID}`);
    mkdirSync(uidFolder, { mode: 0o700 });
    chmodSync(uidFolder, 0o700);
    const stale = join(uidFolder, "pg-0123abcd");
    mkdirSync(stale);
    const anHourAgo = Date.now() / 1000 - 3600;
    utimesSync(stale, anHourAgo, anHourAgo);
    const spawn = vi.fn<SpawnLike>();
    const exec = vi.fn<ExecFileLike>();
    const broker = createPagesBroker({
      enginePath: () => join(dir, "no-engine-here"),
      packaged: false,
      appBundlePath: null,
      env: { FIELD_SOCKET_ALIAS_PARENT: dir },
      ...ports(),
      spawn,
      exec,
    });
    const answer = broker.control(
      {
        run: "run-1",
        surfaceId: "surface_0123456789abcdef",
        window: "read",
        command: { action: "snapshot" },
      },
      { signal: new AbortController().signal, deadlineAt: Date.now() + 5_000 },
    );
    await expect(answer).rejects.toMatchObject({ kind: "UNAVAILABLE", state: "engine-refused" });
    expect(readdirSync(uidFolder)).toEqual([]);
    expect(spawn).not.toHaveBeenCalled();
    expect(exec).not.toHaveBeenCalled();
  });

  it("answers a package on an Apple silicon Mac not-installed while the record names no staged engine (item 658, 2026-11-26)", async () => {
    const spawn = vi.fn<SpawnLike>();
    const exec = vi.fn<ExecFileLike>();
    const resources = resolvePackagedResources({
      resourcesPath: "/Applications/VibeField.app/Contents/Resources",
      electronExecPath: "/Applications/VibeField.app/Contents/MacOS/VibeField",
      platform: "darwin",
      arch: "arm64",
    });
    const broker = createPagesBroker({
      enginePath: () => resources.pagesEnginePath,
      packaged: true,
      appBundlePath: null,
      env: { FIELD_SOCKET_ALIAS_PARENT: parent() },
      ...ports(),
      spawn,
      exec,
    });
    const answer = broker.control(
      {
        run: "run-1",
        surfaceId: "surface_0123456789abcdef",
        window: "read",
        command: { action: "snapshot" },
      },
      { signal: new AbortController().signal, deadlineAt: Date.now() + 5_000 },
    );
    await expect(answer).rejects.toMatchObject({ kind: "UNAVAILABLE", state: "not-installed" });
    expect(spawn).not.toHaveBeenCalled();
    expect(exec).not.toHaveBeenCalled();
  });
});

describe("the pages witness's flag (item 658, 2026-11-26)", () => {
  it("is asked only by a smoke run's mark AND its own flag, a whole word on the command line", () => {
    const mark = { VF_SMOKE_RUN: "run-1" };
    expect(PAGES_WITNESS_FLAG).toBe("--pages");
    // no mark, or an empty one: the flag alone asks for nothing
    expect(pagesWitnessAsked({}, ["electron", ".", "--pages"])).toBe(false);
    expect(pagesWitnessAsked({ VF_SMOKE_RUN: "" }, ["electron", ".", "--pages"])).toBe(false);
    // the mark alone asks for nothing
    expect(pagesWitnessAsked(mark, ["electron", ".", "--smoke-canvas"])).toBe(false);
    // a whole word, never a prefix: the engine kill's flag begins with it and is another switch
    expect(pagesWitnessAsked(mark, ["electron", ".", PAGES_DAEMON_KILL_FLAG])).toBe(false);
    expect(pagesWitnessAsked(mark, ["electron", ".", "--pages-witness"])).toBe(false);
    expect(pagesWitnessAsked(mark, ["electron", ".", "--pages=1"])).toBe(false);
    expect(pagesWitnessAsked(mark, ["electron", ".", "--smoke-canvas", "--pages"])).toBe(true);
    // and neither switch asks for the other
    expect(pagesDaemonKillAsked(mark, ["electron", ".", "--pages"])).toBe(false);
  });
});
