// DK-18 (plan (39)) — A SMOKE STOPS ITS OWN DAEMONS, AND WAITS FOR THEM. Every smoke left a `field-native` and a
// `field-terminal-host` alive after it exited — an orchestrator's sweep reaped one pair after each of five smokes. Why: the
// native plane outlives fieldd by design (the two-plane law), so a smoke's `supervisor.dispose()` (stop-owned) asks fieldd to
// stop, waits for IT, then SIGTERMs the field-native fieldd recorded at its boot and returns — it never waits for that
// field-native, whose graceful stop drains its terminal cells' sessions (DK-18 measured smoke:canvas's: 4.1 s for one drained
// session, the pair alive 4.3 s after Electron had exited). And a fieldd the restart smoke brought back ADOPTED the running
// field-native — no pid in its product.json — so nothing signalled that one at all: an orphan. The supervisor is product code
// and right for the product (stop-owned is the test modes' policy; production leaves the pair running); the smoke's own
// teardown is where a smoke's exit is decided (it leaves by `app.exit()`, never through the shell's quit flow), so the fix is
// HERE: after the supervisor's stop, the run's own processes are found, the ones nothing asked are asked, and the teardown
// WAITS for every one to be gone before the smoke may leave.
//
// WHICH processes are the run's: `apps/desktop/packaging/run-smoke.mjs` hands Electron one variable, `VF_SMOKE_RUN`, its
// profile's name; every process the smoke starts inherits it — fieldd (its supervisor spreads the shell's environment),
// field-native (spawned with fieldd's), each terminal cell (field-native's) — so a process whose environment carries it IS the
// run's, whatever its pid. (`ps -E` reads the environment of the user's own binaries; a platform binary's — a pty's `/bin/zsh`
// — is not readable, and a cell takes its shells down with it.) Electron's own Chromium children carry it too, and go with
// Electron: they are never this teardown's to stop. The launcher holds the row: after the smoke exits, no daemon of its run
// lives (`apps/desktop/packaging/smoke-daemons.mjs`).

import { execFileSync } from "node:child_process";
import { existsSync, rmSync } from "node:fs";
import { dirname } from "node:path";

/** The variable `run-smoke.mjs` marks a run with (its profile's name). */
export const SMOKE_RUN_ENV = "VF_SMOKE_RUN";

/** One of the run's processes, as `ps` lists it. */
export interface RunProcess {
  readonly pid: number;
  readonly ppid: number;
  /** what it is, read off its command line (never its environment): `field-native`, `field-terminal-host`, `fieldd`, … */
  readonly name: string;
  /** one of Electron's own Chromium children (its GPU, renderer, network or utility process, its crash handler) */
  readonly helper: boolean;
}

/** What the teardown found, asked and waited for. */
export interface StoppedDaemons {
  readonly mark: string | null;
  /** the run's processes when the teardown looked, after the supervisor's stop (Electron's own children aside) */
  readonly found: readonly { readonly pid: number; readonly name: string }[];
  /** the ones the teardown asked to stop (SIGTERM) — those whose parent is gone: field-native, or a worker fieldd left */
  readonly asked: readonly number[];
  /** how long until every one was gone, or the bound */
  readonly waitedMs: number;
  /** what outlived the bound and was killed */
  readonly killed: readonly number[];
  /** what still lived after the kill (should be nothing) */
  readonly left: readonly { readonly pid: number; readonly name: string }[];
}

/** The teardown's bounds: a field-native drains its cells' sessions before it stops (4.1 s measured for one session on a
 * quiet Mac); then everything left is asked, and then killed. */
export const RUN_STOP = { drainMs: 20_000, askMs: 3_000, killMs: 1_000, pollMs: 100 } as const;

/** What a command line runs, named for a report — read from the command alone (an environment names other binaries). */
export function processName(command: string): string {
  if (command.includes("Electron Helper") || command.includes("chrome_crashpad_handler"))
    return "electron-helper";
  if (/\/field-terminal-host(\s|$)/u.test(command)) return "field-terminal-host";
  if (/\/field-native(\s|$)/u.test(command)) return "field-native";
  if (/[/\\]fieldd[/\\]dist[/\\]bin\.cjs/u.test(command)) return "fieldd";
  if (/service-harness/u.test(command)) return "fieldd-worker";
  if (/files-host/u.test(command)) return "files-host";
  if (/rosettad/u.test(command)) return "rosettad";
  if (/Electron\.app\/Contents\/MacOS\/Electron(\s|$)/u.test(command)) return "electron";
  const first = command.trim().split(/\s+/u)[0] ?? "";
  return first.slice(first.lastIndexOf("/") + 1) || "?";
}

const LINE = /^\s*(\d+)\s+(\d+)\s+(.*)$/u;

/**
 * The run's processes from two `ps -axww -o pid=,ppid=,command=` tables — one with `-E` (each line's environment after its
 * arguments: the mark is looked for there, as a whole word) and one without (the command alone: what each one is named by).
 */
export function runProcesses(withEnv: string, plain: string, mark: string): RunProcess[] {
  const carries = new RegExp(
    `(^|\\s)${SMOKE_RUN_ENV}=${mark.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&")}(\\s|$)`,
    "u",
  );
  const commands = new Map<number, string>();
  for (const line of plain.split("\n")) {
    const m = LINE.exec(line);
    if (m !== null) commands.set(Number(m[1]), m[3] ?? "");
  }
  const found: RunProcess[] = [];
  for (const line of withEnv.split("\n")) {
    const m = LINE.exec(line);
    if (m === null || !carries.test(m[3] ?? "")) continue;
    const pid = Number(m[1]);
    const command = commands.get(pid) ?? m[3] ?? "";
    const name = processName(command);
    found.push({ pid, ppid: Number(m[2]), name, helper: name === "electron-helper" });
  }
  return found;
}

/** The run's processes now (`ps`, twice); none on a platform without it. */
export function listRunProcesses(mark: string): RunProcess[] {
  if (process.platform === "win32") return [];
  const ps = (args: string[]): string =>
    execFileSync("ps", args, { encoding: "utf8", maxBuffer: 256 * 1024 * 1024 });
  return runProcesses(
    ps(["-axww", "-E", "-o", "pid=,ppid=,command="]),
    ps(["-axww", "-o", "pid=,ppid=,command="]),
    mark,
  );
}

export interface StopRunDeps {
  readonly list: (mark: string) => readonly RunProcess[];
  readonly signal: (pid: number, signal: NodeJS.Signals) => void;
  readonly sleep: (ms: number) => Promise<void>;
  readonly now: () => number;
}

const realDeps: StopRunDeps = {
  list: listRunProcesses,
  signal: (pid, signal) => {
    try {
      process.kill(pid, signal);
    } catch {
      /* already gone */
    }
  },
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  now: () => Date.now(),
};

/**
 * Stop the run's daemons and WAIT for them (above). `self` is this Electron's pid: it and its own Chromium children (they go
 * with it) are not the teardown's. The ones whose parent is gone are asked (SIGTERM — field-native drains its cells and
 * takes them down; a second ask of one already stopping is nothing to it), then the teardown waits for every one to go, up
 * to the drain bound; what outlives it is asked again, then killed.
 */
export async function stopRunDaemons(
  mark: string | undefined,
  self: number,
  deps: StopRunDeps = realDeps,
  bounds: typeof RUN_STOP = RUN_STOP,
): Promise<StoppedDaemons> {
  if (mark === undefined || mark === "")
    return { mark: null, found: [], asked: [], waitedMs: 0, killed: [], left: [] };
  // not this Electron, not its own Chromium children, and not the `ps` it runs to look (it inherits the mark too)
  const theRun = (): RunProcess[] =>
    deps
      .list(mark)
      .filter((p) => p.pid !== self && !p.helper && !(p.ppid === self && p.name === "ps"));
  const found = theRun();
  const t0 = deps.now();
  const pids = new Set(found.map((p) => p.pid));
  const asked = found.filter((p) => !pids.has(p.ppid)).map((p) => p.pid);
  for (const pid of asked) deps.signal(pid, "SIGTERM");
  const waitGone = async (ms: number): Promise<RunProcess[]> => {
    const until = deps.now() + ms;
    let alive = theRun();
    while (alive.length > 0 && deps.now() < until) {
      await deps.sleep(bounds.pollMs);
      alive = theRun();
    }
    return alive;
  };
  let alive = found.length === 0 ? [] : await waitGone(bounds.drainMs);
  const waitedMs = deps.now() - t0;
  const killed: number[] = [];
  if (alive.length > 0) {
    for (const p of alive) deps.signal(p.pid, "SIGTERM");
    alive = await waitGone(bounds.askMs);
    for (const p of alive) {
      deps.signal(p.pid, "SIGKILL");
      killed.push(p.pid);
    }
    if (alive.length > 0) alive = await waitGone(bounds.killMs);
  }
  const named = (p: RunProcess): { pid: number; name: string } => ({ pid: p.pid, name: p.name });
  return { mark, found: found.map(named), asked, waitedMs, killed, left: alive.map(named) };
}

/** The smoke's HOME — the `vf-smoke-*` VibeField root main minted (main/fieldd.ts `dataRoot`) above the user root
 * `<home>/users/<id>` the runners are handed — or null for any other shape (never removed). */
export function smokeHome(userRoot: string): string | null {
  const users = dirname(userRoot);
  const home = dirname(users);
  const name = home.slice(home.lastIndexOf("/") + 1);
  return users.endsWith("/users") &&
    name.startsWith("vf-smoke-") &&
    !name.startsWith("vf-smoke-profile-")
    ? home
    : null;
}

/** The run's root, removed ONLY if this run created it (an injected FIELDD_DATA_DIR is someone else's data) — and, the run
 * green, its whole HOME (DK-18: the logs; a red run keeps them and `SMOKE_HOME` names them, so a sweep never hunts by time). */
export function removeSmokeRoot(root: string, ok: boolean): void {
  if (process.env["FIELDD_DATA_DIR"]) return;
  rmSync(root, { recursive: true, force: true });
  const home = smokeHome(root);
  if (home === null) return;
  if (ok) rmSync(home, { recursive: true, force: true });
  process.stdout.write(
    `SMOKE_HOME ${JSON.stringify({ home, removed: ok && !existsSync(home) })}\n`,
  );
}
