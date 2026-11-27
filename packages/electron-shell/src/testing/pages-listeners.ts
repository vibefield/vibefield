// Item 658 (2026-11-26) — THE PAGES SMOKE'S SOCKET READ. The smoke proves the page engine holds no
// TCP listener by reading the sockets of TWO processes and no other: the engine child main spawned,
// and main itself (the control: main's bridge must show, or the read sees nothing). It reads them
// through lsof, by its absolute path and with an environment built from nothing, since a process
// of this uid could put another `lsof` first on a PATH. Four calls:
// - "listen", main's form: `-iTCP -sTCP:LISTEN`, listeners alone.
// - "tcp", the engine's form: `-iTCP` with no state filter, so the engine's own connection to
//   main's bridge shows on the very read that must show no listener.
// - "udp": `-iUDP`, once, since a stream on UDP is no TCP listener.
// - "unix": `-U`, the unix sockets of the engine child and, at the peer leg, of main: the kernel's
//   own list, where the answering process's word of its pid is only its word. lsof names such a
//   socket by the address it is BOUND at (a path) or by its peer's kernel address (`->0x…`), and
//   gives each socket's own kernel address in its DEVICE column.
// What is kept of a line is its address and its state word, and of a unix socket its own kernel
// address. Never a pid, a user or a command. A unix socket's address is a local path and its kernel
// address a number of this boot: both are compared where they are read and said by nobody.
//
// A read is "read" (with its lines, possibly none) or "blind". lsof exits 1 both when the process
// has no such socket and when there is no such process, so an empty read says little by itself:
// the judges (pages-witness-judge.ts) count one only between two sightings of the child alive.
//
// Two forms of the same read. `readSockets` is waited for. `readSocketsNow` returns only when lsof
// has ended, for the one place a waited read cannot serve: an engine main refuses is ended within
// tens of milliseconds, so the witness reads it inside main's own refusal line. Same file, same
// arguments, same environment, same reading of the answer; a shorter bound, since main waits on it.

import { execFile, execFileSync, spawnSync } from "node:child_process";

export const LSOF = "/usr/sbin/lsof";
export const LSOF_ENV: Readonly<Record<string, string>> = Object.freeze({
  PATH: "/usr/sbin:/usr/bin:/bin",
});
export const LSOF_TIMEOUT_MS = 10_000;
/** The bound of a read taken at once: main's own thread waits on it. */
export const LSOF_NOW_TIMEOUT_MS = 2000;
export const LSOF_MAX_BUFFER = 1024 * 1024;

/** THE CENSUS'S `ps`, FOR THIS SMOKE. Two of the smoke's legs stand on the house census of the
 * run's processes (smoke-census.mjs), whose own spawner runs `ps` by name with main's whole
 * environment. Handed to it in that spawner's place: `ps` by its absolute path, with the same
 * environment built from nothing as lsof has, for the same reason. */
export const PS = "/bin/ps";
export const PS_MAX_BUFFER = 256 * 1024 * 1024;
/** The census's bound: main's own thread waits on it, so the bound ends it. */
export const PS_TIMEOUT_MS = 10_000;
export const runPs = (args: readonly string[]): string =>
  execFileSync(PS, [...args], {
    encoding: "utf8",
    maxBuffer: PS_MAX_BUFFER,
    env: { ...LSOF_ENV },
    timeout: PS_TIMEOUT_MS,
    killSignal: "SIGKILL",
  });

export type SocketKind = "listen" | "tcp" | "udp" | "unix";

/** What one run of a tool came to. `error` is a spawn's failure by its code (ENOENT), or ETIMEDOUT
 * when the run was stopped at its bound; `status` is the exit code of a run that ended by itself. */
export interface ToolRun {
  readonly status: number | null;
  readonly signal: string | null;
  readonly stdout: string;
  readonly stderr: string;
  readonly error: string | null;
}

export type RunTool = (
  file: string,
  args: readonly string[],
  options: {
    readonly env: Readonly<Record<string, string>>;
    readonly timeout: number;
    readonly maxBuffer: number;
  },
) => Promise<ToolRun>;

/** The same run, returned only when the tool has ended. */
export type RunToolNow = (...run: Parameters<RunTool>) => ToolRun;

/** One socket: its address as lsof names it (with `->peer` for a connection), and its TCP state.
 * A unix socket has its own kernel address too, when lsof gave one, and its own descriptor in its
 * process, when lsof's FD column is one. */
export interface SocketLine {
  readonly name: string;
  readonly state: "listen" | "established" | "other" | "none";
  readonly device?: string;
  readonly fd?: number;
}

/** A kernel address as lsof prints one. */
const KERNEL_ADDRESS = /^0x[0-9a-f]+$/u;
/** A descriptor as lsof's FD column prints one: its number, then its mode and its lock if any. */
const DESCRIPTOR = /^(\d+)[A-Za-z-]{0,2}$/u;

export type SocketRead =
  | { readonly seen: "read"; readonly lines: readonly SocketLine[] }
  | { readonly seen: "blind"; readonly why: string };

/** A pid as the system counts one: a whole number above 0 that fits its 32 bits. */
const PID_MAX = 0x7fff_ffff;

export function lsofArgs(kind: SocketKind, pid: number): string[] {
  const one = ["-nP", "-a", "-p", String(pid)];
  if (kind === "listen") return [...one, "-iTCP", "-sTCP:LISTEN"];
  if (kind === "unix") return [...one, "-U"];
  return [...one, kind === "tcp" ? "-iTCP" : "-iUDP"];
}

/** The product spelling of the spawner: the tool's own exit, never a shell. */
export const runLsof: RunTool = (file, args, options) =>
  new Promise((resolve) => {
    execFile(
      file,
      [...args],
      {
        env: { ...options.env },
        timeout: options.timeout,
        // a read nobody ends is waited for ever: the bound ends lsof whatever it does with a plain stop
        killSignal: "SIGKILL",
        maxBuffer: options.maxBuffer,
        encoding: "utf8",
      },
      (error, stdout, stderr) => {
        if (error === null) {
          resolve({ status: 0, signal: null, stdout, stderr, error: null });
          return;
        }
        const exit = typeof error.code === "number" ? error.code : null;
        const why = error.killed ? "ETIMEDOUT" : String(error.code ?? "failed");
        resolve({
          status: exit,
          signal: error.signal ?? null,
          stdout: String(stdout ?? ""),
          stderr: String(stderr ?? ""),
          error: exit === null ? why : null,
        });
      },
    );
  });

/** The spawner that returns only when the tool has ended: the tool's own exit, never a shell. */
export const runLsofNow: RunToolNow = (file, args, options) => {
  const ended = spawnSync(file, [...args], {
    env: { ...options.env },
    timeout: options.timeout,
    killSignal: "SIGKILL",
    maxBuffer: options.maxBuffer,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  const failure = ended.error as (Error & { code?: unknown }) | undefined;
  return {
    status: ended.status ?? null,
    signal: ended.signal ?? null,
    stdout: String(ended.stdout ?? ""),
    stderr: String(ended.stderr ?? ""),
    error: failure === undefined ? null : String(failure.code ?? "failed"),
  };
};

const blind = (why: string): SocketRead => ({ seen: "blind", why });

/** One line of lsof's default columns, `COMMAND PID USER FD TYPE DEVICE SIZE/OFF NODE NAME`, with
 * the TCP state after the name. A unix socket's line has no NODE: its name follows SIZE/OFF, and a
 * socket with no name has none; its DEVICE is the socket's own kernel address, kept only when it
 * is one, and its FD the socket's descriptor in the process, kept only when it is one. Null for
 * anything else, a line of another process included. */
function socketLine(kind: SocketKind, pid: number, raw: string): SocketLine | null {
  const field = raw.trim().split(/\s+/u);
  if (field[1] !== String(pid)) return null;
  if (kind === "unix") {
    if (field.length < 7 || field[4] !== "unix") return null;
    const name = field.slice(7).join(" ");
    const device = field[5];
    const fd = DESCRIPTOR.exec(field[3] ?? "")?.[1];
    return {
      name,
      state: "none",
      ...(device !== undefined && KERNEL_ADDRESS.test(device) ? { device } : {}),
      ...(fd === undefined ? {} : { fd: Number(fd) }),
    };
  }
  if (field.length < 9 || field.length > 10) return null;
  const node = field[7];
  const name = field[8];
  const state = field[9];
  if (name === undefined || name === "") return null;
  if (kind === "udp") {
    return node === "UDP" && state === undefined ? { name, state: "none" } : null;
  }
  if (node !== "TCP" || state === undefined) return null;
  const word = /^\(([A-Z_0-9]+)\)$/u.exec(state)?.[1];
  if (word === undefined) return null;
  // main's form asked for listeners alone: a line in another state is not the read that was asked
  if (kind === "listen" && word !== "LISTEN") return null;
  if (word === "LISTEN") return { name, state: "listen" };
  return { name, state: word === "ESTABLISHED" ? "established" : "other" };
}

/** The sockets of ONE process, of one kind. Blind whenever lsof did not plainly answer. */
export async function readSockets(
  kind: SocketKind,
  pid: number,
  run: RunTool = runLsof,
): Promise<SocketRead> {
  if (!isPid(pid)) return blind("not a pid");
  let said: ToolRun;
  try {
    said = await run(LSOF, lsofArgs(kind, pid), {
      env: LSOF_ENV,
      timeout: LSOF_TIMEOUT_MS,
      maxBuffer: LSOF_MAX_BUFFER,
    });
  } catch {
    return blind("lsof could not be run");
  }
  return socketsSaid(kind, pid, said);
}

/** The same read, taken at once: nothing is waited for, and the caller's thread stands still until
 * lsof has ended or its bound stops it. */
export function readSocketsNow(
  kind: SocketKind,
  pid: number,
  run: RunToolNow = runLsofNow,
): SocketRead {
  if (!isPid(pid)) return blind("not a pid");
  let said: ToolRun;
  try {
    said = run(LSOF, lsofArgs(kind, pid), {
      env: LSOF_ENV,
      timeout: LSOF_NOW_TIMEOUT_MS,
      maxBuffer: LSOF_MAX_BUFFER,
    });
  } catch {
    return blind("lsof could not be run");
  }
  return socketsSaid(kind, pid, said);
}

const isPid = (pid: number): boolean => Number.isSafeInteger(pid) && pid >= 1 && pid <= PID_MAX;

/** What one run of lsof said, as a read: blind whenever it did not plainly answer. */
function socketsSaid(kind: SocketKind, pid: number, said: ToolRun): SocketRead {
  if (said.error !== null) return blind(`lsof could not be run (${said.error})`);
  if (said.signal !== null || said.status === null) return blind("lsof was stopped");
  if (said.stderr.trim() !== "") return blind("lsof said something beside its answer");
  if (said.status === 1) {
    return said.stdout.trim() === "" ? { seen: "read", lines: [] } : blind("lsof failed");
  }
  if (said.status !== 0) return blind("lsof failed");
  const lines: SocketLine[] = [];
  for (const raw of said.stdout.split("\n")) {
    if (raw.trim() === "" || /^COMMAND\s/u.test(raw)) continue;
    const line = socketLine(kind, pid, raw);
    if (line === null) return blind("lsof wrote a line that is no socket of the process asked");
    lines.push(line);
  }
  if (lines.length === 0) return blind("lsof said it found sockets and listed none");
  return { seen: "read", lines };
}
