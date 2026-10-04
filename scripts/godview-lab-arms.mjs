// THE GODVIEW LAB'S ARMS (MV-3c) — what the paired perf runner
// (`perf-godview.mjs`) and the capture runner (`capture-godview.mjs`) share:
// building a root, computing a root's model streams, and launching the product
// in the lab's mode with an environment, one fresh Electron process per launch.

import { spawn } from "node:child_process";
import { existsSync, writeFileSync } from "node:fs";
import { loadavg } from "node:os";
import { join } from "node:path";

/** Keep in step with `DEFAULT_WARMUP_RECIPE` in electron-shell's godview-perf-lab.ts. */
export const WARMUP_RECIPE = "n=10,duration=1500,seed=9,markerQuietMs=50";

export const log = (line) => process.stdout.write(`${line}\n`);

const sleep = (ms) => new Promise((done) => setTimeout(done, ms));

/** L17: wait for the one-minute load average to fall below `max`; returns it. */
export async function waitForLoad(max) {
  for (;;) {
    const [one] = loadavg();
    if (one < max) return one;
    log(`load ${one.toFixed(1)} ≥ ${max}: waiting (L17)`);
    await sleep(15_000);
  }
}

export function run(command, args, cwd, env, logPath) {
  return new Promise((done, fail) => {
    const child = spawn(command, args, { cwd, env, stdio: ["ignore", "pipe", "pipe"] });
    const lines = [];
    child.stdout.on("data", (chunk) => lines.push(String(chunk)));
    child.stderr.on("data", (chunk) => lines.push(String(chunk)));
    child.on("error", fail);
    child.on("exit", (code) => {
      writeFileSync(logPath, lines.join(""));
      if (code === 0) done();
      else
        fail(new Error(`${command} ${args.join(" ")} in ${cwd} exited ${code} (log: ${logPath})`));
    });
  });
}

/** Build a root's desktop app with React's profiling client (M33's render time). */
export async function buildRoot(root, logPath) {
  log(`build ${root} (VF_REACT_PROFILING=1)`);
  await run(
    "pnpm",
    ["--filter", "@vibefield/desktop", "build:all"],
    root,
    { ...process.env, TMPDIR: "/tmp", NX_DAEMON: "false", VF_REACT_PROFILING: "1" },
    logPath,
  );
}

/** The root's testing bundle, or null when it is not built. */
export function builtBundle(root) {
  const bundle = join(root, "packages", "electron-shell", "dist", "testing", "smoke.cjs");
  return existsSync(bundle) ? bundle : null;
}

/** The model streams a root's fieldd answers for `recipes`, computed in THAT
 * root (its backend, its board, its relay), into `dir`. */
export async function modelStreams(root, dir, recipes, logPath) {
  log(`model streams: computing in ${root} → ${dir}`);
  await run(
    "pnpm",
    ["--filter", "@vibefield/field-app", "perf:godview:model"],
    root,
    {
      ...process.env,
      TMPDIR: "/tmp",
      NX_DAEMON: "false",
      VF_GODVIEW_MODEL_OUT: dir,
      VF_GODVIEW_MODEL_RECIPES: recipes,
    },
    logPath,
  );
  return dir;
}

/**
 * One launch of the product in the lab's mode (`--godview-perf-lab`, with the
 * two Chromium switches that keep an occluded window awake) from `root`, with
 * `env` on top of this process's. Lines starting with `echo` are relayed with
 * `prefix`; the whole output lands at `logPath`. Resolves with the exit code.
 */
export function launchLab({ root, env, logPath, echo, prefix }) {
  return new Promise((done, fail) => {
    const child = spawn(
      "pnpm",
      [
        "exec",
        "electron",
        ".",
        "--godview-perf-lab",
        "--disable-renderer-backgrounding",
        "--disable-backgrounding-occluded-windows",
      ],
      {
        cwd: join(root, "apps", "desktop"),
        env: { ...process.env, TMPDIR: "/tmp", ...env },
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    const lines = [];
    child.stdout.on("data", (chunk) => {
      for (const line of String(chunk).split("\n")) {
        if (line.startsWith(echo)) log(`  ${prefix}: ${line.slice(0, 160)}`);
        lines.push(line);
      }
    });
    child.stderr.on("data", (chunk) => lines.push(String(chunk)));
    child.on("error", fail);
    child.on("exit", (code) => {
      writeFileSync(logPath, lines.join("\n"));
      done(code ?? 1);
    });
  });
}
