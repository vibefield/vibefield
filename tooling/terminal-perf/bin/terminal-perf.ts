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
import { existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
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
import { analyzeTrace, renderTraceAnalysis, type TraceEvent } from "../src/trace-analysis.ts";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "..", "..", "..");
const labRoot = join(repoRoot, ".vibefield", "terminal-perf-lab");
const resultsHome =
  process.env["TERMINAL_PERF_RESULTS_HOME"] ?? join(repoRoot, "draft", "terminal-perf", "results");

// ---- args --------------------------------------------------------------------

const argv = process.argv.slice(2);
const positional = argv.filter((a) => !a.startsWith("--"));
const flag = (name: string, fallback: string | null = null): string | null => {
  const index = argv.indexOf(`--${name}`);
  return index >= 0 && index + 1 < argv.length ? (argv[index + 1] as string) : fallback;
};
const has = (name: string): boolean => argv.includes(`--${name}`);

if (has("help") || positional.length === 0) {
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

const exitCode: number = await new Promise((resolveExit) => {
  child.on("exit", (code) => resolveExit(code ?? 0));
});

const reported = /TERMINAL_PERF_LAB_OUT (.+)/u.exec(stdout)?.[1]?.trim() ?? outDir;
process.stdout.write(`\nlab exited ${exitCode}; artifacts in ${reported}\n`);

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
