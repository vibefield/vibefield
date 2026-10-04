import type { ProfileTab } from "@vibecook/puppeteer-views";
import type { AgentProfileSet } from "@vibefield/contracts";
import type { MonitorAgent } from "./types";

// AR-S5 — the bar's profile tabs (the agents-settings record's T3), as pure
// functions of the profiles feed and the monitor's rows: which profile a row's
// session runs under, the strip and what a chosen tab recedes. `GodviewMonitor`
// draws them; nothing here dials.

/** The native set's id: the agents' own folders ("This Mac"). */
export const NATIVE_PROFILE = "native";

/**
 * The profile a row's session runs under, or undefined for a row under none.
 *
 * MV-3b: the row's own word, which is the BACKEND's (`resolveProfileSet`):
 * fieldd's `profileSet` for the run first (puppeteer's own record of the set
 * the run was born under), then the set its sign-in is listed in, then This
 * Mac — the same chain this function walked over the fold's row — and for a
 * terminal the profile its shell was born under (SB-3, fieldd's bindings). A
 * peer's session runs under no profile of this device's: under a chosen tab it
 * recedes (`window-rows.ts` drops the owner's set before any reader sees it,
 * and this answers undefined for it regardless). A shell whose profile has
 * since been deleted names no tab and recedes too.
 */
export function agentProfileSet(agent: MonitorAgent): string | undefined {
  if (agent.remote !== undefined) return undefined;
  return agent.profileSet;
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
): ProfileTab[] {
  const blocked = new Set<string>();
  for (const agent of agents) {
    if (agent.status !== "blocked") continue;
    const set = agentProfileSet(agent);
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

/**
 * Rows as the stage draws them under a chosen profile: its own sessions as
 * they are, every other one receded (it keeps its place). The LIVE rows take
 * this from the replica's join (`receded`, the same rule); the timeline's
 * ended lanes take it here. The same list when nothing recedes.
 */
export function recedeOutside(
  agents: readonly MonitorAgent[],
  chosen: string | undefined,
): readonly MonitorAgent[] {
  if (chosen === undefined) return agents;
  let changed = false;
  const receded = agents.map((agent) => {
    if (agentProfileSet(agent) === chosen || agent.receded === true) return agent;
    changed = true;
    return { ...agent, receded: true };
  });
  return changed ? receded : agents;
}
