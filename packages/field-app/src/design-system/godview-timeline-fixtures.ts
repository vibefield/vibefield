import {
  AGENT_CATALOG,
  type AgentRunHistory,
  type AgentSessionSummary,
} from "@vibefield/contracts";
import type { MonitorDoor } from "../godview/monitor/remote-door";
import { aloneOnTheMesh, NO_HISTORY, NO_USAGE } from "./godview-profiles-fixtures";

// TL — the catalog's timeline on a fixture door: an afternoon as fieldd's fold
// and its status ledger (`agent.history`) would send it, so the specimen drives
// the shipping path whole — door, the stage's ledger, the view. Six runs over
// five projects, born between four hours and forty minutes ago, each with a
// day of working, waiting on you and resting; one asks a question now, one
// ended forty minutes ago. A seeded afternoon, so the catalog draws the same
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
  /** what it is doing now; the past is dealt from the seed */
  now: "working" | "blocked" | "idle";
  endedAgoMin?: number;
  did: readonly string[];
}

const RUNS: readonly RunSpec[] = [
  {
    run: "run-vibe-field",
    agent: 0,
    project: "vibe-field",
    model: "opus · high",
    bornAgoMin: 238,
    now: "working",
    did: ["Edit godview/GodviewMonitor.tsx", "Run pnpm verify", "Read DESIGN.md §8"],
  },
  {
    run: "run-puppeteer",
    agent: 1,
    project: "puppeteer",
    model: "gpt-5 · medium",
    bornAgoMin: 191,
    now: "blocked",
    did: ["Edit views/timeline/wake.ts", "Run pnpm test", "Read monitor/types.ts"],
  },
  {
    run: "run-swarm-lab",
    agent: 0,
    project: "swarm-lab",
    model: "sonnet",
    bornAgoMin: 150,
    now: "idle",
    did: ["Edit physics/world.ts", "Run cargo test"],
  },
  {
    run: "run-rosetta",
    agent: 2,
    project: "rosetta",
    model: "fast-4",
    bornAgoMin: 122,
    now: "working",
    did: ["Read src/index/walk.rs", "Run cargo clippy"],
  },
  {
    run: "run-changelog",
    agent: 0,
    project: "changelog",
    model: "haiku",
    bornAgoMin: 96,
    now: "idle",
    endedAgoMin: 40,
    did: ["Edit CHANGELOG.md"],
  },
  {
    run: "run-billing-api",
    agent: 1,
    project: "billing-api",
    model: "gpt-5 · high",
    bornAgoMin: 41,
    now: "working",
    did: ["Edit src/invoices.ts", "Run pnpm test invoices"],
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

type State = "working" | "blocked" | "idle";
const LENGTH_MIN: Record<State, [number, number]> = {
  working: [4, 26],
  blocked: [1, 7],
  idle: [1, 14],
};

/** A run's changes, oldest first, ending in its current state. */
function afternoon(spec: RunSpec, nowMs: number, rnd: () => number): AgentRunHistory {
  const born = nowMs - spec.bornAgoMin * MIN;
  const end = spec.endedAgoMin === undefined ? nowMs : nowMs - spec.endedAgoMin * MIN;
  const changes: AgentRunHistory["changes"] = [{ status: "unknown", at: iso(born) }];
  let at = born + 20_000;
  let state: State = "working";
  let line = 0;
  // the current stretch is the last 1–9 minutes before the end, in `spec.now`
  const lastFrom = Math.round(end - (1 + rnd() * 8) * MIN);
  while (at < lastFrom) {
    changes.push(change(state, at, spec, line++));
    const [lo, hi] = LENGTH_MIN[state];
    at = Math.min(lastFrom, at + (lo + rnd() * (hi - lo)) * MIN);
    state = state === "working" ? (rnd() < 0.4 ? "blocked" : "idle") : "working";
  }
  const lastState = changes[changes.length - 1]?.status;
  if (lastState === spec.now) changes.pop();
  changes.push(change(spec.now, lastFrom, spec, line));
  return {
    runtimeRunId: spec.run,
    recordedFrom: iso(born),
    changes,
    ...(spec.endedAgoMin === undefined ? {} : { exitedAt: iso(end) }),
  };
}

function change(state: State, atMs: number, spec: RunSpec, line: number) {
  if (state === "working")
    return { status: state, at: iso(atMs), did: spec.did[line % spec.did.length] };
  if (state === "blocked") {
    return line % 2
      ? {
          status: state,
          at: iso(atMs),
          blocker: { kind: "permission", detail: "Bash: pnpm install" },
        }
      : {
          status: state,
          at: iso(atMs),
          blocker: { kind: "question", detail: "Keep the old export?" },
        };
  }
  return { status: state, at: iso(atMs) };
}

const iso = (ms: number): string => new Date(ms).toISOString();

function foldRow(spec: RunSpec, history: AgentRunHistory): AgentSessionSummary {
  const cwd = `/Users/you/Projects/${spec.project}`;
  const last = history.changes[history.changes.length - 1];
  const since = last?.at ?? history.recordedFrom;
  const alive = history.exitedAt === undefined;
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
      ...(spec.now === "working"
        ? { activity: { kind: "tool", line: last?.did ?? spec.did[0] ?? "", since } }
        : {}),
      model: { id: spec.model, displayName: spec.model },
      environment: { cwd, worktrees: [] },
      session: { nativeSessionId: `${spec.run}-native` },
      freshness: { lastEvidenceAt: since, level: "native-hooks" },
      alive,
    },
    status: spec.now,
    observationLevel: "native-hooks",
    createdAt: history.recordedFrom,
    stateChangedAt: history.exitedAt ?? since,
    continuation: { persisted: true, resumable: false, ...(alive ? {} : { exited: true }) },
  };
}

/** The afternoon, as of `nowMs`: the fold's rows and the ledger's runs. */
export function timelineAfternoon(nowMs: number): {
  rows: AgentSessionSummary[];
  runs: AgentRunHistory[];
} {
  const rnd = seeded(20261002);
  const runs = RUNS.map((spec) => afternoon(spec, nowMs, rnd));
  return { rows: RUNS.map((spec, i) => foldRow(spec, runs[i] as AgentRunHistory)), runs };
}

/** A door with the fold and its status ledger in it, and no deck. */
export function timelineDoor(): MonitorDoor {
  const { rows, runs } = timelineAfternoon(Date.now());
  return {
    observeMesh: aloneOnTheMesh,
    attach: async () => ({ state: "no-pane" }),
    observe: ({ onFrame }) => {
      onFrame(rows);
      return () => undefined;
    },
    createTerminal: async () => ({ state: "no-pane" }),
    mountLocal: async () => ({ state: "no-pane" }),
    history: NO_HISTORY,
    usage: NO_USAGE,
    statusHistory: { load: async () => runs },
  };
}
