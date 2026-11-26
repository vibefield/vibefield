// @vitest-environment node
/**
 * Item 550 (2026-11-18) — THE AT-WORK MARK, the pure model (DESIGN.md §8 "At work on the mat", §2.3, §2.8, §2.10, §6).
 * From one object's presence rows, its frame on screen, the zoom and the clock, to the strokes, the seats, the chips and
 * the motion the layer draws: a stroke 9/8/7 px wide nested out from 17 px; seats 28 apart from 16 under the corner,
 * three at most, then "+N"; a spark's own star first; reading's ink at 95 px/s, acting's at 235; the pulse rule (a row
 * turning reading or acting, a new `since` while it stays open/reading/acting, a new `lastChange` — never a move into or
 * out of paused, needs-you, failed or released, nor the hand's own let-go); the arrival, the leaving, the crew star's
 * bud; needs-you's ring every 2.4 s on a timer; failed's one shiver; paused's grey; the LOD bands and their hold; reduced
 * motion; a spark's status as Chat reads it (its face, its chip at S-4's four and for 2.4 s from Failed, a change of it
 * waking its live stage, no entry its still with no word); the object's fade dimming the whole mark, a spark's star
 * (live or still) and the chips with it; the bar's clearance; and rest: no frame and no timer once nothing moves. Red
 * first: each row says what the model must do.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  AGENT_CATALOG,
  type AtWorkState,
  OBJECT_ROOM,
  PRODUCT_API_LIMITS,
  type SparkId,
} from "@vibefield/contracts";
import {
  SPARK_NEEDS_YOU,
  SPARK_STATUSES,
  type SparkStatus,
} from "@vibefield/design-kit/spark-face";
import { describe, expect, it } from "vitest";
import {
  type AtWorkInk,
  type AtWorkInks,
  neutralInkOf,
  projectInkOf,
  starlightInkOf,
} from "../src/field/desk/at-work/at-work-ink";
import {
  AT_WORK_BAR_REACH,
  AT_WORK_EASE,
  AT_WORK_FAILED_CHIP_MS,
  AT_WORK_MOTION,
  AT_WORK_MOTION_BY_STATE,
  AT_WORK_RING_LIFE_MS,
  type AtWorkInput,
  type AtWorkObjectState,
  type AtWorkSeat,
  type AtWorkStroke,
  atWorkBand,
  atWorkBarClear,
  atWorkBoardWake,
  atWorkChipAt,
  atWorkInkScale,
  atWorkLod,
  atWorkMoving,
  atWorkNextWake,
  atWorkReach,
  isAtWorkPulse,
  type ScreenFrame,
  screenFrameOf,
  stepAtWork,
} from "../src/field/desk/at-work/at-work-model";
import type { AtWorkRow } from "../src/field/desk/at-work/at-work-rows";
import { DESK_WIND_IDLE_MS } from "../src/field/desk/desk-layer";

const PACKAGE_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

function must<T>(value: T | null): T {
  if (value === null) throw new Error("the fixture did not read");
  return value;
}

/** The root's tokens as a fixture theme spells them (the ink's test reads tokens.css's own). */
const TOKENS: Readonly<Record<string, string>> = {
  "--vf-atwork-neutral": "rgb(190 190 196)",
  "--vf-atwork-pearl": "rgb(240 236 226)",
  "--vf-atwork-pearl-deep": "rgb(140 126 160)",
  "--vf-atwork-pearl-rose": "rgb(240 200 220)",
  "--vf-atwork-pearl-aqua": "rgb(200 236 236)",
};
const read = (token: string): string => TOKENS[token] ?? "";
const STARLIGHT = must(starlightInkOf(read));
const INKS: AtWorkInks = {
  neutral: must(neutralInkOf(read("--vf-atwork-neutral"), STARLIGHT)),
  starlight: STARLIGHT,
};

/** A 300 × 190 object at zoom 1, its corner 10. */
const BIG: ScreenFrame = { cx: 500, cy: 400, hx: 150, hy: 95, angle: 0, r: 10 };
/** An object 80 px across on screen: the merged band. */
const MID: ScreenFrame = { cx: 500, cy: 400, hx: 40, hy: 40, angle: 0, r: 4 };
/** An object 20 px across on screen: the line band. */
const TINY: ScreenFrame = { cx: 500, cy: 400, hx: 10, hy: 10, angle: 0, r: 2 };

// agents by their catalog ids, never spelled here (R23b's spirit: a mark is looked up by id)
const AGENTS = AGENT_CATALOG.map((entry) => entry.id);
const AGENT = AGENTS[0] ?? "agent";
const SPARK = "sp-vela0001";

/** Chat's list as these rows read it unless a row says otherwise: the spark at Reading (`reviewing`). */
const CHAT_READING = (): SparkStatus | null => "reviewing";

/** Chat's list with one entry, for `SPARK`, whose status a row sets as it goes (null: no entry). */
function chatList(first: SparkStatus | null): {
  readonly sparkStatus: (spark: SparkId) => SparkStatus | null;
  set(next: SparkStatus | null): void;
} {
  let status = first;
  return {
    sparkStatus: (spark) => (spark === SPARK ? status : null),
    set: (next) => {
      status = next;
    },
  };
}

function row(
  run: string,
  state: AtWorkState,
  since: number,
  ids: Partial<AtWorkRow> = {},
): AtWorkRow {
  return { run, handle: `${run} in vibe-field`, agent: AGENT, state, since, ...ids };
}

function at(
  rows: readonly AtWorkRow[],
  now: number,
  extra: Partial<AtWorkInput> = {},
): AtWorkInput {
  return {
    rows,
    frame: BIG,
    zoom: 1,
    now,
    reducedMotion: false,
    heldByYou: false,
    inks: INKS,
    sparkStatus: CHAT_READING,
    ...extra,
  };
}

/** The first frame of rows already at work when the feed began: they land, never arrive. */
function land(
  rows: readonly AtWorkRow[],
  now = 0,
  extra: Partial<AtWorkInput> = {},
): AtWorkObjectState {
  const landed = new Set(rows.map((r) => r.run));
  return stepAtWork(undefined, at(rows, now, { landed, ...extra }));
}

/** Steps the model every `every` ms from `from` through `to` with the same rows throughout; the last state. */
function hold(
  prev: AtWorkObjectState | undefined,
  rows: readonly AtWorkRow[],
  from: number,
  to: number,
  extra: Partial<AtWorkInput> = {},
  every = 16,
): AtWorkObjectState {
  let state = stepAtWork(prev, at(rows, from, extra));
  for (let t = from + every; t < to; t += every) state = stepAtWork(state, at(rows, t, extra));
  return to > from ? stepAtWork(state, at(rows, to, extra)) : state;
}

/** The same, keeping the largest of `pick` seen on the way. */
function most(
  prev: AtWorkObjectState,
  rows: readonly AtWorkRow[],
  from: number,
  to: number,
  pick: (state: AtWorkObjectState) => number,
  extra: Partial<AtWorkInput> = {},
): number {
  let state = prev;
  let top = Number.NEGATIVE_INFINITY;
  for (let t = from; t <= to; t += 16) {
    state = stepAtWork(state, at(rows, t, extra));
    top = Math.max(top, pick(state));
  }
  return top;
}

const strokeOf = (state: AtWorkObjectState, index = 0): AtWorkStroke => {
  const stroke = state.marks.strokes[index];
  if (stroke === undefined) throw new Error(`no stroke ${index}`);
  return stroke;
};
const seatOf = (state: AtWorkObjectState, index = 0): AtWorkSeat => {
  const seat = state.marks.seats[index];
  if (seat === undefined) throw new Error(`no seat ${index}`);
  return seat;
};
const agentOf = (state: AtWorkObjectState, run: string) => {
  const agent = state.agents.find((a) => a.run === run);
  if (agent === undefined) throw new Error(`no agent ${run}`);
  return agent;
};
const starOf = (state: AtWorkObjectState, index = 0) => {
  const star = seatOf(state, index).star;
  if (star === null) throw new Error(`no star at seat ${index}`);
  return star;
};

describe("the band — DESIGN.md §2.3's numbers", () => {
  it("draws one agent's stroke 9 px wide 17 px out, two at 8 about 18.9, three at 7 about 20.8, never thinner", () => {
    expect(atWorkBand(1)).toEqual({ hw: 4.5, gap: 17, reach: 24.5 });
    const two = atWorkBand(2);
    expect(two.hw).toBeCloseTo(4.005, 9);
    expect(two.gap).toBeCloseTo(18.9, 9);
    const three = atWorkBand(3);
    expect(three.hw).toBeCloseTo(3.51, 9);
    expect(three.gap).toBeCloseTo(20.8, 9);
    expect(atWorkBand(5)).toEqual(atWorkBand(3));
  });

  it("reaches 24.5, 28.1 and 31.2 ink px past the edge for one, two and three agents", () => {
    expect(atWorkReach(1)).toBe(24.5);
    expect(atWorkReach(2)).toBeCloseTo(28.10775, 9);
    expect(atWorkReach(3)).toBeCloseTo(31.171, 9);
    expect(atWorkReach(7)).toBeCloseTo(31.171, 9);
  });

  it("keeps the desk's scale between zoom 0.7 and 2.2, and holds its size beyond", () => {
    expect(atWorkInkScale(0.2)).toBe(0.7);
    expect(atWorkInkScale(1.3)).toBe(1.3);
    expect(atWorkInkScale(4)).toBe(2.2);
  });

  it("places a frame on screen with ICE's frameOnScreen arithmetic: (c − cam)·z, h·z, r·z, the same turn", () => {
    const world: ScreenFrame = { cx: 100, cy: 50, hx: 20, hy: 10, angle: 0.1, r: 4 };
    expect(screenFrameOf(world, { x: 20, y: 10, zoom: 2 })).toEqual({
      cx: 160,
      cy: 80,
      hx: 40,
      hy: 20,
      angle: 0.1,
      r: 8,
    });
  });

  it("moves on DESIGN.md §6's named curves", () => {
    for (const curve of Object.values(AT_WORK_EASE)) {
      expect(curve(0)).toBe(0);
      expect(curve(1)).toBe(1);
    }
    expect(AT_WORK_EASE.island(0.5)).toBeCloseTo(0.96728, 4);
    expect(AT_WORK_EASE.retract(0.5)).toBeCloseTo(0.32481, 4);
    expect(AT_WORK_EASE.pop(0.5)).toBeGreaterThan(1);
    expect(AT_WORK_EASE.out(0.5)).toBeCloseTo(0.68464, 4);
  });

  it("keeps DESIGN.md §6's motion table", () => {
    expect(AT_WORK_MOTION_BY_STATE.reading).toEqual({
      glow: 0.5,
      wet: 0.5,
      speed: 95,
      sweep: 0.6,
      ring: 0,
    });
    expect(AT_WORK_MOTION_BY_STATE.acting).toEqual({
      glow: 0.95,
      wet: 1,
      speed: 235,
      sweep: 1,
      ring: 0,
    });
    expect(AT_WORK_MOTION_BY_STATE.open.speed).toBe(0);
    expect(AT_WORK_MOTION_BY_STATE["needs-you"].ring).toBe(1);
    expect(AT_WORK_MOTION_BY_STATE.paused).toEqual({
      glow: 0,
      wet: 0,
      speed: 0,
      sweep: 0,
      ring: 0,
    });
  });
});

describe('the bar\'s clearance (DESIGN.md §8 "The selection bar", Place)', () => {
  it("clears the reach of three strokes, atWorkReach(3) itself — 31.171, never a rounded 31.2", () => {
    expect(AT_WORK_BAR_REACH).toBe(atWorkReach(3));
    expect(AT_WORK_BAR_REACH).toBeCloseTo(31.171, 9);
    expect(AT_WORK_BAR_REACH).not.toBe(31.2);
  });

  it("stands (reach + 9) × the marks' scale off the edge: 28.12 at 70% and below, 40.171 at 100%, 88.376 at 220% and above", () => {
    expect(atWorkBarClear(1)).toBeCloseTo(40.171, 9);
    expect(atWorkBarClear(atWorkInkScale(0.5))).toBeCloseTo(28.1197, 9);
    expect(atWorkBarClear(atWorkInkScale(0.7))).toBeCloseTo(28.1197, 9);
    expect(atWorkBarClear(atWorkInkScale(2.2))).toBeCloseTo(88.3762, 9);
    expect(atWorkBarClear(atWorkInkScale(4))).toBeCloseTo(88.3762, 9);
  });

  it("never follows the count of agents: the marks carry no presence for the bar, and one to five agents read one clearance", () => {
    const clears = [1, 2, 3, 4, 5].map((n) => {
      const state = land(Array.from({ length: n }, (_, i) => row(`r${i}`, "open", 1)));
      expect(Object.keys(state.marks)).not.toContain("presence");
      return atWorkBarClear(state.marks.inkScale);
    });
    expect(new Set(clears).size).toBe(1);
    // the band itself still nests with the count: the clearance is not its reach
    expect(atWorkReach(1)).toBeLessThan(AT_WORK_BAR_REACH);
  });
});

describe("the strokes and the seats", () => {
  it("nests the strokes in the order the agents came, centred on the band", () => {
    const state = land([row("a", "open", 1), row("b", "open", 1), row("c", "open", 1)]);
    const strokes = state.marks.strokes;
    expect(strokes.map((s) => s.run)).toEqual(["a", "b", "c"]);
    expect(strokes.map((s) => s.hw)).toEqual([3.51, 3.51, 3.51].map((hw) => expect.closeTo(hw, 9)));
    expect(strokes[0]?.gap).toBeCloseTo(16.939, 9);
    expect(strokes[1]?.gap).toBeCloseTo(20.8, 9);
    expect(strokes[2]?.gap).toBeCloseTo(24.661, 9);
  });

  it("keeps first-seen order whatever order the feed sends its rows in", () => {
    const first = land([row("a", "open", 1), row("b", "open", 1)]);
    const reordered = [row("b", "open", 1), row("a", "open", 1), row("c", "open", 1)];
    const next = hold(first, reordered, 16, 400);
    expect(next.marks.strokes.map((s) => s.run)).toEqual(["a", "b", "c"]);
  });

  it("draws three strokes at most, and past three agents two stickers and a paper +N for the rest", () => {
    const five = land(["a", "b", "c", "d", "e"].map((run) => row(run, "open", 1)));
    expect(five.marks.strokes).toHaveLength(3);
    expect(five.marks.seats.map((s) => s.form)).toEqual(["sticker", "sticker", "count"]);
    expect(seatOf(five, 2).count).toBe(3);
    const four = land(["a", "b", "c", "d"].map((run) => row(run, "open", 1)));
    expect(seatOf(four, 2).count).toBe(2);
    const three = land(["a", "b", "c"].map((run) => row(run, "open", 1)));
    expect(three.marks.seats.map((s) => s.form)).toEqual(["sticker", "sticker", "sticker"]);
  });

  it("seats the stickers down the right side, 28 apart from 16 under the corner, at the edge plus the gap", () => {
    const state = land(["a", "b", "c"].map((run) => row(run, "open", 1)));
    // the corner-free half-height is 95 − 10 = 85, so the first seat stands at 400 − 85 + 16
    expect(state.marks.seats.map((s) => [s.x, s.y, s.r])).toEqual([
      [expect.closeTo(670.8, 9), 331, expect.closeTo(13.2, 9)],
      [expect.closeTo(670.8, 9), 359, expect.closeTo(13.2, 9)],
      [expect.closeTo(670.8, 9), 387, expect.closeTo(13.2, 9)],
    ]);
    expect(seatOf(state).agent).toBe(AGENT);
  });

  it("turns the seats with the object", () => {
    const state = land([row("a", "open", 1)], 0, { frame: { ...BIG, angle: Math.PI / 2 } });
    expect(seatOf(state).x).toBeCloseTo(569, 9);
    expect(seatOf(state).y).toBeCloseTo(567, 9);
  });

  it("draws the marks at the ink scale: twice the zoom, twice the screen px", () => {
    const frame: ScreenFrame = { cx: 1000, cy: 800, hx: 300, hy: 190, angle: 0, r: 20 };
    const state = land([row("a", "open", 1)], 0, { frame, zoom: 2 });
    expect(state.marks.inkScale).toBe(2);
    expect([seatOf(state).x, seatOf(state).y, seatOf(state).r]).toEqual([
      1334,
      662,
      expect.closeTo(26.4, 9),
    ]);
    expect(strokeOf(state).gap).toBe(17);
  });

  it("seats a spark's own star first, its line starlight closing on it, and its crew's sticker wearing its star", () => {
    const state = land([
      row("crew", "reading", 1, { startedBy: SPARK }),
      row("own", "reading", 1, { spark: SPARK }),
    ]);
    expect(state.marks.seats.map((s) => [s.run, s.form])).toEqual([
      ["own", "star"],
      ["crew", "sticker"],
    ]);
    const star = seatOf(state);
    expect(star.spark).toBe(SPARK);
    expect(star.star).not.toBeNull();
    expect(star.r).toBe(16);
    expect(star.rank).toBeCloseTo(0.1, 9);
    const crew = seatOf(state, 1);
    expect(crew.crewSpark).toBe(SPARK);
    expect(crew.crew).toBe(1);
    expect(crew.r).toBeCloseTo(18.7, 9);
    expect(crew.rank).toBeCloseTo(1.4, 9);
    expect(strokeOf(state).form).toBe("starlight");
    expect(strokeOf(state).close).toBe(7);
    expect(strokeOf(state).ink).toBe(INKS.starlight);
    expect(strokeOf(state, 1).form).toBe("marker");
  });

  it("gives a crew run's sticker the room its printed star takes in the column", () => {
    const state = land([
      row("a", "open", 1),
      row("b", "open", 1, { startedBy: SPARK }),
      row("c", "open", 1),
    ]);
    const ranks = state.marks.seats.map((s) => s.rank);
    expect(ranks).toEqual([0, expect.closeTo(1.2, 9), expect.closeTo(2.2, 9)]);
  });

  it("runs an agent's stroke on past its start by min(0.09 of its path, 56) px, a short one by less", () => {
    expect(strokeOf(land([row("a", "open", 1)])).close).toBe(56);
    // 80 px across, merged: the path 17 out is 4·(36 + 36) + 2π·21 long
    const small = land([row("a", "open", 1)], 0, { frame: MID });
    expect(strokeOf(small).close).toBeCloseTo(0.09 * (288 + 2 * Math.PI * 21), 9);
  });
});

describe("the pulse — work, never a hold, an ask, a failure or a leaving", () => {
  const was = (state: AtWorkState, since = 1, label?: string): AtWorkRow =>
    row("a", state, since, label === undefined ? {} : { lastChange: { label } });
  const cases: readonly [string, AtWorkRow, AtWorkRow, boolean][] = [
    ["open → reading", was("open"), was("reading", 2), true],
    ["reading → acting", was("reading"), was("acting", 2), true],
    ["acting → reading", was("acting"), was("reading", 2), true],
    ["reading → open", was("reading"), was("open", 2), false],
    ["acting → open with a new change", was("acting"), was("open", 2, "Added 2 ideas"), true],
    ["open, a new since (a read inside one window)", was("open"), was("open", 2), true],
    ["reading, a new since", was("reading"), was("reading", 2), true],
    ["open, the same since, a new change", was("open"), was("open", 1, "Tidied the list"), true],
    ["open, the same change", was("open", 1, "x"), was("open", 1, "x"), false],
    ["open, its change undone", was("open", 1, "x"), was("open", 1), false],
    ["open → paused (the hand)", was("open"), was("paused", 2), false],
    ["paused → open with a new since (the let-go)", was("paused"), was("open", 2), false],
    ["paused → reading", was("paused"), was("reading", 2), false],
    ["paused, a new since", was("paused"), was("paused", 2), false],
    ["open → needs-you", was("open"), was("needs-you", 2), false],
    ["needs-you → open", was("needs-you"), was("open", 2), false],
    ["needs-you → reading", was("needs-you"), was("reading", 2), false],
    ["needs-you, asked again", was("needs-you"), was("needs-you", 2), false],
    ["reading → needs-you with a new change", was("reading"), was("needs-you", 2, "y"), false],
    ["open → failed", was("open"), was("failed", 2), false],
    ["failed → open", was("failed"), was("open", 2), false],
    ["open → released", was("open"), was("released", 2), false],
  ];
  for (const [name, before, next, pulse] of cases) {
    it(`${pulse ? "is" : "is never"} a pulse: ${name}`, () => {
      expect(isAtWorkPulse(before, next)).toBe(pulse);
    });
  }

  it("runs the ink wet at 95 px/s while reading, and at 235 px/s and brighter while acting", () => {
    const reading = strokeOf(land([row("a", "reading", 1)]));
    expect([reading.wet, reading.glow, reading.sweep]).toEqual([0.5, 0.5, 0.6]);
    expect(agentOf(land([row("a", "reading", 1)]), "a").speed).toBe(95);
    const acting = land([row("a", "acting", 1)]);
    expect(agentOf(acting, "a").speed).toBe(235);
    const ink = strokeOf(acting);
    expect([ink.wet, ink.glow, ink.sweep]).toEqual([1, 0.95, 1]);
    // an open row that turns reading eases up to reading's ink
    const open = land([row("a", "open", 1)]);
    const turned = hold(open, [row("a", "reading", 2)], 16, 3_000);
    expect(agentOf(turned, "a").speed).toBe(95);
  });

  it("runs the ink on a short read seen only as a new since, for one feed window, then eases it to rest", () => {
    expect(AT_WORK_MOTION.pulseHoldMs).toBe(PRODUCT_API_LIMITS.STREAM_MIN_INTERVAL_MS);
    const open = hold(land([row("a", "open", 1)]), [row("a", "open", 1)], 16, 1_000);
    expect(open.moving).toBe(false);
    const pulsed = hold(open, [row("a", "open", 2)], 1_000, 1_250);
    const peak = agentOf(pulsed, "a").speed;
    expect(peak).toBeGreaterThan(50);
    expect(pulsed.moving).toBe(true);
    const easing = hold(pulsed, [row("a", "open", 2)], 1_266, 1_600);
    expect(agentOf(easing, "a").speed).toBeLessThan(peak);
    expect(agentOf(easing, "a").speed).toBeGreaterThan(0);
    const rested = hold(easing, [row("a", "open", 2)], 1_616, 4_000);
    expect(agentOf(rested, "a").speed).toBe(0);
    expect(strokeOf(rested).wet).toBe(0);
    expect(strokeOf(rested).glow).toBe(AT_WORK_MOTION_BY_STATE.open.glow);
    expect(rested.moving).toBe(false);
  });

  it("runs a finished act that left a change as acting, faster than a read", () => {
    const acting = land([row("a", "acting", 1)]);
    const read = hold(land([row("a", "open", 1)]), [row("a", "open", 2)], 16, 250);
    const changed = [row("a", "open", 2, { lastChange: { label: "Added 2 ideas" } })];
    const done = hold(acting, changed, 16, 250);
    expect(agentOf(done, "a").speed).toBeGreaterThan(agentOf(read, "a").speed);
  });

  it("never runs the ink when the hand lifts: paused to open with a new since", () => {
    const paused = land([row("a", "paused", 1)]);
    const top = most(paused, [row("a", "open", 2)], 16, 3_000, (s) => {
      const a = agentOf(s, "a");
      return Math.max(a.speed, a.wet, a.sweep);
    });
    expect(top).toBe(0);
  });

  it("never runs the ink for a hold of 120 ms folded into one feed window: open(s1), then open(s3) after the let-go", () => {
    expect(AT_WORK_MOTION.handQuietMs).toBe(2 * PRODUCT_API_LIMITS.STREAM_MIN_INTERVAL_MS);
    const open = hold(land([row("a", "open", 1)]), [row("a", "open", 1)], 16, 1_000);
    // the person's hand on it for 120 ms: fieldd's paused never reaches the window, only the hand's own answer
    const held = hold(open, [row("a", "open", 1)], 1_016, 1_136, { heldByYou: true });
    expect(strokeOf(held).quiet).toBeGreaterThan(0);
    const letGo = stepAtWork(held, at([row("a", "open", 1)], 1_152));
    expect(letGo.handLeftAt).toBe(1_152);
    // the feed's next window: the hold and the let-go folded into one new since
    const top = most(letGo, [row("a", "open", 3)], 1_250, 3_000, (s) => {
      const a = agentOf(s, "a");
      return Math.max(a.speed, a.wet, a.sweep);
    });
    expect(top).toBe(0);
  });

  it("runs the ink for a new since well after the let-go: the hand's quiet is one double window", () => {
    const open = hold(land([row("a", "open", 1)]), [row("a", "open", 1)], 16, 1_000);
    const held = hold(open, [row("a", "open", 1)], 1_016, 1_136, { heldByYou: true });
    const settled = hold(held, [row("a", "open", 1)], 1_152, 2_000);
    const read = hold(settled, [row("a", "open", 3)], 2_016, 2_200);
    expect(agentOf(read, "a").speed).toBeGreaterThan(0);
  });

  it("never runs the ink when it asks or fails", () => {
    for (const state of ["needs-you", "failed"] as const) {
      const open = land([row("a", "open", 1)]);
      const top = most(open, [row("a", state, 2)], 16, 3_000, (s) => agentOf(s, "a").speed);
      expect(top, state).toBe(0);
    }
  });

  it("runs reading's ink on a row that turns reading from needs-you, though that move is no pulse", () => {
    const asked = land([row("a", "needs-you", 1)]);
    expect(agentOf(hold(asked, [row("a", "reading", 2)], 16, 3_000), "a").speed).toBe(95);
  });
});

describe("arriving and leaving", () => {
  it("draws a new stroke on over 780 ms on the island curve and pops its sticker over 280 ms", () => {
    const arrive = [row("a", "open", 1)];
    const t0 = stepAtWork(undefined, at(arrive, 1_000));
    expect([strokeOf(t0).drawn, seatOf(t0).seal]).toEqual([0, 0]);
    expect(t0.moving).toBe(true);
    const popping = stepAtWork(t0, at(arrive, 1_140));
    expect(seatOf(popping).seal).toBeCloseTo(AT_WORK_EASE.pop(0.5), 9);
    const half = stepAtWork(popping, at(arrive, 1_390));
    expect(strokeOf(half).drawn).toBeCloseTo(AT_WORK_EASE.island(0.5), 9);
    const whole = hold(half, arrive, 1_406, 1_780);
    expect(strokeOf(whole).drawn).toBe(1);
    expect(seatOf(whole).seal).toBe(1);
  });

  it("lands, never arrives, a run already at work when the feed began", () => {
    const state = land([row("a", "open", 1)]);
    expect([strokeOf(state).drawn, seatOf(state).seal, strokeOf(state).opacity]).toEqual([1, 1, 1]);
    expect(state.moving).toBe(false);
  });

  it("reels a released stroke back over 460 ms and peels its sticker from 345 ms to 495 ms", () => {
    const open = hold(land([row("a", "open", 1)]), [row("a", "open", 1)], 16, 1_000);
    const gone = [row("a", "released", 2)];
    const start = stepAtWork(open, at(gone, 1_000));
    expect(strokeOf(start).drawn).toBe(1);
    const mid = stepAtWork(start, at(gone, 1_230));
    expect(strokeOf(mid).drawn).toBeCloseTo(1 - AT_WORK_EASE.retract(0.5), 9);
    expect(seatOf(mid).seal).toBe(1);
    const peeling = stepAtWork(mid, at(gone, 1_420));
    expect(seatOf(peeling).seal).toBeCloseTo(0.5, 9);
    const left = stepAtWork(peeling, at(gone, 1_495));
    expect(left.marks.strokes).toEqual([]);
    expect(left.marks.seats).toEqual([]);
    const leaves = AT_WORK_MOTION.peelAtMs + AT_WORK_MOTION.peelMs;
    expect(leaves).toBeLessThan(OBJECT_ROOM.RELEASED_SHOWN_MS);
  });

  it("shows nothing arriving again while fieldd's released row lingers, and asks for no frame", () => {
    const open = land([row("a", "open", 1)]);
    const gone = [row("a", "released", 2)];
    const left = hold(open, gone, 16, 600);
    let state = left;
    for (let t = 616; t <= 4_600; t += 16) {
      state = stepAtWork(state, at(gone, t));
      expect(state.marks.strokes).toEqual([]);
      expect(state.moving).toBe(false);
    }
    const dropped = stepAtWork(state, at([], 4_616));
    expect(dropped.marks.strokes).toEqual([]);
    expect(dropped.agents).toEqual([]);
  });

  it("lets a run the feed no longer holds leave the same way, released or not", () => {
    const open = land([row("a", "open", 1)]);
    const leaving = stepAtWork(open, at([], 1_230));
    expect(strokeOf(leaving).drawn).toBe(1);
    const mid = stepAtWork(leaving, at([], 1_460));
    expect(strokeOf(mid).drawn).toBeCloseTo(1 - AT_WORK_EASE.retract(0.5), 9);
    expect(stepAtWork(mid, at([], 1_725)).marks.strokes).toEqual([]);
  });

  it("arrives again when a released run opens the object again", () => {
    const left = hold(land([row("a", "open", 1)]), [row("a", "released", 2)], 16, 1_000);
    const back = stepAtWork(left, at([row("a", "open", 3)], 1_016));
    expect(strokeOf(back).drawn).toBe(0);
    expect(back.moving).toBe(true);
  });

  it("buds a crew run's printed star 240 ms after its sticker starts its pop, grown over 380 ms on the pop curve", () => {
    const crew = [row("a", "open", 1, { startedBy: SPARK })];
    const t0 = stepAtWork(undefined, at(crew, 1_000));
    const early = stepAtWork(t0, at(crew, 1_239));
    expect(seatOf(early).crew).toBe(0);
    const budding = stepAtWork(early, at(crew, 1_430));
    expect(seatOf(budding).crew).toBeCloseTo(AT_WORK_EASE.pop(0.5), 9);
    const grown = stepAtWork(budding, at(crew, 1_620));
    expect(seatOf(grown).crew).toBe(1);
    expect(seatOf(grown).r).toBeCloseTo(18.7, 9);
  });

  it("draws the printed star back in 200 ms when the run no longer says a spark started it", () => {
    const worn = land([row("a", "open", 1, { startedBy: SPARK })]);
    const plain = [row("a", "open", 1)];
    const start = stepAtWork(worn, at(plain, 1_000));
    const mid = stepAtWork(start, at(plain, 1_100));
    expect(seatOf(mid).crew).toBeCloseTo(1 - AT_WORK_EASE.retract(0.5), 9);
    expect(seatOf(stepAtWork(mid, at(plain, 1_200))).crew).toBe(0);
  });

  it("rides a spark's star once round the head of its line as it arrives, then seats it", () => {
    const own = [row("own", "reading", 1, { spark: SPARK })];
    const t0 = stepAtWork(undefined, at(own, 1_000));
    const riding = stepAtWork(t0, at(own, 1_156));
    const seat = seatOf(riding);
    const star = starOf(riding);
    expect(Math.hypot(star.x - seat.x, star.y - seat.y)).toBeGreaterThan(100);
    const seated = hold(riding, own, 1_172, 1_780);
    const settled = seatOf(seated);
    expect(settled.star?.x).toBeCloseTo(settled.x, 9);
    expect(settled.star?.y).toBeCloseTo(settled.y, 9);
    expect(settled.star?.size).toBeCloseTo(34, 9);
  });

  it("says how far the star has come to rest: 0 while it rides, rising over the draw's last tenth, 1 at its seat", () => {
    const own = [row("own", "reading", 1, { spark: SPARK })];
    const t0 = stepAtWork(undefined, at(own, 1_000));
    expect(starOf(stepAtWork(t0, at(own, 1_156))).seated).toBe(0);
    // the island curve passes 0.95 of the draw on the way: half seated there
    let state = t0;
    let halfway: number | null = null;
    for (let t = 1_016; t <= 1_780; t += 4) {
      state = stepAtWork(state, at(own, t));
      const drawn = strokeOf(state).drawn;
      if (halfway === null && drawn >= 0.95 && drawn < 0.999)
        halfway = starOf(state).seated - (drawn - 0.9) / 0.1;
    }
    expect(halfway).toBeCloseTo(0, 9);
    expect(starOf(state).seated).toBe(1);
    expect(starOf(land(own)).seated).toBe(1);
  });
});

describe("needs you, failed, paused", () => {
  it("lifts a needs-you sticker and lets a ring leave it every 2.4 s, the layer sleeping between rings", () => {
    const open = hold(land([row("a", "open", 1)]), [row("a", "open", 1)], 16, 1_000);
    const asked = [row("a", "needs-you", 2)];
    const first = hold(open, asked, 1_000, 1_100);
    expect(seatOf(first).ring?.phase).toBeCloseTo(100 / 2_400, 9);
    expect(first.marks.chips.map((c) => [c.run, c.word])).toEqual([["a", "needs-you"]]);
    const between = hold(first, asked, 1_116, 3_300);
    expect(seatOf(between).lift).toBe(1);
    expect(seatOf(between).ring).toBeNull();
    expect(between.moving).toBe(false);
    expect(between.wakeAt).toBe(3_400);
    expect(atWorkMoving(between, 3_300)).toBe(false);
    expect(atWorkNextWake(between, 3_300)).toBe(3_400);
    expect(atWorkMoving(between, 3_400)).toBe(true);
    const next = stepAtWork(between, at(asked, 3_400));
    expect(seatOf(next).ring?.phase).toBe(0);
    expect(next.moving).toBe(true);
    expect(AT_WORK_RING_LIFE_MS).toBeLessThan(AT_WORK_MOTION.ringMs);
  });

  it("stands a needs-you chip 7 px past its sticker's rim, or left of it at the window's edge", () => {
    const chip = {
      run: "a",
      word: "needs-you" as const,
      x: 700,
      y: 331,
      r: 14,
      opacity: 1,
    };
    expect(atWorkChipAt(chip, 120, 1_400)).toEqual({ x: 721, y: 320 });
    expect(atWorkChipAt(chip, 120, 800)).toEqual({ x: 559, y: 320 });
  });

  it("shivers once when an act fails — 2.4 px at 9 Hz for 0.6 s — and names it for 2.4 s", () => {
    expect(AT_WORK_FAILED_CHIP_MS).toBe(2_400);
    const open = hold(land([row("a", "open", 1)]), [row("a", "open", 1)], 16, 1_000);
    const failed = [row("a", "failed", 2)];
    const t0 = stepAtWork(open, at(failed, 1_000));
    const shiver = stepAtWork(t0, at(failed, 1_010));
    const expected = 2.4 * Math.exp(-0.1) * Math.sin(2 * Math.PI * 9 * 0.01);
    expect(strokeOf(shiver).shiver).toBeCloseTo(expected, 9);
    const still = hold(shiver, failed, 1_026, 2_500);
    expect(strokeOf(still).shiver).toBe(0);
    expect(still.marks.chips.map((c) => c.word)).toEqual(["failed"]);
    expect(still.moving).toBe(false);
    expect(still.wakeAt).toBe(1_000 + AT_WORK_FAILED_CHIP_MS);
    const named = hold(still, failed, 2_516, 1_000 + AT_WORK_FAILED_CHIP_MS - 1);
    expect(named.marks.chips).toHaveLength(1);
    expect(stepAtWork(named, at(failed, 1_000 + AT_WORK_FAILED_CHIP_MS)).marks.chips).toEqual([]);
  });

  it("greys and stills every stroke while the person's hand is on the object, and drops its chips", () => {
    const acting = land([row("a", "acting", 1), row("b", "needs-you", 1)]);
    const held = hold(acting, [row("a", "acting", 1), row("b", "needs-you", 1)], 16, 2_000, {
      heldByYou: true,
    });
    for (const stroke of held.marks.strokes) {
      expect([stroke.quiet, stroke.wet, stroke.glow, stroke.drawn]).toEqual([1, 0, 0, 1]);
    }
    expect(agentOf(held, "a").speed).toBe(0);
    expect(held.marks.chips).toEqual([]);
    expect(seatOf(held, 1).ring).toBeNull();
  });

  it("greys the same way when fieldd says paused", () => {
    const paused = land([row("a", "paused", 1)]);
    expect(strokeOf(paused).quiet).toBe(1);
    expect(agentOf(paused, "a").speed).toBe(0);
  });
});

describe('the object\'s fade dims the whole mark (DESIGN.md §6 "Something in hand", §8 "When not")', () => {
  /** the level the out-of-focus desk dims a mark to */
  const DIMMED = 0.35;

  it("dims a spark's live star, and its still, at the fade's share of its own alpha, as the strokes and the seats", () => {
    const own = [row("own", "reading", 1, { spark: SPARK })];
    const full = hold(land(own), own, 16, 500);
    const dimmed = hold(land(own, 0, { fade: DIMMED }), own, 16, 500, { fade: DIMMED });
    expect(starOf(full).live).toBe(true);
    expect(starOf(dimmed).live).toBe(true);
    expect(starOf(full).alpha).toBeGreaterThan(0);
    expect(starOf(dimmed).alpha).toBeCloseTo(DIMMED * starOf(full).alpha, 9);
    expect(strokeOf(dimmed).opacity).toBeCloseTo(DIMMED * strokeOf(full).opacity, 9);
    expect(seatOf(dimmed).opacity).toBeCloseTo(DIMMED * seatOf(full).opacity, 9);
    // its still: landed open, its status first read, so nothing woke it
    const open = [row("own", "open", 1, { spark: SPARK })];
    const still = land(open, 0, { fade: DIMMED });
    expect(starOf(still).live).toBe(false);
    expect(starOf(land(open)).alpha).toBeGreaterThan(0);
    expect(starOf(still).alpha).toBeCloseTo(DIMMED * starOf(land(open)).alpha, 9);
  });

  it("dims each chip with its run's seat, an agent's and a spark's alike", () => {
    const rows = [row("a", "needs-you", 1), row("own", "open", 1, { spark: SPARK })];
    const asking = { sparkStatus: (): SparkStatus | null => "asking" };
    const full = land(rows, 0, asking);
    const dimmed = land(rows, 0, { ...asking, fade: DIMMED });
    const levelOf = (state: AtWorkObjectState, run: string): number => {
      const chip = state.marks.chips.find((c) => c.run === run);
      if (chip === undefined) throw new Error(`no chip for ${run}`);
      return chip.opacity;
    };
    for (const run of ["a", "own"]) {
      expect(levelOf(full, run), run).toBeGreaterThan(0);
      expect(levelOf(dimmed, run), run).toBeCloseTo(DIMMED * levelOf(full, run), 9);
      const seat = dimmed.marks.seats.find((s) => s.run === run && s.form !== "count");
      expect(levelOf(dimmed, run), run).toBe(seat?.opacity);
    }
  });
});

describe('a spark\'s status is Chat\'s (DESIGN.md §2.10 "the desk is a stage", §8 "The names")', () => {
  const own = (state: AtWorkState, since: number): AtWorkRow[] => [
    row("own", state, since, { spark: SPARK }),
  ];
  const chipsOf = (state: AtWorkObjectState): [string, string][] =>
    state.marks.chips.map((c): [string, string] => [c.run, c.word]);
  /** S-4's four that need you, by name */
  const FOUR: readonly SparkStatus[] = ["asking", "approval", "stuck", "limited"];

  it("wears the status Chat reads, never one mapped from its row: reading, acting, asking and your hand leave it as Chat says", () => {
    const on = { sparkStatus: chatList("running").sparkStatus };
    const reading = hold(land(own("reading", 1), 0, on), own("reading", 1), 16, 500, on);
    expect(starOf(reading).status).toBe("running");
    const acting = hold(reading, own("acting", 2), 516, 1_000, on);
    expect(starOf(acting).status).toBe("running");
    const asking = hold(acting, own("needs-you", 3), 1_016, 1_500, on);
    expect(starOf(asking).status).toBe("running");
    // its row asking stands no chip of a spark's: the chip is Chat's status's
    expect(asking.marks.chips).toEqual([]);
    const held = hold(asking, own("needs-you", 3), 1_516, 1_700, { ...on, heldByYou: true });
    expect(starOf(held).status).toBe("running");
    // an agent's run wears no status of a spark's
    const agent = land([row("a", "reading", 1)], 0, on);
    expect(agentOf(agent, "a").status).toBeNull();
  });

  it("makes the star live for the desk's ambient and changes its word at a status change, with nothing else moving", () => {
    const chat = chatList("reviewing");
    const on = { sparkStatus: chat.sparkStatus };
    const rest = hold(land(own("open", 1), 0, on), own("open", 1), 16, 1_000, on);
    expect(rest.moving).toBe(false);
    expect(starOf(rest)).toMatchObject({ status: "reviewing", live: false });
    expect(rest.marks.stageLive).toBe(false);
    expect(rest.wakeAt).toBeNull();
    expect(atWorkBoardWake([rest], 1_000)).toEqual({ raf: false, at: null });
    // Chat reads a new status; the row is the same row
    chat.set("thinking");
    const touched = stepAtWork(rest, at(own("open", 1), 1_016, on));
    expect(starOf(touched)).toMatchObject({ status: "thinking", live: true });
    expect(touched.moving).toBe(false);
    expect(touched.marks.stageLive).toBe(true);
    expect(touched.marks.chips).toEqual([]);
    expect(touched.wakeAt).toBe(1_016 + DESK_WIND_IDLE_MS);
    expect(atWorkBoardWake([touched], 1_016)).toEqual({ raf: true, at: 1_016 });
    // live through the desk's 8 s ambient after it, then a still that keeps the new word
    const late = hold(touched, own("open", 1), 1_116, 9_000, on, 100);
    expect(starOf(late).live).toBe(true);
    const stilled = stepAtWork(late, at(own("open", 1), 1_016 + DESK_WIND_IDLE_MS, on));
    expect(starOf(stilled)).toMatchObject({ status: "thinking", live: false });
    expect(stilled.marks.stageLive).toBe(false);
    expect(stilled.wakeAt).toBeNull();
    // the same status read again is no change
    const again = stepAtWork(stilled, at(own("open", 1), 9_100, on));
    expect(starOf(again).live).toBe(false);
  });

  it("is its still with no word while Chat's list holds no entry: never live, no chip, arriving, at work or asking", () => {
    const none = { sparkStatus: (): SparkStatus | null => null };
    const t0 = stepAtWork(undefined, at(own("reading", 1), 1_000, none));
    const arriving = hold(t0, own("reading", 1), 1_016, 1_400, none);
    expect(starOf(arriving)).toMatchObject({ status: null, live: false });
    expect(arriving.marks.stageLive).toBe(false);
    // the marks themselves still draw on: only the star is still
    expect(arriving.moving).toBe(true);
    const asked = hold(arriving, own("needs-you", 2), 1_416, 2_000, none);
    expect(starOf(asked)).toMatchObject({ status: null, live: false });
    expect(asked.marks.chips).toEqual([]);
  });

  it("takes the list's first reading, and a spell with no entry, as no change: only a change between two statuses wakes it", () => {
    const chat = chatList(null);
    const on = { sparkStatus: chat.sparkStatus };
    const rest = hold(land(own("open", 1), 0, on), own("open", 1), 16, 1_000, on);
    expect(starOf(rest)).toMatchObject({ status: null, live: false });
    chat.set("asking");
    const read = stepAtWork(rest, at(own("open", 1), 1_016, on));
    expect(starOf(read)).toMatchObject({ status: "asking", live: false });
    expect(read.marks.stageLive).toBe(false);
    // its chip stands all the same: Asking you needs you, however it was first read
    expect(chipsOf(read)).toEqual([["own", "needs-you"]]);
    chat.set(null);
    const gap = stepAtWork(read, at(own("open", 1), 1_032, on));
    expect(starOf(gap)).toMatchObject({ status: null, live: false });
    expect(gap.marks.chips).toEqual([]);
    chat.set("asking");
    const same = stepAtWork(gap, at(own("open", 1), 1_048, on));
    expect(starOf(same)).toMatchObject({ status: "asking", live: false });
    chat.set(null);
    const gapAgain = stepAtWork(same, at(own("open", 1), 1_064, on));
    chat.set("thinking");
    const changed = stepAtWork(gapAgain, at(own("open", 1), 1_080, on));
    expect(starOf(changed)).toMatchObject({ status: "thinking", live: true });
  });

  it("stands a spark's chip at each of S-4's four that need you, and at no other status Chat reads", () => {
    expect([...SPARK_NEEDS_YOU].sort()).toEqual([...FOUR].sort());
    for (const status of FOUR) {
      const state = land(own("reading", 1), 0, { sparkStatus: () => status });
      expect(chipsOf(state), status).toEqual([["own", "needs-you"]]);
      expect(starOf(state).status, status).toBe(status);
    }
    const others = SPARK_STATUSES.map((s) => s.id).filter((id) => !FOUR.includes(id));
    expect(others).toHaveLength(15);
    for (const status of others) {
      // whatever its row says: even its row asking
      const state = land(own("needs-you", 1), 0, { sparkStatus: () => status });
      expect(state.marks.chips, status).toEqual([]);
    }
  });

  it("names a spark's failure for 2400 ms from its status's turn to Failed, then lets it go; a first reading of Failed names none", () => {
    const chat = chatList("running");
    const on = { sparkStatus: chat.sparkStatus };
    const rest = hold(land(own("open", 1), 0, on), own("open", 1), 16, 1_000, on);
    expect(rest.marks.chips).toEqual([]);
    chat.set("failed");
    const turned = stepAtWork(rest, at(own("open", 1), 1_016, on));
    expect(chipsOf(turned)).toEqual([["own", "failed"]]);
    expect(starOf(turned)).toMatchObject({ status: "failed", live: true });
    const named = hold(turned, own("open", 1), 1_032, 1_016 + AT_WORK_FAILED_CHIP_MS - 1, on);
    expect(chipsOf(named)).toEqual([["own", "failed"]]);
    // a timer ends it, as an agent's
    expect(named.wakeAt).toBe(1_016 + AT_WORK_FAILED_CHIP_MS);
    const ended = stepAtWork(named, at(own("open", 1), 1_016 + AT_WORK_FAILED_CHIP_MS, on));
    expect(ended.marks.chips).toEqual([]);
    expect(starOf(ended).status).toBe("failed");
    // a spark Chat already reads as Failed when its run lands, or when the list is first read, turned elsewhere
    expect(land(own("open", 1), 0, { sparkStatus: () => "failed" }).marks.chips).toEqual([]);
    // its row failing names nothing of a spark's
    const rowFailed = hold(rest, own("failed", 2), 1_016, 1_500, { sparkStatus: () => "running" });
    expect(rowFailed.marks.chips).toEqual([]);
  });

  it("keeps a spark's chip under your hand, as Chat keeps its status; an agent's needs-you chip goes with the pause", () => {
    const on = { sparkStatus: () => "approval" as const };
    const both = [row("a", "needs-you", 1), ...own("open", 1)];
    const held = hold(land(both, 0, on), both, 16, 500, { ...on, heldByYou: true });
    expect(chipsOf(held)).toEqual([["own", "needs-you"]]);
  });
});

describe("far zoom", () => {
  it("bands by the shorter side on screen: under 100 px merged, under 24 px a line", () => {
    expect(atWorkLod({ ...BIG, hx: 50, hy: 300 })).toBe("full");
    expect(atWorkLod({ ...BIG, hx: 49.9, hy: 300 })).toBe("merged");
    expect(atWorkLod({ ...BIG, hx: 12, hy: 12 })).toBe("merged");
    expect(atWorkLod({ ...BIG, hx: 11.9, hy: 300 })).toBe("line");
  });

  it("keeps a band until the side is 4 px past its edge, so a zoom across 100 or 24 never flickers", () => {
    const side = (s: number): ScreenFrame => ({ ...BIG, hx: s / 2, hy: s / 2 });
    expect(atWorkLod(side(98), "full")).toBe("full");
    expect(atWorkLod(side(95.9), "full")).toBe("merged");
    expect(atWorkLod(side(102), "merged")).toBe("merged");
    expect(atWorkLod(side(104), "merged")).toBe("full");
    expect(atWorkLod(side(22), "merged")).toBe("merged");
    expect(atWorkLod(side(19.9), "merged")).toBe("line");
    expect(atWorkLod(side(26), "line")).toBe("line");
    expect(atWorkLod(side(28), "line")).toBe("merged");
    expect(atWorkLod(side(120), "line")).toBe("full");
    // stepped across the edge and back by a pixel: one band throughout
    let state = land([row("a", "open", 1)], 0, { frame: side(101) });
    expect(state.marks.lod).toBe("full");
    for (const [i, s] of [99, 101, 99, 100.5, 98].entries()) {
      state = stepAtWork(state, at([row("a", "open", 1)], 16 * (i + 1), { frame: side(s) }));
      expect(state.marks.lod, `side ${s}`).toBe("full");
    }
  });

  it("merges the strokes into the first agent's under 100 px, with its sticker and a +N for the rest", () => {
    const state = land(
      ["a", "b", "c"].map((run) => row(run, "open", 1)),
      0,
      { frame: MID },
    );
    expect(state.marks.lod).toBe("merged");
    expect(state.marks.strokes.map((s) => [s.run, s.hw, s.gap])).toEqual([["a", 4.5, 17]]);
    expect(state.marks.seats.map((s) => [s.form, s.count, s.x, s.y])).toEqual([
      ["sticker", 0, 557, 380],
      ["count", 2, 557, 408],
    ]);
  });

  it("leaves only a 2 px line under 24 px, still and with no seat", () => {
    for (const zoom of [1, 0.4]) {
      const state = land([row("a", "acting", 1), row("b", "open", 1)], 0, { frame: TINY, zoom });
      expect(state.marks.lod).toBe("line");
      expect(state.marks.strokes).toHaveLength(1);
      const line = strokeOf(state);
      expect(line.form).toBe("line");
      expect(line.hw * state.marks.inkScale).toBeCloseTo(1, 9);
      expect([line.wet, line.glow, line.sweep, line.travel]).toEqual([0, 0, 0, 0]);
      expect(state.marks.seats).toEqual([]);
    }
  });
});

describe("reduced motion", () => {
  const RM = { reducedMotion: true } as const;

  it("fades an arrival in over half the draw's length, the stroke whole from its first frame", () => {
    const arrive = [row("a", "open", 1)];
    const t0 = stepAtWork(undefined, at(arrive, 1_000, RM));
    expect([strokeOf(t0).drawn, strokeOf(t0).opacity]).toEqual([1, 0]);
    const half = stepAtWork(t0, at(arrive, 1_195, RM));
    expect(strokeOf(half).opacity).toBeCloseTo(AT_WORK_EASE.out(0.5), 9);
    const whole = stepAtWork(half, at(arrive, 1_390, RM));
    expect(strokeOf(whole).opacity).toBe(1);
    expect(whole.moving).toBe(false);
  });

  it("parks the wet stretch, rings nothing, and asks for no frame while it works", () => {
    const acting = land([row("a", "acting", 1)], 0, RM);
    const later = hold(acting, [row("a", "acting", 1)], 16, 2_000, RM);
    expect(strokeOf(later).travel).toBe(AT_WORK_MOTION.parkedPx);
    expect(later.moving).toBe(false);
    const asking = [row("a", "needs-you", 1)];
    const asked = hold(land(asking, 0, RM), asking, 16, 500, RM);
    expect(seatOf(asked).ring).toBeNull();
    expect(asked.wakeAt).toBeNull();
  });

  it("fades a leaving out over half the reel's length, the stroke standing as it was", () => {
    const open = land([row("a", "open", 1)], 0, RM);
    const gone = [row("a", "released", 2)];
    const start = stepAtWork(open, at(gone, 1_000, RM));
    const mid = stepAtWork(start, at(gone, 1_115, RM));
    expect(strokeOf(mid).drawn).toBe(1);
    expect(strokeOf(mid).opacity).toBeCloseTo(1 - AT_WORK_EASE.out(0.5), 9);
    expect(stepAtWork(mid, at(gone, 1_230, RM)).marks.strokes).toEqual([]);
  });

  it("never shivers, and shows a spark's star as a still: no live stage", () => {
    const failed = hold(land([row("a", "open", 1)], 0, RM), [row("a", "failed", 2)], 16, 100, RM);
    expect(strokeOf(failed).shiver).toBe(0);
    const own = land([row("own", "acting", 1, { spark: SPARK })], 0, RM);
    expect(seatOf(own).star?.live).toBe(false);
    const working = hold(own, [row("own", "acting", 1, { spark: SPARK })], 16, 1_000, RM);
    expect(working.marks.stageLive).toBe(false);
    expect(atWorkBoardWake([working], 1_000)).toEqual({ raf: false, at: null });
  });
});

describe("whose ink", () => {
  it("wears the project's ink when Godview has dealt it one, the neutral when not, and a spark's starlight", () => {
    const state = land([
      row("own", "open", 1, { spark: SPARK }),
      row("dealt", "open", 1, { project: { name: "vibe-field", seq: 3 } }),
      row("none", "open", 1),
    ]);
    const inks: AtWorkInk[] = state.marks.strokes.map((s) => s.ink);
    expect(inks).toEqual([INKS.starlight, projectInkOf(3), INKS.neutral]);
    expect(seatOf(state, 1).ink).toBe(projectInkOf(3));
  });

  it("wears the neutral pearl on every mark and a crew star on no sticker while the feed carries none of 550a's ids", () => {
    // until 550a's fieldd sends `project`, `spark` and `startedBy`, every row reads so: this is the build's honest
    // state then (every mark pearl, no spark star, no printed star), never a bug
    const state = land([row("a", "reading", 1), row("b", "open", 1), row("c", "acting", 1)]);
    expect(state.marks.strokes.map((s) => s.ink)).toEqual([
      INKS.neutral,
      INKS.neutral,
      INKS.neutral,
    ]);
    expect(state.marks.strokes.map((s) => s.form)).toEqual(["marker", "marker", "marker"]);
    expect(state.marks.seats.map((s) => [s.form, s.spark, s.crewSpark, s.crew])).toEqual([
      ["sticker", null, null, 0],
      ["sticker", null, null, 0],
      ["sticker", null, null, 0],
    ]);
  });

  it("eases to a project's ink dealt later", () => {
    const neutral = hold(land([row("a", "open", 1)]), [row("a", "open", 1)], 16, 1_000);
    const dealt = [row("a", "open", 1, { project: { seq: 5 } })];
    const t0 = stepAtWork(neutral, at(dealt, 1_000));
    expect([strokeOf(t0).inkFrom, strokeOf(t0).ink, strokeOf(t0).inkMix]).toEqual([
      INKS.neutral,
      projectInkOf(5),
      0,
    ]);
    const mid = stepAtWork(t0, at(dealt, 1_100));
    expect(strokeOf(mid).inkMix).toBeCloseTo(1 - Math.exp(-1), 9);
    expect(mid.moving).toBe(true);
    const done = hold(mid, dealt, 1_116, 1_800);
    expect(strokeOf(done).inkMix).toBe(1);
    expect(done.moving).toBe(false);
  });
});

describe("rest — a frame only while a mark moves", () => {
  it("asks for no frame and no timer once an open mark has settled", () => {
    const state = hold(land([row("a", "open", 1)]), [row("a", "open", 1)], 16, 1_000);
    expect(state.moving).toBe(false);
    expect(state.wakeAt).toBeNull();
    expect(state.marks.stageLive).toBe(false);
    expect(atWorkNextWake(state, 1_000)).toBeNull();
    expect(atWorkBoardWake([state], 1_000)).toEqual({ raf: false, at: null });
  });

  it("asks for frames for as long as the ink runs", () => {
    const state = hold(land([row("a", "reading", 1)]), [row("a", "reading", 1)], 16, 5_000);
    expect(state.moving).toBe(true);
    expect(atWorkBoardWake([state], 5_000)).toEqual({ raf: true, at: 5_000 });
  });

  it("holds the marks' clock still at rest, so a pan never moves the flecks or the sheen", () => {
    let state = land([row("a", "open", 1)]);
    for (let t = 16; t <= 2_000; t += 16) {
      state = stepAtWork(state, at([row("a", "open", 1)], t, { frame: { ...BIG, cx: 500 + t } }));
    }
    expect(state.marks.clock).toBe(0);
    const working = hold(land([row("a", "reading", 1)]), [row("a", "reading", 1)], 16, 1_000);
    expect(working.marks.clock).toBeCloseTo(1_000, 9);
  });

  it("keeps a spark's star live on its stage for the desk's wind window after its work last moved, asking frames for it, then stills it", () => {
    expect(AT_WORK_MOTION.ambientMs).toBe(DESK_WIND_IDLE_MS);
    expect(AT_WORK_MOTION.ambientMs).toBe(8_000);
    const working = hold(
      land([row("own", "reading", 1, { spark: SPARK })]),
      [row("own", "reading", 1, { spark: SPARK })],
      16,
      1_000,
    );
    const idle = [row("own", "open", 2, { spark: SPARK })];
    const resting = hold(working, idle, 1_000, 8_900, {}, 100);
    expect(seatOf(resting).star?.live).toBe(true);
    // the marks lie still, but the star's stage needs its frames: the board asks for them
    expect(resting.moving).toBe(false);
    expect(resting.marks.stageLive).toBe(true);
    expect(atWorkMoving(resting, 8_900)).toBe(true);
    expect(atWorkBoardWake([resting], 8_900)).toEqual({ raf: true, at: 8_900 });
    expect(resting.wakeAt).toBe(9_000);
    const stilled = hold(resting, idle, 9_000, 9_100, {}, 100);
    expect(seatOf(stilled).star?.live).toBe(false);
    expect(stilled.marks.stageLive).toBe(false);
    expect(stilled.moving).toBe(false);
    expect(atWorkBoardWake([stilled], 9_100)).toEqual({ raf: false, at: null });
  });

  it("wakes the board at its earliest timer when nothing moves", () => {
    const asleep = hold(land([row("a", "needs-you", 1)]), [row("a", "needs-you", 1)], 16, 2_300);
    const open = hold(land([row("b", "open", 1)]), [row("b", "open", 1)], 16, 2_300);
    expect(atWorkBoardWake([open, asleep], 2_300)).toEqual({ raf: false, at: 2_400 });
  });
});

describe("the model's code", () => {
  const source = readFileSync(
    join(PACKAGE_ROOT, "src", "field", "desk", "at-work", "at-work-model.ts"),
    "utf8",
  );

  it("never compares an agent id to a literal: a mark is looked up by its id (R23b)", () => {
    expect(source).not.toMatch(/\.agent\s*[!=]==/);
    expect(source).not.toMatch(/[!=]==\s*["'`][a-z]+["'`]\s*&&\s*\w+\.agent/);
  });

  it("maps no row state to a spark's status: it reads Chat's through the input's one seam", () => {
    expect(source).not.toMatch(/AT_WORK_FACE|atWorkFaceOf|FIRST_FACE/);
    expect(source.match(/input\.sparkStatus\(/g) ?? []).toHaveLength(1);
  });
});
