import { type ReactElement, useMemo } from "react";
import { Section, Specimen } from "../catalog-ui";
import { GodviewPreview } from "../GodviewPreview";
import { profileTabsDoor } from "../godview-profiles-fixtures";
import { PaneFramePreview } from "../PaneFramePreview";
import { SwarmBodiesPreview } from "../SwarmBodiesPreview";
import { TerminalMirrorPreview } from "../TerminalMirrorPreview";
import { TerminalSessionPickerPreview } from "../TerminalSessionPickerPreview";

export function GodviewSection(): ReactElement {
  const profilesDoor = useMemo(() => profileTabsDoor(), []);
  return (
    <Section
      id="godview"
      index="11"
      eyebrow="Control room"
      title="A deliberate change of register"
      description="Godview is the instrument-stage exception: compact monospace controls, flat geometry, stark status bodies, and a parchment or graphite terminal deck. The swarm's bodies below are the views package's own fixtures drawn by the shipping renderer, so its state grammar is read as the pixels Godview paints."
    >
      <Specimen title="Godview stage" source="godview/GodviewStage.tsx" bleed>
        <GodviewPreview />
      </Specimen>
      <Specimen
        title="Profile tabs — a profile's sessions on the stage, the others receded"
        source="@vibecook/puppeteer-views/bar/ProfileTabs.tsx"
        bleed
      >
        <div data-godview-profiles-catalog="">
          <GodviewPreview door={profilesDoor} />
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
      <Specimen
        title="Terminal mirror — choosing which session a card watches"
        source="terminal/widget/SessionPickerView.tsx"
        bleed
      >
        <TerminalSessionPickerPreview />
      </Specimen>
    </Section>
  );
}
