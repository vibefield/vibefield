import { AgentSessionSummary } from "@vibefield/contracts";
import type { KeyedCallClient } from "../forwarded-call";

// HISTORY'S JUMP TO (P3; DESIGN.md §8 "History"; AR-D43 (a), K11). The room
// reports the session a person has chosen by its provider-native id, and that
// id is the spine fieldd's fold joins on too: a run's `sessionId` IS the
// conversation it continues. So whether the chosen session runs here is one
// plain `agent.list` — no subscription, so a closed Godview still asks nothing
// (PF6) — and the row that answers names the floor session its pane shows,
// which is what Godview's deck reveals.

/** A run continuing the chosen conversation on this desktop. */
export interface LiveRun {
  /** The floor session the run's terminal is: what a pane shows. */
  readonly floorSessionId: string;
  readonly runtimeRunId: string;
}

/**
 * The run in `rows` that continues `nativeSessionId` HERE, or null: its
 * conversation is that one, its record is not stamped with an exit (MF-1f: a
 * run whose process ended keeps its row while its pane is on the floor), and
 * its terminal is on this desktop's floor. A row this build cannot read is
 * passed over (the tolerant reader), never a refusal of the rest.
 */
export function liveRunOf(rows: readonly unknown[], nativeSessionId: string): LiveRun | null {
  for (const candidate of rows) {
    const read = AgentSessionSummary.safeParse(candidate);
    if (!read.success) continue;
    const row = read.data;
    if (row.sessionId !== nativeSessionId || row.continuation?.exited === true) continue;
    const terminal = row.terminal;
    if (terminal?.hosted !== "local" || terminal.runtimeSessionId === undefined) continue;
    return { floorSessionId: terminal.runtimeSessionId, runtimeRunId: row.runtimeRunId };
  }
  return null;
}

/** Ask fieldd, once, whether `nativeSessionId` runs here. A fold that cannot
 * answer reads as not running: the create stays Resume, and fieldd's one-run
 * law still refuses a second run, in Jump to's words (`resume.ts`). */
export async function readLiveRun(
  client: KeyedCallClient,
  nativeSessionId: string,
): Promise<LiveRun | null> {
  try {
    const answer = await client.request("agent.list", {});
    const sessions =
      typeof answer === "object" && answer !== null
        ? (answer as { sessions?: unknown }).sessions
        : undefined;
    return Array.isArray(sessions) ? liveRunOf(sessions, nativeSessionId) : null;
  } catch {
    return null;
  }
}
