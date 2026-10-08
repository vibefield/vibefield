import type { RoomPorts, RoomTarget } from "@rosetta/room";
import { createDemoPorts, createRoomDemo } from "@rosetta/room/fixtures";
import { type ReactElement, useCallback, useState } from "react";
import type { FrameSurface } from "../frame/frame-surface";
import { Peek } from "../frame/Peek";
import type { PeekTarget } from "../frame/peek-model";
import type { ViewKeys } from "../frame/views";
import { HistoryRoomView } from "../history/HistoryRoomView";
import { FIXTURE_SEARCH_QUERY, historyFixturePorts } from "./history-fixtures";
import { peekFixturePort } from "./peek-fixtures";

// Search — the Peek, in the catalog (DESIGN.md §8 "Search — the Peek";
// GV-D8/D9/D10, built 2026-10-08): the SHIPPING Peek controller (`Peek.tsx`)
// over a fixture port (`peek-fixtures.ts`), standing over the SHIPPING History
// view (`HistoryRoomView`). Open, it holds words over the room drawn from the
// same demo the port answers from — so a pick, by a click, by ↵ or by Open,
// lands that room on the line through its own `openAt`, as the product's does
// through `open-at.ts`. At rest it is the frame's button over History before
// anything is read (the consent face: a real state, and a light one — every
// plate on this page is mounted for every catalog test, and a full room each
// would cost the page's own budget). The plate is the window: the button at
// its head's right end, the scrim and the popup drawn in it, the view
// receding under them by the product's own rule (`data-peek-recede`). No
// plate binds a key on the page and none takes its focus. The states a plate
// does not draw — before a word, nothing matching, a narrow window (K6) —
// are the window tests' (`peek.test.tsx`).

/** The states the catalog draws the Peek in. */
export type PeekPlateState = "closed" | "open";

export function PeekPlate({
  state,
  keys = "mac",
}: {
  state: PeekPlateState;
  keys?: ViewKeys;
}): ReactElement {
  const [demo] = useState(() => createRoomDemo());
  const [ports] = useState<RoomPorts>(() =>
    state === "open" ? createDemoPorts(demo) : historyFixturePorts("consent", demo.now),
  );
  const [port] = useState(() => peekFixturePort(demo));
  const [surface, setSurface] = useState<FrameSurface | null>(state === "open" ? "search" : null);
  const [openAt, setOpenAt] = useState<RoomTarget | null>(null);
  const [plate, setPlate] = useState<HTMLDivElement | null>(null);
  // a fresh object per pick, as the product's door hands the room
  const openPast = useCallback((target: PeekTarget) => setOpenAt({ ...target }), []);
  const now = useCallback(() => demo.now, [demo]);
  return (
    <div
      ref={setPlate}
      className="vf-ds-history-plate vf-ds-peek-plate"
      data-state={`peek-${state}`}
      data-keys={keys}
    >
      <div className="vf-ds-peek-view" data-peek-recede={surface === "search" ? "true" : "false"}>
        <HistoryRoomView ports={ports} openAt={openAt} storage={null} keys={keys} />
      </div>
      <Peek
        view="history"
        keys={keys}
        surface={surface}
        onSurfaceChange={setSurface}
        port={port}
        onOpenPast={openPast}
        bindKeys={false}
        container={plate}
        initialQuery={state === "open" ? FIXTURE_SEARCH_QUERY : ""}
        takeFocus={false}
        now={now}
      />
    </div>
  );
}
