import { type CSSProperties, type ReactElement, useMemo, useState } from "react";
import { canvasGridConfig } from "../field/canvas-appearance";
import { InfiniteCanvasGroundPreview } from "./InfiniteCanvasGroundPreview";
import { VisualTweakControls } from "./tweaks/VisualTweakControls";
import { defaultVisualTweakValues, visualTweakCssVariables } from "./tweaks/visual-tweaks";

export function CanvasGroundWorkbench({ dark }: { dark: boolean }): ReactElement {
  const [values, setValues] = useState(defaultVisualTweakValues);
  const grid = useMemo(() => canvasGridConfig(values, dark), [dark, values]);
  const scopedVariables = useMemo(
    () => visualTweakCssVariables(values, dark) as CSSProperties,
    [dark, values],
  );

  return (
    <div className="vf-ds-ground-workbench" style={scopedVariables} data-ground-workbench>
      <div className="vf-ds-ground-workbench__previews">
        <div className="vf-ds-ground-lab">
          <InfiniteCanvasGroundPreview
            grid={grid}
            background="var(--vf-canvas-bg)"
            label="Live ICE infinite-canvas dot grid"
          />
          <div className="vf-ds-ground-lab__badge">
            <span aria-hidden="true" />
            ICE P0 · live GPU
          </div>
          <div className="vf-ds-ground-lab__hint">Drag to pan · ⌘/ctrl + wheel to zoom</div>
          <dl className="vf-ds-ground-lab__facts">
            <div>
              <dt>Spacing</dt>
              <dd>{values.worldGrid.spacings.join(" / ")}</dd>
            </div>
            <div>
              <dt>Radius</dt>
              <dd>{values.worldGrid.dotRadius.join(" → ")} px</dd>
            </div>
            <div>
              <dt>Fade</dt>
              <dd>
                {values.worldGrid.fadeIn.join("–")} / {values.worldGrid.fadeOut.join("–")}
              </dd>
            </div>
          </dl>
        </div>

        <OverlapFeedbackPreview />
      </div>
      <VisualTweakControls value={values} onChange={setValues} />
    </div>
  );
}

function OverlapFeedbackPreview(): ReactElement {
  return (
    <div className="vf-ds-overlap-lab">
      <header>
        <div>
          <span>Scoped projection</span>
          <strong>Overlap feedback</strong>
        </div>
        <small>candidate / target</small>
      </header>
      <div className="vf-ds-overlap-lab__stage">
        <TunedCard tier="candidate" label="Dragged card" />
        <TunedCard tier="target" label="Drop target" />
      </div>
      <p>Glow and rim controls update both interaction tiers without changing the app.</p>
    </div>
  );
}

function TunedCard({ tier, label }: { tier: "candidate" | "target"; label: string }): ReactElement {
  return (
    <div className="vf-ds-tuned-card" data-overlap-tier={tier}>
      <span>{label}</span>
      <strong>{tier === "candidate" ? "C" : "T"}</strong>
      <i className="vf-ds-tuned-card__glow" />
      <i className="vf-ds-tuned-card__rim" />
    </div>
  );
}
