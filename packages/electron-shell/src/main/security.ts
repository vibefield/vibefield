import { app, type BrowserWindow, type Session, session, shell, type WebContents } from "electron";
import type { ShellMode } from "./modes";
import { buildCsp, decideNavigation, decidePermission, decideWindowOpen } from "./security-policy";

// Electron wiring for the pure policy in security-policy.ts (ESR §5.2.3–5.2.4;
// electron-security-packaging.md §7). Nothing here decides anything — every
// verdict comes from the pure module so the suite can prove it without Electron.

export function installCsp(mode: ShellMode): void {
  const csp = buildCsp(mode);
  if (csp === null) return;
  session.defaultSession.webRequest.onHeadersReceived((details, cb) => {
    cb({ responseHeaders: { ...details.responseHeaders, "Content-Security-Policy": [csp] } });
  });
}

/** Both handlers, per session (ESP §7.4). Installing only the request handler
 * leaves `permissions.query()` answering from Chromium's own defaults — the
 * silent-grant path. They share one decision function, so they cannot drift. */
export function installPermissionPolicy(
  target: Session,
  onDenied?: (permission: string) => void,
): void {
  target.setPermissionRequestHandler((_contents, permission, callback) => {
    const granted = decidePermission(permission);
    if (!granted) onDenied?.(permission);
    callback(granted);
  });
  target.setPermissionCheckHandler((_contents, permission) => decidePermission(permission));
}

/** The deny-by-default contents policy, applied to ANY WebContents. */
function applyContentsPolicy(contents: WebContents, mode: ShellMode): void {
  contents.on("will-navigate", (event, targetUrl) => {
    if (!decideNavigation(mode, contents.getURL(), targetUrl)) event.preventDefault();
  });
  contents.setWindowOpenHandler(({ url }) => {
    const decision = decideWindowOpen(url);
    if (decision.openExternal !== undefined) void shell.openExternal(decision.openExternal);
    return { action: "deny" };
  });
  // Belt and braces with webviewTag:false — the preference governs whether the
  // tag PARSES, this governs whether an attachment ever completes. A future
  // surface that forgets the preference still cannot host a <webview>.
  contents.on("will-attach-webview", (event) => {
    event.preventDefault();
  });
}

/** The live user of the external path is the tailnet auth link in Settings —
 * before this policy existed it opened an unmanaged BrowserWindow. */
export function installNavigationPolicy(win: BrowserWindow, mode: ShellMode): void {
  applyContentsPolicy(win.webContents, mode);
}

/** Defense in depth for surfaces the factory did not create (ESP §7.2): every
 * WebContents gets the policy at birth, before it can load anything. This does
 * NOT authorize creating surfaces outside the factory — an unregistered one is
 * reported so it is found in review, not in the wild. The registered window is
 * covered twice (here, then explicitly); the verdicts are identical because both
 * paths run the same pure decisions. */
export function installWebContentsBackstop(
  mode: ShellMode,
  onUnregistered?: (contents: WebContents) => void,
): void {
  app.on("web-contents-created", (_event, contents) => {
    applyContentsPolicy(contents, mode);
    onUnregistered?.(contents);
  });
}
