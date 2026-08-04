import type { SessionSummary } from "@vibecook/ghosttea-protocol";

// The agent-runtime shapes the monitor reads, mirrored locally — AR-REPLACEABLE.
//
// The TERMINAL half is real: `SessionSummary` comes from
// `@vibecook/ghosttea-protocol` at the pinned 0.9.0, because a monitor row IS a
// floor session and there is no reason to describe one in a private vocabulary.
// The AGENT half is what is mirrored, and the reason is evidence rather than
// preference. The reference app (chopsticks apps/godview) sources those names
// from three places:
//
//   ContextWindowRuntimeState  → @vibecook/chopsticks-core   (core/src/state.ts)
//   BuiltinAgentKind           → @vibecook/chopsticks-runtime, NOT -core
//   AgentSessionInfo           → an app-local Omit<> over the runtime's type
//   AgentStateMessage          → app-local; in NO chopsticks package at all
//
// That last row decides it: `AgentStateMessage`/`SerializedSessionState` are the
// app's IPC projection of the runtime's reduced state, so no dependency can
// supply them. Taking the "real" types would mean adding chopsticks-core AND
// chopsticks-runtime to the RENDERER's dependency graph — and -runtime pulls the
// four provider adapters plus -record and -workspaces, a Node-plane agent
// runtime field-app has no business linking — to buy exactly one of the four
// names, while the other three stayed here anyway.
//
// GT-D13 is what makes that cheap: a view is a pure function of a data shape, so
// AR replaces the SOURCE behind the seam and this file becomes the one import to
// redirect when VibeField's own runtime shapes land in fieldd. Nothing below is
// invented — every field is the reference's field with the reference's meaning.

/** The providers we already pin adapters for (chopsticks 0.1.4). */
export type AgentKind = "claude" | "codex" | "grok" | "acp";

export const AGENT_KINDS: readonly AgentKind[] = ["claude", "codex", "grok", "acp"];

/** Latest trustworthy context-window measurement for an agent session.
 * `usedPercent` is exact and unrounded in the inclusive range 0..100 — the views
 * round it themselves, because how much precision to show is presentation. */
export interface ContextWindowRuntimeState {
  usedTokens: number;
  capacityTokens: number;
  usedPercent: number;
  modelId?: string;
  updatedAt: string;
}

export interface ObservedValue<T> {
  value: T;
  updatedAt: string;
}

export interface AgentModelIdentity {
  id: string;
  displayName?: string;
}

export interface AgentGitState {
  branch?: string | null;
}

/** Live provider facts about where and how an agent is executing. A `git` value
 * of null authoritatively means "not in a repo" — which is why `branch` reads
 * the presence of the OBSERVATION, not the truthiness of the branch. */
export interface SessionEnvironmentRuntimeState {
  currentCwd?: ObservedValue<string>;
  model?: ObservedValue<AgentModelIdentity>;
  git?: ObservedValue<AgentGitState | null>;
}

export interface AgentWorkspaceInfo {
  mode: "direct" | "exclusive" | "worktree";
  root?: string;
  sourcePath?: string;
  branch?: string;
}

/** One agent session, as the shell learns about it. `session` is the ghosttea
 * SessionSummary the agent runs inside — the join between the agent plane and
 * the terminal floor, and the reason `MonitorAgent.id` survives promotion. */
export interface AgentSessionInfo {
  agent: AgentKind;
  sessionId: string;
  runtimeSessionId: string;
  workspace: AgentWorkspaceInfo;
  session: SessionSummary;
}

/**
 * The reduced runtime state a monitor is allowed to read.
 *
 * Every field here is a REDUCED observation — the runtime's own structured
 * events — never scraped terminal text. That is the reference's ADR-003 and it
 * is our law too (EL2's grain: control surfaces carry meaning, byte planes carry
 * bytes). A view that wants to know what an agent is doing reads this; nothing
 * in this subsystem may ever reach a terminal to find out.
 */
export interface SerializedSessionState {
  lifecycle: string;
  activeTurn?: { id?: string; startedAt: string };
  activeReasoning?: { reasoningId?: string; startedAt: string };
  tools: {
    toolCallId: string;
    tool?: string;
    state: "requested" | "running";
    presentation?: { title?: string };
  }[];
  permissions: { requestId: string; toolCallId?: string; tool?: string }[];
  subagents: { subagentId: string; agentType?: string }[];
  tasks: { taskId: string; description?: string }[];
  contextWindow?: ContextWindowRuntimeState;
  environment: SessionEnvironmentRuntimeState;
  counters: { toolsCompleted: number; toolsFailed: number; unknownEvents: number };
  lastSequence: number;
  diagnostics: { sequence: number; code: string; message: string }[];
}

export interface AgentStateMessage {
  runtimeSessionId: string;
  state: SerializedSessionState;
  observationLevel: "structured" | "heuristic";
}
