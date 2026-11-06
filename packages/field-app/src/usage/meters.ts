import type {
  AgentAccountUsageEntry,
  AgentAccountUsageMetric,
  AgentProfileSet,
  AgentSignInService,
} from "@vibefield/contracts";
import type { UsageLine } from "../panels/agents/profiles-model";

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

/** Settings' `resetWords` says a reset this many minutes off, or more, by its day and clock. */
export const RESET_BY_DAY_MINUTES = 24 * 60;

// UM-1 (red): the model's rules are stubs until the green commit.
export function resetForm(_window: MeterWindow): "length" | "day" | "now" | undefined {
  return undefined;
}
export function durationWords(_minutes: number): string {
  return "";
}
export function forecastOf(_window: {
  usedPercent: number;
  elapsedPercent?: number | undefined;
  durationMinutes?: number | undefined;
  resetIn?: number | undefined;
  budget: boolean;
}): MeterForecast | undefined {
  return undefined;
}
export function meterWindows(
  _metrics: readonly AgentAccountUsageMetric[],
  _now: Date,
): MeterWindow[] {
  return [];
}
export function tightestWindow(_windows: readonly MeterWindow[]): MeterWindow | undefined {
  return undefined;
}
export function agentName(provider: string): string {
  return provider;
}
export function planMeters(
  _set: AgentProfileSet,
  _rows: readonly AgentAccountUsageEntry[],
  _now: Date,
  _installed?: ReadonlySet<string>,
): ProfileMeters {
  return { entries: [], hot: false };
}
