import type { ReactElement } from "react";
import { HistoryOpenFailedState, HistoryOpeningState } from "../../history/HistoryOpening";
import { Section, Specimen } from "../catalog-ui";
import { HistoryPreview, HistoryResumePlate } from "../HistoryPreview";
import { PeekPlate } from "../PeekPreview";

// History (AR-8c; DESIGN.md §8 "History"): rosetta's room as the frame holds
// it, on the package's fixture ports — the shipping view in every state the
// host owns: the room on the cover's glass, a session chosen with the line's
// Resume live, the index not answering, and nothing enrolled yet — and the
// two faces before the room (2026-10-04, the room's own chunk): opening, and
// a room that could not open. Its search is the frame's Peek (2026-10-08;
// §8 "Search — the Peek"): the shipping controller over a fixture port drawn
// from the same demo, at rest, holding words, before a word, with nothing
// matching, and in a narrow window.

/** A chunk refusal in the loader's own words, real-shaped. */
const FIXTURE_OPEN_FAILURE =
  "Failed to fetch dynamically imported module: vibefield-app://shell/assets/HistoryRoomView-B3aXq9Lk.js";
export function HistorySection(): ReactElement {
  return (
    <Section
      id="history"
      index="11a"
      eyebrow="History"
      title="rosetta's room, on the cover's glass"
      description="History is rosetta's own room — the projects, the sessions, the panels and the transcript — mounted as a package behind VibeField's ports: lists and figures over fieldd's doors, one session's body over the direct plane with a grant of its own. It paints no ground of its own here; on the desk its fades are the cover's tint, never frost (the cover is a tint over a still of the desk), its columns end at the reserve, and its states are said in the frame's words."
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
        title="Search — the frame's button at the head's right end, ⌘F printed under it"
        source="frame/Peek.tsx"
        bleed
      >
        <PeekPlate state="closed" />
      </Specimen>
      <Specimen
        title="The Peek — “plus” held: the list, and the peek beside it; a pick opens the room at the line"
        source="frame/PeekView.tsx"
        bleed
      >
        <PeekPlate state="open" />
      </Specimen>
      <Specimen title="Before a word is typed — your latest sessions" source="frame/Peek.tsx" bleed>
        <PeekPlate state="latest" />
      </Specimen>
      <Specimen
        title="Nothing matches — said in words, never a blank"
        source="frame/peek-model.ts"
        bleed
      >
        <PeekPlate state="none" />
      </Specimen>
      <Specimen
        title="A narrow window (K6) — the popup clamps, the peek folds and the list fills"
        source="frame/peek-model.ts"
        bleed
      >
        <PeekPlate state="narrow" />
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
      <Specimen
        title="Opening History — the room's chunk on its way (late: 120ms, then a fade)"
        source="history/HistoryOpening.tsx"
        bleed
      >
        <div className="vf-ds-history-plate is-short" data-state="opening">
          <HistoryOpeningState />
        </div>
      </Specimen>
      <Specimen
        title="History could not open — what failed, in its own words, and Retry"
        source="history/HistoryOpening.tsx"
        bleed
      >
        <div className="vf-ds-history-plate is-short" data-state="failed">
          <HistoryOpenFailedState reason={FIXTURE_OPEN_FAILURE} onRetry={() => undefined} />
        </div>
      </Specimen>
    </Section>
  );
}
