import { afterEach, describe, expect, it, vi } from "vitest";
import {
  LSOF,
  LSOF_ENV,
  LSOF_MAX_BUFFER,
  LSOF_NOW_TIMEOUT_MS,
  LSOF_TIMEOUT_MS,
  lsofArgs,
  type RunTool,
  readSockets,
  readSocketsNow,
  runLsof,
  type ToolRun,
} from "../src/testing/pages-listeners";

// Item 658 (2026-11-26): the pages smoke reads the sockets of TWO processes, the engine child main
// spawned and main itself, through lsof by its absolute path. Every output here is written by hand
// in lsof's default columns: nothing is run, and no process is read. The product's own spawner is
// run against a stand-in for node's `execFile`, so the file it runs and the environment it hands it
// are held here and not only the arguments its caller builds.

const execFile = vi.hoisted(() => vi.fn());
const spawnSync = vi.hoisted(() => vi.fn());
vi.mock("node:child_process", () => ({ execFile, spawnSync }));

afterEach(() => {
  execFile.mockReset();
  spawnSync.mockReset();
  vi.unstubAllEnvs();
});

const PID = 4242;
const HEADER = "COMMAND     PID    USER   FD   TYPE             DEVICE SIZE/OFF NODE NAME";
const row = (pid: number, node: "TCP" | "UDP", name: string, type = "IPv4") =>
  `Electron  ${pid} someone   45u  ${type} 0x7b1c2f3a4d5e6f70      0t0  ${node} ${name}`;
const answer = (...lines: string[]): ToolRun => ({
  status: 0,
  signal: null,
  stdout: `${[HEADER, ...lines].join("\n")}\n`,
  stderr: "",
  error: null,
});
const nothing: ToolRun = { status: 1, signal: null, stdout: "", stderr: "", error: null };
const tool = (said: ToolRun) => vi.fn<RunTool>(async () => said);

describe("the three calls (item 658, 2026-11-26)", () => {
  it("are lsof by its absolute path, on the one pid given, with an environment built from nothing", async () => {
    expect(LSOF).toBe("/usr/sbin/lsof");
    expect(LSOF_ENV).toEqual({ PATH: "/usr/sbin:/usr/bin:/bin" });
    expect(Object.isFrozen(LSOF_ENV)).toBe(true);
    // main's form asks for listeners alone; the engine's asks for every TCP socket, so its own
    // connection to main's bridge shows on the same read; the third asks for UDP
    expect(lsofArgs("listen", PID)).toEqual(["-nP", "-a", "-p", "4242", "-iTCP", "-sTCP:LISTEN"]);
    expect(lsofArgs("tcp", PID)).toEqual(["-nP", "-a", "-p", "4242", "-iTCP"]);
    expect(lsofArgs("udp", PID)).toEqual(["-nP", "-a", "-p", "4242", "-iUDP"]);
    // and one read of the engine child's unix sockets: who holds the session's socket, by the kernel
    expect(lsofArgs("unix", PID)).toEqual(["-nP", "-a", "-p", "4242", "-U"]);
    for (const kind of ["listen", "tcp", "udp", "unix"] as const) {
      const run = tool(nothing);
      await readSockets(kind, PID, run);
      expect(run.mock.calls).toEqual([
        [
          "/usr/sbin/lsof",
          lsofArgs(kind, PID),
          { env: LSOF_ENV, timeout: LSOF_TIMEOUT_MS, maxBuffer: LSOF_MAX_BUFFER },
        ],
      ]);
    }
    expect(LSOF_TIMEOUT_MS).toBe(10_000);
    expect(LSOF_MAX_BUFFER).toBe(1024 * 1024);
  });

  it("refuse anything that is not one process's pid before lsof is run", async () => {
    for (const pid of [0, -1, 1.5, Number.NaN, 2 ** 31, Number.POSITIVE_INFINITY]) {
      const run = tool(answer(row(PID, "TCP", "127.0.0.1:1 (LISTEN)")));
      expect(await readSockets("listen", pid, run), String(pid)).toEqual({
        seen: "blind",
        why: "not a pid",
      });
      expect(run).not.toHaveBeenCalled();
    }
  });
});

describe("main's form: listeners alone", () => {
  it("reads a listener by its address, IPv6 and the wildcard the same as IPv4", async () => {
    const run = tool(
      answer(
        row(PID, "TCP", "127.0.0.1:53211 (LISTEN)"),
        row(PID, "TCP", "[::1]:9000 (LISTEN)", "IPv6"),
        row(PID, "TCP", "[::]:8080 (LISTEN)", "IPv6"),
        row(PID, "TCP", "*:8081 (LISTEN)"),
      ),
    );
    expect(await readSockets("listen", PID, run)).toEqual({
      seen: "read",
      lines: [
        { name: "127.0.0.1:53211", state: "listen" },
        { name: "[::1]:9000", state: "listen" },
        { name: "[::]:8080", state: "listen" },
        { name: "*:8081", state: "listen" },
      ],
    });
  });

  it("reads lsof's exit 1 with nothing said as no socket, and never tells a pid", async () => {
    expect(await readSockets("listen", PID, tool(nothing))).toEqual({ seen: "read", lines: [] });
    const read = await readSockets(
      "listen",
      PID,
      tool(answer(row(PID, "TCP", "127.0.0.1:53211 (LISTEN)"))),
    );
    expect(JSON.stringify(read)).not.toContain(String(PID));
  });

  it("is blind, never empty, whenever lsof did not plainly answer", async () => {
    const blind = async (said: ToolRun) => (await readSockets("listen", PID, tool(said))).seen;
    // exit 1 WITH something on stderr is lsof refusing, not lsof finding nothing
    expect(await blind({ ...nothing, stderr: "lsof: no process ID specified\n" })).toBe("blind");
    // the tool is not there, or it was stopped at its bound, or it died of a signal
    expect(await blind({ ...nothing, status: null, error: "ENOENT" })).toBe("blind");
    expect(await blind({ ...nothing, status: null, error: "ETIMEDOUT" })).toBe("blind");
    expect(await blind({ ...nothing, status: null, signal: "SIGTERM" })).toBe("blind");
    expect(await blind({ ...nothing, status: 2 })).toBe("blind");
    // lsof warned of something while it answered: what it listed may not be the whole of it
    expect(
      await blind({
        ...answer(row(PID, "TCP", "127.0.0.1:53211 (LISTEN)")),
        stderr: "lsof: WARNING\n",
      }),
    ).toBe("blind");
    // exit 0 is lsof saying it found something: with no socket line it said nothing we can read
    expect(await blind({ ...nothing, status: 0, stdout: `${HEADER}\n` })).toBe("blind");
    // a line of ANOTHER process: the read is not of the pid that was asked
    expect(await blind(answer(row(PID + 1, "TCP", "127.0.0.1:53211 (LISTEN)")))).toBe("blind");
    // a line that is not a socket line of the asked kind
    expect(await blind(answer("garbage that is no lsof line"))).toBe("blind");
    expect(await blind(answer(row(PID, "UDP", "*:5353")))).toBe("blind");
    // a TCP line with no state after its address cannot be told a listener from a connection
    expect(await blind(answer(row(PID, "TCP", "127.0.0.1:53211")))).toBe("blind");
  });
});

describe("the engine's form: every TCP socket", () => {
  it("tells a connection from a listener by lsof's own state word", async () => {
    const run = tool(
      answer(
        row(PID, "TCP", "127.0.0.1:53300->127.0.0.1:53211 (ESTABLISHED)"),
        row(PID, "TCP", "127.0.0.1:53999 (LISTEN)"),
        row(PID, "TCP", "127.0.0.1:53301->127.0.0.1:53211 (CLOSED)"),
      ),
    );
    expect(await readSockets("tcp", PID, run)).toEqual({
      seen: "read",
      lines: [
        { name: "127.0.0.1:53300->127.0.0.1:53211", state: "established" },
        { name: "127.0.0.1:53999", state: "listen" },
        { name: "127.0.0.1:53301->127.0.0.1:53211", state: "other" },
      ],
    });
  });
});

describe("the UDP read", () => {
  it("reads each socket by its address, with its peer when it has one", async () => {
    expect(await readSockets("udp", PID, tool(nothing))).toEqual({ seen: "read", lines: [] });
    const run = tool(
      answer(row(PID, "UDP", "*:5353"), row(PID, "UDP", "127.0.0.1:50000->127.0.0.1:53")),
    );
    expect(await readSockets("udp", PID, run)).toEqual({
      seen: "read",
      lines: [
        { name: "*:5353", state: "none" },
        { name: "127.0.0.1:50000->127.0.0.1:53", state: "none" },
      ],
    });
    // a TCP line where UDP was asked: not the read that was asked for
    expect(
      (await readSockets("udp", PID, tool(answer(row(PID, "TCP", "*:1 (LISTEN)"))))).seen,
    ).toBe("blind");
  });
});

describe("the unix read: the sockets the engine child holds (item 658, 2026-11-26)", () => {
  const SOCKET = "/tmp/vf-501/pg-0a1b2c3d/sock/namespaces/pages/run/0123456789abcdef.sock";
  // lsof's line for a unix socket has no NODE: the name follows SIZE/OFF, and a socket with no name has none
  const unix = (pid: number, name: string, device = "0x7b1c2f3a4d5e6f70", fd = "7u") =>
    `agent-bro ${pid} someone    ${fd}  unix ${device}      0t0      ${name}`.trimEnd();

  it("reads each socket by its name (a bound path, a peer's address, or nothing) and by its own kernel address, lsof's DEVICE column", async () => {
    const run = tool(
      answer(
        unix(PID, SOCKET),
        unix(PID, "->0x7b1c2f3a4d5e6f72", "0x7b1c2f3a4d5e6f71"),
        unix(PID, "", "0xa"),
      ),
    );
    expect(await readSockets("unix", PID, run)).toEqual({
      seen: "read",
      lines: [
        { name: SOCKET, state: "none", device: "0x7b1c2f3a4d5e6f70", fd: 7 },
        { name: "->0x7b1c2f3a4d5e6f72", state: "none", device: "0x7b1c2f3a4d5e6f71", fd: 7 },
        { name: "", state: "none", device: "0xa", fd: 7 },
      ],
    });
    expect(await readSockets("unix", PID, tool(nothing))).toEqual({ seen: "read", lines: [] });
  });

  it("keeps no kernel address that is not one: a line whose DEVICE is anything else is read by its name alone", async () => {
    for (const device of ["1,5", "0x", "0xZZ", "7b1c", "->0x7b1c"]) {
      const got = await readSockets("unix", PID, tool(answer(unix(PID, SOCKET, device))));
      expect(got, device).toEqual({
        seen: "read",
        lines: [{ name: SOCKET, state: "none", fd: 7 }],
      });
    }
  });

  it("keeps the line's own descriptor, lsof's FD column, when it is one: a number, then its mode and its lock if any; anything else is no descriptor", async () => {
    // main's held connection is found in main's own list by this number, and by nothing else
    const fds: [string, number | undefined][] = [
      ["23u", 23],
      ["5r", 5],
      ["12uW", 12],
      ["0u", 0],
      ["9", 9],
      ["cwd", undefined],
      ["txt", undefined],
      ["u7", undefined],
      ["7uWW", undefined],
      ["-1u", undefined],
    ];
    for (const [fd, want] of fds) {
      const got = await readSockets("unix", PID, tool(answer(unix(PID, SOCKET, "0xa", fd))));
      expect(got, fd).toEqual({
        seen: "read",
        lines: [
          want === undefined
            ? { name: SOCKET, state: "none", device: "0xa" }
            : { name: SOCKET, state: "none", device: "0xa", fd: want },
        ],
      });
    }
  });

  it("is blind on a line of another process, a line that is no unix socket, or anything lsof said beside its answer", async () => {
    const blind = async (said: ToolRun) => (await readSockets("unix", PID, tool(said))).seen;
    expect(await blind(answer(unix(PID + 1, SOCKET)))).toBe("blind");
    expect(await blind(answer(row(PID, "TCP", "127.0.0.1:53211 (LISTEN)")))).toBe("blind");
    expect(await blind(answer("garbage that is no lsof line"))).toBe("blind");
    expect(await blind({ ...answer(unix(PID, SOCKET)), stderr: "lsof: WARNING\n" })).toBe("blind");
    // a unix socket line where TCP was asked is not the read that was asked for
    expect((await readSockets("tcp", PID, tool(answer(unix(PID, SOCKET))))).seen).toBe("blind");
  });
});

describe("the product's own spawner (item 658, 2026-11-26)", () => {
  type Done = (error: unknown, stdout: string, stderr: string) => void;
  const answers = (error: unknown, stdout = "", stderr = "") =>
    execFile.mockImplementation((_file: string, _args: string[], _options: object, done: Done) => {
      done(error, stdout, stderr);
    });

  it("runs the file it is handed, with the arguments and the environment it is handed and nothing of main's", async () => {
    vi.stubEnv("FIELD_TOKEN", "s3cret-value");
    answers(null, "out", "");
    const said = await runLsof("/usr/sbin/lsof", ["-nP", "-a"], {
      env: { PATH: "/usr/sbin" },
      timeout: 5,
      maxBuffer: 7,
    });
    expect(said).toEqual({ status: 0, signal: null, stdout: "out", stderr: "", error: null });
    expect(execFile).toHaveBeenCalledTimes(1);
    const [file, args, options] = execFile.mock.calls[0] ?? [];
    expect(file).toBe("/usr/sbin/lsof");
    expect(args).toEqual(["-nP", "-a"]);
    expect(options).toEqual({
      env: { PATH: "/usr/sbin" },
      timeout: 5,
      // the bound ends lsof whatever it does with a plain stop: a read nobody ends is waited for ever
      killSignal: "SIGKILL",
      maxBuffer: 7,
      encoding: "utf8",
    });
  });

  it("is what a read with no runner of its own goes through: lsof by its absolute path, never by a name", async () => {
    vi.stubEnv("PATH", "/somewhere/planted:/usr/bin");
    answers(Object.assign(new Error("exit 1"), { code: 1 }));
    expect(await readSockets("tcp", PID)).toEqual({ seen: "read", lines: [] });
    const [file, args, options] = execFile.mock.calls[0] ?? [];
    expect(file).toBe("/usr/sbin/lsof");
    expect(args).toEqual(["-nP", "-a", "-p", "4242", "-iTCP"]);
    expect(options).toEqual({
      env: { PATH: "/usr/sbin:/usr/bin:/bin" },
      timeout: 10_000,
      killSignal: "SIGKILL",
      maxBuffer: 1024 * 1024,
      encoding: "utf8",
    });
  });

  it("says a run's end as it was: its own exit code, a spawn's failure by its code, its bound, a signal", async () => {
    answers(Object.assign(new Error("exit 1"), { code: 1 }), "", "");
    expect(await runLsof(LSOF, [], { env: LSOF_ENV, timeout: 1, maxBuffer: 1 })).toEqual({
      status: 1,
      signal: null,
      stdout: "",
      stderr: "",
      error: null,
    });
    answers(Object.assign(new Error("spawn ENOENT"), { code: "ENOENT" }));
    expect(await runLsof(LSOF, [], { env: LSOF_ENV, timeout: 1, maxBuffer: 1 })).toMatchObject({
      status: null,
      error: "ENOENT",
    });
    answers(Object.assign(new Error("killed"), { killed: true, signal: "SIGTERM", code: null }));
    expect(await runLsof(LSOF, [], { env: LSOF_ENV, timeout: 1, maxBuffer: 1 })).toMatchObject({
      status: null,
      signal: "SIGTERM",
      error: "ETIMEDOUT",
    });
    answers(Object.assign(new Error("died"), { killed: false, signal: "SIGKILL", code: null }));
    expect(await runLsof(LSOF, [], { env: LSOF_ENV, timeout: 1, maxBuffer: 1 })).toMatchObject({
      status: null,
      signal: "SIGKILL",
      error: "failed",
    });
    // each of them is a read that did not plainly answer, but the plain exit 1
    for (const error of [
      Object.assign(new Error("spawn ENOENT"), { code: "ENOENT" }),
      Object.assign(new Error("killed"), { killed: true, signal: "SIGTERM", code: null }),
      Object.assign(new Error("died"), { killed: false, signal: "SIGKILL", code: null }),
      Object.assign(new Error("exit 2"), { code: 2 }),
    ]) {
      answers(error);
      expect((await readSockets("udp", PID)).seen).toBe("blind");
    }
  });
});

describe("the read that is taken at once (item 658, 2026-11-26)", () => {
  // An engine main refuses is ended within tens of milliseconds, and a waited read is a process of
  // its own that takes longer: the witness reads such an engine inside main's own refusal line,
  // through the spawner that does not return until lsof has ended.
  const ended = (
    o: Partial<Record<"status" | "signal" | "stdout" | "stderr" | "error", unknown>>,
  ) => spawnSync.mockReturnValue({ status: 0, signal: null, stdout: "", stderr: "", ...o });

  it("is lsof by its absolute path with the same arguments and the same environment built from nothing, under a shorter bound, and nothing is waited for", () => {
    vi.stubEnv("PATH", "/somewhere/planted:/usr/bin");
    vi.stubEnv("FIELD_TOKEN", "s3cret-value");
    for (const kind of ["tcp", "unix"] as const) {
      spawnSync.mockReset();
      ended({ status: 1 });
      // the answer itself, no promise of one
      expect(readSocketsNow(kind, PID)).toEqual({ seen: "read", lines: [] });
      expect(spawnSync.mock.calls).toEqual([
        [
          "/usr/sbin/lsof",
          lsofArgs(kind, PID),
          {
            env: { PATH: "/usr/sbin:/usr/bin:/bin" },
            timeout: 2000,
            // SIGTERM is lsof's to ignore, and main's own thread waits on this run
            killSignal: "SIGKILL",
            maxBuffer: 1024 * 1024,
            encoding: "utf8",
            stdio: ["ignore", "pipe", "pipe"],
          },
        ],
      ]);
    }
    expect(LSOF_NOW_TIMEOUT_MS).toBe(2000);
    expect(execFile).not.toHaveBeenCalled();
  });

  it("reads the lines the waited read reads: a listener, a connection, a unix socket by its name", () => {
    ended({
      stdout: `${[HEADER, row(PID, "TCP", "127.0.0.1:9223 (LISTEN)"), row(PID, "TCP", "127.0.0.1:50001->127.0.0.1:53211 (ESTABLISHED)")].join("\n")}\n`,
    });
    expect(readSocketsNow("tcp", PID)).toEqual({
      seen: "read",
      lines: [
        { name: "127.0.0.1:9223", state: "listen" },
        { name: "127.0.0.1:50001->127.0.0.1:53211", state: "established" },
      ],
    });
    ended({
      stdout: `${HEADER}\nagent-bro ${PID} someone    7u  unix 0x7b1c2f3a4d5e6f70      0t0      /tmp/pg-1/sock/run/a.sock\n`,
    });
    expect(readSocketsNow("unix", PID)).toEqual({
      seen: "read",
      lines: [
        { name: "/tmp/pg-1/sock/run/a.sock", state: "none", device: "0x7b1c2f3a4d5e6f70", fd: 7 },
      ],
    });
  });

  it("is blind, never empty, whenever lsof did not plainly answer: its bound, a failed spawn, a signal, a word on stderr, another exit, a line of another process, a spawner that throws", () => {
    const blinds: [Parameters<typeof ended>[0], string][] = [
      [
        {
          status: null,
          signal: "SIGTERM",
          error: Object.assign(new Error("t"), { code: "ETIMEDOUT" }),
        },
        "lsof could not be run (ETIMEDOUT)",
      ],
      [
        { status: null, error: Object.assign(new Error("spawn"), { code: "ENOENT" }) },
        "lsof could not be run (ENOENT)",
      ],
      [{ status: null, error: new Error("no code") }, "lsof could not be run (failed)"],
      [{ status: null, signal: "SIGKILL" }, "lsof was stopped"],
      [{ status: 1, stderr: "lsof: no pwd entry" }, "lsof said something beside its answer"],
      [{ status: 1, stdout: "something" }, "lsof failed"],
      [{ status: 2 }, "lsof failed"],
      [
        { stdout: `${HEADER}\n${row(PID + 1, "TCP", "127.0.0.1:1 (LISTEN)")}\n` },
        "lsof wrote a line that is no socket of the process asked",
      ],
      [{ stdout: `${HEADER}\n` }, "lsof said it found sockets and listed none"],
    ];
    for (const [end, why] of blinds) {
      spawnSync.mockReset();
      ended(end);
      expect(readSocketsNow("tcp", PID), why).toEqual({ seen: "blind", why });
    }
    spawnSync.mockReset();
    spawnSync.mockImplementation(() => {
      throw new Error("the spawner threw");
    });
    expect(readSocketsNow("tcp", PID)).toEqual({ seen: "blind", why: "lsof could not be run" });
    // and nothing is run for what is no pid
    spawnSync.mockReset();
    for (const pid of [0, -1, 1.5, Number.NaN, 2 ** 31]) {
      expect(readSocketsNow("tcp", pid)).toEqual({ seen: "blind", why: "not a pid" });
    }
    expect(spawnSync).not.toHaveBeenCalled();
  });
});
