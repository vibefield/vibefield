import type { RoomSelection, RoomTarget } from "@rosetta/room";
import { type ReactElement, useMemo, useState } from "react";
import { Composer } from "../frame/Composer";
import type { FrameSurface } from "../frame/frame-surface";
import type { HistoryLineDoor } from "../frame/line-door";
import { ViewsTrackView } from "../frame/ViewsTrack";
import type { ViewKeys } from "../frame/views";
import { HistoryRoomView } from "../history/HistoryRoomView";
import { FIXTURE_LINE_DOOR, fixtureClipboardStore, fixtureStillUrl } from "./ComposerLinePreview";
import {
  FIXTURE_CHOSEN_SESSION,
  FIXTURE_UNAVAILABLE_WORDS,
  type HistoryState,
  historyFixturePorts,
} from "./history-fixtures";

// History, in the catalog (AR-8c): the SHIPPING view (`HistoryRoomView`) over
// the room package's fixture ports (`history-fixtures.ts`). The markup and the
// CSS are the product's and the package's; this file stages them. Nothing is
// kept between runs (`storage={null}`): a catalog writes no preferences. The
// room draws no search of its own: History's search is the frame's Peek
// (2026-10-08), staged over the same demo in `PeekPreview.tsx`.

/** The view in one state, filling whatever plate holds it. */
export function HistoryPreview({ state = "room" }: { state?: HistoryState }): ReactElement {
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
