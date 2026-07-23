import { randomBytes } from "node:crypto";
import { join, resolve } from "node:path";
import { APP_ID } from "@vibefield/contracts";
import type { FielddSupervisor } from "@vibefield/fieldd-supervisor";
import { resolvePlatformLogRoot } from "@vibefield/logging";
import { app } from "electron";
import { installDurableClose } from "./close";
import { buildSupervisor, dataRoot } from "./fieldd";
import { registerWindowBootstrap } from "./ipc";
import { installLifecycle } from "./lifecycle";
import { createElectronLogging, type ElectronLogging } from "./logging";
import { isSmokeLike, parseMode } from "./modes";
import { installRendererLogging } from "./renderer-logging";
import { installCsp, installNavigationPolicy } from "./security";
import { WindowRegistry } from "./window-policy";
import { createMainWindow, loadRenderer } from "./windows";

// The composition root (ESR §5.2.1): mode → lock → lifecycle → CSP → supervisor
// → windows/IPC. Nothing else lives here — no discovery, no polling, no payload
// construction, no product logic. Smoke/spike implementations are a SEPARATE
// build artifact (dist/testing/smoke.cjs) reached only through the dynamic
// import below, which esbuild leaves external: the production main bundle
// contains none of that code (ESR-12), and packaging simply omits the file.

const MODE = parseMode(process.argv);
const VITE_URL = process.env["VITE_DEV_SERVER_URL"] ?? "http://localhost:5173";
const PRELOAD_PATH = join(__dirname, "..", "preload", "index.cjs");

let supervisor: FielddSupervisor | null = null;
let logging: ElectronLogging | null = null;
const getSupervisor = () => supervisor;
const registry = new WindowRegistry();

const testing = () =>
  // @ts-expect-error TS2307 — dist/testing/smoke.cjs is a runtime-external
  // build artifact (package.json build --external); types ride the cast.
  import("../testing/smoke.cjs") as Promise<typeof import("../testing/smoke")>;

async function main(root: string, logRoot: string, shellLogging: ElectronLogging): Promise<void> {
  const logger = shellLogging.logger;
  await app.whenReady();
  logger.info("desktop.lifecycle.ready", "Electron app is ready");
  installCsp(MODE);
  app.on("child-process-gone", (_event, details) => {
    logger.warn("desktop.process.child_gone", "An Electron child process exited", {
      type: details.type,
      reason: details.reason,
      exitCode: details.exitCode,
      ...(details.serviceName !== undefined ? { serviceName: details.serviceName } : {}),
      ...(details.name !== undefined ? { name: details.name } : {}),
    });
  });

  if (MODE === "spike-loro") {
    await (await testing()).runSpikeLoro({
      root,
      beforeExit: () => shellLogging.close(),
    });
    return;
  }

  const repoRoot = resolve(app.getAppPath(), "..", "..");
  supervisor = buildSupervisor({
    mode: MODE,
    root,
    repoRoot,
    viteUrl: VITE_URL,
    logRoot,
    logger,
  });
  // ensure() starts NOW; the window never waits for it (ESR-8 / design-03
  // §4.3 v0.3 — the splash is the honest face while the daemon comes up).
  const fielddReady = supervisor.ensure();
  fielddReady.then(
    (handle) => {
      handle.client.onStatusChange(() => {
        logger.info("desktop.fieldd.link_state_changed", "fieldd link state changed", {
          status: handle.client.status,
        });
      });
    },
    (error) => {
      logger.error(
        "desktop.fieldd.ensure_failed",
        "The initial fieldd adoption/spawn attempt failed",
        error,
      );
      // observed: the renderer's bootstrap invoke surfaces the failure with an
      // honest retry (each invoke re-runs ensure); nothing to crash here
    },
  );

  if (MODE === "smoke") {
    await (await testing()).runSmoke(await fielddReady, supervisor, root, () =>
      shellLogging.close(),
    );
    return;
  }

  registerWindowBootstrap(registry, supervisor, logger.child({ component: "ipc.bootstrap" }));

  if (MODE === "smoke-canvas") {
    await (await testing()).runSmokeCanvas({
      handle: await fielddReady,
      supervisor,
      root,
      registry,
      preloadPath: PRELOAD_PATH,
      viteUrl: VITE_URL,
      beforeExit: () => shellLogging.close(),
      onWindow: (window) => {
        installRendererLogging({
          window,
          sink: shellLogging.renderer,
          desktopLogger: logger,
        });
      },
    });
    return;
  }

  performance.mark("vf:shell:window-created");
  const win = createMainWindow({ mode: MODE, preloadPath: PRELOAD_PATH, show: true });
  registry.adopt(win);
  installRendererLogging({
    window: win,
    sink: shellLogging.renderer,
    desktopLogger: logger,
  });
  installNavigationPolicy(win, MODE);
  installDurableClose(win, logger.child({ component: "window.close", windowId: String(win.id) }));
  await loadRenderer(win, MODE, VITE_URL);
  logger.info("desktop.window.renderer_loaded", "The main renderer finished loading", {
    windowId: String(win.id),
    webContentsId: win.webContents.id,
  });
}

app.setName("VibeField");
if (process.platform === "win32") app.setAppUserModelId(APP_ID);

// D10 — establish shell ownership synchronously, before any stream writer can
// race. The primary logs both acquisition and the second-instance callback;
// a rejected secondary cannot append to the primary's physical stream.
const hasInstanceLock = isSmokeLike(MODE) || app.requestSingleInstanceLock();
if (!hasInstanceLock) {
  app.quit();
} else {
  void (async () => {
    performance.mark("vf:shell:boot-start");
    const root = dataRoot(MODE);
    const logRoot = isSmokeLike(MODE)
      ? join(root, "logs")
      : resolvePlatformLogRoot({ allowOverride: MODE === "dev" });
    app.setAppLogsPath(logRoot);
    logging = await createElectronLogging({
      logRoot,
      dataRoot: root,
      bootId: `desktop-${randomBytes(8).toString("hex")}`,
    });
    const logger = logging.logger;
    logger.info("desktop.lifecycle.boot_started", "Electron shell boot started", {
      mode: MODE,
      electronVersion: process.versions.electron ?? "unknown",
    });
    if (!isSmokeLike(MODE)) {
      logger.info("desktop.lifecycle.instance_lock_acquired", "Primary app instance lock acquired");
    }
    const flow = installLifecycle({
      registry,
      getSupervisor,
      logger,
      closeLogging: () => logging?.close() ?? Promise.resolve(),
    });
    try {
      await main(root, logRoot, logging);
    } catch (error) {
      flow.fatal(error);
    }
  })().catch(async () => {
    // Static emergency only: this path means the desktop writer itself could
    // not initialize, so it must never recurse through logging or echo errors.
    process.stderr.write("VibeField shell failed before logging initialized\n");
    await logging?.close();
    app.exit(1);
  });
}
