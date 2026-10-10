import { AGENT_CATALOG, type AgentSessionSummary } from "@vibefield/contracts";
import type { MonitorDoor } from "../godview/monitor/remote-door";
import { catalogModelBoard } from "./godview-model-fixture";
import { NO_HISTORY, NO_USAGE, THIS_MAC } from "./godview-profiles-fixtures";

// TL — the catalog's timeline on a fixture door: an afternoon as fieldd's fold
// would send it, so the specimen drives the shipping path whole — door, the
// window's replica, the view. Runtime only (MV-6, MV-D13): no record of what a
// run did before rides the door, so each lane is drawn unrecorded from its
// birth to its current state, the way the view draws any live window. Five
// runs over five projects, born between four hours and forty minutes ago, each
// in its current state for the last few minutes: two working, one asks a
// question now, one rests. A seeded afternoon, so the catalog draws the same
// one every time. Examples, not anyone's sessions; nothing spawns.

const MIN = 60_000;

/** The catalog's own agents, in its order: a fixture names an agent by row, never by id (AR-L1, R23b). */
function agentOf(index: number): { id: string; label: string } {
  const row = AGENT_CATALOG[index % AGENT_CATALOG.length] ?? AGENT_CATALOG[0];
  return { id: row.id, label: row.label };
}

interface RunSpec {
  run: string;
  /** which of the catalog's agents runs it, by position (the ids are the catalog's, never spelled here) */
  agent: number;
  project: string;
  model: string;
  bornAgoMin: number;
  /** what it is doing now, since a moment dealt from the seed */
  now: "working" | "blocked" | "idle";
  /** what a working run's activity line says */
  did: string;
}

const RUNS: readonly RunSpec[] = [
  {
    run: "run-vibe-field",
    agent: 0,
    project: "vibe-field",
    model: "opus · high",
    bornAgoMin: 238,
    now: "working",
    did: "Edit godview/GodviewMonitor.tsx",
  },
  {
    run: "run-puppeteer",
    agent: 1,
    project: "puppeteer",
    model: "gpt-5 · medium",
    bornAgoMin: 191,
    now: "blocked",
    did: "Edit views/timeline/wake.ts",
  },
  {
    run: "run-swarm-lab",
    agent: 0,
    project: "swarm-lab",
    model: "sonnet",
    bornAgoMin: 150,
    now: "idle",
    did: "Edit physics/world.ts",
  },
  {
    run: "run-rosetta",
    agent: 2,
    project: "rosetta",
    model: "fast-4",
    bornAgoMin: 122,
    now: "working",
    did: "Read src/index/walk.rs",
  },
  {
    run: "run-billing-api",
    agent: 1,
    project: "billing-api",
    model: "gpt-5 · high",
    bornAgoMin: 41,
    now: "working",
    did: "Edit src/invoices.ts",
  },
];

/** mulberry32: the same afternoon every time the catalog opens. */
function seeded(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** When a run's current state began: the last 1–9 minutes, dealt from the seed. */
function stateSince(nowMs: number, rnd: () => number): number {
  return Math.round(nowMs - (1 + rnd() * 8) * MIN);
}

const iso = (ms: number): string => new Date(ms).toISOString();

function foldRow(spec: RunSpec, nowMs: number, sinceMs: number): AgentSessionSummary {
  const cwd = `/Users/you/Projects/${spec.project}`;
  const born = iso(nowMs - spec.bornAgoMin * MIN);
  const since = iso(sinceMs);
  const agent = agentOf(spec.agent);
  return {
    sessionId: `${spec.run}-native`,
    sessionIdBasis: "observed",
    kind: agent.id,
    label: agent.label,
    device: "this-mac",
    tier: "managed",
    runtimeRunId: spec.run,
    runtimeEpoch: 1,
    terminal: { hosted: "none" },
    workspace: { mode: "direct", root: cwd, sourcePath: cwd },
    monitor: {
      schemaVersion: 3,
      runtimeEpoch: 1,
      revision: 1,
      runtimeRunId: spec.run,
      status: spec.now,
      statusSince: since,
      blockers:
        spec.now === "blocked"
          ? [
              {
                id: "blocker-1",
                kind: "question",
                since,
                questions: [{ prompt: "Keep the old export, or remove it with this change?" }],
              },
            ]
          : [],
      ...(spec.now === "working" ? { activity: { kind: "tool", line: spec.did, since } } : {}),
      model: { id: spec.model, displayName: spec.model },
      environment: { cwd, worktrees: [] },
      session: { nativeSessionId: `${spec.run}-native` },
      freshness: { lastEvidenceAt: since, level: "native-hooks" },
      alive: true,
    },
    status: spec.now,
    observationLevel: "native-hooks",
    createdAt: born,
    stateChangedAt: since,
    continuation: { persisted: true, resumable: false },
  };
}

/** The afternoon, as of `nowMs`: the fold's rows, each in its current state. */
export function timelineAfternoon(nowMs: number): { rows: AgentSessionSummary[] } {
  const rnd = seeded(20261002);
  return { rows: RUNS.map((spec) => foldRow(spec, nowMs, stateSince(nowMs, rnd))) };
}

/** A door with the fold and the model board in it, and no deck. */
export function timelineDoor(): MonitorDoor {
  const { rows } = timelineAfternoon(Date.now());
  const board = catalogModelBoard({ device: THIS_MAC, rows });
  return {
    model: board.port,
    attach: async () => ({ state: "no-pane" }),
    createTerminal: async () => ({ state: "no-pane" }),
    mountLocal: async () => ({ state: "no-pane" }),
    transcripts: NO_HISTORY,
    usage: NO_USAGE,
  };
}
