// DK-18 (plan (39)) — THE ROW: after a smoke exits, no daemon of its run lives. `run-smoke.mjs` marks the run — one variable
// in Electron's environment, `VF_SMOKE_RUN`, the run's profile name — and every process the smoke starts inherits it
// (fieldd, field-native, its terminal cells and its freeway host, fieldd's workers), so once Electron has exited, a process
// still carrying it was left behind by the smoke, whatever its pid. The smoke's own teardown stops them and WAITS for them
// (`packages/electron-shell/src/testing/smoke-daemons.ts`); this row is its witness, taken outside Electron, after it.
// Electron's own Chromium children carry the mark too and go with it: they get a moment to (`HELPER_SETTLE_MS`); nothing else
// gets any. What is found is said (`SMOKE_DAEMONS`), reaped, and makes the run red.

// Item 116 (2026-10-31): the census itself (the mark, each process's name, the `ps` reads in each platform's spelling) is
// the package's that owns the teardown, and this row reads it: `packages/electron-shell/src/testing/smoke-census.mjs`.
// Its names are re-exported here, so the launchers, smoke-godview and the dev runner's tests keep this path.
import {
  goneByKernel,
  listRunProcesses,
  stillRunning,
} from "../../../packages/electron-shell/src/testing/smoke-census.mjs";

export {
  goneByKernel,
  listRunProcesses,
  processName,
  psTables,
  runProcesses,
  SMOKE_RUN_ENV,
  stillRunning,
} from "../../../packages/electron-shell/src/testing/smoke-census.mjs";

/** How long Electron's own Chromium children may take to follow it out. */
export const HELPER_SETTLE_MS = 3_000;

/** How long the left get after the SIGTERM before what is still the run's is killed. */
export const REAP_GRACE_MS = 3_000;

/** How long a killed process may take to be gone by the kernel's reading: a hang's guard, never a wait for a cause. */
export const REAP_HANG_MS = 5_000;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const signalled = (pid, signal) => {
  try {
    process.kill(pid, signal);
  } catch {
    /* already gone */
  }
};

/**
 * THE ROW, once Electron has exited: every process still carrying the run's mark but Electron's own children is LEFT; those
 * children get `HELPER_SETTLE_MS` to follow Electron out, and any still there are left too. Everything left is reaped
 * (SIGTERM, then SIGKILL), so a red run leaves nothing either. Returns the row's record. `deps` are its seams: `ps` (the
 * census's spawner), or `list` and `still` whole, `gone` (the kernel's reading), and `signal`, `sleep`, `now`.
 */
export async function leftByRun(mark, deps = {}) {
  const ps = deps.ps; // undefined: the census's own spawner (its parameters' default)
  const list = deps.list ?? ((m) => listRunProcesses(m, ps));
  const still = deps.still ?? ((m, pids) => stillRunning(m, pids, ps));
  const signal = deps.signal ?? signalled;
  const wait = deps.sleep ?? sleep;
  const now = deps.now ?? Date.now;
  if (process.platform === "win32" && deps.list === undefined)
    return { mark, skipped: "win32", left: [] };
  const named = (p) => ({ pid: p.pid, name: p.name });
  const stillOf = (processes) => {
    const pids = processes.map((p) => p.pid);
    const live = new Set(still(mark, pids));
    return processes.filter((p) => live.has(p.pid));
  };
  const gone = deps.gone ?? ((pid) => goneByKernel(pid, ps));
  /** `processes` less those gone by the kernel's reading, asked every 100 ms for up to `ms`. */
  const untilGone = async (processes, ms) => {
    const until = now() + ms;
    let pending = processes.filter((p) => !gone(p.pid));
    while (pending.length > 0 && now() < until) {
      await wait(100);
      pending = pending.filter((p) => !gone(p.pid));
    }
    return pending;
  };
  const first = list(mark);
  const left = first.filter((p) => !p.helper).map(named);
  const t0 = now();
  let helpers = first.filter((p) => p.helper);
  while (helpers.length > 0 && now() - t0 < HELPER_SETTLE_MS) {
    await wait(100);
    helpers = stillOf(helpers);
  }
  const helpersSettledMs = now() - t0;
  left.push(...helpers.map(named));
  const reaped = [];
  const unreaped = [];
  if (left.length > 0) {
    for (const p of left) signal(p.pid, "SIGTERM");
    // Item 142 (2026-11-01): reaped is the KERNEL's word (`goneByKernel`), never the mark's, and a pid is called reaped
    // only once it holds. Before, every left pid was called reaped as the SIGKILL went, and one whose mark had vanished in
    // its exit before that, while the process could still run (AL-6's light). Only a pid still the run's is killed (one
    // the system has handed on is never signalled); time guards only a hang, and what outlives it is said, unreaped.
    let pending = await untilGone(left, REAP_GRACE_MS);
    for (const p of stillOf(pending)) signal(p.pid, "SIGKILL");
    pending = await untilGone(pending, REAP_HANG_MS);
    const stuck = new Set(pending.map((p) => p.pid));
    for (const p of left) (stuck.has(p.pid) ? unreaped : reaped).push(p.pid);
  }
  return { mark, left, reaped, unreaped, helpersSettledMs };
}

/** The row's left, named for a red run's words (`name pid`, joined); one the kernel did not see gone after the reap says
 * so, so "(reaped)" is never said of it (item 142). */
export function leftNames(row) {
  return row.left
    .map(
      (p) =>
        `${p.name} ${p.pid}${row.unreaped?.includes(p.pid) ? " (NOT gone after the reap)" : ""}`,
    )
    .join(", ");
}
