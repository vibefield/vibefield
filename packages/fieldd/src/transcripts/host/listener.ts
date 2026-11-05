import { once } from "node:events";
import { join } from "node:path";
import { WebSocketServer } from "ws";
import type { LineVerifier } from "../../spark-transcript-lines";
import type { TicketRegistration } from "../protocol";

// TH-1 (TH0-Q5 (b)) — THE TRANSCRIPT WORKER'S LISTENER. One loopback WebSocket server (`/transcripts`), each socket one
// window reading one spark's runs:
// - a socket's first frame is `open {ticket, runs}`: the ticket fieldd registered (single use; redeemable until its
//   `expiresAt`, which bounds redemption alone — an open socket has no timer, the files erratum of 2026-10-07), each
//   run one of that spark's files. A foreign Origin, a ticket unknown, used or expired, a run not the spark's, a frame
//   that is not an `open` are each refused in the worker's word, and the socket closes;
// - then `ready {generation}`, each named run's verified lines after the seq the window holds, `caught-up {dropped}`,
//   and the tail: a run's file that grew (fieldd's `appended` nudge) serves its next lines; a run of the spark begun
//   after the open is announced (`run`) and served from its start;
// - every line is read from the spark's folder and verified under the key fieldd handed on the pipe
//   (`spark-transcript-lines.ts`): one that fails is never served, only counted.
// Read-only: the listener never writes, renames or sets aside (fieldd's store does).

/** The worker's own bounds. */
export const TRANSCRIPT_HOST_LIMITS = {
  /** sockets at once, every window's */
  SOCKETS_MAX: 64,
  /** tickets registered and not yet redeemed */
  TICKETS_MAX: 256,
  /** the one frame a window sends */
  OPEN_BYTES: 64 * 1024,
  /** one read of a run's file */
  READ_CHUNK_BYTES: 1024 * 1024,
  /** a socket whose window is this far behind is closed; it asks again */
  SOCKET_BUFFER_BYTES: 16 * 1024 * 1024,
} as const;

/** What the listener refuses with, in the contract's open words. */
export type TranscriptRefusal =
  | "ticket-unknown"
  | "ticket-used"
  | "ticket-expired"
  | "origin"
  | "run-unknown"
  | "malformed"
  | "busy";

/** A registration the worker will not hold. */
export class HostFailure extends Error {
  constructor(
    readonly code: "busy" | "invalid",
    message: string,
  ) {
    super(message);
  }
}

export interface TranscriptListenerOptions {
  /** LAYOUT.SPARK_FILES_DIR, absolute */
  readonly dir: string;
  readonly verify: LineVerifier;
  /** the Origins a window may send; a socket with no Origin is a client of this machine's own */
  readonly allowedOrigins: readonly string[];
  readonly generation: number;
  /** test seam; production listens on an ephemeral port */
  readonly port?: number;
  readonly now?: () => number;
  readonly onLog?: (event: string, message: string, fields?: Record<string, unknown>) => void;
}

// TH-1 (red): a skeleton; the green commit builds it.
export class TranscriptListener {
  private constructor(
    private readonly server: WebSocketServer,
    readonly opts: TranscriptListenerOptions,
  ) {
    server.on("connection", (socket) => socket.terminate());
  }

  static async start(opts: TranscriptListenerOptions): Promise<TranscriptListener> {
    const server = new WebSocketServer({ host: "127.0.0.1", port: opts.port ?? 0 });
    const listener = new TranscriptListener(server, opts);
    await once(server, "listening");
    return listener;
  }

  get port(): number {
    const address = this.server.address();
    if (typeof address === "string" || address === null) throw new Error("not listening");
    return address.port;
  }

  register(_ask: TicketRegistration): void {}

  closeTicket(_clientId: string, _ticket: string): boolean {
    return false;
  }

  revokeClient(_clientId: string): void {}

  appended(_spark: string, _run: string): void {}

  async close(): Promise<void> {
    await new Promise<void>((resolve) => this.server.close(() => resolve()));
  }
}
