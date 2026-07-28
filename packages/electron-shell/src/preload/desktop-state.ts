import {
  type DesktopShellState,
  DesktopShellState as DesktopShellStateSchema,
} from "@vibefield/contracts";

/** Latest-value bridge for main-owned desktop capability truth. Main can
 * publish before React mounts; every later subscriber receives the current
 * validated snapshot immediately. */
export class PreloadDesktopStateBridge {
  private handler: ((state: DesktopShellState) => void) | null = null;
  private latest: DesktopShellState | null = null;

  constructor(private readonly onRejected: (issueCount: number) => void) {}

  accept(raw: unknown): void {
    const parsed = DesktopShellStateSchema.safeParse(raw);
    if (!parsed.success) {
      this.onRejected(parsed.error.issues.length);
      return;
    }
    this.latest = parsed.data;
    this.handler?.(parsed.data);
  }

  subscribe(handler: (state: DesktopShellState) => void): () => void {
    this.handler = handler;
    if (this.latest !== null) handler(this.latest);
    return () => {
      if (this.handler === handler) this.handler = null;
    };
  }
}
