import {
  type ScreenshotCaptureResult,
  ScreenshotCaptureResult as ScreenshotCaptureResultSchema,
} from "@vibefield/contracts";

/** Main sends the View menu's capture result the moment it lands (SNAP-3),
 * which may be before React has registered the one effect that listens. This
 * bounded bridge validates at the preload boundary and retains only the latest
 * result until the renderer handler exists — a result is an event, not state,
 * so a second one before anyone listens replaces the first rather than
 * queueing behind it. */
export class PreloadScreenshotResultBridge {
  private handler: ((result: ScreenshotCaptureResult) => void) | null = null;
  private pending: ScreenshotCaptureResult | null = null;

  constructor(private readonly onRejected: (issueCount: number) => void) {}

  accept(raw: unknown): void {
    const parsed = ScreenshotCaptureResultSchema.safeParse(raw);
    if (!parsed.success) {
      this.onRejected(parsed.error.issues.length);
      return;
    }
    if (this.handler === null) {
      this.pending = parsed.data;
      return;
    }
    this.handler(parsed.data);
  }

  subscribe(handler: (result: ScreenshotCaptureResult) => void): () => void {
    this.handler = handler;
    if (this.pending !== null) {
      const pending = this.pending;
      this.pending = null;
      handler(pending);
    }
    return () => {
      if (this.handler === handler) this.handler = null;
    };
  }
}
