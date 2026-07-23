/**
 * ZoomPill — the −/percent/+ zoom control, extracted VERBATIM from widgetlab's
 * `App.tsx` (the `// === chrome bits ===` section) for Track D2. The percent
 * is a reactive subscription (3b amendment): strata's `observeResource(Camera)`
 * fires at notify() only when the camera actually changed, and the rounded-
 * percent snapshot re-renders only when the DISPLAY changes — no timer at all.
 * − = zoomBy(0.8), the percent button resets to 100% (double-click = zoom to
 * fit), + = zoomBy(1.25).
 */
import { Camera, type CanvasEngine } from "@vibecook/ice";
import { useReactiveResource } from "./use-reactive";

const zoomPct = (c: { zoom: number } | undefined): number => Math.round((c?.zoom ?? 1) * 100);

export function ZoomPill({ ce }: { ce: CanvasEngine }) {
  const pct = useReactiveResource(ce, Camera, zoomPct);
  const zoomBy = (f: number) => ce.ops.zoomTo((ce.world.getResource(Camera)?.zoom ?? 1) * f);
  return (
    <div
      data-hud-flight="top-right"
      className="hud-flight no-drag absolute top-4 right-16 z-50 flex h-10 items-center overflow-hidden rounded-full bg-white shadow-lg dark:bg-neutral-800"
    >
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
        aria-label={`Current zoom: ${pct}%`}
      >
        {pct}%
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
