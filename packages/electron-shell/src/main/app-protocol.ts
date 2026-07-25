import { createReadStream, realpathSync } from "node:fs";
import { resolve, sep } from "node:path";
import { Readable } from "node:stream";
import { protocol } from "electron";

// The VibeField application scheme (ESP §8.2) — the packaged renderer's OWN
// origin, serving the built bundle out of one directory and nothing else.
//
// This exists to retire `loadFile()`. While the renderer loads from `file:`,
// `GrantFileProtocolExtraPrivileges` has to stay on (§8.3 stage F0/F1), which
// hands every document on that origin the file-protocol privilege set. A
// namespaced standard scheme is what lets the fuse close at F2, and it makes
// CSP `'self'` mean exactly one thing: `vibefield-app://shell`.
//
// The split below is the house pattern (see security-policy.ts / security.ts):
// `resolveAppAsset` is PURE — no Electron, no `node:fs` — so the traversal suite
// can drive every hostile URL directly instead of through a running browser.
// Only `serveAppRequest` touches the filesystem and only `installAppProtocol`
// touches Electron; the one decision the pure resolver cannot make is the
// symlink check, which cannot be answered without asking the disk.

export const APP_SCHEME = "vibefield-app";

/** The ONLY host this scheme serves. A standard scheme has real origins, so a
 * second host would be a second origin — and `'self'` would stop being a single
 * statement about a single directory. */
export const APP_HOST = "shell";

/** What CSP `'self'` resolves to for the packaged renderer. */
export const APP_ORIGIN = `${APP_SCHEME}://${APP_HOST}`;

/** The document the shell loads. Exported so no call site string-builds a URL:
 * a typo'd origin at one call site is a silently different security origin. */
export const APP_ENTRY_URL = `${APP_ORIGIN}/index.html`;

/** Directory requests land here, the way a static server would. */
const INDEX_FILE = "index.html";

/** Privileges declared BEFORE ready (§6.1 step 2 — Electron refuses later), and
 * enumerated in full: the granted and the refused both stated, because a
 * privilege that is merely absent reads as an oversight in review.
 *
 * - `standard` — real origins, relative-URL resolution, and the ES-module
 *   graph. Vite's output is `<script type=module>` plus dynamic `import()`;
 *   a non-standard scheme has an opaque origin and cannot host either.
 * - `secure` — the scheme counts as a secure context, which the renderer needs
 *   for crypto/IndexedDB and which keeps Chromium from treating our own assets
 *   as mixed content.
 * - `supportFetchAPI` — `fetch()` against our own origin. The doc-thumbnail
 *   module Worker is loaded through the fetch stack, and so are its imports.
 * - `stream` — responses with a streamed body, which is how the handler serves
 *   files without buffering a multi-megabyte chunk into main-process memory.
 * - `codeCache` — V8 code cache for the renderer bundle (valid only alongside
 *   `standard`); a pure start-up win, no privilege widening.
 *
 * NOT granted, deliberately: `corsEnabled` (this origin answers no cross-origin
 * caller — §8.2 forbids arbitrary CORS), `bypassCSP` (the production CSP applies
 * to our own documents like anyone else's), `allowServiceWorkers` (a worker
 * outliving the document is persistence we have not designed), `allowExtensions`.
 * None of these grants filesystem access: the scheme reads only what
 * `resolveAppAsset` admits, which is one directory. */
export const APP_SCHEME_PRIVILEGES = {
  standard: true,
  secure: true,
  supportFetchAPI: true,
  stream: true,
  codeCache: true,
  bypassCSP: false,
  corsEnabled: false,
  allowServiceWorkers: false,
  allowExtensions: false,
} as const;

/** Must be called before `app.whenReady()` (§6.1). */
export function registerAppScheme(): void {
  protocol.registerSchemesAsPrivileged([
    { scheme: APP_SCHEME, privileges: { ...APP_SCHEME_PRIVILEGES } },
  ]);
}

/** Every way a request can be refused. Named classes, not a boolean: the
 * refusal reason is evidence — it says which attack shape arrived — while the
 * response the renderer sees is the same 404 for all of them. */
export type AppAssetRefusal =
  | "malformed-url"
  | "unsupported-scheme"
  | "credentials-in-url"
  | "unknown-host"
  | "bad-encoding"
  | "double-encoded"
  | "nul-byte"
  | "control-character"
  | "backslash"
  | "path-traversal"
  | "embedded-separator"
  | "drive-letter"
  | "unc-path"
  | "non-canonical-path"
  | "escapes-root";

export type AppAssetResolution =
  | { readonly ok: true; readonly path: string; readonly mime: string }
  | { readonly ok: false; readonly reason: AppAssetRefusal };

const refuse = (reason: AppAssetRefusal): AppAssetResolution => ({ ok: false, reason });

/** Explicit types by extension — never sniffed. Sniffing is how a file that is
 * bytes-of-HTML gets executed as a document, and `nosniff` on the response is
 * only honest if the type we assert is the one we chose. `charset=utf-8` is
 * part of the answer for text: an unstated charset leaves Chromium detecting
 * one, which is the old UTF-7 injection road. Anything not listed is
 * deliberately inert (`application/octet-stream`). */
const MIME_BY_EXTENSION: Readonly<Record<string, string>> = {
  html: "text/html; charset=utf-8",
  js: "text/javascript; charset=utf-8",
  mjs: "text/javascript; charset=utf-8",
  css: "text/css; charset=utf-8",
  json: "application/json; charset=utf-8",
  // source maps are JSON, and DevTools fetches them like any other asset
  map: "application/json; charset=utf-8",
  txt: "text/plain; charset=utf-8",
  wasm: "application/wasm",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  avif: "image/avif",
  ico: "image/x-icon",
  // SVG is a document format: it renders as an <img> source but never as a
  // top-level document here, because navigation is denied outright (§7.3).
  svg: "image/svg+xml",
  woff: "font/woff",
  woff2: "font/woff2",
  ttf: "font/ttf",
  otf: "font/otf",
};

const DEFAULT_MIME = "application/octet-stream";

/** A leading dot is a dotfile, not an extension; the LAST dot wins, so
 * `evil.html.png` is a PNG and `evil.png.js` is script — the same answer
 * Chromium's own extension mapping gives, and one that never consults bytes. */
export function mimeForPath(path: string): string {
  const name = path.slice(path.lastIndexOf(sep) + 1);
  const dot = name.lastIndexOf(".");
  if (dot <= 0) return DEFAULT_MIME;
  return MIME_BY_EXTENSION[name.slice(dot + 1).toLowerCase()] ?? DEFAULT_MIME;
}

/** Containment, and the reason it is its own function: `startsWith(root)` is
 * the bug. Root `/a/app` "contains" `/a/app-evil/x` under a naive prefix test,
 * so the comparison is made against `root + separator`. Equality is refused
 * too — the root directory is not an asset. Also used by the symlink check,
 * where the two paths have been through `realpath` first. */
export function isStrictlyBeneath(root: string, candidate: string): boolean {
  const base = resolve(root);
  const target = resolve(candidate);
  if (target === base) return false;
  return target.startsWith(base.endsWith(sep) ? base : base + sep);
}

/** A Windows drive letter (`C:`) — and any other colon, which on NTFS names an
 * alternate data stream (`index.html:evil`). Neither is a built asset name. */
const WINDOWS_PATH_SYNTAX = /:/;

/** Dot-dot in the request AS WRITTEN, and the encoded dot that hides it.
 *
 * Both `new URL` and Chromium's canonicalizer resolve dot segments before this
 * module ever sees a path — `/../secret` arrives already clamped to `/secret`,
 * and `%2e%2e` is spelled out in the URL standard as a double-dot segment, so it
 * clamps too. Serving the clamped result would be safe and silent. We refuse
 * instead, because silence is the problem: our renderer resolves every URL
 * against the document before it asks, so a request that still contains `..` or
 * an encoded dot did not come from our renderer, and that is worth an entry in
 * the evidence rather than a 200. */
const RAW_TRAVERSAL = /\.\.|%2e/i;

/** C0/C1 controls and DEL. A newline in a filename is a log-forging trick and
 * nothing a bundler emits. */
// biome-ignore lint/suspicious/noControlCharactersInRegex: refusing them is the point
const CONTROL_CHARACTER = /[\u0000-\u001f\u007f-\u009f]/;

/**
 * Resolve a request URL to a file beneath `root`, or say why not.
 *
 * PURE by construction — it answers from the URL alone, so the suite can drive
 * every hostile shape at it without a disk or a browser. Whether the file
 * exists, and whether it is a symlink pointing somewhere else, are questions
 * only `serveAppRequest` can ask.
 */
export function resolveAppAsset(root: string, requestUrl: string): AppAssetResolution {
  let url: URL;
  try {
    url = new URL(requestUrl);
  } catch {
    return refuse("malformed-url");
  }

  if (url.protocol !== `${APP_SCHEME}:`) return refuse("unsupported-scheme");
  // Credentials in a URL are a spoofing shape (`vibefield-app://shell@evil/`
  // reads as our host to a human), never a way to fetch an asset.
  if (url.username !== "" || url.password !== "") return refuse("credentials-in-url");
  // `host`, not `hostname`: a port makes a different authority, and this scheme
  // has none. Lower-cased to match how Chromium normalizes a registered
  // standard host — the resolver must not be MORE permissive than production,
  // and matching it exactly keeps the two from disagreeing about origin.
  if (url.host.toLowerCase() !== APP_HOST) return refuse("unknown-host");
  if (RAW_TRAVERSAL.test(requestUrl)) return refuse("path-traversal");

  // Split BEFORE decoding, and decode each segment exactly once.
  //
  // The order is the whole defence. Decoding the path first and splitting after
  // lets `%2F` MANUFACTURE a separator — `/x%2F..%2F..%2Fetc` becomes a real
  // three-segment path that the `..` check then has to catch on the rebound.
  // Splitting first means an encoded separator can only ever land INSIDE one
  // segment, where it is refused outright.
  //
  // And exactly once: a second decode is itself a traversal vector. `%252e%252e`
  // survives one decode as the literal text `%2e%2e`, and any code that decodes
  // again turns it into `..`. So a `%` that is still present after our single
  // decode means someone encoded an encoding — refused, since no bundler emits
  // a filename containing a literal percent sign.
  const rawSegments = url.pathname.split("/");
  const leading = rawSegments.shift();
  if (leading !== undefined && leading !== "") return refuse("non-canonical-path");
  // A second empty leading segment is `//server/share` — a UNC path, which on
  // Windows names a remote host rather than a place under our root.
  if (rawSegments.length > 1 && rawSegments[0] === "") return refuse("unc-path");

  // `/`, `` and `/assets/` are directory requests; a static server answers them
  // with the index. An EXTENSIONLESS name is not one of these — `/LICENSE` is a
  // file request that will simply 404 if it is absent.
  const directoryish = rawSegments.length === 0 || rawSegments[rawSegments.length - 1] === "";
  if (directoryish) rawSegments.pop();

  const segments: string[] = [];
  for (const raw of rawSegments) {
    // an interior empty segment (`/assets//main.js`) is a path that does not
    // round-trip; non-canonical input is where normalization bugs hide
    if (raw === "") return refuse("non-canonical-path");

    let decoded: string;
    try {
      decoded = decodeURIComponent(raw);
    } catch {
      // a truncated escape (`%2`, `%zz`) — malformed, not merely unknown
      return refuse("bad-encoding");
    }

    if (decoded.includes("%")) return refuse("double-encoded");
    // `%00` truncates a path at the C layer: `index.html%00.png` passes an
    // extension check and opens `index.html`.
    if (decoded.includes("\0")) return refuse("nul-byte");
    if (CONTROL_CHARACTER.test(decoded)) return refuse("control-character");
    // Windows treats `\` as a separator; anything reasoning in `/` alone reads
    // `..\..\` as an ordinary filename.
    if (decoded.includes("\\")) return refuse("backslash");
    // Dot segments a level lower than RAW_TRAVERSAL, catching what any future
    // caller that hands us an already-decoded path would smuggle past it. The
    // substring, not the exact segment: exact-match dot-dot checks are the ones
    // that historically fall to a wrapper like `....//`, and no built asset name
    // contains a double dot, so refusing all of them costs nothing.
    if (decoded.includes("..")) return refuse("path-traversal");
    // an encoded separator that survived to here — the smuggled absolute path
    if (decoded.includes("/")) return refuse("embedded-separator");
    if (decoded === ".") return refuse("non-canonical-path");
    if (WINDOWS_PATH_SYNTAX.test(decoded)) return refuse("drive-letter");

    segments.push(decoded);
  }

  if (directoryish) segments.push(INDEX_FILE);

  const base = resolve(root);
  const path = resolve(base, ...segments);
  // Defence in depth: no validated segment can climb, so this can only fire if
  // one of the checks above is ever weakened. It is cheap, and it is the last
  // thing standing between a resolver bug and the user's home directory.
  if (!isStrictlyBeneath(base, path)) return refuse("escapes-root");

  return { ok: true, path, mime: mimeForPath(path) };
}

/** Refusals the handler can only reach with the filesystem's help. */
export type AppServeRefusal = AppAssetRefusal | "missing-file" | "symlink-escape";

export interface AppProtocolOptions {
  /** The built renderer directory. Everything served lives strictly beneath it. */
  readonly root: string;
  /** The production CSP, emitted on every response. Belt and braces with the
   * session's `onHeadersReceived` policy: whichever path Chromium applies to a
   * custom-scheme response, the document gets the policy. */
  readonly csp?: string;
  /** Evidence hook. The URL is attacker-influenced text — a caller that logs it
   * owns escaping it. */
  readonly onRefusal?: (reason: AppServeRefusal, requestUrl: string) => void;
  /** Seams for the suite. Production reads the real disk. */
  readonly realpath?: (path: string) => string;
  readonly openStream?: (path: string) => ReadableStream<Uint8Array>;
}

const SECURITY_HEADERS: Readonly<Record<string, string>> = {
  // The response half of "never sniff" — our declared type is the only type.
  "X-Content-Type-Options": "nosniff",
  // Our bytes are for our own documents; no other origin may embed them.
  "Cross-Origin-Resource-Policy": "same-origin",
  "Referrer-Policy": "no-referrer",
};

/** One refusal response for every reason. A distinguishable 403 would tell a
 * compromised renderer which paths exist and which of its probes was merely
 * malformed; the reason goes to evidence instead. */
function refusalResponse(): Response {
  return new Response("Not Found", {
    status: 404,
    headers: { ...SECURITY_HEADERS, "Content-Type": "text/plain; charset=utf-8" },
  });
}

const defaultStream = (path: string): ReadableStream<Uint8Array> =>
  // Streamed, not buffered: the renderer bundle is megabytes and this runs on
  // the main-process thread. The cast is the node/web stream-type seam.
  Readable.toWeb(createReadStream(path)) as unknown as ReadableStream<Uint8Array>;

/**
 * Answer one request. Exported for the suite, which drives it with injected
 * filesystem seams; `installAppProtocol` is the only production caller.
 */
export function serveAppRequest(requestUrl: string, options: AppProtocolOptions): Response {
  const resolution = resolveAppAsset(options.root, requestUrl);
  if (!resolution.ok) {
    options.onRefusal?.(resolution.reason, requestUrl);
    return refusalResponse();
  }

  const realpath = options.realpath ?? realpathSync;
  let realRoot: string;
  let realPath: string;
  try {
    // Resolved fresh per request rather than memoized at install: the root is
    // what we are proving containment against, so reading it once and trusting
    // it forever would answer with yesterday's filesystem.
    realRoot = realpath(options.root);
    // Doubles as the existence check §8.2 asks for — realpath on an absent
    // path throws, so a missing file never reaches the read.
    realPath = realpath(resolution.path);
  } catch {
    options.onRefusal?.("missing-file", requestUrl);
    return refusalResponse();
  }

  // The one check the pure resolver cannot make. Every path it returns is
  // beneath the root by construction, but a SYMLINK beneath the root can point
  // anywhere on the disk — `dist/renderer/notes.js -> ~/.ssh/id_ed25519` — and
  // a same-uid process (EL7's adversary) is assumed able to plant one.
  if (!isStrictlyBeneath(realRoot, realPath)) {
    options.onRefusal?.("symlink-escape", requestUrl);
    return refusalResponse();
  }

  const body = (options.openStream ?? defaultStream)(realPath);
  return new Response(body, {
    status: 200,
    headers: {
      ...SECURITY_HEADERS,
      "Content-Type": resolution.mime,
      ...(options.csp === undefined ? {} : { "Content-Security-Policy": options.csp }),
    },
  });
}

/**
 * Wire the scheme into Electron (§6.2 step 3 — after ready, before the first
 * renderer request).
 *
 * This handler serves files from one directory. It does NOT proxy URLs, take a
 * path from the renderer, or expose a general filesystem protocol — the two
 * shapes §8.2 names outright, and the reason a `plugin://<id>/<path>` resolver
 * must never be modelled on this one (§8.4: plugin bytes come from a fieldd
 * generation-bound mapping, not from joining a path onto an ID we were handed).
 */
export function installAppProtocol(options: AppProtocolOptions): void {
  protocol.handle(APP_SCHEME, (request) => serveAppRequest(request.url, options));
}
