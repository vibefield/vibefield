import { type ShellCommand, ShellCommandRequest } from "@vibefield/contracts";

/** Main may send immediately after did-finish-load, before React registers its
 * effect. This bounded bridge validates at the preload boundary and retains
 * only the latest presentation intent until the one renderer handler exists. */
export class PreloadShellCommandBridge {
  private handler: ((command: ShellCommand) => void) | null = null;
  private pending: ShellCommand | null = null;

  constructor(private readonly onRejected: (issueCount: number) => void) {}

  accept(raw: unknown): void {
    const request = ShellCommandRequest.safeParse(raw);
    if (!request.success) {
      this.onRejected(request.error.issues.length);
      return;
    }
    if (this.handler === null) {
      this.pending = request.data.command;
      return;
    }
    this.handler(request.data.command);
  }

  subscribe(handler: (command: ShellCommand) => void): () => void {
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
