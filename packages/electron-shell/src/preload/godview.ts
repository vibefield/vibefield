import { type GodviewState, GodviewState as StateSchema } from "@vibefield/contracts";

/** Latest-value bridge for this window's Godview state (the terminal-status
 * bridge's shape, for the same reason): main publishes the truth on load and on
 * every ⇧⇧, and a page that subscribes late — the chrome mounts well after the
 * document does — must still learn what it missed rather than assume closed. */
export class PreloadGodviewStateBridge {
  private readonly handlers = new Set<(state: GodviewState) => void>();
  private latest: GodviewState | null = null;

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

  subscribe(handler: (state: GodviewState) => void): () => void {
    this.handlers.add(handler);
    if (this.latest !== null) handler(this.latest);
    return () => {
      this.handlers.delete(handler);
    };
  }
}
