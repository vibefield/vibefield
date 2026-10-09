import type { WebContents } from "electron";

// AR-8 (L3) — what a real Chromium page at the app origin sent to, and heard
// from, a loopback daemon: every request, CORS preflight and WebSocket
// handshake whose URL the caller names, as Chromium's own network domain
// reports them (CDP `Network.*`), with the headers that decide whether a
// custom-scheme page may reach loopback at all — the request's Origin, the
// answer's `access-control-allow-origin`, and any private/local-network
// access header either side carried — and the reason Chromium gave for a load
// it refused. The History rung reads it to say how the packaged origin's
// direct plane actually went, not only that the words appeared.
//
// Test-only: rides the smoke bundle (dist/testing/smoke.cjs), never a package.

export interface LoopbackExchange {
  url: string;
  method: string;
  kind: "fetch" | "preflight" | "websocket";
  /** the Origin the page sent, as Chromium put it on the wire */
  origin: string | null;
  status: number | null;
  allowOrigin: string | null;
  /** an `access-control-request-{private,local}-network` the page sent */
  networkAccessAsked: string | null;
  /** an `access-control-allow-{private,local}-network` the daemon answered */
  networkAccessAllowed: string | null;
  /** Chromium's own words for a load it failed or blocked */
  failure: string | null;
}

export interface LoopbackRecorder {
  exchanges(): LoopbackExchange[];
  stop(): Promise<void>;
}

type Headers = Record<string, string>;

function header(headers: Headers | undefined, pattern: RegExp): string | null {
  if (headers === undefined) return null;
  for (const [name, value] of Object.entries(headers)) if (pattern.test(name)) return value;
  return null;
}

const ORIGIN = /^origin$/i;
const ALLOW_ORIGIN = /^access-control-allow-origin$/i;
const ASKED = /^access-control-request-(private|local)-network$/i;
const ALLOWED = /^access-control-allow-(private|local)-network$/i;

/** Start recording; the page's own requests from now on whose URL `matches`. */
export async function recordLoopback(
  contents: WebContents,
  matches: (url: string) => boolean,
): Promise<LoopbackRecorder> {
  const dbg = contents.debugger;
  // the offscreen harness may already hold the debugger (focus emulation);
  // share it then, and detach only what this attached
  const attachedHere = !dbg.isAttached();
  if (attachedHere) dbg.attach("1.3");
  const byId = new Map<string, LoopbackExchange>();
  const early = new Map<string, Headers>();
  const order: LoopbackExchange[] = [];
  const open = (id: string, url: string, method: string, kind: LoopbackExchange["kind"]) => {
    const exchange: LoopbackExchange = {
      url,
      method,
      kind,
      origin: null,
      status: null,
      allowOrigin: null,
      networkAccessAsked: null,
      networkAccessAllowed: null,
      failure: null,
    };
    byId.set(id, exchange);
    order.push(exchange);
    const sent = early.get(id);
    if (sent !== undefined) sentHeaders(exchange, sent);
    return exchange;
  };
  const sentHeaders = (exchange: LoopbackExchange, headers: Headers) => {
    exchange.origin = header(headers, ORIGIN) ?? exchange.origin;
    exchange.networkAccessAsked = header(headers, ASKED) ?? exchange.networkAccessAsked;
  };
  const heardHeaders = (exchange: LoopbackExchange, status: number, headers: Headers) => {
    exchange.status = status;
    exchange.allowOrigin = header(headers, ALLOW_ORIGIN) ?? exchange.allowOrigin;
    exchange.networkAccessAllowed = header(headers, ALLOWED) ?? exchange.networkAccessAllowed;
  };
  const onMessage = (_event: unknown, method: string, params: Record<string, unknown>) => {
    const id = String(params["requestId"] ?? "");
    switch (method) {
      case "Network.requestWillBeSent": {
        const request = params["request"] as { url: string; method: string; headers: Headers };
        if (!matches(request.url)) return;
        // Chromium 150 reports a CORS preflight as its own OPTIONS request
        // (measured: no `Preflight` type on it), sent after the read it guards
        const kind =
          params["type"] === "Preflight" || request.method === "OPTIONS" ? "preflight" : "fetch";
        sentHeaders(open(id, request.url, request.method, kind), request.headers);
        return;
      }
      case "Network.requestWillBeSentExtraInfo": {
        const headers = params["headers"] as Headers;
        const exchange = byId.get(id);
        if (exchange === undefined) early.set(id, headers);
        else sentHeaders(exchange, headers);
        return;
      }
      case "Network.responseReceivedExtraInfo": {
        const exchange = byId.get(id);
        if (exchange !== undefined)
          heardHeaders(exchange, Number(params["statusCode"]), params["headers"] as Headers);
        return;
      }
      case "Network.responseReceived": {
        const exchange = byId.get(id);
        const response = params["response"] as { status: number; headers: Headers };
        if (exchange !== undefined && exchange.status === null)
          heardHeaders(exchange, response.status, response.headers);
        return;
      }
      case "Network.loadingFailed": {
        const exchange = byId.get(id);
        if (exchange === undefined) return;
        const cors = params["corsErrorStatus"] as { corsError?: string } | undefined;
        exchange.failure = [params["errorText"], params["blockedReason"], cors?.corsError]
          .filter((part) => typeof part === "string" && part !== "")
          .join(" · ");
        return;
      }
      case "Network.webSocketCreated": {
        const url = String(params["url"]);
        if (matches(url)) open(id, url, "GET", "websocket");
        return;
      }
      case "Network.webSocketWillSendHandshakeRequest": {
        const exchange = byId.get(id);
        const request = params["request"] as { headers: Headers };
        if (exchange !== undefined) sentHeaders(exchange, request.headers);
        return;
      }
      case "Network.webSocketHandshakeResponseReceived": {
        const exchange = byId.get(id);
        const response = params["response"] as { status: number; headers: Headers };
        if (exchange !== undefined) heardHeaders(exchange, response.status, response.headers);
        return;
      }
      case "Network.webSocketFrameError": {
        const exchange = byId.get(id);
        if (exchange !== undefined) exchange.failure = String(params["errorMessage"]);
        return;
      }
    }
  };
  dbg.on("message", onMessage as never);
  await dbg.sendCommand("Network.enable");
  return {
    exchanges: () => order.map((exchange) => ({ ...exchange })),
    async stop() {
      dbg.off("message", onMessage as never);
      await dbg.sendCommand("Network.disable").catch(() => undefined);
      if (attachedHere && dbg.isAttached()) dbg.detach();
    },
  };
}
