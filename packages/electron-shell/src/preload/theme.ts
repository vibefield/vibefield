import { ThemeState as StateSchema, type ThemeState } from "@vibefield/contracts";

/** Latest-value bridge for the app's one theme (FR-4, FC-D5) — the view
 * bridge's shape, for its reason: main tells a document the theme as it
 * finishes loading and on every change, and the chrome that draws the choice
 * (the Me menu, Settings) mounts well after that, so a late subscriber must
 * still learn what it missed rather than guess. */
export class PreloadThemeStateBridge {
  private readonly handlers = new Set<(state: ThemeState) => void>();
  private latest: ThemeState | null = null;

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

  subscribe(handler: (state: ThemeState) => void): () => void {
    this.handlers.add(handler);
    if (this.latest !== null) handler(this.latest);
    return () => {
      this.handlers.delete(handler);
    };
  }
}
