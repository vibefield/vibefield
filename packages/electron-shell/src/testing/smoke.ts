import { rmSync } from "node:fs";
import { join } from "node:path";
import { TerminalCreateResult, TerminalTicket } from "@vibefield/contracts";
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

/** Mint a ticket for a session fieldd has only just created.
 *
 * The retry is not defensive padding — it is the GT-0 finding, kept visible.
 * `terminal.create` drives ghosttea's control socket directly, while
 * `terminal.openTicket` gates on fieldd's OBSERVED inventory, which arrives
 * over the mgmt channel a round trip later. The pair is therefore NOT
 * read-your-writes: a caller that creates and immediately tickets gets
 * NOT_FOUND for a session that certainly exists. Returns the wait it actually
 * cost so the number lands in the run's evidence instead of being smoothed
 * away. */
async function ticketWhenObserved(
  handle: FielddHandle,
  sessionId: string,
  timeoutMs: number,
): Promise<{ ticket: TerminalTicket; observedAfterMs: number }> {
  const started = Date.now();
  for (;;) {
    try {
      const ticket = TerminalTicket.parse(
        await handle.client.request("terminal.openTicket", { sessionId }),
      );
      return { ticket, observedAfterMs: Date.now() - started };
    } catch (error) {
      const elapsed = Date.now() - started;
      const message = error instanceof Error ? error.message : String(error);
      if (elapsed >= timeoutMs || !message.includes("no such terminal")) throw error;
      await sleep(50);
    }
  }
}

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

/** GT-0 spike: the whole terminal seam end to end, against the REAL pair.
 *
 * fieldd mints a free shell (`terminal.create`) and a ticket for it
 * (`terminal.openTicket`); the ticket's socket PATHS and token are what the
 * Electron backend dials in EXTERNAL mode — the shell never supervises
 * ghosttead, because field-native already embeds that floor and outlives us
 * (two-plane law). Bytes then ride the bridge's direct sockets, never
 * JSON-RPC (EL2). The renderer's verdict is the pass condition.
 *
 * The created session id travels in the page URL rather than the console: the
 * console is the VERDICT channel here, and a harness that both speaks and
 * listens on one channel is a harness that can hear itself. */
export async function runSpikeGodview(opts: {
  handle: FielddHandle;
  supervisor: FielddSupervisor;
  root: string;
  registry: WindowRegistry;
  beforeExit: () => Promise<void>;
  onWindow?: (window: BrowserWindow) => void;
}): Promise<void> {
  let backend: { stop: () => void } | null = null;
  let ok = false;
  try {
    const created = TerminalCreateResult.parse(
      await opts.handle.client.request("terminal.create", {}),
    );
    const { ticket, observedAfterMs } = await ticketWhenObserved(
      opts.handle,
      created.sessionId,
      10_000,
    );
    console.log(`SPIKE_GODVIEW_TICKET observed after ${observedAfterMs}ms`);
    // Dynamic: ghosttea-electron is ESM-only, and this artifact is CJS. esbuild
    // inlines it here (bundled, not required at runtime), which is also why the
    // bridge entry is staged beside this file rather than resolved from the
    // package — see build:shell.
    const { GhostteaElectronBackend } = await import("@vibecook/ghosttea-electron/main");
    const godview = new GhostteaElectronBackend({
      mode: "external",
      connection: {
        controlSocket: ticket.controlSocket,
        frameSocket: ticket.frameSocket,
        authToken: ticket.token,
      },
      bridge: { entryPoint: join(__dirname, "bridge-entry.js") },
    });
    backend = godview;
    await godview.start();

    const win = createMainWindow({
      mode: "spike-godview",
      // NOT the product preload: the control/frame ports arrive on ipcRenderer
      // and only a preload can hand them to the page. The spike preload is the
      // product one plus that forward.
      preloadPath: join(__dirname, "spike-godview-preload.cjs"),
      show: false,
    });
    opts.registry.adopt(win);
    opts.onWindow?.(win);
    // Ports are transferred per LOAD, so the handoff belongs on did-finish-load
    // — attaching beside the constructor would post into a document that the
    // pending navigation is about to replace.
    win.webContents.on("did-finish-load", () => {
      if (!win.isDestroyed() && godview.running) godview.attachRenderer(win.webContents);
    });

    const page = new URL(`${APP_ORIGIN}/spike-godview.html`);
    page.searchParams.set("spikeSession", created.sessionId);
    // The workspace spawns its own split with this; field-native chose the
    // login shell for the session above, and the two agree by construction.
    page.searchParams.set("shell", process.env["SHELL"] ?? "/bin/sh");
    // Armed BEFORE the load: a fast verdict must not land in the gap between
    // loadURL resolving and the listener attaching.
    const verdict = waitForConsole(win, "SPIKE_GODVIEW ", 60_000);
    verdict.catch(() => undefined);
    await win.loadURL(page.href);
    const raw = await verdict;
    console.log(`SPIKE_GODVIEW ${raw}`);
    ok = (JSON.parse(raw) as { ok: boolean }).ok;
  } catch (e) {
    console.error(`SPIKE_GODVIEW failed: ${e instanceof Error ? e.message : e}`);
  }
  // The bridge is a utilityProcess; it dies with the shell, but stopping it
  // first keeps the ordering honest — renderer, bridge, then the pair.
  backend?.stop();
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
