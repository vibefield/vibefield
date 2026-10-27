import type { FielddHandle, FielddSupervisor } from "@vibefield/fieldd-supervisor";

type HandleListener = (handle: FielddHandle) => void;
export const FIELDD_REPROBE_AFTER_MS = 3_000;

export interface FielddDaemonBootTransition {
  readonly previousBootId: string;
  readonly nextBootId: string;
}

/** Distinguishes harmless handle-object churn from replacement of fieldd's
 * entire in-memory authority epoch. The attachment owner decides how to fence
 * surviving renderer realms when a transition is returned. */
export class FielddDaemonBootFence {
  private bootId: string | null = null;

  observe(handle: Pick<FielddHandle, "info">): FielddDaemonBootTransition | null {
    const nextBootId = handle.info.bootId;
    if (this.bootId === null) {
      this.bootId = nextBootId;
      return null;
    }
    if (this.bootId === nextBootId) return null;
    const transition = Object.freeze({
      previousBootId: this.bootId,
      nextBootId,
    });
    this.bootId = nextBootId;
    return transition;
  }
}

/** Every successful ensure passes through this boundary. A renderer-triggered
 * recovery therefore repairs main-process observations too, rather than
 * leaving them permanently attached to the first rejected boot promise. */
export class FielddHandleCoordinator {
  private current: FielddHandle | null = null;
  private stopCurrentStatus: (() => void) | null = null;
  private reprobeTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly listeners = new Set<HandleListener>();
  private disposed = false;
  /** WP12c (`build-wp12-updater.md` §10 S3/S4; the PM's ruling 13:40Z) — set just before an update stops the daemons:
   * after the daemon stop nothing may call `ensure()`, which SPAWNS (a pair under a possibly armed install), and the
   * auto-recovery below must not either. Released only by an abort that stopped nothing. */
  private held = false;

  constructor(
    private readonly upstreamEnsure: FielddSupervisor["ensure"],
    private readonly onEnsureError?: (error: unknown) => void,
    private readonly onListenerError?: (error: unknown) => void,
    private readonly reprobeAfterMs = FIELDD_REPROBE_AFTER_MS,
  ) {
    if (!Number.isSafeInteger(reprobeAfterMs) || reprobeAfterMs < 0) {
      throw new Error("fieldd reprobe deadline must be a nonnegative safe integer");
    }
  }

  async ensure(options?: { signal?: AbortSignal }): Promise<FielddHandle> {
    if (this.disposed) throw new Error("fieldd handle coordinator is disposed");
    if (this.held)
      throw new Error("fieldd is held for a stop: nothing may start it until the app exits");
    let handle: FielddHandle;
    try {
      handle = await this.upstreamEnsure(options);
    } catch (error) {
      this.onEnsureError?.(error);
      throw error;
    }
    if (this.current !== handle) {
      this.clearReprobeTimer();
      this.stopCurrentStatus?.();
      this.current = handle;
      this.stopCurrentStatus = handle.client.onStatusChange(() => {
        if (this.disposed || this.current !== handle || this.held) return;
        if (handle.client.status === "ready") {
          this.clearReprobeTimer();
          return;
        }
        if (handle.client.status === "reconnecting") {
          if (this.reprobeTimer === null) {
            this.reprobeTimer = setTimeout(() => {
              this.reprobeTimer = null;
              if (
                !this.disposed &&
                this.current === handle &&
                handle.client.status === "reconnecting"
              ) {
                // An adopted daemon has no child-exit event. End the stale
                // reconnect loop after a grace period so supervisor.ensure()
                // can re-read product.json and adopt/spawn the current boot.
                handle.client.close();
              }
            }, this.reprobeAfterMs);
          }
          return;
        }
        if (handle.client.status !== "closed" && handle.client.status !== "failed") return;
        this.clearReprobeTimer();
        this.stopCurrentStatus?.();
        this.stopCurrentStatus = null;
        this.current = null;
        // Positive owned-child exit closes its supervisor client; terminal
        // adopted-client failure does the same. Recovery starts here so a
        // renderer need not somehow bootstrap through its dead bearer first.
        void this.ensure().catch(() => undefined);
      });
      for (const listener of [...this.listeners]) this.notify(listener, handle);
    }
    return handle;
  }

  /** The live handle, if any — read without starting anything (AL-3: a quit must never spawn what it means to stop). */
  get currentHandle(): FielddHandle | null {
    return this.current;
  }

  /** WP12c, and AL-3 since 2026-10-27 — an update or a person's quit is about to stop the daemons: from now `ensure()`
   * refuses and a closed client recovers nothing. The current handle stays readable for the stop request itself. */
  holdForStop(): FielddHandle | null {
    this.held = true;
    this.clearReprobeTimer();
    return this.current;
  }

  /** WP12c / AL-3 — the update or the quit aborted BEFORE the stop (nothing stopped): recovery and `ensure()` work
   * again. */
  releaseHold(): void {
    this.held = false;
  }

  get isHeld(): boolean {
    return this.held;
  }

  onHandle(listener: HandleListener): () => void {
    this.listeners.add(listener);
    if (this.current !== null) this.notify(listener, this.current);
    return () => this.listeners.delete(listener);
  }

  dispose(): void {
    this.disposed = true;
    this.clearReprobeTimer();
    this.stopCurrentStatus?.();
    this.stopCurrentStatus = null;
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

  private clearReprobeTimer(): void {
    if (this.reprobeTimer === null) return;
    clearTimeout(this.reprobeTimer);
    this.reprobeTimer = null;
  }
}
