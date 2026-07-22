import { type BrowserWindow, session, shell } from "electron";
import type { ShellMode } from "./modes";
import { buildCsp, decideNavigation, decideWindowOpen } from "./security-policy";

// Electron wiring for the pure policy in security-policy.ts (ESR §5.2.3–5.2.4).

export function installCsp(mode: ShellMode): void {
  const csp = buildCsp(mode);
  if (csp === null) return;
  session.defaultSession.webRequest.onHeadersReceived((details, cb) => {
    cb({ responseHeaders: { ...details.responseHeaders, "Content-Security-Policy": [csp] } });
  });
}

/** The live user of the external path is the tailnet auth link in Settings —
 * before this policy existed it opened an unmanaged BrowserWindow. */
export function installNavigationPolicy(win: BrowserWindow, mode: ShellMode): void {
  win.webContents.on("will-navigate", (event, targetUrl) => {
    if (!decideNavigation(mode, win.webContents.getURL(), targetUrl)) event.preventDefault();
  });
  win.webContents.setWindowOpenHandler(({ url }) => {
    const decision = decideWindowOpen(url);
    if (decision.openExternal !== undefined) void shell.openExternal(decision.openExternal);
    return { action: "deny" };
  });
}
