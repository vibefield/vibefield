import type { AgentFieldRow } from "@vibefield/contracts";
import type { KeyedCallClient } from "../forwarded-call";
import type { JumpOutcome } from "../frame/line-door";
import { type LiveOpenDoors, openLiveRow } from "../frame/live-open";
import { floorRunOf, RUNS_UNREAD, readRunRows } from "../history/jump";

// CHAT'S ONE REVEAL (TH-2; DESIGN.md §8 "Chat's thread", the head's act; §8 "Godview", GV-D4's doors). The head's Jump
// to, the needs-you card's Show and a crew member's reveal go to a run's own terminal in Godview by History's Jump to
// path (`frame/live-open.ts`): the frame asks for Godview, waits for a deck that can place within Jump to's bound, and
// the deck reveals the run's floor session in the focused pane. The caller reads the run's board row at the press,
// never from what was drawn, so a pill drawn a moment ago never shows a run that has ended. Whether its terminal is on
// this desktop's floor is fieldd's `agent.list`, read once at the press by History's own rule (`history/jump.ts`
// `floorRunOf`); anything else is said before anything moves, and never through Godview's find door, which would say
// "shown" for a run it only selected.
// *Corrected 2026-11-06 (item 187):* this read the floor session off the board row's `terminal` join
// (`floorSessionOf`, retired), and said it held History's `liveRunOf` rule. It held the rule, on the wrong source. The
// field board's join is the tailnet's attach promise: fieldd withholds it from every reader of the board while this
// desktop's terminal doors are not published (TM-2 F-M4, `agent-field.ts` `attachableRows`). So on a desktop off the
// tailnet (a smoke's root, a first run, an offline laptop) a run on this floor was refused "its terminal is not on this
// desktop's floor" (run 167, rung 11m). History reads `agent.list`, which fieldd keeps whole for this desktop's
// windows, and now so does Chat; the board row is read for what it is right about, whether the run is alive.

/** Why Jump to shows nothing: the run has gone by the press (or the board never held it). */
export const NOT_RUNNING = "it is not running";
/** Why Jump to shows nothing: fieldd's `agent.list` puts the run's terminal on another desktop, or none. When fieldd
 * cannot answer, the words are `RUNS_UNREAD`, the one sentence both Jump tos say it in (`history/jump.ts`). */
export const NOT_ON_THIS_FLOOR = "its terminal is not on this desktop's floor";

/** Show `row`'s run in Godview by Jump to's path, `row` read at the press and its floor session from `runs` (the
 * window's door to `agent.list`, read once): "jumped", or why not in words for Jump to's note (`jumpNote`). A deck
 * that cannot show it answers in the deck's own words. */
export async function revealRun(
  row: AgentFieldRow | null | undefined,
  runs: KeyedCallClient,
  doors?: LiveOpenDoors,
): Promise<JumpOutcome> {
  if (row === null || row === undefined || !row.alive)
    return { state: "refused", reason: NOT_RUNNING };
  const rows = await readRunRows(runs);
  if (rows === null) return { state: "refused", reason: RUNS_UNREAD };
  const run = floorRunOf(rows, row.runtimeRunId);
  if (run === null) return { state: "refused", reason: NOT_ON_THIS_FLOOR };
  const shown = await openLiveRow(
    { id: row.runtimeRunId, floorSessionId: run.floorSessionId },
    "assistant",
    doors,
  );
  return shown.state === "shown" ? { state: "jumped" } : shown;
}
