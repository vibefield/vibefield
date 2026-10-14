import type { RoomPorts, RoomTarget } from "@vibefield/rosetta-room";
import { createDemoPorts, createRoomDemo } from "@vibefield/rosetta-room/fixtures";
import { type ReactElement, useCallback, useMemo, useState } from "react";
import type { LiveFilters } from "../frame/find-door";
import type { FrameSurface } from "../frame/frame-surface";
import { Peek } from "../frame/Peek";
import type { PeekRow, PeekTarget } from "../frame/peek-model";
import type { ViewKeys } from "../frame/views";
import { HistoryRoomView, PeekReaderView } from "../history/HistoryRoomView";
import { FIXTURE_SEARCH_QUERY, historyFixturePorts } from "./history-fixtures";
import { peekFixturePort } from "./peek-fixtures";
import { LIVE_FIXTURE_FILTERS, LIVE_FIXTURE_NOW, peekLiveFixtureDoor } from "./peek-live-fixtures";

// Search — the Peek, in the catalog (DESIGN.md §8 "Search — the Peek";
// GV-D8/D9/D10, built 2026-10-08): the SHIPPING Peek controller (`Peek.tsx`)
// over a fixture port (`peek-fixtures.ts`), standing over the SHIPPING History
// view (`HistoryRoomView`). Open, it holds words over the room drawn from the
// same demo the port answers from, the hot row read by the room's own reader
// at its line (PK3) — so a pick, by a click, by ↵ or by Open,
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

/** The states the catalog draws the Peek in: History's at rest and open, and
 * Godview's Live now (P2). */
export type PeekPlateState = "closed" | "open" | "live";

export function PeekPlate({
  state,
  keys = "mac",
}: {
  state: PeekPlateState;
  keys?: ViewKeys;
}): ReactElement {
  return state === "live" ? (
    <PeekLivePlate keys={keys} />
  ) : (
    <PeekHistoryPlate state={state} keys={keys} />
  );
}

/** Godview's Live now (P2): the SHIPPING controller in Godview, open over the
 * monitor's door as a fixture holds it (`peek-live-fixtures.ts`) — its live
 * runs waiting first, a peer's run saying where it runs, the scope row's two
 * filters live on the plate (a choice narrows the rows and the button wears
 * it). The live peek's pane needs a window's terminals, which no catalog has:
 * the plate draws the words a window without them says. */
function PeekLivePlate({ keys }: { keys: ViewKeys }): ReactElement {
  const [filters, setFilters] = useState<LiveFilters>(LIVE_FIXTURE_FILTERS);
  const godview = useMemo(() => peekLiveFixtureDoor(filters, setFilters), [filters]);
  const [surface, setSurface] = useState<FrameSurface | null>("search");
  const [plate, setPlate] = useState<HTMLDivElement | null>(null);
  const noop = useCallback(() => undefined, []);
  const now = useCallback(() => LIVE_FIXTURE_NOW, []);
  const [port] = useState(() => peekFixturePort(createRoomDemo()));
  return (
    <div ref={setPlate} className="vf-ds-history-plate vf-ds-peek-plate" data-state="peek-live">
      <Peek
        view="godview"
        keys={keys}
        surface={surface}
        onSurfaceChange={setSurface}
        port={port}
        onOpenPast={noop}
        godview={godview}
        onOpenLive={noop}
        bindKeys={false}
        container={plate}
        takeFocus={false}
        now={now}
      />
    </div>
  );
}

function PeekHistoryPlate({
  state,
  keys,
}: {
  state: "closed" | "open";
  keys: ViewKeys;
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
  // PK3 — the past picture is the room's own reader over the same demo ports
  // the room beside it reads (the product's: the window's History ports)
  const pastReader = useCallback(
    (row: PeekRow, query: string) => (
      <PeekReaderView
        ports={ports}
        at={{
          sessionId: row.target.sessionId,
          timelineId: row.target.timelineId ?? null,
          query: query.trim() === "" ? null : query.trim(),
        }}
      />
    ),
    [ports],
  );
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
        pastReader={pastReader}
      />
    </div>
  );
}
