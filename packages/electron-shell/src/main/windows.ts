import { join } from "node:path";
import { BrowserWindow, screen } from "electron";
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
    webPreferences: assertSecurePreferences(webPreferences(opts.preloadPath)),
  });
  if (fillWorkArea) win.setBounds(screen.getPrimaryDisplay().workArea);
  return win;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Production loads the packaged file; dev polls the Vite server up. */
export async function loadRenderer(
  win: BrowserWindow,
  mode: ShellMode,
  viteUrl: string,
): Promise<void> {
  if (mode !== "dev") {
    // the shell is self-contained: dist/main → dist/renderer (ESR 3a)
    await win.loadFile(join(__dirname, "..", "renderer", "index.html"));
    return;
  }
  for (let i = 0; i < 40; i++) {
    try {
      await win.loadURL(viteUrl);
      return;
    } catch {
      await sleep(500); // vite still booting
    }
  }
  throw new Error("vite dev server never came up");
}
