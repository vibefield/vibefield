import { type CSSProperties, type ReactElement, useMemo } from "react";
import {
  type ProductAppearance,
  productAppearanceCssVariables,
} from "../appearance/product-appearance";
import { InfiniteCanvasGroundPreview } from "./InfiniteCanvasGroundPreview";
import { VisualTweakControls } from "./tweaks/VisualTweakControls";

export function CanvasGroundWorkbench({
  dark,
  value,
  onChange,
}: {
  dark: boolean;
  value: ProductAppearance;
  onChange: (value: ProductAppearance) => void;
}): ReactElement {
  const scopedVariables = useMemo(
    () => productAppearanceCssVariables(value, dark) as CSSProperties,
    [dark, value],
  );

  return (
    <div className="vf-ds-ground-workbench" style={scopedVariables} data-ground-workbench>
      <div className="vf-ds-ground-workbench__previews">
        <div className="vf-ds-ground-lab">
          <InfiniteCanvasGroundPreview
            dark={dark}
            background="var(--vf-canvas-bg)"
            label="Live ICE infinite-canvas magnet grid"
          />
          <div className="vf-ds-ground-lab__badge">
            <span aria-hidden="true" />
            ICE P0 · live GPU
          </div>
          <div className="vf-ds-ground-lab__hint">Drag to pan · ⌘/ctrl + wheel to zoom</div>
          <dl className="vf-ds-ground-lab__facts">
            <div>
              <dt>Glyph</dt>
              <dd>{value.magnetGrid.glyph}</dd>
            </div>
            <div>
              <dt>Reach</dt>
              <dd>{value.magnetGrid.reach} px</dd>
            </div>
            <div>
              <dt>Grid fade</dt>
              <dd>
                {value.worldGrid.fadeIn.join("–")} / {value.worldGrid.fadeOut.join("–")}
              </dd>
            </div>
          </dl>
        </div>

        <OverlapFeedbackPreview />
      </div>
      <VisualTweakControls value={value} onChange={onChange} />
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
