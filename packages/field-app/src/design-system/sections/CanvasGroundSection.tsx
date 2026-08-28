import type { ReactElement } from "react";
import type { ProductAppearance } from "../../appearance/product-appearance";
import { CanvasGroundWorkbench } from "../CanvasGroundWorkbench";
import { Section, Specimen } from "../catalog-ui";

export function CanvasGroundSection({
  dark,
  appearance,
  onAppearanceChange,
}: {
  dark: boolean;
  appearance: ProductAppearance;
  onAppearanceChange: (appearance: ProductAppearance) => void;
}): ReactElement {
  return (
    <Section
      id="canvas-ground"
      index="03"
      eyebrow="Canvas ground"
      title="The actual field, under glass"
      description="This is the production ICE ground—not a radial-gradient stand-in. Pan and zoom the adaptive three-level grid, then tune every former developer control in a specimen-scoped workbench."
    >
      <Specimen
        title="Infinite canvas and visual tuning workbench"
        source="field/InfiniteCanvasGround.tsx · design-system/tweaks/*"
      >
        <CanvasGroundWorkbench dark={dark} value={appearance} onChange={onAppearanceChange} />
      </Specimen>
    </Section>
  );
}
