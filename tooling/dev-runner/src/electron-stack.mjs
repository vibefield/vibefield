import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import { rosettadBinary } from "../../../scripts/siblings.mjs";
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
    // is removed below and the cell launched is named once per daemon identity.
    if (daemonBuildId !== currentDaemonBuildId) {
      const inherited = process.env["FIELD_NATIVE_CELL_BIN"];
      log.info(
        `daemon plane ${daemonBuildId}: the floor's cell is ${runtime.cellOutput}${
          inherited !== undefined && inherited !== ""
            ? ` (FIELD_NATIVE_CELL_BIN=${inherited} from the environment is ignored)`
            : ""
        }`,
      );
    }
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
      unset: [
        "ELECTRON_RUN_AS_NODE",
        "FIELD_NATIVE_CELL_BIN",
        ...(rosettadBin === null ? ["FIELDD_ROSETTAD_BIN"] : []),
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
