import { type ReactElement, useMemo } from "react";
import { Section, Specimen } from "../catalog-ui";
import { DeviceFilterPreview } from "../DeviceFilterPreview";
import { GodviewPreview } from "../GodviewPreview";
import { meshBoardDoor } from "../godview-mesh-fixtures";
import { profileTabsDoor } from "../godview-profiles-fixtures";
import { timelineDoor } from "../godview-timeline-fixtures";
import { PaneFramePreview } from "../PaneFramePreview";
import { PaneLauncherPreview } from "../PaneLauncherPreview";
import { SpawnBloomPreview } from "../SpawnBloomPreview";
import { SwarmBodiesPreview } from "../SwarmBodiesPreview";
import { TerminalMirrorPreview } from "../TerminalMirrorPreview";

export function GodviewSection({ dark = false }: { dark?: boolean } = {}): ReactElement {
  // Godview follows the app's theme (FC-D7): in the catalog, the page's.
  const theme = dark ? "dark" : "light";
  const profilesDoor = useMemo(() => profileTabsDoor(), []);
  const afternoonDoor = useMemo(() => timelineDoor(), []);
  const meshDoor = useMemo(() => meshBoardDoor(), []);
  return (
    <Section
      id="godview"
      index="11"
      eyebrow="Control room"
      title="A deliberate change of register"
      description="Godview is the instrument-stage exception: compact monospace controls, flat geometry, stark status bodies, and a parchment or graphite terminal deck. The swarm's bodies below are the views package's own fixtures drawn by the shipping renderer, so its state grammar is read as the pixels Godview paints."
    >
      <Specimen title="Godview stage" source="godview/GodviewStage.tsx" bleed>
        <GodviewPreview theme={theme} />
      </Specimen>
      <Specimen
        title="Timeline — the swarm through time: an afternoon from fieldd's status ledger"
        source="@vibecook/puppeteer-views/views/timeline"
        bleed
      >
        <div data-godview-timeline-catalog="">
          <GodviewPreview door={afternoonDoor} initialView="timeline" theme={theme} />
        </div>
      </Specimen>
      <Specimen
        title="Profile tabs — a profile's sessions on the stage, the others receded"
        source="@vibecook/puppeteer-views/bar/ProfileTabs.tsx"
        bleed
      >
        <div data-godview-profiles-catalog="">
          <GodviewPreview door={profilesDoor} theme={theme} />
        </div>
      </Specimen>
      <Specimen
        title="Mesh board — every self desktop's agents on one stage, an asleep one greyed"
        source="godview/monitor/mesh-field.ts"
        bleed
      >
        <div data-godview-mesh-catalog="">
          <GodviewPreview door={meshDoor} theme={theme} />
        </div>
      </Specimen>
      <Specimen
        title="Device filter — open on every desktop, and at rest on one"
        source="godview/DeviceFilterChip.tsx"
        bleed
      >
        <DeviceFilterPreview />
      </Specimen>
      <Specimen
        title="Spawn bloom — hold empty ground, reach a profile, let go"
        source="@vibecook/puppeteer-views/views/swarm/AgentSwarm.tsx"
        bleed
      >
        <div data-spawn-bloom-catalog="">
          <SpawnBloomPreview view="swarm" />
        </div>
      </Specimen>
      <Specimen
        title="Spawn bloom — the list's ＋ TERMINAL offers the same tree, in two steps"
        source="@vibecook/puppeteer-views/views/list/AgentList.tsx"
        bleed
      >
        <div data-spawn-bloom-list-catalog="">
          <SpawnBloomPreview view="list" />
        </div>
      </Specimen>
      <Specimen
        title="Pane frame — what the deck draws around every terminal"
        source="@vibecook/puppeteer-views/deck/PaneFrame.tsx"
        bleed
      >
        <PaneFramePreview />
      </Specimen>
      <Specimen
        title="Empty pane launcher — what a fresh shell offers: resume, or launch"
        source="@vibecook/puppeteer-views/launcher/PaneLauncherChrome.tsx"
        bleed
      >
        <PaneLauncherPreview />
      </Specimen>
      <Specimen
        title="Swarm bodies — every drawn state, on the package's own fixtures"
        source="@vibecook/puppeteer-views/views/swarm/AgentSwarm.tsx"
        bleed
      >
        <SwarmBodiesPreview />
      </Specimen>
      <Specimen
        title="Terminal mirror — a session watched from the canvas"
        source="terminal/mirror/TerminalMirrorSurface.tsx"
      >
        <TerminalMirrorPreview />
      </Specimen>
    </Section>
  );
}
