import {
  AGENT_CATALOG_IDS,
  type AgentAccountUsageEntry,
  type AgentAccountUsageMetric,
  type AgentPersona,
  type AgentPlan,
  type AgentProfileSet,
  type AgentSignInService,
  catalogEntry,
  isOffered,
} from "@vibefield/contracts";
import { planTitle } from "@vibefield/puppeteer-views";
import {
  accountWords,
  signInState,
  type UsageLine,
  usageLines,
  usageOf,
} from "../panels/agents/profiles-model";
import {
  ageWords,
  forecastOf,
  type MeterForecast,
  type Pressed,
  pressureOf,
  tightestOf,
  windowWords,
} from "./rules";

// UM-1 (track UM; the round-4 page's marks ruled A, UM-D16 = E "Bands" in round 3, and the carried marks UM-D3, D4,
// D12, D13 and D15 at their leans by James's word of 2026-11-06 03:11Z) — THE PROFILES' METERS, PURE: every plan an
// Agent Profile runs on, read as Settings reads it, in the order a glance can trust; and every profile's at once (the
// union, UM-D12). Godview's profiles column, its popover, the phone's Agent Profiles page and its held face all draw
// from this one model (UM-D3, one meter everywhere), and the phone is held to it by the usage bands golden
// (`test/fixtures/usage/usage-bands.golden.json`, computed by `golden.ts`).
//
// The join is Settings' own (`panels/agents/profiles-model.ts`), reused and never copied: a plan's reading is the
// reading of the sign-in that named its account (`namedBy` → `usageOf`), its windows are Settings' C1 lines
// (`usageLines`), its sign-in is `signInState`'s, and its orange is `isHot`, the pace rule (UM-D3: Godview's flat 80%
// retires). The meter's rules — the tightest window (UM-D13), the forecast (UM-D4), the words for a length (the limit
// moment's too) — are the leaf `rules.ts`'s, which Settings may read too; nothing here reads setup/. The budget's
// pace-less rule (the drawing's) is Settings' own since UM-3e: `usageLines` reads a budget with no now line, orange at
// 80 or more, so the meters' lines ARE Settings' lines, a budget's too. What this file adds is the drawing's
// (draft/profile-meters/round4/src/p3a-core.js): the stable order (UM-D15), and the union of every profile's plans
// (`subsOf`, `subGlyphs`); and the assembled review's window read before its reset (`passed`, DESIGN.md §8 "The Bands
// circle"), the phone's common case under UM-D8. AR-L1: no agent is named here — the order and the labels are the
// agent catalog's.

/** UM-D15's three groups, a first read standing with the readings it is waiting for. */
export type MeterKind = "reading" | "first-read" | "needs-you" | "no-meter";

/** What a plan that needs you asks for: a sign-in, the sign-in already under way (nothing to ask: it is said), or
 * another read. */
export type MeterNeed = "sign-in" | "signing-in" | "retry";

/** Why a plan shows no meter: its account is named by no agent here, its agent reports no usage, its reading holds no
 * window, or the usage door itself could not answer for a plan that would read (ruling 10: the circle is the dashed
 * ring, said "‹profile›: usage unavailable", never a first read that never ends). */
export type NoMeterReason = "unnamed" | "unreported" | "no-windows" | "unavailable";

/** One window of a reading, as the meters draw it. */
export interface MeterWindow {
  /** the adapter's meter, as the reading carries it */
  metric: AgentAccountUsageMetric;
  /** Settings' C1 line (`usageLines`). A budget's is pace-less there since UM-3e: no now line, orange at 80 or more.
   * One read before its reset (`passed`) is never orange. */
  line: UsageLine;
  /** a credit budget, which fills both bands */
  budget: boolean;
  /** its length in words (`windowWords`, as the limit moment says it: "7 days", "5 hours"), or its label when it names
   * none */
  lengthWords: string;
  /** minutes to the reset, unrounded (negative once it has passed); absent for a window that names no reset and for
   * a budget */
  resetIn?: number;
  /** its `resetsAt` is at or before now, whether its reset came before or after its reading (one already past when
   * read says the read's age, ‹for James›), so what it metered is gone: never hot, no forecast, pressure 0 and below
   * every running window (`outranks`), its fill at the kept half (DESIGN.md §8 "The Bands circle", "A window read
   * before its reset"; ‹for James›) */
  passed: boolean;
  /** UM-D13's rank (`pressureOf`): ahead of pace first, then spent, then the fuller; 0 once passed, and a running
   * window wins that tie (`outranks`) */
  pressure: number;
  forecast?: MeterForecast;
}

/** The words at a meter's right: the forecast while it runs ahead, else the reset; a kept reading says its age, and
 * so does one with a window read before its reset (`passed`). */
export interface MeterRight {
  kind: "forecast" | "reset" | "kept" | "passed" | "reading" | "need" | "none";
  words: string;
  /** said in the attention ink */
  hot: boolean;
  /** the reset's mark before the words (a window's reset, never a budget's) */
  icon: boolean;
}

/** A profile a meter is in, as its mark draws it (`ProfileGlyph`: the set's kind — This Mac is the laptop whatever it
 * says —, its glyph token, filled while it is the default) and as it is named. */
export interface MeterProfile {
  setId: string;
  kind: AgentProfileSet["kind"];
  glyph?: string;
  filled: boolean;
  label: string;
}

interface MeterBase {
  /** stable within the view: `plan:<id>`, or `agent:<profileId>` for an agent on no plan; in the union, the first
   * profile holding it, a slash, then that (`work/plan:anthropic`) */
  key: string;
  /** the agent whose mark it wears: the sign-in that reads it */
  provider: string;
  /** the catalog's name for that agent ("Codex"), or its id when this build has no row for it */
  agent: string;
  /** the plan as Settings' card names it ("Claude Max"), or the agent's name for an agent on no plan */
  title: string;
  /** the sign-in whose reading it is */
  profileId?: string;
  /** the plan, when it is one */
  plan?: { id: string; service: AgentSignInService; account?: string };
  /** the profiles it is in: its own, for one profile's meters; in the union (UM-D12), the managed profiles that hold
   * it, else This Mac (the drawing's `subGlyphs`) — what a crowded agent wears under its mark */
  profiles: MeterProfile[];
}

export interface ReadingMeter extends MeterBase {
  kind: "reading";
  /** every window in play, in the adapter's order */
  windows: MeterWindow[];
  /** UM-D13 — the window closest to its limit, by pressure */
  tightest: MeterWindow;
  /** Settings' pace rule on its tightest window (so: on any of its windows) */
  hot: boolean;
  /** the reading is the last good one, kept after a refresh failed */
  stale: boolean;
  /** when the reading was taken */
  fetchedAt: string;
  right: MeterRight;
}
export interface FirstReadMeter extends MeterBase {
  kind: "first-read";
  right: MeterRight;
}
export interface NeedsYouMeter extends MeterBase {
  kind: "needs-you";
  need: MeterNeed;
  right: MeterRight;
}
export interface NoMeter extends MeterBase {
  kind: "no-meter";
  why: NoMeterReason;
}
export type PlanMeter = ReadingMeter | FirstReadMeter | NeedsYouMeter | NoMeter;

/** One profile's meters, or every profile's (`everyPlan`). */
export interface ProfileMeters {
  /** UM-D15 — readings, then those that need you, then no meter; within each, the catalog's agent order, then the
   * profiles' own */
  entries: PlanMeter[];
  /** UM-D13 — the plan whose tightest window is the most pressed */
  tightest?: ReadingMeter;
  /** some plan runs hot by Settings' pace rule (UM-D3): the circle's hot dot */
  hot: boolean;
}

/** How a plan is titled, given whether an agent named its account. */
export type PlanTitle = (plan: AgentPlan, named: boolean) => string;

/** Settings' card's title, the default: the product's own name for the plan once an agent named its account ("Claude
 * Max"), the product alone before ("Claude"). */
export const settingsPlanTitle: PlanTitle = (plan, named) =>
  planTitle(plan.service, named ? plan.account?.plan : undefined);

export interface MetersOptions {
  /** This Mac's agents as Settings' page lists them — the installed ones and one signing in; absent, every agent */
  installed?: ReadonlySet<string>;
  /** how a plan is titled (`settingsPlanTitle` by default) */
  title?: PlanTitle;
  /** the usage batch's own state: "unavailable" when the door refused or could not answer (ruling 10; ruling 17's
   * home that does not share usage), so `rows` holds no reading to wait for — every plan that would read shows no
   * meter ("unavailable"), and one that never reads stays "unreported". Absent, the rows are the batch (empty before
   * its first frame: every metered sign-in is a first read). */
  usage?: "available" | "unavailable";
}

/** A reading's windows as the meters draw them: Settings' C1 lines (the windows in play, in the adapter's order),
 * each with its budget, its length in words, its reset, its pressure and its forecast. */
export function meterWindows(
  metrics: readonly AgentAccountUsageMetric[],
  now: Date,
): MeterWindow[] {
  const byId = new Map<string, AgentAccountUsageMetric>();
  for (const metric of metrics) if (!byId.has(metric.id)) byId.set(metric.id, metric);
  return usageLines(metrics, now).flatMap((settings) => {
    const metric = byId.get(settings.id);
    if (metric === undefined) return [];
    const budget = metric.kind === "budget";
    const resetIn =
      settings.resets && metric.resetsAt !== undefined
        ? (Date.parse(metric.resetsAt) - now.getTime()) / 60_000
        : undefined;
    // read before its reset (DESIGN.md §8 "The Bands circle"): its reset is at or before now, whether it came before
    // or after the reading, so what it metered is gone and it runs ahead of nothing. Only its orange leaves Settings'
    // line; its words and its now line stand.
    const passed = resetIn !== undefined && resetIn <= 0;
    const line: UsageLine = passed ? { ...settings, hot: false } : settings;
    const window: MeterWindow = {
      metric,
      line,
      budget,
      lengthWords: windowWords(metric),
      passed,
      pressure: pressureOf({ hot: line.hot, usedPercent: line.usedPercent, passed }),
    };
    if (resetIn !== undefined) window.resetIn = resetIn;
    const forecast = forecastOf({
      usedPercent: line.usedPercent,
      elapsedPercent: line.elapsedPercent,
      durationMinutes: metric.durationMinutes,
      resetIn: window.resetIn,
      budget,
      hot: line.hot,
    });
    if (forecast !== undefined) window.forecast = forecast;
    return [window];
  });
}

/** What UM-D13 reads of a window: its line's orange and used share, and whether it was read before its reset. */
const pressedOf = (window: MeterWindow): Pressed => ({
  hot: window.line.hot,
  usedPercent: window.line.usedPercent,
  passed: window.passed,
});

/** UM-D13 — a reading's window closest to its limit (`tightestOf` on its lines; one read before its reset, last). */
export function tightestWindow(windows: readonly MeterWindow[]): MeterWindow | undefined {
  return tightestOf(windows, pressedOf);
}

/** The catalog's name for an agent, or its id: a newer peer's agent is carried, never renamed. */
export function agentName(provider: string): string {
  return catalogEntry(provider)?.label ?? provider;
}

/** The catalog's place for an agent; one this build has no row for stands after every row. */
function catalogRank(provider: string): number {
  const index = AGENT_CATALOG_IDS.indexOf(provider);
  return index === -1 ? AGENT_CATALOG_IDS.length : index;
}

const GROUP: Readonly<Record<MeterKind, number>> = {
  reading: 0,
  "first-read": 0,
  "needs-you": 1,
  "no-meter": 2,
};

const NEED_WORDS: Readonly<Record<MeterNeed, string>> = {
  "sign-in": "not signed in",
  "signing-in": "signing in…",
  retry: "couldn't read",
};

function profileOf(set: AgentProfileSet): MeterProfile {
  return {
    setId: set.id,
    kind: set.kind,
    ...(set.glyph !== undefined ? { glyph: set.glyph } : {}),
    filled: set.default,
    label: set.label,
  };
}

function rightOf(
  windows: readonly MeterWindow[],
  window: MeterWindow,
  stale: boolean,
  fetchedAt: string,
  now: Date,
): MeterRight {
  // a kept reading says its age, and so does one with a window read before its reset (DESIGN.md §8 "The Bands
  // circle"): a forecast or a reset read from it would claim a reading it is not
  const aged = stale ? "kept" : windows.some((each) => each.passed) ? "passed" : undefined;
  if (aged !== undefined) {
    // §9's "as of 5m ago" (the leaf's `ageWords`); a reading whose time cannot be read is kept all the same (its fill
    // at half), and says no age rather than words §9 does not rule
    return { kind: aged, words: ageWords(fetchedAt, now), hot: false, icon: false };
  }
  if (window.forecast !== undefined) {
    return { kind: "forecast", words: window.forecast.short, hot: true, icon: false };
  }
  const reset = window.line.reset;
  return reset === undefined
    ? { kind: "none", words: "", hot: window.line.hot, icon: false }
    : { kind: "reset", words: reset, hot: window.line.hot, icon: true };
}

/** A sign-in's meter, read as Settings' card reads it: an expired sign-in first, then a reading (available, or kept
 * after a refresh failed), then what stands in its place. */
function readOf(
  base: MeterBase,
  persona: AgentPersona,
  rows: readonly AgentAccountUsageEntry[],
  now: Date,
  options: MetersOptions,
): PlanMeter {
  if (options.usage === "unavailable") {
    // what needs no batch is decided first: an agent the catalog meters no usage for has nothing it cannot read
    const reads = isOffered(persona.provider, "usage");
    return { ...base, kind: "no-meter", why: reads ? "unavailable" : "unreported" };
  }
  const usage = usageOf(rows, persona);
  const state = signInState(persona, usage);
  const needs = (need: MeterNeed): NeedsYouMeter => ({
    ...base,
    kind: "needs-you",
    need,
    right: { kind: "need", words: NEED_WORDS[need], hot: false, icon: false },
  });
  if (state === "expired") return needs("sign-in");
  if (
    usage !== undefined &&
    (usage.state === "available" || usage.stale === true) &&
    usage.metrics.length > 0
  ) {
    const windows = meterWindows(usage.metrics, now);
    const tightest = tightestWindow(windows);
    if (tightest === undefined) return { ...base, kind: "no-meter", why: "no-windows" };
    const stale = usage.stale === true;
    return {
      ...base,
      kind: "reading",
      windows,
      tightest,
      hot: tightest.line.hot,
      stale,
      fetchedAt: usage.fetchedAt,
      right: rightOf(windows, tightest, stale, usage.fetchedAt, now),
    };
  }
  // Settings says "Signing in…" and offers only its cancel: the meter says the same, and asks nothing
  if (state === "signing-in") return needs("signing-in");
  if (state === "signed-out" || usage?.state === "unauthenticated") return needs("sign-in");
  if (usage === undefined) {
    // no reading yet: one comes for every account an agent the catalog meters signs in to (the first read breathes)
    return isOffered(persona.provider, "usage")
      ? {
          ...base,
          kind: "first-read",
          right: { kind: "reading", words: "reading…", hot: false, icon: false },
        }
      : { ...base, kind: "no-meter", why: "unreported" };
  }
  if (usage.state === "unsupported") return { ...base, kind: "no-meter", why: "unreported" };
  if (usage.state === "available") return { ...base, kind: "no-meter", why: "no-windows" };
  // unavailable, rate-limited (the provider's backoff is the service's: a Retry never spends a call early), or a
  // state this build cannot name: it could not be read
  return needs("retry");
}

function planEntry(
  set: AgentProfileSet,
  plan: AgentPlan,
  holder: AgentPersona,
  rows: readonly AgentAccountUsageEntry[],
  now: Date,
  options: MetersOptions,
): PlanMeter {
  const namer = set.personas.find((persona) => persona.profileId === plan.namedBy);
  const account = accountWords(plan.account);
  const provider = (namer ?? holder).provider;
  const base: MeterBase = {
    key: `plan:${plan.id}`,
    provider,
    agent: agentName(provider),
    title: (options.title ?? settingsPlanTitle)(plan, account !== undefined),
    plan: {
      id: plan.id,
      service: plan.service,
      ...(account !== undefined ? { account } : {}),
    },
    ...(namer !== undefined ? { profileId: namer.profileId } : {}),
    profiles: [profileOf(set)],
  };
  if (account === undefined || namer === undefined) {
    return { ...base, kind: "no-meter", why: "unnamed" };
  }
  return readOf(base, namer, rows, now, options);
}

/** UM-D15's order (a stable sort: equals keep the order given), UM-D13's tightest plan and the hot rule. */
function metersOf(entries: PlanMeter[], rank: (entry: PlanMeter) => number): ProfileMeters {
  entries.sort(
    (a, b) =>
      GROUP[a.kind] - GROUP[b.kind] ||
      catalogRank(a.provider) - catalogRank(b.provider) ||
      rank(a) - rank(b),
  );
  const tightest = tightestOf(
    entries.filter((entry): entry is ReadingMeter => entry.kind === "reading"),
    (entry) => pressedOf(entry.tightest),
  );
  return {
    entries,
    ...(tightest !== undefined ? { tightest } : {}),
    hot: entries.some((entry) => entry.kind === "reading" && entry.hot),
  };
}

/**
 * One profile's meters: every plan its agents run on (each once), and every agent of it on no plan, read through
 * Settings' join, in UM-D15's order, with UM-D13's tightest plan and the hot rule. `rows` is the usage batch's
 * entries; `options` says which of This Mac's agents are listed, how a plan is titled, and whether the batch could be
 * read at all.
 */
export function planMeters(
  set: AgentProfileSet,
  rows: readonly AgentAccountUsageEntry[],
  now: Date,
  options: MetersOptions = {},
): ProfileMeters {
  const { installed } = options;
  const listed = set.personas.filter(
    (persona) =>
      set.kind !== "native" ||
      installed === undefined ||
      installed.has(persona.provider) ||
      persona.signingIn !== undefined,
  );
  const shown = new Map(listed.map((persona) => [persona.profileId, persona]));
  const holding = new Set<string>();
  const found: PlanMeter[] = [];
  for (const plan of set.plans ?? []) {
    const holder = plan.holders.map((id) => shown.get(id)).find((persona) => persona !== undefined);
    if (holder === undefined) continue;
    for (const id of plan.holders) holding.add(id);
    found.push(planEntry(set, plan, holder, rows, now, options));
  }
  for (const persona of listed) {
    if (holding.has(persona.profileId)) continue;
    const agent = agentName(persona.provider);
    found.push(
      readOf(
        {
          key: `agent:${persona.profileId}`,
          provider: persona.provider,
          agent,
          title: agent,
          profileId: persona.profileId,
          profiles: [profileOf(set)],
        },
        persona,
        rows,
        now,
        options,
      ),
    );
  }
  return metersOf(found, () => 0);
}

/** Ruling 7 (AO-D14) — a profile stands on a circle (Godview's column, the phone's hold, its page and its menus) unless
 * it is a draft no agent has signed in to yet. The one rule every view reads, never `draft` alone; `everyPlan` leaves
 * the others out. */
export function hasCircle(set: AgentProfileSet): boolean {
  return set.draft !== true || set.personas.some((persona) => persona.identity?.loggedIn === true);
}

/** Which plan of another profile is this one: the same company and the same account (its handle before its email,
 * as puppeteer's `profileSetPlans` keys it), or the same borrowed sign-in when it names no account. */
function sharedKey(plan: AgentPlan): string | undefined {
  const who = (plan.account?.account ?? plan.account?.email)?.trim().toLowerCase();
  if (who !== undefined && who.length > 0) return `named\u0000${plan.service.id}\u0000${who}`;
  if (plan.borrowedFrom !== undefined) {
    return `via\u0000${plan.service.id}\u0000${plan.borrowedFrom}`;
  }
  return undefined;
}

/** Of two profiles' meters for one shared plan, the one the union shows: a reading, then a first read, then a need. */
const SHOWN: Readonly<Record<MeterKind, number>> = {
  reading: 0,
  "first-read": 1,
  "needs-you": 2,
  "no-meter": 3,
};

/**
 * UM-D12 — every profile's meters at once (the drawing's `subsOf(m, null)`: the Me menu's circle, the held face's hub
 * ring, the page with no profile chosen, the All profiles row): each profile's plans, a plan two profiles share being
 * ONE entry that is in both (the plan's `alsoIn` names the other profile and both name one account, puppeteer's own
 * match). Its meter is the better of the two readings (a reading, then a first read, then a need; equals, the earlier
 * profile's). A profile with no circle (`hasCircle`: a draft no agent has signed in to, ruling 7) is left out. Ordered
 * as UM-D15 orders one profile, then by the first profile holding it, then each profile's own order.
 */
export function everyPlan(
  sets: readonly AgentProfileSet[],
  rows: readonly AgentAccountUsageEntry[],
  now: Date,
  options: MetersOptions = {},
): ProfileMeters {
  interface Held {
    entry: PlanMeter;
    key: string;
    sets: AgentProfileSet[];
    shared?: string;
    first: number;
  }
  const held: Held[] = [];
  const kept = sets.filter(hasCircle);
  for (const [index, set] of kept.entries()) {
    for (const entry of planMeters(set, rows, now, options).entries) {
      const plan =
        entry.plan === undefined
          ? undefined
          : (set.plans ?? []).find((each) => each.id === entry.plan?.id);
      const shared = plan === undefined ? undefined : sharedKey(plan);
      const same =
        plan === undefined || shared === undefined
          ? undefined
          : held.find(
              (other) =>
                other.shared === shared && other.sets.some((each) => plan.alsoIn.includes(each.id)),
            );
      if (same !== undefined) {
        same.sets.push(set);
        if (SHOWN[entry.kind] < SHOWN[same.entry.kind]) same.entry = entry;
        continue;
      }
      held.push({
        entry,
        key: `${set.id}/${entry.key}`,
        sets: [set],
        ...(shared !== undefined ? { shared } : {}),
        first: index,
      });
    }
  }
  const first = new Map<PlanMeter, number>();
  const entries = held.map((each): PlanMeter => {
    const managed = each.sets.filter((set) => set.kind !== "native");
    const entry: PlanMeter = {
      ...each.entry,
      key: each.key,
      profiles: (managed.length > 0 ? managed : each.sets).map(profileOf),
    };
    first.set(entry, each.first);
    return entry;
  });
  return metersOf(entries, (entry) => first.get(entry) ?? 0);
}
