import {
  type ReactElement,
  type ReactNode,
  useEffect,
  useState,
  useSyncExternalStore,
} from "react";
import type { BootMachine, BootView } from "./machine";
import { OnboardingWizard } from "./onboarding/OnboardingWizard";

// BootRoot (ESR §5.4.2): the splash is the app's first face (DESIGN.md §8 —
// the canvas ground waking, the veil's thin bar, real stage labels); the
// workspace mounts UNDERNEATH it as soon as the module + document exist, and
// the reveal (240ms fade + a 560ms island-ease settle) plays only when the
// machine reaches `interactive` — fully warm, frame-stable, never mid-hitch.
//
// UA-3w borrows that first face once per install: while the machine holds in
// `onboarding` the Setup Assistant takes the splash's layer and ground, and the
// splash's own face (wordmark, bar, stage line) stands down. When the wizard
// releases the hold the ordinary stages return underneath it and the reveal
// happens exactly as it always does — which is W5 in mechanism: the wizard
// hands back to the real boot and ends inside the field, not at a door.

const EASE = "cubic-bezier(0.25, 1, 0.3, 1)"; // --vf-ease-island

export function BootRoot({ machine }: { machine: BootMachine }): ReactElement {
  const view = useSyncExternalStore(machine.subscribe, machine.view);
  const ready = machine.ready;
  const revealed = view.phase === "interactive";
  const [settled, setSettled] = useState(false);
  useEffect(() => {
    if (!revealed) return;
    const t = setTimeout(() => setSettled(true), 600); // outlive the 560ms settle
    return () => clearTimeout(t);
  }, [revealed]);
  return (
    <>
      {ready !== null && (
        <div
          className="absolute inset-0 motion-reduce:transition-none"
          // The settle transform exists ONLY while settling: a persistent
          // transform creates a stacking context that flattens the whole app
          // BELOW the z-40 .app-drag strip — every click in the top 52px died
          // (field report 2026-07-22). Once settled the wrapper is inert and
          // body-level stacking returns: the pill's no-drag hole punches
          // through the drag strip again.
          style={
            settled
              ? undefined
              : {
                  transform: revealed ? "scale(1)" : "scale(0.99)",
                  transition: `transform 560ms ${EASE}`,
                }
          }
        >
          <ready.mod.FielddProvider client={ready.client}>
            <ready.mod.FieldView manager={ready.manager} />
          </ready.mod.FielddProvider>
        </div>
      )}
      {view.phase === "onboarding" && machine.client !== null && machine.onboarding !== null ? (
        <BootGround>
          <OnboardingWizard
            client={machine.client}
            onboarding={machine.onboarding}
            onComplete={machine.completeOnboarding}
          />
        </BootGround>
      ) : (
        <Splash view={view} onRetry={machine.retry} />
      )}
    </>
  );
}

/** The first face's ground: the canvas itself at rest (DESIGN.md §8 — the field
 * waking, not a logo card). Shared by the splash and the Setup Assistant so
 * handing one to the other changes the content and never the floor. */
function BootGround({
  className = "",
  ariaHidden = false,
  children,
}: {
  className?: string;
  ariaHidden?: boolean;
  children: ReactNode;
}): ReactElement {
  return (
    <div
      className={`vf-splash absolute inset-0 z-[120] flex items-center justify-center ${className}`}
      aria-hidden={ariaHidden}
    >
      {children}

      {/* Component-scoped utilities (tray/pill precedent): the splash face is
          the canvas ground itself at rest — §2.1 dots at 1:1 field scale. */}
      <style>{`
        .vf-splash {
          background-color: var(--vf-canvas-bg);
          background-image: radial-gradient(circle, rgba(0, 0, 0, 0.16) 1px, transparent 1px);
          background-size: 24px 24px;
        }
        .dark .vf-splash {
          background-image: radial-gradient(circle, rgba(255, 255, 255, 0.08) 1px, transparent 1px);
        }
        @media (prefers-reduced-motion: reduce) {
          .vf-splash { transition-duration: 120ms; }
        }
      `}</style>
    </div>
  );
}

function Splash({ view, onRetry }: { view: BootView; onRetry: () => void }): ReactElement | null {
  const revealed = view.phase === "interactive";
  const [mounted, setMounted] = useState(true);
  useEffect(() => {
    if (!revealed) return;
    const t = setTimeout(() => setMounted(false), 400); // outlive the 240ms fade
    return () => clearTimeout(t);
  }, [revealed]);
  if (!mounted) return null;

  const failed = view.unavailable;
  const progress = view.progress;
  return (
    <BootGround
      className={`transition-opacity duration-[240ms] ease-out ${
        revealed ? "pointer-events-none opacity-0" : "opacity-100"
      }`}
      ariaHidden={revealed}
    >
      <div className="flex flex-col items-center gap-3">
        <div className="mb-1 text-[13px] font-medium text-black/50 dark:text-white/50">
          VibeField
        </div>
        <div
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={100}
          {...(progress !== null ? { "aria-valuenow": Math.round(progress * 100) } : {})}
          aria-label="Starting VibeField"
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
            {view.stage}
          </div>
        ) : (
          <div className="flex flex-col items-center gap-2">
            <div className="text-[11px] font-medium text-black/50 dark:text-white/50">
              {failed.reason}
            </div>
            {failed.retryable && (
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
      </div>
    </BootGround>
  );
}
