import type { FielddHandle, FielddSupervisor } from "@vibefield/fieldd-supervisor";

type HandleListener = (handle: FielddHandle) => void;
export const FIELDD_REPROBE_AFTER_MS = 3_000;

/** Item 212 (RV #29) — how many AUTOMATIC attempts to start fieldd the shell makes in any window of time. */
export interface FielddRecoveryIntensity {
  readonly max: number;
  readonly windowMs: number;
}

/** Item 212 (RV #29) — the house intensity, applied to the shell's supervision of fieldd: at most three automatic
 * attempts in ten minutes, then an honest crash loop and the person's restart. The rule's own numbers where it already
 * holds: WG-D1's wedge restarts of the floor (NATIVE_SUPERVISION's WEDGE_RESTART_MAX per WEDGE_RESTART_WINDOW_MS) and
 * AL-D8's relaunches of the app (fieldd's SHELL_ABSENCE), as the floor's RESPAWN_MAX ends in `gone` and its restart
 * verb. Cited, never imported: those bounds are the floor's and fieldd's own. */
export const FIELDD_RECOVERY_INTENSITY: FielddRecoveryIntensity = Object.freeze({
  max: 3,
  windowMs: 600_000,
});

/** Item 212 (RV #29) — where the shell's recovery of fieldd stands (`FielddHandleCoordinator.recovery`):
 *  · `ready` — nothing to recover, or the one attempt a death starts at once is in flight;
 *  · `recovering` — an attempt failed and the next waits its spacing; `attempt` of `of` made inside the window;
 *  · `crash-loop` — `failures` automatic attempts inside the window did not keep fieldd up (since `since`, unix
 *    ms): nothing starts it again until a person asks. */
export type FielddRecoveryState =
  | { readonly kind: "ready" }
  | { readonly kind: "recovering"; readonly attempt: number; readonly of: number }
  | { readonly kind: "crash-loop"; readonly failures: number; readonly since: number };

export interface FielddEnsureOptions {
  readonly signal?: AbortSignal;
  /** Item 212 (RV #29) — a person's ask (WG-D5's shape): one attempt runs at once, out of a crash loop too, and a
   * recovery under way begins its count again. A window booting (its bootstrap's mint), the status item's Try Again
   * and a switch to a person. Every other caller is incidental. */
  readonly person?: boolean;
}

export type FielddEnsure = (options?: FielddEnsureOptions) => Promise<FielddHandle>;

/** Item 212 (RV #29) — an incidental `ensure()` while the shell has stopped starting fieldd: nothing was started. */
export class FielddCrashLoopError extends Error {
  readonly failures: number;
  readonly since: number;

  constructor(failures: number, since: number) {
    super(`fieldd crash loop: ${failures} automatic restarts did not keep it up`);
    this.name = "FielddCrashLoopError";
    this.failures = failures;
    this.since = since;
  }
}

export interface FielddHandleCoordinatorOptions {
  readonly upstreamEnsure: FielddSupervisor["ensure"];
  readonly onEnsureError?: (error: unknown) => void;
  readonly onListenerError?: (error: unknown) => void;
  /** An adopted client's reconnect grace, and the spacing between automatic attempts: the same grace, so no new
   * constant (FIELDD_REPROBE_AFTER_MS). */
  readonly reprobeAfterMs?: number;
  /** Item 212 (RV #29) — each change of `recovery`. */
  readonly onState?: (state: FielddRecoveryState) => void;
  /** FIELDD_RECOVERY_INTENSITY unless a test injects its own. */
  readonly intensity?: FielddRecoveryIntensity;
  /** The intensity window's clock (unix ms); `Date.now` unless a test injects its own. */
  readonly now?: () => number;
}

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

const READY: FielddRecoveryState = { kind: "ready" };
const HELD = "fieldd is held for a stop: nothing may start it until the app exits";

/** The automatic attempt the spacing will start, and the incidental callers waiting on it. */
interface Spacing {
  readonly timer: ReturnType<typeof setTimeout>;
  readonly waiters: Array<{
    readonly resolve: (handle: FielddHandle) => void;
    readonly reject: (error: unknown) => void;
  }>;
}

/** Every successful ensure passes through this boundary. A renderer-triggered
 * recovery therefore repairs main-process observations too, rather than
 * leaving them permanently attached to the first rejected boot promise.
 *
 * Item 212 (RV #29) — and it is the shell's recovery boundary: the supervisor's `ensure()` stays one attempt (ESR
 * §5.3), and the rule "keep trying, but not forever" lives here. A death starts one attempt at once; a failed one
 * arms the next after the spacing; every automatic attempt counts in the intensity window, and past its `max` the
 * recovery stops in `crash-loop`. Incidental callers join a recovery and never start or count their own; in the
 * crash loop they are refused typed. A person's ask begins a recovery's count again. Background pairs each have their
 * own coordinator, so their own intensity. */
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
  /** Item 212 (RV #29) — when each automatic attempt still inside the intensity window started. */
  private automaticAt: number[] = [];
  /** fieldd went away (a death) and no handle has come since: only then does a failed attempt arm the next. */
  private lost = false;
  /** the recovery's attempt in flight, which an incidental caller joins */
  private inFlight: Promise<FielddHandle> | null = null;
  /** the attempt the spacing will start, which an incidental caller waits on until then */
  private spacing: Spacing | null = null;
  private state: FielddRecoveryState = READY;
  private readonly upstreamEnsure: FielddSupervisor["ensure"];
  private readonly onEnsureError: ((error: unknown) => void) | undefined;
  private readonly onListenerError: ((error: unknown) => void) | undefined;
  private readonly onState: ((state: FielddRecoveryState) => void) | undefined;
  private readonly reprobeAfterMs: number;
  private readonly intensity: FielddRecoveryIntensity;
  private readonly now: () => number;

  constructor(options: FielddHandleCoordinatorOptions) {
    this.upstreamEnsure = options.upstreamEnsure;
    this.onEnsureError = options.onEnsureError;
    this.onListenerError = options.onListenerError;
    this.onState = options.onState;
    this.reprobeAfterMs = options.reprobeAfterMs ?? FIELDD_REPROBE_AFTER_MS;
    this.intensity = options.intensity ?? FIELDD_RECOVERY_INTENSITY;
    this.now = options.now ?? (() => Date.now());
    if (!Number.isSafeInteger(this.reprobeAfterMs) || this.reprobeAfterMs < 0) {
      throw new Error("fieldd reprobe deadline must be a nonnegative safe integer");
    }
    const { max, windowMs } = this.intensity;
    if (!Number.isSafeInteger(max) || max < 1 || !Number.isSafeInteger(windowMs) || windowMs < 1) {
      throw new Error("fieldd recovery intensity must be a positive count in a positive window");
    }
  }

  async ensure(options?: FielddEnsureOptions): Promise<FielddHandle> {
    if (this.disposed) throw new Error("fieldd handle coordinator is disposed");
    if (this.held) throw new Error(HELD);
    if (options?.person === true) return this.ask(options);
    // An incidental caller (the clipboard audit, the status item's preferences, doctor, the support bundle, a
    // revocation's retry, the update's census) never starts or counts an attempt inside a recovery: it joins the one
    // in flight or the one the spacing will start. In the crash loop it is refused and starts nothing; the update's
    // census then reads unknown and holds.
    if (this.state.kind === "crash-loop") {
      throw new FielddCrashLoopError(this.state.failures, this.state.since);
    }
    if (this.inFlight !== null) return this.inFlight;
    const spacing = this.spacing;
    if (spacing !== null) {
      return new Promise<FielddHandle>((resolve, reject) => {
        spacing.waiters.push({ resolve, reject });
      });
    }
    return this.attempt(options);
  }

  /** The live handle, if any — read without starting anything (AL-3: a quit must never spawn what it means to stop). */
  get currentHandle(): FielddHandle | null {
    return this.current;
  }

  /** Item 212 (RV #29) — where recovery stands; `fieldd-link.ts` reads it for the attached pair. */
  get recovery(): FielddRecoveryState {
    return this.state;
  }

  /** WP12c, and AL-3 since 2026-10-27 — an update or a person's quit is about to stop the daemons: from now `ensure()`
   * refuses and a closed client recovers nothing. The current handle stays readable for the stop request itself. */
  holdForStop(): FielddHandle | null {
    this.held = true;
    this.clearReprobeTimer();
    // RV #29: no spacing may fire after the hold, and whoever waited on it is told
    const spacing = this.takeSpacing();
    if (spacing !== null) {
      const refusal = new Error(HELD);
      for (const waiter of spacing.waiters) waiter.reject(refusal);
    }
    return this.current;
  }

  /** WP12c / AL-3 — the update or the quit aborted BEFORE the stop (nothing stopped): recovery and `ensure()` work
   * again. RV #29: a recovery the hold paused goes on where it stood, its spacing armed again. */
  releaseHold(): void {
    this.held = false;
    const paused = this.lost && this.current === null && this.inFlight === null;
    if (paused && this.spacing === null && this.state.kind !== "crash-loop") this.afterFailure();
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
    const spacing = this.takeSpacing();
    if (spacing !== null) {
      const refusal = new Error("fieldd handle coordinator is disposed");
      for (const waiter of spacing.waiters) waiter.reject(refusal);
    }
    this.stopCurrentStatus?.();
    this.stopCurrentStatus = null;
    this.listeners.clear();
    this.current = null;
  }

  /** One upstream attempt. Every success passes through here, so a new handle is adopted however it came. */
  private async attempt(options?: FielddEnsureOptions): Promise<FielddHandle> {
    let handle: FielddHandle;
    try {
      handle = await this.upstreamEnsure(
        options?.signal === undefined ? undefined : { signal: options.signal },
      );
    } catch (error) {
      this.onEnsureError?.(error);
      throw error;
    }
    this.adopt(handle);
    return handle;
  }

  private adopt(handle: FielddHandle): void {
    if (this.current === handle) return;
    this.clearReprobeTimer();
    this.stopCurrentStatus?.();
    this.current = handle;
    this.lost = false;
    this.stopCurrentStatus = handle.client.onStatusChange(() => this.observe(handle));
    for (const listener of [...this.listeners]) this.notify(listener, handle);
    // RV #29: any new handle ends a recovery (its spacing cleared, its waiters handed the handle) and is ready
    const spacing = this.takeSpacing();
    if (spacing !== null) {
      for (const waiter of spacing.waiters) waiter.resolve(handle);
    }
    this.setState(READY);
  }

  private observe(handle: FielddHandle): void {
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
    // renderer need not somehow bootstrap through its dead bearer first:
    // one automatic attempt at once, counted under the intensity (RV #29).
    this.lost = true;
    this.recover();
  }

  /** Item 212 (RV #29) — one automatic attempt now, counted in the window; or, with the window already holding `max`,
   * the crash loop, which starts nothing. Answers the attempt, or the crash loop's refusal. */
  private recover(): Promise<FielddHandle> | FielddCrashLoopError {
    const now = this.now();
    const made = this.madeInWindow(now);
    if (made >= this.intensity.max) return this.tripCrashLoop(made, now);
    this.automaticAt.push(now);
    return this.track(this.attempt());
  }

  /** A recovery's attempt: incidental callers join it while it is in flight, and its failure arms the next. */
  private track(attempt: Promise<FielddHandle>): Promise<FielddHandle> {
    this.inFlight = attempt;
    void attempt.then(
      () => {
        if (this.inFlight === attempt) this.inFlight = null;
      },
      () => {
        if (this.inFlight !== attempt) return;
        this.inFlight = null;
        this.afterFailure();
      },
    );
    return attempt;
  }

  /** A recovery's attempt failed: the next after the spacing, or the crash loop once the window holds `max`. */
  private afterFailure(): void {
    if (this.disposed || this.held || !this.lost || this.current !== null) return;
    const now = this.now();
    const made = this.madeInWindow(now);
    if (made >= this.intensity.max) {
      this.tripCrashLoop(made, now);
      return;
    }
    this.setState({ kind: "recovering", attempt: made, of: this.intensity.max });
    this.armSpacing();
  }

  /** The next automatic attempt after the spacing — the grace a reconnecting client gets — on an unref'd timer, so a
   * pending recovery never holds a quit open. Its waiters are settled by that attempt. */
  private armSpacing(): void {
    const spacing: Spacing = {
      timer: setTimeout(() => {
        if (this.spacing !== spacing) return;
        this.spacing = null;
        const outcome = this.recover();
        for (const waiter of spacing.waiters) {
          if (outcome instanceof FielddCrashLoopError) waiter.reject(outcome);
          else void outcome.then(waiter.resolve, waiter.reject);
        }
      }, this.reprobeAfterMs),
      waiters: [],
    };
    spacing.timer.unref();
    this.spacing = spacing;
  }

  /** Item 212 (RV #29) — a person's ask (WG-D5's shape): one attempt at once, uncounted. While a recovery is under
   * way (recovering, or the crash loop) the intensity begins again, the attempt is that recovery's (its waiters join
   * it), and its failure arms the next on the fresh count. With fieldd up the count stays as it stands: the boot fence
   * reloads every window after each recovery and a reloaded window's bootstrap is an ask, so a reset there would let
   * a fieldd that keeps dying with a window open respawn forever. Outside a recovery (a boot), a failure is said to
   * the asker alone, as ESR §7.1's boot failure with its Retry. */
  private ask(options: FielddEnsureOptions): Promise<FielddHandle> {
    const underWay = this.state.kind !== "ready";
    if (underWay) this.automaticAt = [];
    if (this.inFlight !== null) return this.inFlight;
    const spacing = this.takeSpacing();
    if (underWay) this.setState({ kind: "recovering", attempt: 0, of: this.intensity.max });
    const attempt = this.attempt(options);
    if (this.lost) this.track(attempt);
    if (spacing !== null) {
      for (const waiter of spacing.waiters) void attempt.then(waiter.resolve, waiter.reject);
    }
    return attempt;
  }

  private tripCrashLoop(failures: number, since: number): FielddCrashLoopError {
    this.setState({ kind: "crash-loop", failures, since });
    return new FielddCrashLoopError(failures, since);
  }

  /** The automatic attempts still inside the window that ends `now` (older ones leave it). */
  private madeInWindow(now: number): number {
    this.automaticAt = this.automaticAt.filter((at) => now - at < this.intensity.windowMs);
    return this.automaticAt.length;
  }

  private takeSpacing(): Spacing | null {
    const spacing = this.spacing;
    if (spacing === null) return null;
    clearTimeout(spacing.timer);
    this.spacing = null;
    return spacing;
  }

  private setState(next: FielddRecoveryState): void {
    if (this.disposed) return;
    if (JSON.stringify(next) === JSON.stringify(this.state)) return;
    this.state = next;
    try {
      this.onState?.(next);
    } catch (error) {
      this.onListenerError?.(error);
    }
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
