import { createHash } from "node:crypto";
import type { LiveSurfaceBrowserSourceV1 } from "@vibefield/contracts";

const ALL_URLS = { urls: ["<all_urls>"] } as const;
const guardedBrowserSurfaceSessions = new WeakSet<object>();
const configuredBrowserSurfaceSessions = new WeakSet<object>();
/** PT-5a: who is told when a page's download is cancelled — by the WebContents that asked (a session is many pages'). */
const downloadRefusals = new WeakMap<object, () => void>();
/** BP-D1: who is told when a page's permission REQUEST is denied — by the WebContents that asked, as for a download. */
const permissionRefusals = new WeakMap<object, (permission: string) => void>();

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
    handler: (
      contents: unknown,
      permission: string,
      callback: (granted: boolean) => void,
      /** Electron's request details: a media request's carry `mediaTypes` (read defensively) */
      details?: unknown,
    ) => void,
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
  on(
    event: "certificate-error",
    listener: (
      event: { preventDefault(): void },
      url: string,
      error: string,
      certificate: unknown,
      callback: (trusted: boolean) => void,
    ) => void,
  ): this;
  setWindowOpenHandler(handler: (details: { url: string }) => { action: "deny" }): void;
}

/**
 * PT-5a — what a page asked for and was REFUSED, as its guards say it (ruling 7: answered at once, never by a native
 * window): a pop-up (its address: the pane itself goes there), a page that asked to stay on its unload, HTTP auth, a
 * download — and (BP-D1, thinking-browser-profile.md, 2026-10-26) a Chromium permission it REQUESTED, denied (its word:
 * `browserSurfacePermissionWord`). The dialogs and the file picker are the native adapter's to say (CDP).
 */
export type BrowserSurfaceGuardRefusal =
  | "popup"
  | "beforeunload"
  | "auth"
  | "download"
  | "permission";

/** What a refused permission request is CALLED when the pane says it (BP-D1): Chromium's own word, except a media request,
 * which is the camera when it asks for video and the microphone when it asks for audio alone. A word outside the
 * contract's shape (`LiveSurfaceBrowserStateV1.refused.permission`) is `unknown`, never passed through. */
export function browserSurfacePermissionWord(permission: string, details?: unknown): string {
  if (permission === "media") {
    const said =
      typeof details === "object" && details !== null
        ? (details as { readonly mediaTypes?: unknown }).mediaTypes
        : undefined;
    const types = Array.isArray(said) ? said : [];
    if (types.includes("video")) return "camera";
    if (types.includes("audio")) return "microphone";
  }
  return /^[a-z][A-Za-z-]{0,47}$/.test(permission) ? permission : "unknown";
}

/**
 * A profile's stable opaque name — a digest of its mode and ref: profile refs never appear in a path.
 *
 * BP-D6 (thinking-browser-profile.md §3·2, 2026-10-26): a PACKAGED shell's profile has its own name. Fuses are flipped
 * only on the packaged copy (ESP-1), so a packaged shell's cookie store is encrypted (ESP-11) and an unpackaged one's is
 * not, and the fuse's transition is one-way: an unpackaged shell started on the packaged data root would otherwise
 * open — and spoil — the signed build's store. The unpackaged name is the one every profile had before, so a
 * development desk keeps its sites.
 */
export function browserSurfaceProfileName(
  source: Pick<LiveSurfaceBrowserSourceV1, "profile">,
  packaged = false,
): string {
  const hash = createHash("sha256")
    .update(source.profile.mode)
    .update("\0")
    .update(source.profile.ref);
  if (packaged) hash.update("\0packaged");
  return hash.digest("hex").slice(0, 40);
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
    // ESP §7.4: both handlers deny. BP-D1: a REQUEST is also told to the page that asked, for the pane to say once; a
    // CHECK stays silent — Chromium asks checks constantly, and nothing was asked of a person.
    target.setPermissionRequestHandler((contents, permission, callback, details) => {
      callback(false);
      if (typeof contents === "object" && contents !== null) {
        permissionRefusals.get(contents)?.(browserSurfacePermissionWord(permission, details));
      }
    });
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
 * Per-source gates, installed before the first remote load. PT-5a — each answers AT ONCE and tells `refused` (its
 * `detail`: a pop-up's address, or a refused permission's word):
 *  - a pop-up (`window.open`, `target=_blank`) opens no window — its address is told (the pane itself goes there);
 *  - a page that asks to stay on its unload (`beforeunload`) LEAVES — no page blocks behind a dialog nobody sees;
 *  - HTTP auth is cancelled — the page gets its own 401;
 *  - a download the page starts is cancelled by its session's guard, and told here by the contents that asked;
 *  - a permission the page REQUESTS is denied by its session's guard, and told here the same way (BP-D1);
 *  - a certificate the engine does not trust is REFUSED, in a line of code and never by its default alone: no page is
 *    shown over a certificate nobody vouched for (the load fails, and its face says so).
 */
export function installGuardedBrowserSurfaceContents(
  contents: GuardedBrowserSurfaceWebContents,
  refused: (what: BrowserSurfaceGuardRefusal, detail?: string) => void = () => undefined,
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
  contents.on("certificate-error", (event, _url, _error, _certificate, callback) => {
    event.preventDefault();
    callback(false);
  });
  downloadRefusals.set(contents, () => refused("download"));
  permissionRefusals.set(contents, (permission) => refused("permission", permission));
}

export function isGuardedBrowserSurfaceSession(value: object): boolean {
  return guardedBrowserSurfaceSessions.has(value);
}
