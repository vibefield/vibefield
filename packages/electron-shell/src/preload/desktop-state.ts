import {
  type DesktopShellState,
  DesktopShellState as DesktopShellStateSchema,
} from "@vibefield/contracts";

/** Latest-value bridge for main-owned desktop capability truth. Main can
 * publish before React mounts; every later subscriber receives the current
 * validated snapshot immediately.
 *
 * Item 315 — it fans out: the field's chrome and the switch's layer both read
 * the desktop state, and before item 315 a second subscriber replaced the
 * first. Each subscriber gets the latest snapshot as it subscribes and every
 * snapshot after. The same reader subscribed twice is one entry, so either of
 * its two unsubscribes removes it. A reader that throws is reported to
 * `onHandlerError` and never stops the others: the preload has no caller to
 * hand the throw back to, and one broken reader must not starve the rest. */
export class PreloadDesktopStateBridge {
  private readonly handlers = new Set<(state: DesktopShellState) => void>();
  private latest: DesktopShellState | null = null;

  constructor(
    private readonly onRejected: (issueCount: number) => void,
    /** a reader that threw, reported once per throw; the others still ran */
    private readonly onHandlerError: (error: unknown) => void = () => undefined,
  ) {}

  accept(raw: unknown): void {
    const parsed = DesktopShellStateSchema.safeParse(raw);
    if (!parsed.success) {
      this.onRejected(parsed.error.issues.length);
      return;
    }
    this.latest = parsed.data;
    for (const handler of [...this.handlers]) this.deliver(handler, parsed.data);
  }

  subscribe(handler: (state: DesktopShellState) => void): () => void {
    this.handlers.add(handler);
    if (this.latest !== null) this.deliver(handler, this.latest);
    return () => {
      this.handlers.delete(handler);
    };
  }

  private deliver(handler: (state: DesktopShellState) => void, state: DesktopShellState): void {
    try {
      handler(state);
    } catch (error) {
      this.onHandlerError(error);
    }
  }
}
