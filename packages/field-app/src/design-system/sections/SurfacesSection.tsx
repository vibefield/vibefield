import type { ThemePreference } from "@vibefield/contracts";
import { SegmentedControl as UiSegmentedControl, UnavailableState } from "@vibefield/design-kit";
import type { ArtifactPanelPreviewState } from "@vibefield/plugin-browser/design-system";
import { type ReactElement, useState } from "react";
import { LoadingVeilView } from "../../hud/LoadingVeil";
import { AppearanceSectionView } from "../../panels/AppearanceSection";
import { ProfileMark } from "../../panels/agents/ProfilesView";
import { DevicesSectionView, type DevicesSheet } from "../../panels/DevicesSection";
import { HistorySettingsView } from "../../panels/HistorySettings";
import {
  SettingsDialog,
  type SettingsPage,
  type SettingsSubpage,
} from "../../panels/SettingsDialog";
import { buttonCls } from "../../panels/settings-ui";
import { UpdatesDoctorView, UpdatesSectionView } from "../../panels/UpdatesSection";
import { finishSetupRows } from "../../setup/ledger";
import { AgentsSettingsPreview } from "../AgentsSettingsPreview";
import {
  FIXTURE_HISTORY_CENSUS,
  FIXTURE_HISTORY_CONSENTED,
  FIXTURE_ME,
  FIXTURE_OTHERS_WAITING,
  FIXTURE_SETUP_LEDGER,
} from "../account-fixtures";
import { AGENTS_FIXTURE_STATES, type AgentsFixtureState } from "../agents-fixtures";
import { CommandPalettePreview } from "../CommandPalettePreview";
import { Section, Specimen } from "../catalog-ui";
import {
  DEVICES_FIXTURE_NOW,
  DEVICES_FIXTURE_STATES,
  type DevicesFixtureState,
  devicesFixture,
} from "../devices-settings-fixtures";
import { ArtifactsDrawer } from "../EdgesPreview";
import { ProfilesSettingsPreview, profilesPreviewHead } from "../ProfilesSettingsPreview";
import {
  FIXTURE_PROFILE_SETS,
  PROFILES_FIXTURE_STATES,
  type ProfilesFixtureState,
} from "../profiles-fixtures";
import { TerminalSettingsPreview } from "../TerminalSettingsPreview";
import { TERMINAL_FIXTURE_STATES, type TerminalFixtureState } from "../terminal-settings-fixtures";
import {
  UPDATES_DOCTOR_FIXTURE,
  UPDATES_FIXTURE_NOW,
  UPDATES_HELD_STATES,
  UPDATES_PATH_STATES,
  type UpdatesFixtureState,
  updatesFixture,
} from "../updates-settings-fixtures";

export function SurfacesSection(): ReactElement {
  const [appearancePick, setAppearancePick] = useState<ThemePreference>("auto");
  const [settingsPage, setSettingsPage] = useState<SettingsPage>("appearance");
  // A press on a nav item returns to that page's top (the Agents shelf).
  const [settingsVisit, setSettingsVisit] = useState(0);
  const [settingsSubpage, setSettingsSubpage] = useState<SettingsSubpage | null>(null);
  // AO-D10 — Finish setting up under the account, until Hide is pressed here.
  const [finishHidden, setFinishHidden] = useState(false);
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
            finish={
              finishHidden
                ? undefined
                : {
                    rows: finishSetupRows(FIXTURE_SETUP_LEDGER, {
                      linked: false,
                      historyToBringIn: true,
                    }),
                    onContinue: () => undefined,
                    onHide: () => setFinishHidden(true),
                  }
            }
            subpage={
              settingsPage === "agents" || settingsPage === "terminal" ? settingsSubpage : null
            }
          >
            {settingsPage === "appearance" ? (
              // The shipping Appearance page (One Frame FC-D5), on fixture state.
              <AppearanceSectionView preference={appearancePick} onChange={setAppearancePick} />
            ) : settingsPage === "agents" ? (
              <AgentsSettingsPreview
                key={settingsVisit}
                state="installed"
                onSubpage={setSettingsSubpage}
              />
            ) : settingsPage === "history" ? (
              // AO-3 — Settings → History, the shipping view on a fixture census.
              <HistorySettingsView
                census={FIXTURE_HISTORY_CENSUS}
                consented={FIXTURE_HISTORY_CONSENTED}
                stopping={null}
                busy={false}
                error={null}
                now={Date.parse("2026-10-27T12:00:00Z")}
                onToggle={() => undefined}
                onConfirmStop={() => undefined}
                onCancelStop={() => undefined}
                onLookAgain={() => undefined}
              />
            ) : settingsPage === "terminal" ? (
              <TerminalSettingsPreview
                key={settingsVisit}
                state="everyday"
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

      <Specimen
        title="Devices — Settings › Devices: the account's reach (TS-3a)"
        source="panels/DevicesSection.tsx"
        bleed
      >
        <DevicesSettingsSpecimen />
      </Specimen>

      <Specimen title="Agent profiles" source="panels/agents/ProfilesSection.tsx" bleed>
        <ProfilesSettingsSpecimen />
      </Specimen>

      <Specimen
        title="Terminal settings — this window's look, this Mac's config.ghostty"
        source="panels/terminal/TerminalSettings.tsx"
        bleed
      >
        <TerminalSettingsSpecimen />
      </Specimen>

      <Specimen
        title="Updates — Settings › General: the update's path"
        source="panels/UpdatesSection.tsx"
        bleed
      >
        <UpdatesSettingsSpecimen states={UPDATES_PATH_STATES} label="Update card state" />
      </Specimen>

      <Specimen title="Updates — held, honest, and absent" source="panels/UpdatesSection.tsx" bleed>
        <UpdatesSettingsSpecimen states={UPDATES_HELD_STATES} label="Update card held state" />
      </Specimen>

      <Specimen title="Updater — Settings › Diagnostics" source="panels/UpdatesSection.tsx" bleed>
        <UpdatesDoctorSpecimen />
      </Specimen>

      <div className="vf-ds-grid vf-ds-grid-2">
        <Specimen title="Command palette" source="hud/CommandPalette.tsx" darkStage>
          <div className="vf-ds-palette-stage">
            <CommandPalettePreview />
          </div>
        </Specimen>
        <Specimen
          title="Artifacts — the Hub in the right edge's drawer"
          source="hud/edge-tray/EdgeTray.tsx · DESIGN.md §8"
          darkStage
        >
          <ArtifactsSpecimen />
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

/** Settings → Devices in the shipping dialog (TS-3a): the page is
 * `DevicesSectionView` over the fixture adapter, never a replica. */
function DevicesSettingsSpecimen(): ReactElement {
  const [state, setState] = useState<DevicesFixtureState>("connected");
  return (
    <div className="vf-ds-settings-stage vf-ds-agents-stage" data-devices-settings-catalog="">
      <div className="vf-ds-production-statebar">
        <span>Production state</span>
        <UiSegmentedControl
          options={DEVICES_FIXTURE_STATES}
          value={state}
          onChange={setState}
          label="Devices settings state"
        />
      </div>
      <SettingsDialog
        className="vf-ds-settings-dialog"
        activePage="devices"
        onSelectPage={() => undefined}
        onClose={() => undefined}
        onUndo={() => undefined}
        onRedo={() => undefined}
        historyBusy={false}
        undoAvailable={false}
        redoAvailable={false}
        account={{ me: FIXTURE_ME, others: FIXTURE_OTHERS_WAITING, onSwitch: () => undefined }}
        subpage={null}
      >
        <DevicesSpecimenPage key={state} state={state} />
      </SettingsDialog>
    </div>
  );
}

function DevicesSpecimenPage({ state }: { state: DevicesFixtureState }): ReactElement {
  const fixture = devicesFixture(state);
  // the sheets open and close in place, as they do on the shipping page
  const [sheet, setSheet] = useState<DevicesSheet>(fixture.sheet);
  const noop = (): void => undefined;
  return (
    <DevicesSectionView
      face={fixture.face}
      step={{ kind: "idle" }}
      disconnect={{ kind: "idle" }}
      sheet={sheet}
      devices={fixture.devices}
      platform="darwin"
      now={DEVICES_FIXTURE_NOW}
      onBegin={noop}
      onCancel={noop}
      onRenew={noop}
      onOpenAgain={noop}
      onCopyLink={async () => true}
      onCopyText={async () => true}
      onStartOver={noop}
      onSheet={setSheet}
      onDisconnect={noop}
      onSendLogs={noop}
      signOutMissed={fixture.signOutMissed ?? null}
      onRename={async () => null}
      onNewUser={noop}
    />
  );
}

/** Settings → Terminal in the shipping dialog, in every production state
 * (GT-7): the page is `TerminalSettingsView` over fixtures, never a replica. */
function TerminalSettingsSpecimen(): ReactElement {
  const [state, setState] = useState<TerminalFixtureState>("everyday");
  const [subpage, setSubpage] = useState<SettingsSubpage | null>(null);
  return (
    <div className="vf-ds-settings-stage vf-ds-agents-stage" data-terminal-settings-catalog="">
      <div className="vf-ds-production-statebar">
        <span>Production state</span>
        <UiSegmentedControl
          options={TERMINAL_FIXTURE_STATES}
          value={state}
          onChange={setState}
          label="Terminal settings state"
        />
      </div>
      <SettingsDialog
        className="vf-ds-settings-dialog"
        activePage="terminal"
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
        <TerminalSettingsPreview key={state} state={state} onSubpage={setSubpage} />
      </SettingsDialog>
    </div>
  );
}

/** Settings › General's update card in the shipping dialog (WP12d L3c-ii, §13 C5): `UpdatesSectionView` over the
 * projections and answers main gives, every production state, never a replica. */
function UpdatesSettingsSpecimen({
  states,
  label,
}: {
  states: readonly UpdatesFixtureState[];
  label: string;
}): ReactElement {
  const [state, setState] = useState<UpdatesFixtureState>(states[0] ?? "current");
  return (
    <div className="vf-ds-settings-stage vf-ds-agents-stage" data-updates-settings-catalog="">
      <div className="vf-ds-production-statebar">
        <span>Production state</span>
        <UiSegmentedControl options={states} value={state} onChange={setState} label={label} />
      </div>
      <SettingsDialog
        className="vf-ds-settings-dialog"
        activePage="general"
        onSelectPage={() => undefined}
        onClose={() => undefined}
        onUndo={() => undefined}
        onRedo={() => undefined}
        historyBusy={false}
        undoAvailable={false}
        redoAvailable={false}
        account={{ me: FIXTURE_ME, others: FIXTURE_OTHERS_WAITING, onSwitch: () => undefined }}
        subpage={null}
      >
        <UpdatesSectionView key={state} now={UPDATES_FIXTURE_NOW} {...updatesFixture(state)} />
      </SettingsDialog>
    </div>
  );
}

/** Settings › Diagnostics' updater block over the doctor's lines main writes (C4). */
function UpdatesDoctorSpecimen(): ReactElement {
  return (
    <div className="vf-ds-settings-stage" data-updates-doctor-catalog="">
      <SettingsDialog
        className="vf-ds-settings-dialog"
        activePage="diagnostics"
        onSelectPage={() => undefined}
        onClose={() => undefined}
        onUndo={() => undefined}
        onRedo={() => undefined}
        historyBusy={false}
        undoAvailable={false}
        redoAvailable={false}
        account={{ me: FIXTURE_ME, others: FIXTURE_OTHERS_WAITING, onSwitch: () => undefined }}
        subpage={null}
      >
        <UpdatesDoctorView state={UPDATES_DOCTOR_FIXTURE} />
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

/** The Artifact Hub in every production state, in the drawer that holds it
 * since One Frame FR-4 — the side panel's contents in the 152 column, where
 * the plugin answers with its narrow form. */
function ArtifactsSpecimen(): ReactElement {
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
      <ArtifactsDrawer state={state} />
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
