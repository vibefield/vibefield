#!/usr/bin/env node
// `pnpm perf:terminal <scenario>` — TP-S0c's driver (§19.3).
//
// Builds what the lab needs, launches the `--terminal-perf-lab` Electron mode,
// and publishes the run into the results home. Run directly by `node`: Node 26
// strips types, which is why this file and `native-control.ts` import with
// explicit `.ts` extensions while the modules esbuild bundles do not.
//
// THE A/B LIVES INSIDE ONE LAUNCH. `--ab metrics,off` does NOT mean two
// processes: it means one window, one deck, one generator, one daemon pair, and
// the sampler mode alternating across rotations with the order flipped each
// time. Two launches would vary the daemon, the pty set, the atlas, the page
// and the host's mood along with the arm — a comparison of two different days.
//
// THE NATIVE CONTROL IS OPT-IN AND GATED, and the gate is not ceremony. The
// control injects real CGEvents through the window server, which deliver to
// whatever window has keyboard focus. On a machine somebody is using, that is
// typing into their editor, their browser or their chat. So `--native-control`
// additionally requires `--i-have-the-display`, and the driver refuses when it
// can see foreign on-screen windows unless that flag is present.

import { execFileSync, spawn, spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { cpus, hostname, loadavg, totalmem } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  type ControlArm,
  compareControl,
  type EchoRecord,
  type InjectRecord,
  pairProbes,
  parseJsonl,
  renderControlReport,
  summarizeArm,
} from "../src/native-control.ts";
import { findStrays, orderForReaping, type StrayProcess } from "../src/reap.ts";
import { analyzeTrace, renderTraceAnalysis, type TraceEvent } from "../src/trace-analysis.ts";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "..", "..", "..");
const labRoot = join(repoRoot, ".vibefield", "terminal-perf-lab");
const resultsHome =
  process.env["TERMINAL_PERF_RESULTS_HOME"] ?? join(repoRoot, "draft", "terminal-perf", "results");

// ---- the reaper ---------------------------------------------------------------
//
// field-native is spawned DETACHED and outlives its parent by design (the
// two-plane law): that is the product's guarantee, and it is also why a harness
// that forgets to stop what it started leaks a whole floor — its cells, its
// shells, and one pty per session. This lab did exactly that for fifteen runs
// and put the machine at 527 ptys against a SYSTEM-WIDE ceiling of 511, which
// fails every terminal test and every new shell on the box, not just ours.
//
// The lab now tears down properly. This is the second line of defence, for the
// cases teardown cannot cover: a hard kill, a crash before `finally`, a wedged
// daemon that outlasts the dispose bound.
//
// IT MATCHES ON THIS WORKTREE'S ABSOLUTE PATH and nothing else. Every process it
// will ever signal carries `<repoRoot>/` in its argv, so it cannot reach another
// worktree's floors, and it certainly cannot reach James's. A reaper that
// matched on `field-native` alone would be a fleet-wide kill switch.

function currentStrays(): StrayProcess[] {
  const listing = spawnSync("/bin/ps", ["-axwwo", "pid=,command="], { encoding: "utf8" });
  if (listing.status !== 0 || typeof listing.stdout !== "string") return [];
  return findStrays(listing.stdout, repoRoot, [process.pid, process.ppid]);
}

/** SIGTERM, wait, SIGKILL. fieldd FIRST so nothing respawns behind the kill,
 * then the floor, then any cell that outlived it. */
function reapStrays(strays: readonly StrayProcess[]): number {
  let signalled = 0;
  for (const stray of orderForReaping(strays)) {
    try {
      process.kill(stray.pid, "SIGTERM");
      signalled += 1;
    } catch {
      /* already gone */
    }
  }
  if (signalled > 0) spawnSync("sleep", ["3"]);
  for (const stray of strays) {
    try {
      process.kill(stray.pid, 0);
      process.kill(stray.pid, "SIGKILL");
    } catch {
      /* gone, which is the point */
    }
  }
  return signalled;
}

const ptyCount = (): number => {
  try {
    return readdirSync("/dev").filter((entry) => entry.startsWith("ttys")).length;
  } catch {
    return -1;
  }
};

// ---- args --------------------------------------------------------------------

const argv = process.argv.slice(2);
const positional = argv.filter((a) => !a.startsWith("--"));
const flag = (name: string, fallback: string | null = null): string | null => {
  const index = argv.indexOf(`--${name}`);
  return index >= 0 && index + 1 < argv.length ? (argv[index + 1] as string) : fallback;
};
const has = (name: string): boolean => argv.includes(`--${name}`);

// `--reap` is the one verb that takes no scenario, so it must not fall into the
// no-arguments help branch.
if (has("help") || (positional.length === 0 && !has("reap"))) {
  process.stdout.write(`pnpm perf:terminal <scenario> [options]

  --duration <s>          total wall seconds of measured arms (default 30)
  --mode <m>              metrics | production | off | trace   (default metrics)
  --ab <A,B>              interleaved arms inside ONE launch, e.g. metrics,off
  --rotations <n>         interleaved rotations (default 3)
  --arm-seconds <s>       seconds per arm per rotation (derived from --duration)
  --probe-keys <n>        keystrokes injected per arm (window-local, safe)
  --out <dir>             results directory (default <home>/<YYYYMMDD>-<scenario>)
  --native-control        ALSO run the Ghostty A-vs-A (needs --i-have-the-display)
  --i-have-the-display    acknowledge that OS-level key injection types into
                          whatever window has focus on this machine
  --native-app <name>     the app for the control arm (default Ghostty)
  --control-keys <n>      keystrokes per control arm (default 300)
  --control-gap-ms <ms>   gap between control keystrokes (default 40)
  --font-size <n>         font size for BOTH control arms (default 13)
  --refresh-hz <n>        the display's refresh, recorded as fixture identity (default 120)
  --reap                  kill THIS worktree's leftover floors/cells/fieldd and exit
  --no-build              skip the builds and use what is on disk
  --keep-trace            keep the raw Perfetto trace (hundreds of MB); by
                          default it is analysed and then deleted

The environment also carries two knobs the lab reads directly:
  VF_PERF_WINDOW=default|workarea   window size (a pane ceiling depends on it)
  VF_PERF_DEBUG=1                   pass the renderer's console through

scenarios: run with an unknown one to have the lab list them.
`);
  process.exit(0);
}

if (has("reap")) {
  const strays = currentStrays();
  if (strays.length === 0) {
    process.stdout.write(`nothing of ${repoRoot} is running; ${ptyCount()} ptys on the machine\n`);
    process.exit(0);
  }
  process.stdout.write(`reaping ${strays.length} stray process(es) from ${repoRoot}:\n`);
  for (const stray of strays) process.stdout.write(`  ${stray.kind.padEnd(6)} ${stray.pid}\n`);
  const before = ptyCount();
  reapStrays(strays);
  spawnSync("sleep", ["2"]);
  process.stdout.write(`ptys ${before} -> ${ptyCount()}\n`);
  process.exit(0);
}

// THE PRE-FLIGHT REFUSAL. A scenario started on top of a previous run's floors
// measures both of them, and every pty the old one holds is one this one cannot
// have — against a system-wide ceiling of 511. So the driver stops rather than
// adding to the pile, and names the command that clears it.
const stale = currentStrays();
if (stale.length > 0) {
  const byKind = new Map<string, number>();
  for (const stray of stale) byKind.set(stray.kind, (byKind.get(stray.kind) ?? 0) + 1);
  process.stderr.write(
    `\nREFUSED: ${stale.length} process(es) from a previous run of this worktree are still alive ` +
      `(${[...byKind].map(([k, n]) => `${n} ${k}`).join(", ")}), holding ptys against this ` +
      `machine's system-wide ceiling of 511 (${ptyCount()} in use now).\n\n` +
      `  pnpm perf:terminal --reap\n\n` +
      `clears them. Starting a scenario on top of them would measure both runs.\n`,
  );
  process.exit(2);
}

const scenario = positional[0] as string;
const duration = Number(flag("duration", "30"));
const mode = flag("mode", "metrics") as string;
const arms = (flag("ab", null) ?? mode).split(",").filter((a) => a !== "");
const rotations = Number(flag("rotations", "3"));
const armSeconds = Number(
  flag("arm-seconds", String(Math.max(4, Math.round(duration / (arms.length * rotations))))),
);
const probeKeys = Number(flag("probe-keys", scenario === "echo-probe" ? "60" : "40"));
const stamp = new Date().toISOString().slice(0, 10).replace(/-/gu, "");
const outDir = flag("out", join(resultsHome, `${stamp}-${scenario}`)) as string;

// ---- build -------------------------------------------------------------------

const run = (
  command: string,
  args: readonly string[],
  options: { cwd?: string; env?: NodeJS.ProcessEnv } = {},
): void => {
  process.stdout.write(`\n$ ${command} ${args.join(" ")}\n`);
  execFileSync(command, args as string[], {
    cwd: options.cwd ?? repoRoot,
    stdio: "inherit",
    env: { ...process.env, ...options.env },
  });
};

if (!has("no-build")) {
  // The shell bundle (main + preload + the testing artifact that carries the
  // lab), then the lab RENDERER — a separate vite mode into its own directory,
  // so `dist/renderer` (the one packaging picks up) is never touched.
  run("pnpm", ["--filter", "@vibefield/electron-shell", "run", "build"]);
  run("pnpm", ["--filter", "@vibefield/fieldd", "run", "build"]);
  run("pnpm", [
    "--filter",
    "@vibefield/electron-shell",
    "exec",
    "vite",
    "build",
    "--mode",
    "terminal-perf-lab",
  ]);
  buildSwiftHelpers();
}

/** The two compiled helpers the native control needs. Built here rather than
 * checked in: they are 80KB of platform-specific machine code whose source is
 * thirty lines, and a stale binary against a changed source is a measurement
 * bug nobody would look for. Missing `swiftc` is not fatal — it only means the
 * control cannot run, which the gate below says out loud. */
function buildSwiftHelpers(): void {
  const binDir = join(labRoot, "bin");
  mkdirSync(binDir, { recursive: true });
  for (const name of ["inject-keys", "list-windows"]) {
    const source = join(repoRoot, "tooling", "terminal-perf", "fixture", `${name}.swift`);
    const result = spawnSync("swiftc", ["-O", "-o", join(binDir, name), source], {
      encoding: "utf8",
    });
    if (result.status !== 0) {
      process.stdout.write(
        `\n(the ${name} helper did not build — the native control will be unavailable)\n` +
          `${result.stderr ?? ""}\n`,
      );
    }
  }
}

// THE RUST HALF, which no JS build produces. Without it fieldd exits before
// readiness and the only thing anyone sees is "field-native did not come up
// before the readiness deadline" — twenty minutes of debugging the wrong plane,
// twice in this slice's own history (once at the start, once after a rebase had
// removed the binary). Six lines to say it plainly instead.
const fieldNative = join(repoRoot, "target", "debug", "field-native");
if (!existsSync(fieldNative)) {
  process.stderr.write(
    `\nthe Rust floor is not built: ${fieldNative} is missing.\n` +
      "  cargo build\n" +
      "\nWithout it fieldd exits before readiness and the lab reports a daemon problem\n" +
      "rather than a missing binary.\n",
  );
  process.exit(2);
}

const labRenderer = join(labRoot, "renderer");
if (!existsSync(join(labRenderer, "index.html"))) {
  process.stderr.write(
    `\nthe lab renderer is missing at ${labRenderer}\n` +
      "run without --no-build, or: pnpm --filter @vibefield/electron-shell exec vite build --mode terminal-perf-lab\n",
  );
  process.exit(2);
}

// ---- launch ------------------------------------------------------------------

mkdirSync(outDir, { recursive: true });

const hostFacts = {
  host: hostname(),
  cpus: cpus().length,
  cpuModel: cpus()[0]?.model ?? "unknown",
  memoryGiB: Math.round(totalmem() / 1024 ** 3),
  node: process.version,
  platform: `${process.platform}/${process.arch}`,
  loadavgAtStart: loadavg(),
};

process.stdout.write(
  `\n=== ${scenario} ===\n` +
    `arms ${JSON.stringify(arms)} × ${rotations} rotations × ${armSeconds}s\n` +
    `probe keys per arm: ${probeKeys}\n` +
    `host load at start: ${loadavg()
      .map((v) => v.toFixed(2))
      .join(" / ")}\n` +
    `out: ${outDir}\n`,
);

const desktopRoot = join(repoRoot, "apps", "desktop");
// electron is a dependency of `apps/desktop`, not of the root: pnpm's store is
// not hoisted, so the binary lives in the package that declares it — which is
// also the cwd the app must be launched from (`electron .` resolves the app
// from there).
const electronBin = join(desktopRoot, "node_modules", ".bin", "electron");
if (!existsSync(electronBin)) {
  process.stderr.write(`electron is not installed at ${electronBin} — run pnpm install\n`);
  process.exit(2);
}

const child = spawn(
  electronBin,
  [".", "--terminal-perf-lab", "-ApplePersistenceIgnoreState", "YES"],
  {
    cwd: desktopRoot,
    env: {
      ...process.env,
      // Smokes and labs need a short TMPDIR: a long worktree path overruns the
      // sockaddr_un limit and the run exits 1 with nothing printed.
      TMPDIR: "/tmp",
      VF_TERMINAL_PERF_LAB_RENDERER: labRenderer,
      VF_PERF_SCENARIO: scenario,
      VF_PERF_OUT: outDir,
      VF_PERF_ARMS: arms.join(","),
      VF_PERF_ROTATIONS: String(rotations),
      VF_PERF_ARM_MS: String(Math.round(armSeconds * 1000)),
      VF_PERF_PROBE_KEYS: String(probeKeys),
      ...(mode === "trace" || has("trace") ? { VF_PERF_TRACE: "1" } : {}),
    },
    stdio: ["ignore", "pipe", "pipe"],
  },
);

let stdout = "";
child.stdout.on("data", (chunk: Buffer) => {
  const text = chunk.toString();
  stdout += text;
  process.stdout.write(text);
});
child.stderr.on("data", (chunk: Buffer) => process.stderr.write(chunk.toString()));

// THE CHILD'S LEASH. The lab arms its own watchdogs, but a driver that simply
// awaits `exit` has no answer when the lab never gets there — and that is what
// happened: 45 lab Electrons survived their scenarios, aged up to 1h11, each
// holding a detached floor, until the machine ran out of ptys. So the driver
// bounds the child, kills it if it overruns, and kills it on its OWN way out.
const childBudgetMs = Math.max(
  180_000,
  Math.round(arms.length * rotations * armSeconds * 1000) + 20 * 60_000,
);

const killChild = (signal: NodeJS.Signals): void => {
  try {
    child.kill(signal);
  } catch {
    /* already gone */
  }
};
// A driver killed at the terminal must not orphan an Electron holding a floor.
const onSignal = (signal: NodeJS.Signals): void => {
  process.stderr.write(`\nterminal-perf: ${signal} — killing the lab child before leaving\n`);
  killChild("SIGKILL");
  process.exit(130);
};
process.on("SIGINT", () => onSignal("SIGINT"));
process.on("SIGTERM", () => onSignal("SIGTERM"));

let timedOut = false;
const leash = setTimeout(() => {
  timedOut = true;
  process.stderr.write(
    `\nterminal-perf: the lab exceeded ${Math.round(childBudgetMs / 1000)}s — SIGTERM, then SIGKILL\n`,
  );
  killChild("SIGTERM");
  setTimeout(() => killChild("SIGKILL"), 10_000).unref();
}, childBudgetMs);

const exitCode: number = await new Promise((resolveExit) => {
  child.on("exit", (code, signal) => {
    clearTimeout(leash);
    resolveExit(code ?? (signal === null ? 0 : 1));
  });
});
if (timedOut) process.stderr.write("terminal-perf: the run was killed on its deadline\n");

const reported = /TERMINAL_PERF_LAB_OUT (.+)/u.exec(stdout)?.[1]?.trim() ?? outDir;
process.stdout.write(`\nlab exited ${exitCode}; artifacts in ${reported}\n`);

// THE EXIT IS OBSERVED, NOT ASSUMED. `child.on("exit")` says the driver's own
// child ended; it says nothing about an Electron that re-execed, nor about the
// detached floor underneath it. So the driver looks at the machine, waits a
// bounded moment for a clean shutdown to finish, and reaps what is left rather
// than leaving it for the next agent to find.
let lingering = currentStrays();
for (let attempt = 0; attempt < 10 && lingering.length > 0; attempt += 1) {
  spawnSync("sleep", ["1"]);
  lingering = currentStrays();
}
if (lingering.length > 0) {
  const byKind = new Map<string, number>();
  for (const stray of lingering) byKind.set(stray.kind, (byKind.get(stray.kind) ?? 0) + 1);
  process.stderr.write(
    `\nterminal-perf: ${lingering.length} process(es) outlived the run ` +
      `(${[...byKind].map(([kind, n]) => `${n} ${kind}`).join(", ")}) — reaping them now\n`,
  );
  reapStrays(lingering);
  spawnSync("sleep", ["2"]);
  const stillThere = currentStrays();
  process.stdout.write(
    stillThere.length === 0
      ? `terminal-perf: reaped; ${ptyCount()} ptys on the machine\n`
      : `terminal-perf: ${stillThere.length} process(es) SURVIVED the reap — investigate\n`,
  );
} else {
  process.stdout.write(`terminal-perf: nothing outlived the run; ${ptyCount()} ptys\n`);
}

// ---- the trace, reduced ------------------------------------------------------

const tracePath = join(outDir, "trace.json");
if (existsSync(tracePath)) {
  const bytes = statSync(tracePath).size;
  process.stdout.write(`\nanalysing the trace (${(bytes / 1024 ** 2).toFixed(0)} MB)…\n`);
  try {
    const parsed = JSON.parse(readFileSync(tracePath, "utf8")) as
      | TraceEvent[]
      | { traceEvents: TraceEvent[] };
    const events = Array.isArray(parsed) ? parsed : parsed.traceEvents;
    const analysis = analyzeTrace(events);
    writeFileSync(
      join(outDir, "TRACE-ANALYSIS.md"),
      `${renderTraceAnalysis(analysis, tracePath)}\n`,
    );
    writeFileSync(join(outDir, "trace-analysis.json"), `${JSON.stringify(analysis, null, 2)}\n`);
    process.stdout.write(`${renderTraceAnalysis(analysis, tracePath)}\n`);
  } catch (error) {
    process.stderr.write(`the trace could not be analysed: ${String(error)}\n`);
  }
  if (!has("keep-trace")) {
    // A keystroke trace of a ten-second run is ~190MB, and the results home is
    // a directory people keep. The ANALYSIS is the artifact; the raw trace is
    // reproducible from the same command with --keep-trace, and is worth
    // keeping only while somebody is actually going to open ui.perfetto.dev.
    rmSync(tracePath, { force: true });
    process.stdout.write(
      `\n(raw trace deleted — ${(bytes / 1024 ** 2).toFixed(0)} MB; re-run with --keep-trace to keep it)\n`,
    );
  }
}

// ---- the native control ------------------------------------------------------

/** On-screen windows that are not ours. Cheap, and the difference between a
 * lab machine and somebody's desk. */
function foreignWindows(): string[] {
  const helper = join(labRoot, "bin", "list-windows");
  if (!existsSync(helper)) return ["(window list helper not built — cannot tell)"];
  const result = spawnSync(helper, [], { encoding: "utf8" });
  if (result.status !== 0) return ["(window list helper failed — cannot tell)"];
  return result.stdout
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line !== "" && !/^(Electron|VibeField)\b/u.test(line));
}

const NODE_BIN = process.execPath;
const injector = join(labRoot, "bin", "inject-keys");

/** Run the echo fixture inside one terminal application and post `count` real
 * keystrokes at it. Returns the two files the pairing needs.
 *
 * The app is launched with `open -na`, which is the only supported way to start
 * a GUI terminal with arguments on macOS (`ghostty --help` says so itself: "On
 * macOS, launching the terminal emulator from the CLI is not supported"). The
 * fixture's own `start` line is the readiness signal — not a sleep, because a
 * cold app launch is seconds and a warm one is not. */
function runNativeArm(options: {
  app: string;
  fontSize: number;
  seconds: number;
  count: number;
  gapMs: number;
  outDir: string;
}): { echoPath: string; injectPath: string } | null {
  const echoPath = join(options.outDir, `echo-${options.app}.jsonl`);
  const injectPath = join(options.outDir, `inject-${options.app}.jsonl`);
  const fixture = join(repoRoot, "tooling", "terminal-perf", "fixture", "echo-probe.mjs");

  spawnSync("open", [
    "-na",
    options.app,
    "--args",
    `--font-size=${options.fontSize}`,
    "-e",
    NODE_BIN,
    fixture,
    "--out",
    echoPath,
    "--seconds",
    String(options.seconds),
    "--dsr",
  ]);

  // Wait for the fixture's own header rather than for a clock.
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    if (existsSync(echoPath) && readFileSync(echoPath, "utf8").includes('"kind":"start"')) break;
    spawnSync("sleep", ["0.2"]);
  }
  if (!existsSync(echoPath)) {
    process.stderr.write(`the echo fixture never started under ${options.app}\n`);
    return null;
  }

  spawnSync("osascript", ["-e", `tell application "${options.app}" to activate`]);
  spawnSync("sleep", ["1"]);
  const result = spawnSync(
    injector,
    ["--count", String(options.count), "--gap-ms", String(options.gapMs), "--out", injectPath],
    { encoding: "utf8" },
  );
  if (result.status !== 0) process.stderr.write(`${result.stderr ?? ""}\n`);
  spawnSync("sleep", ["1"]);
  return { echoPath, injectPath };
}

if (has("native-control")) {
  const foreign = foreignWindows();
  const app = flag("native-app", "Ghostty") as string;
  if (!existsSync(injector)) {
    process.stderr.write(
      `\nthe native control cannot run: ${injector} is missing (swiftc failed or --no-build skipped it)\n`,
    );
  } else if (!has("i-have-the-display")) {
    process.stderr.write(
      `\nREFUSED: --native-control posts real keyboard events through the window server.\n` +
        `They deliver to whatever window has focus on this machine, and ${foreign.length} foreign\n` +
        `window(s) are on screen right now:\n` +
        `${foreign
          .slice(0, 8)
          .map((w) => `  - ${w}`)
          .join("\n")}\n` +
        `\nRun it on a quiet session and pass --i-have-the-display to acknowledge.\n`,
    );
  } else {
    if (foreign.length > 0) {
      process.stdout.write(
        `\nWARNING: ${foreign.length} foreign window(s) are on screen; keystrokes go to whatever\n` +
          `has focus. Proceeding because --i-have-the-display was given.\n`,
      );
    }
    const fontSize = Number(flag("font-size", "13"));
    const keys = Number(flag("control-keys", "300"));
    const gapMs = Number(flag("control-gap-ms", "40"));
    const seconds = Math.ceil((keys * gapMs) / 1000) + 20;

    process.stdout.write(`\n--- native arm: ${app} ---\n`);
    const native = runNativeArm({ app, fontSize, seconds, count: keys, gapMs, outDir });

    const armFor = (terminal: string, files: { echoPath: string; injectPath: string } | null) => {
      if (files === null) return null;
      const echoes = parseJsonl<EchoRecord>(readFileSync(files.echoPath, "utf8"));
      const injects = parseJsonl<InjectRecord>(readFileSync(files.injectPath, "utf8"));
      const start = echoes.find((r) => r.kind === "start");
      return summarizeArm({
        terminal,
        cols: start?.cols ?? null,
        rows: start?.rows ?? null,
        fontSize,
        // Read from the display rather than assumed: TP-R13 names refresh as
        // part of the fixture identity, and this Mac's panel is variable-rate.
        refreshHz: Number(flag("refresh-hz", "120")),
        pairing: pairProbes(injects, echoes),
      });
    };

    const armsRun: ControlArm[] = [];
    const nativeArm = armFor(app, native);
    if (nativeArm !== null) armsRun.push(nativeArm);

    // The VibeField arm needs its own launch: the lab in `echo-probe` with
    // `VF_PERF_PROBE_INJECT=os`, which holds the pane focused and injects
    // nothing itself while this process posts the same CGEvents at it.
    process.stdout.write("\n--- VibeField arm ---\n");
    const vfDir = join(outDir, "native-control-vibefield");
    mkdirSync(vfDir, { recursive: true });
    const vf = spawn(
      electronBin,
      [".", "--terminal-perf-lab", "-ApplePersistenceIgnoreState", "YES"],
      {
        cwd: desktopRoot,
        env: {
          ...process.env,
          TMPDIR: "/tmp",
          VF_TERMINAL_PERF_LAB_RENDERER: labRenderer,
          VF_PERF_SCENARIO: "echo-probe",
          VF_PERF_OUT: vfDir,
          VF_PERF_ARMS: "metrics",
          VF_PERF_ROTATIONS: "1",
          VF_PERF_ARM_MS: String(Math.round(keys * gapMs + 6000)),
          VF_PERF_PROBE_KEYS: "0",
          VF_PERF_PROBE_INJECT: "os",
        },
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    // Watched for one marker, not accumulated: this arm's transcript is echoed
    // for the operator and its ARTIFACTS are the two jsonl files, so keeping the
    // bytes would only be keeping them.
    let injectedForVf = false;
    vf.stdout.on("data", (chunk: Buffer) => {
      const text = chunk.toString();
      process.stdout.write(text);
      if (!injectedForVf && text.includes("TERMINAL_PERF_LAB_ARM_READY")) {
        injectedForVf = true;
        // Detached so the arm's own clock keeps running while keys are posted.
        spawn(
          injector,
          [
            "--count",
            String(keys),
            "--gap-ms",
            String(gapMs),
            "--out",
            join(vfDir, "inject-vibefield.jsonl"),
          ],
          { stdio: "ignore" },
        ).unref();
      }
    });
    vf.stderr.on("data", (chunk: Buffer) => process.stderr.write(chunk.toString()));
    await new Promise<void>((done) => vf.on("exit", () => done()));

    const vfEcho = join(vfDir, "echo-fixture.jsonl");
    const vfInject = join(vfDir, "inject-vibefield.jsonl");
    const vfArm =
      existsSync(vfEcho) && existsSync(vfInject)
        ? armFor("VibeField", { echoPath: vfEcho, injectPath: vfInject })
        : null;
    if (vfArm !== null) armsRun.push(vfArm);

    const comparison = compareControl(armsRun);
    writeFileSync(join(outDir, "native-control.json"), `${JSON.stringify(comparison, null, 2)}\n`);
    writeFileSync(join(outDir, "NATIVE-CONTROL.md"), `${renderControlReport(comparison)}\n`);
    process.stdout.write(`\n${renderControlReport(comparison)}\n`);
  }
}

// ---- publish -----------------------------------------------------------------

writeFileSync(
  join(outDir, "host.json"),
  `${JSON.stringify({ ...hostFacts, loadavgAtEnd: loadavg() }, null, 2)}\n`,
);

// The lab writes RESULTS.md itself so a crashed run still leaves one; if it did
// not get that far, leave a stub saying so rather than an empty directory.
const resultsPath = join(outDir, "RESULTS.md");
if (!existsSync(resultsPath)) {
  writeFileSync(
    resultsPath,
    `# TP-S0c lab run — \`${scenario}\`\n\nThe lab exited ${exitCode} before it wrote a report.\n\n` +
      "```\n" +
      stdout.slice(-4000) +
      "\n```\n",
  );
}

process.stdout.write(`\n${readFileSync(resultsPath, "utf8").slice(0, 4000)}\n`);
process.exit(exitCode);

// Keeps the import graph honest for a reader: these are the control's reducers,
// exercised by `test/native-control.test.ts` and used once the control is run.
export type { ControlArm, EchoRecord, InjectRecord };
export { compareControl, pairProbes, parseJsonl, renderControlReport, summarizeArm };
