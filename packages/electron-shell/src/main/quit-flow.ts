// The quit flow, PURE (ESR §5.2.1 + 2026-07-23 review P1): every path out of
// the process must AWAIT bounded supervisor disposal before the process dies.
// The old will-quit ran `void dispose()` — the SIGTERM landed (synchronous
// prefix) but the 2s SIGKILL escalation and the native TERM needed a live
// event loop that Electron had already torn down. The flow always defers the
// native quit and exits explicitly once teardown settles or the bound expires.
// Electron appears only in lifecycle.ts — tests drive this with plain fakes.

const DISPOSE_BOUND_MS = 4_000; // stopChild is 2s TERM-wait + KILL; ×2 headroom

export interface QuitFlow {
  /** will-quit: ALWAYS defer the native quit; the first call starts teardown
   * and exits 0 when it settles. Later calls just keep deferring. */
  willQuit(preventDefault: () => void): void;
  /** fatal boot failure: same bounded teardown, exit code 1. */
  fatal(error: unknown): void;
}

export function createQuitFlow(deps: {
  closeWindows: () => void;
  dispose: () => Promise<void>;
  exit: (code: number) => void;
  onFatal: (error: unknown) => void;
  onTeardownError?: (error: unknown) => void;
  boundMs?: number;
}): QuitFlow {
  const bound = deps.boundMs ?? DISPOSE_BOUND_MS;
  let exiting = false;

  function teardown(): Promise<void> {
    try {
      deps.closeWindows();
    } catch (error) {
      deps.onTeardownError?.(error);
    }
    return new Promise<void>((resolve) => {
      const timer = setTimeout(resolve, bound);
      (timer as { unref?: () => void }).unref?.();
      deps
        .dispose()
        .catch((error: unknown) => deps.onTeardownError?.(error))
        .then(() => {
          clearTimeout(timer);
          resolve();
        });
    });
  }

  function runOnce(code: number): void {
    if (exiting) return; // teardown already running; its exit() will land
    exiting = true;
    void teardown().then(() => deps.exit(code));
  }

  return {
    willQuit(preventDefault) {
      preventDefault(); // the native quit never proceeds; we always exit()
      runOnce(0);
    },
    fatal(error) {
      deps.onFatal(error);
      runOnce(1);
    },
  };
}
