// DK-18 (plan (39)) — A SMOKE STOPS ITS OWN DAEMONS, AND WAITS FOR THEM. Every smoke left a `field-native` and a
// `field-terminal-host` alive after it exited — an orchestrator's sweep reaped one pair after each of five smokes. Why: the
// native plane outlives fieldd by design (the two-plane law), so a smoke's `supervisor.dispose()` (stop-owned) reads the
// field-native its product.json names as the stop begins, asks fieldd to stop, waits for IT, then SIGTERMs that field-native
// and returns — it never waits for that field-native, whose graceful stop drains its terminal cells' sessions (DK-18
// measured smoke:canvas's: 4.1 s for one drained session, the pair alive 4.3 s after Electron had exited). And a floor that
// read does not name — one that stated no pid in its hello ack to the fieldd that ADOPTED it, or one respawned after the
// read — is signalled by nothing at all: an orphan. The supervisor is product code and right for the product (stop-owned is
// the test modes' policy; production leaves the pair running); the smoke's own teardown is where a smoke's exit is decided
// (it leaves by `app.exit()`, never through the shell's quit flow), so the fix is HERE: after the supervisor's stop, the
// run's own processes are found, the ones nothing asked are asked, and the teardown WAITS for every one to be gone before
// the smoke may leave.
//
// WHICH processes are the run's: `apps/desktop/packaging/run-smoke.mjs` hands Electron one variable, `VF_SMOKE_RUN`, its
// profile's name; every process the smoke starts inherits it — fieldd (its supervisor spreads the shell's environment),
// field-native (spawned with fieldd's), each terminal cell (field-native's) — so a process whose environment carries it IS the
// run's, whatever its pid. (`ps -E` reads the environment of the user's own binaries; a platform binary's — a pty's `/bin/zsh`
// — is not readable, and a cell takes its shells down with it.) Electron's own Chromium children carry it too, and go with
// Electron: they are never this teardown's to stop. The launcher holds the row: after the smoke exits, no daemon of its run
// lives (`apps/desktop/packaging/smoke-daemons.mjs`).
//
// Item 116 (2026-10-31) — the census is ONE copy, `smoke-census.mjs` beside this file, which the launcher's row re-exports:
// one whole-table read finds the run, each pid after that is asked alone (item 93's cost), in each platform's own `ps`
// spelling (PR #8's Linux), naming a packaged app's helpers too. This file keeps the teardown's policy alone.

import { existsSync, rmSync } from "node:fs";
import { dirname } from "node:path";
import {
  listRunProcesses,
  type Ps,
  type PsSpelling,
  processName,
  psTables,
  runProcesses,
  SMOKE_RUN_ENV,
  stillRunning,
} from "./smoke-census.mjs";

export { listRunProcesses, processName, runProcesses, SMOKE_RUN_ENV };

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

export interface StopRunDeps {
  /** the run's processes now: the census's one whole-table read */
  readonly list: (mark: string) => readonly RunProcess[];
  /** which of `pids` are still the run's: each asked alone, judged by its environment (item 93's cost) */
  readonly still: (mark: string, pids: readonly number[]) => readonly number[];
  readonly signal: (pid: number, signal: NodeJS.Signals) => void;
  readonly sleep: (ms: number) => Promise<void>;
  readonly now: () => number;
}

/** The teardown's seams over the census, read through `ps` (a row hands its own) in a platform's spelling (item 116). */
export function censusDeps(ps?: Ps, spelling: PsSpelling = psTables()): StopRunDeps {
  return {
    list: (mark) => listRunProcesses(mark, ps, spelling),
    still: (mark, pids) => stillRunning(mark, pids, ps, spelling),
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
}

/**
 * Stop the run's daemons and WAIT for them (above). `self` is this Electron's pid: it and its own Chromium children (they go
 * with it) are not the teardown's. The ones whose parent is gone are asked (SIGTERM — field-native drains its cells and
 * takes them down; a second ask of one already stopping is nothing to it), then the teardown waits for every one to go, up
 * to the drain bound; what outlives it is asked again, then killed. The run is found once (the census's whole-table read)
 * and each wait asks only the pids it found (item 116): a process born after the look is the launcher's row's to find.
 */
export async function stopRunDaemons(
  mark: string | undefined,
  self: number,
  deps: StopRunDeps = censusDeps(),
  bounds: typeof RUN_STOP = RUN_STOP,
): Promise<StoppedDaemons> {
  if (mark === undefined || mark === "")
    return { mark: null, found: [], asked: [], waitedMs: 0, killed: [], left: [] };
  // not this Electron, not its own Chromium children, and not the `ps` it runs to look (it inherits the mark too)
  const found = deps
    .list(mark)
    .filter((p) => p.pid !== self && !p.helper && !(p.ppid === self && p.name === "ps"));
  const t0 = deps.now();
  const pids = new Set(found.map((p) => p.pid));
  const asked = found.filter((p) => !pids.has(p.ppid)).map((p) => p.pid);
  for (const pid of asked) deps.signal(pid, "SIGTERM");
  const stillOf = (processes: readonly RunProcess[]): RunProcess[] => {
    const live = new Set(
      deps.still(
        mark,
        processes.map((p) => p.pid),
      ),
    );
    return processes.filter((p) => live.has(p.pid));
  };
  const waitGone = async (of: readonly RunProcess[], ms: number): Promise<RunProcess[]> => {
    const until = deps.now() + ms;
    let alive = stillOf(of);
    while (alive.length > 0 && deps.now() < until) {
      await deps.sleep(bounds.pollMs);
      alive = stillOf(alive);
    }
    return alive;
  };
  let alive = found.length === 0 ? [] : await waitGone(found, bounds.drainMs);
  const waitedMs = deps.now() - t0;
  const killed: number[] = [];
  if (alive.length > 0) {
    for (const p of alive) deps.signal(p.pid, "SIGTERM");
    alive = await waitGone(alive, bounds.askMs);
    for (const p of alive) {
      deps.signal(p.pid, "SIGKILL");
      killed.push(p.pid);
    }
    if (alive.length > 0) alive = await waitGone(alive, bounds.killMs);
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
  // BP-D7 — `smoke:profile`'s PHASE A keeps its root for PHASE B (the packaged app is launched on its data root, the
  // board this run laid its pane on). The row's runner sets the switch and removes the root itself once it has judged.
  if (process.env["VF_SMOKE_KEEP_ROOT"] === "1") {
    process.stdout.write(`SMOKE_ROOT_KEPT ${JSON.stringify({ root, home: smokeHome(root) })}\n`);
    return;
  }
  rmSync(root, { recursive: true, force: true });
  const home = smokeHome(root);
  if (home === null) return;
  if (ok) rmSync(home, { recursive: true, force: true });
  process.stdout.write(
    `SMOKE_HOME ${JSON.stringify({ home, removed: ok && !existsSync(home) })}\n`,
  );
}
