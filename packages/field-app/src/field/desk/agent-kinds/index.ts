import type { AgentHalf } from "@vibefield/plugin-sdk/desk";
import { typeDefinition } from "../../../plugin-host/build-widget";
import { boardAgent } from "./board";
import { minimatAgent } from "./minimat";
import { noteAgent } from "./note";
import { printAgent } from "./print";

// The built-in kinds' handlers, by the types `desk-kinds.ts` declares (`desk-agent-kinds.test.ts` pins both to ICE's constants).

export const BUILT_IN_AGENT_HALVES: ReadonlyMap<string, AgentHalf> = new Map([
  ["desk.note", noteAgent],
  ["desk.photo", printAgent],
  ["desk.board", boardAgent],
  ["desk.minimat", minimatAgent],
]);

/** A kind's agent half: a built-in's, or what a plugin's binding carries. */
export function agentHalfOf(type: string): AgentHalf | undefined {
  return BUILT_IN_AGENT_HALVES.get(type) ?? typeDefinition(type)?.binding?.agent;
}
