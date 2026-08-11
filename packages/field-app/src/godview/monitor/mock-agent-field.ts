import type { SessionSummary } from "@vibecook/ghosttea-protocol";
import type { MonitorAgentRecord, MonitorTerminalRecord } from "./agents";
import type { AgentKind, AgentStateMessage, SerializedSessionState } from "./facet-types";

/**
 * THE MOCK (GT-D13). The one module AR replaces.
 *
 * Everything else in `monitor/` and `views/` is the reference app's, ported: a
 * view is a pure function of `{agents, parameters, actions, palette}` and cannot
 * tell where its rows came from. This file is where the rows come from today,
 * and the whole reason the stage must WEAR A LABEL saying so — a monitor showing
 * invented agents without admitting it is exactly the blank-that-looks-like-data
 * the honest-states law exists to forbid.
 *
 * DETERMINISM is the property that makes it testable and the property that makes
 * it useful: `mockFieldAt(tick)` is a pure function of the tick and the seed, so
 * the same seed replays the same timeline glyph for glyph. There is no
 * `Date.now()` and no `Math.random()` anywhere below; the only randomness is
 * mulberry32 over `MOCK_AGENT_SEED`, drawn once per roster entry at module scope.
 *
 * The timeline it plays, in one paragraph: eight agents across the four pinned
 * providers plus one terminal nobody has claimed, each cycling idle ↔ working ↔
 * waiting on its own cadence and phase; context windows filling monotonically;
 * one agent (the grok on `voyager`) EXITS at tick 24 with its window nearly
 * full, and a new claude on `duke` ARRIVES at tick 33 — so a viewer who watches
 * for a minute sees a death and a birth rather than a frieze.
 */

/** Same seed ⇒ same timeline. Exported because a test that hardcoded it would
 * be asserting about a literal rather than about the field. */
export const MOCK_AGENT_SEED = 0x5eed_9d17;

/** How often the field advances. Slow on purpose: this is a preview of a
 * monitor, not an animation — a status flipping twice a second would read as
 * noise, and PF6 means these ticks only ever run while the overlay is open. */
export const MOCK_TICK_MS = 1_500;

/** A fixed wall clock, so `createdAtMs`/`updatedAt` are facts of the timeline
 * rather than facts of when someone opened the overlay. */
const MOCK_EPOCH_MS = 1_764_547_200_000; // 2025-12-01T00:00:00Z

const TICK_WHEN_ONE_LEAVES = 24;
const TICK_WHEN_ONE_ARRIVES = 33;

/** mulberry32 — small, seedable, and stable across engines, which is the only
 * property that matters here. */
function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

type MockStatus = "idle" | "working" | "waiting";

interface RosterEntry {
  key: string;
  kind: AgentKind;
  /** A real-shaped path — DESIGN.md §9: demo content is real-shaped, not lorem.
   * `folderName` takes the last component for the label, exactly as it will for
   * a real workspace root. */
  cwd: string;
  branch: string | null;
  model: { id: string; displayName: string };
  capacityTokens: number;
  /** The status wheel this agent walks, and how many ticks it holds each. */
  pattern: readonly MockStatus[];
  cadence: number;
  phase: number;
  /** Percent of the window used at tick 0, and how fast it fills per tick. */
  contextStart: number;
  contextRate: number;
  /** Which in-flight tool to name while working; `null` means "thinking". */
  tool: string | null;
  joinsAtTick: number;
  leavesAtTick: number | null;
}

/**
 * The cast. Providers are the four we already pin adapters for (chopsticks
 * 0.1.4), and the projects are this portfolio's own — a mock that invented
 * company names would be lying about a second thing.
 */
const ROSTER_SEED: readonly Omit<RosterEntry, "phase" | "cadence">[] = [
  {
    key: "vibe-field-shell",
    kind: "claude",
    cwd: "/Users/dev/Projects/project100/vibe-field",
    branch: "main",
    model: { id: "claude-fable-5", displayName: "Fable 5" },
    capacityTokens: 200_000,
    pattern: ["working", "working", "waiting", "idle"],
    contextStart: 18,
    contextRate: 0.9,
    tool: "Edit",
    joinsAtTick: 0,
    leavesAtTick: null,
  },
  {
    key: "vibe-field-native",
    kind: "codex",
    cwd: "/Users/dev/Projects/project100/vibe-field/crates/field-native",
    branch: "nf-8-mesh",
    model: { id: "gpt-5-codex", displayName: "GPT-5 Codex" },
    capacityTokens: 128_000,
    pattern: ["working", "idle", "working", "working"],
    contextStart: 41,
    contextRate: 0.6,
    tool: "Bash",
    joinsAtTick: 0,
    leavesAtTick: null,
  },
  {
    key: "voyager-analysis",
    kind: "grok",
    cwd: "/Users/dev/Projects/voyager",
    branch: "spectral-rewrite",
    model: { id: "grok-4", displayName: "Grok 4" },
    capacityTokens: 256_000,
    pattern: ["working", "working", "working", "waiting"],
    contextStart: 72,
    // The one that fills fastest, and the one that leaves: it runs out of
    // window and exits, which is a shape a real field does have.
    contextRate: 1.4,
    tool: "Grep",
    joinsAtTick: 0,
    leavesAtTick: TICK_WHEN_ONE_LEAVES,
  },
  {
    key: "jabali-editor",
    kind: "claude",
    cwd: "/Users/dev/Projects/jabali/packages/editor",
    branch: "gizmo-snapping",
    model: { id: "claude-opus-5", displayName: "Opus 5" },
    capacityTokens: 200_000,
    pattern: ["waiting", "working", "idle", "working"],
    contextStart: 33,
    contextRate: 0.5,
    tool: null,
    joinsAtTick: 0,
    leavesAtTick: null,
  },
  {
    key: "ice-canvas",
    kind: "acp",
    cwd: "/Users/dev/Projects/infinite-canvas-engine/packages/ice",
    branch: "ordered-childof",
    model: { id: "acp-bridge", displayName: "ACP bridge" },
    capacityTokens: 64_000,
    pattern: ["idle", "idle", "working", "idle"],
    contextStart: 12,
    contextRate: 0.3,
    tool: "Read",
    joinsAtTick: 0,
    leavesAtTick: null,
  },
  {
    key: "study-portfolio",
    kind: "codex",
    cwd: "/Users/dev/Projects/study",
    // No repo: the git observation is present and null, which is a different
    // fact from "we never looked" and the projection distinguishes them.
    branch: null,
    model: { id: "gpt-5", displayName: "GPT-5" },
    capacityTokens: 128_000,
    pattern: ["working", "idle", "idle", "working"],
    contextStart: 5,
    contextRate: 0.8,
    tool: "WebFetch",
    joinsAtTick: 0,
    leavesAtTick: null,
  },
  {
    key: "truffle-mesh",
    kind: "grok",
    cwd: "/Users/dev/Projects/project100/p008/truffle",
    branch: "t2-sidecar",
    model: { id: "grok-4-fast", displayName: "Grok 4 Fast" },
    capacityTokens: 256_000,
    pattern: ["working", "waiting", "waiting", "working"],
    contextStart: 55,
    contextRate: 0.7,
    tool: "Bash",
    joinsAtTick: 0,
    leavesAtTick: null,
  },
  {
    key: "ref-raymarch",
    kind: "claude",
    cwd: "/Users/dev/Projects/ref/raymarch",
    branch: "sdf-primitives",
    model: { id: "claude-sonnet-5", displayName: "Sonnet 5" },
    capacityTokens: 200_000,
    pattern: ["idle", "working", "working", "idle"],
    contextStart: 27,
    contextRate: 0.4,
    tool: "Write",
    joinsAtTick: 0,
    leavesAtTick: null,
  },
  {
    // The arrival. Nothing before its join tick; a genuinely new body in every
    // view, placed by whatever spawn rule that view uses.
    key: "duke-coursework",
    kind: "claude",
    cwd: "/Users/dev/Projects/duke/compilers",
    branch: "lexer",
    model: { id: "claude-fable-5", displayName: "Fable 5" },
    capacityTokens: 200_000,
    pattern: ["working", "working", "idle", "waiting"],
    contextStart: 2,
    contextRate: 1.1,
    tool: "Read",
    joinsAtTick: TICK_WHEN_ONE_ARRIVES,
    leavesAtTick: null,
  },
];

/** The roster with its seeded per-agent jitter drawn ONCE, at module scope. The
 * draw order is the array order, so the phases are a property of the seed and
 * the list rather than of when anything mounted. */
const ROSTER: readonly RosterEntry[] = (() => {
  const random = mulberry32(MOCK_AGENT_SEED);
  return ROSTER_SEED.map((entry) => ({
    ...entry,
    // 2–5 ticks per status, and a phase so the field does not pulse in unison.
    cadence: 2 + Math.floor(random() * 4),
    phase: Math.floor(random() * 16),
  }));
})();

/** One terminal nobody has claimed, so the unclaimed-terminal branch of the
 * projection is on screen rather than merely tested. */
const MOCK_TERMINAL_ID = "mock-terminal-scratch";

function mockSessionSummary(
  id: string,
  index: number,
  cwd: string,
  title: string,
  foreground: boolean,
): SessionSummary {
  return {
    id,
    handle: `mock-${index}`,
    executable: "/bin/zsh",
    cols: 100,
    rows: 30,
    exited: false,
    readWrite: true,
    title,
    cwd,
    bellCount: 0,
    pid: 40_000 + index,
    createdAtMs: MOCK_EPOCH_MS + index * 1_000,
    exitCode: null,
    exitSignal: null,
    requestedTermination: null,
    exitOutcome: null,
    ownerId: null,
    // The floor's real answer for an agent session: it outlives the app.
    persistence: "keep-until-exit",
    activity: {
      kind: foreground ? "foreground-job" : "shell-idle",
      source: "shell-integration",
      confidence: "authoritative",
      rootProcessGroupId: 40_000 + index,
      foregroundProcessGroupId: foreground ? 40_500 + index : null,
      observedAtMs: MOCK_EPOCH_MS,
    },
  };
}

function statusAt(entry: RosterEntry, tick: number): MockStatus {
  const step = Math.floor((tick + entry.phase) / entry.cadence);
  return entry.pattern[
    ((step % entry.pattern.length) + entry.pattern.length) % entry.pattern.length
  ] as MockStatus;
}

/** Monotonic and capped: a window fills, it does not breathe. */
function contextPercentAt(entry: RosterEntry, tick: number): number {
  const elapsed = Math.max(0, tick - entry.joinsAtTick);
  return Math.min(97, entry.contextStart + elapsed * entry.contextRate);
}

function mockStateMessage(entry: RosterEntry, tick: number): AgentStateMessage {
  const status = statusAt(entry, tick);
  const usedPercent = contextPercentAt(entry, tick);
  const updatedAt = new Date(MOCK_EPOCH_MS + tick * MOCK_TICK_MS).toISOString();
  const state: SerializedSessionState = {
    lifecycle: "ready",
    tools: [],
    permissions: [],
    subagents: [],
    tasks: [],
    environment: {
      currentCwd: { value: entry.cwd, updatedAt },
      model: { value: entry.model, updatedAt },
      // Present and null where there is no repo — an authoritative "not a repo",
      // which the projection must NOT paper over with a workspace branch.
      git: { value: entry.branch === null ? null : { branch: entry.branch }, updatedAt },
    },
    contextWindow: {
      usedTokens: Math.round((usedPercent / 100) * entry.capacityTokens),
      capacityTokens: entry.capacityTokens,
      usedPercent,
      modelId: entry.model.id,
      updatedAt,
    },
    counters: { toolsCompleted: tick, toolsFailed: 0, unknownEvents: 0 },
    lastSequence: tick,
    diagnostics: [],
  };

  if (status === "waiting") {
    state.permissions = [
      { requestId: `${entry.key}-approval-${tick}`, tool: entry.tool ?? "Bash" },
    ];
  } else if (status === "working") {
    if (entry.tool === null) state.activeReasoning = { startedAt: updatedAt };
    else {
      state.tools = [
        { toolCallId: `${entry.key}-tool-${tick}`, tool: entry.tool, state: "running" },
      ];
    }
  }
  // `idle` is the absence of all of it — which is exactly how
  // `classifyAgentStatus` reads it, so the mock is not asserting a status, it is
  // producing the STATE that yields one. That is what keeps the classifier on
  // the path instead of bypassed.

  return { runtimeSessionId: `${entry.key}-runtime`, state, observationLevel: "structured" };
}

export interface MockFieldSnapshot {
  agents: readonly MonitorAgentRecord[];
  terminals: readonly MonitorTerminalRecord[];
}

/**
 * The field at a tick. Pure: same seed and same tick ⇒ deep-equal snapshot.
 *
 * `tick` is an integer count of `MOCK_TICK_MS` intervals since the stage
 * mounted, and it starts at 0 — so a viewer always sees the same opening frame,
 * which is what makes "James looks at it" a repeatable observation.
 */
export function mockFieldAt(tick: number): MockFieldSnapshot {
  const agents: MonitorAgentRecord[] = [];
  ROSTER.forEach((entry, index) => {
    if (tick < entry.joinsAtTick) return;
    if (entry.leavesAtTick !== null && tick >= entry.leavesAtTick) return;
    const status = statusAt(entry, tick);
    agents.push({
      info: {
        agent: entry.kind,
        sessionId: `${entry.key}-native`,
        runtimeSessionId: `${entry.key}-runtime`,
        workspace: {
          mode: "direct",
          root: entry.cwd,
          sourcePath: entry.cwd,
          ...(entry.branch !== null ? { branch: entry.branch } : {}),
        },
        session: mockSessionSummary(
          `${entry.key}-session`,
          index,
          entry.cwd,
          entry.model.displayName,
          status === "working",
        ),
      },
      state: mockStateMessage(entry, tick),
    });
  });

  return {
    agents,
    terminals: [
      {
        session: mockSessionSummary(
          MOCK_TERMINAL_ID,
          ROSTER.length,
          "/Users/dev/Projects/project100",
          "zsh",
          // The bare terminal runs a job every other stretch, so
          // `classifyTerminalStatus` is exercised in both directions on screen.
          Math.floor(tick / 5) % 2 === 1,
        ),
        cwd: "/Users/dev/Projects/project100",
      },
    ],
  };
}

/** The ids the timeline will ever produce, for a harness that wants to assert
 * about arrival and departure without replaying the whole thing. */
export const MOCK_TIMELINE = {
  leavesAtTick: TICK_WHEN_ONE_LEAVES,
  arrivesAtTick: TICK_WHEN_ONE_ARRIVES,
  leavingSessionId: "voyager-analysis-session",
  arrivingSessionId: "duke-coursework-session",
  terminalSessionId: MOCK_TERMINAL_ID,
} as const;
