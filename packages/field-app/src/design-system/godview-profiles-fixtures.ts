import type { AccountUsagePort, HistoryPort } from "@vibecook/puppeteer-views";
import type { AgentPersona, AgentProfileSet, AgentSessionSummary } from "@vibefield/contracts";
import type { MonitorDoor } from "../godview/monitor/remote-door";

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
  return ROWS.map((spec) => {
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
): AgentPersona {
  return { profileId, provider, label: provider, kind, createdAt: AT };
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

const NO_HISTORY: HistoryPort = {
  status: async () => ({ reachable: false, detail: "catalog", checkedAt: AT }),
  facts: async () => [],
  search: async () => ({
    status: { reachable: false, detail: "catalog", checkedAt: AT },
    answered: false,
    hits: [],
    clipped: false,
  }),
};

const NO_USAGE: AccountUsagePort = {
  snapshot: async () => ({ refreshedAt: AT, entries: [] }),
  subscribe: () => () => undefined,
};

/** A door with the fold and the profiles in it, and no deck: every verb that
 * would need a pane says there is none, as the live door says it. */
export function profileTabsDoor(): MonitorDoor {
  const rows = profileTabRows(new Date().toISOString());
  return {
    listHosts: async () => [],
    attach: async () => ({ state: "no-pane" }),
    observe: ({ onFrame }) => {
      onFrame(rows);
      return () => undefined;
    },
    createTerminal: async () => ({ state: "no-pane" }),
    mountLocal: async () => ({ state: "no-pane" }),
    history: NO_HISTORY,
    usage: NO_USAGE,
    profiles: {
      subscribe: (listener) => {
        listener(PROFILE_TAB_SETS);
        return () => undefined;
      },
    },
  };
}
