// EY-1 (2026-11-19) — cleaned events by the page's class (the S1-W 10 rules and the BU-9 control, without Electron):
// the lab's events tests (draft/browser-spike/ey/test/events.test.js), ported whole. signInHostFor takes the class.
import { describe, expect, it } from "vitest";
import {
  cleanEvent,
  DROPPED_ALWAYS_SIGNED_IN,
  HEADER_ALLOWLIST,
  redactQuery,
  rewriteCommand,
  signInHostFor,
  targetEventAllowed,
  targetInfoView,
} from "../src/main/pages/core/events";
import type { CdpCall, CdpEvent, CleanContext, PageClass } from "../src/main/pages/core/types";

const signInHost = (host: string): boolean =>
  host === "vfey-a.test" || host.endsWith(".vfey-a.test");
const signedIn: CleanContext = { pageClass: "signed-in", held: false, signInHost };
const ownCtx = (held: boolean): CleanContext => ({ pageClass: "own", held, signInHost });

// biome-ignore lint/suspicious/noExplicitAny: a cleaned event is read by path, as the lab's tests read it
type Loose = any;

function forwarded(out: ReturnType<typeof cleanEvent>): Loose {
  if (out.action !== "forward") throw new Error(`dropped: ${out.reason}`);
  return out.event;
}

function requestWillBeSent(): CdpEvent {
  return {
    method: "Network.requestWillBeSent",
    sessionId: "",
    params: {
      requestId: "1.1",
      documentURL: "http://vfey-a.test/signin?next=/home#frag",
      request: {
        url: "http://vfey-a.test/signin?user=sample&token=abc123",
        urlFragment: "#access_token=zzz",
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          Cookie: "sid=1",
          Authorization: "Bearer x",
        },
        postData: "password=hunter2",
        postDataEntries: [{ bytes: "cGFzc3dvcmQ9aHVudGVyMg==" }],
        hasPostData: true,
      },
      initiator: { type: "parser", url: "http://vfey-a.test/signin?otp=123456" },
      redirectResponse: {
        url: "http://vfey-a.test/login?code=xyz",
        headers: { "set-cookie": "sid=2", etag: "W/1" },
        headersText: "HTTP/1.1 302\r\nSet-Cookie: sid=2",
        requestHeaders: { cookie: "sid=1", accept: "*/*" },
        requestHeadersText: "Cookie: sid=1",
      },
    },
  };
}

describe("cleaned events (the lab's events tests, ported)", () => {
  it("own class forwards every event unchanged, held or not (BU-9)", () => {
    const event = requestWillBeSent();
    for (const held of [false, true]) {
      const out = cleanEvent(event, ownCtx(held));
      expect(out.action).toBe("forward");
      expect(forwarded(out)).toBe(event);
    }
    const extra: CdpEvent = {
      method: "Network.requestWillBeSentExtraInfo",
      params: { headers: { cookie: "x" } },
    };
    expect(cleanEvent(extra, ownCtx(true)).action).toBe("forward");
  });

  it("a binding's call is not said while the page is held, on either class; the own page's console still is (2026-11-24)", () => {
    const called: CdpEvent = {
      method: "Runtime.bindingCalled",
      params: { name: "hook", payload: "typed in the person's hand", executionContextId: 1 },
    };
    expect(cleanEvent(called, ownCtx(true))).toEqual({ action: "drop", reason: "held" });
    expect(cleanEvent(called, { ...signedIn, held: true })).toEqual({
      action: "drop",
      reason: "held",
    });
    // put down, it is said again: nothing is kept back, and nothing was queued
    expect(forwarded(cleanEvent(called, ownCtx(false)))).toBe(called);
    // BU-9's own promise for the agent's own page stands: its console is said while the person holds it
    const logged: CdpEvent = {
      method: "Runtime.consoleAPICalled",
      params: { type: "log", args: [], executionContextId: 1 },
    };
    expect(forwarded(cleanEvent(logged, ownCtx(true)))).toBe(logged);
  });

  it("signed-in drops every event while held, never queued", () => {
    for (const method of [
      "Network.requestWillBeSent",
      "Runtime.consoleAPICalled",
      "Page.frameNavigated",
    ]) {
      expect(cleanEvent({ method, params: {} }, { ...signedIn, held: true })).toEqual({
        action: "drop",
        reason: "held",
      });
    }
    // Nothing is held back: after the put-down a new event passes, and the module keeps no state.
    const after = cleanEvent({ method: "Page.loadEventFired", params: { timestamp: 1 } }, signedIn);
    expect(forwarded(after)).toEqual({ method: "Page.loadEventFired", params: { timestamp: 1 } });
  });

  it("signed-in drops *ExtraInfo", () => {
    for (const method of [...DROPPED_ALWAYS_SIGNED_IN, "Network.someFutureExtraInfo"]) {
      expect(cleanEvent({ method, params: {} }, signedIn)).toEqual({
        action: "drop",
        reason: "extra-info",
      });
    }
  });

  it("signed-in strips bodies, filters headers, redacts query values, keeps the input intact", () => {
    const event = requestWillBeSent();
    const before = JSON.stringify(event);
    const out = forwarded(cleanEvent(event, signedIn));
    // the input event is not mutated
    expect(JSON.stringify(event)).toBe(before);
    const p = out.params;
    expect(out.sessionId).toBe("");
    expect("postData" in p.request).toBe(false);
    expect("postDataEntries" in p.request).toBe(false);
    expect("hasPostData" in p.request).toBe(false);
    expect("urlFragment" in p.request).toBe(false);
    expect(p.request.headers).toEqual({ "Content-Type": "application/x-www-form-urlencoded" });
    expect(p.request.url).toBe("http://vfey-a.test/signin?user=_&token=_");
    expect(p.documentURL).toBe("http://vfey-a.test/signin?next=_");
    expect(p.initiator.url).toBe("http://vfey-a.test/signin?otp=_");
    expect(p.redirectResponse.url).toBe("http://vfey-a.test/login?code=_");
    expect(p.redirectResponse.headers).toEqual({ etag: "W/1" });
    expect(p.redirectResponse.requestHeaders).toEqual({ accept: "*/*" });
    expect("headersText" in p.redirectResponse).toBe(false);
    expect("requestHeadersText" in p.redirectResponse).toBe(false);
    const text = JSON.stringify(out);
    for (const secret of ["hunter2", "abc123", "123456", "xyz", "sid=", "Bearer", "access_token"]) {
      expect(text.includes(secret)).toBe(false);
    }
  });

  it("query values are redacted only on sign-in hosts", () => {
    const event: CdpEvent = {
      method: "Network.responseReceived",
      params: {
        response: { url: "http://vfey-b.test/x?q=1", headers: { "x-other": "1", vary: "a" } },
      },
    };
    const out = forwarded(cleanEvent(event, signedIn));
    expect(out.params.response.url).toBe("http://vfey-b.test/x?q=1");
    // headers by allowlist everywhere
    expect(out.params.response.headers).toEqual({ vary: "a" });
  });

  it("Fetch.requestPaused is cleaned the same way, array headers included", () => {
    const event: CdpEvent = {
      method: "Fetch.requestPaused",
      sessionId: "CHILD1",
      params: {
        requestId: "interception-1",
        request: {
          url: "http://www.vfey-a.test/api?token=t",
          headers: { Accept: "text/html", Cookie: "a=b" },
          postData: "pw=1",
          hasPostData: true,
        },
        responseHeaders: [
          { name: "Set-Cookie", value: "a=b" },
          { name: "Content-Type", value: "text/html" },
        ],
        frameId: "F",
      },
    };
    const out = forwarded(cleanEvent(event, signedIn));
    const p = out.params;
    expect(out.sessionId).toBe("CHILD1");
    expect(p.requestId).toBe("interception-1");
    expect(p.request.url).toBe("http://www.vfey-a.test/api?token=_");
    expect(p.request.headers).toEqual({ Accept: "text/html" });
    expect("postData" in p.request).toBe(false);
    expect("hasPostData" in p.request).toBe(false);
    expect(p.responseHeaders).toEqual([{ name: "Content-Type", value: "text/html" }]);
  });

  it("WebSocket frames lose their payload on the signed-in class", () => {
    for (const method of ["Network.webSocketFrameSent", "Network.webSocketFrameReceived"]) {
      const event: CdpEvent = {
        method,
        params: {
          requestId: "w",
          timestamp: 1,
          response: { opcode: 1, mask: true, payloadData: "pw" },
        },
      };
      expect(forwarded(cleanEvent(event, signedIn)).params.response).toEqual({
        opcode: 1,
        mask: true,
      });
    }
  });

  it("frame.url and unparseable URLs", () => {
    const out = forwarded(
      cleanEvent(
        {
          method: "Page.frameNavigated",
          params: { frame: { id: "F", url: "http://vfey-a.test/?a=1", urlFragment: "#x" } },
        },
        signedIn,
      ),
    );
    expect(out.params.frame).toEqual({ id: "F", url: "http://vfey-a.test/?a=_" });
    const odd = forwarded(
      cleanEvent({ method: "Network.webSocketCreated", params: { url: "not a url" } }, signedIn),
    );
    expect(odd.params.url).toBe("[unparseable-url]");
    const empty = forwarded(
      cleanEvent({ method: "Page.frameNavigated", params: { frame: { url: "" } } }, signedIn),
    );
    expect(empty.params.frame.url).toBe("");
  });

  it("the optional session gate drops another client's sessions", () => {
    const out = cleanEvent(
      { method: "Page.loadEventFired", sessionId: "X", params: {} },
      { ...ownCtx(false), isClients: (id) => id === "" },
    );
    expect(out).toEqual({ action: "drop", reason: "not-the-clients" });
  });

  it("rewriteCommand: signed-in Network.enable gets maxPostDataSize 0, nothing else changes", () => {
    const command: CdpCall = {
      method: "Network.enable",
      params: { maxPostDataSize: 65536, maxTotalBufferSize: 100 },
    };
    expect(rewriteCommand(command, { pageClass: "signed-in" })).toEqual({
      method: "Network.enable",
      params: { maxPostDataSize: 0, maxTotalBufferSize: 100 },
    });
    // the input is not mutated
    expect(command.params.maxPostDataSize).toBe(65536);
    const bare = { method: "Network.enable" } as unknown as CdpCall;
    expect(rewriteCommand(bare, { pageClass: "signed-in" })).toEqual({
      method: "Network.enable",
      params: { maxPostDataSize: 0 },
    });
    expect(rewriteCommand(command, { pageClass: "own" })).toEqual(command);
    const page = { method: "Page.enable" } as unknown as CdpCall;
    expect(rewriteCommand(page, { pageClass: "signed-in" })).toEqual({
      method: "Page.enable",
      params: {},
    });
    expect(() => rewriteCommand(command, { pageClass: "desk" as PageClass })).toThrow();
  });

  it("redactQuery", () => {
    expect(redactQuery("https://a.test/p?x=1&y=&z#f")).toBe("https://a.test/p?x=_&y=_&_");
    expect(redactQuery("https://a.test/p?SECRET")).toBe("https://a.test/p?_");
    expect(redactQuery("https://u:pw@a.test/")).toBe("https://_:_@a.test/");
    expect(redactQuery("https://a.test/p#only")).toBe("https://a.test/p");
    expect(redactQuery("::")).toBe("[unparseable-url]");
    expect(HEADER_ALLOWLIST.has("content-type")).toBe(true);
    expect(HEADER_ALLOWLIST.has("cookie")).toBe(false);
  });

  // ---- the hole review (2026-10-31) ----

  it("signInHostFor: every host of a signed-in page is redacted, none of an own page", () => {
    expect(signInHostFor("signed-in")("vfey-a.test")).toBe(true);
    expect(signInHostFor("signed-in")("private-user-images.githubusercontent.com")).toBe(true);
    expect(signInHostFor("own")("vfey-b.test")).toBe(false);
    // An off-site capability URL on a signed-in page: the token goes, the parameter name stays.
    const out = forwarded(
      cleanEvent(
        {
          method: "Network.requestWillBeSent",
          params: {
            request: { url: "https://cdn.example/x.png?jwt=SECRET&X-Amz-Signature=SIG" },
            initiator: { type: "other", url: "https://idp.example/cb#access_token=TOK" },
          },
        },
        { pageClass: "signed-in", held: false, signInHost: signInHostFor("signed-in") },
      ),
    );
    const text = JSON.stringify(out);
    for (const secret of ["SECRET", "SIG", "TOK"]) expect(text.includes(secret)).toBe(false);
    expect(out.params.request.url).toBe("https://cdn.example/x.png?jwt=_&X-Amz-Signature=_");
  });

  it("rawCookieLine is dropped and every *Url / *URL / *URI string is redacted on signed-in", () => {
    const event: CdpEvent = {
      method: "Audits.issueAdded",
      params: {
        issue: {
          code: "CookieIssue",
          details: {
            cookieIssueDetails: {
              rawCookieLine: "sid=SECRET-COOKIE; Path=/",
              request: { requestId: "1", url: "http://vfey-a.test/r?token=T1" },
              cookieUrl: "http://vfey-a.test/c?token=T2",
            },
            mixedContentIssueDetails: {
              insecureURL: "http://vfey-a.test/i?token=T3",
              mainResourceURL: "http://vfey-a.test/m?token=T4",
            },
            blockedByResponseIssueDetails: { blockedURL: "http://vfey-a.test/b?token=T5" },
            other: {
              requestURL: "http://vfey-a.test/q?token=T6",
              redirectUrl: "http://vfey-a.test/d?token=T7",
              scriptURI: "http://vfey-a.test/s?token=T8",
              count: 3,
              isUrl: true,
            },
          },
        },
      },
    };
    const out = forwarded(cleanEvent(event, signedIn));
    const text = JSON.stringify(out);
    expect(text.includes("SECRET-COOKIE")).toBe(false);
    expect("rawCookieLine" in out.params.issue.details.cookieIssueDetails).toBe(false);
    for (const t of ["T1", "T2", "T3", "T4", "T5", "T6", "T7", "T8"]) {
      expect(text.includes(`token=${t}`)).toBe(false);
    }
    expect(out.params.issue.details.other.count).toBe(3);
    // a non-string is left alone
    expect(out.params.issue.details.other.isUrl).toBe(true);
    // The own page keeps everything (its own console, BU-9).
    expect(forwarded(cleanEvent(event, ownCtx(false)))).toBe(event);
  });

  it("Server-Sent Events lose their data on signed-in (bodies need BU-3's grant)", () => {
    const event: CdpEvent = {
      method: "Network.eventSourceMessageReceived",
      params: {
        requestId: "1",
        timestamp: 1,
        eventName: "message",
        eventId: "7",
        data: '{"session":"SECRET"}',
      },
    };
    const out = forwarded(cleanEvent(event, signedIn));
    expect(out.params.data).toBe("");
    expect(out.params.eventName).toBe("message");
    // the input is never mutated
    expect(String(event.params.data).includes("SECRET")).toBe(true);
    expect(forwarded(cleanEvent(event, ownCtx(false))).params.data).toBe(event.params.data);
  });

  it("rewriteCommand narrows a trace to the renderer-side categories, on both classes", () => {
    const engineTrace: CdpCall = {
      method: "Tracing.start",
      params: { traceConfig: { recordMode: "recordContinuously" }, transferMode: "ReturnAsStream" },
    };
    const out: Loose = rewriteCommand(engineTrace, { pageClass: "own" });
    expect(out.params.transferMode).toBe("ReturnAsStream");
    expect(out.params.traceConfig.recordMode).toBe("recordContinuously");
    expect(out.params.traceConfig.includedCategories).toContain("devtools.timeline");
    // the input is never mutated
    expect((engineTrace.params.traceConfig as Loose).includedCategories).toBeUndefined();
    const profiler: CdpCall = {
      method: "Tracing.start",
      params: {
        traceConfig: {
          includedCategories: ["devtools.timeline", "toplevel", "sequence_manager", "v8.execute"],
          enableSampling: true,
          memoryDumpConfig: { x: 1 },
        },
      },
    };
    const narrowed: Loose = rewriteCommand(profiler, { pageClass: "signed-in" }).params.traceConfig;
    expect(narrowed.includedCategories).toEqual(["devtools.timeline", "v8.execute"]);
    expect(narrowed.enableSampling).toBe(true);
    expect(narrowed.memoryDumpConfig).toBeUndefined();
    const none: CdpCall = {
      method: "Tracing.start",
      params: { traceConfig: { includedCategories: ["toplevel"] } },
    };
    const all: Loose = rewriteCommand(none, { pageClass: "own" }).params.traceConfig;
    expect(all.includedCategories.length).toBeGreaterThan(1);
  });

  it("Path 2 target info: a held signed-in page says nothing new (frozen at pick-up)", () => {
    const live = {
      targetId: "T",
      type: "page",
      title: "Inbox (3)",
      url: "https://vfey-a.test/reset?token=_",
    };
    const frozen = { title: "Home", url: "https://vfey-a.test/home" };
    expect(targetEventAllowed({ pageClass: "signed-in", held: true })).toBe(false);
    expect(targetEventAllowed({ pageClass: "signed-in", held: false })).toBe(true);
    expect(targetEventAllowed({ pageClass: "own", held: true })).toBe(true);
    expect(targetInfoView({ pageClass: "signed-in", held: true, live, frozen })).toEqual({
      ...live,
      title: "Home",
      url: "https://vfey-a.test/home",
    });
    expect(targetInfoView({ pageClass: "signed-in", held: true, live })).toEqual({
      ...live,
      title: "",
      url: "",
    });
    expect(targetInfoView({ pageClass: "signed-in", held: false, live, frozen })).toBe(live);
    expect(targetInfoView({ pageClass: "own", held: true, live, frozen })).toBe(live);
  });
});
