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
 * the batch could not be read at all (ruling 10); `at`, a now of its own in place of the batch's (`nows`): the batch
 * read later, after a window's reset has come (the phone's common case, UM-D8). */
export interface UsageBandsMeters {
  sets: string;
  batch: string;
  of: string;
  usage?: "unavailable";
  at?: string;
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

/** A reading's window as the golden records it: Settings' C1 line, and what the meters add to it. A reset a day or
 * more off is recorded by its form (`resetForm`: "day") and its minutes, its words left out: Settings says it by its
 * day and clock, in the reader's own zone and locale, so the phone says it in its own. */
function windowRecord(window: MeterWindow): Record<string, unknown> {
  const form = resetForm(window);
  const { reset, ...line } = window.line;
  return {
    ...line,
    ...(reset !== undefined && form !== "day" ? { reset } : {}),
    resetForm: form,
    budget: window.budget,
    lengthWords: window.lengthWords,
    durationMinutes: window.metric.durationMinutes,
    resetIn: window.resetIn,
    passed: window.passed,
    pressure: window.pressure,
    forecast: window.forecast,
  };
}

/** An entry as the golden records it: a reading's windows as above, its tightest by id, and a right that says a
 * reset by its day recorded by its form, as its window is. */
function entryRecord(entry: PlanMeter): Record<string, unknown> {
  const record: Record<string, unknown> = { ...entry };
  if (entry.kind === "reading") {
    record.windows = entry.windows.map(windowRecord);
    record.tightest = entry.tightest.line.id;
    if (entry.right.kind === "reset" && resetForm(entry.tightest) === "day") {
      const { kind, hot, icon } = entry.right;
      record.right = { kind, resetForm: "day", hot, icon };
    }
  }
  return record;
}

/** Settings' words for every reset a day or more off in these meters: what the golden must never write. */
function dayWords(meters: ProfileMeters): string[] {
  return meters.entries.flatMap((entry) =>
    entry.kind !== "reading"
      ? []
      : entry.windows.flatMap((window) =>
          resetForm(window) === "day" && window.line.reset !== undefined ? [window.line.reset] : [],
        ),
  );
}

const metersKey = (meters: UsageBandsMeters): string =>
  [meters.sets, meters.batch, meters.of, meters.usage ?? "", meters.at ?? ""].join("\u0000");

/**
 * The golden: every distinct meters the cases draw (each profile's entries in UM-D15's order, its tightest plan, its
 * hot rule), each case's circle, and UM-D4's forecast over a fixed vector. Each batch is read at its own now
 * (`nows`, by the batch's name), minutes after its reading, as a live view reads it, unless the case names a now of
 * its own (`at`: hours later, after a reset). A reset a day or more off is written by its form, never its words
 * (`windowRecord`); one that would reach the file anyway is refused.
 */
export function usageBandsGolden(input: {
  note: string;
  nows: Readonly<Record<string, string>>;
  inputs: UsageBandsInputs;
  cases: readonly UsageBandsCase[];
  forecasts: readonly ForecastInput[];
}): Record<string, unknown> {
  const computed = new Map<string, { of: UsageBandsMeters; meters: ProfileMeters }>();
  const metersOf = (of: UsageBandsMeters): ProfileMeters => {
    const key = metersKey(of);
    const known = computed.get(key);
    if (known !== undefined) return known.meters;
    const sets = input.inputs.sets[of.sets];
    const rows = input.inputs.batches[of.batch];
    const at = of.at ?? input.nows[of.batch];
    if (sets === undefined || rows === undefined || at === undefined) {
      throw new Error(`usage bands golden: no input or now named ${of.sets} or ${of.batch}`);
    }
    const now = new Date(at);
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
    computed.set(key, {
      of: {
        sets: of.sets,
        batch: of.batch,
        of: of.of,
        ...(of.usage !== undefined ? { usage: of.usage } : {}),
        ...(of.at !== undefined ? { at: of.at } : {}),
      },
      meters,
    });
    return meters;
  };
  const circles = input.cases.map(({ name, where, size, options, ...of }) => {
    // the circle says whose it is in its options (`every`), so the phone draws it from what the golden records
    if ((options.every === true) !== (of.of === "every")) {
      throw new Error(
        `usage bands golden: "${name}" draws ${of.of}'s meters with every ${options.every}`,
      );
    }
    return {
      name,
      where,
      ...of,
      options,
      ...bandsGeometry(size, metersOf(of).entries, options),
    };
  });
  const golden = hundredths({
    "//": input.note,
    inputs: {
      sets: Object.keys(input.inputs.sets),
      batches: Object.keys(input.inputs.batches),
    },
    nows: input.nows,
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
  const written = JSON.stringify(golden);
  for (const { meters } of computed.values()) {
    for (const words of dayWords(meters)) {
      if (written.includes(JSON.stringify(words).slice(1, -1))) {
        throw new Error(
          `usage bands golden: a reset said by its day ("${words}", the reader's zone) reached the file`,
        );
      }
    }
  }
  return golden;
}
