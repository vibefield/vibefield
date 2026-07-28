import { spawn } from "node:child_process";
import { createRequire } from "node:module";
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
  let currentBuildId = null;
  let stopping = false;
  let exitCleanup = Promise.resolve();

  async function start(runtime) {
    if (child !== null) throw new Error("Electron is already running");
    const { buildId } = runtime;
    const env = {
      ...process.env,
      VITE_DEV_SERVER_URL: viteUrl,
      VIBEFIELD_DEV_BUILD_ID: buildId,
      VIBEFIELD_DEV_REPO_ROOT: paths.repoRoot,
      FIELDD_DATA_DIR: paths.dataRoot,
      FIELDD_CONTROL_PORT: "0",
      FIELDD_DATA_PORT: "0",
      FIELDD_BIN: runtime.fielddOutput,
      FIELDD_NATIVE_BIN: runtime.nativeOutput,
      FIELD_LOG_DIR: paths.logRoot,
    };
    // This flag is set only by Electron main for its fieldd child. Inheriting
    // it into the desktop process would turn Electron itself into Node.
    delete env.ELECTRON_RUN_AS_NODE;

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
    currentBuildId = buildId;
    let initialized = false;
    let earlyExit = null;
    next.once("exit", (code, signal) => {
      if (child === next) child = null;
      if (stopping) return;
      if (!initialized) {
        earlyExit = { code, signal };
        return;
      }
      exitCleanup = handleUnexpectedExit({ code, signal, buildId });
    });
    try {
      await new Promise((resolve, reject) => {
        next.once("spawn", resolve);
        next.once("error", reject);
      });
      await lock.update({ electronPid: next.pid ?? null, buildId });
      initialized = true;
      if (earlyExit !== null) {
        exitCleanup = handleUnexpectedExit({ ...earlyExit, buildId });
      }
    } catch (error) {
      if (child === next) child = null;
      const product = await readProduct(paths.dataRoot);
      await terminate(next, { graceMs: 2_000, killWaitMs: 1_000 });
      await stopProduct(product, buildId, log, paths.dataRoot);
      throw error;
    }
    return next.pid;
  }

  async function handleUnexpectedExit({ code, signal, buildId }) {
    const product = await readProduct(paths.dataRoot);
    try {
      await stopProduct(product, buildId, log, paths.dataRoot);
    } catch (error) {
      log.error(error instanceof Error ? error.message : String(error));
    }
    await lock.update({ electronPid: null });
    onUnexpectedExit({ code, signal });
  }

  async function stop() {
    const running = child;
    if (running === null) {
      await exitCleanup;
      return;
    }
    stopping = true;
    try {
      const capturedProduct = await readProduct(paths.dataRoot);
      const result = await terminate(running, { graceMs: 10_000, killWaitMs: 2_000 });
      if (result.forced) {
        log.warn("Electron exceeded its graceful shutdown deadline and was force-killed");
      }
      child = null;
      await stopProduct(capturedProduct, currentBuildId, log, paths.dataRoot);
      await lock.update({ electronPid: null });
    } finally {
      stopping = false;
    }
  }

  return {
    get running() {
      return child !== null;
    },
    get pid() {
      return child?.pid ?? null;
    },
    start,
    async restart(runtime) {
      await stop();
      return start(runtime);
    },
    stop,
  };
}
