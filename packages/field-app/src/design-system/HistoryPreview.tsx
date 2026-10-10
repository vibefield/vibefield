import type { RoomSelection, RoomTarget } from "@rosetta/room";
import { type ReactElement, useEffect, useMemo, useState } from "react";
import { Composer } from "../frame/Composer";
import type { FrameSurface } from "../frame/frame-surface";
import type { HistoryLineDoor } from "../frame/line-door";
import { ViewsTrackView } from "../frame/ViewsTrack";
import type { ViewKeys } from "../frame/views";
import { projectIntent } from "../history/acts";
import { HistoryRoomView } from "../history/HistoryRoomView";
import {
  type HistoryHostActs,
  type HistoryHostState,
  historyHostInputs,
  NO_HOST_STATE,
} from "../history/host-inputs";
import { EMPTY_HOST_MODEL, hostModelOf } from "../history/host-model";
import { FIXTURE_LINE_DOOR, fixtureClipboardStore, fixtureStillUrl } from "./ComposerLinePreview";
import {
  FIXTURE_CHOSEN_SESSION,
  FIXTURE_UNAVAILABLE_WORDS,
  type HistoryState,
  historyFixturePorts,
  historyProjectsFixture,
} from "./history-fixtures";

// History, in the catalog (AR-8c): the SHIPPING view (`HistoryRoomView`) over
// the room package's fixture ports (`history-fixtures.ts`). The markup and the
// CSS are the product's and the package's; this file stages them. Nothing is
// kept between runs (`storage={null}`): a catalog writes no preferences. The
// room draws no search of its own: History's search is the frame's Peek
// (2026-10-08), staged over the same demo in `PeekPreview.tsx`.

/** The view in one state, filling whatever plate holds it. */
export function HistoryPreview({ state = "room" }: { state?: HistoryState }): ReactElement {
  if (state === "projects") return <HistoryProjectsPreview />;
  return <HistoryStatePreview state={state} />;
}

function HistoryStatePreview({ state }: { state: HistoryState }): ReactElement {
  const [ports] = useState(() => historyFixturePorts(state));
  const [openAt] = useState<RoomTarget | null>(() =>
    state === "chosen" || state === "projects" ? { sessionId: FIXTURE_CHOSEN_SESSION } : null,
  );
  return (
    <HistoryRoomView
      ports={ports}
      unavailable={state === "unavailable" ? FIXTURE_UNAVAILABLE_WORDS : null}
      openAt={openAt}
      storage={null}
      keys="mac"
    />
  );
}

/** History BY PROJECT (PJ-4): the shipping view over the shipping adapter and
 * a fixture fieldd, handed the room's host inputs by the SHIPPING builder
 * (`historyHostInputs`) over the model the controller would gather — colours,
 * desktop marks, Live now / Home / Temporary, row acts, New agent, ③'s
 * folders, the chips, and the project's acts where they act (H4): pin and
 * hide at ①'s row end, "Not part of this project" on ③'s folder rows, rename
 * on ②'s name. The chips answer here as they do in the product, and a rename
 * asks the fixture fieldd through the shipping intent — which refuses, so the
 * plate shows how a refusal reads under the name; an act that would ask
 * fieldd otherwise (Resume, Jump to, New agent, pin, hide, split) does
 * nothing — a catalog acts on no one. */
function HistoryProjectsPreview(): ReactElement {
  const [fixture] = useState(() => historyProjectsFixture());
  const [openAt] = useState<RoomTarget>({ sessionId: FIXTURE_CHOSEN_SESSION });
  const [listing, setListing] = useState(() => fixture.catalog.listing());
  useEffect(() => fixture.catalog.onListing(setListing), [fixture]);
  const model = useMemo(
    () =>
      listing === null
        ? EMPTY_HOST_MODEL
        : hostModelOf(listing, fixture.roster, fixture.runs, fixture.providers),
    [listing, fixture],
  );
  const [state, setState] = useState<HistoryHostState>({ ...NO_HOST_STATE, home: "/Users/demo" });
  const acts = useMemo<HistoryHostActs>(
    () => ({
      setDesktop: (desktop) => setState((now) => ({ ...now, desktop })),
      setAgent: (agent) => setState((now) => ({ ...now, agent })),
      resume: () => undefined,
      jump: () => undefined,
      newAgent: () => undefined,
      intent: () => undefined,
      // H4's rename asks the fixture fieldd through the SHIPPING intent, and
      // the room says its refusal under the name
      rename: async (key, name) => {
        const outcome = await projectIntent(fixture.client, { key, op: "rename", name });
        if (outcome.state === "refused") throw new Error(outcome.reason);
      },
      shown: () => undefined,
    }),
    [fixture],
  );
  const inputs = useMemo(() => historyHostInputs(model, state, acts), [model, state, acts]);
  return (
    <HistoryRoomView
      ports={fixture.ports}
      openAt={openAt}
      storage={null}
      keys="mac"
      inputs={inputs}
    />
  );
}

/** A session chosen in the room, and the line's create — Resume — live for it:
 * the room's own selection is what History lends the line (the product wires
 * the same report through `HistoryView`), and pressing Resume here answers as
 * a placed pane would ("Resumed in the active pane"). `live`: the chosen
 * session runs here, so the create is Jump to (P3), answering as a revealed
 * pane would ("Jumped to its pane"). */
export function HistoryResumePlate({
  keys = "mac",
  live = false,
}: {
  keys?: ViewKeys;
  live?: boolean;
}): ReactElement {
  const [ports] = useState(() => historyFixturePorts("chosen"));
  const [openAt] = useState<RoomTarget>({ sessionId: FIXTURE_CHOSEN_SESSION });
  const [selection, setSelection] = useState<RoomSelection | null>(null);
  const [surface, setSurface] = useState<FrameSurface | null>(null);
  const [clipboard] = useState(fixtureClipboardStore);
  const door = useMemo<HistoryLineDoor>(
    () => ({
      chosen: selection?.sessionId ?? null,
      waits: null,
      live: live && selection !== null,
      resume: async () => ({ state: "resumed" }),
      jump: async () => ({ state: "jumped" }),
    }),
    [selection, live],
  );
  return (
    <>
      <HistoryRoomView
        ports={ports}
        openAt={openAt}
        onSelect={setSelection}
        storage={null}
        keys={keys}
      />
      <Composer
        view="history"
        keys={keys}
        surface={surface}
        onSurfaceChange={setSurface}
        godview={FIXTURE_LINE_DOOR}
        history={door}
        clipboard={clipboard}
        host={{ screenshotStillUrl: fixtureStillUrl }}
        writeClipboard={async () => undefined}
        bindKeys={false}
        track={<ViewsTrackView view="history" keys={keys} />}
      />
    </>
  );
}
