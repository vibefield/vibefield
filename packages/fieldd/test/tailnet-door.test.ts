// The C3 tailnet door (thinking-c3 §1), unit-level: a standalone ProductApi
// with a scripted token service, driven by real ws clients that can set the
// headers/paths the sidecar would. The SPOOF test is the point: EL7's same-uid
// adversary can type Tailscale-User-* headers on the ordinary door and must
// get nothing.
import { CONTRACTS_VERSION, TAILNET_SCOPES } from "@vibefield/contracts";
import { afterEach, describe, expect, it } from "vitest";
import WebSocket from "ws";
import { ProductApi } from "../src/product-api";

const SECRET = "3q2fN8pXvKb0aH5sYw1LrTz9cUeD7RgM";

let cleanup: Array<() => void | Promise<void>> = [];
afterEach(async () => {
  for (const fn of cleanup.reverse()) await fn();
  cleanup = [];
});

async function api(): Promise<{ api: ProductApi; port: number }> {
  const a = new ProductApi({
    port: 0,
    tokens: {
      verify: (t) =>
        t === "good-token"
          ? { tokenId: "tk1", scopes: ["doc.read", "tokens.mint"], label: "t" }
          : null,
    },
    tailnetPathSecret: SECRET,
  });
  // probe handlers on real registry methods: echo the caller's principal kind
  a.register("doc.list", (ctx) => ({ principal: ctx.principal, transport: ctx.transport }));
  a.register("device.list", (ctx) => ({ principal: ctx.principal, transport: ctx.transport }));
  a.register("system.mintWindowToken", () => ({ never: true }));
  const port = await a.listen();
  cleanup.push(() => a.close());
  return { api: a, port };
}

interface DialOpts {
  path?: string;
  headers?: Record<string, string>;
}

function dial(port: number, opts: DialOpts = {}): Promise<WebSocket> {
  const ws = new WebSocket(`ws://127.0.0.1:${port}${opts.path ?? "/"}`, {
    ...(opts.headers ? { headers: opts.headers } : {}),
  });
  cleanup.push(() => ws.close());
  return new Promise((resolve, reject) => {
    ws.once("open", () => resolve(ws));
    ws.once("error", reject);
  });
}

function call(ws: WebSocket, id: number, method: string, params: unknown): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const onMsg = (raw: Buffer) => {
      const msg = JSON.parse(raw.toString());
      if (msg.id === id) {
        ws.off("message", onMsg);
        resolve(msg);
      }
    };
    ws.on("message", onMsg);
    ws.once("close", () => reject(new Error("closed before reply")));
    ws.send(JSON.stringify({ jsonrpc: "2.0", id, method, params }));
  });
}

const hello = (credential?: string) => ({
  contractsVersion: CONTRACTS_VERSION,
  minCompatible: CONTRACTS_VERSION,
  clientKind: "peer-fieldd",
  ...(credential !== undefined ? { credential } : {}),
});

function closed(ws: WebSocket): Promise<void> {
  if (ws.readyState === WebSocket.CLOSED) return Promise.resolve();
  return new Promise((r) => ws.once("close", () => r()));
}

describe("the tailnet door (C3 provenance auth)", () => {
  it("secret path + injected login → hello without credential gets the D32 preset", async () => {
    const { port } = await api();
    const ws = await dial(port, {
      path: `/t/${SECRET}`,
      headers: { "Tailscale-User-Login": "me@jamesyong42.com" },
    });
    const ack = (await call(ws, 1, "system.hello", hello())) as {
      result: { grantedScopes: string[] };
    };
    expect(ack.result.grantedScopes).toEqual([...TAILNET_SCOPES]);

    const probe = (await call(ws, 2, "device.list", {})) as {
      result: { principal: { kind: string; login: string }; transport: string };
    };
    expect(probe.result.principal).toEqual({ kind: "tailnet", login: "me@jamesyong42.com" });
    expect(probe.result.transport).toBe("ws-tailnet");

    const docDenied = (await call(ws, 3, "doc.list", {})) as {
      error: { data: { kind: string } };
    };
    expect(docDenied.error.data.kind).toBe("FORBIDDEN_SCOPE");

    // D32: tokens.mint never federates — the preset excludes it
    const denied = (await call(ws, 4, "system.mintWindowToken", {})) as {
      error: { data: { kind: string } };
    };
    expect(denied.error.data.kind).toBe("FORBIDDEN_SCOPE");
  });

  it("THE SPOOF: typed headers on the ordinary door are ignored — token still required", async () => {
    const { port } = await api();
    const ws = await dial(port, {
      path: "/",
      headers: {
        "Tailscale-User-Login": "attacker@evil.example",
        "Tailscale-User-Name": "Not The Sidecar",
      },
    });
    const res = (await call(ws, 1, "system.hello", hello())) as {
      error: { data: { kind: string } };
    };
    expect(res.error.data.kind).toBe("UNAUTHORIZED");
    await closed(ws);
  });

  it("secret path WITHOUT a login header is dropped before hello", async () => {
    const { port } = await api();
    const ws = await dial(port, { path: `/t/${SECRET}` });
    await closed(ws); // server closes immediately (tagged node / spoofed provenance)
    expect(ws.readyState).toBe(WebSocket.CLOSED);
  });

  it("a wrong secret is dropped (probing learns nothing)", async () => {
    const { port } = await api();
    const ws = await dial(port, {
      path: "/t/wrong-secret-entirely-000000000",
      headers: { "Tailscale-User-Login": "me@jamesyong42.com" },
    });
    await closed(ws);
    expect(ws.readyState).toBe(WebSocket.CLOSED);
  });

  it("a verified token on the tailnet door wins — real local grant, tailnet transport", async () => {
    const { port } = await api();
    const ws = await dial(port, {
      path: `/t/${SECRET}`,
      headers: { "Tailscale-User-Login": "me@jamesyong42.com" },
    });
    const ack = (await call(ws, 1, "system.hello", hello("good-token"))) as {
      result: { grantedScopes: string[] };
    };
    expect(ack.result.grantedScopes).toEqual(["doc.read", "tokens.mint"]);
    const probe = (await call(ws, 2, "doc.list", {})) as {
      result: { principal: { kind: string }; transport: string };
    };
    expect(probe.result.principal.kind).toBe("local-token");
    expect(probe.result.transport).toBe("ws-tailnet");
  });

  it("with no secret configured the tailnet door does not exist", async () => {
    const a = new ProductApi({ port: 0, tokens: { verify: () => null } });
    const port = await a.listen();
    cleanup.push(() => a.close());
    const ws = await dial(port, {
      path: "/t/anything",
      headers: { "Tailscale-User-Login": "me@jamesyong42.com" },
    });
    // "/t/..." is just an ordinary path now: headers ignored, token required
    const res = (await call(ws, 1, "system.hello", hello())) as {
      error: { data: { kind: string } };
    };
    expect(res.error.data.kind).toBe("UNAUTHORIZED");
  });
});
