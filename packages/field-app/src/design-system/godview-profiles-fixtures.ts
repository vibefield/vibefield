import type { SessionSummary } from "@vibecook/ghosttea-protocol";
import {
  AGENT_CATALOG,
  type AgentPersona,
  type AgentProfileSet,
  type AgentSessionSummary,
} from "@vibefield/contracts";
import type { AccountUsagePort, HistoryPort } from "@vibefield/puppeteer-views";
import type { MonitorDoor } from "../godview/monitor/remote-door";
import type { MonitorPaneFacts } from "../godview/monitor/useMonitorAgents";
import { type CatalogDesktop, catalogModelBoard } from "./godview-model-fixture";

/** This desktop, as the catalog's roster names it (`godview-mesh-fixtures.ts`). */
export const THIS_MAC: CatalogDesktop = { id: "this-mac", name: "MacBook Pro", platform: "darwin" };

// AR-S5 — the catalog's Godview with its profile tabs, on a fixture door: the
// design record's pass-15 stage as fieldd's fold would send it (Work:
// refactor-auth working, billing-api blocked; Personal, the default:
// vibe-field working, swarm-lab and rosetta idle; This Mac: dotfiles idle,
// named by no profile at all, the fallback's case; Client demo: nothing yet,
// the empty tab's case) and the four profiles as the profiles feed would.
// Examples, not anyone's sessions; nothing spawns.

const AT = "2026-09-24T09:41:00.000Z";

interface RowSpec {
  run: string;
  kind: string;
  label: string;
  project: string;
  status: "working" | "blocked" | "idle";
  model: string;
  profileSet?: string;
}

const ROWS: readonly RowSpec[] = [
  {
    run: "run-refactor-auth",
    kind: "claude",
    label: "Claude Code",
    project: "refactor-auth",
    status: "working",
    model: "opus · high",
    profileSet: "work",
  },
  {
    run: "run-billing-api",
    kind: "codex",
    label: "Codex",
    project: "billing-api",
    status: "blocked",
    model: "gpt-5 · med",
    profileSet: "work",
  },
  {
    run: "run-vibe-field",
    kind: "claude",
    label: "Claude Code",
    project: "vibe-field",
    status: "working",
    model: "opus · max",
    profileSet: "personal",
  },
  {
    run: "run-swarm-lab",
    kind: "grok",
    label: "Grok",
    project: "swarm-lab",
    status: "idle",
    model: "grok-4",
    profileSet: "personal",
  },
  {
    run: "run-rosetta",
    kind: "claude",
    label: "Claude Code",
    project: "rosetta",
    status: "idle",
    model: "sonnet · low",
    profileSet: "personal",
  },
  {
    run: "run-dotfiles",
    kind: "opencode",
    label: "OpenCode",
    project: "dotfiles",
    status: "idle",
    model: "claude",
  },
];

/** The fold's rows, stamped with the moment the catalog asked, so none reads as stale. */
export function profileTabRows(nowIso: string): AgentSessionSummary[] {
  return fixtureRows(ROWS, nowIso);
}

function fixtureRows(specs: readonly RowSpec[], nowIso: string): AgentSessionSummary[] {
  return specs.map((spec) => {
    const cwd = `/Users/you/Projects/${spec.project}`;
    return {
      sessionId: `${spec.run}-native`,
      sessionIdBasis: "observed",
      kind: spec.kind,
      label: spec.label,
      device: "this-mac",
      tier: "managed",
      runtimeRunId: spec.run,
      runtimeEpoch: 1,
      ...(spec.profileSet !== undefined ? { profileSet: spec.profileSet } : {}),
      terminal: { hosted: "none" },
      workspace: { mode: "direct", root: cwd, sourcePath: cwd },
      monitor: {
        schemaVersion: 3,
        runtimeEpoch: 1,
        revision: 1,
        runtimeRunId: spec.run,
        status: spec.status,
        statusSince: nowIso,
        blockers:
          spec.status === "blocked"
            ? [
                {
                  id: "blocker-1",
                  kind: "permission",
                  since: nowIso,
                  permission: { requestId: "req-1", tool: "Bash" },
                },
              ]
            : [],
        model: { id: spec.model, displayName: spec.model },
        environment: { cwd, worktrees: [] },
        session: { nativeSessionId: `${spec.run}-native` },
        freshness: { lastEvidenceAt: nowIso, level: "native-hooks" },
        alive: true,
      },
      status: spec.status,
      observationLevel: "native-hooks",
      createdAt: AT,
      stateChangedAt: nowIso,
      continuation: { persisted: true, resumable: false },
    };
  });
}

function persona(
  profileId: string,
  provider: string,
  kind: AgentPersona["kind"] = "managed",
  loggedIn?: boolean,
): AgentPersona {
  return {
    profileId,
    provider,
    label: provider,
    kind,
    createdAt: AT,
    ...(loggedIn === undefined ? {} : { identity: { loggedIn, verifiedAt: AT } }),
  };
}

export const PROFILE_TAB_SETS: readonly AgentProfileSet[] = [
  {
    id: "native",
    kind: "native",
    label: "This Mac",
    default: false,
    createdAt: AT,
    personas: [persona("opencode:native-default", "opencode", "native-default")],
  },
  {
    id: "personal",
    kind: "managed",
    label: "Personal",
    glyph: "house",
    default: true,
    createdAt: AT,
    personas: [persona("personal-claude", "claude"), persona("personal-grok", "grok")],
  },
  {
    id: "work",
    kind: "managed",
    label: "Work",
    glyph: "briefcase",
    default: false,
    createdAt: AT,
    personas: [persona("work-claude", "claude"), persona("work-codex", "codex")],
  },
  {
    id: "client-demo",
    kind: "managed",
    label: "Client demo",
    glyph: "flask",
    default: false,
    createdAt: AT,
    personas: [persona("demo-claude", "claude")],
  },
];

export const NO_HISTORY: HistoryPort = {
  status: async () => ({ reachable: false, detail: "catalog", checkedAt: AT }),
  facts: async () => [],
  search: async () => ({
    status: { reachable: false, detail: "catalog", checkedAt: AT },
    answered: false,
    hits: [],
    clipped: false,
  }),
};

export const NO_USAGE: AccountUsagePort = {
  snapshot: async () => ({ refreshedAt: AT, entries: [] }),
  subscribe: () => () => undefined,
};

/** A door with the fold, the profiles and the model board in it, and no deck:
 * every verb that would need a pane says there is none, as the live door says
 * it. MV-3b: the monitor draws the board (`godview-model-fixture.ts`); the fold
 * stays for the marker and the find sheet, as in the product. */
export function profileTabsDoor(): MonitorDoor {
  const rows = profileTabRows(new Date().toISOString());
  const board = catalogModelBoard({ device: THIS_MAC, rows, profiles: PROFILE_TAB_SETS });
  return {
    model: board.port,
    attach: async () => ({ state: "no-pane" }),
    createTerminal: async () => ({ state: "no-pane" }),
    mountLocal: async () => ({ state: "no-pane" }),
    transcripts: NO_HISTORY,
    usage: NO_USAGE,
    profiles: {
      subscribe: (listener) => {
        listener(PROFILE_TAB_SETS);
        return () => undefined;
      },
    },
  };
}

// ---- SB-3 — the spawn bloom's fixture --------------------------------------------
//
// This desktop with three Agent Profiles, as the brief's catalog entry asks:
// This Mac (one agent's own folder signed in), Work — the default, with one of
// its agents blocked (the bud's orange dot) — and Demo, holding no sign-in at all.
// Its create answers `mounted` under the profile asked for, so a hold in Studio
// blooms and commits; the catalog keeps the births as a deck's pane facts, so
// the new body arrives where it was let go. The agents are the catalog's own
// rows (the first two it offers profile sign-ins for), so no agent id is written
// here (R23b). Examples, not anyone's; nothing spawns.

const PROFILED_AGENTS = AGENT_CATALOG.filter((row) => row.offers.personas);
const FIRST_AGENT = PROFILED_AGENTS[0] ?? AGENT_CATALOG[0];
const SECOND_AGENT = PROFILED_AGENTS[1] ?? FIRST_AGENT;

const SPAWN_ROWS: readonly RowSpec[] = [
  {
    run: "run-billing-api",
    kind: SECOND_AGENT.id,
    label: SECOND_AGENT.label,
    project: "billing-api",
    status: "blocked",
    model: "deep · med",
    profileSet: "work",
  },
  {
    run: "run-refactor-auth",
    kind: FIRST_AGENT.id,
    label: FIRST_AGENT.label,
    project: "refactor-auth",
    status: "working",
    model: "deep · high",
    profileSet: "work",
  },
  {
    run: "run-dotfiles",
    kind: FIRST_AGENT.id,
    label: FIRST_AGENT.label,
    project: "dotfiles",
    status: "idle",
    model: "light · low",
    profileSet: "native",
  },
];

export const SPAWN_BLOOM_SETS: readonly AgentProfileSet[] = [
  {
    id: "native",
    kind: "native",
    label: "This Mac",
    default: false,
    createdAt: AT,
    personas: [persona(`${FIRST_AGENT.id}:native-default`, FIRST_AGENT.id, "native-default", true)],
  },
  {
    id: "work",
    kind: "managed",
    label: "Work",
    glyph: "briefcase",
    default: true,
    createdAt: AT,
    personas: [
      persona(`work-${FIRST_AGENT.id}`, FIRST_AGENT.id),
      persona(`work-${SECOND_AGENT.id}`, SECOND_AGENT.id),
    ],
  },
  {
    id: "demo",
    kind: "managed",
    label: "Demo",
    glyph: "flask",
    default: false,
    createdAt: AT,
    personas: [],
  },
];

/** One terminal the catalog's create answered, and the profile it was born under. */
export interface CatalogBirth {
  sessionId: string;
  profileSet?: string;
}

/** A born terminal's floor summary, as the deck would hold its pane's session. */
function birthSession(birth: CatalogBirth, index: number): SessionSummary {
  return {
    id: birth.sessionId,
    exited: false,
    createdAtMs: Date.parse(AT) + index,
    cwd: "/Users/you/Projects/scratch",
    title: "zsh",
    activity: { kind: "shell-idle" },
  } as unknown as SessionSummary;
}

/** The spawn bloom's door: the fold, the three profiles and the model board,
 * and a create that answers `mounted` — telling `onBorn`, which keeps the pane
 * facts, and listing the shell on the board's floor under its profile (SB-3),
 * which is where the new body's row comes from. */
export function spawnBloomDoor(onBorn: (birth: CatalogBirth) => void): MonitorDoor {
  const rows = fixtureRows(SPAWN_ROWS, new Date().toISOString());
  const board = catalogModelBoard({ device: THIS_MAC, rows, profiles: SPAWN_BLOOM_SETS });
  let births = 0;
  return {
    model: board.port,
    attach: async () => ({ state: "no-pane" }),
    createTerminal: async (request) => {
      births += 1;
      const sessionId = `catalog-terminal-${births}`;
      const profileSet = request?.profileSet;
      const birth: CatalogBirth = {
        sessionId,
        ...(profileSet !== undefined ? { profileSet } : {}),
      };
      board.born(birthSession(birth, births - 1), profileSet);
      onBorn(birth);
      return { state: "mounted", sessionId, ...(profileSet !== undefined ? { profileSet } : {}) };
    },
    mountLocal: async () => ({ state: "no-pane" }),
    transcripts: NO_HISTORY,
    usage: NO_USAGE,
    profiles: {
      subscribe: (listener) => {
        listener(SPAWN_BLOOM_SETS);
        return () => undefined;
      },
    },
  };
}

/** The births as a deck would publish them: each in a pane, the last one
 * active, and the pool's record of the profile each was born under. */
export function catalogBirthPanes(births: readonly CatalogBirth[]): MonitorPaneFacts {
  const sessions = births.map((birth, index) => birthSession(birth, index));
  const last = births.at(-1);
  return {
    sessionIds: births.map((birth) => birth.sessionId),
    ...(last !== undefined ? { activeSessionId: last.sessionId } : {}),
    sessions,
    profileSets: new Map(
      births.flatMap((birth) =>
        birth.profileSet === undefined ? [] : [[birth.sessionId, birth.profileSet] as const],
      ),
    ),
  };
}
