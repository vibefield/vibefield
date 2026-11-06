import { readFileSync } from "node:fs";
import { join } from "node:path";
import { AgentAccountUsageBatch, AgentsProfileSetsListResult } from "@vibefield/contracts";
import {
  type UsageBandsCase,
  type UsageBandsInputs,
  usageBandsGolden,
} from "../../src/usage/golden";
import type { ForecastInput } from "../../src/usage/rules";

// UM-1 (PLAN §4 v0.2, U1 c3) — THE USAGE BANDS GOLDEN'S INPUTS AND BYTES: which contracts fixtures it reads, the one
// now, the circles it draws (each where the product draws it), UM-D4's forecast vector, and the printer. The compute
// is `src/usage/golden.ts` (pure); the writer is `perf/usage-bands.generate.perf.ts`; `test/usage-bands.test.ts`
// compares the committed file with these bytes. Not a phone Godview golden: `perf/lib/phone-goldens.ts` neither
// writes nor reads it, and it carries no puppeteer version.

const FIELD_APP = join(import.meta.dirname, "..", "..");

/** Where the golden lives, beside field-app's other test fixtures. The phone's copy (UM's U3 lane, PH-2) is held to
 * it byte for byte by `pnpm check:ios-fixtures` (`OTHER_ORIGINS`). */
export const USAGE_BANDS_GOLDEN = join(
  FIELD_APP,
  "test",
  "fixtures",
  "usage",
  "usage-bands.golden.json",
);

/** The contracts fixtures it reads: the profile sets (the AR-S2c golden; UM-1's meters set) and the usage batches
 * (the AR-5 golden; UM-1's budget batch). */
export const USAGE_BANDS_SETS = [
  "agents-profile-sets.valid.json",
  "agents-profile-sets.meters.json",
] as const;
export const USAGE_BANDS_BATCHES = ["agent-usage.valid.json", "agent-usage.budget.json"] as const;

/** Each batch's now, as a live view reads it: the AR-5 golden five minutes after its reading, UM-1's budget batch
 * half a minute after its last row (so its kept Codex reading is 32 minutes old). A reset a day or more off is
 * written by its form, never by its day and clock (`src/usage/golden.ts`). */
export const USAGE_BANDS_NOWS: Readonly<Record<(typeof USAGE_BANDS_BATCHES)[number], string>> = {
  "agent-usage.valid.json": "2026-09-13T12:05:00.000Z",
  "agent-usage.budget.json": "2026-09-16T12:00:00.000Z",
};

const VALID = { sets: USAGE_BANDS_SETS[0], batch: USAGE_BANDS_BATCHES[0] } as const;
const METERS = { sets: USAGE_BANDS_SETS[1], batch: USAGE_BANDS_BATCHES[1] } as const;
/** the sizes the ruled drawing draws a circle at, with its options there (draft/profile-meters/round4/src
 * p4f-frames.js, p3f-frames.js) */
const COLUMN = { size: 40, options: { centre: "glyph", hotDot: true } } as const;
const BUD = { size: 54, options: { centre: "glyph", hotDot: true } } as const;
const PAGE_ROW = { size: 36, options: { centre: "glyph", hotDot: true } } as const;

/** The circles: every state the meters draw, at the sizes the product draws them. */
export const USAGE_BANDS_CASES: readonly UsageBandsCase[] = [
  {
    name: "one plan, past its week's limit, a model's week as the hairline",
    where: "the desktop's popover, beside Godview's profiles column",
    ...VALID,
    of: "native",
    size: 212,
    options: { hit: true },
  },
  {
    name: "one plan at the column's size",
    where: "Godview's profiles column",
    ...VALID,
    of: "native",
    ...COLUMN,
  },
  {
    name: "one profile, nothing in the middle",
    where: "the phone's Me menu, its Agent Profiles row, with one profile",
    ...VALID,
    of: "native",
    size: 26,
    options: { centre: "none" },
  },
  {
    name: "a sign-in under way beside plans with no meter",
    where: "the desktop's popover",
    ...VALID,
    of: "work",
    size: 212,
    options: {},
  },
  {
    name: "a sign-in under way at the column's size",
    where: "Godview's profiles column",
    ...VALID,
    of: "work",
    ...COLUMN,
  },
  {
    name: "several plans: their gaps, a budget on both bands, a kept reading, the hairline",
    where: "the desktop's popover",
    ...METERS,
    of: "native",
    size: 212,
    options: { hit: true },
  },
  {
    name: "several plans opened: the full middle, the forecast said",
    where:
      "the drawing's opened circle (round4 p4d-page.js), no view's yet: the one size here past a hole of 46, the middle's window and say line",
    ...METERS,
    of: "native",
    size: 232,
    options: { hit: true },
  },
  {
    name: "several plans, one pointed at: the others dim and the middle speaks for it",
    where: "the desktop's popover",
    ...METERS,
    of: "native",
    size: 212,
    options: { hit: true, focus: "plan:openai" },
  },
  {
    name: "several plans at the column's size, hot",
    where: "Godview's profiles column",
    ...METERS,
    of: "native",
    ...COLUMN,
  },
  {
    name: "several plans as a bud",
    where: "a profile's bud in the held face's bloom",
    ...METERS,
    of: "native",
    ...BUD,
  },
  {
    name: "several plans on a profile's row",
    where: "the phone's Agent Profiles page, a profile's row",
    ...METERS,
    of: "native",
    ...PAGE_ROW,
  },
  {
    name: "several plans held",
    where: "the held face's open circle, a profile reached",
    ...METERS,
    of: "native",
    size: 206,
    options: {},
  },
  {
    name: "needs you: a sign-in and a retry beside a shared plan's reading",
    where: "the desktop's popover",
    ...METERS,
    of: "work",
    size: 212,
    options: { hit: true },
  },
  {
    name: "needs you at the column's size",
    where: "Godview's profiles column",
    ...METERS,
    of: "work",
    ...COLUMN,
  },
  {
    name: "one profile chosen, a need pointed at: the others dim and the middle asks for it",
    where: "the phone's Agent Profiles page, Work chosen (several profiles: crowd marked)",
    ...METERS,
    of: "work",
    size: 214,
    options: { hit: true, crowd: true, focus: "plan:openai" },
  },
  {
    name: "a first read and a sign-in under way",
    where: "the desktop's popover",
    ...METERS,
    of: "side",
    size: 212,
    options: {},
  },
  {
    name: "a first read at the column's size",
    where: "Godview's profiles column",
    ...METERS,
    of: "side",
    ...COLUMN,
  },
  {
    name: "every profile, nothing in the middle",
    where: "the phone's Me menu, its Agent Profiles row, with several profiles",
    ...METERS,
    of: "every",
    size: 26,
    options: { centre: "none" },
  },
  {
    name: "every profile at the All profiles row",
    where: "the phone's Agent Profiles page, its All profiles row",
    ...METERS,
    of: "every",
    size: 36,
    options: { centre: "none" },
  },
  {
    name: "every profile around the face",
    where: "the phone's account corner: 96 across, the hole 34, the band 8",
    ...METERS,
    of: "every",
    size: 96,
    options: { around: { hole: 34, band: 8 } },
  },
  {
    name: "every profile opened: a shared plan once, the crowded agents in their profiles' glyphs",
    where: "the phone's Agent Profiles page with no profile chosen",
    ...METERS,
    of: "every",
    size: 214,
    options: { hit: true, crowd: true },
  },
  {
    name: "usage unavailable: the dashed ring, the profile's glyph kept",
    where: "Godview's profiles column",
    ...METERS,
    of: "native",
    usage: "unavailable",
    ...COLUMN,
  },
  {
    name: "usage unavailable, opened",
    where: "the desktop's popover",
    ...METERS,
    of: "native",
    usage: "unavailable",
    size: 212,
    options: {},
  },
];

/** A window's forecast input with a pace: its share used and gone, its length, the minutes to its reset, and its
 * orange as Settings' pace rule gives it. */
const paced = (
  usedPercent: number,
  elapsedPercent: number,
  durationMinutes: number | undefined,
  resetIn: number,
  hot: boolean,
): ForecastInput => ({
  usedPercent,
  elapsedPercent,
  ...(durationMinutes !== undefined ? { durationMinutes } : {}),
  resetIn,
  budget: false,
  hot,
});

/** UM-D4's forecast over a fixed vector: each rounding (the minute under 10, five under the hour — 57.5 to 60 says
 * "~60m" —, 15 from it), and each refusal (the limit after the reset, not ahead, spent, a budget, no length, no time
 * gone). `hot` is Settings' pace rule for each (`isHot`), as `usageLines` hands it in. */
export const USAGE_BANDS_FORECASTS: readonly ForecastInput[] = [
  paced(97, 58, 300, 126, true),
  paced(99.9, 90, 300, 30, true),
  paced(82, 55, 300, 135, true),
  paced(70, 45.1, 300, 164.7, true),
  paced(64, 50, 300, 150, true),
  paced(86, 70, 10_080, 3024, true),
  paced(50, 10, 43_200, 38_880, true),
  paced(60, 50, 300, 30, true),
  paced(30, 50, 300, 150, false),
  paced(100, 60, 300, 120, true),
  { usedPercent: 90, budget: true, hot: true },
  paced(85, 40, undefined, 180, true),
  paced(50, 0, 300, 300, false),
];

const NOTE =
  "UM-1 (UM-D16 E, Bands; UM-D3, D4, D12, D13, D15; PLAN §4 v0.2) — the usage bands golden: the desktop's meter model (packages/field-app/src/usage/meters.ts: planMeters for one profile, everyPlan for every profile at once — a plan two profiles share is one entry with both profiles; each plan read through Settings' join, namedBy, usageOf, usageLines, signInState; UM-D15's order by the agent catalog; UM-D13's tightest window by pressure, src/usage/rules.ts; the pace rule isHot, a budget pace-less) and its Bands geometry (src/usage/bands.ts bandsGeometry, the ruled drawing's drawBands) over contracts fixtures (inputs), each batch read at its own now (nows), minutes after its reading. meters: each profile (or every) the circles draw, its entries in order (a reading's windows as Settings' C1 lines with resetForm, budget, lengthWords, durationMinutes, resetIn, pressure and forecast — a reset a day or more off is recorded by its form, resetForm day, and its minutes, its words left out, because Settings says it by its day and clock in the reader's own zone and locale; tightest by window id; profiles, the glyphs a crowded agent wears), its tightest plan and its hot rule. circles: per case, where the product draws it, whose meters, the size and options, the level, the centre and its items, each plan's arcs (band, part, r, from, to, width, cap, paint as a tone, opacity, dash), notches, mark (its badge, its profile glyph), hit arc and words, the empty ring or the hot dot, and the label. calls.forecast: UM-D4's forecast over a fixed vector, each {in, out}. A plan is titled by its company's label in the fixture (title), never a product name, and nothing here is puppeteer's: no release moves it. Angles in degrees from three o'clock, clockwise; every number to 0.01. GENERATED by packages/field-app/perf/usage-bands.generate.perf.ts (src/usage/golden.ts computes it), pinned byte for byte by test/usage-bands.test.ts; the phone's copy (UM's U3 lane) by pnpm check:ios-fixtures. Never edit by hand; a regeneration is a re-bless, said in its commit, and never over a defect.";

const contractsFixture = (name: string): unknown =>
  JSON.parse(readFileSync(join(FIELD_APP, "..", "contracts", "fixtures", name), "utf8"));

/** The fixtures, parsed by their contracts (the fixture is the contract). */
export function readUsageBandsInputs(): UsageBandsInputs {
  return {
    sets: Object.fromEntries(
      USAGE_BANDS_SETS.map((name) => [
        name,
        AgentsProfileSetsListResult.parse(contractsFixture(name)).sets,
      ]),
    ),
    batches: Object.fromEntries(
      USAGE_BANDS_BATCHES.map((name) => [
        name,
        AgentAccountUsageBatch.parse(contractsFixture(name)).entries,
      ]),
    ),
  };
}

/** The golden, computed. */
export function usageBandsValue(inputs: UsageBandsInputs = readUsageBandsInputs()) {
  return usageBandsGolden({
    note: NOTE,
    nows: USAGE_BANDS_NOWS,
    inputs,
    cases: USAGE_BANDS_CASES,
    forecasts: USAGE_BANDS_FORECASTS,
  });
}

/** A value that holds nothing deeper than `depth` levels (undefined members left out, as JSON leaves them). */
function flat(value: unknown, depth: number): boolean {
  if (value === null || typeof value !== "object") return true;
  if (depth === 0) return false;
  const members = Array.isArray(value)
    ? value
    : Object.values(value as Record<string, unknown>).filter((item) => item !== undefined);
  return members.every((member) => flat(member, depth - 1));
}

/** One row per line: a value no deeper than its members' own plain members (an arc with its paint and dash, a notch,
 * a window's line) on one line, anything deeper opened; members that are undefined are left out, as JSON leaves
 * them. */
function printed(value: unknown, indent: string): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (flat(value, 2)) return JSON.stringify(value);
  const inner = `${indent}  `;
  if (Array.isArray(value)) {
    return `[\n${value.map((item) => `${inner}${printed(item, inner)}`).join(",\n")}\n${indent}]`;
  }
  const entries = Object.entries(value as Record<string, unknown>).filter(
    ([, item]) => item !== undefined,
  );
  return `{\n${entries
    .map(([key, item]) => `${inner}${JSON.stringify(key)}: ${printed(item, inner)}`)
    .join(",\n")}\n${indent}}`;
}

/** The golden's bytes, as the writer writes them and the test compares them. */
export function usageBandsFile(inputs: UsageBandsInputs = readUsageBandsInputs()): string {
  return `${printed(usageBandsValue(inputs), "")}\n`;
}
