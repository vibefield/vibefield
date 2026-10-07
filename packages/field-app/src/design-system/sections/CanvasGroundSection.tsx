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
      description="This is the production desk—not a stand-in: the field's own layer, the mat and its rulers. Pan and zoom it, then tune the plain ground under it in a specimen-scoped workbench."
    >
      <Specimen
        title="Infinite canvas and visual tuning workbench"
        source="field/desk/desk-layer.ts · design-system/tweaks/*"
      >
        <CanvasGroundWorkbench dark={dark} value={appearance} onChange={onAppearanceChange} />
      </Specimen>
    </Section>
  );
}
