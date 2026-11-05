import type { CallerContext, SparkId, SparkTranscriptOpenTicketResult } from "@vibefield/contracts";
import { RpcCallError } from "../native-link";
import type { SparkTranscripts } from "../spark-transcripts";
import type { TranscriptHostSupervisor } from "./supervisor";

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

// TH-1 (red): a skeleton; the green commit builds it.
export class SparkTranscriptTickets {
  constructor(readonly opts: SparkTranscriptTicketsOptions) {}

  async open(_ctx: CallerContext, _params: unknown): Promise<SparkTranscriptOpenTicketResult> {
    throw new RpcCallError("UNAVAILABLE", "not built", true);
  }

  async revokeClient(_clientId: string): Promise<void> {}
}
