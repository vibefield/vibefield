import type { SessionSummary } from "@vibecook/ghosttea-protocol";
import {
  AGENT_CATALOG,
  AGENT_FIELD,
  type AgentDeskRow,
  type AgentMeshFrame,
  type AgentMeshOpen,
  type AgentSessionSummary,
  type AgentStatus,
  type DeviceInfo,
} from "@vibefield/contracts";
import type { MonitorFloorRecord } from "../agents";
import type { RecordedFrame } from "./frame-recorder";

// SYNTHETIC CORPORA (MV-0, `design-mv.md` §5: "generates n = 10, 20, 60 agents
// at fixed change rates").
//
// A corpus is what the frame recorder would have written had a daemon run a
// board of `n` agents for `durationMs`: fold frames at the fold's own tick
// (`AGENT_FIELD.FULL_TICK_MS`, whole boards, emitted only when something moved —
// which under working agents is every tick, because every tick a working
// agent's usage ticks and its mirror revision with it), and the mesh board at
// the desk's floor (`DESK_MIN_INTERVAL_MS`): one open with THIS desktop and ONE
// PEER, then per-device deltas of the rows whose projected JSON changed, with
// fieldd's own rule that a row's revision bumps only when its projection does.
//
// DETERMINISTIC. The same recipe produces the same bytes on every machine and in
// every realm — the Electron lab generates a corpus in the page from a recipe
// (no megabytes cross `executeJavaScript`), the oracle generates the same one
// in Node, and the differential (MV-3) can trust that both saw the same frames.
// A seeded PRNG decides what a working agent spends and who flips when; nothing
// reads a clock.
//
// WHAT MOVES, at the recipe's rates (defaults in `resolveRecipe`):
//   · usage ticks — every fold tick, every working agent: tokens, burn, cost, a
//     sample on its ring, `freshness.lastEvidenceAt`, the mirror's revision
//   · status flips — one agent working ⇄ idle every `statusFlipMs`
//   · replies — one working agent's `lastAssistantMessage` every `replyMs`
//   · waits — one agent takes a permission blocker every `waitMs` (status
//     `blocked`) and is released half a period later
//   · bare terminals — the deck's own panes with no agent (`panes`, read by the
//     oracle; in the Electron lab the deck's real panes stand for them)
//   · one peer desktop — `peerAgents` rows on `desk-peer`, the same machine
// and ONE MARKER: at `markerAtMs` the marker agent flips to `markerTo`, inside a
// QUIET window in which nothing else moves (no fold frame, no desk frame), so
// the first thing a view does after the mark is the mark — which is what makes
// change-to-pixel latency a measurement rather than a guess.
//
// Provider ids come from `AGENT_CATALOG` (wall R23b: no agent id is a literal
// in product code). Content is synthetic and says so.

export interface CorpusRecipe {
  /** managed agents on this desktop */
  n: number;
  durationMs: number;
  seed?: number;
  /** rows on the one peer desktop (default: a quarter of `n`, at least one) */
  peerAgents?: number;
  /** the deck's panes with no agent (default 2) */
  bareTerminals?: number;
  foldTickMs?: number;
  deskTickMs?: number;
  /** usage samples a working agent's ring keeps (puppeteer's can reach 256) */
  samplesRing?: number;
  statusFlipMs?: number;
  replyMs?: number;
  waitMs?: number;
  /** when the marker fires (default: halfway, on a fold tick) */
  markerAtMs?: number;
  /** which local agent (index) the marker flips (default 0) */
  markerAgent?: number;
  markerTo?: AgentStatus;
  /** the quiet window either side of the marker (default 300 ms) */
  markerQuietMs?: number;
  /** the wall clock at `t = 0` */
  baseWall?: number;
}

export type ResolvedCorpusRecipe = Required<CorpusRecipe>;

export const CORPUS_GENERATOR = "vibefield-godview-corpus";
export const CORPUS_VERSION = 1;
export const CORPUS_HERE = "desk-here";
export const CORPUS_PEER = "desk-peer";
export const CORPUS_MARK = "status-flip";
export const DEFAULT_BASE_WALL = Date.parse("2026-10-03T12:00:00.000Z");

export function resolveRecipe(recipe: CorpusRecipe): ResolvedCorpusRecipe {
  const n = Math.max(1, Math.floor(recipe.n));
  const foldTickMs = recipe.foldTickMs ?? AGENT_FIELD.FULL_TICK_MS;
  const durationMs = Math.max(foldTickMs, Math.floor(recipe.durationMs));
  const halfway = Math.floor(durationMs / 2 / foldTickMs) * foldTickMs;
  return {
    n,
    durationMs,
    seed: recipe.seed ?? 1,
    peerAgents: recipe.peerAgents ?? Math.max(1, Math.round(n / 4)),
    bareTerminals: recipe.bareTerminals ?? 2,
    foldTickMs,
    deskTickMs: recipe.deskTickMs ?? AGENT_FIELD.DESK_MIN_INTERVAL_MS,
    samplesRing: recipe.samplesRing ?? 64,
    statusFlipMs: recipe.statusFlipMs ?? 1_000,
    replyMs: recipe.replyMs ?? 1_500,
    waitMs: recipe.waitMs ?? 2_500,
    markerAtMs: recipe.markerAtMs ?? halfway,
    markerAgent: Math.min(n - 1, Math.max(0, recipe.markerAgent ?? 0)),
    markerTo: recipe.markerTo ?? "blocked",
    markerQuietMs: recipe.markerQuietMs ?? 300,
    baseWall: recipe.baseWall ?? DEFAULT_BASE_WALL,
  };
}

/** `n=10,duration=8000,seed=2,peers=3` — the lab's and the oracle's spelling. */
export function parseRecipe(text: string): CorpusRecipe {
  const fields = new Map<string, number>();
  for (const part of text.split(",")) {
    const [key, value] = part.split("=");
    if (key === undefined || value === undefined) continue;
    const number = Number(value.trim());
    if (Number.isFinite(number)) fields.set(key.trim(), number);
  }
  const n = fields.get("n");
  const duration = fields.get("duration") ?? fields.get("durationMs");
  if (n === undefined || duration === undefined) {
    throw new Error(`a corpus recipe names n and duration: ${JSON.stringify(text)}`);
  }
  const pick = (key: string): Record<string, number> => {
    const value = fields.get(key);
    return value === undefined ? {} : { [key]: value };
  };
  return {
    n,
    durationMs: duration,
    ...pick("seed"),
    ...(fields.has("peers") ? { peerAgents: fields.get("peers") as number } : pick("peerAgents")),
    ...pick("bareTerminals"),
    ...pick("samplesRing"),
    ...pick("statusFlipMs"),
    ...pick("replyMs"),
    ...pick("waitMs"),
    ...pick("markerAtMs"),
    ...pick("markerAgent"),
    ...pick("markerQuietMs"),
  };
}

/** `n10-8s-s1`: the file stem a corpus is kept under. */
export function recipeName(recipe: CorpusRecipe): string {
  const resolved = resolveRecipe(recipe);
  const seconds = resolved.durationMs / 1_000;
  const span = Number.isInteger(seconds) ? `${seconds}s` : `${resolved.durationMs}ms`;
  return `n${resolved.n}-${span}-s${resolved.seed}`;
}

export interface CorpusPanes {
  sessionIds: string[];
  activeSessionId?: string;
  sessions: SessionSummary[];
  floor: MonitorFloorRecord[];
}

export interface CorpusMeta {
  generator: typeof CORPUS_GENERATOR;
  version: typeof CORPUS_VERSION;
  recipe: ResolvedCorpusRecipe;
  here: string;
  peer: string;
  /** the marker's row, so a harness knows what to watch */
  marker: { runtimeRunId: string; from: AgentStatus; to: AgentStatus; atMs: number };
  counts: { fold: number; meshOpen: number; meshFrames: number; marks: number };
}

export interface Corpus {
  meta: CorpusMeta;
  roster: DeviceInfo[];
  panes: CorpusPanes;
  frames: RecordedFrame[];
}

// ── the PRNG ──────────────────────────────────────────────────────────────────

/** mulberry32: small, seedable, good enough to decide who spends what. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ── the agents ────────────────────────────────────────────────────────────────

interface Provider {
  id: string;
  label: string;
}

/** The catalog's offered agents, in its order; the corpus cycles through them. */
function providers(): Provider[] {
  const offered = AGENT_CATALOG.filter(
    (row) => row.status === "supported" || row.status === "preview",
  ).map((row) => ({ id: row.id, label: row.label }));
  const rows =
    offered.length > 0 ? offered : AGENT_CATALOG.map((row) => ({ id: row.id, label: row.label }));
  if (rows.length === 0) throw new Error("the agent catalog offers no agent to synthesize");
  return rows;
}

const PROJECTS = ["atlas", "beacon", "cinder", "drift", "ember", "fjord"] as const;
const BRANCHES = ["main", "feat/monitor-sdk", "fix/usage-ledger", null] as const;
const MODELS = [
  { id: "model-large", displayName: "Large" },
  { id: "model-fast", displayName: "Fast" },
] as const;
const TOOLS = ["Bash", "Edit", "Write", "WebFetch"] as const;
const REPLIES = [
  "Reading the seam before changing it.",
  "The projection rebuilds every object; keeping identity would cut the swarm's posts.",
  "Tests green locally; running the gate.",
  "The ledger allocates a new Map per frame — measuring before deciding.",
  "Waiting on the daemon's answer.",
] as const;

interface AgentState {
  index: number;
  device: string;
  runtimeRunId: string;
  sessionId: string;
  ptySessionId: string;
  provider: Provider;
  project: (typeof PROJECTS)[number];
  branch: (typeof BRANCHES)[number];
  model: (typeof MODELS)[number];
  createdAtMs: number;
  status: AgentStatus;
  statusSinceMs: number;
  stateChangedAtMs: number;
  lastActivityAtMs: number;
  revision: number;
  cumulativeTokens: number;
  inputTokens: number;
  outputTokens: number;
  burnRatePerMin: number;
  costUsd: number;
  samples: { at: string; cumulativeTokens: number }[];
  contextUsed: number;
  contextCapacity: number;
  lastEvidenceAtMs: number;
  reply: { text: string; atMs: number; seq: number } | null;
  blocker: { id: string; tool: string; sinceMs: number; untilMs: number } | null;
  /** the status to return to when a wait clears */
  resumeAs: AgentStatus;
  /** fieldd's per-row desk revision and the JSON it last sent */
  deskRevision: number;
  deskSent: string | null;
}

function iso(ms: number): string {
  return new Date(ms).toISOString();
}

function newAgent(
  device: string,
  prefix: string,
  index: number,
  random: () => number,
  provider: Provider,
  baseWall: number,
): AgentState {
  const runtimeRunId = `${prefix}-${index + 1}`;
  const roll = random();
  const status: AgentStatus = roll < 0.6 ? "working" : roll < 0.9 ? "idle" : "blocked";
  const createdAtMs = baseWall - Math.floor(random() * 3_600_000) - 60_000;
  const cumulativeTokens = Math.floor(random() * 400_000);
  const contextCapacity = 200_000;
  const contextUsed = Math.floor(random() * 0.8 * contextCapacity);
  const agent: AgentState = {
    index,
    device,
    runtimeRunId,
    sessionId: `${runtimeRunId}-native`,
    ptySessionId: `${prefix}-pty-${index + 1}`,
    provider,
    project: PROJECTS[index % PROJECTS.length] as (typeof PROJECTS)[number],
    branch: BRANCHES[index % BRANCHES.length] as (typeof BRANCHES)[number],
    model: MODELS[index % MODELS.length] as (typeof MODELS)[number],
    createdAtMs,
    status,
    statusSinceMs: baseWall - Math.floor(random() * 120_000),
    stateChangedAtMs: baseWall - Math.floor(random() * 120_000),
    lastActivityAtMs: baseWall - Math.floor(random() * 30_000),
    revision: 1 + Math.floor(random() * 5_000),
    cumulativeTokens,
    inputTokens: Math.floor(cumulativeTokens * 0.8),
    outputTokens: Math.floor(cumulativeTokens * 0.2),
    burnRatePerMin: 0,
    costUsd: cumulativeTokens * 0.000_004,
    samples: [],
    contextUsed,
    contextCapacity,
    lastEvidenceAtMs: baseWall - Math.floor(random() * 5_000),
    reply: {
      text: REPLIES[index % REPLIES.length] as string,
      atMs: baseWall - Math.floor(random() * 60_000),
      seq: 0,
    },
    blocker: null,
    resumeAs: status === "blocked" ? "working" : status,
    deskRevision: 0,
    deskSent: null,
  };
  if (status === "blocked") {
    agent.blocker = {
      id: `${runtimeRunId}-blocker-0`,
      tool: TOOLS[index % TOOLS.length] as string,
      sinceMs: agent.statusSinceMs,
      untilMs: Number.POSITIVE_INFINITY,
    };
  }
  return agent;
}

/** One working tick: what a run spends in 16 ms, and the row's clocks with it. */
function tickUsage(agent: AgentState, nowMs: number, random: () => number, ring: number): void {
  const spent = 20 + Math.floor(random() * 180);
  agent.cumulativeTokens += spent;
  agent.inputTokens += Math.floor(spent * 0.8);
  agent.outputTokens += spent - Math.floor(spent * 0.8);
  agent.costUsd += spent * 0.000_004;
  agent.burnRatePerMin = Math.round(spent * (60_000 / AGENT_FIELD.FULL_TICK_MS));
  agent.contextUsed = Math.min(agent.contextCapacity, agent.contextUsed + Math.floor(spent / 4));
  agent.samples.push({ at: iso(nowMs), cumulativeTokens: agent.cumulativeTokens });
  if (agent.samples.length > ring) agent.samples.splice(0, agent.samples.length - ring);
  agent.lastEvidenceAtMs = nowMs;
  agent.lastActivityAtMs = nowMs;
  agent.revision += 1;
}

function setStatus(agent: AgentState, status: AgentStatus, nowMs: number): void {
  if (agent.status === status) return;
  agent.status = status;
  agent.statusSinceMs = nowMs;
  agent.stateChangedAtMs = nowMs;
  agent.lastActivityAtMs = nowMs;
  agent.revision += 1;
}

function block(agent: AgentState, nowMs: number, untilMs: number, tool: string): void {
  agent.resumeAs = agent.status === "blocked" ? agent.resumeAs : agent.status;
  agent.blocker = {
    id: `${agent.runtimeRunId}-blocker-${agent.revision}`,
    tool,
    sinceMs: nowMs,
    untilMs,
  };
  setStatus(agent, "blocked", nowMs);
}

function release(agent: AgentState, nowMs: number): void {
  agent.blocker = null;
  setStatus(agent, agent.resumeAs === "blocked" ? "working" : agent.resumeAs, nowMs);
}

// ── the rows ──────────────────────────────────────────────────────────────────

/** The fold's row for an agent: `AgentSessionSummary` with puppeteer's mirror
 * under `monitor`, the shape `managed-session-fixture.ts` builds for tests. */
export function foldRowOf(agent: AgentState): AgentSessionSummary {
  const cwd = `/work/${agent.project}`;
  const blockers =
    agent.blocker === null
      ? []
      : [
          {
            id: agent.blocker.id,
            kind: "permission",
            since: iso(agent.blocker.sinceMs),
            permission: { requestId: `${agent.blocker.id}-req`, tool: agent.blocker.tool },
          },
        ];
  return {
    sessionId: agent.sessionId,
    sessionIdBasis: "observed",
    kind: agent.provider.id,
    label: agent.provider.label,
    device: agent.device,
    tier: "managed",
    runtimeRunId: agent.runtimeRunId,
    runtimeEpoch: 1,
    terminal: { hosted: "local", runtimeSessionId: agent.ptySessionId, workloadClass: "agent" },
    workspace: {
      mode: "direct",
      root: cwd,
      sourcePath: cwd,
      ...(agent.branch !== null ? { branch: agent.branch } : {}),
    },
    monitor: {
      schemaVersion: 3,
      runtimeEpoch: 1,
      revision: agent.revision,
      runtimeRunId: agent.runtimeRunId,
      status: agent.status,
      statusSince: iso(agent.statusSinceMs),
      blockers,
      ...(agent.reply !== null
        ? {
            lastAssistantMessage: {
              text: agent.reply.text,
              at: iso(agent.reply.atMs),
              final: true,
            },
          }
        : {}),
      ...(agent.status === "working"
        ? {
            activity: {
              kind: "tool",
              line: `${TOOLS[agent.revision % TOOLS.length]} ${agent.project}`,
              since: iso(agent.statusSinceMs),
            },
          }
        : {}),
      usage: {
        cumulativeTokens: agent.cumulativeTokens,
        inputTokens: agent.inputTokens,
        outputTokens: agent.outputTokens,
        burnRatePerMin: agent.burnRatePerMin,
        costUsd: Math.round(agent.costUsd * 1_000_000) / 1_000_000,
        costCoverage: "complete",
        samples: agent.samples,
      },
      context: {
        usedTokens: agent.contextUsed,
        capacityTokens: agent.contextCapacity,
        usedPercent: Math.round((agent.contextUsed / agent.contextCapacity) * 10_000) / 100,
      },
      model: { id: agent.model.id, displayName: agent.model.displayName },
      environment: {
        cwd,
        git: agent.branch === null ? null : { branch: agent.branch },
        worktrees: [],
      },
      session: { nativeSessionId: agent.sessionId, startedAt: iso(agent.createdAtMs) },
      freshness: { lastEvidenceAt: iso(agent.lastEvidenceAtMs), level: "native-hooks" },
      alive: true,
    },
    status: agent.status,
    observationLevel: "native-hooks",
    createdAt: iso(agent.createdAtMs),
    stateChangedAt: iso(agent.stateChangedAtMs),
    lastActivityAt: iso(agent.lastActivityAtMs),
    continuation: { persisted: true, resumable: false },
  };
}

function bound(text: string, chars: number): string {
  return text.length <= chars ? text : text.slice(0, chars);
}

/**
 * fieldd's DESK projection of a fold row (`agent-field.ts` `projectDeskRow`),
 * re-stated here because the renderer may not import fieldd. The corpus test
 * holds the two equal field by field, so a drift in either is a red test and
 * not a quietly different peer.
 */
export function deskRowOf(summary: AgentSessionSummary, revision: number): AgentDeskRow {
  const monitor = summary.monitor;
  const environment = monitor?.environment;
  const cwd = environment?.cwd;
  const name =
    cwd === undefined
      ? undefined
      : (cwd
          .split("/")
          .filter((part) => part !== "")
          .at(-1) ?? undefined);
  const git = environment?.git;
  const branch = git === undefined ? undefined : git === null ? null : git.branch;
  const usage = monitor?.usage as Record<string, unknown> | undefined;
  const context = monitor?.context;
  const model = monitor?.model;
  const project =
    name !== undefined || branch !== undefined
      ? { ...(name !== undefined ? { name } : {}), ...(branch !== undefined ? { branch } : {}) }
      : undefined;
  const chars = AGENT_FIELD.DESK_TEXT_CHARS;
  const message = monitor?.lastAssistantMessage as Record<string, unknown> | undefined;
  const text = typeof message?.["text"] === "string" ? message["text"] : undefined;
  const at = typeof message?.["at"] === "string" ? message["at"] : undefined;
  const final = message?.["final"];
  const costUsd = typeof usage?.["costUsd"] === "number" ? usage["costUsd"] : undefined;
  const costCoverage =
    typeof usage?.["costCoverage"] === "string" ? usage["costCoverage"] : undefined;
  const fieldUsage =
    usage !== undefined
      ? {
          ...(typeof usage["cumulativeTokens"] === "number"
            ? { cumulativeTokens: usage["cumulativeTokens"] }
            : {}),
          ...(typeof usage["burnRatePerMin"] === "number"
            ? { burnRatePerMin: usage["burnRatePerMin"] }
            : {}),
        }
      : undefined;
  const cost =
    costUsd !== undefined || costCoverage !== undefined
      ? {
          ...(costUsd !== undefined ? { costUsd } : {}),
          ...(costCoverage !== undefined ? { costCoverage } : {}),
        }
      : undefined;
  return {
    runtimeRunId: summary.runtimeRunId,
    revision,
    kind: summary.kind,
    label: summary.label,
    tier: summary.tier,
    device: summary.device,
    ...(summary.profileId !== undefined ? { profileId: summary.profileId } : {}),
    status: summary.status,
    statusSince: monitor?.statusSince ?? summary.stateChangedAt,
    stateChangedAt: summary.stateChangedAt,
    createdAt: summary.createdAt,
    ...(summary.lastActivityAt !== undefined ? { lastActivityAt: summary.lastActivityAt } : {}),
    alive: monitor?.alive ?? (summary.terminal !== undefined && summary.terminal.hosted !== "none"),
    blockers: (monitor?.blockers ?? []).map((blocker) => {
      const permission = (blocker as Record<string, unknown>)["permission"];
      const tool =
        typeof permission === "object" && permission !== null
          ? (permission as Record<string, unknown>)["tool"]
          : undefined;
      return {
        id: blocker.id,
        kind: blocker.kind,
        since: blocker.since,
        ...(typeof tool === "string" ? { tool } : {}),
      };
    }),
    ...(fieldUsage !== undefined || cost !== undefined
      ? { usage: { ...fieldUsage, ...cost } }
      : {}),
    ...(context !== undefined ? { context: { usedPercent: context.usedPercent } } : {}),
    ...(model !== undefined
      ? {
          model: {
            id: model.id,
            ...(model.displayName !== undefined ? { displayName: model.displayName } : {}),
          },
        }
      : {}),
    ...(project !== undefined ? { project } : {}),
    ...(summary.terminal !== undefined ? { terminal: summary.terminal } : {}),
    ...(text !== undefined
      ? {
          lastAssistantMessage: {
            text: bound(text, chars),
            ...(at !== undefined ? { at } : {}),
            ...(typeof final === "boolean" ? { final } : {}),
          },
        }
      : {}),
  };
}

/** A desk row's identity for fieldd's "did the projection change" rule. */
function deskComparable(row: AgentDeskRow): string {
  const { revision: _revision, ...rest } = row;
  return JSON.stringify(rest);
}

// ── the generator ─────────────────────────────────────────────────────────────

interface Desktop {
  device: string;
  agents: AgentState[];
  random: () => number;
  /** the board's epoch (`RowsEpoch` is a string) and its revision chain */
  epoch: string;
  revision: number;
  flips: number;
  replies: number;
  waits: number;
  /** when each periodic event is next due. An event fires at the first fold
   * tick AT OR AFTER its due time (the periods are not multiples of the tick)
   * and is then due a period after THAT tick. */
  nextFlipAt: number;
  nextReplyAt: number;
  nextWaitAt: number;
}

function newDesktop(
  device: string,
  prefix: string,
  count: number,
  seed: number,
  recipe: ResolvedCorpusRecipe,
  catalog: Provider[],
): Desktop {
  const random = mulberry32(seed);
  const agents: AgentState[] = [];
  for (let index = 0; index < count; index += 1) {
    agents.push(
      newAgent(
        device,
        prefix,
        index,
        random,
        catalog[index % catalog.length] as Provider,
        recipe.baseWall,
      ),
    );
  }
  return {
    device,
    agents,
    random,
    epoch: `${device}-epoch-1`,
    revision: 0,
    flips: 0,
    replies: 0,
    waits: 0,
    nextFlipAt: recipe.statusFlipMs,
    nextReplyAt: recipe.replyMs,
    nextWaitAt: recipe.waitMs,
  };
}

/** Everything a desktop's agents do in one fold tick, outside the quiet window. */
function advance(desk: Desktop, nowMs: number, tMs: number, recipe: ResolvedCorpusRecipe): void {
  for (const agent of desk.agents) {
    if (agent.blocker !== null && agent.blocker.untilMs <= tMs) release(agent, nowMs);
  }
  if (tMs >= desk.nextFlipAt) {
    desk.nextFlipAt = tMs + recipe.statusFlipMs;
    const agent = desk.agents[desk.flips % desk.agents.length] as AgentState;
    desk.flips += 1;
    if (agent.status === "working") setStatus(agent, "idle", nowMs);
    else if (agent.status === "idle") setStatus(agent, "working", nowMs);
  }
  if (tMs >= desk.nextReplyAt) {
    desk.nextReplyAt = tMs + recipe.replyMs;
    const working = desk.agents.filter((agent) => agent.status === "working");
    const agent = working[desk.replies % Math.max(1, working.length)];
    desk.replies += 1;
    if (agent !== undefined) {
      const seq = (agent.reply?.seq ?? 0) + 1;
      agent.reply = {
        text: `${REPLIES[seq % REPLIES.length]} (#${seq}, ${agent.runtimeRunId})`,
        atMs: nowMs,
        seq,
      };
      agent.revision += 1;
      agent.lastActivityAtMs = nowMs;
    }
  }
  if (tMs >= desk.nextWaitAt) {
    desk.nextWaitAt = tMs + recipe.waitMs;
    const agent = desk.agents[desk.waits % desk.agents.length] as AgentState;
    desk.waits += 1;
    if (agent.blocker === null) {
      block(
        agent,
        nowMs,
        tMs + Math.floor(recipe.waitMs / 2),
        TOOLS[desk.waits % TOOLS.length] as string,
      );
    }
  }
  for (const agent of desk.agents) {
    if (agent.status === "working") tickUsage(agent, nowMs, desk.random, recipe.samplesRing);
  }
}

/** The desk board's delta since the last tick, by fieldd's rule: a row's
 * revision bumps only when its projected JSON changed; unchanged rows stay. */
function deskDelta(desk: Desktop): AgentDeskRow[] {
  const upserts: AgentDeskRow[] = [];
  for (const agent of desk.agents) {
    const candidate = deskRowOf(foldRowOf(agent), agent.deskRevision);
    const comparable = deskComparable(candidate);
    if (comparable === agent.deskSent) continue;
    agent.deskRevision += 1;
    agent.deskSent = comparable;
    upserts.push({ ...candidate, revision: agent.deskRevision });
  }
  return upserts;
}

function deskSnapshot(desk: Desktop): AgentDeskRow[] {
  return desk.agents.map((agent) => {
    const row = deskRowOf(foldRowOf(agent), agent.deskRevision + 1);
    agent.deskRevision += 1;
    agent.deskSent = deskComparable(row);
    return row;
  });
}

function paneSession(id: string, cwd: string, createdAtMs: number, title: string): SessionSummary {
  return {
    id,
    handle: `handle-${id}`,
    executable: "/bin/zsh",
    cols: 120,
    rows: 40,
    exited: false,
    readWrite: true,
    title,
    cwd,
    bellCount: 0,
    pid: 1_000 + id.length,
    createdAtMs,
    exitCode: null,
    exitSignal: null,
    requestedTermination: null,
    exitOutcome: null,
    ownerId: null,
    persistence: null,
    activity: {
      kind: "shell-idle",
      source: "shell-integration",
      confidence: "authoritative",
      rootProcessGroupId: null,
      foregroundProcessGroupId: null,
      observedAtMs: createdAtMs,
    },
  };
}

function rosterOf(recipe: ResolvedCorpusRecipe): DeviceInfo[] {
  const lastSeenAt = recipe.baseWall;
  return [
    {
      deviceId: CORPUS_HERE,
      name: "This desk",
      platform: "darwin",
      self: true,
      online: true,
      lastSeenAt,
      state: "awake",
    },
    {
      deviceId: CORPUS_PEER,
      name: "The other desk",
      platform: "linux",
      self: false,
      online: true,
      lastSeenAt,
      state: "awake",
    },
  ];
}

export function generateCorpus(input: CorpusRecipe): Corpus {
  const recipe = resolveRecipe(input);
  const catalog = providers();
  const here = newDesktop(CORPUS_HERE, "run", recipe.n, recipe.seed, recipe, catalog);
  const peer = newDesktop(
    CORPUS_PEER,
    "peer-run",
    recipe.peerAgents,
    recipe.seed + 1_000_003,
    recipe,
    catalog,
  );
  const marker = here.agents[recipe.markerAgent] as AgentState;
  const markerFrom = marker.status;
  const quietFrom = recipe.markerAtMs - recipe.markerQuietMs;
  const quietTo = recipe.markerAtMs + recipe.markerQuietMs;

  const frames: RecordedFrame[] = [];
  let seq = 0;
  const stamp = (tMs: number): { seq: number; t: number; wall: number } => {
    seq += 1;
    return { seq, t: tMs, wall: recipe.baseWall + tMs };
  };
  const counts = { fold: 0, meshOpen: 0, meshFrames: 0, marks: 0 };

  const emitFold = (tMs: number): void => {
    counts.fold += 1;
    frames.push({ ...stamp(tMs), kind: "fold", rows: here.agents.map(foldRowOf) });
  };
  const emitDesk = (desk: Desktop, tMs: number): void => {
    const upserts = deskDelta(desk);
    if (upserts.length === 0) return;
    const since = desk.revision;
    desk.revision += 1;
    const frame: AgentMeshFrame = {
      device: desk.device,
      delta: { epoch: desk.epoch, since, revision: desk.revision, upserts, removed: [] },
    };
    counts.meshFrames += 1;
    frames.push({ ...stamp(tMs), kind: "mesh-frame", frame });
  };

  // t = 0: the fold's first frame (the subscribe's snapshot) and the mesh open
  emitFold(0);
  const open: AgentMeshOpen = {
    devices: [here, peer].map((desk) => {
      desk.revision += 1;
      return {
        device: desk.device,
        state: "live" as const,
        asOf: iso(recipe.baseWall),
        snapshot: { epoch: desk.epoch, revision: desk.revision, rows: deskSnapshot(desk) },
      };
    }),
  };
  counts.meshOpen += 1;
  frames.push({ ...stamp(0), kind: "mesh-open", open });

  let markerFired = false;
  let nextDeskAt = recipe.deskTickMs;
  for (let tMs = recipe.foldTickMs; tMs <= recipe.durationMs; tMs += recipe.foldTickMs) {
    const nowMs = recipe.baseWall + tMs;
    const quiet = tMs >= quietFrom && tMs <= quietTo;
    if (quiet) {
      if (!markerFired && tMs >= recipe.markerAtMs) {
        markerFired = true;
        counts.marks += 1;
        frames.push({
          ...stamp(tMs),
          kind: "mark",
          name: CORPUS_MARK,
          detail: {
            runtimeRunId: marker.runtimeRunId,
            device: CORPUS_HERE,
            from: markerFrom,
            to: recipe.markerTo,
          },
        });
        if (recipe.markerTo === "blocked") {
          block(marker, nowMs, Number.POSITIVE_INFINITY, TOOLS[0] as string);
        } else {
          marker.blocker = null;
          setStatus(marker, recipe.markerTo, nowMs);
        }
        emitFold(tMs);
      }
      continue;
    }
    advance(here, nowMs, tMs, recipe);
    advance(peer, nowMs, tMs, recipe);
    emitFold(tMs);
    // the desk's floor: at most one frame per device per `deskTickMs`, sent at
    // the first fold tick at or after it is due (fieldd's own floor semantics)
    if (tMs >= nextDeskAt) {
      nextDeskAt = tMs + recipe.deskTickMs;
      emitDesk(here, tMs);
      emitDesk(peer, tMs);
    }
  }

  const panes = panesOf(here, recipe);
  return {
    meta: {
      generator: CORPUS_GENERATOR,
      version: CORPUS_VERSION,
      recipe,
      here: CORPUS_HERE,
      peer: CORPUS_PEER,
      marker: {
        runtimeRunId: marker.runtimeRunId,
        from: markerFrom,
        to: recipe.markerTo,
        atMs: recipe.markerAtMs,
      },
      counts,
    },
    roster: rosterOf(recipe),
    panes,
    frames,
  };
}

/** The deck's panes: one per agent's PTY (the pane join), plus the bare shells. */
function panesOf(here: Desktop, recipe: ResolvedCorpusRecipe): CorpusPanes {
  const sessions: SessionSummary[] = here.agents.map((agent) =>
    paneSession(
      agent.ptySessionId,
      `/work/${agent.project}`,
      agent.createdAtMs,
      `${agent.provider.label} — ${agent.project}`,
    ),
  );
  for (let index = 0; index < recipe.bareTerminals; index += 1) {
    sessions.push(
      paneSession(
        `shell-${index + 1}`,
        `/work/${PROJECTS[(index + 3) % PROJECTS.length]}`,
        recipe.baseWall - 600_000 - index * 1_000,
        "zsh",
      ),
    );
  }
  const sessionIds = sessions.map((session) => session.id);
  return {
    sessionIds,
    ...(sessionIds[0] !== undefined ? { activeSessionId: sessionIds[0] } : {}),
    sessions,
    floor: [],
  };
}
