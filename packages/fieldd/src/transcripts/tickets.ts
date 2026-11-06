import { randomBytes } from "node:crypto";
import {
  type CallerContext,
  SPARK_TRANSCRIPT,
  SPARK_TRANSCRIPT_SERVICE,
  type SparkId,
  SparkTranscriptOpenTicketParams,
  type SparkTranscriptOpenTicketResult,
} from "@vibefield/contracts";
import type { ServeState } from "../mesh-client";
import { RpcCallError } from "../native-link";
import type { SparkTranscripts } from "../spark-transcripts";
import { clientIdFor, isSelfPeerDaemon, isSelfTailnetPrincipal } from "../terminal-grants";
import { isWorkspaceWindow } from "../workspace/doors";
import { TRANSCRIPT_PATH } from "./protocol";
import { transcriptEndpointFrom } from "./serve";
import {
  TranscriptHostRefusal,
  type TranscriptHostSupervisor,
  TranscriptHostUnavailable,
} from "./supervisor";

// TH-1 (TH-Q30 (a′); VF-PM's X2) — `compose.sparks.transcript.openTicket`, fieldd's half: a single-use credential for
// one spark's transcript on the transcript worker's loopback listener, in the files tickets' shape
// (workspace/tickets.ts). The method's scope is the family's `sparks.use`; this gate is narrower: a renderer window
// of this desktop alone (its own local token, over the loopback socket, with a renderer participant). Shell-main, a
// plugin, an MCP agent, a plain local token, a phone and a peer daemon are refused (EL7). The answer names the
// spark's runs, oldest first, read from its folder: a folder the disk would not hand over is the store's own refusal
// (item 172's guard: UNAVAILABLE {spark-transcripts, records-unreadable}), never an empty list.
//
// *SP-7a (D2, 2026-11-06; `SP-7a-plan.md`): the phone is a holder too, by two roads. This person's phone asking this
// desktop directly is a self `tailnet` principal, which it is when this desktop is its home. The phone behind its home
// is a self peer daemon whose `onBehalfOf.clientDeviceId` names it: F1b's field, restrict-only, read only to tell a
// phone from a desktop (a forward naming one of this roster's desktops, or no client device, is refused). Neither asks
// a freeway approval: the thread is a read, the self login is the account (UA-P), and approval stays the terminals'
// (FW-L3). A phone's ticket names the worker's ROUTED SERVE, read off the live serve aimed at the generation answering
// now (`serve.ts`). No such serve is UNAVAILABLE `doors_not_published`, retryable, naming this desktop, and nothing is
// minted. A window keeps its loopback listener. `clientId` is the window's token as before, and the phone's
// `clientIdFor` (DS-4c's key), so a phone's tickets and sockets are its own in `revokeClient`.*
// *SP-7b's 7c-1 (2026-11-06): behind its home that key is the phone's device under its home
// (`peer-fieldd:<home>#phone:<device>`), no longer its connection there — its reconnects are one holder.*

export interface SparkTranscriptTicketsOptions {
  readonly store: Pick<SparkTranscripts, "runs">;
  readonly supervisor: Pick<TranscriptHostSupervisor, "request" | "health">;
  /** whether this desktop keeps the spark (its record verifies) */
  hasSpark(id: SparkId): boolean;
  readonly now?: () => number;
  /** SP-7a — this desktop's device id, named in a phone's `doors_not_published` */
  readonly deviceId?: () => string;
  /** SP-7a — the mesh's live serve view (`MeshClient.serves()`), for a phone's endpoint; none serves no phone */
  readonly serves?: () => readonly ServeState[];
  /** SP-7a — whether a roster device is a desktop (a forward naming one is no phone's) */
  readonly isDesktop?: (deviceId: string) => boolean;
}

/** Who a ticket is for: a window of this desktop, on its loopback listener, or this person's phone, on the worker's
 * routed serve. */
type Holder = { readonly kind: "window" | "phone"; readonly clientId: string };

/** A worker that could not answer, in the door's words. */
function hostError(error: unknown): never {
  if (error instanceof TranscriptHostUnavailable)
    throw new RpcCallError("UNAVAILABLE", error.message, error.retryable, {
      service: SPARK_TRANSCRIPT_SERVICE.SERVICE,
      state: error.state,
    });
  if (error instanceof TranscriptHostRefusal)
    throw new RpcCallError(
      error.error.code === "busy" ? "RESOURCE_EXHAUSTED" : "INTERNAL",
      error.message,
      error.error.code === "busy",
    );
  throw error;
}

export class SparkTranscriptTickets {
  readonly #now: () => number;

  constructor(readonly opts: SparkTranscriptTicketsOptions) {
    this.#now = opts.now ?? Date.now;
  }

  async open(ctx: CallerContext, params: unknown): Promise<SparkTranscriptOpenTicketResult> {
    const holder = this.#holderOf(ctx);
    const parsed = SparkTranscriptOpenTicketParams.safeParse(params);
    if (!parsed.success)
      throw new RpcCallError("PRECONDITION_FAILED", "expected { spark, device? }", false);
    const { spark } = parsed.data;
    if (!this.opts.hasSpark(spark))
      throw new RpcCallError("NOT_FOUND", "this desktop keeps no such spark", false);
    // a folder, a run's file or the key the disk does not hand over: the store's own refusal, item 172's
    // (UNAVAILABLE {spark-transcripts, records-unreadable}, in fieldd's words), never an empty list
    const runs = this.opts.store.runs(spark);
    // a phone's road is the routed serve: with none aimed at the generation answering now, nothing is minted
    const live = this.opts.supervisor.health().port ?? undefined;
    if (holder.kind === "phone" && this.#remote(live) === undefined)
      throw this.#doorsNotPublished();
    const ticket = randomBytes(32).toString("base64url");
    const expiresAt = this.#now() + SPARK_TRANSCRIPT.TICKET_TTL_MS;
    let port: number;
    try {
      ({ port } = await this.opts.supervisor.request("registerTicket", {
        ticket,
        spark,
        clientId: holder.clientId,
        expiresAt,
      }));
    } catch (error) {
      return hostError(error);
    }
    let endpoint: string;
    if (holder.kind === "window") endpoint = `ws://127.0.0.1:${port}${TRANSCRIPT_PATH}`;
    else {
      // read again against the port the ticket was registered on: a generation that turned over meanwhile has a
      // serve still being re-aimed, and the ticket, never handed out, lapses unused
      const remote = this.#remote(port);
      if (remote === undefined) throw this.#doorsNotPublished();
      endpoint = remote;
    }
    return {
      spark,
      endpoint,
      ticket,
      expiresAt,
      generation: this.opts.supervisor.health().generation,
      runs: [...runs.runs],
    };
  }

  /** Every holder this door mints for, else the refusal in its words (the header). */
  #holderOf(ctx: CallerContext): Holder {
    const principal = ctx.principal;
    if (isWorkspaceWindow(ctx) && principal.kind === "local-token")
      return { kind: "window", clientId: principal.tokenId };
    if (isSelfTailnetPrincipal(principal))
      return { kind: "phone", clientId: clientIdFor(principal) };
    const phone = ctx.onBehalfOf?.clientDeviceId;
    if (isSelfPeerDaemon(principal) && phone !== undefined && this.opts.isDesktop?.(phone) !== true)
      return { kind: "phone", clientId: clientIdFor(principal, ctx.onBehalfOf) };
    throw new RpcCallError(
      "FORBIDDEN_SCOPE",
      principal.kind === "peer-fieldd"
        ? "A spark's transcript is minted for a peer daemon only for the phone behind it"
        : "A spark's transcript opens only in this desktop's window, or on this person's phone",
      false,
    );
  }

  /** The phone's endpoint off the live serve aimed at `port`, or undefined. */
  #remote(port: number | undefined): string | undefined {
    return transcriptEndpointFrom(this.opts.serves?.() ?? [], port);
  }

  #doorsNotPublished(): RpcCallError {
    const device = this.opts.deviceId?.() ?? "";
    return new RpcCallError(
      "UNAVAILABLE",
      "this desktop's transcript serve is not published yet",
      true,
      {
        service: SPARK_TRANSCRIPT_SERVICE.SERVICE,
        state: SPARK_TRANSCRIPT_SERVICE.STATE_DOORS_NOT_PUBLISHED,
        device,
      },
    );
  }

  /** A window's token was revoked: its tickets go, and its sockets close. */
  async revokeClient(clientId: string): Promise<void> {
    try {
      await this.opts.supervisor.request("revokeClient", { clientId });
    } catch (error) {
      if (!(error instanceof TranscriptHostUnavailable)) throw error;
    }
  }
}
