import {
  PORTS,
  type RemoteCellEndpointSet,
  remoteCellEndpointsFor,
  remoteCellRoutePrefix,
  type TerminalRouteCell,
  type TerminalRouteSnapshot,
} from "@vibefield/contracts";
import type { Logger } from "@vibefield/logging";
import type { ServeSpec, ServeState } from "./mesh-client";
import {
  publishedServe,
  RouteServeDriver,
  type RouteServeLog,
  routeServeSignature,
  routeServeSpec,
  type ServedProcess,
  serveAllowGlob,
} from "./route-serve";

// SP-3 (2026-10-01) — this was the only route driver; it is now the FIRST USER
// of the route-per-process driver (`route-serve.ts`), which took its policy
// gates, its change key and its reconcile whole. What stays here is what is
// the cells' own: which rows are routable, their prefixes, and the doors a
// ticket names for one cell. Every row in terminal-serve.test.ts runs against
// it unchanged. `serveAllowGlob` moved with the gates and is re-exported for
// the product serve's spec and the tests that import it from here.
export { serveAllowGlob };

// TM-2 (thinking-terminal-mesh-cells.md §3 T, TM-D2) — THE TERMINAL ROUTES.
//
// One tailnet listener carrying one reverse-proxy route per live terminal
// cell: `/cell/<cellBootId>` → `127.0.0.1:<that cell's T1 door port>`, gated
// (ERRATA F-L6b, 2026-09-14: this line drew the route WITH a trailing slash,
// which `cellRoutesFor` below has never sent and the shipped sidecar never
// matches — see `remoteCellRoutePrefix`.)
// by the linked login. The sidecar splices the WebSocket upgrade straight into
// the cell, so neither fieldd nor the floor is in the byte path (EL2) and the
// cell's authority stays the grant it verifies in the first frame.
//
// This module is PURE POLICY over three live readings — the floor's route
// snapshot, the floor's `terminalMesh` word, and the link's login — plus the
// change detection that keeps a re-pair free. It owns no I/O: the declaration
// goes out through an injected bridge, exactly as ArtifactService's serves do.
//
// THREE GATES, and each is a refusal to publish rather than a degraded
// publish:
//
//   1. NO LINKED LOGIN, NO TERMINAL ROUTES, EVER. `allow` on a serve is the
//      sidecar's WhoIs gate, and an empty allow list means THE WHOLE TAILNET
//      (truffle RFC 023 §9.7). For the product door that is survivable — the
//      door behind it still checks scopes — but a cell door's only wall is the
//      grant, and a route with no allow-list would put every tailnet node one
//      unguessed grant away from a live PTY. So an unlinked or pre-capture
//      daemon publishes nothing at all.
//   2. THE FLOOR'S OWN WORD. `terminalMesh` false or absent ⇒ nothing is
//      published. The floor decides whether its doors belong on the tailnet;
//      fieldd only carries the decision to the sidecar.
//   3. A CELL WITHOUT DOORS IS NOT ROUTABLE. Keyless-bootstrap and pre-TP
//      cells carry no `doors`, and a route to nothing is worse than no route:
//      it answers a dial with a connection refused instead of a 404.
//
// WHY A SEPARATE SERVE, not routes added to the product serve (which is what
// TM-D2 and the slice brief both ask for): truffle's proxy API is `add` and
// `remove` with NO update (truffle-core 0.7.12 `src/proxy/mod.rs`), a same-id
// add answers `PROXY_EXISTS`, and `MeshClient`'s reconcile skips a serveId
// that is already live — so changing ANY serve's route list is a
// remove-then-add that drops every connection on that listener. Cell routes
// change on every cell birth and exit; the product door is what a dropped
// client must re-dial to get a replacement ticket. Bouncing it on cell churn
// would break the recovery path itself, so the churn is confined here, where
// it costs a terminal leg one reconnect that the routed client already knows
// how to make (`STALE_ROUTE` → re-ticket). Two listeners instead of one is the
// price of an API with no upsert; the day truffle grows one, this collapses
// back onto the product serve and `PORTS.TERMINAL_CELLS_SERVE` retires.

/** The engine identity and display name of the terminal listener. One
 * constant, because the driver declares it and the reconcile keys on it. */
export const TERMINAL_SERVE_ID = "terminal" as const;

/** SP-3 — the cells as a served process: one route per live cell on the
 * registry's own listener. */
export const TERMINAL_SERVED: ServedProcess = {
  serveId: TERMINAL_SERVE_ID,
  listenPort: PORTS.TERMINAL_CELLS_SERVE,
};

/** The driver's log, word for word what TM-2's said. */
const TERMINAL_SERVE_LOG: RouteServeLog = {
  declared: "fieldd.terminal_serve.declared",
  deferred: "fieldd.terminal_serve.declare_deferred",
  declaredMessage: "The terminal cell routes were declared",
  withdrawnMessage: "The terminal cell routes were withdrawn",
  deferredMessage: "A terminal route declaration did not reach the node; the next change retries",
};

/** One cell's route as the driver computes it, before it becomes a ServeSpec. */
export interface TerminalCellRoute {
  cellBootId: string;
  prefix: string;
  targetPort: number;
}

export interface TerminalServeDriverOptions {
  /** the floor's revisioned route snapshot (NativeLink.terminalRoutes) */
  routes: () => TerminalRouteSnapshot | undefined;
  /** the floor's own word that its doors are on the tailnet (MF-1l) */
  published: () => boolean;
  /** the WhoIs login this daemon is linked to, or null */
  linkedLogin: () => string | null;
  /**
   * Re-declare the desired serve set with this terminal spec, or without one.
   *
   * ANSWERS WHETHER IT LANDED (F-M5, 2026-09-14), and that is the whole point
   * of the boolean: the injected closure goes through `MeshClient`, whose
   * posture is deliberately non-throwing — a mesh that is not up marks every
   * serve `pending` and resolves, and a per-serve add failure is recorded as an
   * `error` state and resolves. A driver that read RESOLUTION as success
   * recorded a signature nothing had reached the sidecar for, and then declined
   * to retry because the signature had not moved. So: true iff the node's state
   * now matches this declaration — the serve is ACTIVE for a spec, and really
   * gone for a withdrawal.
   */
  declare: (spec: ServeSpec | null) => Promise<boolean>;
  logger?: Logger;
}

/** The loopback port behind a cell's door pair, or `undefined` when the row
 * cannot be routed.
 *
 * BOTH doors must name the SAME port. One route can only carry one target, and
 * the cell serves `/control` and `/frames` on one listener by construction
 * (`field-native/src/tp/door.rs`) — so a row that disagrees is a floor this
 * build does not understand, and skipping it is the honest answer rather than
 * publishing a route that would silently send frames to the control port. */
export function cellDoorPort(cell: TerminalRouteCell): number | undefined {
  const control = portOf(cell.doors?.controlUrl);
  const frames = portOf(cell.doors?.framesUrl);
  if (control === undefined || frames === undefined || control !== frames) return undefined;
  return control;
}

function portOf(url: string | undefined): number | undefined {
  if (url === undefined) return undefined;
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return undefined;
  }
  const port = Number(parsed.port);
  return Number.isInteger(port) && port > 0 && port <= 65_535 ? port : undefined;
}

/** The routes a snapshot calls for, in snapshot order. Cells without dialable
 * doors are DROPPED, not faked. */
export function cellRoutesFor(snapshot: TerminalRouteSnapshot | undefined): TerminalCellRoute[] {
  const out: TerminalCellRoute[] = [];
  for (const cell of snapshot?.cells ?? []) {
    const targetPort = cellDoorPort(cell);
    if (targetPort === undefined) continue;
    out.push({
      cellBootId: cell.cellBootId,
      // NO trailing slash — the shipped sidecar never matches one (TM-2b; the
      // rule and its evidence live on `remoteCellRoutePrefix`)
      prefix: remoteCellRoutePrefix(cell.cellBootId),
      targetPort,
    });
  }
  return out;
}

/** The serve the current state calls for, or `null` for "publish nothing".
 * Pure — the driver's whole policy, testable without a daemon. SP-3: the
 * three gates are the route driver's (`routeServeSpec`); the cells add only
 * which rows are routable. */
export function terminalServeSpec(input: {
  routes: TerminalRouteSnapshot | undefined;
  published: boolean;
  linkedLogin: string | null;
}): ServeSpec | null {
  return routeServeSpec(TERMINAL_SERVED, {
    published: input.published,
    linkedLogin: input.linkedLogin,
    targets: { kind: "routes", routes: cellRoutesFor(input.routes) },
  });
}

/** A change key for a spec. Re-declaring a serve costs every live connection on
 * its listener, so the driver must be able to tell "the floor replayed its
 * snapshot" from "a cell was born". The route snapshot's own `revision` is NOT
 * that key: it moves on facts this serve does not carry (a token rotation, a
 * pid), and it resets across floor boots. SP-3: the route driver's key, which
 * for a routes serve is this one character for character. */
export function terminalServeSignature(spec: ServeSpec | null): string {
  return routeServeSignature(spec);
}

/**
 * Drives the terminal serve from the floor's route rows.
 *
 * `refresh()` is idempotent BY SIGNATURE and serialized: a floor re-pair that
 * replays the identical snapshot declares nothing, and two changes arriving
 * together never race two declarations to the node. SP-3: the reconcile — the
 * signature, F-H1's first declaration, F-M5's landed-or-retry, `dispose` — is
 * `RouteServeDriver`'s; this is the cells' readings fed into it.
 */
export class TerminalServeDriver extends RouteServeDriver {
  constructor(opts: TerminalServeDriverOptions) {
    super({
      desired: () =>
        terminalServeSpec({
          routes: opts.routes(),
          published: opts.published(),
          linkedLogin: opts.linkedLogin(),
        }),
      declare: opts.declare,
      log: TERMINAL_SERVE_LOG,
      ...(opts.logger !== undefined ? { logger: opts.logger } : {}),
    });
  }
}

/** TM-2 (TM-D2, F-H2) — THE ONE READING of "is this device carrying its
 * terminal doors onto the tailnet RIGHT NOW", answered as the live serve or
 * `undefined`: the serve is `active` with a URL (`publishedServe`) AND carries
 * at least one route — the sidecar was handed a cell. The ticket mint and
 * `DeviceCapabilities.terminalMesh` both ask it. (It lived in daemon.ts until
 * SP-3; the reasoning there moved with it.) */
export function publishedTerminalRoutes(
  serves: readonly ServeState[],
): { url: string; routes: ReadonlyArray<{ prefix: string; targetPort: number }> } | undefined {
  const serve = publishedServe(serves, TERMINAL_SERVE_ID);
  if (serve === undefined) return undefined;
  const routes = serve.routes ?? [];
  if (routes.length === 0) return undefined;
  return { url: serve.url, routes };
}

/** TM-2 (TM-D2) — the doors a TAILNET self peer is told to dial for one cell,
 * read off the LIVE terminal serve plus one condition only this caller has:
 * THIS cell's route is in the published set. A ticket minted in the window
 * between a cell's birth and its route landing would name a path the sidecar
 * answers 404 for, and a 404 is not a state any client can act on — so that
 * is `undefined` (the mint's `doors_not_published`). SP-3: the template's
 * first instance, composed by `remoteCellEndpointsFor`. */
export function cellEndpointsFrom(
  serves: readonly ServeState[],
  cellBootId: string,
): RemoteCellEndpointSet | undefined {
  const serve = publishedTerminalRoutes(serves);
  if (serve === undefined) return undefined;
  const prefix = remoteCellRoutePrefix(cellBootId);
  if (!serve.routes.some((route) => route.prefix === prefix)) return undefined;
  return remoteCellEndpointsFor(serve.url, cellBootId);
}
