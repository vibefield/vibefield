import { type CellEndpointSet, PORTS, RemoteCellEndpointSet } from "@vibefield/contracts";
import { createNoopLogger, type Logger } from "@vibefield/logging";
import type { EgressRouteDrop, EgressRoutesPort } from "./egress";
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
//    RFC 026 (today's production answer), the mesh down, the owner not in the
//    roster, a pair that is not one cell serve's — never a half pair, never
//    the owner's own coordinate.
//  · The route comes DOWN when the owner leaves the roster (EgressRoutes drops
//    it and removes it from the floor; the rewriter gives its reference back)
//    and at daemon stop (`dispose`: the last release removes each route). A
//    superseded daemon keeps them (`keepFloorRoutes`): the floor answers only
//    its successor, which re-answers each route by its id.
//
// LIVE when the sidecar speaks protocol 6 (truffle RFC 026, consumed at the
// petition window, EL8). Until then every rewrite here answers
// `egress_unavailable`, as NO_EGRESS did, but now with the floor's reason
// in the record (`fieldd.mesh.egress.route_unavailable`).

const CELLS = PORTS.TERMINAL_CELLS_SERVE;

export interface EgressCellRewriterOptions {
  /** the egress routes port (`EgressRoutes` in production) */
  routes: EgressRoutesPort;
  logger?: Logger;
}

export class EgressCellRewriter implements RemoteCellRewriter {
  /** the owner devices this rewriter holds its ONE reference on */
  private readonly held = new Set<string>();
  private readonly stopDrops: () => void;
  private readonly logger: Logger;
  private disposed = false;

  constructor(private readonly opts: EgressCellRewriterOptions) {
    this.logger = opts.logger ?? createNoopLogger();
    this.stopDrops = opts.routes.onDropped((drop) => this.onDropped(drop));
  }

  async rewrite(
    deviceId: string,
    endpoints: RemoteCellEndpointSet,
  ): Promise<CellEndpointSet | RemoteCellUnavailable> {
    if (this.disposed) return egressUnavailable(deviceId, "this desktop's daemon is stopping");
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
    const route = await this.opts.routes.ensureRoute(deviceId, CELLS);
    if (route === undefined) return egressUnavailable(deviceId);
    if (this.disposed) {
      // stopped while the route was being ensured: give it straight back
      this.opts.routes.release(deviceId, CELLS);
      return egressUnavailable(deviceId, "this desktop's daemon is stopping");
    }
    if (this.held.has(deviceId)) this.opts.routes.release(deviceId, CELLS);
    else this.held.add(deviceId);
    return (
      loopbackCellEndpoints(endpoints, route.listen) ??
      egressUnavailable(deviceId, "the egress route answered a listener that is not loopback")
    );
  }

  /** The owner devices holding a route through this rewriter (tests, health). */
  holders(): string[] {
    return [...this.held];
  }

  /** Daemon stop. Gives back every reference, and the last release takes each
   * route off the floor — unless the daemon was SUPERSEDED (`keepFloorRoutes`):
   * the floor answers only its successor then, which re-answers each route by
   * its id. Idempotent. */
  dispose(opts: { keepFloorRoutes?: boolean } = {}): void {
    if (this.disposed) return;
    this.disposed = true;
    this.stopDrops();
    if (opts.keepFloorRoutes !== true) {
      for (const deviceId of this.held) this.opts.routes.release(deviceId, CELLS);
    }
    this.held.clear();
  }

  /** The owner left the roster: EgressRoutes already took the route off the
   * floor; the reference goes back so the entry goes too, and the next ticket
   * after the owner returns binds afresh. A reset keeps the reference — the
   * next ensure rebinds the same id. */
  private onDropped(drop: EgressRouteDrop): void {
    if (drop.port !== CELLS || drop.reason !== "peer-left") return;
    if (!this.held.delete(drop.peerDeviceId)) return;
    this.opts.routes.release(drop.peerDeviceId, CELLS);
    this.logger.debug(
      "fieldd.terminal.egress.owner_left",
      "An owner desktop left the roster; its cell route is gone",
      { owner: drop.peerDeviceId },
    );
  }
}
