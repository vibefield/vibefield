// THE GODVIEW LAB'S ARMS (MV-3c) — what the paired perf runner
// (`perf-godview.mjs`) and the capture runner (`capture-godview.mjs`) share:
// building a root, computing a root's model streams, and launching the product
// in the lab's mode with an environment, one fresh Electron process per launch.

import { spawn } from "node:child_process";
import { accessSync, constants, statSync, writeFileSync } from "node:fs";
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

function nativeBinaries(root) {
  const suffix = process.platform === "win32" ? ".exe" : "";
  return {
    native: join(root, "target", "debug", `field-native${suffix}`),
    cell: join(root, "target", "debug", `field-terminal-host${suffix}`),
  };
}

/** Build both native executables, then the desktop with React's profiling client.
 * Desktop build:all covers JS only. A missing terminal-host leaves the deck
 * dormant and silently removes its render work from a whole-window sample. */
export async function buildRoot(root, logPath) {
  log(`build ${root} (field-native + field-terminal-host)`);
  const nativeEnv = { ...process.env, CARGO_TARGET_DIR: join(root, "target") };
  delete nativeEnv.CARGO_BUILD_TARGET_DIR;
  await run(
    "cargo",
    ["build", "--locked", "-p", "field-native", "--bins"],
    root,
    nativeEnv,
    `${logPath}.native`,
  );
  log(`build ${root} (VF_REACT_PROFILING=1)`);
  await run(
    "pnpm",
    ["--filter", "@vibefield/desktop", "build:all"],
    root,
    { ...process.env, TMPDIR: "/tmp", NX_DAEMON: "false", VF_REACT_PROFILING: "1" },
    logPath,
  );
}

/** --no-build still requires the complete app, including the terminal cell. */
export function assertLabBuilt(root) {
  const bundle = join(root, "packages", "electron-shell", "dist", "testing", "smoke.cjs");
  for (const [path, mode] of [
    [bundle, constants.R_OK],
    [join(root, "packages", "fieldd", "dist", "bin.cjs"), constants.R_OK],
    ...Object.values(nativeBinaries(root)).map((path) => [path, constants.X_OK]),
  ]) {
    try {
      accessSync(path, mode);
      if (!statSync(path).isFile()) throw new Error("Expected a file");
    } catch (cause) {
      throw new Error(`Lab artifact missing or inaccessible: ${path}. Run without --no-build.`, {
        cause,
      });
    }
  }
}

/** Reports from every arm must prove the same healthy initial shell. Old
 * testing bundles need the same readiness instrumentation before comparison. */
export function assertLabDeckProof(state, context) {
  if (
    state?.active !== true ||
    state.panes !== 1 ||
    state.sessions !== 1 ||
    state.poolPhase !== "open" ||
    state.rosterState !== "observed" ||
    state.rendererBackend !== "webgpu" ||
    state.error !== undefined
  ) {
    throw new Error(
      `${context}: missing healthy one-pane deck proof. Every arm needs the same lab readiness checks.`,
    );
  }
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
  assertLabBuilt(root);
  const binaries = nativeBinaries(root);
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
        env: {
          ...process.env,
          TMPDIR: "/tmp",
          ...env,
          // Every arm runs its own built hosts, even when the invoking shell
          // has a development override aimed at another checkout.
          FIELDD_BIN: join(root, "packages", "fieldd", "dist", "bin.cjs"),
          FIELDD_NATIVE_BIN: binaries.native,
          FIELD_NATIVE_CELL_BIN: binaries.cell,
        },
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
