import { emptySetupLedger } from "@vibefield/contracts";
import { type LimitMomentFact, limitMoment } from "../setup/limit-moment";
import { FIXTURE_NATIVE, FIXTURE_PROFILES_CONTEXT } from "./profiles-fixtures";

// AO-6b — the limit moment as the claims strip says it in the catalog: the
// SHIPPING rule (`setup/limit-moment.ts`) over the profiles' own fixtures. This
// Mac is the only profile, and the usage its first plan's sign-in reads has the
// seven-day window at 92%. No agent is named here: the plan and its reading
// are This Mac's fixture's.

const plan = FIXTURE_NATIVE.plans?.[0];
const namer = FIXTURE_NATIVE.personas.find((persona) => persona.profileId === plan?.namedBy);

/** This Mac's first plan, its week's window at 92% (every other reading as fixed). */
const usage = FIXTURE_PROFILES_CONTEXT.usage.map((entry) =>
  namer !== undefined && entry.provider === namer.provider && entry.profileId === undefined
    ? {
        ...entry,
        metrics: entry.metrics.map((metric) =>
          metric.kind === "window" && metric.durationMinutes === 10_080
            ? { ...metric, usedPercent: 92 }
            : metric,
        ),
      }
    : entry,
);

export const FIXTURE_LIMIT_MOMENT: LimitMomentFact | null = limitMoment(
  [FIXTURE_NATIVE],
  usage,
  emptySetupLedger(),
);
