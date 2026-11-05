import type { AgentFieldRow } from "@vibefield/contracts";
import type { JumpOutcome } from "../frame/line-door";
import { type LiveOpenDoors, openLiveRow } from "../frame/live-open";

// CHAT'S ONE REVEAL (TH-2; DESIGN.md §8 "Chat's thread", the head's act; §8 "Godview", GV-D4's doors). The head's Jump
// to and the needs-you card's Show go to a run's own terminal in Godview by History's Jump to path
// (`frame/live-open.ts`): the frame asks for Godview, waits for a deck that can place within Jump to's bound, and the
// deck reveals the run's floor session in the focused pane. The caller reads the run's board row at the press, never
// from what was drawn, so a pill drawn a moment ago never shows a run that has ended. Only a run whose terminal is on
// this desktop's floor is shown, as History's `liveRunOf` (`history/jump.ts`) holds it; anything else is said before
// anything moves, and never through Godview's find door, which would say "shown" for a run it only selected.

/** Why Jump to shows nothing: the run has gone by the press (or the board never held it). */
export const NOT_RUNNING = "it is not running";
/** Why Jump to shows nothing: the run's terminal is another desktop's, or none. */
export const NOT_ON_THIS_FLOOR = "its terminal is not on this desktop's floor";

/** The floor session a run's pane shows: its terminal on this desktop's floor while it is alive, else null. */
export function floorSessionOf(row: AgentFieldRow | null | undefined): string | null {
  if (row === null || row === undefined || !row.alive) return null;
  const terminal = row.terminal;
  if (terminal?.hosted !== "local") return null;
  return terminal.runtimeSessionId ?? null;
}

/** Show `row`'s run in Godview by Jump to's path, `row` read at the press: "jumped", or why not in words for Jump to's
 * note (`jumpNote`). A deck that cannot show it answers in the deck's own words. */
export async function revealRun(
  row: AgentFieldRow | null | undefined,
  doors?: LiveOpenDoors,
): Promise<JumpOutcome> {
  if (row === null || row === undefined || !row.alive)
    return { state: "refused", reason: NOT_RUNNING };
  const floorSessionId = floorSessionOf(row);
  if (floorSessionId === null) return { state: "refused", reason: NOT_ON_THIS_FLOOR };
  const shown = await openLiveRow({ id: row.runtimeRunId, floorSessionId }, "assistant", doors);
  return shown.state === "shown" ? { state: "jumped" } : shown;
}
