import { type ReactElement, useState } from "react";
import { TerminalMirrorSurface } from "../terminal/mirror";

// The catalog's fixture ADAPTER for the ICE terminal widget (TP-S2).
//
// `docs/UI_SYSTEM.md`'s rule, and `test/ui-system-boundaries.test.ts` enforces
// it: the catalog mounts the SHIPPING view with a fixture adapter, never a copy
// of its markup or CSS. So there is no markup here that belongs to the widget —
// this file supplies the props a HOST supplies (the cull answer, the camera)
// and lets `TerminalMirrorSurface` render itself.
//
// What the bench can and cannot show, stated rather than faked. The widget is
// runtime-free here for the same reason `GodviewPreview` is: the UI Bench runs
// with no daemons, no preload and no pool transport, so the surface renders the
// same honest `session unavailable` face the live app shows on a browser-only
// host. Everything ELSE is real and is what this entry is for — the card, the
// label strip and its `watching` badge, the culled treatment, and the camera's
// animate-then-commit behaviour, all driven through the widget's own props.
// Terminal pixels need a floor; a catalog that drew fake ones would be a copy
// of the view, which is exactly what the rule forbids.

export function TerminalMirrorPreview(): ReactElement {
  const [culled, setCulled] = useState(false);
  const [scale, setScale] = useState(1);
  const [settled, setSettled] = useState(true);

  return (
    <div className="vf-ds-mirror-fixture">
      <div className="vf-ds-mirror-controls">
        <label>
          <input
            type="checkbox"
            checked={culled}
            onChange={(event) => setCulled(event.currentTarget.checked)}
          />
          culled (the host says it is off screen)
        </label>
        <label>
          <input
            type="checkbox"
            checked={!settled}
            onChange={(event) => setSettled(!event.currentTarget.checked)}
          />
          camera moving
        </label>
        <label>
          camera scale
          <input
            type="range"
            min="0.5"
            max="2"
            step="0.1"
            value={scale}
            onChange={(event) => setScale(Number(event.currentTarget.value))}
          />
          <span className="vf-ds-mirror-value">{scale.toFixed(1)}×</span>
        </label>
      </div>
      <div className="vf-ds-mirror-stage">
        <TerminalMirrorSurface
          sessionId="design-bench-session"
          culled={culled}
          cameraScale={scale}
          cameraSettled={settled}
          label="agent · build"
        />
      </div>
    </div>
  );
}
