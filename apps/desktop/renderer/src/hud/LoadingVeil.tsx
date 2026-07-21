import { type ReactElement, useEffect, useRef, useState } from "react";

// The loading veil (thinking-b4 §2, DESIGN.md §8): a chrome-material frost over
// the ENTIRE window while a doc loads. The cover itself is immediate and
// opaque: a keyed engine may never tear down in front of the user. Progress
// details remain late (500ms), so a normal local switch reads as one soft
// dissolve rather than a loading screen; slow I/O stays honest. Reveal waits
// for FieldView's framed-canvas presentation signal, then fades over the new
// fully composed scene.

const EASE = "cubic-bezier(0.25, 1, 0.3, 1)"; // --vf-ease-island

export interface LoadingVeilState {
  progress: number;
  stage: string;
}

export function LoadingVeil({
  loading,
}: {
  loading: LoadingVeilState | null;
}): ReactElement | null {
  const active = loading !== null;
  const [mounted, setMounted] = useState(active);
  const [shown, setShown] = useState(false);
  const [details, setDetails] = useState(false);
  // The fade-out keeps rendering after `loading` goes null — show the last frame.
  const last = useRef<LoadingVeilState>({ progress: 0, stage: "opening doc" });
  if (loading !== null) last.current = loading;

  useEffect(() => {
    if (active) {
      setMounted(true);
      const frame = requestAnimationFrame(() => setShown(true));
      const detailTimer = setTimeout(() => setDetails(true), 500);
      return () => {
        cancelAnimationFrame(frame);
        clearTimeout(detailTimer);
      };
    }
    setShown(false);
    setDetails(false);
    const t = setTimeout(() => setMounted(false), 400);
    return () => clearTimeout(t);
  }, [active]);

  if (!mounted) return null;
  const view = loading ?? last.current;
  return (
    <div
      className={`absolute inset-0 z-[80] flex items-center justify-center transition-opacity ${
        shown ? "pointer-events-auto opacity-100" : "pointer-events-none opacity-0"
      }`}
      style={{
        background:
          "radial-gradient(circle at 50% 42%, color-mix(in srgb, var(--vf-canvas-bg), white 3%) 0%, var(--vf-canvas-bg) 68%)",
        transitionDuration: shown ? "220ms" : "380ms",
        transitionTimingFunction: EASE,
      }}
      aria-hidden={!shown}
    >
      <div
        className={`flex translate-y-0 flex-col items-center gap-3 transition-[opacity,transform] duration-300 ${
          details ? "opacity-100" : "translate-y-1 opacity-0"
        }`}
        aria-hidden={!details}
      >
        <div
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(view.progress * 100)}
          aria-label="Loading the field"
          className="h-[3px] w-[220px] overflow-hidden rounded-full bg-black/10 dark:bg-white/15"
        >
          <div
            className="h-full rounded-full bg-black/70 dark:bg-white/80"
            style={{
              width: `${Math.round(view.progress * 100)}%`,
              transition: `width 240ms ${EASE}`,
            }}
          />
        </div>
        <div className="text-[11px] font-medium text-black/50 dark:text-white/50">{view.stage}</div>
      </div>
    </div>
  );
}
