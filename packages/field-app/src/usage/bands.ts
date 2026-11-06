import type { MeterProfile, MeterWindow, PlanMeter, ReadingMeter } from "./meters";
import { outranks, resetForm } from "./rules";

// UM-1 (UM-D16 = E, "Bands", round 3, James) — THE BANDS CIRCLE'S GEOMETRY, PURE: every plan of one Agent Profile (or
// of every profile, UM-D12's union) on one circle, an arc segment each, five hours on the inner band, the week on the
// outer, a model's own week as a hairline outside them at full size, a budget filling both. Transcribed from the ruled
// drawing (draft/profile-meters/round4/src/p3e-dials.js: `bandsOf`, `drawBands`, `meterOnArc`, `centreSvg`, `dialSvg`),
// whose detail follows the size: level 0 below 38 px, 1 to 71 (the column's 40), 2 to 149, 3 from 150 (opened). Drawn
// AROUND something round already there (the phone's face: 96 across, the hole 34, the band 8 — the drawing's
// `faceRingSvg`), the bands take the hole's measure instead and draw at level 1 with nothing in the middle.
//
// No DOM and no colour: the arcs, lit heads, notches, need threads, marks, the centre and the hot dot are numbers and
// tones, which the desktop's BandsCircle and the phone's BandsDial draw in DESIGN.md's tokens (the hot dot is
// `--vf-orange`). Angles are degrees, 0 at three o'clock and -90 at the top, clockwise; lengths are pixels (points on
// the phone) in a box `size` square.

/** The detail a circle's size allows. */
export type BandsLevel = 0 | 1 | 2 | 3;

export function bandsLevel(size: number): BandsLevel {
  return size >= 150 ? 3 : size >= 72 ? 2 : size >= 38 ? 1 : 0;
}

/** A tone, never a colour: the ink at a share, the attention orange at a share (a hot fill), white at a share (a hot
 * fill's lit head), or the attention ink of words and marks. */
export type BandsPaint =
  | { tone: "ink"; percent: number }
  | { tone: "hot"; percent: number }
  | { tone: "light"; percent: number }
  | { tone: "attention" };

export interface BandsArc {
  /** the week outside, five hours inside, both (a budget, a need, a first read), a model's week's hairline */
  band: "outer" | "inner" | "both" | "hairline";
  /** a window's track; its fill; one of the six steps of a fill's lit head; the dashed thread of a plan that needs
   * you; a first read's breath; a band with no window of its own */
  part: "track" | "fill" | "head" | "thread" | "breath" | "empty";
  r: number;
  from: number;
  to: number;
  width: number;
  cap: "round" | "butt";
  paint: BandsPaint;
  opacity: number;
  /** a dash and its gap, along the arc */
  dash?: readonly [number, number];
}

/** The time gone, across a window's band. */
export interface BandsNotch {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  width: number;
  paint: BandsPaint;
  opacity: number;
}

/** A plan's agent mark (levels 2 and 3, outside the bands; and the centre's). */
export interface BandsMark {
  provider: string;
  /** its middle */
  x: number;
  y: number;
  size: number;
  paint: BandsPaint;
  opacity: number;
  /** what the plan needs, on a disc at its upper right: the key glyph (sign in) or "!" (retry), r × 1.32 and r × 1.25;
   * a sign-in under way asks nothing, so wears none */
  badge?: { need: "sign-in" | "retry"; x: number; y: number; r: number };
  /** UM-D12 — an agent with more than one plan in view wears the glyph of the profile it is in under its mark (the
   * meter's first profile: the drawing's `subGlyphs(m, sub)[0]`), so its plans can be told apart */
  glyph?: { x: number; y: number; size: number; paint: BandsPaint; profile: MeterProfile };
}

/** One plan's segment: what it draws, and where a pointer finds it. */
export interface BandsPlan {
  key: string;
  from: number;
  span: number;
  /** another plan has the pointer */
  dim: boolean;
  arcs: BandsArc[];
  notches: BandsNotch[];
  mark?: BandsMark;
  /** the plan's pointer target, when the circle answers a pointer per plan */
  hit?: { r: number; width: number; from: number; to: number };
  /** the plan in words, for a pointer and a screen reader */
  words: string;
}

export type BandsCentreItem =
  | { kind: "glyph"; x: number; y: number; size: number; paint: BandsPaint }
  | ({ kind: "mark" } & BandsMark)
  | {
      kind: "text";
      /** the percent; "…" (a first read, a sign-in under way); "!" (needs you, small); "Sign in" or "Retry"; the
       * window; the say line */
      role: "figure" | "ellipsis" | "bang" | "act" | "sub" | "say";
      text: string;
      /** its middle across, and its baseline */
      x: number;
      y: number;
      size: number;
      font: "display" | "sans";
      weight: number;
      paint: BandsPaint;
      /** a "%" after the figure at half its size, weight 700, 0.04 × size after it */
      percent?: true;
    };

export interface BandsGeometry {
  size: number;
  level: BandsLevel;
  /** the circle's middle, the hole the bands leave (one plan's, for the dashed ring; the face's, drawn around it), and
   * what it holds */
  centre: { x: number; y: number; r: number; items: BandsCentreItem[] };
  /** the plans on the circle, in the profile's order (a plan with no meter is left off) */
  plans: BandsPlan[];
  /** nothing meters and nothing needs you, or the usage cannot be read: one dashed ring */
  empty?: { r: number; width: number; paint: BandsPaint; dash: readonly [number, number] };
  /** some plan runs hot (Settings' pace rule): a dot at -45°, ringed in the circle's ground */
  hotDot?: { x: number; y: number; r: number; ring: number };
  /** "Usage: …", "‹profile›: usage unavailable" (every profile's, "Usage unavailable") or "No meters"
   * (`bandsLabel`) */
  label: string;
}

export interface BandsOptions {
  /** what the middle shows: the deciding plan (the default), the profile's glyph, or nothing (the Me menu's row) */
  centre?: "plan" | "glyph" | "none";
  /** the hot dot (a profile's circle) */
  hotDot?: boolean;
  /** the plan a pointer is on (its key): the others dim, and the middle speaks for it */
  focus?: string;
  /** each plan answers a pointer: its hit arc */
  hit?: boolean;
  /** the view has several profiles (an All view, the drawing's `m.multi`): an agent with more than one entry here, a
   * plan with no meter counted, wears its profile's glyph under its mark (UM-D12) */
  crowd?: boolean;
  /** drawn around something round already there (the phone's face): the hole's radius and the band's depth. The
   * bands are the hole's (each max(2.2, (band − 1.2) / 2) wide, 1.2 apart, the rim at hole + band), drawn at level 1,
   * with no marks and nothing in the middle; the level said is at most 2. */
  around?: { hole: number; band: number };
  /** the circle stands for every profile at once (UM-D12's union, `everyPlan`: the Me menu's row with several
   * profiles, the All profiles row, the face's ring, the page with none chosen). Said from here, never inferred from
   * its entries, whose profiles are the managed ones that hold each plan: while the usage cannot be read it names no
   * profile ("Usage unavailable"). */
  every?: boolean;
}

/** The inner band's reach: a window of five hours or less. */
export const SHORT_WINDOW_MINUTES = 300;

/** A plan's bands (UM-D16): the inner is its first window of five hours or less; the outer its most pressed longer
 * window that meters the whole plan (`outranks`: one still running before one read before its reset); the hairline
 * a window that meters part of it (a model's week); a budget fills both. A plan with no reading has none. */
export interface PlanBands {
  short?: MeterWindow;
  long?: MeterWindow;
  group?: MeterWindow;
  budget?: MeterWindow;
}

export function bandsOf(entry: PlanMeter): PlanBands {
  if (entry.kind !== "reading") return {};
  const windows = entry.windows;
  const length = (window: MeterWindow) => window.metric.durationMinutes;
  const bands: PlanBands = {};
  const short = windows.find((window) => {
    const minutes = length(window);
    return !window.budget && minutes !== undefined && minutes <= SHORT_WINDOW_MINUTES;
  });
  if (short !== undefined) bands.short = short;
  for (const window of windows) {
    const minutes = length(window);
    if (window.budget || minutes === undefined || minutes <= SHORT_WINDOW_MINUTES) continue;
    if (window.line.group !== undefined) continue;
    if (bands.long === undefined || outranks(window, bands.long)) bands.long = window;
  }
  const group = windows.find((window) => window.line.group !== undefined);
  if (group !== undefined) bands.group = group;
  const budget = windows.find((window) => window.budget);
  if (budget !== undefined) bands.budget = budget;
  return bands;
}

// ── the plans' words ──

/** "of 7 days", "of 5 hours", "of 7 days · Fable", "of credits". */
export function windowOf(window: MeterWindow): string {
  if (window.budget) return "of credits";
  const part = window.line.group?.label.replace(/ only$/u, "");
  return `of ${window.lengthWords}${part !== undefined ? ` · ${part}` : ""}`;
}

/** What the middle says under a plan at full size, and the end of its words: its forecast, its reset, the age of a
 * kept reading or of one with a window read before its reset, or what it needs. A reset is said only as a length
 * ("resets in 2h", §9 "The meters' words"): one a day or more off is Settings' day and clock, the reader's own zone
 * and locale, which the rows show beside their reset mark; one already past says the reading's age instead. */
export function bandsSay(entry: PlanMeter): { words: string; hot: boolean } {
  switch (entry.kind) {
    case "first-read":
      return { words: "reading…", hot: false };
    case "needs-you":
      return {
        words:
          entry.need === "sign-in"
            ? "sign in"
            : entry.need === "signing-in"
              ? "signing in…"
              : "couldn't read",
        hot: false,
      };
    case "no-meter":
      return { words: "", hot: false };
    case "reading": {
      const window = entry.tightest;
      if (entry.right.kind === "kept" || entry.right.kind === "passed") {
        return { words: entry.right.words, hot: false };
      }
      if (window.forecast !== undefined) return { words: window.forecast.short, hot: true };
      const reset = window.line.reset;
      if (reset === undefined || resetForm(window) !== "length") {
        return { words: "", hot: window.line.hot };
      }
      return { words: `resets in ${reset}`, hot: window.line.hot };
    }
  }
}

/** A plan in words: "Claude Max: 64% of 5 hours, out in ~35m"; "Kimi Code: not signed in"; "Codex: signing in". */
export function bandsPlanWords(entry: PlanMeter): string {
  switch (entry.kind) {
    case "needs-you":
      return entry.need === "signing-in"
        ? `${entry.title}: signing in`
        : `${entry.title}: ${entry.right.words}`;
    case "first-read":
      return `${entry.title}: reading`;
    case "no-meter":
      return entry.title;
    case "reading": {
      const say = bandsSay(entry).words;
      return `${entry.title}: ${Math.round(entry.tightest.line.usedPercent)}% ${windowOf(entry.tightest)}${
        say !== "" ? `, ${say}` : ""
      }`;
    }
  }
}

/** The circle in words: "Usage: " and each plan on it; while the usage cannot be read, "‹profile›: usage
 * unavailable", or "Usage unavailable" for every profile's circle at once (`every`), which names none; else "No
 * meters" (§9). One profile's entries are all in that profile (`planMeters`), so it is named from them. */
export function bandsLabel(
  entries: readonly PlanMeter[],
  options: Pick<BandsOptions, "every"> = {},
): string {
  const onCircle = entries.filter((entry) => entry.kind !== "no-meter");
  if (onCircle.length > 0) return `Usage: ${onCircle.map(bandsPlanWords).join("; ")}`;
  const unread = entries.find((entry) => entry.kind === "no-meter" && entry.why === "unavailable");
  if (unread === undefined) return "No meters";
  const profile = unread.profiles[0];
  return options.every === true || profile === undefined
    ? "Usage unavailable"
    : `${profile.label}: usage unavailable`;
}

// ── the geometry ──

const DEG = Math.PI / 180;
/** the opacity of a plan another plan's pointer dims, and of a kept reading's fill */
const DIM = 0.28;
const STALE = 0.5;
/** a lit head's six steps, brightening toward the head: the ink's, and white over a hot fill */
const HEAD_STEPS = [9, 19, 29, 39, 49, 58] as const;
const HOT_HEAD_STEPS = [6, 12, 19, 26, 33, 40] as const;

const clamp = (value: number, low: number, high: number): number =>
  Math.min(high, Math.max(low, value));
const ink = (percent: number): BandsPaint => ({ tone: "ink", percent });
const HOT_BODY: BandsPaint = { tone: "hot", percent: 88 };
const ATTENTION: BandsPaint = { tone: "attention" };
const at = (c: number, r: number, angle: number): { x: number; y: number } => ({
  x: c + r * Math.cos(angle * DEG),
  y: c + r * Math.sin(angle * DEG),
});

/** An arc as an SVG path, clockwise; a sweep past a half turn is two halves. */
export function arcPath(c: number, arc: Pick<BandsArc, "r" | "from" | "to">): string {
  const fixed = (value: number) => (Math.round(value * 100) / 100).toString();
  const { r, from, to } = arc;
  const start = at(c, r, from);
  const end = at(c, r, to);
  const radius = `${fixed(r)} ${fixed(r)}`;
  if (to - from > 180) {
    const middle = at(c, r, from + 180);
    return `M${fixed(start.x)} ${fixed(start.y)}A${radius} 0 0 1 ${fixed(middle.x)} ${fixed(middle.y)}A${radius} 0 0 1 ${fixed(end.x)} ${fixed(end.y)}`;
  }
  return `M${fixed(start.x)} ${fixed(start.y)}A${radius} 0 0 1 ${fixed(end.x)} ${fixed(end.y)}`;
}

/** An arc too short to see is not drawn; a whole turn stops just short of closing. */
function pushArc(into: BandsArc[], arc: BandsArc): void {
  const sweep = arc.to - arc.from;
  if (sweep <= 0.05) return;
  into.push(sweep > 359.9 ? { ...arc, to: arc.from + 359.9 } : arc);
}

interface ArcContext {
  c: number;
  level: BandsLevel;
  dim: boolean;
  stale: boolean;
}

/** One window as a meter on an arc — Settings' C1 bent round (the drawing's `meterOnArc`): the track; the fill to the
 * used share (solid with round ends while small, pale with a lit head from level 2), orange when ahead of pace; the
 * notch at the time gone. A plan that needs you is a dashed thread, and a first read breathes. */
function meterOnArc(
  plan: BandsPlan,
  context: ArcContext,
  band: BandsArc["band"],
  r: number,
  width: number,
  window: MeterWindow | undefined,
  options: { need?: NeedsYou["need"]; firstRead?: boolean; notch?: boolean } = {},
): void {
  const { c, level } = context;
  const round = level <= 1;
  const capDeg = round ? Math.min(plan.span / 2.2, width / 2 / r / DEG) : 0;
  const cap = round ? "round" : "butt";
  const v0 = plan.from + capDeg;
  const length = Math.max(0.2, plan.span - 2 * capDeg);
  const dim = context.dim ? DIM : 1;
  if (options.need !== undefined) {
    const thread = Math.max(1.15, width * 0.24);
    const inset = thread / 2 / r / DEG;
    pushArc(plan.arcs, {
      band,
      part: "thread",
      r,
      from: plan.from + inset,
      to: plan.from + plan.span - inset,
      width: thread,
      cap: "round",
      paint: ink(options.need === "retry" ? 38 : 46),
      opacity: dim,
      dash: [0.01, Math.max(2.5, thread * 2.6)],
    });
    return;
  }
  if (options.firstRead === true) {
    // the breath owns its opacity
    pushArc(plan.arcs, {
      band,
      part: "breath",
      r,
      from: v0,
      to: v0 + length,
      width,
      cap,
      paint: ink(16),
      opacity: 1,
    });
    return;
  }
  pushArc(plan.arcs, {
    band,
    part: "track",
    r,
    from: v0,
    to: v0 + length,
    width,
    cap,
    paint: ink(level >= 2 ? 8 : 12),
    opacity: dim,
  });
  if (window === undefined) return;
  const used = clamp(window.line.usedPercent, 0, 100);
  const hot = window.line.hot;
  const fill = (length * used) / 100;
  // a kept reading's fill, and a window's read before its reset (DESIGN.md §8 "The Bands circle"), at half
  const fade = dim * (context.stale || window.passed ? STALE : 1);
  if (used > 0.4) {
    if (round) {
      pushArc(plan.arcs, {
        band,
        part: "fill",
        r,
        from: v0,
        to: v0 + Math.max(0.3, fill),
        width,
        cap: "round",
        paint: hot ? HOT_BODY : ink(64),
        opacity: fade,
      });
    } else {
      pushArc(plan.arcs, {
        band,
        part: "fill",
        r,
        from: v0,
        to: v0 + fill,
        width,
        cap: "butt",
        paint: hot ? HOT_BODY : ink(28),
        opacity: fade,
      });
      // Settings' lit head: the fill's last 12 px brighten in six steps, as C1's gradient does
      const head = Math.min(fill * 0.7, 12 / r / DEG);
      const steps = hot ? HOT_HEAD_STEPS : HEAD_STEPS;
      steps.forEach((step, k) => {
        const start = v0 + fill - head + (head * k) / 6;
        const end = v0 + fill - head + (head * (k + 1)) / 6;
        pushArc(plan.arcs, {
          band,
          part: "head",
          r,
          from: start,
          to: end + (k < steps.length - 1 ? 0.1 : 0),
          width,
          cap: "butt",
          paint: hot ? { tone: "light", percent: step } : ink(step),
          opacity: fade,
        });
      });
    }
  }
  const elapsed = window.line.elapsedPercent;
  if (level >= 1 && elapsed !== undefined && options.notch !== false) {
    const angle = plan.from + 2 * capDeg + (length * clamp(elapsed, 0, 100)) / 100;
    const reach = level >= 3 ? 3 : level === 2 ? 2.2 : 1.5;
    const inner = at(c, r - width / 2 - reach, angle);
    const outer = at(c, r + width / 2 + reach, angle);
    plan.notches.push({
      x1: inner.x,
      y1: inner.y,
      x2: outer.x,
      y2: outer.y,
      width: level >= 3 ? 2 : level === 2 ? 1.6 : 1.25,
      paint: ink(84),
      opacity: dim,
    });
  }
}

type NeedsYou = Extract<PlanMeter, { kind: "needs-you" }>;

const planHot = (entry: PlanMeter): boolean => entry.kind === "reading" && entry.hot;
/** a first read, or a sign-in under way: nothing to read yet, and nothing to ask — the middle says "…" */
const waiting = (entry: PlanMeter): boolean =>
  entry.kind === "first-read" || (entry.kind === "needs-you" && entry.need === "signing-in");

/** The plan that decides the middle: the most pressed reading (its tightest by `outranks`, so a plan whose tightest was
 * read before its reset gives way to one still running), else the first read, else what needs you. */
function decidingPlan(onCircle: readonly PlanMeter[]): PlanMeter | undefined {
  let best: ReadingMeter | undefined;
  for (const entry of onCircle) {
    if (entry.kind !== "reading") continue;
    if (best === undefined || outranks(entry.tightest, best.tightest)) best = entry;
  }
  return (
    best ??
    onCircle.find((entry) => entry.kind === "first-read") ??
    onCircle.find((entry) => entry.kind === "needs-you") ??
    onCircle[0]
  );
}

function markOf(
  entry: PlanMeter,
  x: number,
  y: number,
  size: number,
  dim: boolean,
  extras: { badge?: boolean; glyph?: MeterProfile } = {},
): BandsMark {
  const mark: BandsMark = {
    provider: entry.provider,
    x,
    y,
    size,
    paint: entry.kind === "needs-you" ? ink(46) : planHot(entry) ? ATTENTION : ink(84),
    opacity: dim ? DIM : 1,
  };
  if (extras.badge === true && entry.kind === "needs-you" && entry.need !== "signing-in") {
    mark.badge = {
      need: entry.need,
      x: x + size * 0.52,
      y: y - size * 0.46,
      r: Math.max(4.2, size * 0.3),
    };
  }
  if (extras.glyph !== undefined) {
    mark.glyph = {
      x,
      y: y + size * 0.87,
      size: size * 0.64,
      paint: ink(60),
      profile: extras.glyph,
    };
  }
  return mark;
}

const text = (
  role: Extract<BandsCentreItem, { kind: "text" }>["role"],
  words: string,
  x: number,
  y: number,
  size: number,
  font: "display" | "sans",
  weight: number,
  paint: BandsPaint,
  percent = false,
): BandsCentreItem => ({
  kind: "text",
  role,
  text: words,
  x,
  y,
  size,
  font,
  weight,
  paint,
  ...(percent ? { percent: true as const } : {}),
});

/** The middle (the drawing's `centreSvg`): the profile's glyph, or the deciding plan — its figure alone while small;
 * its mark over its percent from level 2; and at full size its window and its say line under them. */
function centreOf(
  c: number,
  r: number,
  level: BandsLevel,
  onCircle: readonly PlanMeter[],
  options: BandsOptions,
): BandsCentreItem[] {
  if (options.centre === "none" || r < 6.5) return [];
  const focused =
    options.focus === undefined ? undefined : onCircle.find((entry) => entry.key === options.focus);
  if (options.centre === "glyph" && focused === undefined) {
    if (level <= 1 || r < 16) {
      return [{ kind: "glyph", x: c, y: c, size: Math.min(r * 1.18, 20), paint: ink(86) }];
    }
    const size = Math.min(r * 0.62, 24);
    const items: BandsCentreItem[] = [
      { kind: "glyph", x: c, y: c - size * 0.42, size, paint: ink(86) },
    ];
    const top = decidingPlan(onCircle);
    if (top?.kind === "reading") {
      items.push(
        text(
          "figure",
          `${Math.round(top.tightest.line.usedPercent)}%`,
          c,
          c + size * 0.62 + 2,
          Math.min(r * 0.42, 13),
          "display",
          800,
          onCircle.some(planHot) ? ATTENTION : ink(70),
        ),
      );
    }
    return items;
  }
  const plan = focused ?? decidingPlan(onCircle);
  if (plan === undefined) return [];
  const figurePaint = planHot(plan) ? ATTENTION : ink(90);
  const used = plan.kind === "reading" ? Math.round(plan.tightest.line.usedPercent) : undefined;
  const act = plan.kind === "needs-you" ? (plan.need === "sign-in" ? "Sign in" : "Retry") : "";
  if (level <= 1 || r < 15) {
    if (waiting(plan)) {
      return [text("ellipsis", "…", c, c + r * 0.32, Math.min(r, 14), "display", 800, ink(50))];
    }
    if (used === undefined) {
      return [text("bang", "!", c, c + r * 0.36, Math.min(r, 13), "display", 800, ink(60))];
    }
    const size = Math.min(r * 0.98, 15);
    return [text("figure", String(used), c, c + size * 0.36, size, "display", 800, figurePaint)];
  }
  if (level === 2 || r < 46) {
    const mark = Math.min(r * 0.6, 19);
    const size = Math.min(r * 0.62, 26);
    const top = c - (mark + 3 + size * 0.72) / 2;
    const items: BandsCentreItem[] = [
      { kind: "mark", ...markOf(plan, c, top + mark / 2, mark, false) },
    ];
    const baseline = top + mark + 3;
    if (waiting(plan)) {
      items.push(text("ellipsis", "…", c, baseline + size * 0.72, size, "display", 800, ink(50)));
    } else if (used === undefined) {
      items.push(text("act", act, c, baseline + size * 0.6, size * 0.56, "sans", 700, ink(70)));
    } else {
      items.push(
        text(
          "figure",
          String(used),
          c,
          baseline + size * 0.72,
          size,
          "display",
          800,
          figurePaint,
          true,
        ),
      );
    }
    return items;
  }
  const mark = clamp(r * 0.3, 13, 21);
  const size = clamp(r * 0.48, 20, 38);
  const small = clamp(r * 0.17, 9.5, 11.5);
  const top = c - (mark + 6 + size * 0.72 + 7 + small + 4 + small) / 2;
  const items: BandsCentreItem[] = [
    { kind: "mark", ...markOf(plan, c, top + mark / 2, mark, false, { badge: true }) },
  ];
  const figure = top + mark + 6 + size * 0.72;
  if (waiting(plan)) {
    items.push(text("ellipsis", "…", c, figure, size, "display", 800, ink(46)));
  } else if (used === undefined) {
    items.push(text("act", act, c, figure - size * 0.12, size * 0.5, "display", 750, ink(86)));
  } else {
    items.push(text("figure", String(used), c, figure, size, "display", 800, figurePaint, true));
  }
  const sub =
    plan.kind === "reading"
      ? windowOf(plan.tightest)
      : plan.kind === "needs-you"
        ? plan.agent
        : plan.title;
  const subline = figure + 7 + small * 0.8;
  items.push(text("sub", sub, c, subline, small, "sans", 500, ink(62)));
  const say = bandsSay(plan);
  if (plan.kind === "reading" && say.words !== "") {
    items.push(
      text(
        "say",
        say.words,
        c,
        subline + 4 + small,
        small,
        "sans",
        say.hot ? 650 : 500,
        say.hot ? ATTENTION : ink(62),
      ),
    );
  }
  return items;
}

/** A circle's rings at a size (the drawing's `drawBands` measures): the detail it draws at, the band, the gap
 * between the bands, a model's week's hairline, the rim, each band's middle, both bands at once, the plans' gap and
 * the hole. */
interface Rings {
  draw: BandsLevel;
  markSize: number;
  markZone: number;
  band: number;
  gap: number;
  hairline: number;
  rim: number;
  rOuter: number;
  rInner: number;
  rBoth: number;
  gapDeg: number;
  hole: number;
}

function ringsOf(size: number, level: BandsLevel, count: number, options: BandsOptions): Rings {
  const around = options.around;
  const draw: BandsLevel = around !== undefined ? 1 : level;
  const markSize = draw >= 3 ? 16 : 10.5;
  const markZone =
    around !== undefined ? 0 : draw >= 3 ? markSize + 9 : draw === 2 ? markSize + 5 : 0;
  const band =
    around !== undefined
      ? Math.max(2.2, (around.band - 1.2) / 2)
      : draw >= 3
        ? clamp(size * 0.046, 8, 11)
        : draw === 2
          ? clamp(size * 0.052, 4, 5.6)
          : clamp(size * 0.066, 2.6, 3.4);
  const gap = around !== undefined ? 1.2 : draw >= 3 ? 2.6 : draw === 2 ? 1.6 : 1.1;
  const hairline = around === undefined && draw >= 3 ? 3 : 0;
  const rim =
    around !== undefined
      ? around.hole + around.band
      : size / 2 - markZone - (hairline > 0 ? hairline + 3.5 : 0) - (draw >= 1 ? 0.8 : 0.5);
  const rInner = rim - band - gap - band / 2;
  const gapPx = count > 1 ? clamp(size * 0.032, 2.8, 8) : 0;
  return {
    draw,
    markSize,
    markZone,
    band,
    gap,
    hairline,
    rim,
    rOuter: rim - band / 2,
    rInner,
    rBoth: rim - band - gap / 2,
    gapDeg: gapPx / rInner / DEG,
    hole:
      around !== undefined
        ? around.hole
        : rInner - band / 2 - (draw >= 3 ? 7 : draw === 2 ? 5 : 2.5),
  };
}

/** UM-D12 — the agents with more than one entry in view, a plan with no meter counted (the drawing's
 * `crowdedAgents`). */
function crowdedOf(entries: readonly PlanMeter[]): Set<string> {
  const seen = new Set<string>();
  const crowded = new Set<string>();
  for (const entry of entries) {
    if (seen.has(entry.provider)) crowded.add(entry.provider);
    seen.add(entry.provider);
  }
  return crowded;
}

/**
 * One profile's Bands circle at a size, or every profile's (the drawing's `drawBands` inside `dialSvg`): its plans'
 * segments in the entries' order (a plan with no meter is left off; with none left, the dashed ring, the profile's
 * glyph kept in its middle), the centre, the hot dot, and the words. `entries` are `planMeters`' or `everyPlan`'s
 * (UM-D15's order).
 */
export function bandsGeometry(
  size: number,
  entries: readonly PlanMeter[],
  options: BandsOptions = {},
): BandsGeometry {
  const sized = bandsLevel(size);
  const level: BandsLevel =
    options.around !== undefined ? (Math.min(2, sized) as BandsLevel) : sized;
  const c = size / 2;
  const onCircle = entries.filter((entry) => entry.kind !== "no-meter");
  const label = bandsLabel(entries, options);
  const empty = onCircle.length === 0;
  const rings = ringsOf(size, level, empty ? 1 : onCircle.length, options);
  const { draw, markSize, markZone, band, gap, hairline, rim, rOuter, rInner, rBoth, gapDeg } =
    rings;
  if (empty) {
    // the glyph stays where one plan's circle puts it, so it does not jump as the meters come and go
    const items: BandsCentreItem[] =
      options.centre === "glyph" && options.around === undefined && rings.hole >= 6.5
        ? [{ kind: "glyph", x: c, y: c, size: Math.min(rings.hole * 1.18, 20), paint: ink(86) }]
        : [];
    return {
      size,
      level,
      centre: { x: c, y: c, r: rings.hole, items },
      plans: [],
      empty: { r: size / 2 - 3, width: 1.2, paint: ink(14), dash: [2, 3] },
      label,
    };
  }
  const count = onCircle.length;
  const span = (360 - count * gapDeg) / count;
  const crowded = options.crowd === true ? crowdedOf(entries) : new Set<string>();
  const plans = onCircle.map((entry, index): BandsPlan => {
    const from = -90 + gapDeg / 2 + index * (span + gapDeg);
    const dim = options.focus !== undefined && options.focus !== entry.key;
    const plan: BandsPlan = {
      key: entry.key,
      from,
      span,
      dim,
      arcs: [],
      notches: [],
      words: bandsPlanWords(entry),
    };
    const context: ArcContext = {
      c,
      level: draw,
      dim,
      stale: entry.kind === "reading" && entry.stale,
    };
    if (entry.kind === "needs-you") {
      meterOnArc(plan, context, "both", rBoth, band * 2 + gap, undefined, { need: entry.need });
    } else if (entry.kind === "first-read") {
      meterOnArc(plan, context, "both", rBoth, band * 2 + gap, undefined, { firstRead: true });
    } else {
      const bands = bandsOf(entry);
      if (bands.budget !== undefined) {
        meterOnArc(plan, context, "both", rBoth, band * 2 + gap, bands.budget);
      } else {
        for (const [which, r, window] of [
          ["outer", rOuter, bands.long],
          ["inner", rInner, bands.short],
        ] as const) {
          if (window !== undefined) meterOnArc(plan, context, which, r, band, window);
          else {
            pushArc(plan.arcs, {
              band: which,
              part: "empty",
              r,
              from: from + 1,
              to: from + span - 1,
              width: band,
              cap: "butt",
              paint: ink(5),
              opacity: dim ? DIM : 1,
            });
          }
        }
        if (hairline > 0 && bands.group !== undefined) {
          meterOnArc(
            plan,
            { ...context, level: 1 },
            "hairline",
            rim + 3.5 + hairline / 2,
            hairline,
            bands.group,
            { notch: false },
          );
        }
      }
    }
    if (markZone > 0) {
      const spot = at(
        c,
        rim + (hairline > 0 ? hairline + 3.5 : 0) + 4.5 + markSize / 2,
        from + span / 2,
      );
      const profile = crowded.has(entry.provider) ? entry.profiles[0] : undefined;
      plan.mark = markOf(entry, spot.x, spot.y, markSize, dim, {
        badge: draw >= 3,
        ...(profile !== undefined ? { glyph: profile } : {}),
      });
    }
    if (options.hit === true) {
      plan.hit = {
        r: (rInner + rim + markZone) / 2,
        width: rim + markZone - rInner + band + 8,
        from,
        to: from + span,
      };
    }
    return plan;
  });
  const items =
    options.around !== undefined ? [] : centreOf(c, rings.hole, draw, onCircle, options);
  const geometry: BandsGeometry = {
    size,
    level,
    centre: { x: c, y: c, r: rings.hole, items },
    plans,
    label,
  };
  if (options.hotDot === true && onCircle.some(planHot)) {
    const spot = at(c, size / 2 - 3, -45);
    geometry.hotDot = { x: spot.x, y: spot.y, r: Math.max(3.6, size * 0.085), ring: 1.6 };
  }
  return geometry;
}
