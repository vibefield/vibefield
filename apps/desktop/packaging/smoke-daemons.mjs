import { execFileSync } from "node:child_process";

// DK-18 (plan (39)) — THE ROW: after a smoke exits, no daemon of its run lives. `run-smoke.mjs` marks the run — one variable
// in Electron's environment, `VF_SMOKE_RUN`, the run's profile name — and every process the smoke starts inherits it
// (fieldd, field-native, its terminal cells and its freeway host, fieldd's workers), so once Electron has exited, a process
// still carrying it was left behind by the smoke, whatever its pid. The smoke's own teardown stops them and WAITS for them
// (`packages/electron-shell/src/testing/smoke-daemons.ts`); this row is its witness, taken outside Electron, after it.
// Electron's own Chromium children carry the mark too and go with it: they get a moment to (`HELPER_SETTLE_MS`); nothing else
// gets any. What is found is said (`SMOKE_DAEMONS`), reaped, and makes the run red.

export const SMOKE_RUN_ENV = "VF_SMOKE_RUN";

/** How long Electron's own Chromium children may take to follow it out. */
export const HELPER_SETTLE_MS = 3_000;

const LINE = /^\s*(\d+)\s+(\d+)\s+(.*)$/u;

/** What a command line runs, named for the report — read from the command alone (an environment names other binaries). */
export function processName(command) {
  if (
    command.includes("Electron Helper") ||
    command.includes("chrome_crashpad_handler") ||
    // WP12 L4 — a PACKAGED app's helpers carry its product name (`VibeField Helper (Renderer).app/…`)
    /Helper(?: \([^)]*\))?\.app\/Contents\/MacOS\//u.test(command)
  )
    return "electron-helper";
  // WP12 L4 — the packaged layout (`smoke:update`): the shell, and fieldd's SEA beside the floor in `Resources/bin`
  if (/\.app\/Contents\/MacOS\/VibeField(\s|$)/u.test(command)) return "vibefield";
  if (/\/Resources\/bin\/fieldd(\s|$)/u.test(command)) return "fieldd";
  if (/\/sidecar-slim(\s|$)/u.test(command)) return "sidecar-slim";
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

/** The run's lines of a table with the environment (`psTables`): each whose environment carries the run's mark, as a whole
 * word. Item 93 (2026-10-31): `ps -E` shows NO environment for a zombie (rightly gone: it holds no work) or for a macOS
 * platform binary (`/bin/sh`, `/bin/sleep`), so neither is ever the run's here. Never wrap a smoke daemon in `sh -c` or a
 * platform binary: the census could not see it. */
function markedLines(withEnv, mark) {
  const quoted = mark.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
  const carries = new RegExp(`(^|\\s)${SMOKE_RUN_ENV}=${quoted}(\\s|$)`, "u");
  const lines = [];
  for (const line of withEnv.split("\n")) {
    const m = LINE.exec(line);
    if (m !== null && carries.test(m[3] ?? ""))
      lines.push({ pid: Number(m[1]), ppid: Number(m[2]), rest: m[3] ?? "" });
  }
  return lines;
}

/** The run's lines named by a plain table (the command alone, never the environment's). */
function namedLines(lines, plain) {
  const commands = new Map();
  for (const line of plain.split("\n")) {
    const m = LINE.exec(line);
    if (m !== null) commands.set(Number(m[1]), m[3] ?? "");
  }
  return lines.map(({ pid, ppid, rest }) => {
    const command = commands.get(pid) ?? null;
    const name = processName(command ?? rest);
    // `command` is the plain table's (never the environment's): the path a witness reads a binary's place from
    return { pid, ppid, name, helper: name === "electron-helper", command };
  });
}

/** The run's processes from two `ps -o pid=,ppid=,command=` tables — one with the environment after each line's arguments
 * (`psTables`' spelling: the mark is looked for there, as a whole word) and one without (the command alone, to name each
 * by). */
export function runProcesses(withEnv, plain, mark) {
  return namedLines(markedLines(withEnv, mark), plain);
}

// Item 93 — what a look costs. The dear read is the WHOLE table with every process's environment: 152 ms and 1.57 MB on
// James's Mac (1244 processes, 2026-10-29; the plain table 92 ms), and it grows with the host's load. macOS answers a
// `-p` naming ONE pid from that process alone (3–4 ms), but a `-p` naming two or more by reading the whole table again
// (204–216 ms). So the census reads the whole table once, to find the run, and asks everything after that one pid at a
// time: it read the table twice per look, four times or more for a run that left a daemon.

/** One `ps` — the census's spawner (`deps.ps`, where a row counts its reads). */
const runPs = (args) =>
  execFileSync("ps", args, { encoding: "utf8", maxBuffer: 256 * 1024 * 1024 });

const COLUMNS = ["-o", "pid=,ppid=,command="];

/**
 * `ps` in the platform's own spelling, for each of the census's three reads (the affected job on ubuntu-latest,
 * 2026-10-29): `table`, the whole table with the environment; `one`, one pid's command; `oneWithEnv`, one pid's line
 * with its environment. macOS's (BSD) is `-axww` for every process and `-E` for the environment. Linux's procps refuses
 * `-x` ("must set personality") and has no `-E`: its BSD-style `axww` lists the same processes, and `e` appends the same
 * environment after the command — never on macOS, where `e` means every process, not the environment. `-ww` (no width
 * limit) is both platforms' spelling. Each read names its columns and pid after these (`COLUMNS`, `lineOf`).
 */
export function psTables(platform = process.platform) {
  return platform === "linux"
    ? { table: ["axwwe"], one: ["-ww"], oneWithEnv: ["wwe"] }
    : { table: ["-axww", "-E"], one: ["-ww"], oneWithEnv: ["-ww", "-E"] };
}

/** One process's line, asked of `ps` by its pid alone; `""` once it is gone (`ps` exits 1 when no pid it names lives). */
function lineOf(ps, flags, pid) {
  try {
    return ps([...flags, ...COLUMNS, "-p", String(pid)]);
  } catch (error) {
    if (error?.status === 1) return "";
    throw error;
  }
}

/** The run's processes now; none where `ps` cannot say (Windows). The one whole-table read finds them by the mark, and
 * each is named by its own command line, asked by its pid. */
export function listRunProcesses(mark, ps = runPs, spelling = psTables()) {
  if (process.platform === "win32") return [];
  const run = markedLines(ps([...spelling.table, ...COLUMNS]), mark);
  return namedLines(run, run.map((p) => lineOf(ps, spelling.one, p.pid)).join("\n"));
}

/** Which of `pids` are still the run's: each asked by its pid alone and judged by its environment, so a pid the system
 * has since handed to another process is not the run's, and is never signalled. */
export function stillRunning(mark, pids, ps = runPs, spelling = psTables()) {
  if (process.platform === "win32") return [];
  const lines = pids.map((pid) => lineOf(ps, spelling.oneWithEnv, pid));
  return markedLines(lines.join("\n"), mark).map((p) => p.pid);
}

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
 * census's spawner), or `list` and `still` whole, and `signal`, `sleep`, `now`.
 */
export async function leftByRun(mark, deps = {}) {
  const ps = deps.ps ?? runPs;
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
  if (left.length > 0) {
    for (const p of left) signal(p.pid, "SIGTERM");
    const until = now() + 3_000;
    let alive = left;
    while (alive.length > 0 && now() < until) {
      await wait(100);
      alive = stillOf(alive);
    }
    for (const p of alive) signal(p.pid, "SIGKILL");
    reaped.push(...left.map((p) => p.pid));
  }
  return { mark, left, reaped, helpersSettledMs };
}
