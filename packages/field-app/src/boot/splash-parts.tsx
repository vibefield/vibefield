import type { ReactElement } from "react";

// The boot splash's own words (DESIGN.md §8 "The boot splash"): the wordmark,
// the veil's thin bar and the stage line under it. Shared by the splash and by
// the switch, whose held frame IS the splash in another dress — so the two can
// never draw a bar or a stage line differently, and the frame the leaving
// window converges on is the frame the arriving one paints first.

const EASE = "cubic-bezier(0.25, 1, 0.3, 1)"; // --vf-ease-island

/** What the splash says while it waits: the machine's view has this shape. */
export interface SplashStatusView {
  /** lowercase stage label — real stages, never theater */
  readonly stage: string;
  /** null before the document pipeline reports numbers */
  readonly progress: number | null;
  readonly unavailable: { readonly reason: string; readonly retryable: boolean } | null;
}

/** The bar and the stage line — or, when the boot failed, the plain reason
 * and a ghost Retry. */
export function SplashStatus({
  status,
  onRetry,
  label = "Starting VibeField",
}: {
  status: SplashStatusView;
  onRetry?: (() => void) | undefined;
  label?: string;
}): ReactElement {
  const failed = status.unavailable;
  const progress = status.progress;
  return (
    <>
      <div
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        {...(progress !== null ? { "aria-valuenow": Math.round(progress * 100) } : {})}
        aria-label={label}
        className="h-[3px] w-[220px] overflow-hidden rounded-full bg-black/10 dark:bg-white/15"
      >
        <div
          className="h-full rounded-full bg-black/70 dark:bg-white/80"
          style={{
            width: `${Math.round((progress ?? 0.06) * 100)}%`,
            transition: `width 240ms ${EASE}`,
          }}
        />
      </div>
      {failed === null ? (
        <div className="text-[11px] font-medium text-black/50 dark:text-white/50">
          {status.stage}
        </div>
      ) : (
        <div className="flex flex-col items-center gap-2">
          <div className="text-[11px] font-medium text-black/50 dark:text-white/50">
            {failed.reason}
          </div>
          {failed.retryable && onRetry !== undefined && (
            <button
              type="button"
              onClick={onRetry}
              className="h-7 rounded-full bg-black/5 px-3 text-[12px] font-medium text-black/70 transition-colors hover:bg-black/10 active:scale-95 dark:bg-white/10 dark:text-white/70 dark:hover:bg-white/20"
            >
              Retry
            </button>
          )}
        </div>
      )}
    </>
  );
}

/** The splash's face: the quiet wordmark over the bar and the stage line. */
export function SplashFace({
  status,
  onRetry,
}: {
  status: SplashStatusView;
  onRetry?: (() => void) | undefined;
}): ReactElement {
  return (
    <div className="flex flex-col items-center gap-3">
      <div className="mb-1 text-[13px] font-medium text-black/50 dark:text-white/50">VibeField</div>
      <SplashStatus status={status} onRetry={onRetry} />
    </div>
  );
}
