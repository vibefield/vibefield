import type { CatalogPort, CatalogStatus, RoomPorts } from "@rosetta/room";
import { createDemoPorts, createRoomDemo } from "@rosetta/room/fixtures";

// History's FIXTURE ADAPTER (AR-8c; docs/UI_SYSTEM.md "Catalog fidelity"). The
// catalog mounts the SHIPPING `HistoryRoomView` over the room package's own
// fixture entry (`@rosetta/room/fixtures`: six projects, eleven sessions, a
// year of figures, two transcripts — all relative to now), never a copy of the
// room's markup or CSS. What this file adds is only what a HOST supplies in
// the two states the package's demo does not draw: an index that cannot
// answer, and one waiting for consent — each a catalog port whose answers say
// so, the way fieldd's doors would.

/** The states the catalog draws History in. */
export const HISTORY_STATES = ["room", "chosen", "unavailable", "consent"] as const;
export type HistoryState = (typeof HISTORY_STATES)[number];

/** The words the frame says under "rosettad is not answering" in the
 * unavailable plate — fieldd's own UNAVAILABLE message for an index that is
 * coming up, as `history/doors.ts` says it. */
export const FIXTURE_UNAVAILABLE_WORDS = "The agent index is starting";

/** The demo session the chosen plate opens at: the conversation with images,
 * web lines and a run still going. */
export const FIXTURE_CHOSEN_SESSION = "s0";

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
  const ports = createDemoPorts(createRoomDemo(now));
  if (state === "unavailable") return { ...ports, catalog: unavailableCatalog(ports.catalog) };
  if (state === "consent") return { ...ports, catalog: consentCatalog(ports.catalog) };
  return ports;
}
