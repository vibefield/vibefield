import { visibleCatalog } from "@vibefield/contracts";
import type { HistoryPort, HistorySearchHit } from "@vibefield/puppeteer-views";
import type {
  GodviewFindDoor,
  LiveAgentChoice,
  LiveFilters,
  LiveFindAgent,
} from "../frame/find-door";
import { SHELL_AGENT, SHELL_LABEL } from "../godview/monitor/work-facets";

// LIVE NOW'S FIXTURE ADAPTER (P2; docs/UI_SYSTEM.md "Catalog fidelity";
// DESIGN.md §8 "Search — the Peek"). The catalog mounts the SHIPPING Peek
// controller (`frame/Peek.tsx`) in Godview over this door — what Godview's
// monitor publishes (`find-door.ts`): its live runs (this desktop's first
// catalog agent at work and waiting under Work, the second waiting on studio,
// a bare shell — this desktop's each saying its profile, SE-D1), rosetta's
// port answering their words, and Godview's filters with every count
// (+ Filter's menu, the field's tokens): since WL-1 (2026-11-23) the work
// column's projects and agents too. Never the Peek's markup.

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
    profileSet: "native",
  }),
  run("row-work", {
    project: "billing-api",
    status: "blocked",
    floorSessionId: "pty-work",
    agent: { provider: provider(FIRST) },
    profileSet: "work",
  }),
  // a peer's run says no profile: a profile is its own desktop's (SE-D1)
  run("row-second", {
    project: "deploy",
    status: "blocked",
    desk: { id: "studio", name: "studio", os: "linux", self: false },
    agent: { provider: provider(SECOND) },
  }),
  run("row-shell", {
    project: "scratch",
    status: "idle",
    floorSessionId: "pty-shell",
    profileSet: "native",
  }),
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

/** The agent a fixture run runs, as the work column names it: its provider, or Shell. */
const agentOfRun = (row: LiveFindAgent): string => row.agent?.provider.id ?? SHELL_AGENT;

/** WL-1 — the work column's agents over the fixture's runs, in the order each first runs. */
function fixtureAgents(): LiveAgentChoice[] {
  return [...new Set(LIVE_FIXTURE_RUNS.map(agentOfRun))].map((id) => {
    const runs = LIVE_FIXTURE_RUNS.filter((row) => agentOfRun(row) === id);
    return {
      id,
      label: runs[0]?.agent?.provider.label ?? SHELL_LABEL,
      shell: id === SHELL_AGENT,
      waiting: runs.some((row) => row.status === "blocked"),
      sessions: runs.length,
    };
  });
}

export const LIVE_FIXTURE_FILTERS: LiveFilters = {
  desks: [
    {
      id: "this-mac",
      name: "MacBook Pro",
      os: "macos",
      here: true,
      note: "2 agents",
      quiet: false,
      agents: 2,
      sessions: 3,
    },
    {
      id: "studio",
      name: "studio",
      os: "linux",
      here: false,
      note: "1 agent",
      quiet: false,
      agents: 1,
      sessions: 1,
    },
  ],
  desk: null,
  profiles: [
    { id: "native", label: "This Mac", kind: "native", isDefault: true, sessions: 2 },
    { id: "work", label: "Work", kind: "managed", glyph: "briefcase", blocked: true, sessions: 1 },
  ],
  profile: null,
  // WL-1 — the work column's groups: each run's folder, then its agent, a bare shell as Shell
  projects: LIVE_FIXTURE_RUNS.map((row, seq) => ({
    id: row.project,
    label: row.project,
    seq,
    waiting: row.status === "blocked",
    sessions: 1,
  })),
  project: null,
  agents: fixtureAgents(),
  agent: null,
  sessions: 4,
};

/** SE-D1/SE-D2 — both of Godview's filters on: this Mac, under Work. */
export const LIVE_FIXTURE_FILTERS_FILTERED: LiveFilters = {
  ...LIVE_FIXTURE_FILTERS,
  desk: "this-mac",
  profile: "work",
};

/** UM-D28 — Godview's lens on Work, which Everything looks through. */
export const LIVE_FIXTURE_FILTERS_WORK: LiveFilters = {
  ...LIVE_FIXTURE_FILTERS,
  profile: "work",
};

/** TS-4 (TS-D7) — this Mac not connected: the desktop filter holds This Mac
 * alone, and ends on the ghost row that offers the rest. */
export const LIVE_FIXTURE_FILTERS_UNCONNECTED: LiveFilters = {
  ...LIVE_FIXTURE_FILTERS,
  desks: LIVE_FIXTURE_FILTERS.desks.filter((desk) => desk.here),
  connect: true,
};

/** Godview's door over the fixture, its filters the caller's to hold: the
 * runs of the desktops it offers (not connected, this Mac's alone), under the
 * chosen profile (a peer's run says none, so the lens is this Mac's own). */
export function peekLiveFixtureDoor(
  filters: LiveFilters,
  onFilters: (next: LiveFilters) => void,
): GodviewFindDoor {
  const rows = LIVE_FIXTURE_RUNS.filter(
    (row) =>
      (filters.desk === null || row.desk.id === filters.desk) &&
      (filters.profile === null || row.profileSet === filters.profile) &&
      (filters.connect !== true || row.desk.self) &&
      (filters.project === null || row.project === filters.project) &&
      (filters.agent === null || agentOfRun(row) === filters.agent),
  );
  return {
    rows: () => rows,
    subscribeRows: () => () => undefined,
    transcripts: HISTORY,
    select: () => undefined,
    filters,
    setDesk: (desk) => onFilters({ ...filters, desk }),
    setProfile: (profile) => onFilters({ ...filters, profile }),
    // the catalog's filters offer no plan: a plan is chosen on its meter
    setPlan: () => undefined,
    setProject: (project) => onFilters({ ...filters, project }),
    setAgent: (agent) => onFilters({ ...filters, agent }),
    holdKeys: () => () => undefined,
    viewHoldsKeys: () => false,
  };
}

/** The fixture's clock. */
export const LIVE_FIXTURE_NOW = NOW;
