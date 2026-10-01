import {
  CellEndpointSet,
  type RemoteCellEndpointSet,
  type UnavailableDetails,
} from "@vibefield/contracts";

// DS-4 — THE PORT a forwarded terminal ticket crosses on the CALLER's desktop
// (`thinking-desktop-sync-plane.md` §6.3 step 4; design-06 §6).
//
// A window on desktop B opens a session that lives on desktop A. B's daemon
// forwards `terminal.openTicket {device: A}`; A mints from its own rule and
// answers its cell's doors AS A TAILNET CLIENT DIALS THEM —
// `ws://<a>.ts.net:9422/cell/<boot>/control|frames`. B's window cannot dial
// that: a desktop has no tailnet socket of its own, the sidecar's stack is the
// only one (TM-D6), so the coordinate a window CAN dial is a loopback listener
// B's own sidecar forwards to A's cell serve — an egress route (E2, petition
// T7; the facade `native.mesh.egress.route.add` is lane ds-a's). This port is
// where that swap happens, and nothing else: it turns the owner's tailnet pair
// into a loopback pair on THIS machine, path kept, or says honestly that it
// cannot.
//
// The grants ride through untouched. A URL is a coordinate, never authority
// (TM-2): the owner's cell verifies the MAC in the first frame whichever socket
// carried it, so rewriting the doors changes where bytes go, not who may send
// them.

/** The honest refusal: this desktop has no road to that desktop's cells. */
export interface RemoteCellUnavailable {
  readonly unavailable: UnavailableDetails & {
    service: "terminal";
    state: "egress_unavailable";
    device: string;
  };
  readonly message: string;
}

export interface RemoteCellRewriter {
  /** The owner's tailnet door pair → a pair a window on THIS desktop dials.
   * Async because a real rewrite ENSURES a route (a mgmt round trip). */
  rewrite(
    deviceId: string,
    endpoints: RemoteCellEndpointSet,
  ): Promise<CellEndpointSet | RemoteCellUnavailable>;
}

export function isRemoteCellUnavailable(
  answer: CellEndpointSet | RemoteCellUnavailable,
): answer is RemoteCellUnavailable {
  return "unavailable" in answer;
}

export function egressUnavailable(
  deviceId: string,
  message = "this desktop has no egress route to that desktop's terminal cells yet",
): RemoteCellUnavailable {
  return {
    unavailable: { service: "terminal", state: "egress_unavailable", device: deviceId },
    message,
  };
}

/** The default, and the truth until DS-1: fieldd has no egress facade to ask,
 * so every forwarded ticket for a window here is UNAVAILABLE rather than a
 * pair of doors nothing on this machine answers. */
export const NO_EGRESS: RemoteCellRewriter = {
  rewrite: async (deviceId) => egressUnavailable(deviceId),
};

/** Where ONE route must go: the `host:port` both doors share (an implicit
 * port is the scheme's). A pair that names two different serves is not one
 * cell's, and is refused (undefined). */
export function egressTarget(endpoints: RemoteCellEndpointSet): string | undefined {
  try {
    const control = new URL(endpoints.controlUrl);
    const frames = new URL(endpoints.framesUrl);
    if (control.host !== frames.host || control.protocol !== frames.protocol) return undefined;
    const port = control.port !== "" ? control.port : control.protocol === "wss:" ? "443" : "80";
    return `${control.hostname}:${port}`;
  } catch {
    return undefined;
  }
}

/** Re-home a remote door pair onto a loopback listener (`127.0.0.1:<p>`, the
 * shape an egress route answers), keeping each door's PATH — the owner's serve
 * routes by `/cell/<boot>/control|frames`, and the route forwards the upgrade
 * with its path intact (E2). The loopback leg is plain `ws`: whatever the
 * tailnet leg's scheme, the listener is this machine's and the route carries
 * the rest. Undefined when the result would not be a valid `CellEndpointSet`
 * (a listener that is not loopback, a path that does not parse). */
export function loopbackCellEndpoints(
  endpoints: RemoteCellEndpointSet,
  listen: string,
): CellEndpointSet | undefined {
  try {
    const parsed = CellEndpointSet.safeParse({
      controlUrl: `ws://${listen}${new URL(endpoints.controlUrl).pathname}`,
      framesUrl: `ws://${listen}${new URL(endpoints.framesUrl).pathname}`,
    });
    return parsed.success ? parsed.data : undefined;
  } catch {
    return undefined;
  }
}

/** What an egress facade answers for one route (lane ds-a's `EgressRoutes`
 * plugs in here: `native.mesh.egress.route.add {id, target}` → `{id, listen}`).
 * `undefined` = no route could be made (the mesh is down, the sidecar has no
 * egress). */
export type EnsureEgressRoute = (route: {
  deviceId: string;
  target: string;
}) => Promise<{ listen: string } | undefined>;

/** The rewriter over an egress facade: one route per owner serve, both doors
 * re-homed onto its listener. Any step that cannot answer is `egress_unavailable`
 * — never a half pair, never the owner's own coordinate. */
export function egressRouteRewriter(ensure: EnsureEgressRoute): RemoteCellRewriter {
  return {
    async rewrite(deviceId, endpoints) {
      const target = egressTarget(endpoints);
      if (target === undefined)
        return egressUnavailable(deviceId, "the owner's two cell doors do not name one serve");
      const route = await ensure({ deviceId, target });
      if (route === undefined) return egressUnavailable(deviceId);
      return (
        loopbackCellEndpoints(endpoints, route.listen) ??
        egressUnavailable(deviceId, "the egress route answered a listener that is not loopback")
      );
    },
  };
}
