import type { ProfileTab } from "@vibecook/puppeteer-views";
import type { AgentProfileSet } from "@vibefield/contracts";
import type { MonitorAgent } from "./types";

// AR-S5 — the bar's profile tabs (the agents-settings record's T3), as pure
// functions of the profiles feed and the monitor's rows: which profile a row's
// session runs under, the strip and what a chosen tab recedes. `GodviewMonitor` draws them; nothing here dials.

/** The native set's id: the agents' own folders ("This Mac"). */
export const NATIVE_PROFILE = "native";

/** Every sign-in the feed lists, by the profile it is in. */
export function personaProfiles(sets: readonly AgentProfileSet[]): ReadonlyMap<string, string> {
  const map = new Map<string, string>();
  for (const set of sets) for (const persona of set.personas) map.set(persona.profileId, set.id);
  return map;
}

/**
 * The profile a row's session runs under, or undefined for a row under none.
 *
 * fieldd's word first (`profileSet`, puppeteer's own record of the set the
 * run was born under); then the set its sign-in is listed in; a local agent
 * with neither runs in the agent's own folder, which is This Mac. A bare
 * terminal and a peer's session run under no profile of this device's: under
 * a chosen tab they recede. A sign-in the feed no longer lists (signed out,
 * its sessions still running) is unknown here rather than guessed.
 */
export function agentProfileSet(
  agent: MonitorAgent,
  personas: ReadonlyMap<string, string>,
): string | undefined {
  if (agent.remote !== undefined) return undefined;
  const facet = agent.agent;
  if (facet === undefined) return undefined;
  if (facet.profileSet !== undefined) return facet.profileSet;
  if (facet.profileId !== undefined) return personas.get(facet.profileId);
  return NATIVE_PROFILE;
}

/** The strip is worth drawing once a profile besides This Mac exists: All
 * beside This Mac alone says nothing. */
export function showsProfileTabs(sets: readonly AgentProfileSet[]): boolean {
  return sets.some((set) => set.kind === "managed");
}

/** The tabs, in the feed's order (This Mac first), each with the one orange
 * dot when a session under it is blocked. */
export function profileTabs(
  sets: readonly AgentProfileSet[],
  agents: readonly MonitorAgent[],
  personas: ReadonlyMap<string, string>,
): ProfileTab[] {
  const blocked = new Set<string>();
  for (const agent of agents) {
    if (agent.status !== "blocked") continue;
    const set = agentProfileSet(agent, personas);
    if (set !== undefined) blocked.add(set);
  }
  return sets.map((set) => ({
    id: set.id,
    label: set.label,
    kind: set.kind,
    ...(set.glyph !== undefined ? { glyph: set.glyph } : {}),
    isDefault: set.default,
    ...(blocked.has(set.id) ? { blocked: true } : {}),
  }));
}

/** The chosen tab as the feed still has it: a profile deleted while chosen
 * falls back to All (null), and so does every choice while the strip is not
 * drawn. */
export function chosenProfile(
  sets: readonly AgentProfileSet[],
  selected: string | null,
): AgentProfileSet | undefined {
  if (selected === null || !showsProfileTabs(sets)) return undefined;
  return sets.find((set) => set.id === selected);
}

/** The rows as the stage draws them under a chosen profile: its own sessions
 * as they are, every other one receded (it keeps its place). */
export function recedeOutside(
  agents: readonly MonitorAgent[],
  chosen: string | undefined,
  personas: ReadonlyMap<string, string>,
): readonly MonitorAgent[] {
  if (chosen === undefined) return agents;
  return agents.map((agent) =>
    agentProfileSet(agent, personas) === chosen ? agent : { ...agent, receded: true },
  );
}
