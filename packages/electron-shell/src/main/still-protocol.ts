import { createReadStream, realpathSync } from "node:fs";
import { dirname, join } from "node:path";
import { Readable } from "node:stream";
import {
  SCREENSHOT_STILL_HOST,
  SCREENSHOT_STILL_ORIGIN,
  SCREENSHOT_STILL_SCHEME,
  screenshotStillBasename,
  screenshotStillUrl,
} from "@vibefield/contracts";
import { protocol } from "electron";

// The still scheme (SNAP-3) — how a screenshot's bytes reach the page.
//
// The native helper writes a PNG under the OS temp directory and main retains
// the last few paths (SNAP-D4's ring). The renderer's CSP admits no file
// access and EL2 keeps bytes off JSON-RPC, so SNAP-D4 left exactly two ways
// for a still to reach the canvas: an artifact through the Hub, or a
// shell-owned scheme. A clipboard chip is not an artifact; this is the scheme.
//
// It serves ONE thing: a retained still, named by its basename. The request
// carries no path — a basename is matched against the tool's own retained
// list and the path that answers is the tool's, never the renderer's. Nothing
// else on the disk is reachable through it, and a still the ring has unlinked
// stops answering the moment it leaves the list.
//
// The split is the house pattern (app-protocol.ts): `resolveStill` is PURE so
// the suite can drive every hostile URL without Electron; `serveStillRequest`
// alone touches the disk; `installStillProtocol` alone touches Electron. The
// scheme's registration joins `shellSchemeRegistrations()` — the ONE
// `registerSchemesAsPrivileged` call (the P8b-2 law).

export const STILL_SCHEME = SCREENSHOT_STILL_SCHEME;
export const STILL_HOST = SCREENSHOT_STILL_HOST;
export const STILL_ORIGIN = SCREENSHOT_STILL_ORIGIN;
export { screenshotStillUrl as stillUrl };

/** Declared before ready with the other shell schemes. `standard` so the URL
 * has a real origin and `<img>` resolves it like any other; `secure` so the
 * app document — a secure context — may embed it without a mixed-content
 * refusal; `stream` so a multi-megabyte still is never buffered in main.
 * `supportFetchAPI` is NOT granted: a tile is an `<img>`, and a page that could
 * `fetch()` a still could read its bytes into script — nothing here needs
 * that. No CORS, no CSP bypass, no service workers, no extensions, no code
 * cache: there is no code on this origin. */
export const STILL_SCHEME_PRIVILEGES = {
  standard: true,
  secure: true,
  supportFetchAPI: false,
  stream: true,
  codeCache: false,
  bypassCSP: false,
  corsEnabled: false,
  allowServiceWorkers: false,
  allowExtensions: false,
} as const;

export type StillRefusal =
  /** not `vibefield-still://stills/<basename>`: a wrong scheme or host, a
   * query, more than one path segment, a separator or `..` in the name, or a
   * name that is not a PNG */
  | "bad-url"
  /** a well-formed name the tool does not (or no longer) retain */
  | "not-retained"
  /** retained, but gone from the disk (the ring unlinked it under us) */
  | "missing-file"
  /** retained, but the final path component no longer resolves to itself —
   * a symlink planted where the helper wrote a file (EL7's adversary) */
  | "not-a-file";

export type StillResolution =
  | { readonly ok: true; readonly path: string; readonly name: string }
  | { readonly ok: false; readonly reason: StillRefusal };

const bad: StillResolution = { ok: false, reason: "bad-url" };

/**
 * PURE — the request names a still by its basename; the answer is the retained
 * path that carries that basename, or a refusal. No filesystem, no Electron.
 */
export function resolveStill(requestUrl: string, retained: readonly string[]): StillResolution {
  let url: URL;
  try {
    url = new URL(requestUrl);
  } catch {
    return bad;
  }
  if (url.protocol !== `${STILL_SCHEME}:` || url.host !== STILL_HOST) return bad;
  if (url.search !== "") return bad;
  const segments = url.pathname.split("/");
  if (segments.length !== 2 || segments[1] === undefined || segments[1] === "") return bad;
  let name: string;
  try {
    name = decodeURIComponent(segments[1]);
  } catch {
    return bad;
  }
  if (name.includes("/") || name.includes("\\") || name.includes("\0")) return bad;
  if (name === "." || name === "..") return bad;
  if (!/\.png$/i.test(name)) return bad;
  const path = retained.find((candidate) => screenshotStillBasename(candidate) === name);
  if (path === undefined) return { ok: false, reason: "not-retained" };
  return { ok: true, path, name };
}

export interface StillProtocolOptions {
  /** The tool's retained stills, read at REQUEST time — the ring moves. */
  readonly retained: () => readonly string[];
  /** Evidence hook. The URL is attacker-influenced text; a logger owns escaping it. */
  readonly onRefusal?: (reason: StillRefusal, requestUrl: string) => void;
  /** Seams for the suite. Production reads the real disk. */
  readonly realpath?: (path: string) => string;
  readonly openStream?: (path: string) => ReadableStream<Uint8Array>;
}

const SECURITY_HEADERS: Readonly<Record<string, string>> = {
  // Our declared type is the only type.
  "X-Content-Type-Options": "nosniff",
  // The app document is CROSS-origin to this scheme by construction (a standard
  // scheme is its own origin), and it is the one reader these bytes exist for;
  // `same-origin` would refuse the very `<img>` that shows the still. The bytes
  // are the user's own screenshot, served only while the tool retains it.
  "Cross-Origin-Resource-Policy": "cross-origin",
  "Referrer-Policy": "no-referrer",
  // A still leaves the ring; a cached copy must not outlive it.
  "Cache-Control": "no-store",
};

/** One refusal response for every reason (a distinguishable 403 would tell a
 * compromised renderer which names exist); the reason goes to evidence. */
function refusalResponse(): Response {
  return new Response("Not Found", {
    status: 404,
    headers: { ...SECURITY_HEADERS, "Content-Type": "text/plain; charset=utf-8" },
  });
}

const defaultStream = (path: string): ReadableStream<Uint8Array> =>
  Readable.toWeb(createReadStream(path)) as unknown as ReadableStream<Uint8Array>;

/**
 * Resolve one retained still with the same filesystem authority for both the
 * image protocol and native preview. Filesystem seams are injectable in tests.
 */
export function resolveStillFile(
  requestUrl: string,
  options: Pick<StillProtocolOptions, "retained" | "realpath">,
): StillResolution {
  const resolution = resolveStill(requestUrl, options.retained());
  if (!resolution.ok) return resolution;
  const realpath = options.realpath ?? realpathSync;
  let realFile: string;
  let realDir: string;
  try {
    realFile = realpath(resolution.path);
    realDir = realpath(dirname(resolution.path));
  } catch {
    return { ok: false, reason: "missing-file" };
  }
  // The helper wrote a regular file at this path. If the FINAL component now
  // resolves elsewhere, something replaced it with a symlink between the write
  // and this read — a same-uid process (EL7's adversary) is assumed able to.
  // The directory chain may resolve freely: macOS's own temp directory sits
  // under `/var`, which is itself a symlink to `/private/var`.
  if (realFile !== join(realDir, resolution.name)) {
    return { ok: false, reason: "not-a-file" };
  }
  return { ...resolution, path: realFile };
}

export function serveStillRequest(requestUrl: string, options: StillProtocolOptions): Response {
  const resolution = resolveStillFile(requestUrl, options);
  if (!resolution.ok) {
    options.onRefusal?.(resolution.reason, requestUrl);
    return refusalResponse();
  }
  const body = (options.openStream ?? defaultStream)(resolution.path);
  return new Response(body, {
    status: 200,
    headers: { ...SECURITY_HEADERS, "Content-Type": "image/png" },
  });
}

/** Wire the scheme into Electron — after ready, in EVERY mode: dev serves the
 * renderer from Vite, but a still comes from the tool in dev too. */
export function installStillProtocol(options: StillProtocolOptions): void {
  protocol.handle(STILL_SCHEME, (request) => serveStillRequest(request.url, options));
}
