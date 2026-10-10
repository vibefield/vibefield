import { createHash } from "node:crypto";
import type { LiveSurfaceBrowserSourceV1 } from "@vibefield/contracts";

const ALL_URLS = { urls: ["<all_urls>"] } as const;
const guardedBrowserSurfaceSessions = new WeakSet<object>();
const configuredBrowserSurfaceSessions = new WeakSet<object>();
/** PT-5a: who is told when a page's download is cancelled — by the WebContents that asked (a session is many pages'). */
const downloadRefusals = new WeakMap<object, () => void>();

export interface BrowserSurfaceWebRequest {
  onBeforeRequest(
    filter: { urls: readonly string[] },
    listener: (
      details: { url: string; resourceType?: string },
      callback: (decision: { cancel: boolean }) => void,
    ) => void,
  ): void;
}

export interface BrowserSurfaceSession {
  readonly webRequest: BrowserSurfaceWebRequest;
  setPermissionRequestHandler(
    handler: (contents: unknown, permission: string, callback: (granted: boolean) => void) => void,
  ): void;
  setPermissionCheckHandler(handler: (contents: unknown, permission: string) => boolean): void;
  on(
    event: "will-download",
    listener: (event: { preventDefault(): void }, item?: unknown, contents?: unknown) => void,
  ): this;
}

export interface GuardedBrowserSurfaceWebContents {
  on(
    event: "will-navigate" | "will-redirect",
    listener: (event: { preventDefault(): void }, url: string) => void,
  ): this;
  on(
    event: "will-attach-webview" | "will-prevent-unload",
    listener: (event: { preventDefault(): void }) => void,
  ): this;
  on(
    event: "login",
    listener: (
      event: { preventDefault(): void },
      details: unknown,
      authInfo: unknown,
      callback: (username?: string, password?: string) => void,
    ) => void,
  ): this;
  setWindowOpenHandler(handler: (details: { url: string }) => { action: "deny" }): void;
}

/**
 * PT-5a — what a page asked for and was REFUSED, as its guards say it (ruling 7: answered at once, never by a native
 * window): a pop-up (its address: the pane itself goes there), a page that asked to stay on its unload, HTTP auth, a
 * download. The dialogs and the file picker are the native adapter's to say (CDP).
 */
export type BrowserSurfaceGuardRefusal = "popup" | "beforeunload" | "auth" | "download";

/** A profile's stable opaque name — a digest of its mode and ref: profile refs never appear in a path. */
export function browserSurfaceProfileName(source: LiveSurfaceBrowserSourceV1): string {
  return createHash("sha256")
    .update(source.profile.mode)
    .update("\0")
    .update(source.profile.ref)
    .digest("hex")
    .slice(0, 40);
}

/** Stable opaque session name: profile refs never appear in Chromium partition paths. */
export function browserSurfacePartition(source: LiveSurfaceBrowserSourceV1): string {
  const name = `vibefield-live-surface:${browserSurfaceProfileName(source)}`;
  return source.profile.mode === "persistent" ? `persist:${name}` : name;
}

/** Browser surfaces navigate intentionally, but only through ordinary web schemes. */
export function isAllowedBrowserTopLevelUrl(candidate: string): boolean {
  try {
    const protocol = new URL(candidate).protocol;
    return (
      protocol === "http:" ||
      protocol === "https:" ||
      (protocol === "about:" && candidate === "about:blank")
    );
  } catch {
    return false;
  }
}

export function isAllowedBrowserRequest(candidate: string, resourceType?: string): boolean {
  const topLevel = resourceType === "mainFrame";
  try {
    const protocol = new URL(candidate).protocol;
    if (protocol === "http:" || protocol === "https:") return true;
    if (protocol === "about:" && candidate === "about:blank") return true;
    if (topLevel) return false;
    if (protocol === "ws:" || protocol === "wss:") return true;
    if (protocol === "data:" || protocol === "blob:") return true;
    return false;
  } catch {
    return false;
  }
}

/**
 * Installs a session-wide deny policy before any Browser WebContents is born.
 * A shared profile session is configured once and remains guarded for app life.
 */
export function installGuardedBrowserSurfaceSession(target: BrowserSurfaceSession): void {
  if (configuredBrowserSurfaceSessions.has(target)) return;
  guardedBrowserSurfaceSessions.add(target);
  try {
    target.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
    target.setPermissionCheckHandler(() => false);
    target.webRequest.onBeforeRequest(ALL_URLS, (details, callback) => {
      callback({ cancel: !isAllowedBrowserRequest(details.url, details.resourceType) });
    });
    target.on("will-download", (event, _item, contents) => {
      event.preventDefault();
      if (typeof contents === "object" && contents !== null) downloadRefusals.get(contents)?.();
    });
    configuredBrowserSurfaceSessions.add(target);
  } catch (error) {
    guardedBrowserSurfaceSessions.delete(target);
    throw error;
  }
}

/**
 * Per-source gates, installed before the first remote load. PT-5a — each answers AT ONCE and tells `refused`:
 *  - a pop-up (`window.open`, `target=_blank`) opens no window — its address is told (the pane itself goes there);
 *  - a page that asks to stay on its unload (`beforeunload`) LEAVES — no page blocks behind a dialog nobody sees;
 *  - HTTP auth is cancelled — the page gets its own 401;
 *  - a download the page starts is cancelled by its session's guard, and told here by the contents that asked.
 */
export function installGuardedBrowserSurfaceContents(
  contents: GuardedBrowserSurfaceWebContents,
  refused: (what: BrowserSurfaceGuardRefusal, url?: string) => void = () => undefined,
): void {
  contents.setWindowOpenHandler((details) => {
    refused("popup", details?.url);
    return { action: "deny" };
  });
  const guardNavigation = (event: { preventDefault(): void }, url: string): void => {
    if (!isAllowedBrowserTopLevelUrl(url)) event.preventDefault();
  };
  contents.on("will-navigate", guardNavigation);
  contents.on("will-redirect", guardNavigation);
  contents.on("will-attach-webview", (event) => event.preventDefault());
  // Electron's word: preventing THIS event ignores the page's beforeunload handler and lets the unload go on
  contents.on("will-prevent-unload", (event) => {
    event.preventDefault();
    refused("beforeunload");
  });
  contents.on("login", (event, _details, _authInfo, callback) => {
    event.preventDefault();
    callback();
    refused("auth");
  });
  downloadRefusals.set(contents, () => refused("download"));
}

export function isGuardedBrowserSurfaceSession(value: object): boolean {
  return guardedBrowserSurfaceSessions.has(value);
}
