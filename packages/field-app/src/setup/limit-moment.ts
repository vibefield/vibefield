import type {
  AgentAccountUsageEntry,
  AgentAccountUsageMetric,
  AgentPersona,
  AgentPlan,
  AgentProfileSet,
} from "@vibefield/contracts";
import {
  type SetupLedger,
  type SetupMomentKey,
  setupMomentState,
} from "@vibefield/contracts/setup";
import { planTitle } from "@vibefield/puppeteer-views";
import { accountWords, plural, signInState, usageOf } from "../panels/agents/profiles-model";

// The limit moment (track AO, AO-6b; AO-D11 ruled A and AO-D15 ruled (a) by
// James 2026-10-27, one row since AO-6b3 on his "go with your lean" the same
// day; DESIGN.md §8 "The moments"): the moment someone needs a second
// subscription is the moment it is worth saying. A plan at 90% or more of one
// of its windows, while This Mac is the only profile, offers a profile once,
// on Godview's claims strip. It speaks for what Agent Profiles shows, read as
// the plan's card there reads it. Pure: whether it shows, and what it says.

/** The moment's name in the setup ledger. */
export const LIMIT_MOMENT: SetupMomentKey = "limit";

/** At or past this share of a window, the moment speaks (AO-D11). */
export const LIMIT_PERCENT = 90;

/** What the moment says: the plan, as This Mac's page names it, and its fullest window. */
export interface LimitMomentFact {
  /** the plan's service, for its mark */
  readonly service: AgentPlan["service"];
  /** "Claude Max": the plan as its card on This Mac names it */
  readonly title: string;
  /** the window's use in whole percent, rounded as Godview's usage column beside it rounds */
  readonly usedPercent: number;
  /** "7 days", "5 hours", or the adapter's own label for a window of no length */
  readonly window: string;
  /** the part of the plan the window meters, as Agent Profiles heads it ("Opus only");
   * absent for a window of the whole plan */
  readonly part?: string;
}

/** A plan of This Mac's at the line, before it is known whether its agents are installed. */
export interface LimitCandidate {
  readonly fact: LimitMomentFact;
  /** the plan's agents: This Mac's page lists one that is installed, or signing in */
  readonly holders: ReadonlyArray<{ readonly provider: string; readonly signingIn: boolean }>;
}

/** The facts the moment reads: the stage's own feeds, the setup ledger, and the time. */
export interface LimitMomentInput {
  readonly sets: readonly AgentProfileSet[] | null;
  readonly usage: readonly AgentAccountUsageEntry[] | null;
  readonly ledger: SetupLedger | null;
  readonly now: Date;
}

/** This Mac, while it is the only profile and the moment has not been answered;
 * null before the feeds and the ledger have each answered. */
function onlyThisMac({ sets, usage, ledger }: LimitMomentInput): AgentProfileSet | null {
  if (sets === null || usage === null || ledger === null) return null;
  if (setupMomentState(ledger, LIMIT_MOMENT) !== undefined) return null;
  const [thisMac, ...others] = sets;
  if (thisMac === undefined || others.length > 0 || thisMac.kind !== "native") return null;
  return thisMac;
}

/** A sign-in's reading as its card draws it: available, or kept after a refresh
 * that failed; never the reading of a sign-in that has expired. */
function heldReading(
  usage: readonly AgentAccountUsageEntry[],
  persona: AgentPersona,
): AgentAccountUsageEntry | undefined {
  const reading = usageOf(usage, persona);
  if (reading === undefined || (reading.state !== "available" && reading.stale !== true)) {
    return undefined;
  }
  return signInState(persona, reading) === "expired" ? undefined : reading;
}

/** A reading's fullest window at the line: never a budget, never a standby
 * allowance drawn on after the plan's limits, never a window already past its
 * reset (a reading taken before the reset is not this window's). */
function fullestWindow(
  metrics: readonly AgentAccountUsageMetric[],
  now: Date,
): AgentAccountUsageMetric | undefined {
  let fullest: AgentAccountUsageMetric | undefined;
  for (const metric of metrics) {
    if (metric.kind !== "window" || metric.group?.standby === true) continue;
    if (metric.usedPercent < LIMIT_PERCENT) continue;
    const resets = metric.resetsAt === undefined ? Number.NaN : Date.parse(metric.resetsAt);
    if (resets <= now.getTime()) continue;
    if (fullest === undefined || metric.usedPercent > fullest.usedPercent) fullest = metric;
  }
  return fullest;
}

/** Every plan of This Mac's at the line, fullest first: a plan whose card names
 * its account (an unnamed one draws no windows), read through the sign-in that
 * named it. */
export function limitCandidates(input: LimitMomentInput): LimitCandidate[] {
  const thisMac = onlyThisMac(input);
  if (thisMac === null || input.usage === null) return [];
  const found: Array<{ used: number; candidate: LimitCandidate }> = [];
  for (const plan of thisMac.plans ?? []) {
    if (accountWords(plan.account) === undefined) continue;
    const namer = thisMac.personas.find((persona) => persona.profileId === plan.namedBy);
    const reading = namer === undefined ? undefined : heldReading(input.usage, namer);
    const metric = reading === undefined ? undefined : fullestWindow(reading.metrics, input.now);
    if (metric === undefined) continue;
    const holders = plan.holders
      .map((id) => thisMac.personas.find((persona) => persona.profileId === id))
      .filter((persona): persona is AgentPersona => persona !== undefined)
      .map((persona) => ({
        provider: persona.provider,
        signingIn: persona.signingIn !== undefined,
      }));
    const fact: LimitMomentFact = {
      service: plan.service,
      title: planTitle(plan.service, plan.account?.plan),
      usedPercent: Math.round(metric.usedPercent),
      window: windowWords(metric),
      ...(metric.group !== undefined ? { part: metric.group.label } : {}),
    };
    found.push({ used: metric.usedPercent, candidate: { fact, holders } });
  }
  return found.sort((a, b) => b.used - a.used).map((entry) => entry.candidate);
}

/** The moment: the fullest candidate with an agent on This Mac's page (one that
 * is installed, or signing in), as the plan's card there is shown; null until
 * the inventory has answered. */
export function limitMoment(
  candidates: readonly LimitCandidate[],
  installed: ReadonlySet<string> | null,
): LimitMomentFact | null {
  if (installed === null) return null;
  const shown = candidates.find((candidate) =>
    candidate.holders.some((holder) => holder.signingIn || installed.has(holder.provider)),
  );
  return shown?.fact ?? null;
}

/** Whether a sign-in of This Mac's is at the line with no plan to name it: an
 * account signed in after fieldd last read its identities. Agent Profiles asks
 * fieldd to read them again for that (`agents.profileSets.list {refresh: true}`),
 * and the moment asks once. */
export function unplannedAtTheLine(input: LimitMomentInput): boolean {
  const thisMac = onlyThisMac(input);
  const usage = input.usage;
  if (thisMac === null || usage === null) return false;
  const named = new Set((thisMac.plans ?? []).map((plan) => plan.namedBy));
  return thisMac.personas.some((persona) => {
    if (named.has(persona.profileId)) return false;
    const reading = heldReading(usage, persona);
    return reading !== undefined && fullestWindow(reading.metrics, input.now) !== undefined;
  });
}

/** A window's length as a person says it: "7 days", "5 hours", "30 minutes";
 * the adapter's own label when it reports none. */
export function windowWords(metric: AgentAccountUsageMetric): string {
  const minutes = metric.durationMinutes;
  if (minutes === undefined || !Number.isSafeInteger(minutes) || minutes <= 0) return metric.label;
  if (minutes % 1440 === 0) return plural(minutes / 1440, "day");
  if (minutes % 60 === 0) return plural(minutes / 60, "hour");
  return plural(minutes, "minute");
}
