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

// UA-P-0a — every door row now says which ACCOUNT the desktop is, because that
// is what the door compares against. `LINKED` is the ordinary posture; passing
// `null` is the unlinked/capturing desktop, which after UA-P-0a gets a guest
// and not the preset.
const LINKED = "me@jamesyong42.com";

async function api(
  correlateNodeId?: (nodeId: string) => string | undefined,
  linkedLogin: string | null = LINKED,
): Promise<{ api: ProductApi; port: number }> {
  const a = new ProductApi({
    port: 0,
    tokens: {
      verify: (t) =>
        t === "good-token"
          ? { tokenId: "tk1", scopes: ["doc.read", "tokens.mint"], label: "t" }
          : null,
    },
    tailnetPathSecret: SECRET,
    getLinkedLogin: () => linkedLogin,
    ...(correlateNodeId ? { correlateNodeId } : {}),
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
  it("secret path + the LINKED login → hello without credential gets the D32 preset", async () => {
    const { port } = await api();
    const ws = await dial(port, {
      path: `/t/${SECRET}`,
      headers: { "Tailscale-User-Login": LINKED },
    });
    const ack = (await call(ws, 1, "system.hello", hello())) as {
      result: { grantedScopes: string[] };
    };
    expect(ack.result.grantedScopes).toEqual([...TAILNET_SCOPES]);

    const probe = (await call(ws, 2, "device.list", {})) as {
      result: { principal: { kind: string; login: string }; transport: string };
    };
    // UA-P-0a: a matched login is SELF, unconditionally. `self` used to be
    // omitted whenever no login was stored, because pre-capture landed in this
    // same branch; it cannot any more, so the slot is always filled.
    expect(probe.result.principal).toEqual({ kind: "tailnet", login: LINKED, self: true });
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

  it("T1: the v3 node-id header is the peer identity — a contradicting claim loses", async () => {
    // transport-derived beats claimed: the sidecar-injected node id correlates
    // to the roster device, and the hello's own deviceId cannot move it.
    const { port } = await api((nodeId) => (nodeId === "nQRJl4CNTRL" ? "dev-roster" : undefined));
    const ws = await dial(port, {
      path: `/t/${SECRET}`,
      headers: {
        "Tailscale-User-Login": LINKED,
        "Tailscale-Node-Id": "nQRJl4CNTRL",
      },
    });
    await call(ws, 1, "system.hello", { ...hello(), deviceId: "dev-liar" });
    const probe = (await call(ws, 2, "device.list", {})) as {
      result: { principal: { kind: string; deviceId: string } };
    };
    expect(probe.result.principal).toEqual({ kind: "peer-fieldd", deviceId: "dev-roster" });
  });

  it("T1: a correlation miss keeps the C5 claim fallback (mixed fleet)", async () => {
    // the node id is present but the registry doesn't know it yet (roster
    // stale / peer unpublished) — the claim stays the honest label until
    // fleet-v3 retires it.
    const { port } = await api(() => undefined);
    const ws = await dial(port, {
      path: `/t/${SECRET}`,
      headers: {
        "Tailscale-User-Login": LINKED,
        "Tailscale-Node-Id": "nUNKNOWN01",
      },
    });
    await call(ws, 1, "system.hello", { ...hello(), deviceId: "dev-claimed" });
    const probe = (await call(ws, 2, "device.list", {})) as {
      result: { principal: { kind: string; deviceId: string } };
    };
    expect(probe.result.principal).toEqual({ kind: "peer-fieldd", deviceId: "dev-claimed" });
  });

  it("T1: the node id names the device, not the software — a non-fieldd caller stays tailnet", async () => {
    const { port } = await api((nodeId) => (nodeId === "nQRJl4CNTRL" ? "dev-roster" : undefined));
    const ws = await dial(port, {
      path: `/t/${SECRET}`,
      headers: {
        "Tailscale-User-Login": LINKED,
        "Tailscale-Node-Id": "nQRJl4CNTRL",
      },
    });
    await call(ws, 1, "system.hello", { ...hello(), clientKind: "shell-main" });
    const probe = (await call(ws, 2, "device.list", {})) as {
      result: { principal: { kind: string; login: string } };
    };
    // UA-4 fills the declared tailscaleId slot from the transport fact, and
    // UA-P-0a fills `self` unconditionally on a match — and the KIND still
    // never follows the software claim
    expect(probe.result.principal).toEqual({
      kind: "tailnet",
      login: LINKED,
      self: true,
      tailscaleId: "nQRJl4CNTRL",
    });
  });

  // ---- UA-P-0a (D1): the desktop with no account ----

  it("UA-P-0a: an UNLINKED desktop grants a guest, never the preset", async () => {
    // THE FLIP. This row used to assert the opposite — an unlinked desktop
    // handing the whole `TAILNET_SCOPES` preset (canvas.write, agent.spawn,
    // agent.control, approval.respond, terminal.attach) to any login the
    // tailnet verified. James ruled the posture derives from the link: unlinked
    // is a default LOCAL account and the desktop is offline, so no serve is
    // declared and this door is not on the tailnet at all. If something reaches
    // it anyway — a serve left live across a posture change, a stale sidecar
    // route — the answer is zero scopes, because a desktop that does not know
    // which account it is cannot know that this caller is it.
    const { port } = await api(undefined, null);
    const ws = await dial(port, {
      path: `/t/${SECRET}`,
      headers: { "Tailscale-User-Login": LINKED },
    });
    const ack = (await call(ws, 1, "system.hello", hello())) as {
      result: { grantedScopes: string[] };
    };
    expect(ack.result.grantedScopes).toEqual([]);

    const probe = (await call(ws, 2, "device.list", {})) as {
      error: { data: { kind: string } };
    };
    expect(probe.error.data.kind).toBe("FORBIDDEN_SCOPE");
  });

  it("UA-P-0a: the guest mint does not depend on the caller's clientKind", async () => {
    // a colleague's fieldd reaching an account-less desktop is a guest too —
    // the comparison decides, never the claim (UA-D5, and the same law that
    // makes a foreign login a guest on a LINKED desktop)
    const { port } = await api(
      (nodeId) => (nodeId === "nQRJl4CNTRL" ? "dev-roster" : undefined),
      null,
    );
    const ws = await dial(port, {
      path: `/t/${SECRET}`,
      headers: {
        "Tailscale-User-Login": LINKED,
        "Tailscale-Node-Id": "nQRJl4CNTRL",
      },
    });
    const ack = (await call(ws, 1, "system.hello", hello())) as {
      result: { grantedScopes: string[] };
    };
    expect(ack.result.grantedScopes).toEqual([]);
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
      headers: { "Tailscale-User-Login": LINKED },
    });
    await closed(ws);
    expect(ws.readyState).toBe(WebSocket.CLOSED);
  });

  it("a verified token on the tailnet door wins — real local grant, tailnet transport", async () => {
    const { port } = await api();
    const ws = await dial(port, {
      path: `/t/${SECRET}`,
      headers: { "Tailscale-User-Login": LINKED },
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
      headers: { "Tailscale-User-Login": LINKED },
    });
    // "/t/..." is just an ordinary path now: headers ignored, token required
    const res = (await call(ws, 1, "system.hello", hello())) as {
      error: { data: { kind: string } };
    };
    expect(res.error.data.kind).toBe("UNAUTHORIZED");
  });
});
