import { join, resolve } from "node:path";
import type { FielddSupervisor } from "@vibefield/fieldd-supervisor";
import { app } from "electron";
import { installDurableClose } from "./close";
import { buildSupervisor, dataRoot } from "./fieldd";
import { registerWindowBootstrap } from "./ipc";
import { fatal, installLifecycle } from "./lifecycle";
import { isSmokeLike, parseMode } from "./modes";
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
const getSupervisor = () => supervisor;
const registry = new WindowRegistry();

const testing = () =>
  // @ts-expect-error TS2307 — dist/testing/smoke.cjs is a runtime-external
  // build artifact (package.json build --external); types ride the cast.
  import("../testing/smoke.cjs") as Promise<typeof import("../testing/smoke")>;

async function main(): Promise<void> {
  await app.whenReady();
  installCsp(MODE);

  if (MODE === "spike-loro") {
    await (await testing()).runSpikeLoro();
    return;
  }

  const root = dataRoot(MODE);
  const repoRoot = resolve(app.getAppPath(), "..", "..");
  supervisor = buildSupervisor({ mode: MODE, root, repoRoot, viteUrl: VITE_URL });
  const handle = await supervisor.ensure();

  if (MODE === "smoke") {
    await (await testing()).runSmoke(handle, supervisor, root);
    return;
  }

  registerWindowBootstrap(registry, handle);
  handle.client.onStatusChange(() => {
    console.log(`[shell] fieldd link: ${handle.client.status}`);
  });

  if (MODE === "smoke-canvas") {
    await (await testing()).runSmokeCanvas({
      handle,
      supervisor,
      root,
      registry,
      preloadPath: PRELOAD_PATH,
      viteUrl: VITE_URL,
    });
    return;
  }

  const win = createMainWindow({ mode: MODE, preloadPath: PRELOAD_PATH, show: true });
  registry.adopt(win);
  installNavigationPolicy(win, MODE);
  installDurableClose(win);
  await loadRenderer(win, MODE, VITE_URL);
}

// D10 — one shell per device; smoke-like runs are transient and skip the lock
// entirely (slice-0 finding 1: losing it silently exited 0 — a false pass).
if (!isSmokeLike(MODE) && !app.requestSingleInstanceLock()) {
  app.quit();
} else {
  installLifecycle({ registry, getSupervisor });
  main().catch((e: unknown) => fatal(e, getSupervisor));
}
