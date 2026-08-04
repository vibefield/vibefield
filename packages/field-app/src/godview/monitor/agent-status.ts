import type { SessionActivity } from "@vibecook/ghosttea-protocol";
import type { AgentKind, AgentSessionInfo, AgentStateMessage } from "./facet-types";
import { folderName } from "./folder-name";

/**
 * What a session is doing, derived ONLY from reduced runtime state — never from
 * terminal text (the reference's ADR-003/-005, and our own grain: EL2 keeps
 * meaning on control surfaces and bytes on data planes, so a monitor that read
 * a screen to decide what an agent was doing would be reading the wrong plane).
 * How a status is then DRAWN is each view's own business.
 */
export type AgentVisualStatus = "idle" | "working" | "waiting";

const terminalLifecycles = new Set(["exited", "failed"]);

export function classifyAgentStatus(message?: AgentStateMessage): AgentVisualStatus | undefined {
  if (!message) return "working";
  const { state } = message;
  if (terminalLifecycles.has(state.lifecycle)) return undefined;
  if (state.permissions.length > 0) return "waiting";
  if (
    state.lifecycle !== "ready" ||
    state.activeTurn ||
    state.activeReasoning ||
    state.tools.length > 0 ||
    state.tasks.length > 0
  ) {
    return "working";
  }
  return "idle";
}

export function classifyTerminalStatus(
  activity: Pick<SessionActivity, "kind"> | undefined,
): Exclude<AgentVisualStatus, "waiting"> {
  return activity?.kind === "foreground-job" ? "working" : "idle";
}

export function projectLabel(info: AgentSessionInfo, currentCwd?: string): string {
  const path =
    currentCwd || info.workspace.sourcePath || info.workspace.root || info.session.cwd || "";
  return folderName(path, info.agent);
}

export function providerLabel(agent: AgentKind): string {
  switch (agent) {
    case "claude":
      return "Claude";
    case "codex":
      return "Codex";
    case "grok":
      return "Grok";
    case "acp":
      return "ACP";
  }
}

export function agentDetail(
  message: AgentStateMessage | undefined,
  status: AgentVisualStatus,
): string {
  if (!message) return "starting";
  if (status === "waiting") {
    const permission = message.state.permissions[0];
    return permission?.tool ? `permission · ${permission.tool}` : "permission required";
  }
  const tool = message.state.tools[0];
  if (tool) return tool.presentation?.title ?? tool.tool ?? "using tool";
  if (message.state.activeReasoning) return "thinking";
  if (message.state.activeTurn) return "responding";
  return status;
}

/**
 * The stable per-session relationship color, as an INDEX into DESIGN.md §2.6's
 * organizational accents rather than a color.
 *
 * The reference hashes an id into `hsl(… 62% 44%)`, which is a fine trick and
 * the wrong one here: §2.6 is a CURATED set, and the whole point of an
 * organizational accent is that it groups and labels without ever signalling
 * state — which a free hue wheel cannot promise, since it can always land on
 * something a viewer reads as green-means-working. So the hash chooses a SLOT;
 * `monitor-palette.ts` resolves that slot from the live `--vf-accent-*` tokens.
 *
 * The hash itself is the reference's FNV-1a, unchanged, because the property
 * that matters is the one it already had: same id ⇒ same slot, forever, across
 * ticks and reloads and (at AR) across restarts.
 */
export function agentAccentSlot(id: string, slots: number): number {
  let hash = 2166136261;
  for (let index = 0; index < id.length; index += 1) {
    hash ^= id.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return Math.abs(hash) % slots;
}
