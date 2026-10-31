// Item 116 (2026-10-31) — THE SMOKE CENSUS, one copy: a smoke run's processes, found by the mark `run-smoke.mjs` gives
// Electron (`VF_SMOKE_RUN`, the run's profile name) in each one's environment, and named by its command alone. Two
// harnesses read it: the in-app teardown (`smoke-daemons.ts`: a smoke stops its own daemons and waits for them) and the
// launcher's row after Electron exits (`apps/desktop/packaging/smoke-daemons.mjs`, which re-exports it for the launchers,
// smoke-godview and the dev runner's tests). It lives with the package that owns the teardown, and the app re-exports
// it: apps are packaging roots that read packages, never the reverse. Before item 116 the teardown kept its own copy,
// in macOS's `ps` spelling alone and reading the whole table twice per poll; PR #8's Linux spelling and item 93's
// per-pid reads reached only this one. Plain JavaScript so a launcher runs it under node unbuilt; its types are
// `smoke-census.d.mts`.

import { execFileSync } from "node:child_process";

export const SMOKE_RUN_ENV = "VF_SMOKE_RUN";

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
