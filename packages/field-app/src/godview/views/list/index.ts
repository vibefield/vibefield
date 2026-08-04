import type { AgentMonitorView } from "../../monitor/types";
import { AgentList } from "./AgentList";
import { LIST_PARAMETER_GROUPS } from "./list-parameters";

export const listMonitorView: AgentMonitorView = {
  id: "list",
  label: "List",
  parameterGroups: LIST_PARAMETER_GROUPS,
  Component: AgentList,
};
