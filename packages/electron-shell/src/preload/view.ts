import {
  type FrameViewState,
  type FrameZoomAct,
  FrameZoomRequest,
  FrameViewState as StateSchema,
} from "@vibefield/contracts";

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

/** The View menu's zoom acts (One Frame FR-4, 3b): EVENTS, not state — a press
 * the head answers now or never. Validated at the preload boundary like every
 * main→renderer payload. With no head listening (a document still loading)
 * an act is dropped, never held: a zoom replayed later would move a canvas
 * nobody pressed for. */
export class PreloadZoomActBridge {
  private readonly handlers = new Set<(act: FrameZoomAct) => void>();

  constructor(private readonly onRejected: (issueCount: number) => void) {}

  accept(raw: unknown): void {
    const parsed = FrameZoomRequest.safeParse(raw);
    if (!parsed.success) {
      this.onRejected(parsed.error.issues.length);
      return;
    }
    for (const handler of this.handlers) handler(parsed.data.act);
  }

  subscribe(handler: (act: FrameZoomAct) => void): () => void {
    this.handlers.add(handler);
    return () => {
      this.handlers.delete(handler);
    };
  }
}
