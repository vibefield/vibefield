import { rmSync } from "node:fs";
import { join } from "node:path";
import type { FielddHandle, FielddSupervisor } from "@vibefield/fieldd-supervisor";
import { app, BrowserWindow } from "electron";
import { APP_ORIGIN } from "../main/app-protocol";
import type { WindowRegistry } from "../main/window-policy";
import { createMainWindow, loadRenderer } from "../main/windows";

// Smoke/spike runners (ESR §5.2.6 / ESR-12): a SEPARATE build artifact
// (dist/testing/smoke.cjs) that the production main bundle never contains —
// index.ts reaches it via a runtime-external dynamic import, and packaging
// omits the file entirely. Everything here is test-only by construction.

/** Resolve when a renderer console line starting with `prefix` arrives. */
export function waitForConsole(
  win: BrowserWindow,
  prefix: string,
  timeoutMs: number,
): Promise<string> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(
      () => reject(new Error(`no "${prefix}" within ${timeoutMs}ms`)),
      timeoutMs,
    );
    win.webContents.on("console-message", (...args: unknown[]) => {
      for (const a of args) {
        const text =
          typeof a === "string"
            ? a
            : a && typeof a === "object" && "message" in a
              ? String((a as { message: unknown }).message)
              : "";
        if (text.startsWith(prefix)) {
          clearTimeout(t);
          resolve(text.slice(prefix.length));
          return;
        }
      }
    });
  });
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/** Stop-owned via the supervisor (adopted daemons survive — ownership law),
 * then remove the root ONLY if this run created it (an injected
 * FIELDD_DATA_DIR is someone else's data). */
async function teardown(
  supervisor: FielddSupervisor,
  root: string,
  beforeExit: () => Promise<void>,
): Promise<void> {
  await supervisor.dispose();
  await beforeExit();
  if (!process.env["FIELDD_DATA_DIR"]) rmSync(root, { recursive: true, force: true });
}

export async function runSmoke(
  handle: FielddHandle,
  supervisor: FielddSupervisor,
  root: string,
  beforeExit: () => Promise<void>,
): Promise<void> {
  const health = (await handle.client.request("system.health")) as {
    nativeConnected: boolean;
    native: { units?: Array<{ unit: string }> } | null;
  };
  const summary = {
    ok: health.nativeConnected,
    port: handle.info.port,
    nativeConnected: health.nativeConnected,
    units: health.native?.units?.map((u) => u.unit) ?? [],
  };
  console.log(`SMOKE ${JSON.stringify(summary)}`);
  await teardown(supervisor, root, beforeExit);
  app.exit(summary.ok ? 0 : 2); // exit is queued; the caller returns without opening a window
}

/** Full spine + real renderer, hidden: pass iff the canvas reports in.
 * Teardown runs on EVERY path — the old failure path leaked the spawned
 * daemons (slice-0 finding 3). */
export async function runSmokeCanvas(opts: {
  handle: FielddHandle;
  supervisor: FielddSupervisor;
  root: string;
  registry: WindowRegistry;
  preloadPath: string;
  viteUrl: string;
  beforeExit: () => Promise<void>;
  onWindow?: (window: BrowserWindow) => void;
}): Promise<void> {
  const win = createMainWindow({
    mode: "smoke-canvas",
    preloadPath: opts.preloadPath,
    show: false,
  });
  opts.registry.adopt(win); // the bootstrap sender policy admits only registered windows
  opts.onWindow?.(win);
  let ok = false;
  try {
    await loadRenderer(win, "smoke-canvas", opts.viteUrl);
    const raw = await waitForConsole(win, "CANVAS_READY ", 45_000);
    console.log(`SMOKE_CANVAS ${raw}`);
    ok = true;
  } catch (e) {
    console.error(`SMOKE_CANVAS failed: ${e instanceof Error ? e.message : e}`);
  }
  await teardown(opts.supervisor, opts.root, opts.beforeExit);
  app.exit(ok ? 0 : 2);
}

/** The serviceName `GhostteaElectronBridge` forks its utilityProcess under.
 * Upstream's default, restated here because this harness kills by name. */
const BRIDGE_SERVICE_NAME = "ghosttea-terminal-bridge";

/** SIGKILL the bridge's utility process — the only honest way to test
 * `unexpected-exit`, since `Backend.stop()` is an ORDERLY stop that emits
 * nothing. Neither Backend nor Bridge exposes its child, so the process is
 * found through Electron's own metrics.
 *
 * `fork`'s `serviceName` option surfaces as the metric's `name`; the metric's
 * OWN `serviceName` is the mojo interface (`node.mojom.NodeService`), which
 * every utilityProcess shares. Matching the mojo name would find the logging
 * utility just as happily, so both fields are checked for what they actually
 * mean. Returns the pid it killed so the verdict can say what died. */
function killTerminalBridge(): number | null {
  const metric = app
    .getAppMetrics()
    .find(
      (m) =>
        m.type === "Utility" &&
        m.name === BRIDGE_SERVICE_NAME &&
        m.serviceName === "node.mojom.NodeService",
    );
  if (metric === undefined) return null;
  process.kill(metric.pid, "SIGKILL");
  return metric.pid;
}

/** GT-1 spike: the PRODUCT terminal path end to end, against the REAL pair,
 * plus a deliberate bridge death.
 *
 * Nothing here mints anything any more — that is the point. The renderer boots
 * through the product bootstrap, redeems its own ticket over fieldd
 * (`terminal.create`, which now answers WITH the ticket — GT-1's contract),
 * hands it to main over the product IPC, and main builds the external-mode
 * Backend and posts the ports through the product preload. GT-0's
 * `SPIKE_GODVIEW_TICKET observed after Nms` retry loop is gone: the contract
 * removed the wait it was measuring, so the loop's absence is the proof.
 *
 * Then the bridge is SIGKILLed. Main's ladder rebuilds it on the stored
 * connection and the page proves its pane is live again — the sessions
 * themselves never noticed, because field-native owns them and the bridge is
 * only a pipe. Both verdicts must be ok. */
export async function runSpikeGodview(opts: {
  supervisor: FielddSupervisor;
  root: string;
  registry: WindowRegistry;
  preloadPath: string;
  beforeExit: () => Promise<void>;
  onWindow?: (window: BrowserWindow) => void;
}): Promise<void> {
  let ok = false;
  try {
    const win = createMainWindow({
      mode: "spike-godview",
      // The PRODUCT preload — it carries the ports forward now (GT-1).
      preloadPath: opts.preloadPath,
      show: false,
    });
    opts.registry.adopt(win);
    opts.onWindow?.(win);
    if (process.env["VF_SPIKE_DEBUG"]) {
      win.webContents.on("console-message", (...args: unknown[]) => {
        console.log(`[renderer] ${args.map((a) => JSON.stringify(a)).join(" ")}`);
      });
    }

    const page = new URL(`${APP_ORIGIN}/spike-godview.html`);
    // The workspace spawns its splits with this; fieldd gives the session it
    // creates the same login shell, and the two agree by construction.
    page.searchParams.set("shell", process.env["SHELL"] ?? "/bin/sh");
    // Armed BEFORE the load: a fast verdict must not land in the gap between
    // loadURL resolving and the listener attaching.
    const verdict = waitForConsole(win, "SPIKE_GODVIEW ", 60_000);
    verdict.catch(() => undefined);
    const recovered = waitForConsole(win, "SPIKE_GODVIEW_RECOVERY ", 120_000);
    recovered.catch(() => undefined);
    await win.loadURL(page.href);
    const raw = await verdict;
    console.log(`SPIKE_GODVIEW ${raw}`);
    ok = (JSON.parse(raw) as { ok: boolean }).ok;

    if (ok) {
      const pid = killTerminalBridge();
      if (pid === null) throw new Error("no ghosttea bridge utility process to kill");
      console.log(`SPIKE_GODVIEW_BRIDGE_KILLED pid=${pid}`);
      const rawRecovery = await recovered;
      console.log(`SPIKE_GODVIEW_RECOVERY ${rawRecovery}`);
      ok = (JSON.parse(rawRecovery) as { ok: boolean }).ok;
    }
  } catch (e) {
    ok = false;
    console.error(`SPIKE_GODVIEW failed: ${e instanceof Error ? e.message : e}`);
  }
  // The bridge is a utilityProcess and dies with the shell; the registry's
  // dispose runs on the quit flow. Teardown order stays renderer, then pair.
  await teardown(opts.supervisor, opts.root, opts.beforeExit);
  app.exit(ok ? 0 : 2);
}

/** B1 spike: load the spike page over file:// in a sandboxed window and report
 * the renderer's own verdict. No daemons involved. Built only when the spike
 * entry is requested (VITE_SPIKE=1) — never part of the production renderer. */
export async function runSpikeLoro(opts: {
  root: string;
  beforeExit: () => Promise<void>;
}): Promise<void> {
  const win = new BrowserWindow({
    show: false,
    webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false },
  });
  try {
    // dist/testing → dist/renderer: the shell's own renderer output (ESR 3a)
    await win.loadFile(join(__dirname, "..", "renderer", "spike-loro.html"));
    const raw = await waitForConsole(win, "SPIKE_LORO ", 30_000);
    const result = JSON.parse(raw) as { ok: boolean };
    console.log(`SPIKE_LORO ${raw}`);
    await opts.beforeExit();
    if (!process.env["FIELDD_DATA_DIR"]) rmSync(opts.root, { recursive: true, force: true });
    app.exit(result.ok ? 0 : 2);
  } catch (e) {
    console.error(`SPIKE_LORO failed: ${e instanceof Error ? e.message : e}`);
    await opts.beforeExit();
    if (!process.env["FIELDD_DATA_DIR"]) rmSync(opts.root, { recursive: true, force: true });
    app.exit(2);
  }
}
