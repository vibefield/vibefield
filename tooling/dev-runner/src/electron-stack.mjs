import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { buildChildEnv } from "./env.mjs";
import { terminateChild } from "./processes.mjs";
import { readDevProduct, stopVerifiedDevProduct } from "./product.mjs";

export function createElectronStack({
  paths,
  viteUrl,
  lock,
  log,
  onUnexpectedExit,
  electronExecutable = createRequire(import.meta.url)("electron"),
  spawnProcess = spawn,
  readProduct = readDevProduct,
  stopProduct = stopVerifiedDevProduct,
  terminate = terminateChild,
}) {
  let child = null;
  let currentDaemonBuildId = null;
  let stopping = false;
  let exitCleanup = Promise.resolve();

  async function start(runtime) {
    if (child !== null) throw new Error("Electron is already running");
    const { buildId, daemonBuildId } = runtime;
    const env = buildChildEnv(process.env, {
      set: {
        VITE_DEV_SERVER_URL: viteUrl,
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
        FIELD_LOG_DIR: paths.logRoot,
      },
      // This flag is set only by Electron main for its fieldd child. Inheriting
      // it into the desktop process would turn Electron itself into Node — and
      // on Windows an inherited variant spelling is the same variable, which is
      // why removal is case-insensitive there.
      unset: ["ELECTRON_RUN_AS_NODE"],
    });

    const next = spawnProcess(
      electronExecutable,
      [`--user-data-dir=${paths.electronUserData}`, runtime.appRoot, "--dev"],
      {
        cwd: paths.desktopRoot,
        env,
        stdio: "inherit",
      },
    );
    child = next;
    currentDaemonBuildId = daemonBuildId;
    let initialized = false;
    let earlyExit = null;
    next.once("exit", (code, signal) => {
      if (child === next) child = null;
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

  return {
    get running() {
      return child !== null;
    },
    get pid() {
      return child?.pid ?? null;
    },
    start,
    stop,
    stopDaemons,
  };
}
