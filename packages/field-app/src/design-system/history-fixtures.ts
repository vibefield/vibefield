import type { CatalogPort, CatalogStatus, RoomPorts } from "@vibefield/rosetta-room";
import {
  createColdImport,
  createDemoPorts,
  createRoomDemo,
} from "@vibefield/rosetta-room/fixtures";
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

/** IM-1 — the moments the catalog draws History's import sign at (DESIGN.md §8 "History", the import's sign): the
 * import reading its sources (step 2, the archive still in memory), building search (step 4, the archive on disk),
 * and after the import, at rest. */
export const IMPORT_SIGN_MOMENTS = ["reading", "search", "rest"] as const;
export type ImportSignMoment = (typeof IMPORT_SIGN_MOMENTS)[number];

/** Where each moment stands in the room package's own simulated cold import. */
const IMPORT_SIGN_PHASES = {
  reading: "newest-giant",
  search: "search-indexing",
  rest: "search-ready",
} as const satisfies Record<ImportSignMoment, string>;

/** What fieldd hands the room beside rosetta's status (IM-1, `index.status` for an own window): what the index keeps
 * on disk and the memory it holds, made from what the import has read by then in the proportions of a measured
 * Mac's import (a record some 3.4× smaller than its sources; the archive held in memory until step 3 writes it). */
function measuredBeside(
  status: CatalogStatus,
  moment: ImportSignMoment,
  at: number,
): Pick<CatalogStatus, "storage" | "memory"> {
  const read = (status.ingest?.runtimes ?? []).reduce(
    (sum, runtime) => sum + runtime.bytes_streamed,
    0,
  );
  const archive = Math.round(read * 0.42);
  const written = moment !== "reading";
  return {
    storage: {
      record_bytes: Math.round(read / 3.4),
      archive_bytes: written ? archive : 0,
      search_bytes: moment === "rest" ? Math.round(read * 0.11) : 0,
      media_bytes: Math.round(read * 0.03),
      measured_at: at,
    },
    memory: {
      footprint_bytes: 380_000_000 + (written ? 0 : archive),
      archive_bytes: written ? null : archive,
    },
  };
}

/** The room's ports at one moment of a cold import: the package's simulator stood there (a tenth of a Mac's
 * history, every kind of row), its status with what fieldd measures beside it. */
export function importSignPorts(moment: ImportSignMoment, now: number = Date.now()): RoomPorts {
  const cold = createColdImport({ now, scale: 0.1, consent: "granted" });
  cold.controller.advanceToPhase(IMPORT_SIGN_PHASES[moment]);
  const at = now + cold.controller.clock;
  const catalog: CatalogPort = {
    ...cold.ports.catalog,
    status: async () => {
      const status = await cold.ports.catalog.status();
      return { ...status, ...measuredBeside(status, moment, at) };
    },
  };
  return { ...cold.ports, catalog };
}
