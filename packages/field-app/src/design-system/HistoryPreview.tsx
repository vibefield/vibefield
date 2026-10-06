import type { RoomSelection, RoomTarget } from "@rosetta/room";
import { type ReactElement, useMemo, useState } from "react";
import { Composer } from "../frame/Composer";
import type { FrameSurface } from "../frame/frame-surface";
import type { HistoryLineDoor } from "../frame/line-door";
import { ViewsTrackView } from "../frame/ViewsTrack";
import type { ViewKeys } from "../frame/views";
import { HistoryRoomView } from "../history/HistoryRoomView";
import { historySearchSheet } from "../history/search";
import { FIXTURE_LINE_DOOR, fixtureClipboardStore, fixtureStillUrl } from "./ComposerLinePreview";
import {
  FIXTURE_CHOSEN_SESSION,
  FIXTURE_SEARCH_QUERY,
  FIXTURE_UNAVAILABLE_WORDS,
  type HistoryState,
  historyFixturePorts,
} from "./history-fixtures";

// History, in the catalog (AR-8c): the SHIPPING view (`HistoryRoomView`) over
// the room package's fixture ports (`history-fixtures.ts`). The markup and the
// CSS are the product's and the package's; this file stages them. Nothing is
// kept between runs (`storage={null}`): a catalog writes no preferences.
// Until the Peek lands every plate holds the room's search as the product does
// (the search interim): the strip's pill, no key printed, the sheet's open state
// one frame value — the frame playground's own when it stages the view, the
// plate's otherwise. No plate binds a key on the page (the line's plates bind
// none either), so the stepper walks by its arrows here.

/** The view in one state, filling whatever plate holds it — on the frame's one
 * value when a staged frame hands it one. */
export function HistoryPreview({
  state = "room",
  surface,
  onSurfaceChange,
}: {
  state?: HistoryState;
  surface?: FrameSurface | null;
  onSurfaceChange?: (next: FrameSurface | null) => void;
}): ReactElement {
  const [ports] = useState(() => historyFixturePorts(state));
  const [openAt] = useState<RoomTarget | null>(() =>
    state === "chosen" ? { sessionId: FIXTURE_CHOSEN_SESSION } : null,
  );
  const [ownSurface, setOwnSurface] = useState<FrameSurface | null>(null);
  const framed = onSurfaceChange !== undefined;
  const value = framed ? (surface ?? null) : ownSurface;
  const change = onSurfaceChange ?? setOwnSurface;
  const search = useMemo(() => historySearchSheet(value, change), [value, change]);
  return (
    <HistoryRoomView
      ports={ports}
      unavailable={state === "unavailable" ? FIXTURE_UNAVAILABLE_WORDS : null}
      openAt={openAt}
      storage={null}
      search={search}
    />
  );
}

/** History's search until the Peek lands (the search interim; DESIGN.md §8
 * "History"): the room holding a search — "plus", the strip's pill in primary
 * ink — with the sheet one press on the pill away, over the package's fixture
 * catalog, which answers `search` from the demo's own words. A hit opens its
 * conversation, lands the transcript on the message and leaves the stepper in
 * its head. The sheet is not open on load: it is a modal dialog, and one open
 * on load would take the whole catalog page's focus and pointer. */
export function HistorySearchPlate(): ReactElement {
  const [ports] = useState(() => historyFixturePorts("room"));
  const [surface, setSurface] = useState<FrameSurface | null>(null);
  const search = useMemo(
    () => ({ ...historySearchSheet(surface, setSurface), initialQuery: FIXTURE_SEARCH_QUERY }),
    [surface],
  );
  return <HistoryRoomView ports={ports} storage={null} search={search} />;
}

/** A session chosen in the room, and the line's create — Resume — live for it:
 * the room's own selection is what History lends the line (the product wires
 * the same report through `HistoryView`), and pressing Resume here answers as
 * a placed pane would ("Resumed in the active pane"). */
export function HistoryResumePlate({ keys = "mac" }: { keys?: ViewKeys }): ReactElement {
  const [ports] = useState(() => historyFixturePorts("chosen"));
  const [openAt] = useState<RoomTarget>({ sessionId: FIXTURE_CHOSEN_SESSION });
  const [selection, setSelection] = useState<RoomSelection | null>(null);
  const [surface, setSurface] = useState<FrameSurface | null>(null);
  const [clipboard] = useState(fixtureClipboardStore);
  const door = useMemo<HistoryLineDoor>(
    () => ({
      chosen: selection?.sessionId ?? null,
      waits: null,
      resume: async () => ({ state: "resumed" }),
    }),
    [selection],
  );
  const search = useMemo(() => historySearchSheet(surface, setSurface), [surface]);
  return (
    <>
      <HistoryRoomView
        ports={ports}
        openAt={openAt}
        onSelect={setSelection}
        storage={null}
        search={search}
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
