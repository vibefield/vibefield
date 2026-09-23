import { SegmentedControl as UiSegmentedControl, UnavailableState } from "@vibefield/design-kit";
import {
  ArtifactPanelPreview,
  type ArtifactPanelPreviewState,
} from "@vibefield/plugin-browser/design-system";
import { type ReactElement, useState } from "react";
import type { MagnetGridGlyph } from "../../field/canvas-appearance";
import { LoadingVeilView } from "../../hud/LoadingVeil";
import { SidePanelFrame } from "../../hud/SidePanelStage";
import { ProfileMark } from "../../panels/agents/ProfilesView";
import { MagnetGridSection } from "../../panels/MagnetGridSection";
import {
  SettingsDialog,
  type SettingsPage,
  type SettingsSubpage,
} from "../../panels/SettingsDialog";
import { buttonCls, SettingsRow, SettingsSection, SettingsSwitch } from "../../panels/settings-ui";
import { AgentsSettingsPreview } from "../AgentsSettingsPreview";
import { FIXTURE_ME, FIXTURE_OTHERS_WAITING } from "../account-fixtures";
import { AGENTS_FIXTURE_STATES, type AgentsFixtureState } from "../agents-fixtures";
import { CommandPalettePreview } from "../CommandPalettePreview";
import { Section, Specimen } from "../catalog-ui";
import { ProfilesSettingsPreview, profilesPreviewHead } from "../ProfilesSettingsPreview";
import {
  FIXTURE_PROFILE_SETS,
  PROFILES_FIXTURE_STATES,
  type ProfilesFixtureState,
} from "../profiles-fixtures";

export function SurfacesSection({
  magnetGridGlyph,
  onMagnetGridGlyphChange,
}: {
  magnetGridGlyph: MagnetGridGlyph;
  onMagnetGridGlyphChange: (glyph: MagnetGridGlyph) => void;
}): ReactElement {
  const [settingsOn, setSettingsOn] = useState(true);
  const [settingsPage, setSettingsPage] = useState<SettingsPage>("appearance");
  // A press on a nav item returns to that page's top (the Agents shelf).
  const [settingsVisit, setSettingsVisit] = useState(0);
  const [settingsSubpage, setSettingsSubpage] = useState<SettingsSubpage | null>(null);
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
            onSelectPage={(page) => {
              setSettingsPage(page);
              setSettingsVisit((visit) => visit + 1);
            }}
            onClose={() => undefined}
            onUndo={() => undefined}
            onRedo={() => undefined}
            historyBusy={false}
            undoAvailable={false}
            redoAvailable={false}
            account={{
              me: FIXTURE_ME,
              others: FIXTURE_OTHERS_WAITING,
              onSwitch: () => undefined,
            }}
            subpage={settingsPage === "agents" ? settingsSubpage : null}
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
            ) : settingsPage === "agents" ? (
              <AgentsSettingsPreview
                key={settingsVisit}
                state="installed"
                onSubpage={setSettingsSubpage}
              />
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

      <Specimen title="Agents settings" source="panels/agents/AgentsSection.tsx" bleed>
        <AgentsSettingsSpecimen />
      </Specimen>

      <Specimen title="Agent profiles" source="panels/agents/ProfilesSection.tsx" bleed>
        <ProfilesSettingsSpecimen />
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

/** Every production state of the Agents section in the shipping dialog; the
 * rows open their agent's page, and the header's back button returns. */
function AgentsSettingsSpecimen(): ReactElement {
  const [state, setState] = useState<AgentsFixtureState>("installed");
  const [subpage, setSubpage] = useState<SettingsSubpage | null>(null);
  return (
    <div className="vf-ds-settings-stage vf-ds-agents-stage" data-agents-settings-catalog="">
      <div className="vf-ds-production-statebar">
        <span>Production state</span>
        <UiSegmentedControl
          options={AGENTS_FIXTURE_STATES}
          value={state}
          onChange={setState}
          label="Agents settings state"
        />
      </div>
      <SettingsDialog
        className="vf-ds-settings-dialog"
        activePage="agents"
        onSelectPage={() => undefined}
        onClose={() => undefined}
        onUndo={() => undefined}
        onRedo={() => undefined}
        historyBusy={false}
        undoAvailable={false}
        redoAvailable={false}
        account={{ me: FIXTURE_ME, others: FIXTURE_OTHERS_WAITING, onSwitch: () => undefined }}
        subpage={subpage}
      >
        <AgentsSettingsPreview key={state} state={state} onSubpage={setSubpage} />
      </SettingsDialog>
    </div>
  );
}

/** Every production state of Agent Profiles in the shipping dialog, the
 * sidebar's "Agent Profiles" group listing the fixture's places. */
function ProfilesSettingsSpecimen(): ReactElement {
  const [state, setState] = useState<ProfilesFixtureState>("profile");
  const [subpage, setSubpage] = useState<SettingsSubpage | null>(null);
  const { head, current } = profilesPreviewHead(state);
  return (
    <div className="vf-ds-settings-stage vf-ds-agents-stage" data-profiles-settings-catalog="">
      <div className="vf-ds-production-statebar">
        <span>Production state</span>
        <UiSegmentedControl
          options={PROFILES_FIXTURE_STATES}
          value={state}
          onChange={setState}
          label="Agent profiles state"
        />
      </div>
      <SettingsDialog
        className="vf-ds-settings-dialog"
        activePage="profiles"
        onSelectPage={() => undefined}
        onClose={() => undefined}
        onUndo={() => undefined}
        onRedo={() => undefined}
        historyBusy={false}
        undoAvailable={false}
        redoAvailable={false}
        account={{ me: FIXTURE_ME, others: FIXTURE_OTHERS_WAITING, onSwitch: () => undefined }}
        profiles={{
          items: FIXTURE_PROFILE_SETS.map((set) => ({
            id: set.id,
            label: set.label,
            mark: <ProfileMark set={set} size={18} />,
          })),
          current,
          onSelect: () => undefined,
          onNew: () => undefined,
        }}
        head={head}
        subpage={subpage}
      >
        <ProfilesSettingsPreview key={state} state={state} onSubpage={setSubpage} />
      </SettingsDialog>
    </div>
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
