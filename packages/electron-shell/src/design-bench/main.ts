import { join } from "node:path";
import { app, type BrowserWindow, session } from "electron";
import {
  installNavigationPolicy,
  installPermissionPolicy,
  installWebContentsBackstop,
} from "../main/security";
import { createMainWindow, loadRenderer } from "../main/windows";
import { parseUiBenchUrl } from "./url";

// This is a separate development entry, not a runtime branch in production's
// main bundle. It deliberately reuses the hardened BrowserWindow factory while
// omitting users, fieldd, plugins, tray, diagnostics, and application IPC.
const MODE = "dev" as const;
const PRELOAD_PATH = join(__dirname, "preload.cjs");
const RENDERER_URL = parseUiBenchUrl(process.env["VIBEFIELD_UI_BENCH_URL"]);

let benchWindow: BrowserWindow | null = null;

async function waitForBenchMount(window: BrowserWindow): Promise<void> {
  for (let attempt = 0; attempt < 50; attempt++) {
    const mounted = await window.webContents
      .executeJavaScript(
        `document.documentElement.dataset.vibefieldSurface === "vibefield-ui-bench-only" && document.querySelector(".vf-ds-shell") !== null`,
        true,
      )
      .then((result) => result === true)
      .catch(() => false);
    if (mounted) return;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error("the UI Bench renderer loaded without mounting its catalog");
}

async function openBenchWindow(): Promise<BrowserWindow> {
  if (benchWindow !== null && !benchWindow.isDestroyed()) {
    if (benchWindow.isMinimized()) benchWindow.restore();
    benchWindow.show();
    benchWindow.focus();
    return benchWindow;
  }

  const window = createMainWindow({ mode: MODE, preloadPath: PRELOAD_PATH, show: true });
  benchWindow = window;
  window.once("closed", () => {
    if (benchWindow === window) benchWindow = null;
  });
  installNavigationPolicy(window, MODE);
  await loadRenderer(window, MODE, RENDERER_URL);
  await waitForBenchMount(window);
  process.stdout.write("VibeField UI Bench mounted\n");
  return window;
}

async function start(): Promise<void> {
  if (app.isPackaged) {
    throw new Error("The VibeField UI Bench cannot run from a packaged application");
  }
  await app.whenReady();
  installPermissionPolicy(session.defaultSession);
  await openBenchWindow();
}

app.setName("VibeField UI Bench");
app.enableSandbox();
installWebContentsBackstop(MODE);

const ownsInstance = app.requestSingleInstanceLock();
if (!ownsInstance) {
  app.quit();
} else {
  app.on("second-instance", () => {
    void openBenchWindow();
  });
  app.on("window-all-closed", () => app.quit());
  void start().catch((error: unknown) => {
    process.stderr.write(
      `VibeField UI Bench failed: ${error instanceof Error ? error.message : String(error)}\n`,
    );
    app.exit(1);
  });
}
