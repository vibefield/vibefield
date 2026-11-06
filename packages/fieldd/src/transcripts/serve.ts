import { PORTS, RemoteSparkTranscriptSocket } from "@vibefield/contracts";
import type { Logger } from "@vibefield/logging";
import type { ServeSpec, ServeState } from "../mesh-client";
import {
  publishedServe,
  RouteServeDriver,
  type RouteServeLog,
  routeServeSpec,
  type ServedProcess,
} from "../route-serve";
import { TRANSCRIPT_PATH } from "./protocol";

// SP-7a (D1 (B), D4; `SP-7a-plan.md`) — THE TRANSCRIPT WORKER'S ROUTED SERVE: the route-per-process driver's next
// user, after the cells (9422) and rosettad (9424, `index-serve.ts`, whose shape this is).
//
// The worker binds an ephemeral loopback listener per generation (`transcripts/host/listener.ts`). A phone's node
// cannot dial loopback, so this serve gives the worker a FIXED tailnet listener, `PORTS.SPARK_TRANSCRIPT_SERVE`, onto
// the ready generation's port, gated by the linked login. It is re-declared at each generation (a new port), and
// withdrawn while none is ready. A phone's ticket names the endpoint read off the LIVE serve aimed at the generation
// answering now (`transcriptEndpointFrom`). A serve still aimed at a dead generation's port is no endpoint to hand
// out, and the ticket door says `doors_not_published`.
//
// DS-L6 holds without the address: the worker refuses any socket whose first frame is not `open {ticket}` with a
// live, unused ticket, so the serve grants nothing by itself. The port is NOT routable (`MESH_EGRESS`): no desktop's
// window dials another's worker. FW-L12 is conditional: once FW-R5, FW-R7 and FW-R8 land, this serve folds under the
// freeway host with the index serve.

/** The engine identity and display name of the worker's tailnet listener. */
export const TRANSCRIPT_SERVE_ID = "spark-transcripts" as const;

/** The transcript worker as a served process. */
export const TRANSCRIPT_SERVED: ServedProcess = {
  serveId: TRANSCRIPT_SERVE_ID,
  listenPort: PORTS.SPARK_TRANSCRIPT_SERVE,
};

const TRANSCRIPT_SERVE_LOG: RouteServeLog = {
  declared: "fieldd.transcripts.serve.declared",
  deferred: "fieldd.transcripts.serve.declare_deferred",
  declaredMessage: "The transcript worker's serve was declared",
  withdrawnMessage: "The transcript worker's serve was withdrawn",
  deferredMessage: "A transcript serve declaration did not reach the node; the next change retries",
};

/** The serve the current readings call for, or `null`. Pure: the link is the login, and a ready generation's
 * loopback port the one target. */
export function transcriptServeSpec(input: {
  port: number | undefined;
  linkedLogin: string | null;
}): ServeSpec | null {
  return routeServeSpec(TRANSCRIPT_SERVED, {
    published: true,
    linkedLogin: input.linkedLogin,
    targets: input.port === undefined ? null : { kind: "port", port: input.port },
  });
}

export interface TranscriptServeDriverOptions {
  /** the ready generation's loopback port (`TranscriptHostSupervisor.health().port`), undefined while none is */
  port: () => number | undefined;
  /** the WhoIs login this daemon is linked to, or null */
  linkedLogin: () => string | null;
  /** remove-then-add through the mesh; true iff the node now matches (F-M5) */
  declare: (spec: ServeSpec | null) => Promise<boolean>;
  /** the mesh's live serve view: a declaration found landed later (route-serve.ts) */
  serves?: () => readonly ServeState[];
  logger?: Logger;
}

/** Drives the worker's serve: re-aimed at every generation, withdrawn while none is ready, never declared without a
 * linked login. */
export class TranscriptServeDriver extends RouteServeDriver {
  constructor(opts: TranscriptServeDriverOptions) {
    super({
      desired: () => transcriptServeSpec({ port: opts.port(), linkedLogin: opts.linkedLogin() }),
      declare: opts.declare,
      ...(opts.serves !== undefined ? { serves: opts.serves } : {}),
      log: TRANSCRIPT_SERVE_LOG,
      ...(opts.logger !== undefined ? { logger: opts.logger } : {}),
    });
  }
}

/** The endpoint a phone's ticket names, read off the LIVE serve: active with a URL, AND aimed at the generation
 * answering now (`port`). Its scheme follows the serve's (http → ws, https → wss), its host and port are the
 * serve's, and its path is the worker's. Undefined for anything else, and for a URL the contract would refuse
 * (`RemoteSparkTranscriptSocket`), so a ticket never names a socket the phone cannot use. */
export function transcriptEndpointFrom(
  serves: readonly ServeState[],
  port: number | undefined,
): RemoteSparkTranscriptSocket | undefined {
  const serve = publishedServe(serves, TRANSCRIPT_SERVE_ID);
  if (serve === undefined || port === undefined) return undefined;
  if (serve.target.kind !== "port" || serve.target.port !== port) return undefined;
  let base: URL;
  try {
    base = new URL(serve.url);
  } catch {
    return undefined;
  }
  const scheme =
    base.protocol === "https:" ? "wss:" : base.protocol === "http:" ? "ws:" : undefined;
  if (scheme === undefined) return undefined;
  const endpoint = RemoteSparkTranscriptSocket.safeParse(
    `${scheme}//${base.host}${TRANSCRIPT_PATH}`,
  );
  return endpoint.success ? endpoint.data : undefined;
}
