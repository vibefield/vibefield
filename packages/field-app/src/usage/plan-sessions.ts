import type { AgentPersona, AgentProfileSet } from "@vibefield/contracts";
import { planMeters, sharedKey } from "./meters";

// UM-5a (UM-D14; DESIGN.md §8 "Godview's profiles column") — WHICH PLAN A SESSION SPENDS, read from what every run
// already says: its Agent Profile SET and its agent. A set holds at most one account per agent, so the pair names the
// persona, and the provider id is one namespace on every seam (the catalog's id IS puppeteer's, AC-D2). Pure and
// clock-free, so the stage's filter is a value-stable string: a publish of the profile sets that changes nothing moves
// nothing. The phone's `PlanSessions.swift` is the same join, held to it by the usage bands golden.

/** What a run says about itself, as far as the join reads it. */
export interface RunFacet {
  readonly profileSet: string | undefined;
  /** the run's agent; a terminal has none */
  readonly provider: string | undefined;
}

const EPOCH = new Date(0);
const planKey = (setId: string, planId: string): string => `${setId}/plan:${planId}`;
const agentKey = (setId: string, profileId: string): string => `${setId}/agent:${profileId}`;
const runId = (setId: string, provider: string): string => `${setId}\u0000${provider}`;

/** The persona the run is, or nothing. */
function personaOfRun(
  sets: readonly AgentProfileSet[],
  run: RunFacet,
): { set: AgentProfileSet; persona: AgentPersona } | undefined {
  if (run.provider === undefined || run.profileSet === undefined) return undefined;
  const set = sets.find((each) => each.id === run.profileSet);
  const persona = set?.personas.find((each) => each.provider === run.provider);
  return set === undefined || persona === undefined ? undefined : { set, persona };
}

/**
 * The plan a run spends, as the union keys it (`‹set›/plan:‹id›`, `‹set›/agent:‹profileId›`), or undefined when it
 * spends none of this home's: the sign-in the agent runs on decides, and a key on a persona that also holds a plan is
 * pay per use. With no holdings (an older daemon, the tolerant reader), the plan whose holders has it.
 */
export function planKeyOfRun(sets: readonly AgentProfileSet[], run: RunFacet): string | undefined {
  const found = personaOfRun(sets, run);
  if (found === undefined) return undefined;
  const { set, persona } = found;
  const holding = persona.holds?.find((each) => each.runsOn);
  if (holding?.planId !== undefined) return planKey(set.id, holding.planId);
  const held = set.plans?.find((plan) => plan.holders.includes(persona.profileId));
  if (holding !== undefined)
    return held === undefined ? agentKey(set.id, persona.profileId) : undefined;
  return held === undefined ? agentKey(set.id, persona.profileId) : planKey(set.id, held.id);
}

/**
 * The plan and its twins in other profiles, sorted: `everyPlan`'s rule (the same account or borrowed sign-in, in a
 * profile the plan's `alsoIn` names), so a plan two profiles share is one filter. An agent's row, a plan with nothing
 * to share, and a key the feed does not hold are their own family.
 */
export function planFamily(sets: readonly AgentProfileSet[], key: string): readonly string[] {
  const start = sets.flatMap((set) =>
    (set.plans ?? [])
      .filter((plan) => planKey(set.id, plan.id) === key)
      .map((plan) => ({ set, plan })),
  )[0];
  const shared = start === undefined ? undefined : sharedKey(start.plan);
  if (start === undefined || shared === undefined) return [key];
  const family = [start];
  for (let index = 0; index < family.length; index += 1) {
    const { plan: member } = family[index] as (typeof family)[number];
    for (const set of sets) {
      if (!member.alsoIn.includes(set.id)) continue;
      for (const plan of set.plans ?? []) {
        if (sharedKey(plan) !== shared) continue;
        if (family.some((each) => each.set.id === set.id && each.plan.id === plan.id)) continue;
        family.push({ set, plan });
      }
    }
  }
  return family.map((each) => planKey(each.set.id, each.plan.id)).sort();
}

/** Every run on `family`, sorted and joined: the value the stage's memos key on, like a chosen profile's id. */
function runsOfFamily(sets: readonly AgentProfileSet[], family: readonly string[]): string {
  const keys = new Set(family);
  const pairs: string[] = [];
  for (const set of sets) {
    for (const persona of set.personas) {
      const facet = { profileSet: set.id, provider: persona.provider };
      const key = planKeyOfRun(sets, facet);
      if (key !== undefined && keys.has(key)) pairs.push(runId(set.id, persona.provider));
    }
  }
  return pairs.sort().join("\n");
}

/** The runs a key's filter keeps, its twins' too, as a value-stable string. */
export function planRuns(sets: readonly AgentProfileSet[], key: string): string {
  return runsOfFamily(sets, planFamily(sets, key));
}

/** A plan chosen, as the stage, the Peek and the column read it. */
export interface PlanChoice {
  readonly key: string;
  /** the plan as the meters title it */
  readonly label: string;
  readonly provider: string;
  readonly family: readonly string[];
  readonly runs: string;
}

/** The choice a key stands for, or undefined for one the feed no longer has: no token and no filter. */
export function planChoice(sets: readonly AgentProfileSet[], key: string): PlanChoice | undefined {
  for (const set of sets) {
    const prefix = `${set.id}/`;
    if (!key.startsWith(prefix)) continue;
    const bare = key.slice(prefix.length);
    const entry = planMeters(set, [], EPOCH).entries.find((each) => each.key === bare);
    if (entry === undefined) continue;
    const family = planFamily(sets, key);
    return {
      key,
      label: entry.title,
      provider: entry.provider,
      family,
      runs: runsOfFamily(sets, family),
    };
  }
  return undefined;
}

/** Whether a plan (or its twin) is in a profile: what a lens keeps, and what choosing a plan under a lens keeps. */
export function planInProfile(
  sets: readonly AgentProfileSet[],
  key: string,
  setId: string,
): boolean {
  return planFamily(sets, key).some((member) => member.startsWith(`${setId}/`));
}

/** `planRuns` as what `runRecedes` reads; built once, inside a memo keyed on the string. */
export function planRunSet(runs: string): ReadonlySet<string> {
  return new Set(runs === "" ? [] : runs.split("\n"));
}

/** What is chosen. Self-only, as the lens is: a profile and a plan are this desktop's. */
export interface RunLens {
  readonly profile?: string | undefined;
  readonly planRuns?: ReadonlySet<string> | undefined;
}

/** A run as the filter reads it: a live row's or an ended lane's. */
export interface RecedingRun extends RunFacet {
  readonly self: boolean;
}

/** The one predicate the live row and the ended lane both call: a chosen profile keeps its own runs, a chosen plan the
 * runs on it, so under a plan a peer's run and a terminal recede (they spend no plan of this home's). */
export function runRecedes(lens: RunLens, run: RecedingRun): boolean {
  if (lens.profile !== undefined && !(run.self && run.profileSet === lens.profile)) return true;
  if (lens.planRuns === undefined) return false;
  if (!run.self || run.profileSet === undefined || run.provider === undefined) return true;
  return !lens.planRuns.has(runId(run.profileSet, run.provider));
}
