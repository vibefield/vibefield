import type { AgentHalf } from "@vibefield/plugin-sdk/desk";

// THE WHITEBOARD, for an agent (OB-3c; `desk.board`). Its strokes are its children, which an agent's API does not reach
// yet (PLAN decision 6): it has no tools, and what it says of itself is honest about that.

export const boardAgent: AgentHalf = {
  summary: () => ({
    note: "A whiteboard's drawing cannot be read as text. Ask the user for its picture.",
  }),
};
