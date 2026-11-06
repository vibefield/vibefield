// DS-7 (2026-10-31) — a forwarded index ticket, the half on the WINDOW's
// desktop (src/index-forward.ts): the ask is carried only for a window or the
// shell; the owner's tailnet set is re-homed onto ONE egress route per owner
// desktop to its index serve, the grant untouched; no road is
// `egress_unavailable`, an owner with no doors a window here can reach is
// `doors_not_published`, both naming the owner; the route comes down when the
// owner leaves the roster and at daemon stop. The two-daemon rows are in
// index-open-ticket.test.ts.
// SP-7b (2026-11-06; `SP-7b-plan.md` 7b-1) — this person's phone is carried
// too, from its home: its ask goes whole, and the owner's tailnet set comes
// back as the owner answered it, read first and never re-homed (the phone's
// node dials the owner's serve itself), so no route is asked for.
import {
  type CallerContext,
  INDEX_TICKET,
  IndexEndpointSet,
  type IndexOpenTicket,
  IndexTicketRoadDetails,
  PORTS,
  RemoteIndexEndpointSet,
  remoteIndexEndpointsFor,
} from "@vibefield/contracts";
import { afterEach, describe, expect, it } from "vitest";
import { FakeEgressRoutes } from "../src/egress";
import { IndexTicketForwarding } from "../src/index-forward";
import { RpcCallError } from "../src/native-link";
import type { DeviceForwarder } from "../src/product-api";

const INDEX = PORTS.INDEX_SERVE;
const OWNER = "dev-a";
const LISTEN = "127.0.0.1:61240";
const GRANT = "eyJjaWQiOiJ4In0.bWFj";

let cleanup: Array<() => void> = [];
afterEach(() => {
  for (const fn of cleanup.reverse()) fn();
  cleanup = [];
});

const ctxOf = (principal: Record<string, unknown>): CallerContext =>
  ({ principal, transport: "ws-loopback", receivedAt: 0 }) as CallerContext;
const WINDOW = ctxOf({
  kind: "local-token",
  tokenId: "tk_000000000001",
  scopes: ["index.read"],
  rendererParticipant: { participantId: "renderer:b:1", incarnation: "renderer:b:1:doc-1" },
});

/** The owner's own answer to a peer daemon: its index serve's tailnet set. */
function ownerTicket(sessionId = "s1", over: Partial<IndexOpenTicket> = {}): IndexOpenTicket {
  return {
    device: OWNER,
    endpoints: remoteIndexEndpointsFor(
      `http://desk-a.tail1234.ts.net:${INDEX}`,
      sessionId,
    ) as IndexOpenTicket["endpoints"],
    grant: GRANT,
    expiresAt: 1_790_000_060_000,
    ...over,
  };
}

/** A forwarder that answers `answer` (or throws it) and counts its calls. */
function owner(answer: unknown | (() => never)): DeviceForwarder & { calls: string[] } {
  const calls: string[] = [];
  const forward: DeviceForwarder = async (device, method) => {
    calls.push(`${device} ${method}`);
    if (typeof answer === "function") return (answer as () => never)();
    return answer;
  };
  return Object.assign(forward, { calls });
}

function over(routes = new FakeEgressRoutes()) {
  const forwarding = new IndexTicketForwarding({ routes });
  cleanup.push(() => forwarding.dispose());
  return { routes, forwarding };
}

async function refusalOf(run: () => Promise<unknown>): Promise<RpcCallError> {
  try {
    await run();
  } catch (error) {
    if (error instanceof RpcCallError) return error;
    throw error;
  }
  throw new Error("expected a refusal");
}

/** A forward's answer, or its refusal's words: a row then fails on an
 * assertion, never on a throw past it (SP-7b). */
async function outcomeOf(run: () => Promise<unknown>): Promise<unknown> {
  try {
    return await run();
  } catch (error) {
    return String(error);
  }
}

describe("DS-7 — the forward is carried only for a window or the shell", () => {
  it("every other method passes through untouched, whoever asks", async () => {
    const { forwarding, routes } = over();
    const inner = owner({ rows: [] });
    const answer = await forwarding.forwardVia(inner)(
      OWNER,
      "index.sessions",
      { scope: "mesh" },
      ctxOf({ kind: "plugin", id: "p", scopes: ["index.search"] }),
    );
    expect(answer).toEqual({ rows: [] });
    expect(inner.calls).toEqual([`${OWNER} index.sessions`]);
    expect(routes.asked).toEqual([]);
  });

  it("a plugin, an agent, a guest, a tailnet caller who is not this person and a relaying peer are refused FORBIDDEN_SCOPE — and nothing is forwarded", async () => {
    const { forwarding, routes } = over();
    const inner = owner(ownerTicket());
    const forward = forwarding.forwardVia(inner);
    for (const principal of [
      { kind: "plugin", id: "p", scopes: ["index.read"] },
      { kind: "mcp-agent", sessionId: "m", scopes: ["index.read"] },
      { kind: "tailnet-guest", login: "them@example.com" },
      { kind: "tailnet", login: "them@example.com", self: false },
      { kind: "peer-fieldd", deviceId: "dev-c" },
    ]) {
      const refused = await refusalOf(() =>
        forward(OWNER, "index.openTicket", { sessionId: "s1" }, ctxOf(principal)),
      );
      expect(refused.kind, principal.kind).toBe("FORBIDDEN_SCOPE");
      expect(refused.details).toMatchObject({ principal: principal.kind, device: OWNER });
    }
    const malformed = await refusalOf(() => forward(OWNER, "index.openTicket", {}, WINDOW));
    expect(malformed.kind).toBe("PRECONDITION_FAILED");
    expect(inner.calls).toEqual([]);
    expect(routes.asked).toEqual([]);
  });

  it("a window's ask and the shell's are carried, keyed envelope and all", async () => {
    const { forwarding, routes } = over();
    routes.route(OWNER, INDEX, LISTEN);
    const seen: unknown[] = [];
    const inner: DeviceForwarder = async (_device, _method, params, _ctx, envelope) => {
      seen.push({ params, envelope });
      return ownerTicket();
    };
    const forward = forwarding.forwardVia(inner);
    const envelope = { idempotencyKey: "k-0123456789" };
    await forward(OWNER, "index.openTicket", { sessionId: "s1" }, WINDOW, envelope);
    await forward(
      OWNER,
      "index.openTicket",
      { sessionId: "s1" },
      ctxOf({ kind: "shell-main", tokenId: "tk_000000000002", scopes: ["index.read"] }),
    );
    expect(seen).toEqual([
      { params: { sessionId: "s1" }, envelope },
      { params: { sessionId: "s1" }, envelope: undefined },
    ]);
  });
});

describe("DS-7 — the owner's ticket, re-homed for a window here", () => {
  it("the tailnet set becomes the loopback pair at the route's listener, composed from the asked session; the grant rides untouched", async () => {
    const { forwarding, routes } = over();
    routes.route(OWNER, INDEX, LISTEN);
    const ticket = (await forwarding.forwardVia(owner(ownerTicket("a/b c")))(
      OWNER,
      "index.openTicket",
      { sessionId: "a/b c" },
      WINDOW,
    )) as IndexOpenTicket;
    expect(IndexEndpointSet.parse(ticket.endpoints)).toEqual({
      sessionUrl: `ws://${LISTEN}/ws/sessions/a%2Fb%20c`,
      restUrl: `http://${LISTEN}`,
    });
    expect(ticket.grant).toBe(GRANT);
    expect(ticket.device).toBe(OWNER);
    expect(ticket.expiresAt).toBe(ownerTicket().expiresAt);
    // the route's target is the ROSTER's, asked by device and the serve's port
    expect(routes.asked).toEqual([{ peerDeviceId: OWNER, port: INDEX }]);
  });

  it("holds ONE route reference per owner however many tickets ride it; the owner leaving gives it back, and the next ask has no road until it returns", async () => {
    const { forwarding, routes } = over();
    routes.route(OWNER, INDEX, LISTEN);
    const forward = forwarding.forwardVia(owner(ownerTicket()));
    for (let i = 0; i < 3; i += 1)
      await forward(OWNER, "index.openTicket", { sessionId: "s1" }, WINDOW);
    expect(routes.refs(OWNER, INDEX)).toBe(1);
    expect(forwarding.holders()).toEqual([OWNER]);
    routes.drop(OWNER, INDEX, "peer-left");
    expect(routes.refs(OWNER, INDEX)).toBe(0);
    expect(forwarding.holders()).toEqual([]);
    const refused = await refusalOf(() =>
      forward(OWNER, "index.openTicket", { sessionId: "s1" }, WINDOW),
    );
    expect(refused).toMatchObject({ kind: "UNAVAILABLE", retryable: true });
    expect(IndexTicketRoadDetails.parse(refused.details)).toEqual({
      service: "index",
      state: INDEX_TICKET.STATE_EGRESS_UNAVAILABLE,
      device: OWNER,
    });
  });

  it("a reset keeps the reference (the next ensure rebinds the id); daemon stop gives it back, and a stopped forwarder says so", async () => {
    const { forwarding, routes } = over();
    routes.route(OWNER, INDEX, LISTEN);
    const forward = forwarding.forwardVia(owner(ownerTicket()));
    await forward(OWNER, "index.openTicket", { sessionId: "s1" }, WINDOW);
    routes.drop(OWNER, INDEX, "reset");
    expect(routes.refs(OWNER, INDEX)).toBe(1);
    forwarding.dispose();
    expect(routes.refs(OWNER, INDEX)).toBe(0);
    routes.route(OWNER, INDEX, LISTEN);
    const stopped = await refusalOf(() =>
      forward(OWNER, "index.openTicket", { sessionId: "s1" }, WINDOW),
    );
    expect(stopped.message).toMatch(/stopping/);
    expect(stopped.details).toMatchObject({ state: INDEX_TICKET.STATE_EGRESS_UNAVAILABLE });
  });

  it("a superseded daemon keeps its floor routes for the successor", async () => {
    const { forwarding, routes } = over();
    routes.route(OWNER, INDEX, LISTEN);
    await forwarding.forwardVia(owner(ownerTicket()))(
      OWNER,
      "index.openTicket",
      { sessionId: "s1" },
      WINDOW,
    );
    forwarding.dispose({ keepFloorRoutes: true });
    expect(routes.refs(OWNER, INDEX)).toBe(1);
  });

  it("no road to the owner is egress_unavailable — never the owner's own coordinate", async () => {
    const { forwarding } = over(); // no route declared
    const refused = await refusalOf(() =>
      forwarding.forwardVia(owner(ownerTicket()))(
        OWNER,
        "index.openTicket",
        { sessionId: "s1" },
        WINDOW,
      ),
    );
    expect(IndexTicketRoadDetails.parse(refused.details).state).toBe(
      INDEX_TICKET.STATE_EGRESS_UNAVAILABLE,
    );
  });

  it("an owner that answers doors only its own machine can dial, or doors off its index serve, is doors_not_published; one that answers for another desktop does not parse as its own", async () => {
    const { forwarding, routes } = over();
    routes.route(OWNER, INDEX, LISTEN);
    for (const [why, answer] of [
      [
        "its own loopback pair",
        ownerTicket("s1", {
          endpoints: {
            sessionUrl: "ws://127.0.0.1:52811/ws/sessions/s1",
            restUrl: "http://127.0.0.1:52811",
          },
        }),
      ],
      [
        "a set off the index serve's port",
        ownerTicket("s1", {
          endpoints: remoteIndexEndpointsFor(
            `http://desk-a.tail1234.ts.net:${PORTS.TERMINAL_CELLS_SERVE}`,
            "s1",
          ) as IndexOpenTicket["endpoints"],
        }),
      ],
    ] as const) {
      const refused = await refusalOf(() =>
        forwarding.forwardVia(owner(answer))(
          OWNER,
          "index.openTicket",
          { sessionId: "s1" },
          WINDOW,
        ),
      );
      expect(refused.retryable, why).toBe(true);
      expect(IndexTicketRoadDetails.parse(refused.details), why).toEqual({
        service: "index",
        state: INDEX_TICKET.STATE_DOORS_NOT_PUBLISHED,
        device: OWNER,
      });
    }
    for (const answer of [ownerTicket("s1", { device: "dev-c" }), { grant: "x" }]) {
      const refused = await refusalOf(() =>
        forwarding.forwardVia(owner(answer))(
          OWNER,
          "index.openTicket",
          { sessionId: "s1" },
          WINDOW,
        ),
      );
      expect(refused.kind).toBe("INCOMPATIBLE");
    }
    // none of those took a route
    expect(routes.refs(OWNER, INDEX)).toBe(0);
  });

  it("an owner that does not answer is the peer link's refusal, passed through — no route is asked for", async () => {
    const { forwarding, routes } = over();
    routes.route(OWNER, INDEX, LISTEN);
    const asleep = new RpcCallError("UNAVAILABLE", "peer has no published endpoint", true, {
      service: "peer-link",
      device: OWNER,
      state: "offline",
    });
    const refused = await refusalOf(() =>
      forwarding.forwardVia(
        owner(() => {
          throw asleep;
        }),
      )(OWNER, "index.openTicket", { sessionId: "s1" }, WINDOW),
    );
    expect(refused).toBe(asleep);
    expect(routes.asked).toEqual([]);
  });
});

describe("SP-7b — the phone's ask, carried from its home; the owner's answer passes back untouched", () => {
  const PHONE = ctxOf({ kind: "tailnet", login: "me@example.com", self: true, tailscaleId: "n-p" });

  it("the phone's ask is carried, envelope and all, and the owner's tailnet set comes back as the owner answered it — no route is asked for or held", async () => {
    const { forwarding, routes } = over();
    routes.route(OWNER, INDEX, LISTEN);
    const seen: unknown[] = [];
    const inner: DeviceForwarder = async (_device, _method, params, _ctx, envelope) => {
      seen.push({ params, envelope });
      return ownerTicket();
    };
    const envelope = { idempotencyKey: "k-0123456789" };
    const forward = forwarding.forwardVia(inner);
    const ticket = await outcomeOf(() =>
      forward(OWNER, "index.openTicket", { sessionId: "s1" }, PHONE, envelope),
    );
    expect(ticket).toEqual(ownerTicket());
    expect(seen).toEqual([{ params: { sessionId: "s1" }, envelope }]);
    expect(RemoteIndexEndpointSet.parse((ticket as IndexOpenTicket).endpoints)).toEqual({
      sessionUrl: `ws://desk-a.tail1234.ts.net:${INDEX}/ws/sessions/s1`,
    });
    expect(routes.asked).toEqual([]);
    expect(forwarding.holders()).toEqual([]);
  });

  it("an answer that is no ticket of the owner's is INCOMPATIBLE, and doors only the owner can dial or off its index serve are doors_not_published naming it — as for a window", async () => {
    const { forwarding, routes } = over();
    routes.route(OWNER, INDEX, LISTEN);
    for (const [why, answer] of [
      [
        "its own loopback pair",
        ownerTicket("s1", {
          endpoints: {
            sessionUrl: "ws://127.0.0.1:52811/ws/sessions/s1",
            restUrl: "http://127.0.0.1:52811",
          },
        }),
      ],
      [
        "a set off the index serve's port",
        ownerTicket("s1", {
          endpoints: remoteIndexEndpointsFor(
            `http://desk-a.tail1234.ts.net:${PORTS.TERMINAL_CELLS_SERVE}`,
            "s1",
          ) as IndexOpenTicket["endpoints"],
        }),
      ],
    ] as const) {
      const refused = await refusalOf(() =>
        forwarding.forwardVia(owner(answer))(OWNER, "index.openTicket", { sessionId: "s1" }, PHONE),
      );
      expect(refused.retryable, why).toBe(true);
      expect(IndexTicketRoadDetails.parse(refused.details), why).toEqual({
        service: "index",
        state: INDEX_TICKET.STATE_DOORS_NOT_PUBLISHED,
        device: OWNER,
      });
    }
    for (const answer of [ownerTicket("s1", { device: "dev-c" }), { grant: "x" }]) {
      const refused = await refusalOf(() =>
        forwarding.forwardVia(owner(answer))(OWNER, "index.openTicket", { sessionId: "s1" }, PHONE),
      );
      expect(refused.kind).toBe("INCOMPATIBLE");
    }
    expect(routes.asked).toEqual([]);
  });
});
