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
import "./ZoomPill.css";

const zoomPct = (c: { zoom: number } | undefined): number => Math.round((c?.zoom ?? 1) * 100);

export function ZoomPill({ ce }: { ce: CanvasEngine }) {
  const pct = useReactiveResource(ce, Camera, zoomPct);
  const zoomBy = (f: number) => ce.ops.zoomTo((ce.world.getResource(Camera)?.zoom ?? 1) * f);
  return (
    <ZoomPillView
      percent={pct}
      onZoomOut={() => zoomBy(0.8)}
      onReset={() => ce.ops.zoomTo(1)}
      onZoomToFit={() => ce.ops.zoomToFit()}
      onZoomIn={() => zoomBy(1.25)}
    />
  );
}

/** Production zoom control with controller-free callbacks for previews. */
export function ZoomPillView({
  percent,
  onZoomOut,
  onReset,
  onZoomToFit,
  onZoomIn,
}: {
  percent: number;
  onZoomOut: () => void;
  onReset: () => void;
  onZoomToFit: () => void;
  onZoomIn: () => void;
}) {
  return (
    <div className="vf-zoom-pill">
      <button type="button" onClick={onZoomOut} title="Zoom out" aria-label="Zoom out">
        −
      </button>
      <button
        type="button"
        onClick={onReset}
        onDoubleClick={onZoomToFit}
        title="Click: reset to 100% · Double-click: zoom to fit"
        aria-label={`Current zoom: ${percent}%`}
      >
        {percent}%
      </button>
      <button type="button" onClick={onZoomIn} title="Zoom in" aria-label="Zoom in">
        +
      </button>
    </div>
  );
}
