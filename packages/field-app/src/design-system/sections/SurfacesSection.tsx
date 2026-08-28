import { SegmentedControl as UiSegmentedControl, UnavailableState } from "@vibefield/design-kit";
import {
  ArtifactPanelPreview,
  type ArtifactPanelPreviewState,
} from "@vibefield/plugin-browser/design-system";
import { type ReactElement, useState } from "react";
import type { MagnetGridGlyph } from "../../field/canvas-appearance";
import { LoadingVeilView } from "../../hud/LoadingVeil";
import { SidePanelFrame } from "../../hud/SidePanelStage";
import { MagnetGridSection } from "../../panels/MagnetGridSection";
import { SettingsDialog, type SettingsPage } from "../../panels/SettingsDialog";
import { buttonCls, SettingsRow, SettingsSection, SettingsSwitch } from "../../panels/settings-ui";
import { CommandPalettePreview } from "../CommandPalettePreview";
import { Section, Specimen } from "../catalog-ui";

export function SurfacesSection({
  magnetGridGlyph,
  onMagnetGridGlyphChange,
}: {
  magnetGridGlyph: MagnetGridGlyph;
  onMagnetGridGlyphChange: (glyph: MagnetGridGlyph) => void;
}): ReactElement {
  const [settingsOn, setSettingsOn] = useState(true);
  const [settingsPage, setSettingsPage] = useState<SettingsPage>("appearance");
  return (
    <Section
      id="surfaces"
      index="08"
      eyebrow="Panels & overlays"
      title="Large surfaces stay calm"
      description="Sheets use space, blur, and hairlines for hierarchy. They do not become a new visual language when the amount of information grows."
    >
      <Specimen title="Settings dialog" source="panels/SettingsPanel.tsx" bleed>
        <div className="vf-ds-settings-stage">
          <SettingsDialog
            className="vf-ds-settings-dialog"
            activePage={settingsPage}
            onSelectPage={setSettingsPage}
            onClose={() => undefined}
            onUndo={() => undefined}
            onRedo={() => undefined}
            historyBusy={false}
            undoAvailable={false}
            redoAvailable={false}
          >
            {settingsPage === "appearance" ? (
              <SettingsSection
                title="Theme"
                description="Set the color mode used by app chrome and cards."
              >
                <SettingsRow
                  title="Use system appearance"
                  description="Follow this device when its appearance changes."
                >
                  <SettingsSwitch
                    checked={settingsOn}
                    onChange={setSettingsOn}
                    label="Use system appearance"
                  />
                </SettingsRow>
                <SettingsRow
                  title="Interface scale"
                  description="Keep controls comfortable without changing canvas zoom."
                  divider={false}
                >
                  <UiSegmentedControl
                    options={["Compact", "Default"]}
                    value="Default"
                    onChange={() => {}}
                    label="Interface scale"
                  />
                </SettingsRow>
              </SettingsSection>
            ) : settingsPage === "canvas" ? (
              <MagnetGridSection glyph={magnetGridGlyph} onGlyphChange={onMagnetGridGlyphChange} />
            ) : (
              <UnavailableState
                compact
                title={`${settingsPage[0]?.toUpperCase()}${settingsPage.slice(1)} is runtime-backed`}
                description="The production frame is exact; this page's data stays with its runtime controller."
              />
            )}
          </SettingsDialog>
        </div>
      </Specimen>

      <div className="vf-ds-grid vf-ds-grid-2">
        <Specimen title="Command palette" source="hud/CommandPalette.tsx" darkStage>
          <div className="vf-ds-palette-stage">
            <CommandPalettePreview />
          </div>
        </Specimen>
        <Specimen title="Artifact side panel" source="hud/SidePanelStage.tsx" darkStage>
          <SidePanelSpecimen />
        </Specimen>
      </div>

      <div className="vf-ds-grid vf-ds-grid-3">
        <Specimen title="Loading veil" source="hud/LoadingVeil.tsx">
          <div className="vf-ds-veil-stage">
            <LoadingVeilView view={{ progress: 0.38, stage: "opening doc" }} shown details />
          </div>
        </Specimen>
        <Specimen title="Confirmation" source="destructive flows">
          <div className="vf-ds-confirm-specimen">
            <strong>Remove Notes?</strong>
            <span>Canvas cards it made are kept.</span>
            <div>
              <button type="button" className={`${buttonCls} text-[var(--vf-red)]`}>
                Remove data too
              </button>
              <button type="button" className={buttonCls}>
                Cancel
              </button>
            </div>
          </div>
        </Specimen>
        <Specimen title="Performance diagnostics" source="@vibecook/ice/devtools">
          <PerformanceDiagnosticsSpecimen />
        </Specimen>
      </div>
    </Section>
  );
}

function SidePanelSpecimen(): ReactElement {
  const [state, setState] = useState<ArtifactPanelPreviewState>("empty");
  const options = ["empty", "populated", "loading", "unavailable"] as const;
  return (
    <div className="vf-ds-side-stage">
      <div className="vf-ds-production-statebar">
        <span>Production state</span>
        <UiSegmentedControl
          options={options}
          value={state}
          onChange={setState}
          label="Artifact panel state"
        />
      </div>
      <SidePanelFrame open label="Artifact Hub preview" className="vf-ds-side-panel-frame">
        <ArtifactPanelPreview state={state} />
      </SidePanelFrame>
    </div>
  );
}

function PerformanceDiagnosticsSpecimen(): ReactElement {
  return (
    <div className="vf-ds-dev-specimen">
      <div className="vf-ds-perf-mini">
        <span>FPS</span>
        <strong>60</strong>
        <small>16.7 ms</small>
      </div>
      <p>
        Runtime frame forensics stay with ICE diagnostics; visual editing now lives in the canvas
        workbench.
      </p>
    </div>
  );
}
