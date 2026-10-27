import type {
  AgentAccountUsageEntry,
  AgentAccountUsageMetric,
  AgentPlan,
  AgentProfileSet,
} from "@vibefield/contracts";
import {
  type SetupLedger,
  type SetupMomentKey,
  setupMomentState,
} from "@vibefield/contracts/setup";
import { planTitle } from "@vibefield/puppeteer-views";
import { usageOf } from "../panels/agents/profiles-model";

// The limit moment (track AO, AO-6b; AO-D11 ruled A and AO-D15 ruled (a) by
// James 2026-10-27; DESIGN.md §8 "The moments"): the moment someone needs a
// second subscription is the moment it is worth saying. A plan at 90% or more
// of one of its windows, while This Mac is the only profile, offers a profile
// once, on Godview's claims strip. Pure: whether it shows, and what it says.

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
  /** the window's use, in whole percent (never rounded up past what was used) */
  readonly usedPercent: number;
  /** "7 days", "5 hours", or the adapter's own label for a window of no length */
  readonly window: string;
}

/** The moment, or null. Only while the ledger, the profiles and the usage have
 * each answered; never once retired; only while This Mac is the only profile;
 * and only for a plan's own windows (a budget, or a standby allowance drawn on
 * after the plan's limits, is not a plan running out). The fullest window of
 * any of This Mac's plans is the one it names. */
export function limitMoment(
  sets: readonly AgentProfileSet[] | null,
  usage: readonly AgentAccountUsageEntry[] | null,
  ledger: SetupLedger | null,
): LimitMomentFact | null {
  if (sets === null || usage === null || ledger === null) return null;
  if (setupMomentState(ledger, LIMIT_MOMENT) !== undefined) return null;
  const [thisMac, ...others] = sets;
  if (thisMac === undefined || others.length > 0 || thisMac.kind !== "native") return null;
  let fullest: { plan: AgentPlan; metric: AgentAccountUsageMetric } | null = null;
  for (const plan of thisMac.plans ?? []) {
    const namer = thisMac.personas.find((persona) => persona.profileId === plan.namedBy);
    const reading = namer === undefined ? undefined : usageOf(usage, namer);
    if (reading?.state !== "available") continue;
    for (const metric of reading.metrics) {
      if (metric.kind !== "window" || metric.group?.standby === true) continue;
      if (metric.usedPercent < LIMIT_PERCENT) continue;
      if (fullest === null || metric.usedPercent > fullest.metric.usedPercent) {
        fullest = { plan, metric };
      }
    }
  }
  if (fullest === null) return null;
  return {
    service: fullest.plan.service,
    title: planTitle(fullest.plan.service, fullest.plan.account?.plan),
    usedPercent: Math.floor(fullest.metric.usedPercent),
    window: windowWords(fullest.metric),
  };
}

/** A window's length as a person says it: "7 days", "5 hours", "30 minutes";
 * the adapter's own label when it reports none. */
export function windowWords(metric: AgentAccountUsageMetric): string {
  const minutes = metric.durationMinutes;
  if (minutes === undefined || !Number.isSafeInteger(minutes) || minutes <= 0) return metric.label;
  const count = (n: number, unit: string): string => `${n} ${unit}${n === 1 ? "" : "s"}`;
  if (minutes % 1440 === 0) return count(minutes / 1440, "day");
  if (minutes % 60 === 0) return count(minutes / 60, "hour");
  return count(minutes, "minute");
}
