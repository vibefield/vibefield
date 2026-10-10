import type { HistoryPort, HistorySearchHit } from "@vibecook/puppeteer-views";
import type { GodviewFindDoor, LiveFilters, LiveFindAgent } from "../frame/find-door";

// LIVE NOW'S FIXTURE ADAPTER (P2; docs/UI_SYSTEM.md "Catalog fidelity";
// DESIGN.md §8 "Search — the Peek"). The catalog mounts the SHIPPING Peek
// controller (`frame/Peek.tsx`) in Godview over this door — what Godview's
// monitor publishes (`find-door.ts`): its live runs (this desktop's Claude at
// work, a Codex waiting on studio, a bare shell), rosetta's port answering
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

export const LIVE_FIXTURE_RUNS: readonly LiveFindAgent[] = [
  run("row-claude", {
    project: "vibe-field",
    floorSessionId: "pty-claude",
    agent: { provider: { id: "claude", label: "Claude Code" }, nativeSessionId: "native-claude" },
  }),
  run("row-codex", {
    project: "deploy",
    status: "blocked",
    desk: { id: "studio", name: "studio", os: "linux", self: false },
    agent: { provider: { id: "codex", label: "Codex" } },
  }),
  run("row-shell", { project: "scratch", status: "idle", floorSessionId: "pty-shell" }),
];

/** The words the fixture's rosetta holds: the Claude run said "migration". */
const SAID: readonly HistorySearchHit[] = [
  {
    sessionId: "rs-claude",
    rootSessionId: "rs-claude",
    nativeSessionId: "native-claude",
    timelineId: "tl-2",
    kind: "agent",
    at: NOW - 3 * 60_000,
    snippet: "the [migration] dry run finished in 41 s",
  },
  {
    sessionId: "rs-claude",
    rootSessionId: "rs-claude",
    nativeSessionId: "native-claude",
    timelineId: "tl-1",
    kind: "user",
    at: NOW - 9 * 60_000,
    snippet: "run the [migration] against the copy first",
  },
];

const HISTORY: HistoryPort = {
  status: async () => READY,
  facts: async (ids) =>
    ids.includes("native-claude")
      ? [
          {
            nativeSessionId: "native-claude",
            sessionId: "rs-claude",
            rootSessionId: "rs-claude",
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
    { id: "this-mac", name: "MacBook Pro", os: "macos", here: true, note: "2 agents", quiet: false },
    { id: "studio", name: "studio", os: "linux", here: false, note: "1 agent", quiet: false },
  ],
  desk: null,
  profiles: [
    { id: "native", label: "This Mac", kind: "native", isDefault: true },
    { id: "work", label: "Work", kind: "managed", glyph: "briefcase", blocked: true },
  ],
  profile: null,
};

/** Godview's door over the fixture, its filters the caller's to hold. */
export function peekLiveFixtureDoor(
  filters: LiveFilters,
  onFilters: (next: LiveFilters) => void,
): GodviewFindDoor {
  return {
    rows: LIVE_FIXTURE_RUNS.filter((row) => filters.desk === null || row.desk.id === filters.desk),
    history: HISTORY,
    select: () => undefined,
    filters,
    setDesk: (desk) => onFilters({ ...filters, desk }),
    setProfile: (profile) => onFilters({ ...filters, profile }),
  };
}

/** The fixture's clock. */
export const LIVE_FIXTURE_NOW = NOW;
