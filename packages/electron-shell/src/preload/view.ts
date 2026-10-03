import { type FrameViewState, FrameViewState as StateSchema } from "@vibefield/contracts";

/** Latest-value bridge for this window's view (the terminal-status bridge's
 * shape, for the same reason): main publishes the truth on load and on every
 * change, and a page that subscribes late — the chrome mounts well after the
 * document does — must still learn what it missed rather than assume the
 * canvas. */
export class PreloadViewStateBridge {
  private readonly handlers = new Set<(state: FrameViewState) => void>();
  private latest: FrameViewState | null = null;

  constructor(private readonly onRejected: (issueCount: number) => void) {}

  accept(raw: unknown): void {
    const parsed = StateSchema.safeParse(raw);
    if (!parsed.success) {
      this.onRejected(parsed.error.issues.length);
      return;
    }
    this.latest = parsed.data;
    for (const handler of this.handlers) handler(parsed.data);
  }

  subscribe(handler: (state: FrameViewState) => void): () => void {
    this.handlers.add(handler);
    if (this.latest !== null) handler(this.latest);
    return () => {
      this.handlers.delete(handler);
    };
  }
}
