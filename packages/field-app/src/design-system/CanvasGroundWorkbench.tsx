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
            label="The live desk"
          />
          <div className="vf-ds-ground-lab__badge">
            <span aria-hidden="true" />
            ICE P0 · live GPU
          </div>
          <div className="vf-ds-ground-lab__hint">Drag to pan · ⌘/ctrl + wheel to zoom</div>
        </div>
      </div>
      <VisualTweakControls value={value} onChange={onChange} />
    </div>
  );
}
