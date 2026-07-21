import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { app, BrowserWindow, ipcMain, session } from "electron";
import { FielddClient } from "@vibefield/fieldd-client";

// VibeField shell main (Track A walking skeleton, design-03 §2):
// adopt-or-spawn fieldd (which ensures field-native), hello as shell-main with
// the 0600 run/shell.token, mint per-window renderer tokens over IPC, open the
// window. Main stays off every hot path (PF2) — it brokers the connection
// descriptor once, then all product traffic is renderer ⇄ fieldd over the
// loopback WS.

const DEV = process.argv.includes("--dev");
const SMOKE = process.argv.includes("--smoke");
const VITE_URL = process.env["VITE_DEV_SERVER_URL"] ?? "http://localhost:5173";

// dist/main.cjs → apps/desktop; repo root two levels up (dev layout)
const appRoot = resolve(__dirname, "..");
const repoRoot = resolve(appRoot, "..", "..");

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

interface ProductInfo {
  port: number;
  pid: number;
  bootId: string;
  nativePid: number | null;
}

interface Shell {
  client: FielddClient;
  info: ProductInfo;
}

let fielddChild: ChildProcess | null = null;
let mainWin: BrowserWindow | null = null;

function dataRoot(): string {
  if (process.env["FIELDD_DATA_DIR"]) return process.env["FIELDD_DATA_DIR"];
  if (SMOKE) return mkdtempSync(join(tmpdir(), "vf-smoke-"));
  return join(app.getPath("appData"), "VibeField");
}

/** A live fieldd answers on the port recorded in product.json with the token
 * from shell.token; anything else (stale files, foreign listener) fails the
 * bounded probe and we spawn our own. */
async function tryAdopt(root: string, probeMs: number): Promise<Shell | null> {
  const runDir = join(root, "fieldd", "run");
  const productPath = join(runDir, "product.json");
  const tokenPath = join(runDir, "shell.token");
  if (!existsSync(productPath) || !existsSync(tokenPath)) return null;
  let client: FielddClient | null = null;
  try {
    const info = JSON.parse(readFileSync(productPath, "utf8")) as ProductInfo;
    const token = readFileSync(tokenPath, "utf8").trim();
    client = new FielddClient({ url: `ws://127.0.0.1:${info.port}`, token, clientKind: "shell-main" });
    client.connect();
    await Promise.race([
      client.ready(),
      new Promise((_, rej) => setTimeout(() => rej(new Error("adopt probe timeout")), probeMs)),
    ]);
    return { client, info };
  } catch {
    client?.close();
    return null;
  }
}

async function ensureFieldd(root: string): Promise<Shell> {
  const adopted = await tryAdopt(root, 1500);
  if (adopted) {
    console.log(`[shell] adopted running fieldd :${adopted.info.port} (${adopted.info.bootId})`);
    return adopted;
  }

  const fielddBin = process.env["FIELDD_BIN"] ?? join(repoRoot, "packages", "fieldd", "dist", "bin.cjs");
  const nativeBin = process.env["FIELDD_NATIVE_BIN"] ?? join(repoRoot, "target", "debug", "field-native");
  if (!existsSync(fielddBin)) throw new Error(`fieldd bin missing (build it): ${fielddBin}`);

  const env: NodeJS.ProcessEnv = {
    ...process.env,
    ELECTRON_RUN_AS_NODE: "1", // run the fieldd bundle with our own binary
    FIELDD_DATA_DIR: root,
    ...(existsSync(nativeBin) ? { FIELDD_NATIVE_BIN: nativeBin } : {}),
    ...(DEV ? { FIELDD_ALLOWED_ORIGINS: new URL(VITE_URL).origin } : {}),
    ...(SMOKE ? { FIELDD_CONTROL_PORT: "0" } : {}),
  };
  fielddChild = spawn(process.execPath, [fielddBin], { env, stdio: ["ignore", "pipe", "pipe"] });
  fielddChild.stdout?.on("data", (d) => console.log(`[fieldd] ${String(d).trim()}`));
  fielddChild.stderr?.on("data", (d) => console.error(`[fieldd!] ${String(d).trim()}`));
  console.log(`[shell] spawned fieldd pid=${fielddChild.pid}`);

  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    const shell = await tryAdopt(root, 600);
    if (shell) {
      console.log(`[shell] fieldd up :${shell.info.port} (${shell.info.bootId})`);
      return shell;
    }
    await sleep(200);
  }
  throw new Error("fieldd did not come up within 20s");
}

function installCsp(): void {
  // prod only — the Vite dev server needs its HMR inline preamble
  const CSP =
    "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; " +
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

async function createWindow(shell: Shell): Promise<void> {
  const win = new BrowserWindow({
    width: 1180,
    height: 780,
    title: "VibeField",
    backgroundColor: "#0b0d10",
    webPreferences: {
      preload: join(__dirname, "preload.cjs"),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  mainWin = win;
  win.on("closed", () => {
    if (mainWin === win) mainWin = null;
  });
  await loadRenderer(win);
  void shell; // window count is the shell's only per-window state so far
}

async function smoke(shell: Shell, root: string): Promise<void> {
  const health = (await shell.client.request("system.health")) as {
    nativeConnected: boolean;
    native: { units?: Array<{ unit: string }> } | null;
  };
  const summary = {
    ok: health.nativeConnected,
    port: shell.info.port,
    nativeConnected: health.nativeConnected,
    units: health.native?.units?.map((u) => u.unit) ?? [],
  };
  console.log(`SMOKE ${JSON.stringify(summary)}`);
  shell.client.close();
  fielddChild?.kill("SIGTERM");
  if (shell.info.nativePid) {
    try {
      process.kill(shell.info.nativePid, "SIGTERM");
    } catch {
      /* already gone */
    }
  }
  await sleep(300);
  rmSync(root, { recursive: true, force: true });
  app.exit(summary.ok ? 0 : 2); // exit is queued; the caller returns without opening a window
}

async function main(): Promise<void> {
  await app.whenReady();
  if (!DEV) installCsp();

  const root = dataRoot();
  const shell = await ensureFieldd(root);

  if (SMOKE) {
    await smoke(shell, root);
    return;
  }

  ipcMain.handle("vibefield:connection", async (event) => {
    const minted = (await shell.client.request("system.mintWindowToken", {
      scopes: [],
      label: `window-${event.sender.id}`,
    })) as { token: string };
    return { port: shell.info.port, token: minted.token };
  });

  shell.client.onStatusChange(() => {
    console.log(`[shell] fieldd link: ${shell.client.status}`);
  });

  await createWindow(shell);
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
  app.on("before-quit", () => {
    // dev/smoke own their fieldd; a real install leaves the daemon running
    if ((DEV || SMOKE) && fielddChild) fielddChild.kill("SIGTERM");
  });
  main().catch((e: unknown) => {
    console.error("[shell] fatal:", e);
    app.exit(1);
  });
}
