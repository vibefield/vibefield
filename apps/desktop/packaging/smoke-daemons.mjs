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

/** The run's processes from two `ps … -o pid=,ppid=,command=` tables (`psTables`) — one with the environment after each line's
 * arguments (the mark is looked for there, as a whole word) and one without (the command alone, to name each by). */
export function runProcesses(withEnv, plain, mark) {
  const quoted = mark.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
  const carries = new RegExp(`(^|\\s)${SMOKE_RUN_ENV}=${quoted}(\\s|$)`, "u");
  const commands = new Map();
  for (const line of plain.split("\n")) {
    const m = LINE.exec(line);
    if (m !== null) commands.set(Number(m[1]), m[3] ?? "");
  }
  const found = [];
  for (const line of withEnv.split("\n")) {
    const m = LINE.exec(line);
    if (m === null || !carries.test(m[3] ?? "")) continue;
    const pid = Number(m[1]);
    const command = commands.get(pid) ?? null;
    const name = processName(command ?? m[3] ?? "");
    // `command` is the plain table's (never the environment's): the path a witness reads a binary's place from
    found.push({ pid, ppid: Number(m[2]), name, helper: name === "electron-helper", command });
  }
  return found;
}

/**
 * `ps`'s two tables in the platform's own spelling. macOS's (BSD) is `-axww` and `-E` for the environment. Linux's procps
 * refuses `-x` ("must set personality") and has no `-E`; its BSD-style `axww` lists the same processes and `e` appends the
 * same environment after the command — never on macOS, where `e` means every process, not the environment.
 */
export function psTables(platform = process.platform) {
  const columns = ["-o", "pid=,ppid=,command="];
  return platform === "linux"
    ? { withEnv: ["axwwe", ...columns], plain: ["axww", ...columns] }
    : { withEnv: ["-axww", "-E", ...columns], plain: ["-axww", ...columns] };
}

/** The run's processes now; none where `ps` cannot say (Windows). */
export function listRunProcesses(mark) {
  if (process.platform === "win32") return [];
  const ps = (args) => execFileSync("ps", args, { encoding: "utf8", maxBuffer: 256 * 1024 * 1024 });
  const tables = psTables();
  return runProcesses(ps(tables.withEnv), ps(tables.plain), mark);
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
 * (SIGTERM, then SIGKILL), so a red run leaves nothing either. Returns the row's record.
 */
export async function leftByRun(mark, deps = {}) {
  const list = deps.list ?? listRunProcesses;
  const signal = deps.signal ?? signalled;
  const wait = deps.sleep ?? sleep;
  const now = deps.now ?? Date.now;
  if (process.platform === "win32" && deps.list === undefined)
    return { mark, skipped: "win32", left: [] };
  const named = (p) => ({ pid: p.pid, name: p.name });
  const first = list(mark);
  const left = first.filter((p) => !p.helper).map(named);
  const t0 = now();
  let helpers = first.filter((p) => p.helper);
  while (helpers.length > 0 && now() - t0 < HELPER_SETTLE_MS) {
    await wait(100);
    const alive = new Set(list(mark).map((p) => p.pid));
    helpers = helpers.filter((p) => alive.has(p.pid));
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
      const still = new Set(list(mark).map((p) => p.pid));
      alive = alive.filter((p) => still.has(p.pid));
    }
    for (const p of alive) signal(p.pid, "SIGKILL");
    reaped.push(...left.map((p) => p.pid));
  }
  return { mark, left, reaped, helpersSettledMs };
}
