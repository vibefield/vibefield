import type { AgentMonitorView } from "../../monitor/types";
import { RainView } from "./RainView";
import { RAIN_PARAMETER_GROUPS } from "./rain-parameters";

export const rainMonitorView: AgentMonitorView = {
  id: "rain",
  label: "Rain",
  parameterGroups: RAIN_PARAMETER_GROUPS,
  Component: RainView,
};
