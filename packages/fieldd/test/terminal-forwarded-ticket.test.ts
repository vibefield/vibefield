// DS-4 — a terminal on another desktop, the CALLER's half (thinking-desktop-
// sync-plane.md §6.3 steps 1, 4 and 5; design-06 §6). Desktop B's window asks
// its own daemon for a ticket to a session that lives on desktop A; B forwards
// the call whole, A mints from ITS rule and answers its cell's TAILNET doors,
// and B carries those doors onto an egress route of its own before its window
// sees them. These rows drive B's two seams in isolation — the forwarder wrap
// (`TerminalService.forwardVia`) and the port (`remote-cell-rewriter.ts`) —
// with the owner played by a minter; the two-daemon road is the e2e beside
// this file.
import {
  CONTRACTS_VERSION,
  type RemoteCellEndpointSet,
  remoteCellEndpointsFor,
  TerminalOpenTicketResult,
} from "@vibefield/contracts";
import { afterEach, describe, expect, it, vi } from "vitest";
import WebSocket from "ws";
import { RpcCallError } from "../src/native-link";
import { type DeviceForwarder, ProductApi } from "../src/product-api";
import {
  egressRouteRewriter,
  egressTarget,
  loopbackCellEndpoints,
  NO_EGRESS,
  type RemoteCellRewriter,
} from "../src/remote-cell-rewriter";
import {
  type CellGrantKey,
  type GrantPrincipal,
  TerminalGrantMinter,
} from "../src/terminal-grants";
import { TerminalService } from "../src/terminal-service";
import { TEST_LOGIN } from "./link-fixture";
import { WsRpc } from "./ws-rpc";

const OWNER = "dev-a";
const OWNER_KEY: CellGrantKey = { cellBootId: "cell-a", keyHex: "5e".repeat(32), keyGeneration: 1 };
/** The owner's cell doors exactly as its daemon composes them for a tailnet
 * client (`remoteCellEndpointsFor` over the serve's base URL). */
const OWNER_DOORS = remoteCellEndpointsFor(
  "http://desk-a.tail1234.ts.net:9422",
  "cell-a",
) as RemoteCellEndpointSet;
const LISTEN = "127.0.0.1:61234";

/** B's window, B's plugin, and the phone reaching B (its home). */
const WINDOW: GrantPrincipal = {
  kind: "local-token",
  tokenId: "tok-w",
  rendererParticipant: { participantId: "p-1", incarnation: "doc-1" },
};
const PLUGIN: GrantPrincipal = { kind: "plugin", tokenId: "tok-p" };
const PHONE: GrantPrincipal = { kind: "tailnet", login: TEST_LOGIN, self: true };

/** What A's daemon answers a forwarded `terminal.openTicket`: minted for B's
 * daemon (a self peer — the self set), its cell's tailnet doors. */
function ownersTicket(doors: unknown = OWNER_DOORS) {
  const minted = new TerminalGrantMinter(() => 1_000_000, "epochA").mintTicket({
    key: OWNER_KEY,
    principal: { kind: "peer-fieldd", deviceId: "dev-b" },
    sessionId: "pane-a",
    route: { cellBootId: "cell-a", routeRevision: 4 },
    doors: OWNER_DOORS,
  });
  return { ...minted, endpoints: doors };
}

function ctx(principal: GrantPrincipal) {
  return {
    principal,
    transport: "ws-loopback",
    receivedAt: 0,
    signal: new AbortController().signal,
  } as unknown as Parameters<DeviceForwarder>[3];
}

function service(rewriter?: RemoteCellRewriter): TerminalService {
  return new TerminalService({
    link: {
      subscribe: async () => ({ snapshot: {} }),
      terminalEndpoints: undefined,
      on: () => undefined,
    },
    ...(rewriter === undefined ? {} : { remoteCellRewriter: rewriter }),
  });
}

/** The fake egress facade: one loopback listener per owner serve. */
function fakeEgress() {
  const routes: Array<{ deviceId: string; target: string }> = [];
  const rewriter = egressRouteRewriter(async (route) => {
    routes.push(route);
    return { listen: LISTEN };
  });
  return { rewriter, routes };
}

async function refusal(promise: Promise<unknown>): Promise<RpcCallError> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof RpcCallError) return error;
    throw error;
  }
  throw new Error("expected a refusal");
}

describe("the RemoteCellRewriter port", () => {
  it("re-homes both doors onto one loopback listener, paths kept", () => {
    expect(egressTarget(OWNER_DOORS)).toBe("desk-a.tail1234.ts.net:9422");
    expect(loopbackCellEndpoints(OWNER_DOORS, LISTEN)).toEqual({
      controlUrl: `ws://${LISTEN}/cell/cell-a/control`,
      framesUrl: `ws://${LISTEN}/cell/cell-a/frames`,
    });
    // an implicit port is the scheme's own
    expect(
      egressTarget({
        controlUrl: "wss://desk-a.ts.net/cell/c/control",
        framesUrl: "wss://desk-a.ts.net/cell/c/frames",
      }),
    ).toBe("desk-a.ts.net:443");
  });

  it("refuses a pair that is not one serve's, and a listener that is not loopback", async () => {
    const split = {
      controlUrl: "ws://desk-a.ts.net:9422/cell/c/control",
      framesUrl: "ws://desk-z.ts.net:9422/cell/c/frames",
    };
    expect(egressTarget(split)).toBeUndefined();
    expect(loopbackCellEndpoints(OWNER_DOORS, "10.0.0.5:61234")).toBeUndefined();

    const ensure = vi.fn(async () => ({ listen: LISTEN }));
    const splitAnswer = await egressRouteRewriter(ensure).rewrite(OWNER, split);
    expect(splitAnswer).toMatchObject({ unavailable: { state: "egress_unavailable" } });
    expect(ensure).not.toHaveBeenCalled();
    const outward = await egressRouteRewriter(async () => ({ listen: "10.0.0.5:1" })).rewrite(
      OWNER,
      OWNER_DOORS,
    );
    expect(outward).toMatchObject({ unavailable: { state: "egress_unavailable", device: OWNER } });
    const none = await egressRouteRewriter(async () => undefined).rewrite(OWNER, OWNER_DOORS);
    expect(none).toMatchObject({ unavailable: { state: "egress_unavailable", device: OWNER } });
  });

  it("answers UNAVAILABLE by default — no egress facade exists until DS-1", async () => {
    expect(await NO_EGRESS.rewrite(OWNER, OWNER_DOORS)).toEqual({
      unavailable: { service: "terminal", state: "egress_unavailable", device: OWNER },
      message: expect.any(String),
    });
  });
});

describe("TerminalService.forwardVia — the forwarded ticket on the caller's desktop", () => {
  it("gives a window HERE the owner's grants on doors it can dial: the egress route's loopback pair", async () => {
    const { rewriter, routes } = fakeEgress();
    const owner = ownersTicket();
    const inner = vi.fn<DeviceForwarder>(async () => owner);
    const answer = await service(rewriter).forwardVia(inner)(
      OWNER,
      "terminal.openTicket",
      { device: OWNER, sessionId: "pane-a" },
      ctx(WINDOW),
    );
    // the call went to the owner WHOLE (ProductApi's convention: the owner
    // strips its own id and serves)
    expect(inner).toHaveBeenCalledWith(
      OWNER,
      "terminal.openTicket",
      { device: OWNER, sessionId: "pane-a" },
      expect.anything(),
      // DS-2 landed beside DS-4 (2026-10-01): the forwarder carries a fifth argument,
      // the forwarding envelope; this test invokes the wrapper without one.
      undefined,
    );
    const ticket = TerminalOpenTicketResult.parse(answer);
    expect(ticket.endpoints).toEqual({
      controlUrl: `ws://${LISTEN}/cell/cell-a/control`,
      framesUrl: `ws://${LISTEN}/cell/cell-a/frames`,
    });
    // ONE route, to the owner's cell serve
    expect(routes).toEqual([{ deviceId: OWNER, target: "desk-a.tail1234.ts.net:9422" }]);
    // …and the grants are the OWNER's, byte for byte — a coordinate moved, no
    // authority did (the owner's cell verifies these MACs whatever socket
    // carries them)
    expect(ticket.transportGrant).toEqual(owner.transportGrant);
    expect(ticket.attachGrant).toEqual(owner.attachGrant);
    expect(ticket.route).toEqual(owner.route);
    expect(ticket.attachGrant.claims.rights).toEqual(["geometry", "input", "read"]);
  });

  it("answers UNAVAILABLE egress_unavailable while no egress route exists — never the owner's coordinate", async () => {
    const error = await refusal(
      service().forwardVia(async () => ownersTicket())(
        OWNER,
        "terminal.openTicket",
        { device: OWNER, sessionId: "pane-a" },
        ctx(WINDOW),
      ),
    );
    expect(error.kind).toBe("UNAVAILABLE");
    expect(error.retryable).toBe(true);
    expect(error.details).toEqual({
      service: "terminal",
      state: "egress_unavailable",
      device: OWNER,
    });
  });

  it("hands the phone (reaching its home) the owner's TAILNET pair: its own node dials it", async () => {
    const { rewriter, routes } = fakeEgress();
    const answer = await service(rewriter).forwardVia(async () => ownersTicket())(
      OWNER,
      "terminal.openTicket",
      { device: OWNER, sessionId: "pane-a" },
      ctx(PHONE),
    );
    expect(TerminalOpenTicketResult.parse(answer).endpoints).toEqual(OWNER_DOORS);
    expect(routes).toEqual([]); // no route on THIS desktop for a caller that is not on it
  });

  it("refuses to carry a MINT for a caller it would mint read-only here — no laundering through a peer", async () => {
    const inner = vi.fn<DeviceForwarder>(async () => ownersTicket());
    const forward = service(fakeEgress().rewriter).forwardVia(inner);
    for (const method of ["terminal.openTicket", "terminal.renewAttach"]) {
      const error = await refusal(
        forward(OWNER, method, { device: OWNER, sessionId: "pane-a" }, ctx(PLUGIN)),
      );
      expect(error.kind, method).toBe("FORBIDDEN_SCOPE");
      expect(error.details, method).toEqual({ method, device: OWNER });
    }
    expect(inner).not.toHaveBeenCalled();
    // `terminate` is no mint: the plugin's scope already passed HERE, and the
    // owner enforces its own — the call is carried, the answer untouched
    inner.mockResolvedValueOnce({ terminated: true });
    expect(
      await forward(
        OWNER,
        "terminal.terminate",
        { device: OWNER, sessionId: "pane-a" },
        ctx(PLUGIN),
      ),
    ).toEqual({ terminated: true });
  });

  it("refuses an owner that answers its OWN loopback pair — that coordinate is on its machine", async () => {
    const error = await refusal(
      service(fakeEgress().rewriter).forwardVia(async () =>
        ownersTicket({
          controlUrl: "ws://127.0.0.1:49152/control",
          framesUrl: "ws://127.0.0.1:49152/frames",
        }),
      )(OWNER, "terminal.openTicket", { device: OWNER, sessionId: "pane-a" }, ctx(WINDOW)),
    );
    expect(error.kind).toBe("UNAVAILABLE");
    expect(error.details).toEqual({
      service: "terminal",
      state: "doors_not_published",
      device: OWNER,
    });
  });

  it("names an answer that is not a ticket INCOMPATIBLE", async () => {
    const error = await refusal(
      service(fakeEgress().rewriter).forwardVia(async () => ({ endpoints: "?" }))(
        OWNER,
        "terminal.openTicket",
        { device: OWNER, sessionId: "pane-a" },
        ctx(WINDOW),
      ),
    );
    expect(error.kind).toBe("INCOMPATIBLE");
    expect(error.retryable).toBe(false);
  });

  it("passes every other forward through untouched: a renewal, and any other method", async () => {
    const forward = service(fakeEgress().rewriter).forwardVia(async (_d, method) =>
      method === "terminal.renewAttach" ? { attachGrant: "the owner's" } : { rows: [1] },
    );
    expect(
      await forward(
        OWNER,
        "terminal.renewAttach",
        { device: OWNER, sessionId: "pane-a", expectGeneration: 1, requestId: "r1" },
        ctx(WINDOW),
      ),
    ).toEqual({ attachGrant: "the owner's" });
    expect(await forward(OWNER, "device.list", { device: OWNER }, ctx(PLUGIN))).toEqual({
      rows: [1],
    });
  });
});

// S1 (the landing review, 2026-10-01) — DS-2 made the two BIRTHS `federate`,
// and each answers the ticket its pane mounts, minted by the owner. So a birth
// is a mint at the forwarding door (refused for a caller this daemon would
// mint read-only), and its `terminal` is adopted on the way back exactly as a
// forwarded `terminal.openTicket` is.
describe("TerminalService.forwardVia — a forwarded BIRTH (agent.spawn, agent.resume)", () => {
  /** A row as the owner summarizes it — opaque here: forwardVia never reads it. */
  const SESSION = { runtimeRunId: "run-a", tier: "managed", kind: "scripted", device: OWNER };

  /** What A's daemon answers a forwarded birth: the run's row and the ticket
   * for its pane, minted for B's daemon on A's tailnet doors. */
  function ownersBirth() {
    return {
      session: SESSION,
      terminal: {
        sessionId: "pane-a",
        session: { id: "pane-a", title: "agent" },
        ...ownersTicket(),
      },
    };
  }

  it("refuses to carry a birth for a caller it would mint read-only — before anything is forwarded", async () => {
    const inner = vi.fn<DeviceForwarder>(async () => ownersBirth());
    const forward = service(fakeEgress().rewriter).forwardVia(inner);
    const asks: Array<[string, Record<string, unknown>]> = [
      ["agent.spawn", { device: OWNER, provider: "scripted" }],
      ["agent.resume", { device: OWNER, runtimeRunId: "run-old" }],
    ];
    for (const [method, params] of asks) {
      const error = await refusal(forward(OWNER, method, params, ctx(PLUGIN)));
      expect(error.kind, method).toBe("FORBIDDEN_SCOPE");
      expect(error.details, method).toEqual({ method, device: OWNER });
    }
    // an agent's own token is no self principal either
    const agent = await refusal(
      forward(
        OWNER,
        "agent.spawn",
        { device: OWNER, provider: "scripted" },
        ctx({ kind: "mcp-agent", tokenId: "tok-a" }),
      ),
    );
    expect(agent.kind).toBe("FORBIDDEN_SCOPE");
    expect(inner).not.toHaveBeenCalled();
  });

  it("adopts a window's birth ticket onto an egress route — the owner's grants and row untouched", async () => {
    const { rewriter, routes } = fakeEgress();
    const owner = ownersBirth();
    for (const method of ["agent.spawn", "agent.resume"]) {
      const answer = (await service(rewriter).forwardVia(async () => owner)(
        OWNER,
        method,
        { device: OWNER, provider: "scripted" },
        ctx(WINDOW),
      )) as { session: unknown; terminal: Record<string, unknown> };
      expect(answer.session, method).toBe(SESSION); // the row, as the owner gave it
      const ticket = TerminalOpenTicketResult.parse(answer.terminal);
      expect(ticket.endpoints, method).toEqual({
        controlUrl: `ws://${LISTEN}/cell/cell-a/control`,
        framesUrl: `ws://${LISTEN}/cell/cell-a/frames`,
      });
      expect(ticket.attachGrant, method).toEqual(owner.terminal.attachGrant);
      expect(ticket.transportGrant, method).toEqual(owner.terminal.transportGrant);
      // the create-result half of the ticket rides through too
      expect(answer.terminal["sessionId"], method).toBe("pane-a");
      expect(answer.terminal["session"], method).toEqual({ id: "pane-a", title: "agent" });
    }
    expect(routes).toEqual([
      { deviceId: OWNER, target: "desk-a.tail1234.ts.net:9422" },
      { deviceId: OWNER, target: "desk-a.tail1234.ts.net:9422" },
    ]);
  });

  it("answers a born run with no reachable doors honestly: UNAVAILABLE egress_unavailable, the run named, never retryable", async () => {
    // the default rewriter: no egress route can be placed yet
    const error = await refusal(
      service().forwardVia(async () => ownersBirth())(
        OWNER,
        "agent.spawn",
        { device: OWNER, provider: "scripted" },
        ctx(WINDOW),
      ),
    );
    expect(error.kind).toBe("UNAVAILABLE");
    // the agent IS running on the owner: a retried spawn would birth another
    expect(error.retryable).toBe(false);
    expect(error.message).toContain("born (run-a)");
    expect(error.details).toEqual({
      service: "terminal",
      state: "egress_unavailable",
      device: OWNER,
      runtimeRunId: "run-a",
      session: SESSION,
      reason: { kind: "UNAVAILABLE", state: "egress_unavailable" },
    });
  });

  it("hands the phone the owner's tailnet doors on a birth, as on a ticket", async () => {
    const { rewriter, routes } = fakeEgress();
    const answer = (await service(rewriter).forwardVia(async () => ownersBirth())(
      OWNER,
      "agent.spawn",
      { device: OWNER, provider: "scripted" },
      ctx(PHONE),
    )) as { terminal: unknown };
    expect(TerminalOpenTicketResult.parse(answer.terminal).endpoints).toEqual(OWNER_DOORS);
    expect(routes).toEqual([]);
  });

  it("passes a birth answer that carries no terminal through unchanged", async () => {
    const bare = { session: SESSION };
    const forward = service().forwardVia(async () => bare);
    expect(
      await forward(OWNER, "agent.spawn", { device: OWNER, provider: "scripted" }, ctx(WINDOW)),
    ).toBe(bare);
    // and an answer that is not an object at all
    const odd = service().forwardVia(async () => null);
    expect(
      await odd(OWNER, "agent.resume", { device: OWNER, runtimeRunId: "r" }, ctx(WINDOW)),
    ).toBeNull();
  });
});

// The same wrap installed where the daemon installs it: ProductApi's `device?`
// routing. What this adds over the rows above is the REGISTRY — the terminal
// doors are `federate` now, so a foreign `device` forwards instead of being
// refused as local (D36, product-api.ts), and a peer daemon reaches the mint.
describe("the terminal doors ride the device? routing (DS-4)", () => {
  let cleanup: Array<() => void | Promise<void>> = [];
  afterEach(async () => {
    for (const fn of cleanup.reverse()) await fn();
    cleanup = [];
  });
  const SECRET = "3q2fN8pXvKb0aH5sYw1LrTz9cUeD7RgM";

  async function api(forwarder: DeviceForwarder, rewriter?: RemoteCellRewriter) {
    const a = new ProductApi({
      port: 0,
      tokens: {
        verify: (t) =>
          t === "window-token"
            ? {
                tokenId: "tw",
                scopes: ["terminal.attach"],
                label: "window",
                rendererParticipant: { participantId: "p-1", incarnation: "doc-1" },
              }
            : null,
      },
      tailnetPathSecret: SECRET,
      getLinkedLogin: () => TEST_LOGIN,
    });
    a.setDeviceRouting(() => "dev-b", service(rewriter).forwardVia(forwarder));
    a.register("terminal.openTicket", (c, params) => ({
      served: "here",
      principal: c.principal,
      params,
    }));
    a.register("terminal.list", () => ({ items: [] }));
    const port = await a.listen();
    cleanup.push(() => a.close());
    return port;
  }

  async function dial(port: number, path = "/", headers?: Record<string, string>) {
    const ws = new WebSocket(`ws://127.0.0.1:${port}${path}`, headers ? { headers } : {});
    cleanup.push(() => ws.close());
    await new Promise<void>((resolve, reject) => {
      ws.once("open", () => resolve());
      ws.once("error", reject);
    });
    return new WsRpc(ws);
  }

  it("forwards a window's openTicket for another desktop and hands back loopback doors", async () => {
    const forwarder = vi.fn<DeviceForwarder>(async () => ownersTicket());
    const port = await api(forwarder, fakeEgress().rewriter);
    const rpc = await dial(port);
    await rpc.call("system.hello", {
      contractsVersion: CONTRACTS_VERSION,
      minCompatible: CONTRACTS_VERSION,
      clientKind: "renderer",
      credential: "window-token",
    });
    const ticket = TerminalOpenTicketResult.parse(
      await rpc.call("terminal.openTicket", { device: OWNER, sessionId: "pane-a" }),
    );
    expect(forwarder).toHaveBeenCalledTimes(1);
    expect(ticket.endpoints.controlUrl).toBe(`ws://${LISTEN}/cell/cell-a/control`);
    // own id: served here, the routing key stripped
    expect(await rpc.call("terminal.openTicket", { device: "dev-b", sessionId: "pane-b" })).toEqual(
      expect.objectContaining({ served: "here", params: { sessionId: "pane-b" } }),
    );
  });

  it("serves a self peer DAEMON the mint — and still refuses it a door that stayed local", async () => {
    const port = await api(vi.fn());
    const rpc = await dial(port, `/t/${SECRET}`, { "Tailscale-User-Login": TEST_LOGIN });
    await rpc.call("system.hello", {
      contractsVersion: CONTRACTS_VERSION,
      minCompatible: CONTRACTS_VERSION,
      clientKind: "peer-fieldd",
      deviceId: "dev-c",
    });
    expect(await rpc.call("terminal.openTicket", { sessionId: "pane-b" })).toEqual(
      expect.objectContaining({
        served: "here",
        principal: { kind: "peer-fieldd", deviceId: "dev-c" },
      }),
    );
    const refused = await rpc.callErr("terminal.list", {});
    expect(refused.data?.kind).toBe("FORBIDDEN_SCOPE");
  });
});
