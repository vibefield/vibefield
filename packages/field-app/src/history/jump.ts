import { AgentSessionSummary } from "@vibefield/contracts";
import type { KeyedCallClient } from "../forwarded-call";

// HISTORY'S JUMP TO (P3; DESIGN.md §8 "History"; AR-D43 (a), K11). The room
// reports the session a person has chosen by its provider-native id, and that
// id is the spine fieldd's fold joins on too: a run's `sessionId` IS the
// conversation it continues. So whether the chosen session runs here is one
// plain `agent.list` — no subscription, so a closed Godview still asks nothing
// (PF6) — and the row that answers names the floor session its pane shows,
// which is what Godview's deck reveals.
//
// *2026-11-06 (item 187):* the one reading of "a run's terminal is HERE" for
// both Jump tos. History's joins on the conversation (`liveRunOf`); Chat's
// (`chat/reveal-run.ts`: the head's Jump to, the card's Show, a crew member's
// reveal) on the run (`floorRunOf`). Both read `agent.list`, which fieldd keeps
// whole for this desktop's windows (`agentListFor`), and never the field
// board's `terminal` join, which is the tailnet's attach promise and is
// withheld while this desktop's terminal doors are not published (TM-2 F-M4).

/** A run continuing the chosen conversation on this desktop. */
export interface LiveRun {
  /** The floor session the run's terminal is: what a pane shows. */
  readonly floorSessionId: string;
  readonly runtimeRunId: string;
}

/** `row`'s run on this desktop's floor, with the floor session its pane shows,
 * or null: its record is not stamped with an exit (MF-1f: a run whose process ended keeps
 * its row while its pane is on the floor), and its terminal is `local` with the
 * floor's session id. The one rule both Jump tos read. */
function floorRunOfRow(row: AgentSessionSummary): LiveRun | null {
  if (row.continuation?.exited === true) return null;
  const terminal = row.terminal;
  if (terminal?.hosted !== "local" || terminal.runtimeSessionId === undefined) return null;
  return { floorSessionId: terminal.runtimeSessionId, runtimeRunId: row.runtimeRunId };
}

/** The first run in `rows` that `matches` and runs HERE. A row this build
 * cannot read is passed over (the tolerant reader), never a refusal of the rest. */
function floorRunWhere(
  rows: readonly unknown[],
  matches: (row: AgentSessionSummary) => boolean,
): LiveRun | null {
  for (const candidate of rows) {
    const read = AgentSessionSummary.safeParse(candidate);
    if (!read.success || !matches(read.data)) continue;
    const run = floorRunOfRow(read.data);
    if (run !== null) return run;
  }
  return null;
}

/**
 * The run in `rows` that continues `nativeSessionId` HERE, or null: its
 * conversation is that one, its record is not stamped with an exit, and its
 * terminal is on this desktop's floor (`floorRunOfRow`).
 */
export function liveRunOf(rows: readonly unknown[], nativeSessionId: string): LiveRun | null {
  return floorRunWhere(rows, (row) => row.sessionId === nativeSessionId);
}

/** Item 187 — the run `runtimeRunId` HERE, or null: by the same rule as
 * `liveRunOf`, joined on the run, as Chat's reveals read it. */
export function floorRunOf(rows: readonly unknown[], runtimeRunId: string): LiveRun | null {
  return floorRunWhere(rows, (row) => row.runtimeRunId === runtimeRunId);
}

/** One plain `agent.list`: the fold's rows as this desktop's window reads them,
 * or null when fieldd cannot answer (a refusal, or an answer with no rows). */
export async function readRunRows(client: KeyedCallClient): Promise<readonly unknown[] | null> {
  try {
    const answer = await client.request("agent.list", {});
    const sessions =
      typeof answer === "object" && answer !== null
        ? (answer as { sessions?: unknown }).sessions
        : undefined;
    return Array.isArray(sessions) ? sessions : null;
  } catch {
    return null;
  }
}

/** Ask fieldd, once, whether `nativeSessionId` runs here. A fold that cannot
 * answer reads as not running: the create stays Resume, and fieldd's one-run
 * law still refuses a second run, in Jump to's words (`resume.ts`). */
export async function readLiveRun(
  client: KeyedCallClient,
  nativeSessionId: string,
): Promise<LiveRun | null> {
  const rows = await readRunRows(client);
  return rows === null ? null : liveRunOf(rows, nativeSessionId);
}
