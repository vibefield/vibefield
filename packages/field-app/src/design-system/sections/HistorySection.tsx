import type { ReactElement } from "react";
import { Section, Specimen } from "../catalog-ui";
import { HistoryPreview, HistoryResumePlate } from "../HistoryPreview";

// History (AR-8c; DESIGN.md §8 "History"): rosetta's room as the frame holds
// it, on the package's fixture ports — the shipping view in every state the
// host owns: the room on the cover's glass, a session chosen with the line's
// Resume live, the index not answering, and nothing enrolled yet.
export function HistorySection(): ReactElement {
  return (
    <Section
      id="history"
      index="11a"
      eyebrow="History"
      title="rosetta's room, on the cover's glass"
      description="History is rosetta's own room — the projects, the sessions, the panels and the transcript — mounted as a package behind VibeField's ports: lists and figures over fieldd's doors, one session's body over the direct plane with a grant of its own. It paints no ground of its own here; its fades frost over the cover's glass, its columns end at the reserve, and its states are said in the frame's words."
    >
      <Specimen title="The room on the cover's glass" source="history/HistoryRoomView.tsx" bleed>
        <div className="vf-ds-history-plate" data-state="room">
          <HistoryPreview state="room" />
        </div>
      </Specimen>
      <Specimen
        title="A session chosen — the line's Resume, live for it"
        source="history/HistoryView.tsx"
        bleed
      >
        <div className="vf-ds-history-plate" data-state="chosen">
          <HistoryResumePlate />
        </div>
      </Specimen>
      <Specimen
        title="rosettad is not answering — the index's state, inside the frame"
        source="history/doors.ts"
        bleed
      >
        <div className="vf-ds-history-plate is-short" data-state="unavailable">
          <HistoryPreview state="unavailable" />
        </div>
      </Specimen>
      <Specimen
        title="Nothing enrolled yet — the consent line"
        source="history/HistoryRoomView.tsx"
        bleed
      >
        <div className="vf-ds-history-plate is-short" data-state="consent">
          <HistoryPreview state="consent" />
        </div>
      </Specimen>
    </Section>
  );
}
