import {
  INDEX_TICKET,
  IndexOpenTicketParams,
  PORTS,
  type RemoteIndexEndpointSet,
  remoteIndexEndpointsFor,
} from "@vibefield/contracts";
import type { Logger } from "@vibefield/logging";
import type { ServeSpec, ServeState } from "./mesh-client";
import { RpcCallError } from "./native-link";
import {
  publishedServe,
  RouteServeDriver,
  type RouteServeLog,
  routeServeSpec,
  type ServedProcess,
} from "./route-serve";

// SP-3 (thinking-sync-planes.md §5.4, §6; thinking-desktop-sync-plane.md §6.4;
// design-06 §6, §8) — ROSETTAD'S SERVE: the route-per-process driver's SECOND
// user, after the cells.
//
// A session's transcript is read at the OWNER's rosettad, as rosetta's own
// stream (history to a stamp, the live tail, `resync`), with fieldd out of the
// byte path (SP-7's witness). So the owner publishes rosettad's loopback
// listener as ONE serve on a fixed port, `PORTS.INDEX_SERVE`, gated by the
// linked login like every serve: the WHOLE listener onto the daemon's
// ephemeral loopback port, nothing stripped (`kind: "port"`), so a client
// dials rosetta's own routes at the root — `RemoteIndexEndpointSet`'s one leg,
// `/ws/sessions/<id>` — and the asset paths a timeline names stay dialable.
//
// BEHIND A FLAG THAT IS OFF (`FielddConfig.indexDirectPlane`), and the reason
// is EL7, not caution for its own sake. The PINNED rosettad verifies no
// credential: RO-1's bearer on every route and RO-10's per-session grants are
// built on rosetta's `feat/direct-plane-grants` and unmerged, and the
// supervisor's own header says what that means — until RO-1, "the daemon's
// ORIGIN is the secret". Publishing it would put every transcript, and its two
// writes, one same-login node away. DS-7's pin move brings the bearer and the
// grant key: fieldd starts rosettad with both files, `index.openTicket` mints
// the grant, DS-L6's routable list gains this port, and the flag goes away.
//
// WHY A CONFIG FIELD, not a registry constant: it is a fact about THIS daemon's
// rosettad (is it started with a credential?), not wire truth two planes
// share — `registries.ts` is generated into Rust and mirrored by the kit, and
// a feature switch there is dead weight for both; the witness needs both
// positions in one test process, which a constant cannot give without module
// mocks; and no environment variable reaches it, so a same-uid process cannot
// turn it on by launching fieldd with one — only a code edit can (bin.ts sets
// nothing), which is DS-7's to make.
//
// A CONSTRUCTION-TIME FACT: with the flag off no driver exists and fieldd makes
// no index serve call at all — a boot is byte-for-byte what it was. The residue
// is F-H1's: a listener a flag-ON predecessor left in the floor stays there
// until the floor's unlink-retire, or until a flag-on successor's first refresh
// withdraws it. Tolerable while only tests turn the flag on; DS-7, which turns
// it on for good, inherits F-H1 through the driver as written.

/** The engine identity and display name of rosettad's listener. */
export const INDEX_SERVE_ID = "index" as const;

/** SP-3 — rosettad as a served process. */
export const INDEX_SERVED: ServedProcess = {
  serveId: INDEX_SERVE_ID,
  listenPort: PORTS.INDEX_SERVE,
};

const INDEX_SERVE_LOG: RouteServeLog = {
  declared: "fieldd.index_serve.declared",
  deferred: "fieldd.index_serve.declare_deferred",
  declaredMessage: "The index serve was declared",
  withdrawnMessage: "The index serve was withdrawn",
  deferredMessage: "An index serve declaration did not reach the node; the next change retries",
};

/** The loopback port behind rosettad's origin (`http://127.0.0.1:<port>`,
 * `RosettadState.origin` while ready), or `undefined` for anything else — a
 * daemon that is not ready, or an origin that is not a literal loopback one
 * (the supervisor refuses those already; this does not trust that it did). */
export function indexTargetPort(origin: string | null): number | undefined {
  if (origin === null) return undefined;
  let url: URL;
  try {
    url = new URL(origin);
  } catch {
    return undefined;
  }
  if (url.protocol !== "http:" || url.hostname !== "127.0.0.1") return undefined;
  const port = Number(url.port);
  return Number.isInteger(port) && port > 0 && port <= 65_535 ? port : undefined;
}

/** The serve the current state calls for, or `null`. Pure: the route driver's
 * three gates — the flag is the owner's word, the link the login, a ready
 * rosettad the one routable target. */
export function indexServeSpec(input: {
  enabled: boolean;
  origin: string | null;
  linkedLogin: string | null;
}): ServeSpec | null {
  const port = indexTargetPort(input.origin);
  return routeServeSpec(INDEX_SERVED, {
    published: input.enabled,
    linkedLogin: input.linkedLogin,
    targets: port === undefined ? null : { kind: "port", port },
  });
}

export interface IndexServeDriverOptions {
  /** fieldd's `indexDirectPlane` (the owner's word; OFF until DS-7) */
  enabled: () => boolean;
  /** rosettad's loopback origin while ready (`RosettadSupervisor.state()`) */
  origin: () => string | null;
  /** the WhoIs login this daemon is linked to, or null */
  linkedLogin: () => string | null;
  /** remove-then-add through the mesh; true iff the node now matches (F-M5) */
  declare: (spec: ServeSpec | null) => Promise<boolean>;
  logger?: Logger;
}

/** Drives rosettad's serve: re-aimed at every restart (a new loopback port),
 * withdrawn while the daemon is down, never declared without a linked login. */
export class IndexServeDriver extends RouteServeDriver {
  constructor(opts: IndexServeDriverOptions) {
    super({
      desired: () =>
        indexServeSpec({
          enabled: opts.enabled(),
          origin: opts.origin(),
          linkedLogin: opts.linkedLogin(),
        }),
      declare: opts.declare,
      log: INDEX_SERVE_LOG,
      ...(opts.logger !== undefined ? { logger: opts.logger } : {}),
    });
  }
}

/** The set a ticket for one session names, read off the LIVE index serve: the
 * serve is active with a URL AND aimed at the rosettad answering NOW. A
 * restart moves rosettad's port; until the re-declare lands the serve forwards
 * to a dead port, and a URL into it is not one a client can act on — that is
 * `undefined`, as a cell whose route has not landed is. DS-7's door names this
 * beside the grant it mints; until then nothing hands it out. */
export function indexEndpointsFrom(
  serves: readonly ServeState[],
  origin: string | null,
  sessionId: string,
): RemoteIndexEndpointSet | undefined {
  const serve = publishedServe(serves, INDEX_SERVE_ID);
  if (serve === undefined) return undefined;
  const port = indexTargetPort(origin);
  if (port === undefined || serve.target.kind !== "port" || serve.target.port !== port)
    return undefined;
  return remoteIndexEndpointsFor(serve.url, sessionId);
}

/**
 * SP-3 — `index.openTicket`, DECLARED and answered honestly (declared ==
 * shipped, D36): the ask is checked first, so a malformed one is the caller's
 * to fix; then UNAVAILABLE {service: "index", state: "direct-plane-unbuilt"},
 * retryable false, whatever the flag above says. A ticket is the set AND the
 * grant beside it, and until DS-7 mints rosetta's grant (RO-10, at the pin
 * move) there is no grant — the pinned rosettad verifies none — so there is no
 * ticket to hand out, only half of one, which the template never mints.
 * Reached by a foreign `device` too: the method is `federate`, so the asker's
 * daemon forwards it keyed and THIS answer travels back untouched (PeerLink
 * passes an owner's coded reply through).
 */
export function indexOpenTicket(params: unknown): never {
  const parsed = IndexOpenTicketParams.safeParse(params ?? {});
  if (!parsed.success)
    throw new RpcCallError(
      "PRECONDITION_FAILED",
      "expected { sessionId: string, device?: string }",
      false,
    );
  throw new RpcCallError(
    "UNAVAILABLE",
    "index.openTicket is declared and not served yet: the direct plane needs rosetta's per-session grant (RO-10), which arrives with its pin move (DS-7)",
    false,
    { service: INDEX_TICKET.SERVICE, state: INDEX_TICKET.STATE_UNBUILT },
  );
}
