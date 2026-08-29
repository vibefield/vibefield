import type { ReactElement } from "react";
import { AgentBubblePreview } from "../AgentBubblePreview";
import { Section, Specimen } from "../catalog-ui";
import { GodviewPreview } from "../GodviewPreview";
import { TerminalMirrorPreview } from "../TerminalMirrorPreview";
import { TerminalSessionPickerPreview } from "../TerminalSessionPickerPreview";

export function GodviewSection(): ReactElement {
  return (
    <Section
      id="godview"
      index="11"
      eyebrow="Control room"
      title="A deliberate change of register"
      description="Godview is the instrument-stage exception: compact monospace controls, flat geometry, stark status bodies, and a parchment or graphite terminal deck. The complete circle inventory below makes its state grammar explicit instead of leaving it buried in the physics view."
    >
      <Specimen title="Godview stage" source="godview/GodviewStage.tsx" bleed>
        <GodviewPreview />
      </Specimen>
      <Specimen
        title="Agent circle anatomy and complete state inventory"
        source="godview/views/swarm/AgentBubble.tsx"
        bleed
      >
        <AgentBubblePreview />
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
