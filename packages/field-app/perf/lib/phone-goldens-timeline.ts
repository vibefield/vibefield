import type { AgentView } from "@vibefield/puppeteer-view-sdk/model";
import {
  DEFAULT_PROJECT_TINT,
  formatElapsed,
  laneWaitWords,
  projectColour,
  projectName,
} from "@vibefield/puppeteer-view-sdk/toolkit";
import {
  addCoverage,
  capsStart,
  clampSpan,
  DEFAULT_SPAN_MS,
  dayStart,
  earliestHead,
  followNow,
  glideTween,
  headAt,
  initialScale,
  islandEase,
  laneAlpha,
  laneContentKey,
  laneLabel,
  laneName,
  laneSubLine,
  neck,
  normalizeTimelineParameters,
  PULSE_GEOMETRY,
  type PulseBand,
  panBy,
  pulseMap,
  pulseRowsFor,
  pulseScales,
  QUIET_ALPHA,
  readoutAt,
  type ScaleTween,
  settledScale,
  smooth,
  stateAt,
  TIMELINE_HORIZON_MS,
  type TimelineLane,
  type TimelineLaneSet,
  type TimelineReadout,
  type TimelineScale,
  tickStep,
  ticksBetween,
  timelineLanes,
  tweenAt,
  tweenBetween,
  tweenTarget,
  type WakeSegment,
  wakeGradient,
  wakeOutline,
  wakeRadius,
  wakeSegments,
  wakeSheens,
  ZOOM_PRESETS,
  zoomAt,
} from "@vibefield/puppeteer-views";
import type { PhoneViewGolden, PhoneViewInput } from "./phone-goldens";

/**
 * PG-6 — THE PHONE'S TIMELINE VIEW, ITS MODEL GOLDEN: puppeteer-views' timeline (0.3.3, `views/timeline/`, its last
 * change `5abe8f75`) over the home's window rows at every step of the witness run, which the kit's
 * `Godview/Timeline/` transcribes and is held to (`Tests/FieldHomeTests/Timeline*ParityTests.swift`, through the
 * byte-identical copy CIF holds).
 *
 * What the phone draws is RUNTIME ONLY: the SDK's contract lends it no `history` (`view.d.ts:132-137`, DESIGN.md
 * "Runtime only where no record is lent"), so every lane runs birth → now and no lane has a past or an end. The compute
 * refuses a lane that has either (never over a defect).
 *
 * The rows' colour: the window computes with no theme, so every row wears `currentColor` (puppeteer-monitor
 * `replica.js:9-10`). The phone deals a project's colour from ITS ledger (`ProjectLedger.dealing` over the drawn
 * agents' project keys in drawn order, cumulatively, `FieldBubble.swift:331`), so this compute deals the same way and
 * colours with the SDK's `projectColour(seq, DEFAULT_PROJECT_TINT.light)`; a terminal wears no colour on the phone
 * (`""`), and the timeline never draws one.
 *
 * The clock is `PHONE_BODY_NOW_MS`, following now on the default hour. The geometry is the kit device's stage: the
 * narrow columns at 402 pt (`TimelineView.js` `columnsFor` :46-50, the view's own, held by the kit's hand row), so the
 * track is 298 px, lanes 36 (`laneMax`) and terminals 18 (`TERMINAL_LANE` :36), the map 298 − 14 (`MAP_LEFT` :38).
 */

const MINUTE = 60_000;
/** The track at the kit device's 402 pt: 402 − the narrow head column, 104 (`columnsFor`, TimelineView.js:46-50). */
const TRACK = 298;
/** The map's width: the track less its left inset (`MAP_LEFT`, TimelineView.js:38). */
const MAP_WIDTH = TRACK - 14;
/** A bare terminal's lane (`TERMINAL_LANE`, TimelineView.js:36). */
const TERMINAL_H = 18;
/** Looking back from now, in minutes: inside most current spans, before them, and before most births. */
const BACK_MINUTES = [1, 30, 54] as const;
/** The held scale the open's second wake set is drawn at: looking back 20 minutes, the 15 minute preset. */
const HELD = { backMs: 20 * MINUTE, spanMs: 15 * MINUTE } as const;

/** A number the golden carries: JSON's own, or a tag for what JSON cannot hold. */
type Tagged = number | "NaN" | "Infinity" | "-Infinity";
function untag(value: Tagged): number {
  if (value === "NaN") return Number.NaN;
  if (value === "Infinity") return Number.POSITIVE_INFINITY;
  if (value === "-Infinity") return Number.NEGATIVE_INFINITY;
  return value;
}

const NOTE =
  "PG-6 — the phone's timeline view golden: puppeteer-views 0.3.3's timeline (views/timeline, 5abe8f75; the SDK's lane-words and formatElapsed) over the home's window rows at every step of PG-3a's witness run (phone-goldens.ts windowRows), at PHONE_BODY_NOW_MS, following now on the default hour. RUNTIME ONLY: the phone is lent no history (view.d.ts:132-137), so no lane has a past or an end (the compute refuses one). Colours: the window rows wear currentColor (no theme), so the compute deals as the phone's ProjectLedger does (each step's drawn agents' projectName keys in drawn order, cumulatively) and colours with projectColour(seq, DEFAULT_PROJECT_TINT.light); a terminal wears \"\". The stage is the kit device's: the track 298 px (columnsFor at 402 pt), lanes 36, terminals 18, the map 284. Per step: agents and terminals (birth order; each lane's bornMs, sinceMs, status, fromMs, wait, colour, name, sub, label, its live readout and its readouts looking back 1, 30 and 54 minutes with stateAt's kind, and laneAlpha at no light), laneContentKey, dayStart and earliestHead for the four presets, each lane's wake at the default scale (segments, capsStart, the outline, the gradient by status, the sheens; cy at half the lane), and the map's summary (its rows, start, count, band order, base, kUp, kDn, and each band's top and bottom summed in order). The open step adds what a fixed vector holds: the map's arrays whole (Float32 values), the wakes at a held scale (20 minutes back, 15 minutes wide), and the calls (the scale words; tickStep; ticksBetween pinned ZONE-FREE by wall components, each tick an offset from its window's start and its hour flag, the instant never recorded, mid-month weekdays outside 01:00-03:59; formatElapsed; laneWaitWords; normalizeTimelineParameters; laneAlpha; wakeRadius; the outline, gradient, sheens and necks over synthetic runs; addCoverage, smooth and pulseScales). A non-JSON input is a tagged string. Reached through puppeteer-views' root exports and puppeteer-view-sdk's ./toolkit. Not here: the paint (by eye, the still pair; its hours read the local zone), the layout (TimelineView-private, the kit's hand rows). GENERATED by packages/field-app/perf/phone-goldens.generate.perf.ts (pnpm --filter @vibefield/field-app phone:goldens), pinned byte for byte by packages/field-app/test/phone-parity.test.ts, the kit's copy by pnpm check:ios-fixtures. A puppeteer EL8 moves it: regenerate and copy to the kit in the same commit. Never edit by hand; a regeneration is a re-bless, said in its commit, and never over a defect.";

/** A readout as the golden records it; a recorded one is a defect here (no history). */
function readout(value: TimelineReadout): {
  tone: string;
  big: string;
  small: string;
  owed: boolean;
} {
  if (value.recorded === true) throw new Error(`a readout from a record: ${JSON.stringify(value)}`);
  return { tone: value.tone, big: value.big, small: value.small, owed: value.owed };
}

/** One lane, as the golden records it: the model, its words and its readouts. */
function laneRecord(lane: TimelineLane, index: number, nowMs: number): Record<string, unknown> {
  if (lane.past !== undefined || lane.ended !== undefined)
    throw new Error(`${lane.id}: a lane with a record, but the phone is lent no history`);
  const current = lane.current;
  return {
    id: lane.id,
    kind: lane.kind,
    bornMs: lane.bornMs,
    sinceMs: lane.sinceMs,
    status: current.status,
    fromMs: current.fromMs,
    wait:
      current.wait === undefined
        ? null
        : { kind: current.wait.kind, detail: current.wait.detail ?? null },
    receded: lane.receded,
    colour: lane.colour,
    name: laneName(lane),
    sub: laneSubLine(lane),
    label: laneLabel(lane, nowMs),
    live: readout(readoutAt(lane, stateAt(lane, nowMs), nowMs, true, nowMs)),
    back: BACK_MINUTES.map((minutes) => {
      const at = nowMs - minutes * MINUTE;
      const moment = stateAt(lane, at);
      return {
        minutes,
        moment: moment.kind,
        ...readout(readoutAt(lane, moment, at, false, nowMs)),
      };
    }),
    alpha: laneAlpha(lane, index, -1),
  };
}

/** The lane's height: a terminal's own, an agent's `laneMax` at its default. */
function laneHeight(lane: TimelineLane): number {
  return lane.kind === "terminal" ? TERMINAL_H : normalizeTimelineParameters(undefined).laneMax;
}

/** A run of segments' outline, gradient and sheens at `cy`, as the paint takes them. */
function shapeOf(segments: readonly WakeSegment[], cy: number, cap: boolean) {
  return {
    outline: wakeOutline(segments, cy, cap),
    gradient: wakeGradient(segments, (segment) => segment.status),
    sheens: wakeSheens(segments, cy),
  };
}

/** One lane's wake between `t0` and `t1`, as `paintWakes` builds it (its live arm), lane-local (cy at half the lane). */
function wakeRecord(
  lane: TimelineLane,
  t0: number,
  t1: number,
  nowMs: number,
): Record<string, unknown> {
  const h = laneHeight(lane);
  const k = TRACK / Math.max(1, t1 - t0);
  const segments = wakeSegments(lane, t0, t1, k, h, nowMs);
  const first = segments[0];
  const caps = first === undefined ? null : capsStart(lane, first);
  return { id: lane.id, h, segments, caps, ...shapeOf(segments, h / 2, caps ?? false) };
}

function sum(values: Float32Array): number {
  let total = 0;
  for (const value of values) total += value;
  return total;
}

/** The map of the day as the draw computes it at the default span (TimelineView.js:503, :512). */
function pulseOf(set: TimelineLaneSet, nowMs: number) {
  const start = dayStart(set, DEFAULT_SPAN_MS, nowMs);
  const rows = pulseRowsFor(set.agents, nowMs);
  const map = pulseMap(rows, start, nowMs, { ...PULSE_GEOMETRY, width: MAP_WIDTH });
  const bands: Array<[string, Pick<PulseBand, "top" | "bottom">]> = [
    ...map.work.map((band): [string, PulseBand] => [band.color, band]),
    ["blocked", map.blocked],
    ["unseen", map.unseen],
  ];
  return { start, rows, map, bands };
}

function pulseSummary(set: TimelineLaneSet, nowMs: number): Record<string, unknown> {
  const { start, rows, map, bands } = pulseOf(set, nowMs);
  return {
    start,
    rows,
    count: map.xs.length,
    bands: map.work.map((band) => band.color),
    base: map.base,
    kUp: map.kUp,
    kDn: map.kDn,
    sums: bands.map(([band, edges]) => ({ band, top: sum(edges.top), bottom: sum(edges.bottom) })),
  };
}

/** The open step's whole map: every array, one line each. */
function pulseArrays(set: TimelineLaneSet, nowMs: number): Array<Record<string, unknown>> {
  const { map, bands } = pulseOf(set, nowMs);
  return [
    { band: "xs", values: Array.from(map.xs) },
    ...bands.flatMap(([band, edges]) => [
      { band, edge: "top", values: Array.from(edges.top) },
      { band, edge: "bottom", values: Array.from(edges.bottom) },
    ]),
  ];
}

/** The scale words over a fixed vector, at the golden's clock. */
function scaleCalls(nowMs: number): Array<Record<string, unknown>> {
  const hour = 60 * MINUTE;
  const earliest = nowMs - 23 * hour;
  const held: TimelineScale = { spanMs: hour, endMs: nowMs - 30 * MINUTE, live: false };
  const live: TimelineScale = { spanMs: hour, endMs: nowMs - 5_000, live: true };
  const calls: Array<Record<string, unknown>> = [];
  for (const spanMs of [-5, 0, 299_999, 300_000, 3_600_000, 86_400_000, 86_400_001, 1e12])
    calls.push({ fn: "clampSpan", spanMs, out: clampSpan(spanMs) });
  for (const spanMs of [undefined, 900_000, 60_000, 1e9])
    calls.push({
      fn: "initialScale",
      nowMs,
      spanMs: spanMs ?? null,
      out: spanMs === undefined ? initialScale(nowMs) : initialScale(nowMs, spanMs),
    });
  for (const scale of [live, held, { ...live, endMs: nowMs }])
    calls.push({ fn: "followNow", scale, nowMs, out: followNow(scale, nowMs) });
  for (const [endMs, earliestMs] of [
    [nowMs + 1e6, earliest],
    [nowMs - 399, earliest],
    [nowMs - 400, earliest],
    [nowMs - 10 * MINUTE, earliest],
    [earliest - 1e6, earliest],
    [nowMs - 10 * MINUTE, nowMs + hour],
  ] as const)
    calls.push({
      fn: "headAt",
      scale: held,
      endMs,
      nowMs,
      earliestMs,
      out: headAt(held, endMs, nowMs, earliestMs),
    });
  for (const deltaMs of [-5 * MINUTE, 29.9 * MINUTE, 31 * MINUTE, -24 * hour])
    calls.push({
      fn: "panBy",
      scale: held,
      deltaMs,
      nowMs,
      earliestMs: earliest,
      out: panBy(held, deltaMs, nowMs, earliest),
    });
  for (const [scale, spanMs, anchor, width] of [
    [live, 15 * MINUTE, 0, TRACK],
    [held, 4 * hour, 0, TRACK],
    [held, 15 * MINUTE, 100, TRACK],
    [held, 15 * MINUTE, TRACK, TRACK],
    [held, 4 * hour, 50, 0],
    [{ spanMs: hour, endMs: nowMs - MINUTE, live: false }, 4 * hour, TRACK, TRACK],
    [held, 1, 10, TRACK],
  ] as const)
    calls.push({
      fn: "zoomAt",
      scale,
      spanMs,
      anchorFromHeadPx: anchor,
      widthPx: width,
      nowMs,
      out: zoomAt(scale, spanMs, anchor, width, nowMs),
    });
  for (const x of [-0.5, 0, 0.001, 0.1, 0.25, 1 / 3, 0.5, 0.75, 0.9, 0.999, 1, 1.5])
    calls.push({ fn: "islandEase", x, out: islandEase(x) });
  const from: TimelineScale = { spanMs: hour, endMs: nowMs - 10 * MINUTE, live: false };
  const toLive: TimelineScale = { spanMs: 15 * MINUTE, endMs: nowMs, live: true };
  const toHeld: TimelineScale = { spanMs: 4 * hour, endMs: nowMs - 40 * MINUTE, live: false };
  // each tween with what made it: `target` null is a glide (glideTween), `durationMs` null tweenBetween's default
  const made: Array<{
    name: string;
    target: TimelineScale | null;
    at: number;
    durationMs: number | null;
    tween: ScaleTween;
  }> = [
    {
      name: "toLive",
      target: toLive,
      at: 1_000,
      durationMs: null,
      tween: tweenBetween(from, toLive, 1_000),
    },
    {
      name: "toHeld",
      target: toHeld,
      at: 1_000,
      durationMs: 600,
      tween: tweenBetween(from, toHeld, 1_000, 600),
    },
    { name: "glide", target: null, at: 2_000, durationMs: null, tween: glideTween(from, 2_000) },
    {
      name: "instant",
      target: toHeld,
      at: 1_000,
      durationMs: 0,
      tween: tweenBetween(from, toHeld, 1_000, 0),
    },
  ];
  const tweens = made.map(({ name, tween }): [string, ScaleTween] => [name, tween]);
  for (const { name, target, at, durationMs, tween } of made)
    calls.push({ fn: "tween", name, from, target, at, durationMs, out: tween });
  for (const [name, tween] of tweens) {
    calls.push({ fn: "tweenTarget", name, nowMs, out: tweenTarget(tween, nowMs) });
    for (const after of [-10, 0, 60, 120, 240, 300, 600, 900])
      for (const reduced of [false, true]) {
        const at = tween.startedAt + after;
        calls.push({
          fn: "tweenAt",
          name,
          at,
          nowMs,
          reduced,
          out: tweenAt(tween, at, nowMs, reduced),
        });
      }
  }
  calls.push({
    fn: "settledScale",
    scale: held,
    tween: null,
    nowMs,
    out: settledScale(held, null, nowMs),
  });
  for (const [name, tween] of tweens)
    calls.push({
      fn: "settledScale",
      scale: held,
      tween: name,
      nowMs,
      out: settledScale(held, tween, nowMs),
    });
  return calls;
}

/** `tickStep` over each preset's px a ms at the track, the extremes, and a chosen spacing. */
function tickSteps(): Array<Record<string, unknown>> {
  const out: Array<Record<string, unknown>> = [];
  for (const spanMs of [
    5 * MINUTE,
    ...ZOOM_PRESETS.map((preset) => preset.spanMs),
    TIMELINE_HORIZON_MS,
  ]) {
    const pxPerMs = TRACK / spanMs;
    out.push({ pxPerMs, minPx: null, out: tickStep(pxPerMs) });
    for (const minPx of [30, 200]) out.push({ pxPerMs, minPx, out: tickStep(pxPerMs, minPx) });
  }
  out.push({ pxPerMs: 1e-9, minPx: null, out: tickStep(1e-9) });
  return out;
}

/**
 * `ticksBetween`, ZONE-FREE: each window starts at wall components built in the computing host's own zone (and a
 * fraction of a ms), and each tick is recorded as its offset from that start and its hour flag, which are the same in
 * every zone; the instant is never recorded. Mid-month weekdays, outside 01:00-03:59, so no zone's transition moves
 * them (the toolkit golden's rule for formatClock).
 */
const TICK_WINDOWS: ReadonlyArray<{
  wall: readonly [number, number, number, number, number, number, number];
  frac: number;
  durationMs: number;
  step: number;
}> = [
  { wall: [2026, 11, 11, 14, 5, 9, 0], frac: 0, durationMs: 60 * MINUTE, step: 5 * MINUTE },
  { wall: [2026, 7, 15, 9, 58, 30, 250], frac: 0, durationMs: 120 * MINUTE, step: 15 * MINUTE },
  { wall: [2026, 5, 20, 22, 10, 0, 0], frac: 0, durationMs: 240 * MINUTE, step: 60 * MINUTE },
  { wall: [2026, 10, 13, 6, 0, 0, 0], frac: 0, durationMs: 720 * MINUTE, step: 120 * MINUTE },
  { wall: [2026, 2, 17, 12, 30, 0, 999], frac: 0.5, durationMs: 360 * MINUTE, step: 30 * MINUTE },
  { wall: [2025, 12, 16, 18, 45, 59, 0], frac: 0, durationMs: 1_440 * MINUTE, step: 360 * MINUTE },
  { wall: [2026, 3, 11, 10, 0, 0, 0], frac: 0, durationMs: 9 * MINUTE, step: MINUTE },
];
function ticks(): Array<Record<string, unknown>> {
  return TICK_WINDOWS.map(({ wall, frac, durationMs, step }) => {
    const [year, month, day, hours, minutes, seconds, ms] = wall;
    const from = new Date(year, month - 1, day, hours, minutes, seconds, ms).getTime() + frac;
    return {
      wall: [...wall],
      frac,
      durationMs,
      step,
      out: ticksBetween(from, from + durationMs, step).map((tick) => ({
        offset: tick.t - from,
        hour: tick.hour,
      })),
    };
  });
}

const ELAPSED_MS: readonly Tagged[] = [
  0,
  0.5,
  999,
  1_000,
  1_000.9,
  59_999,
  60_000,
  61_000,
  599_999,
  3_599_999,
  3_600_000,
  3_660_000,
  7_500_000,
  86_399_999,
  86_400_000,
  90_061_000,
  864_000_000_000,
  -5_000,
  "NaN",
  "Infinity",
  "-Infinity",
];

/** A wait as `laneWaitWords` reads it: the row's open fields, as the replica carries them. */
type WaitIn = { kind: string; detail?: string; question?: string; tool?: string } | null;
const WAITS: readonly WaitIn[] = [
  null,
  { kind: "permission", tool: "Bash" },
  { kind: "question", question: "  Keep each desktop's rows in the board's order?  " },
  { kind: "question", question: " \t\n " },
  { kind: "question", detail: "", question: "a detail of nothing hides the question" },
  { kind: "failure", detail: "The process exited with code 1." },
  { kind: "question", detail: "the detail wins", question: "over the question" },
  { kind: "permission", question: "a permission's question is never its words" },
  { kind: "question", question: " 　 wide and hard spaces  " },
  { kind: "question", question: "﻿a byte-order mark is trimmed﻿" },
  { kind: "question", question: "\u0085a next-line is kept\u0085" },
  { kind: "failure", detail: "a".repeat(160) },
  { kind: "failure", detail: "a".repeat(161) },
  { kind: "failure", detail: `  ${"b".repeat(160)}  ` },
  { kind: "failure", detail: `${"c".repeat(158)}\u{1F600}` },
  { kind: "failure", detail: `${"d".repeat(159)}\u{1F600}` },
  { kind: "custom-kind", detail: "an unknown kind's detail" },
];

/** `normalizeTimelineParameters` over finite numbers and absences (null: the key is absent). */
const PARAMETERS: ReadonlyArray<{ glow: number | null; laneMax: number | null } | null> = [
  null,
  { glow: null, laneMax: null },
  { glow: 0.5, laneMax: 30 },
  { glow: 3, laneMax: 10 },
  { glow: -1, laneMax: 99 },
  { glow: null, laneMax: 30.5 },
  { glow: 2, laneMax: 24 },
];

/** Synthetic runs for the outline words: a change of width, an equal width, a narrow neck, a lone hair. */
const RUNS: ReadonlyArray<{ cy: number; segments: WakeSegment[] }> = [
  {
    cy: 18,
    segments: [
      { a: 0, b: 10, x0: 0, x1: 50, status: "working", r: 7.5 },
      { a: 10, b: 20, x0: 50, x1: 120, status: "blocked", r: 3.8 },
    ],
  },
  {
    cy: 12,
    segments: [
      { a: 0, b: 5, x0: -30, x1: 40, status: "working", r: 5.28 },
      { a: 5, b: 9, x0: 40, x1: 90.5, status: "working", r: 5.28 },
      { a: 9, b: 12, x0: 90.5, x1: 140, status: "idle", r: 0.85 },
    ],
  },
  {
    cy: 15,
    segments: [
      { a: 0, b: 1, x0: 10, x1: 11, status: "unseen", r: 2.2 },
      { a: 1, b: 2, x0: 11, x1: 11.6, status: "working", r: 4 },
      { a: 2, b: 30, x0: 11.6, x1: 200, status: "working", r: 4 },
    ],
  },
  { cy: 9, segments: [{ a: 0, b: 30, x0: 100, x1: 298, status: "idle", r: 0.6 }] },
  { cy: 18, segments: [] },
];

function outlineCalls(): Array<Record<string, unknown>> {
  return RUNS.flatMap(({ cy, segments }) =>
    [true, false].map((cap) => ({
      cy,
      cap,
      segments,
      necks: segments.slice(1).map((_, index) => neck(segments, index)),
      ...shapeOf(segments, cy, cap),
    })),
  );
}

function pulseCalls(): Array<Record<string, unknown>> {
  const calls: Array<Record<string, unknown>> = [];
  for (const [count, startMs, dt, a, b] of [
    [5, 0, 10, 5, 25],
    [5, 0, 10, 25, 5],
    [5, 0, 10, -10, 100],
    [5, 0, 10, 0.3, 0.7],
    [4, 1_000, 2.5, 1_001.25, 1_009.9],
    [3, 0, 10, 30, 40],
  ] as const) {
    const into = new Float32Array(count);
    into[0] = 0.1;
    addCoverage(into, startMs, dt, a, b);
    calls.push({ fn: "addCoverage", count, seed: 0.1, startMs, dt, a, b, out: Array.from(into) });
  }
  const impulse = new Float32Array(41);
  impulse[20] = 1;
  const step = new Float32Array(40).map((_, index) => (index < 13 ? 0 : index < 30 ? 0.75 : 2));
  const short = Float32Array.from([1, 0, 0.5]);
  for (const [name, values] of [
    ["impulse", impulse],
    ["step", step],
    ["short", short],
  ] as const)
    calls.push({ fn: "smooth", name, in: Array.from(values), out: Array.from(smooth(values)) });
  for (const [maxUp, maxDown, up, down] of [
    [0, 0, 21, 10],
    [2, 1, 21, 10],
    [10, 20, 21, 10],
    [0.4, 5, 21, 10],
    [3.5, 0.2, 21, 10],
  ] as const)
    calls.push({
      fn: "pulseScales",
      maxUp,
      maxDown,
      up,
      down,
      out: pulseScales(maxUp, maxDown, up, down),
    });
  return calls;
}

function radii(): Array<Record<string, unknown>> {
  const out: Array<Record<string, unknown>> = [];
  for (const kind of ["agent", "terminal"] as const)
    for (const status of ["working", "blocked", "unseen", "idle"] as const)
      for (const h of [10, 18, 24, 30, 36, 48])
        out.push({ kind, status, h, out: wakeRadius(kind, status, h) });
  return out;
}

function alphaCalls(): Array<Record<string, unknown>> {
  const out: Array<Record<string, unknown>> = [];
  for (const receded of [false, true])
    for (const lit of [-1, 0, 1]) {
      const lane = { receded, ended: undefined } as unknown as TimelineLane;
      out.push({ receded, index: 0, lit, out: laneAlpha(lane, 0, lit) });
    }
  return out;
}

/** What the open step carries beside its lanes: the fixed vectors and the map whole (Q4, Q5). */
function openOnly(set: TimelineLaneSet, nowMs: number): Record<string, unknown> {
  const lanes = [...set.agents, ...set.terminals];
  const t1 = nowMs - HELD.backMs;
  return {
    pulseArrays: pulseArrays(set, nowMs),
    heldWakes: lanes.map((lane) => wakeRecord(lane, t1 - HELD.spanMs, t1, nowMs)),
    quietAlpha: QUIET_ALPHA,
    scaleCalls: scaleCalls(nowMs),
    tickSteps: tickSteps(),
    ticks: ticks(),
    elapsed: ELAPSED_MS.map((ms) => ({ in: ms, out: formatElapsed(untag(ms)) })),
    waitWords: WAITS.map((wait) => ({
      wait,
      out:
        laneWaitWords(wait === null ? undefined : (wait as Parameters<typeof laneWaitWords>[0])) ??
        null,
    })),
    parameters: PARAMETERS.map((input) => ({
      in: input,
      out: normalizeTimelineParameters(
        input === null
          ? undefined
          : Object.fromEntries(Object.entries(input).filter(([, value]) => value !== null)),
      ),
    })),
    alphaCalls: alphaCalls(),
    radii: radii(),
    outlineCalls: outlineCalls(),
    pulseCalls: pulseCalls(),
  };
}

/** The phone's ledger, dealt as `ProjectLedger.dealing` deals: unseen keys in the order given, never rewound. */
function dealer(): (rows: readonly AgentView[]) => AgentView[] {
  const seqByKey = new Map<string, number>();
  return (rows) => {
    for (const row of rows) {
      if (row.kind !== "agent") continue;
      const key = projectName(row);
      if (!seqByKey.has(key)) seqByKey.set(key, seqByKey.size);
    }
    return rows.map((row) => {
      const seq = row.kind === "agent" ? seqByKey.get(projectName(row)) : undefined;
      return {
        ...row,
        colour: seq === undefined ? "" : projectColour(seq, DEFAULT_PROJECT_TINT.light),
      };
    });
  };
}

function compute({ steps, nowMs }: PhoneViewInput): unknown {
  const deal = dealer();
  return steps.map((step) => {
    const head = { at: step.at, ...(step.frame === undefined ? {} : { frame: step.frame }) };
    if (step.gap === true) return { ...head, gap: true };
    const set = timelineLanes(deal(step.rows ?? []), nowMs);
    const lanes = [...set.agents, ...set.terminals];
    const t0 = nowMs - DEFAULT_SPAN_MS;
    return {
      ...head,
      agents: set.agents.map((lane, index) => laneRecord(lane, index, nowMs)),
      terminals: set.terminals.map((lane, index) =>
        laneRecord(lane, set.agents.length + index, nowMs),
      ),
      key: laneContentKey(lanes),
      day: ZOOM_PRESETS.map((preset) => ({
        preset: preset.id,
        spanMs: preset.spanMs,
        start: dayStart(set, preset.spanMs, nowMs),
        head: earliestHead(set, preset.spanMs, nowMs),
      })),
      wakes: lanes.map((lane) => wakeRecord(lane, t0, nowMs, nowMs)),
      pulse: pulseSummary(set, nowMs),
      ...(step.at === "open" ? openOnly(set, nowMs) : {}),
    };
  });
}

export const golden: PhoneViewGolden = { note: NOTE, compute };
