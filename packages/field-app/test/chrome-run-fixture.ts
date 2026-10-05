import { AGENT_FIELD, AgentModelDeskRow, type AgentSessionSummary } from "@vibefield/contracts";
import { projectDeskRow } from "../../fieldd/src/agent-field";
import type { ChromeRun } from "../src/godview/monitor/chrome-facts";

/**
 * MV-3d — a fold row as the window's chrome receives it: the run's row of the
 * model board, cut by FIELDD'S OWN CODE for this desktop's window
 * (`projectDeskRow(…, "window")`: the desk row, and the chrome's facts beside it)
 * and read back through the contract the window adapter parses with (EL9). A
 * test that used to hand a reader the fold's `full` row hands it this, so every
 * rule the reader keeps is held through the cut that now carries its facts.
 * No model row: the chrome reads none of it.
 */
export function chromeRunOf(summary: AgentSessionSummary, revision = 1): ChromeRun {
  return AgentModelDeskRow.parse({
    ...projectDeskRow(summary, AGENT_FIELD.DESK_TEXT_CHARS, undefined, "window"),
    revision,
  });
}
