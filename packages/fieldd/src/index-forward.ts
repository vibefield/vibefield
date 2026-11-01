import {
  type CallerContext,
  INDEX_TICKET,
  IndexOpenTicket,
  IndexOpenTicketParams,
  indexEndpointsFor,
  PORTS,
  RemoteIndexEndpointSet,
} from "@vibefield/contracts";
import type { Logger } from "@vibefield/logging";
import type { EgressRoutesPort } from "./egress";
import { OwnerRoutes } from "./egress-owner-routes";
import { RpcCallError } from "./native-link";
import type { DeviceForwarder } from "./product-api";

// DS-7 (2026-10-31; `thinking-desktop-sync-plane.md` §6.4, DS-D8 (a);
// `thinking-sync-planes.md` SP-D5 (a)) — TRANSCRIPTS BY TICKET, the half on the
// WINDOW's desktop.
//
// A window on desktop B opens a session that lives on desktop A. B's door
// forwards `index.openTicket {sessionId, device: A}` WHOLE (the method is
// `federate`, ProductApi's `device?` convention); A mints from its own rule for
// B's daemon — a `read` grant for exactly that session, beside the TAILNET set
// of A's index serve (`index-serve.ts`). B's window cannot dial that set: a
// desktop has no tailnet socket of its own (TM-D6), so this module re-homes it
// onto an egress route of B's sidecar to A's `PORTS.INDEX_SERVE` (E2) — the
// cell's road (`egress-cell-rewriter.ts`, DS-4), for rosettad. The window then
// dials rosetta's own socket on loopback with the grant, and the transcript's
// bytes go sidecar to sidecar: neither daemon's door carries one (EL2, the
// slice's witness).
//
// Two things happen here and nowhere else:
//  · BEFORE the forward, the ask is carried only for a principal THIS daemon
//    would mint an index ticket for itself: a window or the shell (the
//    `local-token` and `shell-main` kinds). The owner sees this daemon, never
//    the caller behind it, so carrying a plugin's or an agent's ask would
//    launder a refusal through a peer (`TerminalService.forwardVia`'s law). The
//    phone through its home is SP-7's: it hears `direct-plane-unbuilt`, as it
//    does here. A peer daemon's own forward is not carried on: one hop.
//  · AFTER it, the owner's ticket is adopted for the window: its grant rides
//    through untouched (a URL is a coordinate, never authority — A's rosettad
//    checks the grant whichever socket carried it), and only `endpoints`
//    change, to the loopback set composed from the ASKED session id and the
//    route's listener (`indexEndpointsFor`, the one composer): the route
//    forwards A's whole index listener, so its origin is the `rest` leg.
//
// THE ROUTE: one reference per owner desktop (`OwnerRoutes`, DS-1b's rule), its
// target the ROSTER's tailnet name for the owner, never the URL the owner
// answered. No road is `egress_unavailable`; an owner with no live serve, or
// one that answered a set only its own machine can dial, is
// `doors_not_published` — both retryable, both naming the owner
// (`IndexTicketRoadDetails`). An owner that does not answer at all is the peer
// link's own refusal (`{service: "peer-link", device, state}`), passed through
// before this module sees an answer.

const INDEX = PORTS.INDEX_SERVE;
const METHOD = "index.openTicket";

/** A road refusal for a ticket to `device`'s session (retryable). */
function roadRefusal(device: string, state: string, message: string): RpcCallError {
  return new RpcCallError("UNAVAILABLE", message, true, {
    service: INDEX_TICKET.SERVICE,
    state,
    device,
  });
}

/** Whether this daemon carries `ctx`'s ask to another desktop: only a
 * principal it would mint an index ticket for itself, refused otherwise in the
 * minter's own words (`IndexTicketMinter.check`). */
function refuseCarry(ctx: CallerContext, device: string): RpcCallError | null {
  const kind = ctx.principal.kind;
  if (kind === "local-token" || kind === "shell-main") return null;
  if (kind === "tailnet")
    return new RpcCallError(
      "UNAVAILABLE",
      "a ticket across the tailnet is not served to the phone yet: its set is the index serve's (SP-7)",
      false,
      { service: INDEX_TICKET.SERVICE, state: INDEX_TICKET.STATE_UNBUILT },
    );
  return new RpcCallError(
    "FORBIDDEN_SCOPE",
    kind === "peer-fieldd"
      ? "a ticket for another desktop's session is forwarded one hop, from the window's own desktop"
      : "a ticket opens a transcript; only a window or the shell on this desktop may hold one",
    false,
    { method: METHOD, principal: kind, device },
  );
}

export interface IndexTicketForwardingOptions {
  /** the egress routes port (`EgressRoutes` in production) */
  routes: EgressRoutesPort;
  logger?: Logger;
}

export class IndexTicketForwarding {
  /** the ONE reference per owner device on its index serve's route */
  private readonly owners: OwnerRoutes;

  constructor(opts: IndexTicketForwardingOptions) {
    this.owners = new OwnerRoutes({
      routes: opts.routes,
      port: INDEX,
      ownerLeft: {
        event: "fieldd.index.egress.owner_left",
        message: "An owner desktop left the roster; its index route is gone",
      },
      ...(opts.logger !== undefined ? { logger: opts.logger } : {}),
    });
  }

  /** The index half of this daemon's `device?` forwarder, wrapped around the
   * rest of it (`TerminalService.forwardVia`): every other method passes
   * through untouched. */
  forwardVia(inner: DeviceForwarder): DeviceForwarder {
    return async (device, method, params, ctx, envelope) => {
      if (method !== METHOD) return await inner(device, method, params, ctx, envelope);
      const ask = IndexOpenTicketParams.safeParse(params ?? {});
      if (!ask.success)
        throw new RpcCallError(
          "PRECONDITION_FAILED",
          "expected { sessionId: string, device?: string }",
          false,
        );
      const refusal = refuseCarry(ctx, device);
      if (refusal !== null) throw refusal;
      const answer = await inner(device, method, params, ctx, envelope);
      return await this.adopt(device, ask.data.sessionId, answer);
    };
  }

  /** The owner's ticket, made dialable for a window here (see the header). */
  async adopt(device: string, sessionId: string, answer: unknown): Promise<IndexOpenTicket> {
    const parsed = IndexOpenTicket.safeParse(answer);
    if (!parsed.success || parsed.data.device !== device)
      throw new RpcCallError(
        "INCOMPATIBLE",
        `the index ticket ${device} answered does not parse as its own`,
        false,
        { service: INDEX_TICKET.SERVICE, device },
      );
    const ticket = parsed.data;
    const remote = RemoteIndexEndpointSet.safeParse(ticket.endpoints);
    if (!remote.success || new URL(remote.data.sessionUrl).port !== String(INDEX))
      throw roadRefusal(
        device,
        INDEX_TICKET.STATE_DOORS_NOT_PUBLISHED,
        `${device} answered history doors only its own machine can dial`,
      );
    const route = await this.owners.hold(device);
    if ("refused" in route)
      throw roadRefusal(
        device,
        INDEX_TICKET.STATE_EGRESS_UNAVAILABLE,
        route.refused === "stopping"
          ? "this desktop's daemon is stopping"
          : "this desktop has no egress route to that desktop's history yet",
      );
    const endpoints = indexEndpointsFor(`http://${route.listen}`, sessionId);
    if (endpoints === undefined)
      throw roadRefusal(
        device,
        INDEX_TICKET.STATE_EGRESS_UNAVAILABLE,
        "the egress route answered a listener a window here cannot dial",
      );
    return { ...ticket, endpoints };
  }

  /** The owner devices holding a route through this forwarder (tests, health). */
  holders(): string[] {
    return this.owners.holders();
  }

  /** Daemon stop (`OwnerRoutes.dispose`). */
  dispose(opts: { keepFloorRoutes?: boolean } = {}): void {
    this.owners.dispose(opts);
  }
}
