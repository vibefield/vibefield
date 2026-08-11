import type { AgentMonitorView } from "../../monitor/types";
import { AgentSwarm } from "./AgentSwarm";
import { SWARM_PARAMETER_GROUPS } from "./swarm-parameters";

export const swarmMonitorView: AgentMonitorView = {
  id: "swarm",
  label: "Swarm",
  parameterGroups: SWARM_PARAMETER_GROUPS,
  Component: AgentSwarm,
};
