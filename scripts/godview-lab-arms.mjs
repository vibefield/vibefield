// THE GODVIEW LAB'S ARMS (MV-3c) — what the paired perf runner
// (`perf-godview.mjs`) and the capture runner (`capture-godview.mjs`) share:
// building a root, computing a root's model streams, and launching the product
// in the lab's mode with an environment, one fresh Electron process per launch.

import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import {
  accessSync,
  constants,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { loadavg, tmpdir } from "node:os";
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

/** Every process owns a fresh Chromium profile, removed only after it closes.
 * Daemon-root isolation alone does not isolate Chromium's persistent caches. */
export async function withLabProfile(run) {
  const directory = mkdtempSync(join(tmpdir(), "vf-godview-profile-"));
  try {
    const id = createHash("sha256").update(realpathSync(directory)).digest("hex");
    return await run({ directory, id });
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

/** Refuse old reports, wrong effective paths and reuse before reading grades. */
export function assertLabProfileProof(state, context, { expectedId, seen } = {}) {
  if (
    state?.kind !== "isolated-chromium-v1" ||
    typeof state.id !== "string" ||
    !/^[a-f0-9]{64}$/.test(state.id) ||
    (expectedId !== undefined && state.id !== expectedId)
  ) {
    throw new Error(`${context}: missing or mismatched isolated Chromium profile proof`);
  }
  if (seen?.has(state.id)) throw new Error(`${context}: Chromium profile reused across launches`);
  seen?.add(state.id);
  return state.id;
}

/** A lab line as a runner echoes it: clipped to 160 characters, except a
 * failure's. That line is the launch's only account of itself (a deck wait
 * that timed out carries the deck's last state in it), so it is echoed up to
 * 1,200; the launch's own log keeps every line whole. */
export function echoedLabLine(line) {
  return line.slice(0, line.includes('"kind":"failed"') ? 1_200 : 160);
}

/**
 * One launch of the product in the lab's mode, with a fresh Chromium profile
 * and the switches that keep an occluded window awake. Wait for output pipes
 * to close before reading proof or removing the profile. Resolves with the exit
 * code; a successful process with missing or incorrect proof is still a failure.
 */
export async function launchLab({ root, env, reportPath, logPath, echo, prefix }) {
  assertLabBuilt(root);
  const binaries = nativeBinaries(root);
  return withLabProfile(async ({ directory, id }) => {
    const code = await new Promise((done, fail) => {
      const child = spawn(
        "pnpm",
        [
          "exec",
          "electron",
          ".",
          "--godview-perf-lab",
          `--user-data-dir=${directory}`,
          "--disable-renderer-backgrounding",
          "--disable-backgrounding-occluded-windows",
        ],
        {
          cwd: join(root, "apps", "desktop"),
          env: {
            ...process.env,
            TMPDIR: "/tmp",
            ...env,
            // Every arm runs its own built hosts, even with parent overrides.
            FIELDD_BIN: join(root, "packages", "fieldd", "dist", "bin.cjs"),
            FIELDD_NATIVE_BIN: binaries.native,
            FIELD_NATIVE_CELL_BIN: binaries.cell,
          },
          stdio: ["ignore", "pipe", "pipe"],
        },
      );
      const lines = [];
      let spawnError;
      child.stdout.on("data", (chunk) => {
        for (const line of String(chunk).split("\n")) {
          if (line.startsWith(echo)) log(`  ${prefix}: ${echoedLabLine(line)}`);
        }
        lines.push(String(chunk));
      });
      child.stderr.on("data", (chunk) => lines.push(String(chunk)));
      child.once("error", (error) => {
        spawnError = error;
      });
      child.once("close", (code) => {
        try {
          writeFileSync(logPath, lines.join(""));
          if (spawnError) fail(spawnError);
          else done(code ?? 1);
        } catch (error) {
          fail(error);
        }
      });
    });
    if (code === 0) {
      const report = JSON.parse(readFileSync(reportPath, "utf8"));
      assertLabProfileProof(report.profile, prefix, { expectedId: id });
    }
    return code;
  });
}

/** Validate the bounded monitor proof before timing or pixel grades are read. */
export function assertLabMonitorProof(state, view, context) {
  const fields = [
    "agents",
    "localAgents",
    "terminals",
    "remoteSessions",
    "remoteHosts",
    "shownAgents",
  ];
  if (
    typeof view !== "string" ||
    view.length === 0 ||
    state?.viewId !== view ||
    !fields.every((key) => Number.isSafeInteger(state?.[key]) && state[key] >= 0) ||
    state.agents === 0 ||
    state.agents !== state.localAgents + state.terminals + state.remoteSessions ||
    state.shownAgents > state.agents ||
    state.remoteHosts > state.remoteSessions
  ) {
    throw new Error(`${context}: missing or invalid ${view} monitor membership`);
  }
  return Object.fromEntries([["viewId", state.viewId], ...fields.map((key) => [key, state[key]])]);
}

/** Both runners use ordered scenario keys: reject missing, duplicate, reordered
 * or unequal workloads before spending another launch on an invalid pairing. */
export function assertLabMembershipMatches(reference, sample, context) {
  const read = (rows, label) => {
    const keys = new Set();
    return rows.map(({ key, view, monitor }) => {
      if (typeof key !== "string" || key.length === 0 || keys.has(key)) {
        throw new Error(`${context}: ${label} has an invalid or duplicate scenario key`);
      }
      keys.add(key);
      return [key, assertLabMonitorProof(monitor, view, `${context} ${key}`)];
    });
  };
  const expected = read(reference, "reference");
  const actual = read(sample, "sample");
  if (expected.length === 0 || JSON.stringify(expected) !== JSON.stringify(actual)) {
    throw new Error(
      `${context}: monitor membership differs from the reference workload: ` +
        `expected ${JSON.stringify(expected)}, received ${JSON.stringify(actual)}`,
    );
  }
}
