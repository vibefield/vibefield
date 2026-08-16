import { createHash } from "node:crypto";
import type { LiveSurfaceBrowserSourceV1 } from "@vibefield/contracts";

const ALL_URLS = { urls: ["<all_urls>"] } as const;
const guardedBrowserSurfaceSessions = new WeakSet<object>();
const configuredBrowserSurfaceSessions = new WeakSet<object>();

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
  on(event: "will-download", listener: (event: { preventDefault(): void }) => void): this;
}

export interface GuardedBrowserSurfaceWebContents {
  on(
    event: "will-navigate" | "will-redirect",
    listener: (event: { preventDefault(): void }, url: string) => void,
  ): this;
  on(event: "will-attach-webview", listener: (event: { preventDefault(): void }) => void): this;
  setWindowOpenHandler(handler: () => { action: "deny" }): void;
}

/** Stable opaque session name: profile refs never appear in Chromium partition paths. */
export function browserSurfacePartition(source: LiveSurfaceBrowserSourceV1): string {
  const digest = createHash("sha256")
    .update(source.profile.mode)
    .update("\0")
    .update(source.profile.ref)
    .digest("hex")
    .slice(0, 40);
  const name = `vibefield-live-surface:${digest}`;
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
    target.on("will-download", (event) => event.preventDefault());
    configuredBrowserSurfaceSessions.add(target);
  } catch (error) {
    guardedBrowserSurfaceSessions.delete(target);
    throw error;
  }
}

/** Per-source gates, installed before the first remote load. */
export function installGuardedBrowserSurfaceContents(
  contents: GuardedBrowserSurfaceWebContents,
): void {
  contents.setWindowOpenHandler(() => ({ action: "deny" }));
  const guardNavigation = (event: { preventDefault(): void }, url: string): void => {
    if (!isAllowedBrowserTopLevelUrl(url)) event.preventDefault();
  };
  contents.on("will-navigate", guardNavigation);
  contents.on("will-redirect", guardNavigation);
  contents.on("will-attach-webview", (event) => event.preventDefault());
}

export function isGuardedBrowserSurfaceSession(value: object): boolean {
  return guardedBrowserSurfaceSessions.has(value);
}
