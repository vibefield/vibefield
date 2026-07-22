import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import {
  type CloseRequest,
  type CloseResult,
  IPC_CHANNELS,
  type WindowConnection,
} from "@vibefield/contracts";
import {
  createFielddSupervisor,
  type FielddHandle,
  type FielddSupervisor,
} from "@vibefield/fieldd-supervisor";
import { app, BrowserWindow, dialog, ipcMain, screen, session } from "electron";

// VibeField shell main (Track A walking skeleton → ESR slice 1, design-03 §2):
// fieldd ownership lives in @vibefield/fieldd-supervisor (adopt-or-spawn,
// readiness, structured failure, stop-owned policy); main composes it, mints
// per-window renderer tokens over the closed IPC surface (contract channel
// registry), and opens the window. Main stays off every hot path (PF2) — it
// brokers the connection descriptor once, then all product traffic is
// renderer ⇄ fieldd over the loopback WS.

const DEV = process.argv.includes("--dev");
const SMOKE = process.argv.includes("--smoke");
const SPIKE_LORO = process.argv.includes("--spike-loro");
const SMOKE_CANVAS = process.argv.includes("--smoke-canvas");
const VITE_URL = process.env["VITE_DEV_SERVER_URL"] ?? "http://localhost:5173";

// dist/main.cjs → apps/desktop; repo root two levels up (dev layout)
const appRoot = resolve(__dirname, "..");
const repoRoot = resolve(appRoot, "..", "..");

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

let supervisor: FielddSupervisor | null = null;
let mainWin: BrowserWindow | null = null;
let closeRequestSequence = 0;

function dataRoot(): string {
  if (process.env["FIELDD_DATA_DIR"]) return process.env["FIELDD_DATA_DIR"];
  if (SMOKE || SMOKE_CANVAS) return mkdtempSync(join(tmpdir(), "vf-smoke-"));
  return join(app.getPath("appData"), "VibeField");
}

/** Resolve when a renderer console line starting with `prefix` arrives. */
function waitForConsole(win: BrowserWindow, prefix: string, timeoutMs: number): Promise<string> {
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

/** The supervisor owns adopt/spawn/probe/readiness (ESR §5.3); this builder
 * owns only what a supervisor must never know: Electron paths, the runner
 * (our own binary in Node mode), and the mode-derived policy. Smoke isolates
 * BOTH daemon ports (slice-0 finding 2: :9411 collisions with a live daemon)
 * and dev/smoke stop what they spawned — never an adopted process. */
function buildSupervisor(root: string): FielddSupervisor {
  const fielddBin =
    process.env["FIELDD_BIN"] ?? join(repoRoot, "packages", "fieldd", "dist", "bin.cjs");
  const nativeBin =
    process.env["FIELDD_NATIVE_BIN"] ?? join(repoRoot, "target", "debug", "field-native");
  if (!existsSync(fielddBin)) throw new Error(`fieldd bin missing (build it): ${fielddBin}`);
  return createFielddSupervisor({
    dataRoot: root,
    spawn: { command: process.execPath, args: [fielddBin] },
    environment: { ...process.env, ELECTRON_RUN_AS_NODE: "1" },
    ...(existsSync(nativeBin) ? { nativeExecutable: nativeBin } : {}),
    ...(DEV ? { allowedOrigins: [new URL(VITE_URL).origin] } : {}),
    ...(SMOKE || SMOKE_CANVAS ? { controlPort: 0, dataPort: 0 } : {}),
    shutdownPolicy: DEV || SMOKE || SMOKE_CANVAS ? "stop-owned" : "leave-running",
    onLog: (line) => console.log(`[fieldd] ${line}`),
  });
}

function installCsp(): void {
  // prod only — the Vite dev server needs its HMR inline preamble
  // 'wasm-unsafe-eval' admits WebAssembly compilation ONLY (loro's inlined
  // wasm build) — plain 'unsafe-eval' stays banned. B1 spike finding.
  const CSP =
    "default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline'; " +
    "img-src 'self' data:; connect-src ws://127.0.0.1:*; base-uri 'none'; object-src 'none'";
  session.defaultSession.webRequest.onHeadersReceived((details, cb) => {
    cb({ responseHeaders: { ...details.responseHeaders, "Content-Security-Policy": [CSP] } });
  });
}

async function loadRenderer(win: BrowserWindow): Promise<void> {
  if (!DEV) {
    await win.loadFile(join(appRoot, "dist", "renderer", "index.html"));
    return;
  }
  for (let i = 0; i < 40; i++) {
    try {
      await win.loadURL(VITE_URL);
      return;
    } catch {
      await sleep(500); // vite still booting
    }
  }
  throw new Error("vite dev server never came up");
}

function prepareRendererClose(win: BrowserWindow, timeoutMs = 15_000): Promise<void> {
  const requestId = `${win.id}:${++closeRequestSequence}`;
  return new Promise((resolve, reject) => {
    const finish = (error?: Error) => {
      clearTimeout(timeout);
      ipcMain.off(IPC_CHANNELS.closeResult, onReply);
      win.webContents.off("destroyed", onDestroyed);
      if (error === undefined) resolve();
      else reject(error);
    };
    const onReply = (event: Electron.IpcMainEvent, result: CloseResult) => {
      if (event.sender !== win.webContents || result?.requestId !== requestId) return;
      if (result.ok) finish();
      else finish(new Error(result.error ?? "renderer could not persist the document"));
    };
    const onDestroyed = () => finish(new Error("renderer exited before saving completed"));
    const timeout = setTimeout(
      () => finish(new Error(`document shutdown timed out after ${timeoutMs}ms`)),
      timeoutMs,
    );
    ipcMain.on(IPC_CHANNELS.closeResult, onReply);
    win.webContents.once("destroyed", onDestroyed);
    win.webContents.send(IPC_CHANNELS.prepareClose, {
      requestId,
      reason: "window",
    } satisfies CloseRequest);
  });
}

function installDurableClose(win: BrowserWindow): void {
  let closeAllowed = false;
  let busy = false;

  const attemptClose = async (): Promise<void> => {
    if (busy || win.isDestroyed()) return;
    busy = true;
    try {
      await prepareRendererClose(win);
      closeAllowed = true;
      win.close();
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      const choice = await dialog.showMessageBox(win, {
        type: "error",
        title: "Document Not Saved",
        message: "VibeField could not finish saving this document.",
        detail,
        buttons: ["Retry", "Quit Without Saving"],
        defaultId: 0,
        cancelId: 0,
        noLink: true,
      });
      busy = false;
      if (choice.response === 0) {
        void attemptClose();
      } else if (!win.isDestroyed()) {
        closeAllowed = true;
        win.close();
      }
    }
  };

  win.on("close", (event) => {
    if (closeAllowed) return;
    event.preventDefault();
    void attemptClose();
  });
}

async function createWindow(handle: FielddHandle, show = true): Promise<BrowserWindow> {
  const win = new BrowserWindow({
    titleBarStyle: shouldFillPrimaryWorkArea ? "hiddenInset" : "default",
    // conditional spread: exactOptionalPropertyTypes forbids an explicit undefined
    ...(shouldFillPrimaryWorkArea ? { trafficLightPosition: { x: 18, y: 22 } } : {}),
    width: 1180,
    height: 780,
    show,
    title: "VibeField",
    backgroundColor: "#171717", // pre-paint = the dark canvas token (--vf-canvas-bg)
    webPreferences: {
      preload: join(__dirname, "preload.cjs"),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      // covered/occluded windows must keep ticking: engine rAF + Loro sync
      // (predesign-02 packaging kit verify item)
      backgroundThrottling: false,
    },
  });
  mainWin = win;
  installDurableClose(win);
  win.on("closed", () => {
    if (mainWin === win) mainWin = null;
  });
  await loadRenderer(win);
  void handle; // window count is the shell's only per-window state so far
  return win;
}

/** Teardown for smoke/dev exits: stop-owned via the supervisor (adopted
 * daemons survive — ownership law), then remove the root ONLY if this run
 * created it (an injected FIELDD_DATA_DIR is someone else's data). */
async function smokeTeardown(sup: FielddSupervisor, root: string): Promise<void> {
  await sup.dispose();
  if (!process.env["FIELDD_DATA_DIR"]) rmSync(root, { recursive: true, force: true });
}

async function smoke(handle: FielddHandle, sup: FielddSupervisor, root: string): Promise<void> {
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
  await smokeTeardown(sup, root);
  app.exit(summary.ok ? 0 : 2); // exit is queued; the caller returns without opening a window
}

/// B1 spike: load the PROD spike page over file:// in a sandboxed window and
/// report the renderer's own verdict. No daemons involved.
async function spikeLoro(): Promise<void> {
  const win = new BrowserWindow({
    titleBarStyle: shouldFillPrimaryWorkArea ? "hiddenInset" : "default",
    // conditional spread: exactOptionalPropertyTypes forbids an explicit undefined
    ...(shouldFillPrimaryWorkArea ? { trafficLightPosition: { x: 18, y: 22 } } : {}),
    show: false,
    webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false },
  });
  const verdict = new Promise<string>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error("spike timed out (30s)")), 30_000);
    win.webContents.on("console-message", (...args: unknown[]) => {
      for (const a of args) {
        const text =
          typeof a === "string"
            ? a
            : a && typeof a === "object" && "message" in a
              ? String((a as { message: unknown }).message)
              : "";
        if (text.startsWith("SPIKE_LORO ")) {
          clearTimeout(t);
          resolve(text.slice("SPIKE_LORO ".length));
          return;
        }
      }
    });
  });
  await win.loadFile(join(appRoot, "dist", "renderer", "spike-loro.html"));
  try {
    const raw = await verdict;
    const result = JSON.parse(raw) as { ok: boolean };
    console.log(`SPIKE_LORO ${raw}`);
    app.exit(result.ok ? 0 : 2);
  } catch (e) {
    console.error(`SPIKE_LORO failed: ${e instanceof Error ? e.message : e}`);
    app.exit(2);
  }
}

async function main(): Promise<void> {
  await app.whenReady();
  if (!DEV) installCsp();

  if (SPIKE_LORO) {
    await spikeLoro();
    return;
  }

  const root = dataRoot();
  supervisor = buildSupervisor(root);
  const handle = await supervisor.ensure();

  if (SMOKE) {
    await smoke(handle, supervisor, root);
    return;
  }

  ipcMain.handle(IPC_CHANNELS.windowBootstrap, async (event) => {
    const minted = (await handle.client.request("system.mintWindowToken", {
      // B3: the renderer owns the board doc — doc.* is scope-gated (EL7), and
      // the :9411 lane itself is entered through doc.open's one-shot ticket.
      // C4: workspace.read lets the Settings mesh section read the device roster.
      scopes: ["doc.read", "doc.write", "workspace.read"],
      label: `window-${event.sender.id}`,
    })) as { token: string };
    return { port: handle.info.port, token: minted.token } satisfies WindowConnection;
  });

  handle.client.onStatusChange(() => {
    console.log(`[shell] fieldd link: ${handle.client.status}`);
  });

  if (SMOKE_CANVAS) {
    // full spine + real renderer, hidden: pass iff the canvas reports in.
    // Teardown runs on EVERY path — the old failure path leaked the spawned
    // daemons (slice-0 finding 3).
    const win = await createWindow(handle, false);
    let ok = false;
    try {
      const raw = await waitForConsole(win, "CANVAS_READY ", 45_000);
      console.log(`SMOKE_CANVAS ${raw}`);
      ok = true;
    } catch (e) {
      console.error(`SMOKE_CANVAS failed: ${e instanceof Error ? e.message : e}`);
    }
    await smokeTeardown(supervisor, root);
    app.exit(ok ? 0 : 2);
    return;
  }

  await createWindow(handle);
}

// D10 — one shell per device
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on("second-instance", () => {
    if (mainWin) {
      if (mainWin.isMinimized()) mainWin.restore();
      mainWin.focus();
    }
  });
  app.on("window-all-closed", () => app.quit()); // skeleton: no tray yet
  app.on("will-quit", () => {
    // policy-encoded teardown: stop-owned (dev/smoke) stops only what THIS
    // shell spawned; production leave-running just closes the client
    void supervisor?.dispose();
  });
  main().catch((e: unknown) => {
    console.error("[shell] fatal:", e);
    void supervisor?.dispose(); // boot failure must not leak a spawned daemon
    app.exit(1);
  });
}

const shouldFillPrimaryWorkArea =
  process.platform === "darwin" &&
  !process.argv.some((arg) => arg.startsWith("--smoke") || arg === "--spike-loro");

if (shouldFillPrimaryWorkArea) {
  app.on("browser-window-created", (_event, win) => {
    win.setBounds(screen.getPrimaryDisplay().workArea);
  });
}
