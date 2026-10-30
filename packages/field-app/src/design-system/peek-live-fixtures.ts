import { visibleCatalog } from "@vibefield/contracts";
import type { HistoryPort, HistorySearchHit } from "@vibefield/puppeteer-views";
import type { GodviewFindDoor, LiveFilters, LiveFindAgent } from "../frame/find-door";

// LIVE NOW'S FIXTURE ADAPTER (P2; docs/UI_SYSTEM.md "Catalog fidelity";
// DESIGN.md §8 "Search — the Peek"). The catalog mounts the SHIPPING Peek
// controller (`frame/Peek.tsx`) in Godview over this door — what Godview's
// monitor publishes (`find-door.ts`): its live runs (this desktop's first
// catalog agent at work, the second waiting on studio, a bare shell), rosetta's port answering
// their words, and the two filters of the scope row. Never the Peek's markup.

const NOW = Date.parse("2026-10-09T15:42:00.000Z");
const READY = { reachable: true, readiness: "ready" as const, checkedAt: "2026-10-09T15:42:00Z" };

function run(id: string, extra: Partial<LiveFindAgent>): LiveFindAgent {
  return {
    id,
    createdAtMs: NOW - 40 * 60_000,
    status: "working",
    project: id,
    detail: "",
    color: "transparent",
    desk: { id: "this-mac", name: "MacBook Pro", os: "macos", self: true },
    ...extra,
  };
}

/** Two of the catalog's own agents (AR-L1: the fixture names no vendor). */
const [FIRST, SECOND] = visibleCatalog("desktop");
const provider = (entry: typeof FIRST): { id: string; label: string } => ({
  id: entry?.id ?? "agent",
  label: entry?.label ?? "Agent",
});

export const LIVE_FIXTURE_RUNS: readonly LiveFindAgent[] = [
  run("row-first", {
    project: "vibe-field",
    floorSessionId: "pty-first",
    agent: { provider: provider(FIRST), nativeSessionId: "native-first" },
  }),
  run("row-second", {
    project: "deploy",
    status: "blocked",
    desk: { id: "studio", name: "studio", os: "linux", self: false },
    agent: { provider: provider(SECOND) },
  }),
  run("row-shell", { project: "scratch", status: "idle", floorSessionId: "pty-shell" }),
];

/** The words the fixture's rosetta holds: the first run said "migration". */
const SAID: readonly HistorySearchHit[] = [
  {
    sessionId: "rs-first",
    rootSessionId: "rs-first",
    nativeSessionId: "native-first",
    timelineId: "tl-2",
    kind: "agent",
    at: NOW - 3 * 60_000,
    snippet: "the [migration] dry run finished in 41 s",
  },
  {
    sessionId: "rs-first",
    rootSessionId: "rs-first",
    nativeSessionId: "native-first",
    timelineId: "tl-1",
    kind: "user",
    at: NOW - 9 * 60_000,
    snippet: "run the [migration] against the copy first",
  },
];

const HISTORY: HistoryPort = {
  status: async () => READY,
  facts: async (ids) =>
    ids.includes("native-first")
      ? [
          {
            nativeSessionId: "native-first",
            sessionId: "rs-first",
            rootSessionId: "rs-first",
            title: "Move the catalog to the new store",
            updatedAt: NOW,
            streamState: "live",
          },
        ]
      : [],
  search: async (request) => ({
    status: READY,
    answered: true,
    clipped: false,
    hits: SAID.filter((hit) =>
      request.query
        .toLowerCase()
        .split(/\s+/u)
        .every((word) => hit.snippet.toLowerCase().includes(word)),
    ),
  }),
};

export const LIVE_FIXTURE_FILTERS: LiveFilters = {
  desks: [
    {
      id: "this-mac",
      name: "MacBook Pro",
      os: "macos",
      here: true,
      note: "2 agents",
      quiet: false,
    },
    { id: "studio", name: "studio", os: "linux", here: false, note: "1 agent", quiet: false },
  ],
  desk: null,
  profiles: [
    { id: "native", label: "This Mac", kind: "native", isDefault: true },
    { id: "work", label: "Work", kind: "managed", glyph: "briefcase", blocked: true },
  ],
  profile: null,
};

/** TS-4 (TS-D7) — this Mac not connected: the desktop filter holds This Mac
 * alone, and ends on the ghost row that offers the rest. */
export const LIVE_FIXTURE_FILTERS_UNCONNECTED: LiveFilters = {
  ...LIVE_FIXTURE_FILTERS,
  desks: LIVE_FIXTURE_FILTERS.desks.filter((desk) => desk.here),
  connect: true,
};

/** Godview's door over the fixture, its filters the caller's to hold: the
 * runs of the desktops it offers (not connected, this Mac's alone). */
export function peekLiveFixtureDoor(
  filters: LiveFilters,
  onFilters: (next: LiveFilters) => void,
): GodviewFindDoor {
  const rows = LIVE_FIXTURE_RUNS.filter(
    (row) =>
      (filters.desk === null || row.desk.id === filters.desk) &&
      (filters.connect !== true || row.desk.self),
  );
  return {
    rows: () => rows,
    subscribeRows: () => () => undefined,
    transcripts: HISTORY,
    select: () => undefined,
    filters,
    setDesk: (desk) => onFilters({ ...filters, desk }),
    setProfile: (profile) => onFilters({ ...filters, profile }),
    holdKeys: () => () => undefined,
    viewHoldsKeys: () => false,
  };
}

/** The fixture's clock. */
export const LIVE_FIXTURE_NOW = NOW;
