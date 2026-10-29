import { createContext, useContext } from "react";
import type { MonitorAgent } from "./types";

/** TS-4b — the window's rows as the stage already holds them (every desktop's,
 * no filter: `useMonitorAgents`' `agents`), lent to what its claims strip says
 * (the approval line), so the moment opens no feed of its own. Empty on a stage
 * with no feed. */
const NO_ROWS: readonly MonitorAgent[] = Object.freeze([]);

export const MonitorMomentRowsContext = createContext<readonly MonitorAgent[]>(NO_ROWS);

export function useMonitorMomentRows(): readonly MonitorAgent[] {
  return useContext(MonitorMomentRowsContext);
}
