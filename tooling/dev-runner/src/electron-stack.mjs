import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import { devSidecar, rosettadBinary } from "../../../scripts/siblings.mjs";
import { buildChildEnv } from "./env.mjs";
import { terminateChild } from "./processes.mjs";
import { readDevProduct, stopVerifiedDevProduct } from "./product.mjs";

/** The sibling lock's rosettad when `pnpm siblings:build` has produced it,
 * else null. */
function lockRosettadBin() {
  const built = rosettadBinary();
  return built?.path !== null && built?.path !== undefined && existsSync(built.path)
    ? built.path
    : null;
}

/** fieldd's rosettad, asked at every Electron launch. The launching shell's
 * explicit choice wins, and that read is the only one memoized — a running
 * process's own environment cannot change under it. The lock's build is asked
 * afresh each launch (siblings.mjs already caches the cargo metadata behind
 * it), so a `pnpm siblings:build` mid-session reaches fieldd at the next
 * launch; a memoized "none" used to keep fieldd unconfigured until the runner
 * itself restarted (AC-7). */
export function createRosettadBinResolver({ env = process.env, lookup = lockRosettadBin } = {}) {
  let explicit;
  return () => {
    if (explicit === undefined) {
      const value = env["FIELDD_ROSETTAD_BIN"];
      explicit = value !== undefined && value !== "" ? value : null;
    }
    return explicit ?? lookup();
  };
}

const defaultResolveRosettadBin = createRosettadBinResolver();

/** The floor's two test seams for the executables it spawns beside itself (field-native
 * `config.rs`): the cell (TC-S2) and the freeway host (F1). The runner launches the ones it staged,
 * so a developer's exported value is removed from the child and named as ignored (James's (i),
 * 2026-10-19). */
const FLOOR_CHILD_OVERRIDES = ["FIELD_NATIVE_CELL_BIN", "FIELD_NATIVE_FREEWAY_BIN"];

/** The truffle sidecar the dev floor runs, asked at every Electron launch
 * (2026-10-17, the truffle bump; `devSidecar` in siblings.mjs says why a debug
 * floor cannot be left to find one beside itself). Answers
 * `{ path, warning }`:
 *
 * - The launching shell's explicit `FIELD_NATIVE_SIDECAR_PATH` (or truffle's
 *   own `TRUFFLE_SIDECAR_PATH`) WINS, exactly as field-native ranks it. It is
 *   the authoritative override, and a petition window's run line or a probe may
 *   mean it. When it is not the lock's choice the answer carries a WARNING
 *   naming both, because that is how the retired T6 override (a protocol-5
 *   build under `.vibefield/sidecar/`) would keep running after 0.7.19 without a
 *   word. Only this read is memoized: the process's own environment cannot
 *   change under it. The warning names the variable that made the choice.
 * - Else the lock's choice (`devSidecar`), asked afresh each launch, so a
 *   `pnpm install` mid-session reaches the floor at the next launch.
 * - `path: null` sets nothing, and the floor's own search order answers. The
 *   launch also STRIPS both variables then (the rosettad pattern, c5804e6a),
 *   because a null path means neither held a non-empty value, and an inherited
 *   EMPTY one would reach the floor as an authoritative override naming nothing
 *   (`var_os` reads `Some("")`), which reports the mesh Degraded instead of
 *   searching. */
export function createSidecarPathResolver({ env = process.env, lookup = devSidecar } = {}) {
  let explicit;
  return () => {
    if (explicit === undefined) {
      const name = ["FIELD_NATIVE_SIDECAR_PATH", "TRUFFLE_SIDECAR_PATH"].find(
        (key) => env[key] !== undefined && env[key] !== "",
      );
      explicit = name === undefined ? null : { name, path: env[name] };
    }
    const pinned = lookup();
    if (explicit === null) {
      return {
        path: pinned.path,
        ...(pinned.reason !== undefined ? { warning: pinned.reason } : {}),
      };
    }
    if (pinned.path === explicit.path) return { path: explicit.path };
    const lockChoice = pinned.path ?? `${pinned.source}, not on disk`;
    return {
      path: explicit.path,
      warning:
        `${explicit.name} names ${explicit.path}, not the lock's sidecar (${lockChoice}). ` +
        "The floor runs the named one; unset it to run the pin",
    };
  };
}

const defaultResolveSidecarPath = createSidecarPathResolver();

export function createElectronStack({
  paths,
  viteUrl,
  studioOpen = false,
  studioPhysical = false,
  lock,
  log,
  onUnexpectedExit,
  electronExecutable = createRequire(import.meta.url)("electron"),
  spawnProcess = spawn,
  resolveRosettadBin = defaultResolveRosettadBin,
  resolveSidecarPath = defaultResolveSidecarPath,
  readProduct = readDevProduct,
  stopProduct = stopVerifiedDevProduct,
  terminate = terminateChild,
}) {
  let child = null;
  let currentDaemonBuildId = null;
  let studioRequested = studioOpen;
  let commandSequence = 0;
  let stopping = false;
  let exitCleanup = Promise.resolve();
  const pendingCommands = new Map();

  async function start(runtime) {
    if (child !== null) throw new Error("Electron is already running");
    const { buildId, daemonBuildId } = runtime;
    const rosettadBin = resolveRosettadBin();
    // TC-S2 — the floor runs the cell staged beside it, the one this runner built and its daemon
    // identity covers: the floor resolves its cell as its own sibling unless FIELD_NATIVE_CELL_BIN
    // names another, which is a test seam. A developer's exported variable used to win here,
    // putting a cell outside the snapshot under a snapshot's floor (the start-up reaper then
    // convicts it as a socket squatter, and a cargo build swaps it under the live floor), so it
    // is removed below and the cell launched is named once per daemon identity. F1's freeway host
    // is found the same way, behind its own seam, and is treated the same.
    if (daemonBuildId !== currentDaemonBuildId) {
      const ignored = FLOOR_CHILD_OVERRIDES.filter((name) => (process.env[name] ?? "") !== "").map(
        (name) => `${name}=${process.env[name]}`,
      );
      const cell = `the floor's cell is ${runtime.cellOutput}`;
      const host = `its freeway host is ${runtime.freewayOutput}`;
      const unheeded =
        ignored.length > 0 ? ` (${ignored.join(", ")} from the environment ignored)` : "";
      log.info(`daemon plane ${daemonBuildId}: ${cell} and ${host}${unheeded}`);
    }
    const sidecar = resolveSidecarPath();
    if (sidecar.warning !== undefined) log.warn(`[sidecar] ${sidecar.warning}`);
    const env = buildChildEnv(process.env, {
      set: {
        VITE_DEV_SERVER_URL: viteUrl,
        VIBEFIELD_STUDIO_OPEN: studioRequested ? "1" : "0",
        VIBEFIELD_STUDIO_PHYSICAL: studioPhysical ? "1" : "0",
        // The adoption gate compares product.json's buildId against this value,
        // and product.json describes the DAEMON plane — a shell-only rebuild
        // must still adopt the running fieldd, so the daemon identity is what
        // crosses this boundary, never the combined snapshot identity.
        VIBEFIELD_DEV_BUILD_ID: daemonBuildId,
        VIBEFIELD_DEV_REPO_ROOT: paths.repoRoot,
        FIELDD_DATA_DIR: paths.dataRoot,
        FIELDD_CONTROL_PORT: "0",
        FIELDD_DATA_PORT: "0",
        FIELDD_BIN: runtime.fielddOutput,
        FIELDD_NATIVE_BIN: runtime.nativeOutput,
        // AR-0 — the agent-index daemon fieldd supervises, built from the
        // rosetta sibling (`pnpm siblings:build`). Only set when the binary is
        // on disk: an unset variable is fieldd's honest "unconfigured", a path
        // to nothing would be a spawn failure dressed as configuration.
        ...(rosettadBin !== null ? { FIELDD_ROSETTAD_BIN: rosettadBin } : {}),
        // The truffle sidecar the floor runs (the truffle bump, 2026-10-17):
        // the shell's explicit choice, else the lock's pin (`devSidecar`).
        // fieldd hands field-native its own environment, so this reaches the
        // floor. Absent when neither names a file on disk (and an inherited
        // empty one is stripped below), and then the floor's own search answers.
        ...(sidecar.path !== null ? { FIELD_NATIVE_SIDECAR_PATH: sidecar.path } : {}),
        FIELD_LOG_DIR: paths.logRoot,
      },
      // This flag is set only by Electron main for its fieldd child. Inheriting
      // it into the desktop process would turn Electron itself into Node — and
      // on Windows an inherited variant spelling is the same variable, which is
      // why removal is case-insensitive there.
      // AC (2026-09-22): the child's rosettad is the RESOLVER's decision, never
      // the launching shell's — a developer's exported FIELDD_ROSETTAD_BIN would
      // otherwise ride process.env past a resolver that said "none" (or, worse,
      // an empty string the comment above forbids) and fieldd would point at a
      // binary the runner never chose. When the resolver names one it is set
      // above; when it does not, the inherited variable is removed.
      // The truffle bump (2026-10-17): the sidecar is the same shape. A null
      // path means neither variable held a non-empty value, so this removes
      // only empties — which the floor would otherwise read as an
      // authoritative override naming nothing, and go Degraded.
      unset: [
        "ELECTRON_RUN_AS_NODE",
        ...FLOOR_CHILD_OVERRIDES,
        ...(rosettadBin === null ? ["FIELDD_ROSETTAD_BIN"] : []),
        ...(sidecar.path === null ? ["FIELD_NATIVE_SIDECAR_PATH", "TRUFFLE_SIDECAR_PATH"] : []),
      ],
    });

    const next = spawnProcess(
      electronExecutable,
      [`--user-data-dir=${paths.electronUserData}`, runtime.appRoot, "--dev"],
      {
        cwd: paths.desktopRoot,
        env,
        stdio: ["inherit", "inherit", "inherit", "ipc"],
      },
    );
    child = next;
    currentDaemonBuildId = daemonBuildId;
    let initialized = false;
    let earlyExit = null;
    next.on("message", (message) => receiveCommandResult(next, message));
    next.once("exit", (code, signal) => {
      if (child === next) child = null;
      rejectPendingCommands(new Error("Electron exited before answering a development command"));
      if (stopping) return;
      if (!initialized) {
        earlyExit = { code, signal };
        return;
      }
      exitCleanup = handleUnexpectedExit({ code, signal });
    });
    try {
      await new Promise((resolve, reject) => {
        next.once("spawn", resolve);
        next.once("error", reject);
      });
      await lock.update({ electronPid: next.pid ?? null, buildId });
      initialized = true;
      if (earlyExit !== null) {
        exitCleanup = handleUnexpectedExit(earlyExit);
      }
    } catch (error) {
      if (child === next) child = null;
      const product = await readProduct(paths.dataRoot);
      await terminate(next, { graceMs: 2_000, killWaitMs: 1_000 });
      await stopProduct(product, daemonBuildId, log, paths.dataRoot);
      throw error;
    }
    return next.pid;
  }

  // The daemons deliberately survive an Electron exit (the shell runs
  // leave-running in dev): the next start adopts them when the daemon plane
  // is unchanged. Teardown happens only through stopDaemons().
  async function handleUnexpectedExit({ code, signal }) {
    await lock.update({ electronPid: null });
    onUnexpectedExit({ code, signal });
  }

  async function stopDaemons() {
    const product = await readProduct(paths.dataRoot);
    await stopProduct(product, currentDaemonBuildId, log, paths.dataRoot);
  }

  async function stop({ stopDaemons: alsoStopDaemons = false } = {}) {
    const running = child;
    if (running === null) {
      await exitCleanup;
    } else {
      stopping = true;
      try {
        const result = await terminate(running, { graceMs: 10_000, killWaitMs: 2_000 });
        if (result.forced) {
          log.warn("Electron exceeded its graceful shutdown deadline and was force-killed");
        }
        child = null;
        await lock.update({ electronPid: null });
      } finally {
        stopping = false;
      }
    }
    if (alsoStopDaemons) await stopDaemons();
  }

  async function command(value) {
    if (value.type === "studio.open" || value.type === "studio.focus") studioRequested = true;
    if (value.type === "studio.close") studioRequested = false;
    const running = child;
    if (running === null || running.connected !== true || typeof running.send !== "function") {
      return {
        state: value.type === "studio.status" ? "starting" : "queued",
        studioRequested,
      };
    }

    commandSequence += 1;
    const requestId = `runner-${commandSequence}`;
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        pendingCommands.delete(requestId);
        reject(new Error("Electron did not answer the development command"));
      }, 2_000);
      timeout.unref?.();
      pendingCommands.set(requestId, { resolve, reject, timeout });
      try {
        running.send(
          { version: 1, type: "vibefield.dev-command", requestId, command: value },
          (error) => {
            if (error === null) return;
            const pending = pendingCommands.get(requestId);
            if (pending === undefined) return;
            pendingCommands.delete(requestId);
            clearTimeout(pending.timeout);
            pending.reject(error);
          },
        );
      } catch (error) {
        const pending = pendingCommands.get(requestId);
        pendingCommands.delete(requestId);
        clearTimeout(timeout);
        pending?.reject(error);
      }
    });
  }

  function receiveCommandResult(sender, message) {
    if (
      child !== sender ||
      message?.version !== 1 ||
      message.type !== "vibefield.dev-command-result" ||
      typeof message.requestId !== "string"
    ) {
      return;
    }
    const pending = pendingCommands.get(message.requestId);
    if (pending === undefined) return;
    pendingCommands.delete(message.requestId);
    clearTimeout(pending.timeout);
    if (message.ok === true && typeof message.result === "object" && message.result !== null) {
      pending.resolve(message.result);
    } else {
      pending.reject(new Error("Electron rejected the development command"));
    }
  }

  function rejectPendingCommands(error) {
    for (const pending of pendingCommands.values()) {
      clearTimeout(pending.timeout);
      pending.reject(error);
    }
    pendingCommands.clear();
  }

  return {
    get running() {
      return child !== null;
    },
    get pid() {
      return child?.pid ?? null;
    },
    start,
    command,
    stop,
    stopDaemons,
  };
}
