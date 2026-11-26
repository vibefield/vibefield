// EY-1 (2026-11-19) — CLEANED EVENTS: which CDP events a client may see, and in what form (track EY;
// draft/tool-plane/browser-use.md §4.2 "what it sees", BU:431-439). Ported whole from the lab's pure events.js. Every
// rule applies per child session by the class of the page that owns it: the caller passes that page's class, never
// the child's.
//
// The own signed-out page keeps every event, held or not (BU-9: its console records while the person reproduces a
// bug by hand), but one (2026-11-24): a binding's call (`Runtime.bindingCalled`) is dropped while the page is held,
// on either class. A binding is the injected script's own line to its client, and the journal takes it off the page
// at the pick-up; the drop holds from the hold's own instant, and when the page refuses the removal. It is not a
// promise that the agent stops seeing its own page: the console is still said, and a script the agent already ran in
// the page stays in it.
//
// The signed-in page loses all of them while held (dropped, never queued), loses every *ExtraInfo event,
// and the rest are rebuilt without bodies, with headers by an allowlist and with query values redacted (every host of
// this class: signInHostFor). The input event is never mutated: one event fans out to every subscriber, so a cleaned
// copy is built for each. With one second session per client, `isClients` is the router's gate: an event of another client's
// session is never this client's.
//
// Pure.

import {
  type CdpCall,
  type CdpEvent,
  type CdpParams,
  type CleanContext,
  type CleanedEvent,
  type PageClass,
  TRACE_CATEGORIES,
} from "./types";

/** "headers by a short allowlist"; lowercase, matched case-insensitively. */
export const HEADER_ALLOWLIST: ReadonlySet<string> = Object.freeze(
  new Set([
    "accept",
    "accept-language",
    "cache-control",
    "content-encoding",
    "content-language",
    "content-length",
    "content-type",
    "etag",
    "last-modified",
    "pragma",
    "vary",
  ]),
);

/** Named in the contract; cleanEvent drops every method ending "ExtraInfo" on the signed-in class, so a later
 * Chromium's new ExtraInfo event is covered without an edit here. */
export const DROPPED_ALWAYS_SIGNED_IN: ReadonlySet<string> = Object.freeze(
  new Set(["Network.requestWillBeSentExtraInfo", "Network.responseReceivedExtraInfo"]),
);

/** Request body fields (requestWillBeSent's and Fetch.requestPaused's `request`), stripped at any depth. */
const BODY_KEYS: ReadonlySet<string> = new Set(["postData", "postDataEntries", "hasPostData"]);

/** Raw header text carries Cookie and Authorization verbatim (headersText, requestHeadersText, the WebSocket
 * handshake), so it is dropped, never filtered. Audits.issueAdded's `rawCookieLine` is the raw Set-Cookie of a cookie
 * that did not parse: a cookie value, dropped the same way. */
const RAW_HEADER_TEXT_KEYS: ReadonlySet<string> = new Set([
  "headersText",
  "requestHeadersText",
  "rawCookieLine",
]);

/** Header containers: an object map (Network.Headers) or Fetch's array of { name, value }. */
const HEADER_KEYS: ReadonlySet<string> = new Set(["headers", "requestHeaders", "responseHeaders"]);

/** WebSocket frame payloads (webSocketFrameSent / webSocketFrameReceived: `response.payloadData`). */
const PAYLOAD_KEYS: ReadonlySet<string> = new Set(["payloadData"]);

/** URL-bearing keys, at any depth. Any other key ending in Url, URL or URI (cookieUrl, insecureURL, blockedURL,
 * scriptURI, and whatever a later protocol adds) is matched by URL_KEY_SUFFIX. */
export const URL_KEYS: ReadonlySet<string> = Object.freeze(
  new Set(["url", "documentURL", "unreachableUrl", "baseURL", "sourceMapURL"]),
);
const URL_KEY_SUFFIX = /ur[li]$/iu;

/** Response content outside the network log's bodies: a Server-Sent Event's `data`, stripped by method because
 * `data` is too generic a key for PAYLOAD_KEYS. */
const PAYLOAD_BY_METHOD: Readonly<Record<string, string>> = Object.freeze({
  "Network.eventSourceMessageReceived": "data",
});

/** The fragment rides beside the URL in Network.Request and Page.Frame; redactQuery removes the fragment, so its
 * sibling goes too when the URL is on a sign-in host. */
const FRAGMENT_KEYS: ReadonlySet<string> = new Set(["urlFragment"]);

const MAX_DEPTH = 64;

const TRACE_SET: ReadonlySet<string> = new Set(TRACE_CATEGORIES);

export function cleanEvent(event: CdpEvent, ctx: CleanContext): CleanedEvent {
  if (event === null || typeof event !== "object" || typeof event.method !== "string") {
    throw new TypeError("cleanEvent: an event needs a string method");
  }
  if (ctx === null || typeof ctx !== "object") throw new TypeError("cleanEvent: ctx is required");
  if (typeof ctx.isClients === "function" && !ctx.isClients(event.sessionId)) {
    return { action: "drop", reason: "not-the-clients" };
  }
  // a binding's call says nothing while the person holds the page, whatever its class (2026-11-24)
  if (ctx.held === true && event.method === "Runtime.bindingCalled") {
    return { action: "drop", reason: "held" };
  }
  if (ctx.pageClass === "own") return { action: "forward", event };
  if (ctx.pageClass !== "signed-in") throw new TypeError("cleanEvent: unknown page class");
  if (ctx.held === true) return { action: "drop", reason: "held" };
  if (DROPPED_ALWAYS_SIGNED_IN.has(event.method) || event.method.endsWith("ExtraInfo")) {
    return { action: "drop", reason: "extra-info" };
  }
  const signInHost = typeof ctx.signInHost === "function" ? ctx.signInHost : () => false;
  let params: unknown = event.params ?? {};
  const payload = PAYLOAD_BY_METHOD[event.method];
  if (
    payload !== undefined &&
    params !== null &&
    typeof params === "object" &&
    Object.hasOwn(params, payload)
  ) {
    params = { ...params, [payload]: "" };
  }
  const cleaned: CdpEvent = {
    method: event.method,
    params: cleanValue(params, signInHost, 0) as CdpParams,
    ...(event.sessionId !== undefined ? { sessionId: event.sessionId } : {}),
  };
  return { action: "forward", event: cleaned };
}

/** A new value: objects and arrays are rebuilt, never shared with the input. */
function cleanValue(value: unknown, signInHost: (host: string) => boolean, depth: number): unknown {
  if (value === null || typeof value !== "object") return value;
  if (depth > MAX_DEPTH) return "[depth-limit]";
  if (Array.isArray(value)) return value.map((item) => cleanValue(item, signInHost, depth + 1));
  const object = value as Record<string, unknown>;
  const redactSiblings = urlOnSignInHost(object, signInHost);
  const out: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(object)) {
    if (BODY_KEYS.has(key) || RAW_HEADER_TEXT_KEYS.has(key) || PAYLOAD_KEYS.has(key)) continue;
    if (FRAGMENT_KEYS.has(key) && redactSiblings) continue;
    if (HEADER_KEYS.has(key)) {
      out[key] = filterHeaders(child);
      continue;
    }
    if (typeof child === "string" && (URL_KEYS.has(key) || URL_KEY_SUFFIX.test(key))) {
      out[key] = cleanUrl(child, signInHost);
      continue;
    }
    out[key] = cleanValue(child, signInHost, depth + 1);
  }
  return out;
}

function urlOnSignInHost(
  object: Record<string, unknown>,
  signInHost: (host: string) => boolean,
): boolean {
  if (typeof object.url !== "string") return false;
  const host = hostOf(object.url);
  return host === null ? object.url.length > 0 : signInHost(host) === true;
}

/** Redacted when the host is a sign-in host. A value that does not parse as a URL cannot be placed, so it is treated
 * as a sign-in URL (redactQuery makes it "[unparseable-url]"); "" stays "". */
function cleanUrl(url: string, signInHost: (host: string) => boolean): string {
  if (url.length === 0) return url;
  const host = hostOf(url);
  if (host === null) return redactQuery(url);
  return signInHost(host) === true ? redactQuery(url) : url;
}

function hostOf(url: string): string | null {
  try {
    return new URL(url).hostname;
  } catch {
    return null;
  }
}

/** Network.Headers is an object map; Fetch's request and response headers are arrays of { name, value }. */
function filterHeaders(headers: unknown): unknown {
  if (Array.isArray(headers)) {
    return headers
      .filter(
        (entry): entry is { name: unknown; value: unknown } =>
          entry !== null && typeof entry === "object" && allowedHeader(entry.name),
      )
      .map((entry) => ({ name: entry.name, value: entry.value }));
  }
  if (headers === null || typeof headers !== "object") return {};
  const out: Record<string, unknown> = {};
  for (const [name, value] of Object.entries(headers)) {
    if (allowedHeader(name)) out[name] = value;
  }
  return out;
}

function allowedHeader(name: unknown): boolean {
  return typeof name === "string" && HEADER_ALLOWLIST.has(name.toLowerCase());
}

/** The hosts whose query values and fragments are redacted. The signed-in class: EVERY host. The desk profile holds
 * credentials and capability URLs for many registrable domains (a `?jwt=` on a CDN, an S3 `X-Amz-Signature`, an
 * IdP's `#access_token=`), so the page's own site alone would leave them whole. The own class: none. Keys stay as
 * written, so a diagnosis still shows host, path and parameter names. */
export function signInHostFor(pageClass: PageClass): (host: string) => boolean {
  if (pageClass !== "signed-in") return () => false;
  return () => true;
}

/** A held signed-in page's target metadata (BU-9): no events while the person holds it, dropped, never queued. The
 * bridge answers Target.getTargets, getTargetInfo and attachToTarget, and sends targetInfoChanged and a child's
 * attachedToTarget, from the live page; held, those would hand the engine every navigation and title the person makes.
 * So while held nothing is sent (one current targetInfoChanged follows the put-down, never the queue), and
 * `targetInfoView` answers with `frozen`, the info as it read at pick-up (blank title and url when there is none). The
 * own class is never affected. */
export function targetEventAllowed(s: {
  readonly pageClass: PageClass;
  readonly held: boolean;
}): boolean {
  return !(s.pageClass === "signed-in" && s.held === true);
}

export function targetInfoView<T extends { readonly title: string; readonly url: string }>(v: {
  readonly pageClass: PageClass;
  readonly held: boolean;
  readonly live: T;
  readonly frozen?: { readonly title?: string; readonly url?: string } | null;
}): T {
  if (targetEventAllowed(v)) return v.live;
  const frozen = v.frozen ?? null;
  if (frozen !== null && typeof frozen === "object") {
    return { ...v.live, title: frozen.title ?? "", url: frozen.url ?? "" };
  }
  return { ...v.live, title: "", url: "" };
}

/** The command rewrite. A signed-in Network.enable is sent with maxPostDataSize 0 (the buffer sizes as sent); bodies
 * are stripped from events anyway. Tracing.start, either class, records only TRACE_CATEGORIES (policy has already
 * refused its other doors): a named category outside them is dropped, and a trace that names none (the engine's
 * `trace start`, which Chromium reads as every default category, browser-process ones included) gets the whole list.
 * Returns a new call; never mutates the input. */
export function rewriteCommand(call: CdpCall, ctx: { readonly pageClass: PageClass }): CdpCall {
  if (call === null || typeof call !== "object" || typeof call.method !== "string") {
    throw new TypeError("rewriteCommand: a command needs a string method");
  }
  if (ctx?.pageClass !== "own" && ctx?.pageClass !== "signed-in") {
    throw new TypeError("rewriteCommand: unknown page class");
  }
  const params: CdpParams = call.params ?? {};
  if (ctx.pageClass === "signed-in" && call.method === "Network.enable") {
    return { method: call.method, params: { ...params, maxPostDataSize: 0 } };
  }
  if (call.method === "Tracing.start") return { method: call.method, params: traceParams(params) };
  return { method: call.method, params };
}

/** Only the traceConfig keys the engine and Puppeteer send are kept; the rest (memoryDumpConfig, syntheticDelays,
 * enableSystrace) are not forwarded. */
const TRACE_CONFIG_KEYS = [
  "recordMode",
  "traceBufferSizeInKb",
  "enableSampling",
  "excludedCategories",
] as const;
const TRACE_TOP_KEYS = [
  "transferMode",
  "streamFormat",
  "streamCompression",
  "bufferUsageReportingInterval",
] as const;

function traceParams(params: CdpParams): CdpParams {
  const tc =
    params.traceConfig !== null && typeof params.traceConfig === "object"
      ? (params.traceConfig as Record<string, unknown>)
      : {};
  const config: Record<string, unknown> = {};
  for (const key of TRACE_CONFIG_KEYS) if (tc[key] !== undefined) config[key] = tc[key];
  const named: unknown[] = Array.isArray(tc.includedCategories) ? tc.includedCategories : [];
  const kept = named.filter((c): c is string => typeof c === "string" && TRACE_SET.has(c));
  config.includedCategories = kept.length > 0 ? [...new Set(kept)] : [...TRACE_CATEGORIES];
  const out: Record<string, unknown> = {};
  for (const key of TRACE_TOP_KEYS) if (params[key] !== undefined) out[key] = params[key];
  out.traceConfig = config;
  return out;
}

/** Each query value becomes "_" (keys kept, in order, as written), the fragment is removed, and a username or password
 * in the authority becomes "_". An unparseable URL becomes "[unparseable-url]". A bare piece (no "=") is replaced by
 * "_" whole: a token sent as `?SECRET` is a value, not a key. */
export function redactQuery(url: string): string {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return "[unparseable-url]";
  }
  if (parsed.username !== "") parsed.username = "_";
  if (parsed.password !== "") parsed.password = "_";
  if (parsed.search.length > 1) {
    const pieces = parsed.search
      .slice(1)
      .split("&")
      .map((piece) => {
        const at = piece.indexOf("=");
        if (at === -1) return piece === "" ? piece : "_";
        return `${piece.slice(0, at)}=_`;
      });
    parsed.search = `?${pieces.join("&")}`;
  }
  parsed.hash = "";
  // A bare "#" or "?" survives the setters on some inputs; the serialisation never carries a fragment.
  const href = parsed.href;
  const hashAt = href.indexOf("#");
  return hashAt === -1 ? href : href.slice(0, hashAt);
}
