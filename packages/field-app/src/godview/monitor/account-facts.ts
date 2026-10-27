import type { AgentAccountUsageEntry, AgentProfileSet } from "@vibefield/contracts";
import { createContext, useContext } from "react";

/** AO-6b3 — what the stage's own feeds read about this window's accounts, lent
 * to what its claims strip says (the limit moment): the profile filter's sets
 * and the usage column's rows, each through the one subscription the stage
 * already holds (PF6). Null until that feed has answered, and nothing at all on
 * a stage with no door. */
export interface MonitorAccountFacts {
  readonly sets: readonly AgentProfileSet[] | null;
  readonly usage: readonly AgentAccountUsageEntry[] | null;
}

const UNANSWERED: MonitorAccountFacts = { sets: null, usage: null };

export const MonitorAccountFactsContext = createContext<MonitorAccountFacts>(UNANSWERED);

export function useMonitorAccountFacts(): MonitorAccountFacts {
  return useContext(MonitorAccountFactsContext);
}
