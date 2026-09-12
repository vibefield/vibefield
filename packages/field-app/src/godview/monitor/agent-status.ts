import type { SessionActivity } from "@vibecook/ghosttea-protocol";
import type { AgentSessionSummary } from "./facet-types";
import { folderName } from "./folder-name";

/**
 * What a session is doing, derived ONLY from the fold's row — fieldd's one
 * derived `status` (AR-D4: derived once, in fieldd, from puppeteer's reduced
 * monitor projection) — never from terminal text (the reference's ADR-003/-005,
 * and our own grain: EL2 keeps meaning on control surfaces and bytes on data
 * planes, so a monitor that read a screen to decide what an agent was doing
 * would be reading the wrong plane). How a status is then DRAWN is each view's
 * own business.
 */
export type AgentVisualStatus = "idle" | "working" | "waiting";

/**
 * The fold's four words onto the views' three. `blocked` is the reference's
 * `waiting` (the agent is asking for something); `unknown` — no monitor
 * evidence yet — reads as working with the detail "starting", as a session
 * that has not spoken did in the reference. A run puppeteer reports as not
 * alive is dropped: an exited agent is not a row.
 */
export function classifyAgentStatus(summary: AgentSessionSummary): AgentVisualStatus | undefined {
  if (summary.monitor?.alive === false) return undefined;
  switch (summary.status) {
    case "blocked":
      return "waiting";
    case "idle":
      return "idle";
    default:
      return "working";
  }
}

export function classifyTerminalStatus(
  activity: Pick<SessionActivity, "kind"> | undefined,
): Exclude<AgentVisualStatus, "waiting"> {
  return activity?.kind === "foreground-job" ? "working" : "idle";
}

/** The project a row belongs to: the agent's current directory when the
 * monitor observed one, else the workspace's, folded to its last component;
 * the provider's label when nothing names a directory. */
export function projectLabel(summary: AgentSessionSummary): string {
  const path =
    summary.monitor?.environment?.cwd ||
    summary.workspace?.sourcePath ||
    summary.workspace?.root ||
    "";
  return folderName(path, summary.label);
}

/** The provider's own label, as the adapter authored it. Kept as a function so
 * a call site reads the same as it did with the closed union — and so a row
 * with an empty label (a tolerant-reader case) still says its id. */
export function providerLabel(summary: Pick<AgentSessionSummary, "kind" | "label">): string {
  return summary.label.trim() === "" ? summary.kind : summary.label;
}

/** One line under the project: what the agent is waiting on when it is,
 * else the latest assistant line when the monitor carried one, else the status. */
export function agentDetail(summary: AgentSessionSummary, status: AgentVisualStatus): string {
  const monitor = summary.monitor;
  if (monitor === undefined) return "starting";
  if (status === "waiting") {
    const blocker = monitor.blockers[0];
    if (blocker === undefined) return "waiting";
    const tool = (blocker as { tool?: unknown }).tool;
    return typeof tool === "string" && tool !== "" ? `${blocker.kind} · ${tool}` : blocker.kind;
  }
  const last = monitor.lastAssistantMessage as { text?: unknown } | undefined;
  if (typeof last?.text === "string" && last.text.trim() !== "") return last.text.trim();
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
 * ticks and reloads and (since AR-3) across restarts.
 */
export function agentAccentSlot(id: string, slots: number): number {
  let hash = 2166136261;
  for (let index = 0; index < id.length; index += 1) {
    hash ^= id.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return Math.abs(hash) % slots;
}
