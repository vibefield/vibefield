import { type AtWorkState, fnv1a32, PRODUCT_API_LIMITS, type SparkId } from "@vibefield/contracts";
import { SPARK_NEEDS_YOU, type SparkStatus } from "@vibefield/design-kit/spark-face";
import { DESK_WIND_IDLE_MS } from "../desk-layer";
import { type AtWorkInk, type AtWorkInks, atWorkInk } from "./at-work-ink";
import type { AtWorkRow } from "./at-work-rows";

// THE AT-WORK MARK — the pure part (item 550, 2026-11-18; DESIGN.md §8 "At work on the mat", §2.3, §2.8, §6).
// From one object's rows, its frame on screen, the zoom and the clock, to what the layer draws: the strokes (one marker
// stroke per agent, nested out from the object's edge), the seats down its right side (a foil sticker per agent, a
// spark's own free star first, a paper "+N" past three), the needs-you and failed chips, and the motion; whether the
// next frame must follow at once (`moving`, and a spark's live star, `stageLive`) or a timer will do (`wakeAt`). No
// colour is chosen here: each stroke carries its ink (`at-work-ink.ts`). No ECS, no DOM, no GL.
//
// STATE SAYS NOTHING BY COLOUR (DESIGN.md §2.5, §2.6). Colour says whose (the project); the shape and the motion say
// what. Reading runs the ink wet along the stroke at 95 px/s, acting at 235 px/s and brighter; open is still; needs-you
// lifts the sticker and a ring leaves it every 2.4 s; failed shivers once; paused (the person's hand on it) goes grey and
// still.
//
// THE PULSE (DESIGN.md §6 "At work on the mat", "Work moves the ink"). The feed sends whole values at most once a window
// (250 ms, trailing edge), so a read shorter than that reaches the window only as `open` with a new `since`. A pulse of
// work is a row turning reading or acting, a new `since` while it STAYS open, reading or acting, or a new `lastChange`
// label. A move into or out of paused, needs-you, failed or released is never a pulse: fieldd stamps a new `since` on
// each (a hold, a let-go, an ask, a failure, a release), and none of them is work. Nor is a same-state new `since` that
// lands just after the person's hand left the object: the hold and its let-go folded into one feed window. A pulse seen
// while the row says open holds its work's motion for one window; then the ink eases to rest.
//
// A SPARK'S STATUS IS CHAT'S (DESIGN.md §2.10 "the desk is a stage", §8 "The names"). A spark's own star wears the
// status Chat's list holds for it (`AtWorkInput.sparkStatus`), never one mapped from its at-work row; while the list
// holds none, the star is its still with no word. A change between two statuses Chat read is a touch: the star is live
// for the desk's ambient after it, as after a pulse. Its chip stands while that status is one of the four that need you
// (S-4), and for 2.4 s from its turn to Failed; an agent's stands at needs-you, and for 2.4 s from its failure.

// ———————————————————————————————————————————————————————————————— the numbers (DESIGN.md §2.3, §2.8, §8)

/** Item 550 (2026-11-18): the stroke, the seats and the bands, in ink px at zoom 1 (DESIGN.md §2.3, §2.8, §8 "At work on
 * the mat"). */
export const AT_WORK = {
  stroke: {
    /** one agent's half-width; each further agent thins every stroke by `thin` of it (9, 8, 7 px wide) */
    hw: 4.5,
    thin: 0.11,
    /** from the object's edge to one stroke's centre; each further agent sets the nest `gapStep` further out */
    gap: 17,
    gapStep: 1.9,
    /** nested strokes stand this many half-widths apart */
    nest: 1.1,
    /** at most this many strokes */
    most: 3,
    /** the reach's air past the outermost ink */
    air: 3,
    /** an agent's stroke runs on past its start by `min(closeOf·P, closeMost)` before it lifts */
    closeOf: 0.09,
    closeMost: 56,
    /** a spark's starlight closes on its star, this far past its start */
    starClose: 7,
  },
  seat: {
    /** the first seat stands this far under the object's top-right corner, each next one `apart` further down */
    first: 16,
    apart: 28,
    /** seats stand at x = edge + max(gap, leastOut) */
    leastOut: 15,
    /** no seat stands lower than `deepest` corner-free half-heights down */
    deepest: 1.8,
    /** at most this many seats; past three agents the third is a paper "+N" */
    most: 3,
    /** a sticker's radius to its paper's edge: half its 15 px mark, its 4.1 of foil and its 1.6 paper edge (§2.8, about
     * 26 across); and how much a printed star widens it */
    sticker: 15 / 2 + 4.1 + 1.6,
    crewWiden: 5.5,
    /** a spark's star's seat radius */
    star: 16,
    /** a spark takes this much of the column; a sticker that wears a star takes `1 + crewRoom` */
    starRoom: 1.2,
    crewRoom: 0.2,
  },
  /** the marks lie on the mat: between these zooms they keep the desk's scale, beyond them they hold their size */
  inkScale: { least: 0.7, most: 2.2 },
  /** a spark's free star, ink px (34 by the kit's measure), and how much a lift enlarges it */
  freeStar: { size: 34, lift: 0.08, most: 1.15 },
  /** the LOD bands, by the object's shorter side on screen (DESIGN.md §8 "Zoom"); a band keeps its object until the side
   * is `hold` px past the edge it would cross, so a zoom across an edge never flickers */
  lod: { merge: 100, line: 24, linePx: 2, hold: 4 },
  /** a chip on the line's glass stands `beside` px past its seat's rim, `above` px over its centre (DESIGN.md §8) */
  chip: { beside: 7, above: 11, edge: 6 },
  /** the selection bar's foot clears the reach of the most strokes and this much more (DESIGN.md §8 "The selection
   * bar", Place) */
  barAir: 9,
} as const;

/** Item 550 (2026-11-18): how long a failed chip stands, ms, from the failure — an agent's row turning failed, or a
 * spark's status (Chat's) turning Failed (DESIGN.md §8 "The names", §2.10, §9). */
export const AT_WORK_FAILED_CHIP_MS = 2_400;

/** Item 550 (2026-11-18): the mark's durations and approaches (DESIGN.md §6 "At work on the mat"). Durations in ms; `tau`
 * are the exponential approaches' time constants, in ms. */
export const AT_WORK_MOTION = {
  /** the stroke draws on, on the island curve */
  drawMs: 780,
  /** the sticker pops in, on the pop curve */
  popMs: 280,
  /** the stroke reels back, on the retract curve; the sticker peels over `peelMs`, from `peelAtMs` */
  eraseMs: 460,
  peelAtMs: 345,
  peelMs: 150,
  /** a crew run's printed star buds this long after its sticker starts its pop, grows on pop, withdraws on retract */
  crewDelayMs: 240,
  crewGrowMs: 380,
  crewWithdrawMs: 200,
  /** a needs-you ring leaves every */
  ringMs: 2_400,
  /** one shiver: this far, this fast, for this long, dying away on `shiverTauMs` */
  shiverPx: 2.4,
  shiverHz: 9,
  shiverMs: 600,
  shiverTauMs: 100,
  /** a pulse seen while the row says open holds its work for one feed window: the longest such a read ran */
  pulseHoldMs: PRODUCT_API_LIMITS.STREAM_MIN_INTERVAL_MS,
  /** a same-state new `since` this soon after the person's hand left the object is the hand's (its hold and let-go
   * folded into one feed window), never work */
  handQuietMs: 2 * PRODUCT_API_LIMITS.STREAM_MIN_INTERVAL_MS,
  /** a spark's star stays live this long after its work last moved or its status changed: the desk's wind window
   * (DESIGN.md §6 M5) */
  ambientMs: DESK_WIND_IDLE_MS,
  /** where the wet stretch stands, parked, under reduced motion (px along the stroke) */
  parkedPx: 300,
  /** a step after a long sleep counts for no more than this */
  stepMostMs: 100,
  tau: {
    glow: 110,
    wet: 160,
    speed: 220,
    sweep: 200,
    ask: 120,
    lift: 60,
    quiet: 90,
    seat: 85,
    ink: 100,
    count: 100,
  },
} as const;

/** Item 550 (2026-11-19; track EY, EY-1): a mark's whole leaving, from its release to nothing drawn: the stroke's reel or
 * the sticker's peel, whichever ends last (DESIGN.md §6 "The departure"), 495 ms. Under reduced motion, and in the DOM
 * form, a leaving is a fade of half the reel; what waits on a leaving (`whenAtWorkLeft`) waits this whole length all the
 * same, so it is never early. */
export const AT_WORK_LEAVE_MS = Math.max(
  AT_WORK_MOTION.eraseMs,
  AT_WORK_MOTION.peelAtMs + AT_WORK_MOTION.peelMs,
);

/** A state the mark shows: released is no state here, it is the leaving. */
export type AtWorkShown = Exclude<AtWorkState, "released">;

/** One state's motion (DESIGN.md §6 "Work moves the ink"). Speed in px/s along the stroke. */
export interface AtWorkMotion {
  readonly glow: number;
  readonly wet: number;
  readonly speed: number;
  readonly sweep: number;
  /** a needs-you ring, and the sticker's lift */
  readonly ring: number;
}

/** Item 550 (2026-11-18): each shown state's motion (DESIGN.md §5 "The ink's light", §6). */
export const AT_WORK_MOTION_BY_STATE: Readonly<Record<AtWorkShown, AtWorkMotion>> = {
  open: { glow: 0.22, wet: 0, speed: 0, sweep: 0, ring: 0 },
  reading: { glow: 0.5, wet: 0.5, speed: 95, sweep: 0.6, ring: 0 },
  acting: { glow: 0.95, wet: 1, speed: 235, sweep: 1, ring: 0 },
  "needs-you": { glow: 0.5, wet: 0, speed: 0, sweep: 0, ring: 1 },
  paused: { glow: 0, wet: 0, speed: 0, sweep: 0, ring: 0 },
  failed: { glow: 0.3, wet: 0, speed: 0, sweep: 0, ring: 0 },
};

const STILL: AtWorkMotion = { glow: 0, wet: 0, speed: 0, sweep: 0, ring: 0 };

/** The needs-you ring fades as (1 − phase)² from 0.85. It is drawn while that is a level of an 8-bit channel or more:
 * about 2.24 s of each 2.4 s, the layer sleeping the 0.16 s between rings to the next (DESIGN.md §6 "At rest"). */
const RING_FLOOR = 1 / 255;
const RING_PEAK = 0.85;
export const AT_WORK_RING_LIFE_MS = AT_WORK_MOTION.ringMs * (1 - Math.sqrt(RING_FLOOR / RING_PEAK));

// ———————————————————————————————————————————————————————————————— the curves (DESIGN.md §6)

function clamp(x: number, least: number, most: number): number {
  return Math.min(Math.max(x, least), most);
}

/** A CSS cubic-bezier as a function of linear progress 0–1. */
function bezier(x1: number, y1: number, x2: number, y2: number): (x: number) => number {
  const cx = 3 * x1;
  const bx = 3 * (x2 - x1) - cx;
  const ax = 1 - cx - bx;
  const cy = 3 * y1;
  const by = 3 * (y2 - y1) - cy;
  const ay = 1 - cy - by;
  return (x) => {
    if (x <= 0) return 0;
    if (x >= 1) return 1;
    let t = x;
    for (let i = 0; i < 7; i += 1) {
      const f = ((ax * t + bx) * t + cx) * t - x;
      const d = (3 * ax * t + 2 * bx) * t + cx;
      if (Math.abs(d) < 1e-6) break;
      t -= f / d;
    }
    t = clamp(t, 0, 1);
    return ((ay * t + by) * t + cy) * t;
  };
}

/** The named curves the mark moves on (DESIGN.md §6): the island, the pop, the retract, and M6's plain ease-out. */
export const AT_WORK_EASE = {
  island: bezier(0.25, 1, 0.3, 1),
  pop: bezier(0.34, 1.45, 0.64, 1),
  retract: bezier(0.4, 0, 1, 1),
  out: bezier(0, 0, 0.58, 1),
} as const;

// ———————————————————————————————————————————————————————————————— inputs and outputs

/** An object's silhouette on screen, CSS px: ICE's `MarkFrame` through the camera (centre, half extents, turn in
 * radians, corner). */
export interface ScreenFrame {
  readonly cx: number;
  readonly cy: number;
  readonly hx: number;
  readonly hy: number;
  readonly angle: number;
  readonly r: number;
}

/** A camera as the desk's `Camera` resource holds it: the view's world top-left and its zoom. */
export interface AtWorkCamera {
  readonly x: number;
  readonly y: number;
  readonly zoom: number;
}

/** A world frame through a camera: ICE 0.17.0's `frameOnScreen`, which ICE does not export (`(c − cam)·z`, `h·z`,
 * `r·z`, the same angle), ported. PURE. */
export function screenFrameOf(frame: ScreenFrame, camera: AtWorkCamera): ScreenFrame {
  const z = camera.zoom;
  return {
    cx: (frame.cx - camera.x) * z,
    cy: (frame.cy - camera.y) * z,
    hx: frame.hx * z,
    hy: frame.hy * z,
    angle: frame.angle,
    r: frame.r * z,
  };
}

export interface AtWorkInput {
  /** the object's agents, as the store holds them (`AtWorkObject.agents`); none: every mark leaves */
  readonly rows: readonly AtWorkRow[];
  /** its silhouette on screen as drawn this frame (lift, tilt and corner in) */
  readonly frame: ScreenFrame;
  /** the camera's zoom */
  readonly zoom: number;
  /** this frame's time, ms, on one monotonic clock (never fieldd's: `since` is compared, never measured) */
  readonly now: number;
  readonly reducedMotion: boolean;
  /** the person's hand is on it (the window's own answer, ahead of fieldd's `paused`) */
  readonly heldByYou: boolean;
  /** the neutral and the starlight, read from the root (`readAtWorkInks`) */
  readonly inks: AtWorkInks;
  /** a spark's status as Chat reads it now (`sparkEntryNow(spark)?.status`), or null while Chat's list holds no entry
   * for it (DESIGN.md §2.10): the face its own star wears, and its chip's */
  readonly sparkStatus: (spark: SparkId) => SparkStatus | null;
  /** runs that land without arriving: on it when the feed began, or began again (the store's `landed`) */
  readonly landed?: ReadonlySet<string>;
  /** the object's own fade as the desk draws it, 0–1 (1 when absent): its marks fade with it */
  readonly fade?: number;
}

export type AtWorkLod = "full" | "merged" | "line";

/** One stroke round the object. Lengths in ink px; the layer draws them at `inkScale` screen px per ink px. */
export interface AtWorkStroke {
  readonly run: string;
  /** an agent's marker, a spark's starlight, or the far band's thin line */
  readonly form: "marker" | "starlight" | "line";
  readonly ink: AtWorkInk;
  /** the ink it is easing from, and how far it has come (1: all `ink`) */
  readonly inkFrom: AtWorkInk;
  readonly inkMix: number;
  readonly hw: number;
  /** from the object's edge to the stroke's centre line */
  readonly gap: number;
  /** the seat its start lies under, as a rank down the column */
  readonly seam: number;
  /** how far past its start it runs on before it lifts */
  readonly close: number;
  /** 0–1 how much of it is drawn */
  readonly drawn: number;
  /** where the wet stretch's head is, px along it */
  readonly travel: number;
  readonly wet: number;
  readonly glow: number;
  readonly sweep: number;
  /** 0–1 grey and still: the person's hand is on it */
  readonly quiet: number;
  /** the failed shiver, px across */
  readonly shiver: number;
  readonly opacity: number;
  /** the run's own hand: its wobble, its sticker's angle and its flecks */
  readonly seed: number;
}

/** A needs-you ring leaving a seat: how far through its 2.4 s it is, and how strong. */
export interface AtWorkRing {
  readonly phase: number;
  readonly strength: number;
}

/** Item 550 (2026-11-18): whether a spark's star on the mat wears its props (DESIGN.md §2.10, §2.5). As built it
 * does, in the engine's own colours: the question mark in the face's ink, the lock amber, the dizzy stars yellow, the
 * hourglass sand, the ✕ red. Off takes them away, live and still; at Failed the face still tints toward red, as every
 * Failed face does. One switch, beside the chip's words' inks (`AT_WORK_CHIP_INKS`). */
export const AT_WORK_STAR_PROPS = true as boolean;

/** A spark's free star at its seat, or riding the head of its line as it arrives. Screen px. */
export interface AtWorkStar {
  readonly x: number;
  readonly y: number;
  readonly size: number;
  /** 0–1 its presence: its seal, its run's opacity and the object's fade, so it dims with the whole mark while
   * something else is in hand and with a deleted object's ghost (DESIGN.md §6 "Something in hand", §8 "When not") */
  readonly alpha: number;
  /** the face it wears: its spark's status as Chat reads it, or null while Chat's list holds no entry for it — then it
   * is its still and wears no word (DESIGN.md §2.10) */
  readonly status: SparkStatus | null;
  /** drawn live (its spark's work moved, or its status changed, within the desk's ambient), else a still; never live
   * while `status` is null */
  readonly live: boolean;
  /** 0–1 how far it has come to rest at its seat: 0 while it rides its line, rising over the draw's last tenth, 1 once
   * its line has run round (its soft shadow lies on the mat as it settles) */
  readonly seated: number;
}

/** One seat down the object's right side. Screen px. */
export interface AtWorkSeat {
  /** the agent whose seat it is (a count's: the first agent it counts) */
  readonly run: string;
  readonly form: "sticker" | "count" | "star";
  /** the catalog id whose mark the sticker carries: looked up by id, never compared */
  readonly agent: string;
  /** a count's N */
  readonly count: number;
  readonly x: number;
  readonly y: number;
  readonly r: number;
  readonly rank: number;
  readonly ink: AtWorkInk;
  /** 0–1.15 the sticker's presence (it pops past 1) */
  readonly seal: number;
  readonly lift: number;
  readonly quiet: number;
  readonly sweep: number;
  readonly shiver: number;
  readonly opacity: number;
  readonly seed: number;
  readonly ring: AtWorkRing | null;
  /** 0–1 how far a crew run's printed star has grown, and whose star it is */
  readonly crew: number;
  readonly crewSpark: SparkId | null;
  /** a spark's own seat: its spark, and its free star */
  readonly spark: SparkId | null;
  readonly star: AtWorkStar | null;
}

/** A name on the line's glass beside a seat (DESIGN.md §8 "The names", §2.10). An agent's stands while it needs you,
 * and for `AT_WORK_FAILED_CHIP_MS` from its failure. A spark's own run's follows its status as Chat reads it, never its
 * row: it stands while that status is one of the four that need you (S-4, `SPARK_NEEDS_YOU`; the word "needs-you"),
 * and for `AT_WORK_FAILED_CHIP_MS` from its turn to Failed (the word "failed"). */
export interface AtWorkChip {
  readonly run: string;
  readonly word: "needs-you" | "failed";
  /** the seat it stands beside, screen px */
  readonly x: number;
  readonly y: number;
  readonly r: number;
  /** 0–1 its run's opacity and the object's fade, as a seat's: it dims with the mark (DESIGN.md §6 "Something in
   * hand", §8 "When not") */
  readonly opacity: number;
}

/** What the layer draws for one object this frame. */
export interface AtWorkMarks {
  readonly lod: AtWorkLod;
  /** screen px per ink px */
  readonly inkScale: number;
  /** the band as it stands (its nest eased with the count): one stroke's half-width, the gap, the outermost ink's reach.
   * The layer's own measures; the selection bar never follows them (`atWorkBarClear`) */
  readonly hw: number;
  readonly gap: number;
  readonly reach: number;
  readonly strokes: readonly AtWorkStroke[];
  readonly seats: readonly AtWorkSeat[];
  readonly chips: readonly AtWorkChip[];
  /** the marks' own clock, ms: it runs only while they move, so at rest the flecks and the sheen hold still */
  readonly clock: number;
  /** a spark's star on this object is live: the stage it is drawn on needs this frame and the next */
  readonly stageLive: boolean;
}

/** One agent's mark as the model keeps it between frames. */
export interface AtWorkAgent {
  readonly run: string;
  /** first-seen order (a spark's own run sits first whatever its order) */
  readonly order: number;
  /** the row as last read */
  readonly row: AtWorkRow;
  /** the feed no longer holds it */
  readonly gone: boolean;
  readonly present: boolean;
  readonly tIn: number;
  readonly tOut: number | null;
  readonly outFrom: number;
  /** it has left and is drawn no more (a released row lingers in the feed for 4 s after) */
  readonly done: boolean;
  readonly tFail: number | null;
  readonly tNeeds: number | null;
  readonly lastWork: "reading" | "acting";
  readonly holdUntil: number;
  readonly lastMove: number;
  readonly seed: number;
  readonly pace: number;
  readonly fresh: boolean;
  readonly ink: AtWorkInk;
  readonly inkFrom: AtWorkInk;
  readonly tInk: number;
  /** a spark's own run: its status as Chat reads it this step (null: no entry); the last status Chat read (null: none
   * yet), which a change is told from; and when it turned Failed. Null throughout for an agent's run. */
  readonly status: SparkStatus | null;
  readonly lastStatus: SparkStatus | null;
  readonly tStatusFail: number | null;
  readonly glow: number;
  readonly wet: number;
  readonly speed: number;
  readonly sweep: number;
  readonly ask: number;
  readonly lift: number;
  readonly quiet: number;
  readonly travel: number;
  readonly rank: number;
  readonly off: number;
  readonly crew: number;
  readonly crewWant: 0 | 1;
  readonly crewFrom: number;
  readonly tCrew: number;
  readonly drawn: number;
  readonly seal: number;
  readonly opacity: number;
  readonly shiver: number;
  /** every eased value stood at its target after this step */
  readonly settled: boolean;
}

/** One object's marks, and what the model keeps for its next frame. */
export interface AtWorkObjectState {
  readonly now: number;
  readonly agents: readonly AtWorkAgent[];
  readonly nextOrder: number;
  readonly count: number;
  /** the person's hand was on it at this step, and when it last left it */
  readonly held: boolean;
  readonly handLeftAt: number;
  readonly marks: AtWorkMarks;
  /** another frame must follow at once */
  readonly moving: boolean;
  /** with nothing moving, when a timer must wake the layer (the next needs-you ring, a chip's end), or null */
  readonly wakeAt: number | null;
}

// ———————————————————————————————————————————————————————————————— small arithmetic

/** The marks' screen px per ink px at `zoom`. PURE. */
export function atWorkInkScale(zoom: number): number {
  return clamp(zoom, AT_WORK.inkScale.least, AT_WORK.inkScale.most);
}

/** The band for `count` agents (eased, so fractional): one stroke's half-width, the gap to the middle stroke's
 * centre, and the outermost ink's reach from the object's edge (DESIGN.md §8 "The bar clears it"). PURE. */
export function atWorkBand(count: number): {
  readonly hw: number;
  readonly gap: number;
  readonly reach: number;
} {
  const { hw: one, thin, gap: first, gapStep, nest, most, air } = AT_WORK.stroke;
  const extra = clamp(count - 1, 0, most - 1);
  const hw = one * (1 - thin * extra);
  const gap = first + gapStep * extra;
  return { hw, gap, reach: gap + (extra / 2) * hw * nest + hw + air };
}

/** How far the outermost ink of `n` agents' strokes stands from the object's edge, ink px: 24.5, 28.108 and 31.171 for
 * one, two and three (DESIGN.md §8 "The bar clears it"). PURE. */
export function atWorkReach(n: number): number {
  return atWorkBand(n).reach;
}

/** Item 550 (2026-11-18): the reach the selection bar's foot clears over ANY object at work — the most strokes', three,
 * whatever the count of agents, so an agent arriving or leaving never moves the bar (DESIGN.md §8 "The selection bar",
 * Place). Ink px: 31.171. */
export const AT_WORK_BAR_REACH = atWorkReach(AT_WORK.stroke.most);

/** Item 550 (2026-11-18): how far the selection bar's foot stands off an object at work's edge, screen px, at the marks'
 * `inkScale` (`atWorkInkScale(zoom)`): `(AT_WORK_BAR_REACH + 9) · inkScale` — 28.12 at 70% and below, 40.171 at 100%,
 * 88.376 at 220% and above (DESIGN.md §8 "The selection bar", Place). PURE. */
export function atWorkBarClear(inkScale: number): number {
  return (AT_WORK_BAR_REACH + AT_WORK.barAir) * inkScale;
}

const LONG_AGO = Number.NEGATIVE_INFINITY;
const EPS = { unit: 1e-3, speed: 0.05 } as const;

/** One exponential approach over `dt`, snapped home once within `eps` (DESIGN.md §6 "The eased values"). */
function approach(v: number, target: number, dt: number, tau: number, eps: number): number {
  const next = target + (v - target) * Math.exp(-dt / tau);
  return Math.abs(next - target) < eps ? target : next;
}

const isWork = (state: AtWorkState): boolean =>
  state === "open" || state === "reading" || state === "acting";

const isWorking = (state: AtWorkState): state is "reading" | "acting" =>
  state === "reading" || state === "acting";

const newLabel = (before: AtWorkRow, next: AtWorkRow): boolean => {
  const label = next.lastChange?.label;
  return label !== undefined && label !== before.lastChange?.label;
};

/** Whether `next` is a pulse of work after `before` (DESIGN.md §6 "Work moves the ink"). PURE. */
export function isAtWorkPulse(before: AtWorkRow, next: AtWorkRow): boolean {
  const moved = before.state !== next.state;
  // a move into or out of paused, needs-you, failed or released is never a pulse, whatever else it carries
  if (!isWork(before.state) || !isWork(next.state)) return false;
  if (moved && isWorking(next.state)) return true;
  if (!moved && before.since !== next.since) return true;
  return newLabel(before, next);
}

/** Whether a pulse is only the person's hand: the same state with a new `since` and no new change, soon after the hand
 * left the object (its hold and let-go folded into one feed window). PURE. */
function handOnly(before: AtWorkRow, next: AtWorkRow, now: number, handLeftAt: number): boolean {
  return (
    before.state === next.state &&
    !newLabel(before, next) &&
    now - handLeftAt < AT_WORK_MOTION.handQuietMs
  );
}

/** The kind of work a pulse shows: the row's own, else an act for a new change, else the run's last. */
function pulseKindOf(
  before: AtWorkRow,
  next: AtWorkRow,
  last: "reading" | "acting",
): "reading" | "acting" {
  if (isWorking(next.state)) return next.state;
  return newLabel(before, next) ? "acting" : last;
}

/** A run's own hand: a number from its id, small enough for a shader's noise (FNV-1a, as the sticker's tilt). */
function seedOf(run: string): number {
  return 1 + (fnv1a32(run) % 100_003) / 10_000;
}

const isSpark = (a: { readonly row: AtWorkRow }): boolean => a.row.spark !== undefined;

const inkFor = (row: AtWorkRow, inks: AtWorkInks): AtWorkInk =>
  row.spark !== undefined ? inks.starlight : atWorkInk(row.project?.seq, inks.neutral);

/** What the mark shows of a row: the person's hand pauses every agent on the object at once. */
function shownOf(row: AtWorkRow, heldByYou: boolean): AtWorkShown | null {
  if (row.state === "released") return null;
  return heldByYou ? "paused" : row.state;
}

type Mut<T> = { -readonly [K in keyof T]: T[K] };

// ———————————————————————————————————————————————————————————————— the step

/** A run first seen now: arriving, or landed (already at work when the feed began). */
function born(
  row: AtWorkRow,
  order: number,
  now: number,
  landed: boolean,
  input: AtWorkInput,
): Mut<AtWorkAgent> {
  const seed = seedOf(row.run);
  const ink = inkFor(row, input.inks);
  const shown = shownOf(row, input.heldByYou);
  const motion = shown === null ? STILL : AT_WORK_MOTION_BY_STATE[shown];
  const present = shown !== null;
  // a landed run starts settled; an arriving one rises from nothing
  const from = (target: number): number => (landed ? target : 0);
  const wears = landed && row.startedBy !== undefined && row.spark === undefined;
  const whole = landed && present ? 1 : 0;
  return {
    run: row.run,
    order,
    row,
    gone: false,
    present,
    tIn: landed ? LONG_AGO : now,
    tOut: null,
    outFrom: 1,
    // a row first seen released never arrives
    done: !present,
    tFail: row.state === "failed" ? (landed ? LONG_AGO : now) : null,
    tNeeds: row.state === "needs-you" ? now : null,
    lastWork: row.state === "acting" ? "acting" : "reading",
    holdUntil: LONG_AGO,
    lastMove: landed ? LONG_AGO : now,
    seed,
    pace: 0.9 + 0.2 * ((seed * 0.371) % 1),
    fresh: true,
    ink,
    inkFrom: ink,
    tInk: LONG_AGO,
    // a spark's status is read in its first step (`readStatus`): a first reading is no change
    status: null,
    lastStatus: null,
    tStatusFail: null,
    glow: from(motion.glow * (row.spark === undefined ? 1 : 0.8)),
    wet: from(motion.wet),
    speed: from(motion.speed),
    sweep: from(motion.sweep),
    ask: from(input.reducedMotion ? 0 : motion.ring),
    lift: from(motion.ring),
    quiet: from(shown === "paused" ? 1 : 0),
    travel: 0,
    rank: 0,
    off: 0,
    crew: wears ? 1 : 0,
    crewWant: wears ? 1 : 0,
    crewFrom: wears ? 1 : 0,
    tCrew: LONG_AGO,
    drawn: whole,
    seal: whole,
    opacity: whole,
    shiver: 0,
    settled: false,
  };
}

/** A run the model already keeps, told its row now (null: the feed no longer holds it). `handLeftAt` is when the
 * person's hand last left the object. */
function told(
  a: Mut<AtWorkAgent>,
  row: AtWorkRow | null,
  now: number,
  inks: AtWorkInks,
  handLeftAt: number,
): void {
  const leave = (): void => {
    if (!a.present) return;
    a.present = false;
    a.tOut = now;
    a.outFrom = a.drawn;
  };
  if (row === null) {
    // gone without a release (a resume's forget, an object's removal): it leaves all the same
    a.gone = true;
    leave();
    return;
  }
  const before = a.row;
  a.gone = false;
  if (isAtWorkPulse(before, row) && !handOnly(before, row, now, handLeftAt)) {
    a.holdUntil = now + AT_WORK_MOTION.pulseHoldMs;
    a.lastWork = pulseKindOf(before, row, a.lastWork);
  }
  if (isWorking(row.state)) a.lastWork = row.state;
  if (row.state === "released") {
    // the retract starts at once; fieldd's 4 s linger is the time it is seen leaving
    leave();
  } else {
    if (!a.present) {
      a.present = true;
      a.tIn = now;
      a.tOut = null;
      a.done = false;
      a.travel = 0;
      a.fresh = true;
      a.crew = 0;
      a.crewWant = 0;
      a.crewFrom = 0;
      a.tCrew = LONG_AGO;
      a.lastMove = now;
    }
    if (row.state === "failed" && before.state !== "failed") a.tFail = now;
    // the row's ask rings the seat; a spark's star wakes at its status's change (Chat's), never at its row's
    if (row.state === "needs-you" && before.state !== "needs-you") a.tNeeds = now;
    if (row.state !== "needs-you") a.tNeeds = null;
  }
  const ink = inkFor(row, inks);
  if (ink.id !== a.ink.id) {
    a.inkFrom = a.ink;
    a.ink = ink;
    a.tInk = now;
  }
  a.row = row;
}

/** The column's order: a spark's own run first, then the runs as first seen (stable whatever the feed's order). */
const byColumn = (a: AtWorkAgent, b: AtWorkAgent): number =>
  (isSpark(b) ? 1 : 0) - (isSpark(a) ? 1 : 0) || a.order - b.order;

/** Where an agent's seat and stroke are bound this frame. */
interface Targets {
  readonly rank: number;
  readonly off: number;
  readonly wears: boolean;
}

/** The arrival's, the leaving's and the sticker's clocks (DESIGN.md §6 "The arrival", "The departure"). Returns the wet
 * the nib lays. */
function stepPresence(a: Mut<AtWorkAgent>, now: number, rm: boolean): number {
  const M = AT_WORK_MOTION;
  const E = AT_WORK_EASE;
  if (a.present) {
    const p = rm ? 1 : clamp((now - a.tIn) / M.drawMs, 0, 1);
    a.drawn = rm ? 1 : E.island(p);
    a.seal = rm ? 1 : E.pop(clamp((now - a.tIn) / M.popMs, 0, 1));
    // M6: under reduced motion an arrival is a fade, half the draw's length, on plain ease-out
    a.opacity = rm ? E.out(clamp((now - a.tIn) / (M.drawMs / 2), 0, 1)) : 1;
    return p < 1 ? 1 - clamp((p - 0.82) / 0.18, 0, 1) : 0;
  }
  if (a.tOut === null || a.done) return 0;
  const t = now - a.tOut;
  let wet = 0;
  if (rm) {
    // M6: a leaving is a fade, half the reel's length; the stroke stands as it was
    a.drawn = a.outFrom;
    a.seal = 1;
    a.opacity = 1 - E.out(clamp(t / (M.eraseMs / 2), 0, 1));
    a.done = t >= M.eraseMs / 2;
  } else {
    const p = clamp(t / M.eraseMs, 0, 1);
    a.drawn = a.outFrom * (1 - E.retract(p));
    a.seal = clamp(1 - (t - M.peelAtMs) / M.peelMs, 0, 1);
    a.opacity = 1;
    wet = p < 1 ? 0.7 : 0;
    a.done = p >= 1 && a.seal <= 0;
  }
  if (a.done) {
    a.drawn = 0;
    a.seal = 0;
    a.opacity = 0;
  }
  return wet;
}

/** The printed star a crew run's sticker wears: it buds 240 ms after the sticker starts its pop, and is drawn back when
 * it is let go (DESIGN.md §2.10 "printed", §6 "The arrival"). */
function stepCrew(a: Mut<AtWorkAgent>, wears: boolean, now: number, rm: boolean): void {
  const M = AT_WORK_MOTION;
  const E = AT_WORK_EASE;
  const want: 0 | 1 = wears ? 1 : 0;
  if (want !== a.crewWant) {
    a.crewWant = want;
    a.crewFrom = a.crew;
    a.tCrew = want === 1 ? Math.max(now, a.tIn + M.crewDelayMs) : now;
  }
  const length = want === 1 ? M.crewGrowMs : M.crewWithdrawMs;
  const pc = rm ? 1 : clamp((now - a.tCrew) / length, 0, 1);
  if (want === 1) a.crew = a.crewFrom + (1 - a.crewFrom) * E.pop(pc);
  else a.crew = a.crewFrom * (1 - E.retract(pc));
}

/** A spark's own run's status as Chat reads it now (DESIGN.md §2.10), kept on its agent. A change between two statuses
 * Chat read is a touch — its star is live for the desk's ambient after it, as after a pulse — and a turn to Failed
 * starts its failed chip. A first reading, or a spell while Chat's list holds no entry, is no change: a spark
 * already at work when the list is read wakes nothing, as a landed run does not arrive. */
function readStatus(a: Mut<AtWorkAgent>, input: AtWorkInput, now: number): void {
  const spark = a.row.spark;
  if (spark === undefined) {
    a.status = null;
    return;
  }
  const status = input.sparkStatus(spark);
  a.status = status;
  if (status === null) return;
  const was = a.lastStatus;
  a.lastStatus = status;
  if (was === null || was === status) return;
  if (a.present) a.lastMove = now;
  if (status === "failed") a.tStatusFail = now;
}

/** One agent's step: its clocks, its status (a spark's), its approaches toward what it is doing, and its seat. */
function stepAgent(a: Mut<AtWorkAgent>, input: AtWorkInput, dt: number, to: Targets): void {
  const { now, reducedMotion: rm } = input;
  const M = AT_WORK_MOTION;
  readStatus(a, input, now);
  const wetDraw = stepPresence(a, now, rm);
  stepCrew(a, to.wears, now, rm);

  const eff = a.present ? shownOf(a.row, input.heldByYou) : null;
  const holding = eff === "open" && now < a.holdUntil;
  let target = STILL;
  if (holding) target = AT_WORK_MOTION_BY_STATE[a.lastWork];
  else if (eff !== null) target = AT_WORK_MOTION_BY_STATE[eff];
  const T = M.tau;
  const ease = (v: number, goal: number, tau: number, eps: number): number =>
    rm ? goal : approach(v, goal, dt, tau, eps);
  const glowTo = target.glow * (isSpark(a) ? 0.8 : 1);
  const askTo = rm ? 0 : target.ring;
  const quietTo = eff === "paused" ? 1 : 0;
  a.glow = ease(a.glow, glowTo, T.glow, EPS.unit);
  a.wet = Math.max(ease(a.wet, target.wet, T.wet, EPS.unit), wetDraw);
  a.speed = ease(a.speed, target.speed, T.speed, EPS.speed);
  a.sweep = ease(a.sweep, target.sweep, T.sweep, EPS.unit);
  a.ask = ease(a.ask, askTo, T.ask, EPS.unit);
  a.lift = ease(a.lift, target.ring, T.lift, EPS.unit);
  a.quiet = ease(a.quiet, quietTo, T.quiet, EPS.unit);
  a.travel = rm ? M.parkedPx : a.travel + (a.speed * a.pace * dt) / 1_000;
  if (a.fresh || rm) {
    a.rank = to.rank;
    a.off = to.off;
    a.fresh = false;
  } else {
    a.rank = approach(a.rank, to.rank, dt, T.seat, EPS.unit);
    a.off = approach(a.off, to.off, dt, T.seat, EPS.unit);
  }
  a.settled =
    a.glow === glowTo &&
    a.wet === target.wet &&
    a.speed === target.speed &&
    a.sweep === target.sweep &&
    a.ask === askTo &&
    a.lift === target.ring &&
    a.quiet === quietTo &&
    a.rank === to.rank &&
    a.off === to.off;

  a.shiver = 0;
  const t = a.tFail === null ? Number.POSITIVE_INFINITY : now - a.tFail;
  if (a.present && a.row.state === "failed" && !rm && t >= 0 && t < M.shiverMs) {
    const wave = Math.sin((2 * Math.PI * M.shiverHz * t) / 1_000);
    a.shiver = M.shiverPx * Math.exp(-t / M.shiverTauMs) * wave;
  }
  // the star's ambient runs from the last time its work moved: work, an arrival, a leaving (its status: `readStatus`)
  const leaving = !a.present && a.tOut !== null && !a.done;
  const arriving = a.present && now - a.tIn < M.drawMs;
  if ((a.present && target.speed > 0) || arriving || leaving) a.lastMove = now;
}

/** Where a seat stands, screen px: x = edge + max(gap, 15), 16 under the corner and 28 apart (DESIGN.md §8 "The
 * stickers"). */
function seatAt(
  frame: ScreenFrame,
  zs: number,
  rank: number,
  gap: number,
): { readonly x: number; readonly y: number } {
  const S = AT_WORK.seat;
  const hx = frame.hx / zs;
  const hy = frame.hy / zs;
  const rr = Math.min(frame.r / zs, hx, hy);
  const cyO = Math.max(hy - rr, 1);
  const qx = (hx + Math.max(gap, S.leastOut)) * zs;
  const qy = (-cyO + Math.min(S.first + S.apart * rank, S.deepest * cyO)) * zs;
  const c = Math.cos(frame.angle);
  const s = Math.sin(frame.angle);
  return { x: frame.cx + c * qx - s * qy, y: frame.cy + s * qx + c * qy };
}

/** A point on a rounded box at arc length `arc`, clockwise from the top's centre. */
function boxPoint(arc: number, bx: number, by: number, corner: number): readonly [number, number] {
  const R = Math.min(corner, bx, by);
  const cx = Math.max(bx - R, 1e-3);
  const cy = Math.max(by - R, 1e-3);
  const qc = (Math.PI / 2) * R;
  const P = 4 * (cx + cy) + 4 * qc;
  /** a point on the corner round (x, y), `th` radians round */
  const round = (x: number, y: number, th: number): readonly [number, number] => [
    x + R * Math.cos(th),
    y + R * Math.sin(th),
  ];
  let s = ((arc % P) + P) % P;
  if (s < cx) return [s, -by];
  s -= cx;
  if (s < qc) return round(cx, -cy, -Math.PI / 2 + s / R);
  s -= qc;
  if (s < 2 * cy) return [bx, -cy + s];
  s -= 2 * cy;
  if (s < qc) return round(cx, cy, s / R);
  s -= qc;
  if (s < 2 * cx) return [cx - s, by];
  s -= 2 * cx;
  if (s < qc) return round(-cx, cy, Math.PI / 2 + s / R);
  s -= qc;
  if (s < 2 * cy) return [-bx, cy - s];
  s -= 2 * cy;
  if (s < qc) return round(-cx, -cy, Math.PI + s / R);
  s -= qc;
  return [-cx + s, -by];
}

/** A stroke's path length about the object, ink px: the rounded box `gap` out. */
function pathLength(frame: ScreenFrame, zs: number, gap: number): number {
  const bx = frame.hx / zs + gap;
  const by = frame.hy / zs + gap;
  const R = Math.min(frame.r / zs + gap, bx, by);
  return 4 * (Math.max(bx - R, 1e-3) + Math.max(by - R, 1e-3)) + 2 * Math.PI * R;
}

/** A spark's star: at its seat, or riding the head of its line while the line is drawn on, and how far it has come to
 * rest (DESIGN.md §6 "The arrival": it rides the head of its line once round and settles over the draw's last tenth). */
function starAt(
  a: AtWorkAgent,
  frame: ScreenFrame,
  zs: number,
  objectGap: number,
  seat: { readonly x: number; readonly y: number },
): { readonly x: number; readonly y: number; readonly seated: number } {
  const x = seat.x - a.shiver * zs;
  const seated = a.drawn >= 0.999 ? 1 : clamp((a.drawn - 0.9) / 0.1, 0, 1);
  if (!(a.present && a.drawn < 0.999)) return { x, y: seat.y, seated };
  const S = AT_WORK.seat;
  const gap = objectGap + a.off;
  const hbx = frame.hx / zs;
  const hby = frame.hy / zs;
  const rr = frame.r / zs;
  const bx = hbx + gap;
  const by = hby + gap;
  const R = Math.min(rr + gap, bx, by);
  const cyO = Math.max(hby - Math.min(rr, hbx, hby), 1);
  const cx = Math.max(bx - R, 1e-3);
  const cy = Math.max(by - R, 1e-3);
  const seam = cx + (Math.PI / 2) * R + Math.min(S.first + S.apart * a.rank, S.deepest * cyO);
  const P = 4 * (cx + cy) + 2 * Math.PI * R;
  const [qx, qy] = boxPoint(seam + a.drawn * (P + AT_WORK.stroke.starClose), bx, by, R);
  const c = Math.cos(frame.angle);
  const s = Math.sin(frame.angle);
  const headX = frame.cx + (c * qx - s * qy) * zs;
  const headY = frame.cy + (s * qx + c * qy) * zs;
  const e = seated * seated * (3 - 2 * seated);
  return { x: headX + (x - headX) * e, y: headY + (seat.y - headY) * e, seated };
}

/** How far into its 2.4 s ring a needs-you run is at `now`, ms. */
function ringInto(a: AtWorkAgent, now: number): number {
  const ring = AT_WORK_MOTION.ringMs;
  return a.tNeeds === null ? ring : (((now - a.tNeeds) % ring) + ring) % ring;
}

/** The ring leaving a needs-you seat now, or null between rings (and never under reduced motion). The first ring leaves
 * the moment it asks and one every 2.4 s after, so a timer can wake the layer for each (DESIGN.md §6 "At rest"). */
function ringOf(
  a: AtWorkAgent,
  eff: AtWorkState | null,
  now: number,
  rm: boolean,
): AtWorkRing | null {
  if (rm || eff !== "needs-you" || a.tNeeds === null) return null;
  const into = ringInto(a, now);
  if (into >= AT_WORK_RING_LIFE_MS) return null;
  return { phase: into / AT_WORK_MOTION.ringMs, strength: a.ask };
}

/** The word of the chip a present run wears at `now`, or null for none (DESIGN.md §8 "The names", §2.10, §9). An
 * agent's, by what its mark shows: needs-you, and failed for `AT_WORK_FAILED_CHIP_MS` from its row's failure (your hand
 * shows it paused, and drops it). A spark's own run's, by its status as Chat reads it and never by its row: needs-you
 * while that status is one of S-4's four, failed for `AT_WORK_FAILED_CHIP_MS` from its turn to Failed. */
function chipWordOf(
  a: AtWorkAgent,
  eff: AtWorkState | null,
  now: number,
): AtWorkChip["word"] | null {
  const failing = (at: number | null): boolean =>
    at !== null && now - at >= 0 && now - at < AT_WORK_FAILED_CHIP_MS;
  if (isSpark(a)) {
    if (a.status === null) return null;
    if (SPARK_NEEDS_YOU.has(a.status)) return "needs-you";
    return a.status === "failed" && failing(a.tStatusFail) ? "failed" : null;
  }
  if (eff === "needs-you") return "needs-you";
  return eff === "failed" && failing(a.tFail) ? "failed" : null;
}

/** The LOD band of an object, by its shorter side on screen (DESIGN.md §8 "Zoom": under 100 px merged, under 24 px a
 * line). Given the band it stood in (`was`), it keeps it until the side is 4 px past the edge it would cross, so a zoom
 * across 100 or 24 never flickers. PURE. */
export function atWorkLod(frame: ScreenFrame, was?: AtWorkLod): AtWorkLod {
  const { merge, line, hold } = AT_WORK.lod;
  const side = 2 * Math.min(frame.hx, frame.hy);
  let lineEdge: number = line;
  let mergeEdge: number = merge;
  if (was !== undefined) {
    lineEdge = was === "line" ? line + hold : line - hold;
    mergeEdge = was === "full" ? merge - hold : merge + hold;
  }
  if (side < lineEdge) return "line";
  if (side < mergeEdge) return "merged";
  return "full";
}

/** Whether this agent's mark still moves at `now`: the frame after must follow at once. */
function agentMoving(a: AtWorkAgent, eff: AtWorkState | null, now: number, rm: boolean): boolean {
  const M = AT_WORK_MOTION;
  if (!a.present) return a.tOut !== null && !a.done;
  if (rm) return now - a.tIn < M.drawMs / 2;
  if (now - a.tIn < Math.max(M.drawMs, M.popMs)) return true;
  if (!a.settled) return true;
  // the wet stretch, its sheen and the foil's band all move with the marks' clock
  if (a.speed > 0 || a.wet > 0 || a.sweep > 0) return true;
  const crewing = a.crewWant === 1 ? M.crewGrowMs : M.crewWithdrawMs;
  if (a.tCrew <= now && now - a.tCrew < crewing) return true;
  if (a.row.state === "failed" && a.tFail !== null && now - a.tFail < M.shiverMs) return true;
  if (a.tInk !== LONG_AGO && now - a.tInk < M.tau.ink * 7) return true;
  // a ring is drawn while it lasts; between rings a timer wakes the layer (`wakeAt`)
  return eff === "needs-you" && a.tNeeds !== null && ringInto(a, now) < AT_WORK_RING_LIFE_MS;
}

/** With nothing moving, the next time something starts with no new row: a ring, a chip's end, a bud, a star's
 * rest. */
function nextWakeOf(
  agents: readonly AtWorkAgent[],
  effOf: (a: AtWorkAgent) => AtWorkState | null,
  now: number,
  rm: boolean,
): number | null {
  const M = AT_WORK_MOTION;
  let at = Number.POSITIVE_INFINITY;
  const consider = (t: number): void => {
    if (t > now && t < at) at = t;
  };
  for (const a of agents) {
    if (!a.present) continue;
    if (!rm && effOf(a) === "needs-you" && a.tNeeds !== null)
      consider(a.tNeeds + Math.ceil((now - a.tNeeds) / M.ringMs) * M.ringMs);
    // a failed chip's end: a spark's by its status's turn, an agent's by its row's
    const failedAt = isSpark(a) ? a.tStatusFail : a.tFail;
    if (failedAt !== null) consider(failedAt + AT_WORK_FAILED_CHIP_MS);
    consider(a.tCrew);
    consider(a.holdUntil);
    if (isSpark(a) && !rm && a.status !== null) consider(a.lastMove + M.ambientMs);
  }
  return at === Number.POSITIVE_INFINITY ? null : at;
}

/** The column's count seat: past three agents the third seat counts the rest; in the merged band one seat after the
 * first sticker counts everyone else. */
interface CountSeat {
  readonly index: number;
  readonly of: number;
}

function countSeatOf(lod: AtWorkLod, shown: readonly AtWorkAgent[], n: number): CountSeat | null {
  const sticker = (k: number): number => shown.slice(0, k).filter((a) => a.present).length;
  const most = AT_WORK.seat.most;
  if (lod === "full" && n > most) return { index: most - 1, of: n - sticker(most - 1) };
  if (lod === "merged" && n > 1) return { index: 1, of: n - sticker(1) };
  return null;
}

/** One object's marks at `input.now`, from its marks the frame before (`undefined`: none yet). PURE. */
export function stepAtWork(
  prev: AtWorkObjectState | undefined,
  input: AtWorkInput,
): AtWorkObjectState {
  const { now, reducedMotion: rm, frame } = input;
  const M = AT_WORK_MOTION;
  const S = AT_WORK.seat;
  const dt = prev === undefined ? 0 : clamp(now - prev.now, 0, M.stepMostMs);
  const fade = clamp(input.fade ?? 1, 0, 1);
  // when the person's hand last left the object: a same-state new `since` just after is the hand's, never work
  const held = input.heldByYou;
  const handLeftAt = prev?.held && !held ? now : (prev?.handLeftAt ?? LONG_AGO);

  // 1. who is here: the runs the model keeps, told their rows; the runs first seen now, born
  const rows = new Map<string, AtWorkRow>();
  for (const row of input.rows) {
    if (!rows.has(row.run)) rows.set(row.run, row);
  }
  let nextOrder = prev?.nextOrder ?? 0;
  const kept: Mut<AtWorkAgent>[] = [];
  for (const was of prev?.agents ?? []) {
    const a: Mut<AtWorkAgent> = { ...was };
    told(a, rows.get(a.run) ?? null, now, input.inks, handLeftAt);
    // a run the feed no longer holds is dropped once it has left
    if (a.gone && (a.done || a.tOut === null)) continue;
    kept.push(a);
  }
  const known = new Set(kept.map((a) => a.run));
  for (const row of rows.values()) {
    if (known.has(row.run)) continue;
    kept.push(born(row, nextOrder, now, input.landed?.has(row.run) === true, input));
    nextOrder += 1;
  }
  kept.sort(byColumn);

  // 2. the column: who has a stroke and a seat, and who is counted
  const lod = atWorkLod(frame, prev?.marks.lod);
  const zs = atWorkInkScale(input.zoom);
  const present = kept.filter((a) => a.present);
  const active = kept.filter((a) => a.present || (a.tOut !== null && !a.done));
  const n = present.length;
  const shown = active.slice(0, lod === "full" ? AT_WORK.stroke.most : 1);
  const countSeat = countSeatOf(lod, shown, n);
  const counted = countSeat === null ? undefined : shown[countSeat.index];

  // 3. each agent's clocks, its seat in the column and its offset in the nest
  const nShown = Math.min(n, AT_WORK.stroke.most);
  const { hw: one, thin, nest } = AT_WORK.stroke;
  const spread = one * (1 - thin * clamp(nShown - 1, 0, 2)) * nest;
  let seat = 0;
  let rank = 0;
  for (const a of kept) {
    // a leaving sticker keeps the star it wears: the sheet peels whole
    const wears = a.row.startedBy !== undefined && !isSpark(a) && a !== counted;
    const crewed = wears ? 1 : clamp(a.crew, 0, 1);
    const room = isSpark(a) ? S.starRoom : 1 + S.crewRoom * crewed;
    const lead = isSpark(a) ? (room - 1) / 2 : room - 1;
    const off = (rank - (Math.max(nShown, 1) - 1) / 2) * spread;
    stepAgent(a, input, dt, { rank: seat + lead, off, wears });
    if (a.present) {
      rank += 1;
      seat += room;
    }
  }

  // 4. the band's nest, eased with the count (with nothing left to draw it stands at once: an easing no one sees asks
  // for no frame)
  const drawing = shown.filter((a) => !a.done);
  let count = nShown;
  if (prev !== undefined && !rm && drawing.length > 0) {
    count = approach(prev.count, nShown, dt, M.tau.count, EPS.unit);
  }
  const band = atWorkBand(lod === "full" ? count : 1);

  // 5. what is drawn (a run that finished leaving this step is drawn no more)
  const effOf = (a: AtWorkAgent): AtWorkState | null =>
    a.present ? shownOf(a.row, input.heldByYou) : null;
  const strokes = drawing.map((a) => strokeOf(a, lod, band, frame, zs, now, rm, fade));
  const seats: AtWorkSeat[] = [];
  if (lod !== "line") {
    for (const [index, a] of shown.entries()) {
      if (a.done) continue;
      const isCount = countSeat !== null && index === countSeat.index;
      const at = seatAt(frame, zs, a.rank, band.gap);
      const spark = isSpark(a) && !isCount;
      const eff = effOf(a);
      const crew = isCount || spark ? 0 : a.crew;
      seats.push({
        run: a.run,
        form: isCount ? "count" : spark ? "star" : "sticker",
        agent: a.row.agent,
        count: isCount && countSeat !== null ? countSeat.of : 0,
        ...at,
        r: (spark ? S.star : S.sticker + S.crewWiden * clamp(crew, 0, 1)) * zs,
        rank: a.rank,
        ink: a.ink,
        seal: a.seal,
        lift: a.lift,
        quiet: a.quiet,
        sweep: a.sweep,
        shiver: a.shiver,
        opacity: a.opacity * fade,
        seed: a.seed,
        ring: isCount ? null : ringOf(a, eff, now, rm),
        crew,
        crewSpark: isCount || spark ? null : (a.row.startedBy ?? null),
        spark: spark ? (a.row.spark ?? null) : null,
        star: spark ? starOf(a, frame, zs, band.gap, at, now, rm, fade) : null,
      });
    }
    // the merged band's count is a seat of its own, after the first one's room at the column's top
    const first = drawing[0];
    if (lod === "merged" && countSeat !== null && first !== undefined) {
      const at = isSpark(first) ? S.starRoom : 1 + S.crewRoom * clamp(first.crew, 0, 1);
      const of = present.find((a) => a !== first) ?? first;
      seats.push({
        run: of.run,
        form: "count",
        agent: of.row.agent,
        count: countSeat.of,
        ...seatAt(frame, zs, at, band.gap),
        r: S.sticker * zs,
        rank: at,
        ink: of.ink,
        seal: first.seal,
        lift: 0,
        quiet: first.quiet,
        sweep: 0,
        shiver: 0,
        opacity: first.opacity * fade,
        seed: of.seed,
        ring: null,
        crew: 0,
        crewSpark: null,
        spark: null,
        star: null,
      });
    }
  }

  // the names on the line's glass: while someone needs you, and 2.4 s from a failure (DESIGN.md §8, §2.10)
  const chips: AtWorkChip[] = [];
  for (const a of present) {
    const word = chipWordOf(a, effOf(a), now);
    if (word === null) continue;
    const own = seats.find((s) => s.run === a.run && s.form !== "count");
    const counting = seats.find((s) => s.form === "count");
    // in the far band, with no seat, the chip stands where the first seat would
    const anchor = own ?? counting ?? { ...seatAt(frame, zs, 0, band.gap), r: S.sticker * zs };
    chips.push({
      run: a.run,
      word,
      x: anchor.x,
      y: anchor.y,
      r: anchor.r,
      opacity: a.opacity * fade,
    });
  }

  // 6. whether the next frame must follow, else when a timer wakes the layer
  const moving = count !== nShown || kept.some((a) => agentMoving(a, effOf(a), now, rm));
  const wakeAt = nextWakeOf(kept, effOf, now, rm);
  const ran = prev?.moving && !rm ? dt : 0;
  return {
    now,
    agents: kept,
    nextOrder,
    count,
    held,
    handLeftAt,
    moving,
    wakeAt,
    marks: {
      lod,
      inkScale: zs,
      hw: band.hw,
      gap: band.gap,
      reach: band.reach,
      strokes,
      seats,
      chips,
      clock: (prev?.marks.clock ?? 0) + ran,
      stageLive: seats.some((s) => s.star?.live === true),
    },
  };
}

/** One shown agent's stroke. */
function strokeOf(
  a: AtWorkAgent,
  lod: AtWorkLod,
  band: { readonly hw: number; readonly gap: number },
  frame: ScreenFrame,
  zs: number,
  now: number,
  rm: boolean,
  fade: number,
): AtWorkStroke {
  const M = AT_WORK_MOTION;
  const line = lod === "line";
  const spark = isSpark(a);
  const gap = lod === "full" ? band.gap + a.off : band.gap;
  const mix = rm || a.tInk === LONG_AGO ? 1 : 1 - Math.exp(-(now - a.tInk) / M.tau.ink);
  const { closeOf, closeMost, starClose } = AT_WORK.stroke;
  let form: AtWorkStroke["form"] = "marker";
  if (line) form = "line";
  else if (spark) form = "starlight";
  return {
    run: a.run,
    form,
    ink: a.ink,
    inkFrom: a.inkFrom,
    inkMix: mix > 1 - EPS.unit ? 1 : mix,
    // the far band's line is 2 screen px wide (DESIGN.md §8 "Zoom"), at the merged stroke's gap
    hw: line ? AT_WORK.lod.linePx / 2 / zs : band.hw,
    gap,
    seam: a.rank,
    close: spark ? starClose : Math.min(closeOf * pathLength(frame, zs, gap), closeMost),
    drawn: a.drawn,
    travel: line ? 0 : a.travel,
    wet: line ? 0 : a.wet,
    glow: line ? 0 : a.glow,
    sweep: line ? 0 : a.sweep,
    quiet: a.quiet,
    shiver: line ? 0 : a.shiver,
    opacity: a.opacity * fade,
    seed: a.seed,
  };
}

/** A spark's own seat's free star: at the seat, or riding its line's head while it arrives; its face its status as
 * Chat reads it; live while its work moved or its status changed within the desk's ambient, else a still — and a
 * still with no word while Chat's list holds no entry for it (DESIGN.md §2.10 "the desk is a stage"). Live or still,
 * it takes the object's `fade` as the strokes and the seats do (§6 "Something in hand", §8 "When not"). */
function starOf(
  a: AtWorkAgent,
  frame: ScreenFrame,
  zs: number,
  objectGap: number,
  seat: { readonly x: number; readonly y: number },
  now: number,
  rm: boolean,
  fade: number,
): AtWorkStar {
  const F = AT_WORK.freeStar;
  const at = starAt(a, frame, zs, objectGap, seat);
  return {
    x: at.x,
    y: at.y,
    size: F.size * zs * Math.min(a.seal, F.most) * (1 + F.lift * a.lift),
    alpha: clamp(a.seal * 1.6, 0, 1) * a.opacity * fade,
    status: a.status,
    live: a.status !== null && !rm && a.seal > 0.02 && now < a.lastMove + AT_WORK_MOTION.ambientMs,
    seated: at.seated,
  };
}

/** Whether the layer must draw the next frame at once for this object (rAF), at `now`: its marks move, a timer's time
 * has come, or a spark's live star is on its stage. PURE. */
export function atWorkMoving(state: AtWorkObjectState, now: number): boolean {
  return state.moving || state.marks.stageLive || (state.wakeAt !== null && now >= state.wakeAt);
}

/** When the layer must next draw this object: `now` while it moves (rAF), the timer's time while it rests, or null
 * (sleep until a row changes). PURE. */
export function atWorkNextWake(state: AtWorkObjectState, now: number): number | null {
  return atWorkMoving(state, now) ? now : state.wakeAt;
}

/** For the objects passed (the layer passes those on screen: a mark off screen asks no frame): whether rAF must run —
 * while any moves or has a live star on its stage (`marks.stageLive`) — else the earliest timer wake, or null (sleep
 * until a row changes). PURE. */
export function atWorkBoardWake(
  states: Iterable<AtWorkObjectState>,
  now: number,
): { readonly raf: boolean; readonly at: number | null } {
  let at: number | null = null;
  for (const state of states) {
    if (atWorkMoving(state, now)) return { raf: true, at: now };
    if (state.wakeAt !== null && (at === null || state.wakeAt < at)) at = state.wakeAt;
  }
  return { raf: false, at };
}

/** Where a chip `width` px wide stands: 7 right of its seat's rim, or left of it at the window's edge (DESIGN.md §8
 * "The names"). PURE. */
export function atWorkChipAt(
  chip: AtWorkChip,
  width: number,
  viewWidth: number,
): { readonly x: number; readonly y: number } {
  const C = AT_WORK.chip;
  const off = chip.r + C.beside;
  const right = chip.x + off + width < viewWidth - C.edge;
  return { x: right ? chip.x + off : chip.x - off - width, y: chip.y - C.above };
}
