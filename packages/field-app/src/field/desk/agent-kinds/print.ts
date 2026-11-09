import type { AgentHalf } from "@vibefield/plugin-sdk/desk";

// THE PRINT, for an agent (OB-3c; `desk.photo`): what it is, never the picture's bytes (EL2 — the picture face is a file).

export const printAgent: AgentHalf = {
  summary: (api) => {
    const { width, height } = api.props();
    return { width, height };
  },
};
