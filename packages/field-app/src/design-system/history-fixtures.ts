import type { CatalogPort, CatalogStatus, RoomPorts } from "@vibefield/rosetta-room";
import { createDemoPorts, createRoomDemo } from "@vibefield/rosetta-room/fixtures";
import { historySample, SAMPLE_SESSION } from "../history/history-sample";

// History's FIXTURE ADAPTER (AR-8c; docs/UI_SYSTEM.md "Catalog fidelity"). The
// catalog mounts the SHIPPING `HistoryRoomView` over the room package's own
// fixture entry (`@vibefield/rosetta-room/fixtures`: six projects, eleven sessions, a
// year of figures, two transcripts — all relative to now), never a copy of the
// room's markup or CSS. What this file adds is only what a HOST supplies in
// the two states the package's demo does not draw: an index that cannot
// answer, and one waiting for consent — each a catalog port whose answers say
// so, the way fieldd's doors would.

/** The states the catalog draws History in. `projects`: History BY PROJECT
 * (PJ-4) — the shipping adapter (`history/doors.ts`) over a fixture fieldd
 * that answers `project.list`, the keyed listing and the merged figures: since
 * HG-2 the product's sample (`history/history-sample.ts`), one fieldd for both.
 * `new-agent`: the room with AO-6b's new agent with a past at its head (the
 * shipping row over the census's fixture agent, `account-fixtures.ts`). */
export const HISTORY_STATES = [
  "room",
  "chosen",
  "projects",
  "unavailable",
  "consent",
  "new-agent",
] as const;
export type HistoryState = (typeof HISTORY_STATES)[number];

/** The words the frame says under "History isn't answering" in the
 * unavailable plate — fieldd's own UNAVAILABLE message for an index that is
 * coming up, as `history/doors.ts` says it. */
export const FIXTURE_UNAVAILABLE_WORDS = "The agent index is starting";

/** The demo session the chosen plate opens at: the conversation with images,
 * web lines and a run still going — the sample's own (HG-2). */
export const FIXTURE_CHOSEN_SESSION = SAMPLE_SESSION;

/** The words the Peek's plate holds (`PeekPreview.tsx`): the demo catalog's
 * own `search` answers them from the transcripts' words — three messages in
 * the chosen conversation say "plus", so the row carries three lines and the
 * peek beside it shows them. */
export const FIXTURE_SEARCH_QUERY = "plus";

/** An index that does not answer: the topology stream closes without a row,
 * and the status door refuses in the frame's words. */
function unavailableCatalog(catalog: CatalogPort): CatalogPort {
  return {
    ...catalog,
    subscribeMeta(handlers) {
      let open = true;
      queueMicrotask(() => {
        if (open) handlers.onStatus?.("closed");
      });
      return {
        close: () => {
          open = false;
        },
      };
    },
    status: async () => {
      throw new Error(FIXTURE_UNAVAILABLE_WORDS);
    },
    unavailable: () => FIXTURE_UNAVAILABLE_WORDS,
  };
}

/** An index that has found agents and reads nothing until it is told which:
 * an empty topology, and the ingest phase that says why. */
const AWAITING_CONSENT: CatalogStatus = {
  canonicalReady: false,
  searchReadiness: "building",
  searchProgress: null,
  ingest: { phase: "awaiting_consent", runtimes: [], projects: [] },
  startedAt: null,
  uptimeMs: 0,
};

function consentCatalog(catalog: CatalogPort): CatalogPort {
  return {
    ...catalog,
    subscribeMeta(handlers) {
      let open = true;
      queueMicrotask(() => {
        if (!open) return;
        handlers.onStatus?.("live");
        handlers.onChange?.({ runtimes: [], projects: [], sessions: [] }, "snapshot");
      });
      return {
        close: () => {
          open = false;
        },
      };
    },
    status: async () => AWAITING_CONSENT,
  };
}

/** The room's ports for one catalog state, over the package's demo. */
export function historyFixturePorts(state: HistoryState, now: number = Date.now()): RoomPorts {
  const demo = createRoomDemo(now);
  const ports = createDemoPorts(demo);
  if (state === "projects") return historySample(now).ports;
  if (state === "unavailable") return { ...ports, catalog: unavailableCatalog(ports.catalog) };
  if (state === "consent") return { ...ports, catalog: consentCatalog(ports.catalog) };
  return ports;
}
