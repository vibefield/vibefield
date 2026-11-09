import type { AgentHalf } from "@vibefield/plugin-sdk/desk";

// THE MINI MAT, for an agent (OB-3c; `desk.minimat`): its name, its only text. What lies inside stays the user's.

export const minimatAgent: AgentHalf = {
  summary: (api) => ({ name: api.props()["name"] }),
  act: {
    rename: (api, input) => {
      const name = String(input["name"]);
      api.setProps({ name });
      return { value: { name }, changed: `Renamed the mat "${name}"` };
    },
  },
};
