import { type CellEndpointSet, PORTS, RemoteCellEndpointSet } from "@vibefield/contracts";
import type { Logger } from "@vibefield/logging";
import type { EgressRoutesPort } from "./egress";
import { OwnerRoutes } from "./egress-owner-routes";
import {
  egressTarget,
  egressUnavailable,
  loopbackCellEndpoints,
  type RemoteCellRewriter,
  type RemoteCellUnavailable,
} from "./remote-cell-rewriter";

// DS-1b (2026-10-01) — THE PRODUCTION REWRITER: the port DS-4 left
// (`remote-cell-rewriter.ts`), over the egress ROUTES port DS-1 built
// (`EgressRoutes`, E2). `thinking-desktop-sync-plane.md` §6.3 step 4: the
// window's daemon ensures an egress route to the owner's cell serve and
// rewrites the owner's tailnet doors to loopback, so the renderer dials a
// remote cell exactly as it dials a local one (`CellEndpointSet` stays
// loopback-only, no CSP change, D36).
//
// THE RULES IT KEEPS:
//  · ONE route per OWNER DEVICE, to `<the roster's tailnet name for it>:
//    PORTS.TERMINAL_CELLS_SERVE`. Every cell of a desktop is served behind that
//    one listener by path (`/cell/<boot>/...`), so a route per desktop carries
//    them all. The route's id is EgressRoutes' `egress-<deviceId>-9422`: the
//    contract's id charset has no `:` (mgmt.ts `MESH_EGRESS_ROUTE_ID_PATTERN`),
//    so the brief's `cell:<deviceId>` cannot be an id, and the port's id is
//    already one per {device, port}. The TARGET comes from the roster (the
//    sidecar's WhoIs), never from the doors the owner answered: a URL is a
//    coordinate, never authority.
//  · The rewriter holds ONE reference per owner however many tickets it
//    rewrites (each ensure takes one; all but the first are given back at
//    once), so the route's life is the owner's presence, not a ticket count.
//    Re-adding is idempotent end to end: EgressRoutes answers a bound route
//    without asking, and the floor answers a re-add of the same id and target
//    from its mirror.
//  · BOTH legs are re-homed onto the listener with path and query kept: only
//    the authority changes (`loopbackCellEndpoints`). Both endpoint contracts
//    refuse a query today, so the query half is a guard against stripping one
//    silently, never a pair that drops it.
//  · No road is `egress_unavailable`, honestly: a floor whose sidecar predates
//    RFC 026 or whose build lacks the egress feature, the mesh down (the
//    default build with no node), the owner not in the roster, a pair that is
//    not one cell serve's — never a half pair, never the owner's own
//    coordinate.
//  · The route comes DOWN when the owner leaves the roster (EgressRoutes drops
//    it and removes it from the floor; the rewriter gives its reference back)
//    and at daemon stop (`dispose`: the last release removes each route). A
//    superseded daemon keeps them (`keepFloorRoutes`): the floor answers only
//    its successor, which re-answers each route by its id.
//
// *DS-7 (2026-10-31): the one-reference-per-owner rule above moved into
// `egress-owner-routes.ts` (`OwnerRoutes`) when a forwarded index ticket became
// its second user; this rewriter holds one for the cell serve's port, and its
// behaviour, words and log event are unchanged.*
//
// LIVE in the default build (TB-E): field-native's truffle arm, over
// truffle-core 0.7.19 and its protocol-8 sidecar (RFC 026 egress needs
// protocol 7). With a node up, an ensure binds a real loopback route. With no
// node the floor answers `mesh-down`, and a sidecar below 7 or a build without
// the feature answers `egress-unsupported`; either way the rewrite is
// `egress_unavailable`, with the floor's reason in the record
// (`fieldd.mesh.egress.route_unavailable`).

const CELLS = PORTS.TERMINAL_CELLS_SERVE;

export interface EgressCellRewriterOptions {
  /** the egress routes port (`EgressRoutes` in production) */
  routes: EgressRoutesPort;
  logger?: Logger;
}

const STOPPING = "this desktop's daemon is stopping";

export class EgressCellRewriter implements RemoteCellRewriter {
  /** the ONE reference per owner device on its cell serve's route */
  private readonly owners: OwnerRoutes;

  constructor(opts: EgressCellRewriterOptions) {
    this.owners = new OwnerRoutes({
      routes: opts.routes,
      port: CELLS,
      ownerLeft: {
        event: "fieldd.terminal.egress.owner_left",
        message: "An owner desktop left the roster; its cell route is gone",
      },
      ...(opts.logger !== undefined ? { logger: opts.logger } : {}),
    });
  }

  async rewrite(
    deviceId: string,
    endpoints: RemoteCellEndpointSet,
  ): Promise<CellEndpointSet | RemoteCellUnavailable> {
    if (this.owners.stopped) return egressUnavailable(deviceId, STOPPING);
    if (!RemoteCellEndpointSet.safeParse(endpoints).success)
      return egressUnavailable(deviceId, "the owner's doors are not one cell's tailnet pair");
    const target = egressTarget(endpoints);
    if (target === undefined)
      return egressUnavailable(deviceId, "the owner's two cell doors do not name one serve");
    if (!target.endsWith(`:${CELLS}`))
      return egressUnavailable(
        deviceId,
        `the owner's cell doors are not on the cell serve's port (${CELLS})`,
      );
    const route = await this.owners.hold(deviceId);
    if ("refused" in route)
      return route.refused === "stopping"
        ? egressUnavailable(deviceId, STOPPING)
        : egressUnavailable(deviceId);
    return (
      loopbackCellEndpoints(endpoints, route.listen) ??
      egressUnavailable(deviceId, "the egress route answered a listener that is not loopback")
    );
  }

  /** The owner devices holding a route through this rewriter (tests, health). */
  holders(): string[] {
    return this.owners.holders();
  }

  /** Daemon stop. Gives back every reference, and the last release takes each
   * route off the floor — unless the daemon was SUPERSEDED (`keepFloorRoutes`):
   * the floor answers only its successor then, which re-answers each route by
   * its id. Idempotent. */
  dispose(opts: { keepFloorRoutes?: boolean } = {}): void {
    this.owners.dispose(opts);
  }
}
