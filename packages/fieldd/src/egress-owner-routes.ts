import { createNoopLogger, type Logger } from "@vibefield/logging";
import type { EgressRouteDrop, EgressRoutesPort } from "./egress";

// DS-7 (2026-10-31) — ONE ROUTE REFERENCE PER OWNER DESKTOP, for one far port:
// the rule DS-1b wrote inside the terminal's rewriter (`egress-cell-rewriter.ts`),
// lifted out when a forwarded index ticket became its second user
// (`index-forward.ts`). Both re-home an owner's tailnet coordinate onto a
// loopback listener of THIS desktop's sidecar (E2), and both want the route's
// life to be the owner's presence, never a ticket count.
//
// THE RULES IT KEEPS (as DS-1b wrote them):
//  · ONE reference per owner however many tickets ride the route: each
//    `ensureRoute` takes one, and all but the first are given back at once.
//    Re-adding is idempotent end to end — `EgressRoutes` answers a bound route
//    without asking, and the floor answers a re-add of the same id and target
//    from its mirror.
//  · The reference goes back when the owner LEAVES the roster (`EgressRoutes`
//    already took the route off the floor), so the next ticket after it
//    returns binds afresh. A reset keeps it: the next ensure rebinds the id.
//  · Daemon stop gives every reference back, and the last release takes each
//    route off the floor — unless the daemon was SUPERSEDED
//    (`keepFloorRoutes`): the floor answers only its successor then, which
//    re-answers each route by its id.

/** What holding an owner's route came to: its loopback listener, or why there
 * is none — this daemon stopping, or no road (the routes port logged why). */
export type OwnerRoute = { listen: string } | { refused: "stopping" | "no-route" };

export interface OwnerRoutesOptions {
  /** the egress routes port (`EgressRoutes` in production) */
  routes: EgressRoutesPort;
  /** the far port every route of this holder targets (a DS-L6 routable door) */
  port: number;
  /** what the log says when an owner leaves the roster */
  ownerLeft: { event: string; message: string };
  logger?: Logger;
}

export class OwnerRoutes {
  /** the owner devices this holder keeps its ONE reference on */
  private readonly held = new Set<string>();
  private readonly stopDrops: () => void;
  private readonly logger: Logger;
  private disposed = false;

  constructor(private readonly opts: OwnerRoutesOptions) {
    this.logger = opts.logger ?? createNoopLogger();
    this.stopDrops = opts.routes.onDropped((drop) => this.onDropped(drop));
  }

  /** True once `dispose` ran: a caller says "stopping" before it asks. */
  get stopped(): boolean {
    return this.disposed;
  }

  /** A loopback listener reaching the far port on `deviceId`, holding this
   * holder's one reference on it. */
  async hold(deviceId: string): Promise<OwnerRoute> {
    if (this.disposed) return { refused: "stopping" };
    const route = await this.opts.routes.ensureRoute(deviceId, this.opts.port);
    if (route === undefined) return { refused: "no-route" };
    if (this.disposed) {
      // stopped while the route was being ensured: give it straight back
      this.opts.routes.release(deviceId, this.opts.port);
      return { refused: "stopping" };
    }
    if (this.held.has(deviceId)) this.opts.routes.release(deviceId, this.opts.port);
    else this.held.add(deviceId);
    return { listen: route.listen };
  }

  /** The owner devices holding a route through this holder (tests, health). */
  holders(): string[] {
    return [...this.held];
  }

  /** Daemon stop. Idempotent. */
  dispose(opts: { keepFloorRoutes?: boolean } = {}): void {
    if (this.disposed) return;
    this.disposed = true;
    this.stopDrops();
    if (opts.keepFloorRoutes !== true) {
      for (const deviceId of this.held) this.opts.routes.release(deviceId, this.opts.port);
    }
    this.held.clear();
  }

  private onDropped(drop: EgressRouteDrop): void {
    if (drop.port !== this.opts.port || drop.reason !== "peer-left") return;
    if (!this.held.delete(drop.peerDeviceId)) return;
    this.opts.routes.release(drop.peerDeviceId, this.opts.port);
    this.logger.debug(this.opts.ownerLeft.event, this.opts.ownerLeft.message, {
      owner: drop.peerDeviceId,
    });
  }
}
