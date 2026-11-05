import { randomBytes } from "node:crypto";
import {
  type CallerContext,
  SPARK_TRANSCRIPT,
  SPARK_TRANSCRIPT_SERVICE,
  type SparkId,
  SparkTranscriptOpenTicketParams,
  type SparkTranscriptOpenTicketResult,
} from "@vibefield/contracts";
import { RpcCallError } from "../native-link";
import type { SparkTranscripts } from "../spark-transcripts";
import { isWorkspaceWindow } from "../workspace/doors";
import { TRANSCRIPT_PATH } from "./protocol";
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
// spark's runs, oldest first, read from its folder: a folder the disk would not hand over is the honest UNAVAILABLE,
// never an empty list.

export interface SparkTranscriptTicketsOptions {
  readonly store: Pick<SparkTranscripts, "runs">;
  readonly supervisor: Pick<TranscriptHostSupervisor, "request" | "health">;
  /** whether this desktop keeps the spark (its record verifies) */
  hasSpark(id: SparkId): boolean;
  readonly now?: () => number;
}

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
    if (!isWorkspaceWindow(ctx) || ctx.principal.kind !== "local-token")
      throw new RpcCallError(
        "FORBIDDEN_SCOPE",
        "A spark's transcript opens only in this desktop's window",
        false,
      );
    const parsed = SparkTranscriptOpenTicketParams.safeParse(params);
    if (!parsed.success) throw new RpcCallError("PRECONDITION_FAILED", "expected { spark }", false);
    const { spark } = parsed.data;
    if (!this.opts.hasSpark(spark))
      throw new RpcCallError("NOT_FOUND", "this desktop keeps no such spark", false);
    const runs = this.opts.store.runs(spark);
    if ("unavailable" in runs)
      throw new RpcCallError(
        "UNAVAILABLE",
        "VibeField can't read this spark's conversation; nothing was changed",
        true,
        {
          service: SPARK_TRANSCRIPT_SERVICE.SERVICE,
          state: SPARK_TRANSCRIPT_SERVICE.STATE_UNREADABLE,
        },
      );
    const ticket = randomBytes(32).toString("base64url");
    const expiresAt = this.#now() + SPARK_TRANSCRIPT.TICKET_TTL_MS;
    let port: number;
    try {
      ({ port } = await this.opts.supervisor.request("registerTicket", {
        ticket,
        spark,
        clientId: ctx.principal.tokenId,
        expiresAt,
      }));
    } catch (error) {
      return hostError(error);
    }
    return {
      spark,
      endpoint: `ws://127.0.0.1:${port}${TRANSCRIPT_PATH}`,
      ticket,
      expiresAt,
      generation: this.opts.supervisor.health().generation,
      runs: [...runs.runs],
    };
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
