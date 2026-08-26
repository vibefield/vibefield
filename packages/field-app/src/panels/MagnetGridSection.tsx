import { SegmentedControl } from "@vibefield/design-kit";
import type { ReactElement } from "react";
import type { MagnetGridGlyph } from "../field/canvas-appearance";
import { SettingsPill, SettingsRow, SettingsSection } from "./settings-ui";

const MAGNET_GLYPH_OPTIONS = ["Dot", "Needle"] as const;

/** Product control for tuning the one build-selected magnet renderer. */
export function MagnetGridSection({
  glyph,
  onGlyphChange,
  controlledByStudio = false,
}: {
  glyph: MagnetGridGlyph;
  onGlyphChange: (glyph: MagnetGridGlyph) => void;
  controlledByStudio?: boolean;
}): ReactElement {
  return (
    <SettingsSection title="Grid" description="Tune the glyph used by the magnetic canvas ground.">
      <SettingsRow
        title="Magnet glyph"
        description="Dots stay on the lattice and swell with the field; needles turn with its direction. Saved for this device."
        divider={false}
      >
        <div className="flex flex-wrap items-center justify-end gap-2">
          {controlledByStudio && <SettingsPill>Controlled by Studio</SettingsPill>}
          <SegmentedControl
            options={MAGNET_GLYPH_OPTIONS}
            value={glyph === "dot" ? "Dot" : "Needle"}
            onChange={(next) => onGlyphChange(next === "Dot" ? "dot" : "needle")}
            label="Magnet glyph"
          />
        </div>
      </SettingsRow>
    </SettingsSection>
  );
}
