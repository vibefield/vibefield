// The C3 tailnet door (thinking-c3 §1), unit-level: a standalone ProductApi
// with a scripted token service, driven by real ws clients that can set the
// headers/paths the sidecar would. The SPOOF test is the point: EL7's same-uid
// adversary can type Tailscale-User-* headers on the ordinary door and must
// get nothing.
import { CONTRACTS_VERSION, DEVICE_REFUSALS, TAILNET_SCOPES } from "@vibefield/contracts";
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
  // D1 (2026-10-01) — the second roster fact the peer kind needs
  isDocHost?: (deviceId: string) => boolean,
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
    ...(isDocHost ? { isDocHost } : {}),
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
    // to the roster device, and the hello's own deviceId cannot move it. D1
    // (2026-10-01): that roster row is a desktop's (`docHost`), which is what
    // lets the kind be minted at all.
    const { port } = await api(
      (nodeId) => (nodeId === "nQRJl4CNTRL" ? "dev-roster" : undefined),
      LINKED,
      (deviceId) => deviceId === "dev-roster",
    );
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
    // DS-D15 (2026-09-30) — the node id is KEPT beside the device it correlated
    // to, so the audit actor names the node that dialled (never the claim)
    expect(probe.result.principal).toEqual({
      kind: "peer-fieldd",
      deviceId: "dev-roster",
      tailscaleId: "nQRJl4CNTRL",
    });
  });

  it("D1: a correlation miss is no peer — the C5 claim buys nothing (mixed fleet)", async () => {
    // the node id is present but the registry doesn't know it yet (roster
    // stale / peer unpublished). THE FLIP (D1, 2026-10-01): this row asserted
    // the C5 claim stood in — `peer-fieldd {deviceId: "dev-claimed"}`, the
    // peer preset for a device id the caller typed. The kind is the
    // transport's to give now, so the caller is the phone's principal, the
    // node recorded beside its login; the door asks it for a fresh hello once
    // the roster can vouch for the node (guest-door.test.ts).
    const { port } = await api(
      () => undefined,
      LINKED,
      () => true,
    );
    const ws = await dial(port, {
      path: `/t/${SECRET}`,
      headers: {
        "Tailscale-User-Login": LINKED,
        "Tailscale-Node-Id": "nUNKNOWN01",
      },
    });
    const ack = (await call(ws, 1, "system.hello", { ...hello(), deviceId: "dev-claimed" })) as {
      result: { grantedScopes: string[] };
    };
    expect(ack.result.grantedScopes).toEqual([...TAILNET_SCOPES]);
    const probe = (await call(ws, 2, "device.list", {})) as {
      result: { principal: { kind: string; deviceId: string } };
    };
    expect(probe.result.principal).toEqual({
      kind: "tailnet",
      login: LINKED,
      self: true,
      tailscaleId: "nUNKNOWN01",
    });
  });

  it("D1: a door told nothing about desktops mints no peer, even for a correlated node", async () => {
    // `isDocHost` unset: no device is one (an embedded or unit door that wants
    // a peer must say which devices are desktops)
    const { port } = await api((nodeId) => (nodeId === "nQRJl4CNTRL" ? "dev-roster" : undefined));
    const ws = await dial(port, {
      path: `/t/${SECRET}`,
      headers: {
        "Tailscale-User-Login": LINKED,
        "Tailscale-Node-Id": "nQRJl4CNTRL",
      },
    });
    await call(ws, 1, "system.hello", hello());
    const probe = (await call(ws, 2, "device.list", {})) as {
      result: { principal: { kind: string } };
    };
    expect(probe.result.principal.kind).toBe("tailnet");
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

  it("UA-P-0d: the path a TAILNET caller dials is worthless on loopback", async () => {
    // D7 moved the secret to the sidecar's TARGET path, so a phone now dials
    // the bare root and the sidecar adds the secret on forward. That makes the
    // public path something everyone knows — which is fine, and this row is why:
    // the door has never trusted the path a caller asks for, only the path it
    // ARRIVES on at the loopback port. A same-uid process (EL7's adversary) can
    // dial exactly what the phone dials, with exactly the headers the sidecar
    // injects, and still gets nothing.
    const { port } = await api();
    const ws = await dial(port, {
      path: "/",
      headers: {
        "Tailscale-User-Login": LINKED,
        "Tailscale-Node-Id": "nQRJl4CNTRL",
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

// Item 406 (track WI's Desktop slice; VF-PM's rulings of 2026-11-14 04:49Z, Q-PM5 and Q-PM6) — a
// phone Remove refused, at the door it reaches this desktop through. The upgrade marks it from the
// transport's facts alone (`classifyDoor`: the node id the sidecar injected on the secret path),
// and its hello is answered with the typed word BEFORE the verified-token arm, which otherwise wins
// on either door; then the door closes. While any refusal stands, a same-login hello the sidecar named
// no node for is refused too, in a word of its own: the door can tell it neither from the removed
// phone nor that it is it. A peer daemon's forward FOR a refused phone is refused before it runs
// and is not retryable: the belt behind the phone's home refusing it at its own door.
describe("406 — a removed phone at the door", () => {
  const REMOVED_NODE = "nREMOVED01";
  const removedWord = {
    kind: "UNAUTHORIZED",
    retryable: false,
    details: { reason: DEVICE_REFUSALS.REASON_REMOVED },
  };

  /** A door whose roster refuses `REMOVED_NODE` (and its device, `dev-removed`), `stand` saying
   * whether any refusal stands; `dev-desk` (node `nDESK01`) is one of the account's desktops. Its
   * `device.list` probe notes whom each call it served was for. */
  async function refusing(
    stand = true,
  ): Promise<{ api: ProductApi; port: number; served: string[] }> {
    const served: string[] = [];
    const a = new ProductApi({
      port: 0,
      tokens: {
        verify: (t) =>
          t === "good-token"
            ? { tokenId: "tk1", scopes: ["doc.read", "workspace.read"], label: "t" }
            : null,
      },
      tailnetPathSecret: SECRET,
      getLinkedLogin: () => LINKED,
      correlateNodeId: (nodeId) => (nodeId === "nDESK01" ? "dev-desk" : undefined),
      isDocHost: (deviceId) => deviceId === "dev-desk",
      isRefusedNode: (nodeId) => nodeId === REMOVED_NODE,
      refusalsStand: () => stand,
      isRefusedDevice: (deviceId) => deviceId === "dev-removed",
    });
    a.register("device.list", (ctx) => {
      served.push(ctx.onBehalfOf?.clientDeviceId ?? ctx.principal.kind);
      return { principal: ctx.principal };
    });
    const port = await a.listen();
    cleanup.push(() => a.close());
    return { api: a, port, served };
  }

  /** The secret path as the sidecar delivers a caller of the linked login, from `node` if any. */
  const fromNode = (port: number, node?: string, login = LINKED) =>
    dial(port, {
      path: `/t/${SECRET}`,
      headers: {
        "Tailscale-User-Login": login,
        ...(node !== undefined ? { "Tailscale-Node-Id": node } : {}),
      },
    });
  const phoneHello = (credential?: string) => ({ ...hello(credential), clientKind: "ios" });

  it("a refused node hears the typed word at its hello and the door closes, whatever it carries — BEFORE the verified-token arm", async () => {
    const { port } = await refusing();
    for (const credential of [undefined, "good-token"]) {
      const ws = await fromNode(port, REMOVED_NODE);
      const res = (await call(ws, 1, "system.hello", phoneHello(credential))) as {
        error?: { code: number; data: unknown };
      };
      expect(res.error?.data, String(credential)).toEqual(removedWord);
      expect(res.error?.code).toBe(-32001);
      await closed(ws);
    }
  });

  it("a node not refused is unchanged while a refusal stands: the preset, or its token's grant", async () => {
    const { port } = await refusing();
    const phone = await fromNode(port, "nPHONE02");
    const ack = (await call(phone, 1, "system.hello", phoneHello())) as {
      result: { grantedScopes: string[] };
    };
    expect(ack.result.grantedScopes).toEqual([...TAILNET_SCOPES]);
    const withToken = await fromNode(port, "nPHONE02");
    const tokenAck = (await call(withToken, 1, "system.hello", hello("good-token"))) as {
      result: { grantedScopes: string[] };
    };
    expect(tokenAck.result.grantedScopes).toEqual(["doc.read", "workspace.read"]);
  });

  it("while a refusal stands, a same-login hello with no node id is refused in its own word, never device-removed; a guest, and a door with none standing, are unchanged", async () => {
    const { port } = await refusing();
    for (const credential of [undefined, "good-token"]) {
      const ws = await fromNode(port);
      const res = (await call(ws, 1, "system.hello", phoneHello(credential))) as {
        error?: { data: unknown };
      };
      expect(res.error?.data, String(credential)).toEqual({
        kind: "UNAUTHORIZED",
        retryable: false,
        details: { reason: DEVICE_REFUSALS.REASON_UNIDENTIFIED },
      });
      await closed(ws);
    }
    // another login is a guest, as it was: never one of this account's devices
    const guest = await fromNode(port, undefined, "colleague@corp.example");
    const guestAck = (await call(guest, 1, "system.hello", hello())) as {
      result: { grantedScopes: string[] };
    };
    expect(guestAck.result.grantedScopes).toEqual([]);
    // no refusal standing: the same hello is the preset, as before 406
    const calm = await refusing(false);
    const before = await fromNode(calm.port);
    const beforeAck = (await call(before, 1, "system.hello", phoneHello())) as {
      result: { grantedScopes: string[] };
    };
    expect(beforeAck.result.grantedScopes).toEqual([...TAILNET_SCOPES]);
  });

  it("a peer daemon's forward FOR a refused phone is refused before it runs, not retryable; its forward for another phone, or a window, is served", async () => {
    const { port, served } = await refusing();
    const peer = await fromNode(port, "nDESK01");
    await call(peer, 1, "system.hello", hello());
    const forward = (clientDeviceId?: string) => ({
      forward: {
        onBehalfOf:
          clientDeviceId !== undefined
            ? { clientKind: "ios", deviceId: "dev-desk", clientDeviceId }
            : { clientKind: "renderer", deviceId: "dev-desk", windowId: "w-1" },
      },
    });
    const refused = (await call(peer, 2, "device.list", forward("dev-removed"))) as {
      error?: { data: unknown };
    };
    expect(refused.error?.data).toEqual(removedWord);
    expect(served).toEqual([]);
    await call(peer, 3, "device.list", forward("dev-phone"));
    await call(peer, 4, "device.list", forward());
    expect(served).toEqual(["dev-phone", "peer-fieldd"]);
  });

  it("the sweep's node step closes every connection from the named nodes, said its hello or not, and no other", async () => {
    const { api: door, port } = await refusing(false);
    const helloed = await fromNode(port, "nPHONE03");
    await call(helloed, 1, "system.hello", phoneHello());
    const silent = await fromNode(port, "nPHONE03");
    const other = await fromNode(port, "nPHONE04");
    await call(other, 1, "system.hello", phoneHello());
    expect(door.dropNodeConnections(["nPHONE03"])).toBe(2);
    await closed(helloed);
    await closed(silent);
    const still = (await call(other, 2, "device.list", {})) as { result: unknown };
    expect(still.result).toBeDefined();
    expect(door.dropNodeConnections(["nPHONE03"])).toBe(0);
  });
});
