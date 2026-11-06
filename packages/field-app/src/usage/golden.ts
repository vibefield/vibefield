import type { AgentAccountUsageEntry, AgentProfileSet } from "@vibefield/contracts";
import { type BandsOptions, bandsGeometry } from "./bands";
import {
  everyPlan,
  type MetersOptions,
  type MeterWindow,
  type PlanMeter,
  type PlanTitle,
  type ProfileMeters,
  planMeters,
} from "./meters";
import { type ForecastInput, forecastOf, resetForm } from "./rules";

// UM-1 (PLAN §4 v0.2, U1 c3) — THE USAGE BANDS GOLDEN, COMPUTED: what the meter model (`meters.ts`) and the Bands
// geometry (`bands.ts`) answer over the contracts' profile sets and usage batches, so the phone's port (UM's U3 lane,
// FieldHome/Meters) is held to the desktop's numbers. A VibeField golden, not the phone Godview's: it carries no
// puppeteer version and no product name — a plan is titled here by its company's label from the fixture
// (`GOLDEN_PLAN_TITLE`), never by puppeteer-views' `planTitle`, so no upstream release moves it.
//
// Pure: no file is read or written here. The writer (`perf/usage-bands.generate.perf.ts`) and the byte check
// (`test/usage-bands.test.ts`) read the fixtures and hand them in (`perf/lib/usage-bands-golden.ts`).

/** The golden's title for a plan: its company's label as the fixture names it ("Anthropic"). */
export const GOLDEN_PLAN_TITLE: PlanTitle = (plan) => plan.service.label;

/** The contracts fixtures, parsed: profile-set lists and usage batches, each by its file's name. */
export interface UsageBandsInputs {
  sets: Readonly<Record<string, readonly AgentProfileSet[]>>;
  batches: Readonly<Record<string, readonly AgentAccountUsageEntry[]>>;
}

/** Whose meters: one profile of a list, or every profile of it (UM-D12's union), over one batch; "unavailable" when
 * the batch could not be read at all (ruling 10). */
export interface UsageBandsMeters {
  sets: string;
  batch: string;
  of: string;
  usage?: "unavailable";
}

/** One circle the golden draws: whose meters, at what size, with what options, and where the product draws it. */
export interface UsageBandsCase extends UsageBandsMeters {
  name: string;
  where: string;
  size: number;
  options: BandsOptions;
}

/** Every number to 0.01, so the phone compares within a hundredth. */
function hundredths(value: unknown): unknown {
  if (typeof value === "number") return Math.round(value * 100) / 100;
  if (Array.isArray(value)) return value.map(hundredths);
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, hundredths(item)]));
  }
  return value;
}

/** A reading's window as the golden records it: Settings' C1 line, and what the meters add to it. */
function windowRecord(window: MeterWindow): Record<string, unknown> {
  return {
    ...window.line,
    budget: window.budget,
    lengthWords: window.lengthWords,
    durationMinutes: window.metric.durationMinutes,
    resetIn: window.resetIn,
    pressure: window.pressure,
    forecast: window.forecast,
  };
}

/** An entry as the golden records it: a reading's windows as above, its tightest by id. */
function entryRecord(entry: PlanMeter): Record<string, unknown> {
  const record: Record<string, unknown> = { ...entry };
  if (entry.kind === "reading") {
    record.windows = entry.windows.map(windowRecord);
    record.tightest = entry.tightest.line.id;
  }
  return record;
}

const metersKey = (meters: UsageBandsMeters): string =>
  [meters.sets, meters.batch, meters.of, meters.usage ?? ""].join("\u0000");

/**
 * The golden: every distinct meters the cases draw (each profile's entries in UM-D15's order, its tightest plan, its
 * hot rule), each case's circle, and UM-D4's forecast over a fixed vector. `now` is one instant for every case; a
 * reset it would say by its day and clock is refused, never written, because "Thu 09:00" is the reader's own zone
 * and locale.
 */
export function usageBandsGolden(input: {
  note: string;
  now: string;
  inputs: UsageBandsInputs;
  cases: readonly UsageBandsCase[];
  forecasts: readonly ForecastInput[];
}): Record<string, unknown> {
  // RED SKELETON: nothing is computed yet
  if (input.cases.length >= 0) {
    return { "//": input.note, now: input.now, meters: [], circles: [], calls: { forecast: [] } };
  }
  const now = new Date(input.now);
  const computed = new Map<string, { of: UsageBandsMeters; meters: ProfileMeters }>();
  const metersOf = (of: UsageBandsMeters): ProfileMeters => {
    const key = metersKey(of);
    const known = computed.get(key);
    if (known !== undefined) return known.meters;
    const sets = input.inputs.sets[of.sets];
    const rows = input.inputs.batches[of.batch];
    if (sets === undefined || rows === undefined) {
      throw new Error(`usage bands golden: no input named ${of.sets} or ${of.batch}`);
    }
    const options: MetersOptions = {
      title: GOLDEN_PLAN_TITLE,
      ...(of.usage !== undefined ? { usage: of.usage } : {}),
    };
    let meters: ProfileMeters;
    if (of.of === "every") meters = everyPlan(sets, rows, now, options);
    else {
      const set = sets.find((each) => each.id === of.of);
      if (set === undefined) {
        throw new Error(`usage bands golden: ${of.sets} has no profile ${of.of}`);
      }
      meters = planMeters(set, rows, now, options);
    }
    for (const entry of meters.entries) {
      if (entry.kind !== "reading") continue;
      for (const window of entry.windows) {
        if (resetForm(window) === "day") {
          throw new Error(
            `usage bands golden: ${of.of} ${entry.key} ${window.line.id} would say its reset by its day, the reader's zone; move the golden's now within a day of it`,
          );
        }
      }
    }
    computed.set(key, {
      of: {
        sets: of.sets,
        batch: of.batch,
        of: of.of,
        ...(of.usage !== undefined ? { usage: of.usage } : {}),
      },
      meters,
    });
    return meters;
  };
  const circles = input.cases.map(({ name, where, size, options, ...of }) => ({
    name,
    where,
    ...of,
    options,
    ...bandsGeometry(size, metersOf(of).entries, options),
  }));
  return hundredths({
    "//": input.note,
    inputs: {
      sets: Object.keys(input.inputs.sets),
      batches: Object.keys(input.inputs.batches),
    },
    now: input.now,
    title: "a plan is titled by its company's label in the fixture (service.label)",
    meters: [...computed.values()].map(({ of, meters }) => ({
      ...of,
      entries: meters.entries.map(entryRecord),
      tightest: meters.tightest?.key ?? null,
      hot: meters.hot,
    })),
    circles,
    calls: {
      forecast: input.forecasts.map((each) => ({ in: each, out: forecastOf(each) ?? null })),
    },
  }) as Record<string, unknown>;
}
