import { BrowserWindow, screen } from "electron";
import { APP_ENTRY_URL } from "./app-protocol";
import { isSmokeLike, type ShellMode } from "./modes";
import { assertSecurePreferences, webPreferences } from "./window-policy";

// Runtime window construction (ESR §5.2.2–5.2.3): ALL BrowserWindow creation
// flows through here with the one web-preferences policy. The registry lives in
// window-policy.ts (pure, testable).

/** darwin outside test modes: fill the primary work area with inset traffic
 * lights. Applied HERE per window — never via a global browser-window-created
 * listener that would mutate every future window indiscriminately (§5.2.3). */
export function createMainWindow(opts: {
  mode: ShellMode;
  preloadPath: string;
  show: boolean;
  /** MV-3c — offscreen rendering, for a lab window that is never shown (the
   * Godview perf lab and capture, M31/M32); every other window leaves it unset */
  offscreen?: { deviceScaleFactor: number } | undefined;
}): BrowserWindow {
  const fillWorkArea = process.platform === "darwin" && !isSmokeLike(opts.mode);
  const win = new BrowserWindow({
    titleBarStyle: fillWorkArea ? "hiddenInset" : "default",
    // conditional spread: exactOptionalPropertyTypes forbids an explicit undefined
    ...(fillWorkArea ? { trafficLightPosition: { x: 18, y: 22 } } : {}),
    width: 1180,
    height: 780,
    show: opts.show,
    title: "VibeField",
    backgroundColor: "#171717", // pre-paint = the dark canvas token (--vf-canvas-bg)
    webPreferences: assertSecurePreferences({
      ...webPreferences(opts.preloadPath),
      ...(opts.offscreen !== undefined ? { offscreen: opts.offscreen } : {}),
    }),
  });
  if (fillWorkArea) win.setBounds(screen.getPrimaryDisplay().workArea);
  // Dev opens the tools by default (James, 2026-08-02) — detached, so the
  // canvas keeps its geometry. Every other mode stays clean.
  if (opts.mode === "dev") win.webContents.openDevTools({ mode: "detach" });
  return win;
}

/** Hardened non-product renderer factory. Capability comes from its preload;
 * the factory permits presentation and session selection only. */
export function createHostAuxiliaryWindow(opts: {
  title: string;
  preloadPath: string;
  partition: string;
  width: number;
  height: number;
  backgroundColor: string;
  show: boolean;
}): BrowserWindow {
  return new BrowserWindow({
    title: opts.title,
    width: opts.width,
    height: opts.height,
    show: opts.show,
    backgroundColor: opts.backgroundColor,
    webPreferences: assertSecurePreferences({
      ...webPreferences(opts.preloadPath),
      partition: opts.partition,
    }),
  });
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Production loads the app's OWN origin; dev polls the Vite server up.
 *
 * `loadFile()` is gone (ESP §8.3 stage F2): a `file:` document is why
 * `GrantFileProtocolExtraPrivileges` had to stay on, and it also cannot host an
 * ES-module graph without that privilege. Serving the same directory over
 * `vibefield-app://shell` gives the renderer a real, single origin — which is
 * what makes CSP `'self'` a precise statement — and let the fuse close.
 *
 * Smoke-canvas takes this path too, deliberately: it means the custom origin is
 * exercised on every `pnpm smoke:canvas`, not only when someone builds a package. */
export async function loadRenderer(
  win: BrowserWindow,
  mode: ShellMode,
  viteUrl: string,
): Promise<void> {
  if (mode !== "dev") {
    const url = new URL(APP_ENTRY_URL);
    if (mode === "smoke-godview" || mode === "terminal-perf-lab" || mode === "godview-perf-lab") {
      url.searchParams.set("godviewMarkers", "1");
    }
    // MV-0 — the Godview perf lab: the probe + player bridges (`lab-bridge.ts`)
    // and the replay door in place of the live subscriptions (`door-instruments.ts`)
    if (mode === "godview-perf-lab") {
      url.searchParams.set("godviewPerf", "1");
      url.searchParams.set("godviewReplay", "1");
      // MV-5 — a lab launch asked for the dev server's renderer (the SIGTRAP
      // probe's dev run: the swarm's worker served by Vite), with the same switches
      if (process.env["VF_GODVIEW_LAB_RENDERER"] === "dev") {
        const dev = new URL(viteUrl);
        for (const [key, value] of url.searchParams) dev.searchParams.set(key, value);
        await win.loadURL(dev.href);
        return;
      }
    }
    await win.loadURL(url.href);
    return;
  }
  const devUrl = new URL(viteUrl).href;
  for (let i = 0; i < 40; i++) {
    try {
      await win.loadURL(devUrl);
      return;
    } catch {
      await sleep(500); // vite still booting
    }
  }
  throw new Error("vite dev server never came up");
}
