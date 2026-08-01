import {
  TerminalBridgeStatus as StatusSchema,
  type TerminalBridgeStatus,
} from "@vibefield/contracts";

/** Latest-value bridge for this window's terminal transport status. Main can
 * publish a death before a listener exists — a page that mounts its deck late
 * must still learn the bridge is down — so the last validated status is
 * replayed to each subscriber. Multiple subscribers are supported: the deck and
 * whatever chrome reports honest states are different readers of one truth. */
export class PreloadTerminalStatusBridge {
  private readonly handlers = new Set<(status: TerminalBridgeStatus) => void>();
  private latest: TerminalBridgeStatus | null = null;

  constructor(private readonly onRejected: (issueCount: number) => void) {}

  accept(raw: unknown): void {
    const parsed = StatusSchema.safeParse(raw);
    if (!parsed.success) {
      this.onRejected(parsed.error.issues.length);
      return;
    }
    this.latest = parsed.data;
    for (const handler of this.handlers) handler(parsed.data);
  }

  subscribe(handler: (status: TerminalBridgeStatus) => void): () => void {
    this.handlers.add(handler);
    if (this.latest !== null) handler(this.latest);
    return () => {
      this.handlers.delete(handler);
    };
  }
}
