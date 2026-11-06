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
  isHot,
  signInState,
  type UsageLine,
  usageLines,
  usageOf,
} from "../panels/agents/profiles-model";

// UM-1 (track UM; the round-4 page's marks ruled A, UM-D16 = E "Bands" in round 3, and the carried marks UM-D3, D4,
// D13 and D15 at their leans by James's word of 2026-11-06 03:11Z) — ONE PROFILE'S METERS, PURE: every plan an Agent
// Profile runs on, read as Settings reads it, in the order a glance can trust. Godview's profiles column, its
// popover, the phone's Agent Profiles page and its held face all draw from this one model (UM-D3, one meter
// everywhere), and the phone is held to it by the bands golden (`perf/lib/phone-goldens.ts`).
//
// The join is Settings' own (`panels/agents/profiles-model.ts`), reused and never copied: a plan's reading is the
// reading of the sign-in that named its account (`namedBy` → `usageOf`), its windows are Settings' C1 lines
// (`usageLines`), its sign-in is `signInState`'s, and its orange is `isHot`, the pace rule (UM-D3: Godview's flat 80%
// retires). What this file adds is the drawing's (draft/profile-meters/round4/src/p3a-core.js): the tightest window
// by pressure (UM-D13), the forecast (UM-D4), the budget's pace-less rule, and the stable order (UM-D15). AR-L1: no
// agent is named here — the order and the labels are the agent catalog's.

/** UM-D15's three groups, a first read standing with the readings it is waiting for. */
export type MeterKind = "reading" | "first-read" | "needs-you" | "no-meter";

/** What a plan that needs you asks for: a sign-in, or another read. */
export type MeterNeed = "sign-in" | "retry";

/** Why a plan shows no meter: its account is named by no agent here, its agent reports no usage, or its reading
 * holds no window. */
export type NoMeterReason = "unnamed" | "unreported" | "no-windows";

/** UM-D4 — when a window runs out at this pace, said only while it runs ahead and only before its reset. */
export interface MeterForecast {
  /** minutes to the limit at this pace, unrounded */
  minutes: number;
  /** "~35m": rounded as the drawing rounds (to the minute under 10, to 5 under the hour, to 15 from it) */
  words: string;
  /** "out in ~35m": a meter's right words */
  short: string;
  /** "Runs out in ~35m at this pace" */
  long: string;
}

/** One window of a reading, as the meters draw it. */
export interface MeterWindow {
  /** the adapter's meter, as the reading carries it */
  metric: AgentAccountUsageMetric;
  /** Settings' C1 line (`usageLines`). A budget's is pace-less: no now line, orange at 80 or more. */
  line: UsageLine;
  /** a credit budget, which fills both bands */
  budget: boolean;
  /** minutes to the reset, unrounded (negative once it has passed); absent for a window that names no reset and for
   * a budget */
  resetIn?: number;
  /** UM-D13's rank: ahead of pace first, then spent, then the fuller */
  pressure: number;
  forecast?: MeterForecast;
}

/** The words at a meter's right: the forecast while it runs ahead, else the reset; a kept reading says its age. */
export interface MeterRight {
  kind: "forecast" | "reset" | "kept" | "reading" | "need" | "none";
  words: string;
  /** said in the attention ink */
  hot: boolean;
  /** the reset's mark before the words (a window's reset, never a budget's) */
  icon: boolean;
}

interface MeterBase {
  /** stable within the profile: `plan:<id>`, or `agent:<profileId>` for an agent on no plan */
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

/** One profile's meters. */
export interface ProfileMeters {
  /** UM-D15 — readings, then those that need you, then no meter; within each, the catalog's agent order, then the
   * profile's own */
  entries: PlanMeter[];
  /** UM-D13 — the plan whose tightest window is the most pressed */
  tightest?: ReadingMeter;
  /** some plan runs hot by Settings' pace rule (UM-D3): the circle's hot dot */
  hot: boolean;
}

/** Settings' `resetWords` says a reset this many minutes off, or more, by its day and clock ("Thu 09:00", in the
 * reader's own zone and locale), a nearer one as a length ("2h 10m"), and one already past as "now". */
export const RESET_BY_DAY_MINUTES = 24 * 60;

/** How Settings' `resetWords` says a window's reset: as a length, by its day, or "now"; nothing when it names none. */
export function resetForm(window: MeterWindow): "length" | "day" | "now" | undefined {
  if (window.resetIn === undefined) return undefined;
  if (window.resetIn <= 0) return "now";
  return Math.round(window.resetIn) >= RESET_BY_DAY_MINUTES ? "day" : "length";
}

/** A length as the drawing says it: "45m", "2h 10m", "3d 4h" (its `dur`, the carry made exact). */
export function durationWords(minutes: number): string {
  const whole = Math.round(minutes);
  if (whole < 60) return `${Math.max(1, whole)}m`;
  if (whole < 24 * 60) {
    const hours = Math.floor(whole / 60);
    const rest = whole % 60;
    return rest === 0 ? `${hours}h` : `${hours}h ${rest}m`;
  }
  const hours = Math.round(whole / 60);
  const days = Math.floor(hours / 24);
  const rest = hours % 24;
  return rest === 0 ? `${days}d` : `${days}d ${rest}h`;
}

/** UM-D4 — the forecast: at this pace the window is spent before it resets. Never for a budget (pace-less), a
 * window already spent, one whose length or reset is unknown, or one not ahead of pace. */
export function forecastOf(window: {
  usedPercent: number;
  elapsedPercent?: number | undefined;
  durationMinutes?: number | undefined;
  resetIn?: number | undefined;
  budget: boolean;
}): MeterForecast | undefined {
  const { usedPercent: used, elapsedPercent: elapsed, durationMinutes: length, resetIn } = window;
  if (window.budget || length === undefined || elapsed === undefined || resetIn === undefined) {
    return undefined;
  }
  if (used >= 100 || !isHot(used, elapsed)) return undefined;
  // ahead of pace means some time has gone (isHot), so the pace is a positive share per minute
  const perMinute = used / ((elapsed / 100) * length);
  const minutes = (100 - used) / perMinute;
  if (minutes >= resetIn) return undefined;
  const words = `~${
    minutes < 10
      ? `${Math.max(1, Math.round(minutes))}m`
      : minutes < 60
        ? `${Math.round(minutes / 5) * 5}m`
        : durationWords(Math.round(minutes / 15) * 15)
  }`;
  return { minutes, words, short: `out in ${words}`, long: `Runs out in ${words} at this pace` };
}

/** A budget's line without a pace: no now line, and Settings' rule for a window of no known pace (80 or more). */
function paceless(line: UsageLine): UsageLine {
  const kept: UsageLine = {
    id: line.id,
    label: line.label,
    usedPercent: line.usedPercent,
    resets: line.resets,
    hot: isHot(line.usedPercent, undefined),
  };
  if (line.group !== undefined) kept.group = line.group;
  if (line.reset !== undefined) kept.reset = line.reset;
  return kept;
}

/** A reading's windows as the meters draw them: Settings' C1 lines (the windows in play, in the adapter's order),
 * each with its budget, its reset, its pressure and its forecast. */
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
    const line = budget ? paceless(settings) : settings;
    const window: MeterWindow = {
      metric,
      line,
      budget,
      pressure: (line.hot ? 1000 : 0) + (line.usedPercent >= 100 ? 500 : 0) + line.usedPercent,
    };
    if (line.resets && metric.resetsAt !== undefined) {
      window.resetIn = (Date.parse(metric.resetsAt) - now.getTime()) / 60_000;
    }
    const forecast = forecastOf({
      usedPercent: line.usedPercent,
      elapsedPercent: line.elapsedPercent,
      durationMinutes: metric.durationMinutes,
      resetIn: window.resetIn,
      budget,
    });
    if (forecast !== undefined) window.forecast = forecast;
    return [window];
  });
}

/** UM-D13 — the window closest to its limit: the most pressed, the first of equals. */
export function tightestWindow(windows: readonly MeterWindow[]): MeterWindow | undefined {
  let tightest: MeterWindow | undefined;
  for (const window of windows) {
    if (tightest === undefined || window.pressure > tightest.pressure) tightest = window;
  }
  return tightest;
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
  retry: "couldn’t read",
};

function rightOf(window: MeterWindow, stale: boolean, fetchedAt: string, now: Date): MeterRight {
  if (stale) {
    const age = (now.getTime() - Date.parse(fetchedAt)) / 60_000;
    return {
      kind: "kept",
      words: Number.isFinite(age)
        ? `as of ${durationWords(Math.max(0, age))} ago`
        : "as of an earlier reading",
      hot: false,
      icon: false,
    };
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
): PlanMeter {
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
      right: rightOf(tightest, stale, usage.fetchedAt, now),
    };
  }
  if (state === "signed-out" || state === "signing-in" || usage?.state === "unauthenticated") {
    return needs("sign-in");
  }
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
  // unavailable, rate-limited, or a state this build cannot name: it could not be read
  return needs("retry");
}

function planEntry(
  set: AgentProfileSet,
  plan: AgentPlan,
  holder: AgentPersona,
  rows: readonly AgentAccountUsageEntry[],
  now: Date,
): PlanMeter {
  const namer = set.personas.find((persona) => persona.profileId === plan.namedBy);
  const account = accountWords(plan.account);
  const provider = (namer ?? holder).provider;
  const base: MeterBase = {
    key: `plan:${plan.id}`,
    provider,
    agent: agentName(provider),
    // Settings' card's title: the plan's own name once an agent named its account, the product alone before
    title: planTitle(plan.service, account === undefined ? undefined : plan.account?.plan),
    plan: {
      id: plan.id,
      service: plan.service,
      ...(account !== undefined ? { account } : {}),
    },
    ...(namer !== undefined ? { profileId: namer.profileId } : {}),
  };
  if (account === undefined || namer === undefined) {
    return { ...base, kind: "no-meter", why: "unnamed" };
  }
  return readOf(base, namer, rows, now);
}

/**
 * One profile's meters: every plan its agents run on (each once), and every agent of it on no plan, read through
 * Settings' join, in UM-D15's order, with UM-D13's tightest plan and the hot rule. `rows` is the usage batch's
 * entries (empty before the first batch: every metered sign-in is then a first read). `installed`, when given,
 * lists This Mac's agents as Settings' page does — the installed ones and one signing in; absent, every agent.
 */
export function planMeters(
  set: AgentProfileSet,
  rows: readonly AgentAccountUsageEntry[],
  now: Date,
  installed?: ReadonlySet<string>,
): ProfileMeters {
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
    found.push(planEntry(set, plan, holder, rows, now));
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
        },
        persona,
        rows,
        now,
      ),
    );
  }
  // Array.prototype.sort is stable: equals keep the profile's own order
  const entries = found.sort(
    (a, b) => GROUP[a.kind] - GROUP[b.kind] || catalogRank(a.provider) - catalogRank(b.provider),
  );
  let tightest: ReadingMeter | undefined;
  for (const entry of entries) {
    if (entry.kind !== "reading") continue;
    if (tightest === undefined || entry.tightest.pressure > tightest.tightest.pressure) {
      tightest = entry;
    }
  }
  return {
    entries,
    ...(tightest !== undefined ? { tightest } : {}),
    hot: entries.some((entry) => entry.kind === "reading" && entry.hot),
  };
}
