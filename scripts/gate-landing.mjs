#!/usr/bin/env node
// DK-18 — THE LANDING GATE, VibeField's `gate:landing` by ICE's example (ICE's `pnpm run gate:landing`: the oracle, the stills,
// every rig and the pack audit — required at every landing, kept out of `ci` because it needs a GPU). The gates `pnpm verify`
// cannot carry need THIS host's GPU: `pnpm still` (Dawn on Metal, `webgpu` 0.4.0, `@napi-rs/canvas`'s darwin-arm64 binary) and
// every desktop smoke (Electron with the GPU kept, a window on the screen). They run here in order, ONE AT A TIME, each a fresh
// process with Nx's cache and daemon off (`NX_SKIP_NX_CACHE=true NX_DAEMON=false`); every smoke on its own temporary profile
// (`apps/desktop/packaging/run-smoke.mjs`, smoke:studio's `run-studio-smoke.mjs`), its run's daemons stopped by its own
// teardown and held gone by the launcher's row (`SMOKE_DAEMONS`). One verdict line per gate; exit 1 on any red.
// `docs/desk-gates.md` is the list: what each gate proves, where it runs, and its verdict at the landing SHA.
//
// Usage: node scripts/gate-landing.mjs [--with-stages] [--only a,b] [--from name] [--logs <dir>] [--timeout-min n] [--list]
//   --with-stages   first `pnpm verify`'s chain stage by stage, each alone and EVERY one even after a red — `verify` stops at
//                   its first red, and preflight is red in every worktree by a sibling, so a worktree's grade runs them so;
//                   a red stage that is MAIN's known row is said so (`red — main's: …`), and still counts as red;
//   --only a,b      just these gates, by name; --from name: the list from this gate on;
//   --logs <dir>    where each gate's whole output goes (default: a fresh directory under the OS temp, named first);
//   --timeout-min n a gate still running after n minutes (default 30) is stopped — its process group asked to end, as the
//                   kit's `try` stops the app — and RED: a gate that hangs never holds the list (DK-18's final run met
//                   one: smoke:canvas waiting for ever on a call into a window it had destroyed);
//   --list          print the list and exit.
// VF_PERF_LOCKS=<path>[:<path>…] — a perf measurement owns this host while its lock file exists: before EACH gate the run
//                   waits while any lock named exists, and says so (`GATE_WAIT`). The paths are the caller's — this host's,
//                   never written here. Unset, the run is exactly as it was.

import { spawn, spawnSync } from "node:child_process";
import { createWriteStream, existsSync, mkdirSync, mkdtempSync, readFileSync } from "node:fs";
import { constants, loadavg, tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const ROOT = resolve(import.meta.dirname, "..");

const pnpm = (...args) => ["pnpm", ...args];

/** `pnpm verify`'s chain, stage by stage (package.json `verify`), each with what a red of MAIN's own looks like. */
export const STAGES = [
  { name: "preflight", run: pnpm("preflight"), main: preflightSiblingsOnly },
  { name: "check:walls", run: pnpm("check:walls") },
  { name: "check:deps", run: pnpm("check:deps"), main: secondCopiesOutside },
  { name: "check:retired", run: pnpm("check:retired") },
  { name: "check:ios-fixtures", run: pnpm("check:ios-fixtures") },
  { name: "icons:check", run: pnpm("icons:check") },
  { name: "typecheck", run: pnpm("typecheck") },
  { name: "lint", run: pnpm("lint") },
  { name: "fmt", run: ["cargo", "fmt", "--check"] },
  { name: "lint:rust", run: pnpm("lint:rust") },
  { name: "bundle:assert", run: pnpm("bundle:assert") },
  { name: "test", run: pnpm("test"), main: onlyAr7b, counts: projectCounts },
  { name: "test:rust", run: pnpm("test:rust") },
  { name: "gen:check", run: pnpm("gen:check") },
];

/** The landing-only gates — this host's GPU — in order: the GPU-less canvas modes reuse smoke:canvas's build. */
export const LANDING = [
  { name: "still", run: pnpm("still") },
  { name: "smoke", run: pnpm("smoke") },
  { name: "smoke:canvas", run: pnpm("smoke:canvas") },
  { name: "smoke:canvas:no-gpu", run: pnpm("smoke:canvas:no-gpu") },
  { name: "smoke:canvas:no-webgpu", run: pnpm("smoke:canvas:no-webgpu") },
  { name: "smoke:kind-faults", run: pnpm("smoke:kind-faults") },
  { name: "smoke:plugin-restart", run: pnpm("smoke:plugin-restart") },
  // the try board as an author runs it: the kit stages the example clock ALONE in a dev root of its own, then
  // `pnpm smoke:plugin` (a bare `pnpm smoke:plugin` stages nothing and says so)
  { name: "smoke:plugin", run: pnpm("plugin", "try", "examples/plugins/desk-clock") },
  { name: "smoke:godview", run: pnpm("smoke:godview") },
  { name: "smoke:terminal-door", run: pnpm("smoke:terminal-door") },
  { name: "smoke:terminal-direct", run: pnpm("smoke:terminal-direct") },
  { name: "smoke:studio", run: pnpm("smoke:studio") },
  // WP8d (W7, desk-gates row 29): the app's own plugins under a verified index — it loads, a corrupted copy is refused
  // on its row, a forged index refuses the root; three launches GPU-less
  { name: "smoke:bundled", run: pnpm("smoke:bundled") },
];

/** A terminal's colour codes, which vitest and nx print, left out of what a reading reads. */
const COLOUR = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, "gu");
const plain = (out) => out.replace(COLOUR, "");

/** preflight red by nothing but siblings off their pins (`preflight FAIL: <sibling> is at … but siblings.lock.json pins …`). */
export function preflightSiblingsOnly(out) {
  const fails = plain(out)
    .split("\n")
    .filter((l) => l.startsWith("preflight FAIL:"));
  return fails.length > 0 && fails.every((l) => /is at \S+ but siblings\.lock\.json pins/u.test(l))
    ? `a sibling off its pin: ${fails.map((l) => l.slice("preflight FAIL: ".length).split(" ")[0]).join(", ")}`
    : null;
}

/** check:deps red by second copies that all live OUTSIDE this checkout (main's FS-1b mille sibling links its host peers
 * absolutely into the checkout that ran `siblings:build`; plan addendum (84)) — every copy here one. */
export function secondCopiesOutside(text, root = ROOT) {
  const out = plain(text);
  if (!out.includes("single-copy law violated")) return null;
  const copies = out.split("\n").filter((l) => /^\s+\S+\s+←/u.test(l));
  const outside = copies.filter((l) => !l.includes(root) && /←\s+\//u.test(l));
  const here = copies.filter((l) => !outside.includes(l));
  const blocks = (out.match(/distinct .* copies are resolvable/gu) ?? []).length;
  return blocks > 0 && here.length === blocks && outside.length === blocks
    ? `the second copies all outside this checkout (${[...new Set(outside.map((l) => (/←\s+(\S+?)\/node_modules/u.exec(l) ?? [])[1]).filter(Boolean))].join(", ")})`
    : null;
}

/** test red by fieldd's agent-gateway AR-7b row alone (main's own). */
export function onlyAr7b(text) {
  const out = plain(text);
  const failedTasks = [...out.matchAll(/^\s*-\s+(@vibefield\/\S+):test\s*$/gmu)].map((m) => m[1]);
  const failedTests = out
    .split("\n")
    .filter((l) => /^\s*FAIL\s+test\//u.test(l) && l.includes(">"));
  return failedTasks.length === 1 &&
    failedTasks[0] === "@vibefield/fieldd" &&
    failedTests.length > 0 &&
    failedTests.every((l) => l.includes("agent-gateway.test.ts") && l.includes("AR-7b"))
    ? "fieldd's agent-gateway AR-7b row alone"
    : null;
}

/** The test stage's count for EVERY project, from its own section of Nx's output (`> nx run <project>:test`): vitest's
 * `Tests …` line, or node's test runner's `ℹ pass`/`ℹ fail`. A project whose section holds no count is SAID so — Nx
 * printed less of its output than it wrote (DK-18's final run: field-app's section stopped at 64 KiB under load 181) —
 * and its verdict is then Nx's alone: its exit, by the failed-tasks list. */
export function projectCounts(text) {
  const out = plain(text);
  const failed = new Set(
    [...out.matchAll(/^\s*-\s+(@vibefield\/\S+):test\s*$/gmu)].map((m) => m[1]),
  );
  const sections = out.split(/^> nx run (@vibefield\/\S+):test.*$/mu);
  const counts = [];
  for (let i = 1; i < sections.length; i += 2) {
    const name = sections[i];
    const body = sections[i + 1] ?? "";
    const vitest = body
      .match(/^\s*Tests\s+\d+.*$/gmu)
      ?.at(-1)
      ?.trim();
    const pass = /^ℹ pass (\d+)$/mu.exec(body)?.[1];
    const fail = /^ℹ fail (\d+)$/mu.exec(body)?.[1];
    const count =
      vitest ?? (pass !== undefined ? `pass ${pass} | fail ${fail ?? "?"} (node --test)` : null);
    counts.push(
      `${name}: ${count ?? `NO COUNT in the log — its exit: ${failed.has(name) ? "FAILED" : "0 (not among the failed tasks)"}`}`,
    );
  }
  return counts;
}

/** The lines a verdict quotes: the run's own words for its result. */
const SAYS = [
  /^\s*Tests\s+\d+.*$/u,
  /^\s*Test Files\s+.*$/u,
  /Successfully ran target \S+ for \d+ projects/u,
  /^Checked \d+ files.*$/u,
  /^Found \d+ (?:error|warning)s?.*$/u,
  /check-import-boundaries: clean|self-test: all passed/u,
  /check-retired-names: .*$/u,
  /check-single-copy: .*$|single-copy law violated/u,
  /bundle assert OK.*$/u,
  /^preflight (?:FAIL|ok).*$/u,
  /test result: .*$/u,
  /^SMOKE_DAEMONS .*$/u,
  /^SMOKE_\w*failed.*$|^\w+ failed: .*$/u,
  /^STUDIO_PHYSICAL .*$/u,
  /^BUNDLED_FIXTURE_DONE .*$/u,
  /^(?:ok|fail)\s+try\s+.*$/u,
  /^icons current.*$|^ios (?:fixtures|pins): .*$/u,
];

export function said(out) {
  const lines = plain(out).split("\n");
  const keep = [];
  for (const re of SAYS) {
    const hit = lines.filter((l) => re.test(l)).at(-1);
    if (hit !== undefined && !keep.includes(hit.trim())) keep.push(hit.trim());
  }
  return keep.map((l) => (l.length > 220 ? `${l.slice(0, 220)}…` : l));
}

/** The perf locks this run honours: `VF_PERF_LOCKS`, colon-separated paths; none named is none. */
export function perfLocks(env = process.env) {
  return (env.VF_PERF_LOCKS ?? "").split(":").filter((path) => path.length > 0);
}

/** Before a gate: wait while any of `locks` exists, saying so when the wait starts and when it ends; answers the ms waited.
 * With no lock named nothing is looked at, so a run without `VF_PERF_LOCKS` is today's exactly. A lock that appears while a
 * gate runs is met at the next gate's start: no gate is stopped for one. */
export async function waitForPerfLocks(
  locks,
  gate,
  {
    exists = existsSync,
    sleep = (ms) => new Promise((done) => setTimeout(done, ms)),
    say = (line) => process.stdout.write(`${line}\n`),
    now = Date.now,
    pollMs = 30_000,
  } = {},
) {
  if (locks.length === 0) return 0;
  const held = locks.filter((path) => exists(path));
  if (held.length === 0) return 0;
  const t0 = now();
  say(`GATE_WAIT ${gate} waits: a perf lock is held (${held.join(", ")})`);
  do await sleep(pollMs);
  while (locks.some((path) => exists(path)));
  const waited = now() - t0;
  say(`GATE_WAIT ${gate} waited ${(waited / 1000).toFixed(0)}s for the perf lock`);
  return waited;
}

function argValue(flag) {
  const i = process.argv.indexOf(flag);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

function choose() {
  let list = process.argv.includes("--with-stages") ? [...STAGES, ...LANDING] : [...LANDING];
  const only = argValue("--only");
  if (only !== undefined) {
    const names = only.split(",");
    const unknown = names.filter((n) => ![...STAGES, ...LANDING].some((g) => g.name === n));
    if (unknown.length > 0) throw new Error(`no such gate: ${unknown.join(", ")}`);
    list = [...STAGES, ...LANDING].filter((g) => names.includes(g.name));
  }
  const from = argValue("--from");
  if (from !== undefined) {
    const at = list.findIndex((g) => g.name === from);
    if (at < 0) throw new Error(`no such gate in the list: ${from}`);
    list = list.slice(at);
  }
  return list;
}

/** The gate running now, its process group — what a signal to this script, or the timeout, stops. */
let running = null;
/** The signal a person stopped the run with: the gate running then is stopped, and none after it starts. */
let interrupted = null;

/** A gate in its own process group (a smoke is a tree: pnpm, the launcher, Electron, the daemons), stopped WHOLE at the
 * timeout as the kit's `try` stops the app: SIGTERM to the group (the smoke launchers forward it to Electron and still
 * take their daemon row), SIGKILL 20 s later. */
function runGate(gate, logPath, timeoutMs) {
  return new Promise((done) => {
    const log = createWriteStream(logPath);
    const t0 = Date.now();
    const child = spawn(gate.run[0], gate.run.slice(1), {
      cwd: ROOT,
      env: { ...process.env, NX_SKIP_NX_CACHE: "true", NX_DAEMON: "false" },
      detached: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    running = child;
    child.stdout.pipe(log, { end: false });
    child.stderr.pipe(log, { end: false });
    let timedOut = false;
    let kill = null;
    const stop = (signal) => {
      try {
        process.kill(-child.pid, signal);
      } catch {
        child.kill(signal);
      }
    };
    const timer = setTimeout(() => {
      timedOut = true;
      log.write(
        `\ngate-landing: ${gate.name} ran past ${timeoutMs / 60_000} min and was stopped\n`,
      );
      stop("SIGTERM");
      kill = setTimeout(() => stop("SIGKILL"), 20_000);
    }, timeoutMs);
    child.once("close", (code, signal) => {
      clearTimeout(timer);
      clearTimeout(kill);
      running = null;
      log.end(() => done({ code: code ?? 128, signal, ms: Date.now() - t0, timedOut }));
    });
  });
}

const load = () =>
  loadavg()
    .map((v) => v.toFixed(0))
    .join("/");

async function main() {
  const list = choose();
  if (process.argv.includes("--list")) {
    for (const g of list) process.stdout.write(`${g.name}\t${g.run.join(" ")}\n`);
    return 0;
  }
  const timeoutMs = Number(argValue("--timeout-min") ?? 30) * 60_000;
  // a person's ^C (or a stop) reaches the gate running now — its group is not this script's; no gate after it starts, and
  // the run leaves once that gate has (its launcher's daemon row in its log), 30 s at most
  for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"])
    process.on(signal, () => {
      interrupted = signal;
      if (running === null) process.exit(128 + constants.signals[signal]);
      try {
        process.kill(-running.pid, signal);
      } catch {}
      setTimeout(() => process.exit(128 + constants.signals[signal]), 30_000).unref();
    });
  const logs = argValue("--logs") ?? mkdtempSync(join(tmpdir(), "vf-gate-landing-"));
  mkdirSync(logs, { recursive: true });
  const head = spawnSync("git", ["rev-parse", "HEAD"], {
    cwd: ROOT,
    encoding: "utf8",
  }).stdout.trim();
  process.stdout.write(
    `GATE_LANDING ${JSON.stringify({ sha: head, gates: list.length, logs, at: new Date().toISOString(), load: load() })}\n`,
  );
  // the Mac kept awake for as long as this runs (macOS's own tool; elsewhere nothing to do)
  if (process.platform === "darwin")
    spawn("caffeinate", ["-i", "-w", String(process.pid)], {
      stdio: "ignore",
      detached: true,
    }).unref();
  const verdicts = [];
  const locks = perfLocks();
  for (const [i, gate] of list.entries()) {
    await waitForPerfLocks(locks, gate.name);
    const logPath = join(
      logs,
      `${String(i + 1).padStart(2, "0")}-${gate.name.replaceAll(":", "_")}.log`,
    );
    const before = load();
    const { code, ms, timedOut } = await runGate(gate, logPath, timeoutMs);
    const out = readFileSync(logPath, "utf8");
    const mains = code === 0 || timedOut || gate.main === undefined ? null : gate.main(out);
    const verdict = timedOut
      ? `RED (stopped at ${timeoutMs / 60_000} min)`
      : code === 0
        ? "ok"
        : mains !== null
          ? "red — main's"
          : "RED";
    verdicts.push({ gate: gate.name, verdict, code: timedOut ? -1 : code, main: mains });
    process.stdout.write(
      `GATE ${gate.name} ${verdict} exit=${code} ${(ms / 1000).toFixed(0)}s load ${before}→${load()}${mains === null ? "" : ` (main's: ${mains})`}\n`,
    );
    // a stopped gate's own last words are no verdict (Nx, stopped, still says it "successfully ran"): its stop is
    const stopped = timedOut
      ? [`${gate.name} ran past ${timeoutMs / 60_000} min and was stopped`]
      : null;
    const counts = stopped ?? gate.counts?.(out) ?? [];
    for (const line of counts) process.stdout.write(`    ${line}\n`);
    // a gate that says each project's count needs no last project's line beside them
    for (const line of (stopped === null ? said(out) : []).filter(
      (l) => counts.length === 0 || !/^Test(?:s| Files)\s/u.test(l),
    ))
      process.stdout.write(`    ${line}\n`);
    process.stdout.write(`    log ${logPath}\n`);
    if (interrupted !== null) break;
  }
  const red = verdicts.filter((v) => v.code !== 0);
  process.stdout.write(
    `GATE_LANDING_DONE ${JSON.stringify({ sha: head, ok: red.length === 0 && interrupted === null, red: red.map((v) => `${v.gate}${v.main === null ? "" : " (main's)"}`), ...(interrupted === null ? {} : { stopped: interrupted, ran: verdicts.length, of: list.length }), at: new Date().toISOString() })}\n`,
  );
  if (interrupted !== null) return 128 + constants.signals[interrupted];
  return red.length === 0 ? 0 : 1;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href)
  main().then(
    (code) => process.exit(code),
    (error) => {
      process.stderr.write(
        `gate-landing: ${error instanceof Error ? error.message : String(error)}\n`,
      );
      process.exit(2);
    },
  );
