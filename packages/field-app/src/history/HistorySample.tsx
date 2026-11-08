import { HistoryRoom, type HistoryRoomHandle } from "@vibefield/rosetta-room";
import { type ReactElement, useEffect, useMemo, useRef, useState } from "react";
import { HEAD_BAND_PX } from "../frame/frame-geometry";
import { historySample, SAMPLE_SESSION } from "./history-sample";
import {
  type HistoryHostActs,
  type HistoryHostState,
  historyHostInputs,
  NO_HOST_STATE,
} from "./host-inputs";
import { EMPTY_HOST_MODEL, hostModelOf } from "./host-model";

// HISTORY'S SAMPLE (track HG, HG-2; HG-D2 ruled by James 2026-11-08; DESIGN.md
// §8 "History" — before its past, the room behind glass; §5 History's sample).
// The room behind History's consent card is the room itself, never a picture
// of it: the package's demo through the shipping by-project adapter over a
// data-only fixture fieldd (`history-sample.ts`, the projects plate's fieldd
// too), handed the room's host inputs by the shipping builder, so it is History
// as it ships and lays itself out at the window's size and in its theme. It
// keeps nothing (storage null), asks fieldd nothing (its fieldd is the
// sample's), is inert and hidden from assistive tech, and acts on no one: no
// press reaches it, and every act the builder hands the room is a no-op here.
// Anything the room portals lands inside it, inert and frosted too. It opens at
// the demo's chosen session. It rides the room's chunk — only `HistoryGlass.tsx`
// imports it — and stands only while the index waits for consent; its frost,
// and every motion inside it stopped, are `history-glass.css`'s.

/** The sample acts on no one. */
const NO_ACTS: HistoryHostActs = {
  setDesktop: () => undefined,
  setAgent: () => undefined,
  resume: () => undefined,
  jump: () => undefined,
  newAgent: () => undefined,
  intent: () => undefined,
  rename: async () => undefined,
  shown: () => undefined,
  page: () => undefined,
};

/** Its paths read under the demo's home, as the projects plate's do. */
const SAMPLE_STATE: HistoryHostState = { ...NO_HOST_STATE, home: "/Users/demo" };

export function HistorySample(): ReactElement {
  const [sample] = useState(() => historySample());
  const [listing, setListing] = useState(() => sample.catalog.listing());
  useEffect(() => sample.catalog.onListing(setListing), [sample]);
  const model = useMemo(
    () =>
      listing === null
        ? EMPTY_HOST_MODEL
        : hostModelOf(listing, sample.roster, sample.runs, sample.providers, sample.profileSets),
    [listing, sample],
  );
  const inputs = useMemo(() => historyHostInputs(model, SAMPLE_STATE, NO_ACTS), [model]);
  const room = useRef<HistoryRoomHandle | null>(null);
  useEffect(() => {
    room.current?.openAt({ sessionId: SAMPLE_SESSION });
  }, []);
  const [layers, setLayers] = useState<HTMLDivElement | null>(null);
  return (
    <div className="vf-history-sample" inert aria-hidden="true">
      <div className="vf-history-room">
        <HistoryRoom
          ref={room}
          catalog={sample.ports.catalog}
          sessions={sample.ports.sessions}
          assets={sample.ports.assets}
          host={sample.ports.host ?? null}
          surface="host"
          edgeInset={{ top: HEAD_BAND_PX }}
          portalContainer={layers}
          storage={null}
          {...inputs}
        />
      </div>
      <div className="vf-history-layers" ref={setLayers} />
    </div>
  );
}
