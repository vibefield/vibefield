import type { FielddHandle, FielddSupervisor } from "@vibefield/fieldd-supervisor";

type HandleListener = (handle: FielddHandle) => void;

/** Every successful ensure passes through this boundary. A renderer-triggered
 * recovery therefore repairs main-process observations too, rather than
 * leaving them permanently attached to the first rejected boot promise. */
export class FielddHandleCoordinator {
  private current: FielddHandle | null = null;
  private readonly listeners = new Set<HandleListener>();

  constructor(
    private readonly upstreamEnsure: FielddSupervisor["ensure"],
    private readonly onEnsureError?: (error: unknown) => void,
    private readonly onListenerError?: (error: unknown) => void,
  ) {}

  async ensure(options?: { signal?: AbortSignal }): Promise<FielddHandle> {
    let handle: FielddHandle;
    try {
      handle = await this.upstreamEnsure(options);
    } catch (error) {
      this.onEnsureError?.(error);
      throw error;
    }
    if (this.current !== handle) {
      this.current = handle;
      for (const listener of [...this.listeners]) this.notify(listener, handle);
    }
    return handle;
  }

  onHandle(listener: HandleListener): () => void {
    this.listeners.add(listener);
    if (this.current !== null) this.notify(listener, this.current);
    return () => this.listeners.delete(listener);
  }

  dispose(): void {
    this.listeners.clear();
    this.current = null;
  }

  private notify(listener: HandleListener, handle: FielddHandle): void {
    try {
      listener(handle);
    } catch (error) {
      // A broken observer must not turn a healthy daemon adoption into an
      // ensure() failure for the renderer or prevent sibling observers from
      // seeing the replacement handle.
      this.onListenerError?.(error);
    }
  }
}
