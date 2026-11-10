import type { ReactElement } from "react";

// The boot splash's own face (DESIGN.md §8 "The boot splash"): the veil's
// thin bar, alone while a start goes well (item 281: the steps' words are the
// log's), and a failed start's one sentence under it (item 280). Shared by the
// splash and by the switch, so the two can never draw a bar or that sentence
// differently. Both floors are darker than either theme's canvas, so the bar
// is paper white at the splash's quiet presences on either — its track
// white/15, its fill white/80 — and the sentence takes its floor's ink: since
// track FG the boot's first face stands on the field (`--vf-field-ink`, FG-O2),
// and the switch keeps the mat (DK-16, `--vf-mat-ink`).

const EASE = "cubic-bezier(0.25, 1, 0.3, 1)"; // --vf-ease-island

const INK = {
  field: "text-[var(--vf-field-ink)]",
  mat: "text-[var(--vf-mat-ink)]",
} as const;

/** What the splash shows while it waits: the machine's view has this shape. */
export interface SplashStatusView {
  /** null before the document pipeline reports numbers */
  readonly progress: number | null;
  readonly unavailable: { readonly reason: string; readonly retryable: boolean } | null;
}

/** The bar, alone while a start goes well — and, when the boot failed, the
 * one sentence and a ghost Retry under it, in the ink of the floor they stand
 * on. */
export function SplashStatus({
  status,
  ink,
  onRetry,
  label = "Starting VibeField",
}: {
  status: SplashStatusView;
  ink: keyof typeof INK;
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
        className="h-[3px] w-[220px] overflow-hidden rounded-full bg-white/15"
      >
        <div
          className="h-full rounded-full bg-white/80"
          style={{
            width: `${Math.round((progress ?? 0.06) * 100)}%`,
            transition: `width 240ms ${EASE}`,
          }}
        />
      </div>
      {failed !== null && (
        <div className="flex flex-col items-center gap-2">
          {/* the boot's one sentence (DESIGN.md §9, item 280); what failed is in the log */}
          <div className={`text-[11px] font-medium ${INK[ink]}`}>{failed.reason}</div>
          {failed.retryable && onRetry !== undefined && (
            <button
              type="button"
              onClick={onRetry}
              className="h-7 rounded-full bg-white/10 px-3 text-[12px] font-medium text-white/70 transition-colors hover:bg-white/20 active:scale-95"
            >
              Retry
            </button>
          )}
        </div>
      )}
    </>
  );
}

/** The splash's face on the field: the bar 40px under the field's mark, and a
 * failed start's sentence under it, on the words' shade — the website's
 * loading window. The mark is the field's own (FieldLayer), so the wordmark
 * retired with the mat. */
export function SplashFace({
  status,
  onRetry,
}: {
  status: SplashStatusView;
  onRetry?: (() => void) | undefined;
}): ReactElement {
  return (
    <>
      <div className="vf-field-shade" />
      <div className="vf-field-words">
        <SplashStatus status={status} ink="field" onRetry={onRetry} />
      </div>
    </>
  );
}

/** The splash's face as it stood on the mat (DK-16): the quiet wordmark over
 * the bar, and a failed start's sentence under it. The switch's plain frame —
 * the switch keeps the mat (DESIGN.md §8 "The switch"). */
export function MatSplashFace({
  status,
  onRetry,
}: {
  status: SplashStatusView;
  onRetry?: (() => void) | undefined;
}): ReactElement {
  return (
    <div className="flex flex-col items-center gap-3">
      <div className={`mb-1 text-[13px] font-medium ${INK.mat}`}>VibeField</div>
      <SplashStatus status={status} ink="mat" onRetry={onRetry} />
    </div>
  );
}
