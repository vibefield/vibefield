/**
 * ZoomPill — the −/percent/+ zoom control, extracted VERBATIM from widgetlab's
 * `App.tsx` (the `// === chrome bits ===` section) for Track D2. Polls the
 * Camera resource every 100ms; − = zoomBy(0.8), the percent button resets to
 * 100% (double-click = zoom to fit), + = zoomBy(1.25).
 */
import { Camera, type CanvasEngine } from "@vibecook/ice";
import { useEffect, useState } from "react";

export function ZoomPill({ ce }: { ce: CanvasEngine }) {
  const [zoom, setZoom] = useState(1);
  useEffect(() => {
    const id = setInterval(() => {
      const z = ce.world.getResource(Camera)?.zoom ?? 1;
      setZoom((prev) => (Math.abs(prev - z) > 1e-4 ? z : prev));
    }, 100);
    return () => clearInterval(id);
  }, [ce]);
  const zoomBy = (f: number) => ce.ops.zoomTo((ce.world.getResource(Camera)?.zoom ?? 1) * f);
  return (
    <div className="absolute top-4 right-16 z-50 flex h-10 items-center overflow-hidden rounded-full bg-white shadow-lg dark:bg-neutral-800">
      <button
        type="button"
        onClick={() => zoomBy(0.8)}
        className="flex h-10 w-10 items-center justify-center text-neutral-500 transition-colors hover:bg-neutral-100 hover:text-neutral-700 dark:text-neutral-400 dark:hover:bg-neutral-700 dark:hover:text-neutral-200"
        title="Zoom out"
        aria-label="Zoom out"
      >
        −
      </button>
      <button
        type="button"
        onClick={() => ce.ops.zoomTo(1)}
        onDoubleClick={() => ce.ops.zoomToFit()}
        className="flex h-10 w-14 items-center justify-center text-sm font-medium tabular-nums text-neutral-700 transition-colors hover:bg-neutral-100 dark:text-neutral-200 dark:hover:bg-neutral-700"
        title="Click: reset to 100% · Double-click: zoom to fit"
        aria-label={`Current zoom: ${Math.round(zoom * 100)}%`}
      >
        {Math.round(zoom * 100)}%
      </button>
      <button
        type="button"
        onClick={() => zoomBy(1.25)}
        className="flex h-10 w-10 items-center justify-center text-neutral-500 transition-colors hover:bg-neutral-100 hover:text-neutral-700 dark:text-neutral-400 dark:hover:bg-neutral-700 dark:hover:text-neutral-200"
        title="Zoom in"
        aria-label="Zoom in"
      >
        +
      </button>
    </div>
  );
}
