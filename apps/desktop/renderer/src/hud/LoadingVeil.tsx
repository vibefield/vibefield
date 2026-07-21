import { type ReactElement, useEffect, useRef, useState } from "react";

// The loading veil (thinking-b4 §2, DESIGN.md §8): a chrome-material frost over
// the ENTIRE window while a doc loads — a thin colorless bar (loading is not a
// §2.5 state, so no hue) + an honest lowercase stage label. LATE-VEIL RULE:
// invisible until 120ms of loading elapse, so a cached doc switch never
// flashes; fades out 240ms before unmounting. M6: it is already only opacity
// and width — reduced motion needs no special case.

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
  // The fade-out keeps rendering after `loading` goes null — show the last frame.
  const last = useRef<LoadingVeilState>({ progress: 0, stage: "opening doc" });
  if (loading !== null) last.current = loading;

  useEffect(() => {
    if (active) {
      setMounted(true);
      const t = setTimeout(() => setShown(true), 120);
      return () => clearTimeout(t);
    }
    setShown(false);
    const t = setTimeout(() => setMounted(false), 260);
    return () => clearTimeout(t);
  }, [active]);

  if (!mounted) return null;
  const view = loading ?? last.current;
  return (
    <div
      className={`absolute inset-0 z-[80] flex items-center justify-center bg-white/60 backdrop-blur-xl transition-opacity dark:bg-[#171717]/60 ${
        shown ? "pointer-events-auto opacity-100" : "pointer-events-none opacity-0"
      }`}
      style={{ transitionDuration: "240ms" }}
      aria-hidden={!shown}
    >
      <div className="flex flex-col items-center gap-3">
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
