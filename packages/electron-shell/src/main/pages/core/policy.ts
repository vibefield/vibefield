// EY-1 (2026-11-19): WHAT may pass the bridge, per CDP message, by page class and session kind
// (browser-use §4.2–§4.3, SITTINGS §4). Methods, not domains: the spike passed fourteen whole
// domains, so the cookie jar, file reads and request interception were reachable through it.
//
// Where the allowlist starts: Chrome's policy for an UNTRUSTED page-scoped client
// (`chrome.debugger`): auto-attach-only `Target`, no `Browser` but the version, no local file reads
// or writes, URL checks per navigation. Electron's debugger client is a TRUSTED one
// (`IsTrusted() = true`), so none of that is enforced below us; it is enforced here. Then it is
// narrowed per class: the agent's own signed-out page, and a page with your sign-ins.
// `OWN_ALLOWED` holds what the pinned engine sends, what Puppeteer sends at connect, and read-only
// diagnostics, as sitting 2 measured them; a method outside it is refused, so it grows by evidence.
//
// This is the METHOD layer: the broker runs the checked JSON command, never argv. Time (the read
// and act windows) and state (the journal) are the other cores. `classify` says whether a call is
// a mutation, a still or script, and the windows decide whether this window takes it. Script is
// judged by exact source against the pin's record, through the context's matcher.

import type { PagesScriptMethod } from "@vibefield/contracts";
import {
  BRIDGE_OK,
  type BridgePage,
  type BridgeRefusalCode,
  type BridgeVerdict,
  type JournalKind,
  type MethodDecision,
  type MethodQuestion,
  PAGE_CLASSES,
  type PageClass,
  type PolicyContext,
  type ScriptFacts,
  type SessionKind,
} from "./types";

// ---- small helpers ----

/** A Set that refuses mutation: Object.freeze alone does not stop Set.prototype.add. */
function readOnlySet(items: readonly string[]): ReadonlySet<string> {
  const set = new Set(items);
  const deny = (): never => {
    throw new TypeError("policy sets are read-only");
  };
  Object.defineProperties(set, {
    add: { value: deny },
    delete: { value: deny },
    clear: { value: deny },
  });
  return Object.freeze(set);
}

function refuse(code: BridgeRefusalCode, reason: string): BridgeVerdict {
  return { ok: false, code, reason };
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/** A pattern entry: an exact method, `Domain.*`, `*.suffix`, or `Domain.prefix*`. */
function compilePattern(pattern: string): RegExp {
  const escaped = pattern.replace(/[.+?^${}()|[\]\\]/gu, "\\$&").replace(/\*/gu, "[A-Za-z]*");
  return new RegExp(`^${escaped}$`, "u");
}

const compiled = new WeakMap<ReadonlySet<string>, RegExp[]>();

/** Whether `method` is in `set`, exactly or by one of its patterns. */
export function methodMatches(set: ReadonlySet<string>, method: string): boolean {
  if (set.has(method)) return true;
  let patterns = compiled.get(set);
  if (patterns === undefined) {
    patterns = [...set].filter((entry) => entry.includes("*")).map(compilePattern);
    compiled.set(set, patterns);
  }
  return patterns.some((re) => re.test(method));
}

/** `Domain.method`, as CDP spells it (the endpoint caps its length first, CDP_METHOD_MAX_CHARS). */
const METHOD_SHAPE = /^[A-Z][A-Za-z]*\.[a-z][A-Za-z]*$/u;

// ---- the tables (their names are what the tests and the counting tables cite) ----

// Never forwarded, on any session and either class.
// - `Target.*` and `Browser.*` reaching the forward path: the bridge answers or refuses them itself
//   first (`Browser.getVersion` the keepalive; the endpoint's root table). Reaching here means
//   nothing answered them.
// - the profile-wide cookie, cache and storage methods: one read of a desk partition's jar is every
//   sign-in.
// - `Page.setDownloadBehavior`: deprecated, and it takes a `downloadPath` a raw client could point
//   anywhere.
// - the screencast: no stream, no second pixel path (LSF-D16).
// - `*.crash`: nothing may kill the renderer the person holds.
export const NEVER_METHODS = readOnlySet([
  "Target.*",
  "Browser.*",
  "Network.getAllCookies",
  "Network.clearBrowserCookies",
  "Network.clearBrowserCache",
  "Network.setCookie",
  "Network.setCookies",
  "Network.deleteCookies",
  "Storage.getCookies",
  "Storage.setCookies",
  "Storage.clearCookies",
  "Storage.clearDataForOrigin",
  "Storage.clearDataForStorageKey",
  "Page.setDownloadBehavior",
  "Page.startScreencast",
  "Page.stopScreencast",
  "*.crash",
]);

// Never on the signed-in class (§4.3's state row "never"; its emulation row "no").
// `Page.getNavigationHistory`: its reply carries every entry's `url` and `userTypedURL` whole,
// including what the person visited while holding the page, and command replies are never cleaned.
// Pictures of the page, kept or sent, show what the person's sign-ins open: a still
// (`captureScreenshot`), a PDF (`printToPDF`; `IO.read` reads its stream, so on this class
// it has no picture to read), an MHTML document (`captureSnapshot`, off the allowlist on both
// classes too) and the screencast (NEVER_METHODS answers it first). Tracing's screenshot
// category is refused by the trace's own check (traceVerdict). The page's text reads stay:
// reading is what this class is for.
export const SIGNED_IN_NEVER = readOnlySet([
  "Network.getCookies",
  "DOMStorage.*",
  "IndexedDB.*",
  "CacheStorage.*",
  "Emulation.*",
  "Page.getNavigationHistory",
  "Page.captureScreenshot",
  "Page.printToPDF",
  "Page.captureSnapshot",
  "Page.startScreencast",
]);

// What acts on the PAGE, not on a client's own session, refused on both classes and every session:
// main owns the viewport (`Emulation.setDeviceMetricsOverride`, and the capture scale it sets with
// it), and a pause freezes the page in the person's hand whichever session asked for it.
export const ACTS_ON_PAGE = readOnlySet([
  "Emulation.*",
  "Debugger.pause",
  "Debugger.setPauseOnExceptions",
]);

// Signed-in only with the `bodies` grant (BU-3: "response bodies … open for that page alone").
export const BODY_METHODS = readOnlySet([
  "Network.getResponseBody",
  "Network.getRequestPostData",
  "Fetch.getResponseBody",
]);

// Script-carrying methods and the field each carries its source in: judged by source, not by
// method. `createIsolatedWorld` is judged by its world name, `addBinding` by its name.
export const SCRIPT_FIELDS: Readonly<Record<PagesScriptMethod, string>> = Object.freeze({
  "Runtime.evaluate": "expression",
  "Runtime.callFunctionOn": "functionDeclaration",
  "Runtime.compileScript": "expression",
  "Page.addScriptToEvaluateOnNewDocument": "source",
  "Page.createIsolatedWorld": "worldName",
  "Runtime.addBinding": "name",
});

// Agent script by definition: allowed on the own signed-out page, refused on a signed-in page
// without BU-3's script grant. `Debugger.setBreakpoint*` only with a `condition` (a condition is
// script run in the page). `Runtime.runScript` runs a compiled script by id, so its source is not in
// the call to judge.
export const AGENT_SCRIPT = readOnlySet([
  "Debugger.evaluateOnCallFrame",
  "Debugger.setScriptSource",
  "Debugger.setBreakpoint*",
  "Runtime.runScript",
]);
export const AGENT_SCRIPT_FIELDS: Readonly<Record<string, string>> = Object.freeze({
  "Debugger.evaluateOnCallFrame": "expression",
  "Debugger.setScriptSource": "scriptSource",
  "Debugger.setBreakpoint": "condition",
  "Debugger.setBreakpointByUrl": "condition",
  "Debugger.setBreakpointOnFunctionCall": "condition",
});

// Script by markup: a signed-in page's DOM written so the page runs it (an `on*` handler, a
// `javascript:` URL, an iframe `srcdoc`, a whole document). Agent script on the signed-in class; a
// plain mutation on the own page, where agent script is allowed anyway.
export const MARKUP_SCRIPT = readOnlySet([
  "DOM.setOuterHTML",
  "DOM.setAttributesAsText",
  "Page.setDocumentContent",
]);

// Mutations: pass only inside an act window (a read window is not a smaller act window). Script
// bodies add to this by their recorded class, agent script always. A breakpoint, with or without a
// condition, can freeze the page in the person's hand, so a read window never sets one.
export const MUTATING = readOnlySet([
  "Input.*",
  "Debugger.setBreakpoint*",
  "Page.navigate",
  "Page.reload",
  "Page.navigateToHistoryEntry",
  "Page.stopLoading",
  "Page.handleJavaScriptDialog",
  "Page.setDocumentContent",
  "Page.bringToFront",
  "DOM.set*",
  "DOM.remove*",
  "DOM.focus",
  "Page.addScriptToEvaluateOnNewDocument",
  "Page.removeScriptToEvaluateOnNewDocument",
  "Runtime.removeBinding",
  "Network.setExtraHTTPHeaders",
  "Fetch.enable",
  "Fetch.disable",
  "Network.emulateNetworkConditions",
  "Network.overrideNetworkState",
  "DOMStorage.set*",
  "DOMStorage.remove*",
  "DOMStorage.clear",
  "IndexedDB.clear*",
  "IndexedDB.delete*",
  "CacheStorage.delete*",
]);

// Throttling: the journal's `throttling` row on the own page; the emulation row's "offline: no" on
// the signed-in one.
export const THROTTLING = readOnlySet([
  "Network.emulateNetworkConditions",
  "Network.overrideNetworkState",
]);

// One still per read window, none while held (BU-12 A, BU-9); the own class only (SIGNED_IN_NEVER). A PDF is taken
// as its bytes in the answer alone, never as a stream (2026-11-24, in `classify`).
export const CAPTURE = readOnlySet(["Page.captureScreenshot", "Page.printToPDF"]);

// Tracing: Electron's client is TRUSTED, so Chromium's page-level tracing adds the browser and GPU
// processes, skips the filter on a caller's `perfettoConfig` and allows the system backend, with
// privacy filtering off. So: no perfettoConfig, the default backends only, no legacy
// `categories`/`options` strings, never a screenshot category (a second pixel path), and the
// included categories narrowed to TRACE_CATEGORIES by the events' cleaner.
export const TRACE_BACKENDS = readOnlySet(["auto", "chrome"]);
const TRACE_SCREENSHOT = /screenshot/iu;

// URL-checked methods and their field: only http, https and the exact `about:blank` load.
// `Target.createTarget` is answered by the bridge, which calls `urlVerdict` itself.
// `Fetch.continueRequest` may rewrite a paused request's URL, so it is checked the same way.
export const URL_CHECKED: Readonly<Record<string, string>> = Object.freeze({
  "Page.navigate": "url",
  "Network.loadNetworkResource": "url",
  "Target.createTarget": "url",
  "Fetch.continueRequest": "url",
});

// Refused, counted apart, never "unexpected": the engine sends it at connect and ignores the error.
export const EXPECTED_REFUSED = readOnlySet(["WebMCP.enable"]);

// On the signed-in class only with BU-3's script grant: routes and origin-scoped headers, a load with
// the profile's credentials, the debugger, the profiler and traces, and the three Fetch answers
// that serve or let a paused request go on (an answer is how a route serves its own document or
// script to the page). `Fetch.failRequest` is not here (EY-1, 2026-11-19): failing a paused
// request is what frees the page, so it passes on both classes whatever the grants; a grant
// withdrawn while a request is paused must never leave the page's load hanging.
export const SIGNED_IN_SCRIPT_GRANT = readOnlySet([
  "Fetch.enable",
  "Fetch.continueRequest",
  "Fetch.fulfillRequest",
  "Fetch.continueWithAuth",
  "Network.setExtraHTTPHeaders",
  "Network.loadNetworkResource",
  "Debugger.*",
  "Profiler.*",
  "Tracing.*",
]);

// The allowlist (the own class; the signed-in class is this minus the rules above).
export const OWN_ALLOWED = readOnlySet([
  // Accessibility (snapshot: the engine's getFullAXTree)
  "Accessibility.enable",
  "Accessibility.disable",
  "Accessibility.getFullAXTree",
  "Accessibility.getPartialAXTree",
  "Accessibility.getRootAXNode",
  "Accessibility.getChildAXNodes",
  "Accessibility.queryAXTree",
  "Accessibility.getAXNodeAndAncestors",
  "Audits.enable",
  "Audits.disable",
  // CSS: reads only
  "CSS.enable",
  "CSS.disable",
  "CSS.getComputedStyleForNode",
  "CSS.getMatchedStylesForNode",
  "CSS.getInlineStylesForNode",
  "CSS.getPlatformFontsForNode",
  "CSS.getBackgroundColors",
  "CSS.getStyleSheetText",
  "Console.enable",
  "Console.disable",
  // DOM: reads, then the mutations MUTATING names
  "DOM.enable",
  "DOM.disable",
  "DOM.getDocument",
  "DOM.getFlattenedDocument",
  "DOM.describeNode",
  "DOM.querySelector",
  "DOM.querySelectorAll",
  "DOM.resolveNode",
  "DOM.requestNode",
  "DOM.requestChildNodes",
  "DOM.getBoxModel",
  "DOM.getContentQuads",
  "DOM.getNodeForLocation",
  "DOM.getFrameOwner",
  "DOM.getOuterHTML",
  "DOM.getAttributes",
  "DOM.scrollIntoViewIfNeeded",
  "DOM.pushNodesByBackendIdsToFrontend",
  "DOM.performSearch",
  "DOM.getSearchResults",
  "DOM.discardSearchResults",
  "DOM.setAttributeValue",
  "DOM.setAttributesAsText",
  "DOM.setNodeValue",
  "DOM.setOuterHTML",
  "DOM.setFileInputFiles",
  "DOM.removeNode",
  "DOM.removeAttribute",
  "DOM.focus",
  "DOMDebugger.getEventListeners",
  "DOMSnapshot.enable",
  "DOMSnapshot.disable",
  "DOMSnapshot.captureSnapshot",
  // State, the own profile's (§4.3's state row: "yes, its own profile's"); SIGNED_IN_NEVER takes them off
  // the signed-in class
  "DOMStorage.enable",
  "DOMStorage.disable",
  "DOMStorage.getDOMStorageItems",
  "DOMStorage.setDOMStorageItem",
  "DOMStorage.removeDOMStorageItem",
  "DOMStorage.clear",
  "IndexedDB.enable",
  "IndexedDB.disable",
  "IndexedDB.requestDatabaseNames",
  "IndexedDB.requestDatabase",
  "IndexedDB.requestData",
  "IndexedDB.getMetadata",
  "IndexedDB.clearObjectStore",
  "IndexedDB.deleteDatabase",
  "IndexedDB.deleteObjectStoreEntries",
  "CacheStorage.requestCacheNames",
  "CacheStorage.requestEntries",
  "CacheStorage.requestCachedResponse",
  "CacheStorage.deleteCache",
  "CacheStorage.deleteEntry",
  "Network.getCookies",
  // Debugger: never `pause` or `setPauseOnExceptions`: a paused page freezes in the person's hand, whichever
  // session asked
  "Debugger.enable",
  "Debugger.disable",
  "Debugger.getScriptSource",
  "Debugger.evaluateOnCallFrame",
  "Debugger.setScriptSource",
  "Debugger.setBreakpoint",
  "Debugger.setBreakpointByUrl",
  "Debugger.setBreakpointOnFunctionCall",
  "Debugger.removeBreakpoint",
  "Debugger.setBreakpointsActive",
  "Debugger.setSkipAllPauses",
  "Debugger.resume",
  "Debugger.stepOver",
  "Debugger.stepInto",
  "Debugger.stepOut",
  "Debugger.setAsyncCallStackDepth",
  // Fetch: routes (the engine's actions.rs:970-1104), and the paused-request answers (the windows' exception)
  "Fetch.enable",
  "Fetch.disable",
  "Fetch.continueRequest",
  "Fetch.continueWithAuth",
  "Fetch.failRequest",
  "Fetch.fulfillRequest",
  "Fetch.getResponseBody",
  // IO: the stream handles of printToPDF and Tracing
  "IO.read",
  "IO.close",
  // Input: never `setIgnoreInputEvents` (it would lock the person's own input out of the page), and never
  // `dispatchDragEvent`: Chromium refuses its `data.files` and file: `text/uri-list` items only for a client that may
  // not read local files (InputHandler::DispatchDragEvent, HasFileRelatedItem), and Electron's client may, so a drop
  // would hand the page any local file past PATH_CHECKED and `needs-you: file`. The pin drags by dispatchMouseEvent.
  "Input.dispatchKeyEvent",
  "Input.dispatchMouseEvent",
  "Input.dispatchTouchEvent",
  "Input.insertText",
  "Input.imeSetComposition",
  "Input.synthesizeScrollGesture",
  "Input.synthesizeTapGesture",
  "Input.synthesizePinchGesture",
  "Inspector.enable",
  "Inspector.disable",
  "Log.enable",
  "Log.disable",
  "Log.clear",
  "Log.startViolationsReport",
  "Log.stopViolationsReport",
  // Network: never the cache, bypass or block switches (state the bridge's journal does not undo)
  "Network.enable",
  "Network.disable",
  "Network.getResponseBody",
  "Network.getRequestPostData",
  "Network.setExtraHTTPHeaders",
  "Network.emulateNetworkConditions",
  "Network.overrideNetworkState",
  "Network.loadNetworkResource",
  "Network.getCertificate",
  "Network.getSecurityIsolationStatus",
  // Page
  "Page.enable",
  "Page.disable",
  "Page.getFrameTree",
  "Page.getLayoutMetrics",
  "Page.getNavigationHistory",
  "Page.setLifecycleEventsEnabled",
  "Page.navigate",
  "Page.reload",
  "Page.navigateToHistoryEntry",
  "Page.stopLoading",
  "Page.captureScreenshot",
  "Page.printToPDF",
  "Page.addScriptToEvaluateOnNewDocument",
  "Page.removeScriptToEvaluateOnNewDocument",
  "Page.createIsolatedWorld",
  "Page.handleJavaScriptDialog",
  "Page.bringToFront",
  "Page.setDocumentContent",
  "Performance.enable",
  "Performance.disable",
  "Performance.getMetrics",
  "PerformanceTimeline.enable",
  "Profiler.enable",
  "Profiler.disable",
  "Profiler.start",
  "Profiler.stop",
  "Profiler.setSamplingInterval",
  "Profiler.startPreciseCoverage",
  "Profiler.stopPreciseCoverage",
  "Profiler.takePreciseCoverage",
  // Runtime: the script-carrying ones are judged by source below
  "Runtime.enable",
  "Runtime.disable",
  "Runtime.evaluate",
  "Runtime.callFunctionOn",
  "Runtime.compileScript",
  "Runtime.runScript",
  "Runtime.awaitPromise",
  "Runtime.getProperties",
  "Runtime.releaseObject",
  "Runtime.releaseObjectGroup",
  "Runtime.addBinding",
  "Runtime.removeBinding",
  "Runtime.runIfWaitingForDebugger",
  "Runtime.discardConsoleEntries",
  "Runtime.getHeapUsage",
  "Runtime.getIsolateId",
  "Runtime.setAsyncCallStackDepth",
  "Runtime.getExceptionDetails",
  "Runtime.globalLexicalScopeNames",
  "Security.enable",
  "Security.disable",
  "Tracing.start",
  "Tracing.end",
  "Tracing.getCategories",
]);

// The journal's kinds: what it records after a successful forward.
export const JOURNAL_KIND_OF: Readonly<Record<string, JournalKind>> = Object.freeze({
  "Fetch.enable": "route",
  "Network.setExtraHTTPHeaders": "extra-headers",
  "Page.addScriptToEvaluateOnNewDocument": "init-script",
  "Network.emulateNetworkConditions": "throttling",
  "Network.overrideNetworkState": "throttling",
  "Runtime.addBinding": "binding",
  "Debugger.enable": "debugger",
  "Debugger.setBreakpoint": "breakpoint",
  "Debugger.setBreakpointByUrl": "breakpoint",
  "Debugger.setBreakpointOnFunctionCall": "breakpoint",
  "Tracing.start": "tracing",
});

// ---- the rules ----

/**
 * The one URL rule: `http:`, `https:` and the exact `about:blank` only. `file:` reads, `javascript:`
 * and `data:` documents and `chrome:` pages are refused, and so is every other scheme, as Chrome's
 * untrusted client is held to URLs it may attach to. With `siteBound` on a signed-in page, another
 * registrable domain is `off-site` (EY-D5). The registrable domain is the caller's `siteOf` (the
 * Public Suffix List's rule); with none given, or none for this host, the bound refuses rather than
 * guess.
 */
export function urlVerdict(
  url: unknown,
  page: BridgePage | null,
  o: { readonly siteBound: boolean; readonly siteOf?: (host: string) => string | null },
): BridgeVerdict {
  if (typeof url !== "string" || url === "") return refuse("forbidden", "a URL is required");
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return refuse("forbidden", "the URL does not parse");
  }
  const scheme = parsed.protocol.toLowerCase();
  if (scheme === "about:") {
    return parsed.href === "about:blank"
      ? BRIDGE_OK
      : refuse("forbidden", "only about:blank among about: URLs");
  }
  if (scheme !== "http:" && scheme !== "https:") {
    return refuse("forbidden", `the ${scheme} scheme is never loaded`);
  }
  if (o.siteBound && page?.pageClass === "signed-in") {
    const site = o.siteOf?.(parsed.hostname) ?? null;
    if (site === null) return refuse("off-site", "no site rule names this host's site");
    if (site !== page.site) {
      return refuse("off-site", "a page with your sign-ins stays on the site it was handed on");
    }
  }
  return BRIDGE_OK;
}

/**
 * The column follows the profile, not who opened the page (browser-use §4.3): a persistent
 * profile's page carries the person's sign-ins; a memory profile's page is the agent's own, signed
 * out.
 */
export function pageClassOf(profile: { readonly mode: "persistent" | "memory" }): PageClass {
  return profile.mode === "persistent" ? "signed-in" : "own";
}

/** The sessions whose messages forward to the page; `root` and `tab` are the bridge's own. */
const FORWARDING: ReadonlySet<SessionKind> = new Set<SessionKind>(["page", "child"]);

/**
 * One CDP message, judged: the verdict, and the facts the windows and the journal read. The order
 * is the policy: what is never forwarded, then the session, what acts on the page, the signed-in never-list,
 * the allowlist, bodies, script, the grants, and last the URL and file bounds.
 */
export function classify(q: MethodQuestion, ctx: PolicyContext): MethodDecision {
  const { call, page, session, grants } = q;
  if (!PAGE_CLASSES.includes(page.pageClass)) throw new TypeError("classify: unknown page class");
  const method = call.method;
  const p: Record<string, unknown> = isPlainObject(call.params) ? call.params : {};
  const signedIn = page.pageClass === "signed-in";
  const facts: {
    mutation: boolean;
    capture: boolean;
    script: ScriptFacts | null;
    expected: boolean;
    journal: JournalKind | null;
  } = { mutation: false, capture: false, script: null, expected: false, journal: null };
  const out = (verdict: BridgeVerdict): MethodDecision => ({ ...facts, verdict });

  if (typeof method !== "string" || !METHOD_SHAPE.test(method)) {
    return out(refuse("forbidden", "not a CDP method name"));
  }
  facts.mutation = methodMatches(MUTATING, method);
  facts.capture = CAPTURE.has(method);
  facts.journal = JOURNAL_KIND_OF[method] ?? null;

  // 1 · expected refusals, counted apart.
  if (EXPECTED_REFUSED.has(method)) {
    facts.expected = true;
    return out(refuse("forbidden", "not on the allowlist (the engine ignores the error)"));
  }
  // 2 · never forwarded, any session, any class.
  if (methodMatches(NEVER_METHODS, method)) {
    const reason =
      method.startsWith("Target.") || method.startsWith("Browser.")
        ? "Target and Browser are answered or refused by the bridge, never forwarded"
        : "never forwarded on any page (profile-wide state, file writes, the screencast or a crash)";
    return out(refuse("forbidden", reason));
  }
  // 3 · only the page's own sessions forward; the bridge answers the root and its tabs.
  if (!FORWARDING.has(session)) {
    return out(
      refuse("forbidden", "only the page's sessions forward; the bridge answers the root and tabs"),
    );
  }
  // 4 · what acts on the page, not on the client's own session: the viewport's one owner, and a
  // pause that would freeze the page in the person's hand.
  if (methodMatches(ACTS_ON_PAGE, method)) {
    return out(refuse("forbidden", "it acts on the page itself, not on this client's own session"));
  }
  // 5 · the signed-in never-list.
  if (signedIn && methodMatches(SIGNED_IN_NEVER, method)) {
    return out(
      refuse("forbidden", "never on a page with your sign-ins (cookies, storage, caches, stills)"),
    );
  }
  // 6 · the allowlist.
  if (!OWN_ALLOWED.has(method)) return out(refuse("forbidden", "not on the method allowlist"));

  // 7 · bodies on the signed-in class.
  if (signedIn && BODY_METHODS.has(method) && !grants.bodies) {
    return out(
      refuse("forbidden", "request and response bodies need your bodies grant on this page (BU-3)"),
    );
  }

  // 8 · script (before the debug grant below, so a refused Debugger script still says it is script).
  const scripted = classifyScript(method, p, { signedIn, script: grants.script, ctx, facts });
  if (scripted !== null) return out(scripted);

  // 9 · debug and throttling on the signed-in class.
  if (signedIn && methodMatches(SIGNED_IN_SCRIPT_GRANT, method) && !grants.script) {
    return out(
      refuse(
        "forbidden",
        "routes, headers, loads and debugging need your script grant on this page (BU-3)",
      ),
    );
  }
  if (signedIn && THROTTLING.has(method)) {
    return out(
      refuse("forbidden", "no emulation on a page with your sign-ins (throttling included)"),
    );
  }
  if (signedIn && method === "Page.navigateToHistoryEntry") {
    return out(refuse("forbidden", "a history entry names no URL the site bound can check"));
  }
  // A trusted client's `fromSurface: false` grabs the native window's pixels over the view's rect:
  // whatever the shell or another pane draws over it. The engine's stills take the default path.
  if (method === "Page.captureScreenshot" && p.fromSurface === false) {
    return out(
      refuse("forbidden", "a still comes from this page's own surface, never the window's pixels"),
    );
  }
  // A PDF is a still (2026-11-24): its bytes come in the answer, where the endpoint holds them to the still's
  // bound. As a stream its handle would be read over `IO.read` in any later window, with no bound. `IO.read` stays
  // on the allowlist for a trace's stream, which is no picture.
  if (
    method === "Page.printToPDF" &&
    p.transferMode !== undefined &&
    p.transferMode !== "ReturnAsBase64"
  ) {
    return out(refuse("forbidden", "a PDF comes in its answer, never as a stream to read later"));
  }
  if (method === "Tracing.start") {
    const traced = traceVerdict(p);
    if (!traced.ok) return out(traced);
  }

  // 10 · bounds: URLs, then files.
  const urlField = URL_CHECKED[method];
  if (urlField !== undefined && (method !== "Fetch.continueRequest" || p[urlField] !== undefined)) {
    const bounded = urlVerdict(p[urlField], page, {
      siteBound: method === "Page.navigate",
      ...(ctx.siteOf !== undefined ? { siteOf: ctx.siteOf } : {}),
    });
    if (!bounded.ok) return out(bounded);
  }
  // A file reaches a page only from the run's folder, which fieldd names and the agent never does;
  // the rule that checks a path inside it comes with uploads (EY-3). Until then no path passes.
  if (method === "DOM.setFileInputFiles") {
    if (signedIn) return out(refuse("forbidden", "files never reach a page with your sign-ins"));
    return out(
      refuse(
        "outside-folder",
        page.runFolder === null
          ? "no run folder is named"
          : "no path rule yet: files arrive with uploads",
      ),
    );
  }
  return out(BRIDGE_OK);
}

/** Tracing.start: the doors a trusted client has and an untrusted one does not are closed. */
function traceVerdict(p: Record<string, unknown>): BridgeVerdict {
  if (p.perfettoConfig !== undefined) {
    return refuse("forbidden", "a trace takes no perfettoConfig (unfiltered for us)");
  }
  if (p.tracingBackend !== undefined && !TRACE_BACKENDS.has(String(p.tracingBackend))) {
    return refuse("forbidden", "a trace records with the default backend only, never the system's");
  }
  if (p.categories !== undefined || p.options !== undefined) {
    return refuse("forbidden", "a trace is configured by traceConfig, never the legacy strings");
  }
  const tc = p.traceConfig;
  if (tc !== undefined && !isPlainObject(tc))
    return refuse("forbidden", "traceConfig must be an object");
  const named: unknown[] =
    isPlainObject(tc) && Array.isArray(tc.includedCategories) ? [...tc.includedCategories] : [];
  if (named.some((c) => typeof c !== "string"))
    return refuse("forbidden", "a trace category is a string");
  if (named.some((c) => TRACE_SCREENSHOT.test(String(c)))) {
    return refuse("forbidden", "a trace never records screenshots (a second pixel path, LSF-D16)");
  }
  return BRIDGE_OK;
}

/** The script rules; null when the call passes them. Sets `facts.script` and `facts.mutation`. */
function classifyScript(
  method: string,
  p: Record<string, unknown>,
  o: {
    readonly signedIn: boolean;
    readonly script: boolean;
    readonly ctx: PolicyContext;
    readonly facts: { mutation: boolean; script: ScriptFacts | null };
  },
): BridgeVerdict | null {
  const { signedIn, script, ctx, facts } = o;
  const agent = (): BridgeVerdict | null => {
    facts.script = { source: "agent" };
    facts.mutation = true; // a script body outside the recorded read set is a mutation
    if (signedIn && !script) {
      return refuse(
        "forbidden",
        "agent script on a page with your sign-ins needs your script grant (BU-3)",
      );
    }
    return null;
  };
  // Agent script by definition. A breakpoint without a condition is not script.
  if (methodMatches(AGENT_SCRIPT, method)) {
    const field = AGENT_SCRIPT_FIELDS[method];
    if (
      method.startsWith("Debugger.setBreakpoint") &&
      !(field !== undefined && typeof p[field] === "string" && p[field] !== "")
    ) {
      return null;
    }
    return agent();
  }
  // Script by markup: on the signed-in class only (on the own page agent script is allowed anyway).
  if (signedIn && markupScript(method, p)) return agent();
  // Page.reload carries script too, in `scriptToEvaluateOnLoad`; no recorded body is a reload's.
  let field: string | undefined = (SCRIPT_FIELDS as Readonly<Record<string, string>>)[method];
  if (
    method === "Page.reload" &&
    p.scriptToEvaluateOnLoad !== undefined &&
    p.scriptToEvaluateOnLoad !== ""
  ) {
    field = "scriptToEvaluateOnLoad";
  }
  if (field === undefined) return null;
  const body = p[field];
  if (typeof body !== "string") return refuse("forbidden", `${method} without its ${field}`);
  const matched = ctx.matchScript(body, method);
  if (matched.matched) {
    facts.script = {
      source: "engine",
      commandClass: matched.commandClass,
      entryId: matched.entryId,
    };
    if (matched.commandClass === "act") facts.mutation = true;
    return null;
  }
  // A binding passes only by a name the record pass saw the engine use, on both classes.
  if (method === "Runtime.addBinding") {
    facts.script = { source: "agent" };
    return refuse("forbidden", "a binding name the engine was never recorded using");
  }
  return agent();
}

function markupScript(method: string, p: Record<string, unknown>): boolean {
  if (MARKUP_SCRIPT.has(method)) return true;
  if (method !== "DOM.setAttributeValue") return false;
  const name = typeof p.name === "string" ? p.name.trim().toLowerCase() : "";
  const value = typeof p.value === "string" ? p.value : "";
  return name.startsWith("on") || name === "srcdoc" || isJavaScriptUrl(value);
}

/** A `javascript:` URL as a browser reads one, and wider: leading controls and spaces stripped, and
 * any whitespace inside removed before the scheme is read. */
function isJavaScriptUrl(value: string): boolean {
  let start = 0;
  while (
    start < value.length &&
    (value.charCodeAt(start) <= 0x20 || /\s/u.test(value.charAt(start)))
  ) {
    start += 1;
  }
  return /^javascript:/iu.test(value.slice(start).replace(/\s/gu, ""));
}
