// @vitest-environment happy-dom
/**
 * Item 550 (2026-11-18) — THE AT-WORK LAYER (DESIGN.md §8 "At work on the mat", §6 "At work on the mat" and M5, §2.10
 * "the desk is a stage", §7 the pencil). Over a recording WebGL2 stand-in, a context door that counts what it makes, a
 * stand-in atlas and a stand-in stage, on a clock of the test's own:
 *   THE CONTEXT is the first mark's: a mount, ten flushes of an empty board and a read make none; the first marked
 *     flush makes the window's one, and a remount keeps it (its canvas taken into the new box);
 *   THE FRAME: at most one draw a frame stamp, from a flush or from the layer's own rAF; none at rest, none while
 *     hidden; the canvas display:none with no mark on screen; the rows' storage made once a build, each draw writing
 *     its rows into it; a lost context the DOM form at once, a restored one the GL form with the atlas uploaded again;
 *   THE DOM FORM is still: an acting mark asks for no frame past its arrival's fade; a window that can bake no sticker
 *     stands in it;
 *   THE FOCUS: while something else is in hand a mark dims over the hand's 560 ms pickup and returns over its 440 ms
 *     put-back (ICE's `HOLD`), both on the island curve, and asks for frames only while it moves; a spark's live star
 *     on its stage, its still and the chips dim with it;
 *   THE SEEDS: a crew star drawn before its spark is read gains its star on a touch, with no desk step;
 *   THE TOKENS are never read inside a flush; a root not yet spelled is read again until it is;
 *   THE STAGE: a spark's live star drawn on the desk's stage each frame while its work moves, its still standing aside;
 *     let go once the ambient is over, and no frame asked after; its context lost, the still again and no new stage;
 *     made after the frame that wants it and sized on its box's resize, never measuring in the desk's flush;
 *   THE STATUS is Chat's: the stage's face wears the status Chat's list holds, its props by the switch; a change of it
 *     alone, the row unchanged, wakes a resting overlay on a touch and keeps the star live for the ambient; with no
 *     entry the star is its still; a smoke's lent spark stands in only where Chat reads none;
 *   REDUCED MOTION turned at rest is drawn at once, and a ring's timer goes with it;
 *   THE WALL: only the desk door takes up the smokes' switches and lent sparks, and only the mount reads a lent seed;
 *   THE PACK: each named texel where the shader reads it, for one object with three strokes and three seats; a star
 *     seat whose face is not dealt packs no opacity, so throws no shadow; the objects capped; the layer's one buffer
 *     written in place;
 *   THE MASK: a port of the shader's `pencilMask` holds no overlay ink on the pencil at any point of its lock-on, where
 *     the stroke at its deepest wobble would lie on it: the band is needed and enough.
 * Red first: the layer's commit makes these hold.
 */
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { HOLD } from "@vibecook/ice/desk";
import { DAY_LIGHT } from "@vibecook/ice/desk/kit";
import { AGENT_CATALOG, type AtWorkState } from "@vibefield/contracts";
import type {
  DrivenFace,
  DrivenStage,
  Sparklings,
  SparkStatus,
} from "@vibefield/design-kit/spark-face";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  AT_WORK_ATLAS,
  type AtWorkAtlas,
  type AtWorkPrintedStar,
} from "../src/field/desk/at-work/at-work-atlas";
import {
  type AtWorkInks,
  neutralInkOf,
  starlightInkOf,
} from "../src/field/desk/at-work/at-work-ink";
import {
  AT_WORK_FOCUS,
  AT_WORK_GL,
  type AtWorkCells,
  type AtWorkContext,
  type AtWorkContextDoor,
  type AtWorkLayer,
  type AtWorkLayerSeams,
  type AtWorkLentSpark,
  type AtWorkScene,
  type AtWorkStageSeams,
  atWorkDraws,
  atWorkRenders,
  atWorkStageFrames,
  countAtWorkRender,
  createAtWorkLayer,
  lendAtWorkSparks,
  lentAtWorkSeed,
  makeAtWorkContext,
  packAtWork,
} from "../src/field/desk/at-work/at-work-layer";
import {
  AT_WORK,
  AT_WORK_EASE,
  AT_WORK_MOTION,
  AT_WORK_RING_LIFE_MS,
  AT_WORK_STAR_PROPS,
  type ScreenFrame,
  stepAtWork,
} from "../src/field/desk/at-work/at-work-model";
import type { AtWorkRow } from "../src/field/desk/at-work/at-work-rows";
import {
  AT_WORK_FS,
  AT_WORK_NO_HAND,
  AT_WORK_NO_PENCIL,
  AT_WORK_PENCIL,
  AT_WORK_ROWS,
  AT_WORK_SHADER,
  AT_WORK_VS,
  type AtWorkPencil,
  atWorkHandUniforms,
  atWorkPencilOf,
} from "../src/field/desk/at-work/at-work-shader";
import { atWorkIds, atWorkPlacementsOf } from "../src/field/desk/at-work/at-work-shape";
import type { AtWorkBoard } from "../src/field/desk/at-work/at-work-store";

const PACKAGE_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

beforeEach(() => {
  // no observer here: a size the test does not set never draws a frame of its own
  vi.stubGlobal("ResizeObserver", undefined);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function must<T>(value: T | null): T {
  if (value === null) throw new Error("the fixture did not read");
  return value;
}

/** The root's tokens as a fixture theme spells them (the shader's and the ink's tests read tokens.css's own). */
const TOKENS: Readonly<Record<string, string>> = {
  "--vf-atwork-neutral": "rgb(177 170 157)",
  "--vf-atwork-pearl": "rgb(240 231 214)",
  "--vf-atwork-pearl-deep": "rgb(137 130 153)",
  "--vf-atwork-pearl-rose": "rgb(253 196 227)",
  "--vf-atwork-pearl-aqua": "rgb(167 237 236)",
  "--vf-atwork-print": "rgb(22 23 27)",
  "--vf-atwork-cast": "rgb(14 26 10)",
  "--vf-atwork-cast-night": "rgb(5 5 9)",
  "--vf-sticker-edge": "rgb(255 255 255)",
  "--vf-sticker-cut": "rgb(0 0 0 / 12%)",
  "--vf-mat-ground": "rgb(61 90 48)",
};
const read = (token: string): string => TOKENS[token] ?? "";
const STARLIGHT = must(starlightInkOf(read));
const INKS: AtWorkInks = {
  neutral: must(neutralInkOf(read("--vf-atwork-neutral"), STARLIGHT)),
  starlight: STARLIGHT,
};

// agents by their catalog ids, never spelled here (R23b's spirit: a mark is looked up by id)
const AGENT = AGENT_CATALOG[0]?.id ?? "agent";
const SPARK = "sp-vela0001";
const KEY = "k1";
/** A 240 × 160 object, its corner 10, square to the view. */
const FRAME: ScreenFrame = { cx: 400, cy: 300, hx: 120, hy: 80, angle: 0, r: 10 };
const VIEW = { width: 800, height: 600 } as const;

/** A printed star as the atlas would hand one. */
const PRINTED: AtWorkPrintedStar = {
  cell: 6,
  tone: { c: [0.1, 0.2, 0.3], a: [0.4, 0.5, 0.6], b: [0.7, 0.8, 0.9] },
};

function row(run: string, state: AtWorkState, since = 1, ids: Partial<AtWorkRow> = {}): AtWorkRow {
  return { run, handle: `${run} in vibe-field`, agent: AGENT, state, since, ...ids };
}

/** A board of these objects; `landed`: its runs were at work when the feed began, so they stand settled. */
function boardOf(
  objects: Readonly<Record<string, readonly AtWorkRow[]>>,
  landed = true,
  epoch = 0,
): AtWorkBoard {
  const entries = Object.entries(objects);
  return {
    docId: "doc",
    objects: new Map(
      entries.map(([key, agents]) => [key, { ref: "vf:obj/abcd1234", key, agents }] as const),
    ),
    landed: landed
      ? new Map(entries.map(([key, agents]) => [key, new Set(agents.map((a) => a.run))] as const))
      : new Map(),
    epoch,
  };
}

const EMPTY = boardOf({});

function sceneOf(
  board: AtWorkBoard,
  extra: { readonly frame?: ScreenFrame; readonly dimmed?: boolean } = {},
): AtWorkScene {
  return {
    board,
    placed: [...board.objects.keys()].map((key) => ({
      key,
      frame: extra.frame ?? FRAME,
      heldByYou: false,
      fade: 1,
      dimmed: extra.dimmed ?? false,
      held: false,
    })),
    zoom: 1,
    view: VIEW,
    light: DAY_LIGHT,
    pencil: AT_WORK_NO_PENCIL,
    theme: "light",
  };
}

// ———————————————————————————————————————————————————————————————— the stand-ins

interface FakeGl {
  readonly gl: WebGL2RenderingContext;
  /** every call, by name, in order */
  readonly calls: string[];
  /** the rows each `texSubImage2D` wrote, copied as written */
  readonly rows: Float32Array[];
  /** each vec4 uniform as last set, by its name */
  readonly uniforms: Map<string, number[]>;
}

/** A WebGL2 stand-in: every call is a no-op that is counted; shaders compile and programs link. */
function fakeGl(): FakeGl {
  const calls: string[] = [];
  const rows: Float32Array[] = [];
  const uniforms = new Map<string, number[]>();
  const gl = new Proxy(
    {},
    {
      get(_target, name: string) {
        if (name === "getShaderParameter" || name === "getProgramParameter") return () => true;
        if (name === "getExtension") return () => null;
        if (/^[A-Z_0-9]+$/.test(name)) return 0;
        return (...args: unknown[]) => {
          calls.push(name);
          if (name === "texSubImage2D") rows.push(Float32Array.from(args[8] as Float32Array));
          // a uniform's location carries its name, so the value set at it is read back by name
          if (name === "getUniformLocation") return { uniform: args[1] };
          if (name === "uniform4f")
            uniforms.set(
              String((args[0] as { uniform?: string } | null)?.uniform),
              args.slice(1) as number[],
            );
          return name.startsWith("create") || name.startsWith("get") ? { name } : undefined;
        };
      },
    },
  );
  return { gl: gl as unknown as WebGL2RenderingContext, calls, rows, uniforms };
}

const countOf = (calls: readonly string[], name: string): number =>
  calls.filter((call) => call === name).length;

/** An atlas that bakes nothing but answers every cell (or none, `bake: false`). */
function stubAtlas(opts: {
  readonly bake?: boolean;
  readonly star?: AtWorkPrintedStar;
}): AtWorkAtlas {
  const { cell, cols } = AT_WORK_ATLAS;
  const data = new Uint8Array(cols * cell * cell * 2);
  return {
    canBake: () => opts.bake ?? true,
    mark: () => 2,
    count: () => 3,
    star: () => opts.star,
    crewSeat: () => [1.5, -2.5] as const,
    texels: () => ({ data, width: cols * cell, height: cell, revision: 1 }),
    subscribe: () => () => {},
  };
}

/** The window's context door, counting the contexts it makes; `webgl: false` a window with none. */
function contextDoor(
  opts: {
    readonly webgl?: boolean;
    readonly bake?: boolean;
    readonly star?: AtWorkPrintedStar;
  } = {},
) {
  const fake = fakeGl();
  const canvas = document.createElement("canvas");
  const atlas = stubAtlas(opts);
  let made: AtWorkContext | null = null;
  let makes = 0;
  const door: AtWorkContextDoor = {
    peek: () => made,
    make: () => {
      if (made === null) {
        makes += 1;
        made = makeAtWorkContext(canvas, atlas, opts.webgl === false ? null : fake.gl);
      }
      return made;
    },
  };
  return { door, fake, canvas, makes: () => makes };
}

/** A stage the test watches: what it was told to place, how often it rendered, whether it was let go. */
interface FakeStage {
  readonly stage: DrivenStage;
  readonly canvas: HTMLCanvasElement;
  readonly placed: Map<string, DrivenFace>;
  renders: number;
  released: boolean;
}

/** A stand-in kit for the stage; `measured` is told each time the engine would measure its canvas (made, sized). */
function stageKit(measured: (what: "create" | "resize") => void = () => {}): {
  readonly kit: AtWorkStageSeams;
  readonly made: FakeStage[];
} {
  const made: FakeStage[] = [];
  const kit: AtWorkStageSeams = {
    load: () => Promise.resolve({} as Sparklings),
    create: (canvas) => {
      measured("create");
      const placed = new Map<string, DrivenFace>();
      const one: FakeStage = {
        canvas,
        placed,
        renders: 0,
        released: false,
        stage: {
          place: (id, face) => {
            placed.set(id, face);
          },
          drop: (id) => {
            placed.delete(id);
          },
          render: () => {
            one.renders += 1;
          },
          resize: () => {
            measured("resize");
          },
          frames: () => one.renders,
          release: () => {
            one.released = true;
          },
          released: () => one.released,
        },
      };
      made.push(one);
      return one.stage;
    },
    canvas: () => document.createElement("canvas"),
  };
  return { kit, made };
}

/** A stage whose engine never arrives (a row that draws no spark). */
const NO_STAGE: AtWorkStageSeams = {
  load: () => new Promise<Sparklings>(() => {}),
  create: () => null,
  canvas: () => null,
};

/** The test's clock: the frames asked, the timers set, the token reads. */
interface Clock {
  now: number;
  stamp: number;
  asked: number;
  tokenReads: number;
  readonly frames: (() => void)[];
  readonly timers: Map<number, { readonly fn: () => void; readonly at: number }>;
}

function harness(door: AtWorkContextDoor, extra: Partial<AtWorkLayerSeams> = {}) {
  const c: Clock = {
    now: 1_000,
    stamp: 1_000,
    asked: 0,
    tokenReads: 0,
    frames: [],
    timers: new Map(),
  };
  let id = 0;
  const seams: AtWorkLayerSeams = {
    now: () => c.now,
    frameStamp: () => c.stamp,
    requestFrame: (fn) => {
      c.asked += 1;
      c.frames.push(fn);
      return fn;
    },
    cancelFrame: (handle) => {
      const at = c.frames.indexOf(handle as () => void);
      if (at >= 0) c.frames.splice(at, 1);
    },
    setTimer: (fn, ms) => {
      id += 1;
      c.timers.set(id, { fn, at: c.now + ms });
      return id;
    },
    clearTimer: (timer) => {
      c.timers.delete(timer as number);
    },
    deskAwake: () => false,
    token: (name) => {
      c.tokenReads += 1;
      return TOKENS[name] ?? "";
    },
    sparkSeed: () => null,
    sparkStatus: () => null,
    context: door,
    stage: NO_STAGE,
    ...extra,
  };
  /** One frame `ms` on: the timers due by then, then the frames asked before it. */
  const tick = (ms = 16): void => {
    c.now += ms;
    c.stamp = c.now;
    for (const [key, timer] of [...c.timers].sort((a, b) => a[1].at - b[1].at)) {
      if (timer.at > c.now || !c.timers.has(key)) continue;
      c.timers.delete(key);
      timer.fn();
    }
    for (const fn of c.frames.splice(0, c.frames.length)) fn();
  };
  return { c, seams, tick };
}

function mounted(layer: AtWorkLayer): HTMLElement {
  const host = document.createElement("div");
  layer.attach(host);
  return host;
}

const texelOf = (data: Float32Array, row: number, texel: number): number[] => {
  const at = (row * AT_WORK_ROWS.texels + texel) * 4;
  return Array.from(data.subarray(at, at + 4));
};

function near(actual: readonly number[], expected: readonly number[]): void {
  expect(actual).toHaveLength(expected.length);
  for (const [i, value] of expected.entries()) expect(actual[i]).toBeCloseTo(value, 4);
}

const last = (fake: FakeGl): Float32Array => {
  const rows = fake.rows.at(-1);
  if (rows === undefined) throw new Error("nothing was drawn");
  return rows;
};

/** The promises in flight settle (the stage's engine arriving). */
async function settle(): Promise<void> {
  for (let i = 0; i < 6; i += 1) await Promise.resolve();
}

// ———————————————————————————————————————————————————————————————— the context

describe("the window's one context is the first mark's (DESIGN.md §8, one context a window)", () => {
  it("makes none at a mount, over ten flushes of an empty board or for a read; the first marked flush makes it; a remount keeps it", () => {
    const { door, makes, canvas } = contextDoor();
    const { seams, tick } = harness(door);
    const layer = createAtWorkLayer(seams);
    const host = document.createElement("div");
    const off = layer.attach(host);
    for (let i = 0; i < 10; i += 1) {
      layer.show(sceneOf(EMPTY));
      tick();
    }
    const before = layer.record();
    expect(makes()).toBe(0);
    expect(before.contexts).toBe(0);
    expect(before.why).toMatch(/no mark/);
    expect(host.childElementCount).toBe(0);
    layer.show(sceneOf(boardOf({ [KEY]: [row("r1", "open")] })));
    expect(makes()).toBe(1);
    expect(layer.record().contexts).toBe(1);
    expect(layer.record().form).toBe("gl");
    expect(canvas.parentElement).toBe(host);
    off();
    layer.dispose();
    // a remount: the next mount's layer takes the window's canvas into its own box, and makes no other
    const again = createAtWorkLayer(harness(door).seams);
    const next = mounted(again);
    expect(canvas.parentElement).toBe(next);
    again.show(sceneOf(boardOf({ [KEY]: [row("r1", "open")] })));
    expect(makes()).toBe(1);
    expect(again.record().contexts).toBe(1);
    again.dispose();
  });

  it("a window with no WebGL2 holds no context and says why; its marks are the DOM form", () => {
    const { door } = contextDoor({ webgl: false });
    const layer = createAtWorkLayer(harness(door).seams);
    mounted(layer);
    layer.show(sceneOf(boardOf({ [KEY]: [row("r1", "open")] })));
    expect(layer.record().contexts).toBe(0);
    expect(layer.record().why).toMatch(/no WebGL2/);
    expect(layer.shape().form).toBe("dom");
    layer.dispose();
  });
});

// ———————————————————————————————————————————————————————————————— the frame

describe("the frame: one draw a stamp, none at rest (DESIGN.md §6 M5)", () => {
  it("draws at most once a frame: a flush in a frame drawn already is drawn on the next", () => {
    const { door, fake } = contextDoor();
    const { seams, tick } = harness(door);
    const layer = createAtWorkLayer(seams);
    mounted(layer);
    const board = boardOf({ [KEY]: [row("r1", "open")] });
    layer.show(sceneOf(board));
    expect(countOf(fake.calls, "drawArraysInstanced")).toBe(1);
    // the camera moved within the same frame: drawn on the next, never twice in this one
    layer.show(sceneOf(board, { frame: { ...FRAME, cx: FRAME.cx + 5 } }));
    expect(countOf(fake.calls, "drawArraysInstanced")).toBe(1);
    expect(layer.record().deferred).toBe(1);
    tick();
    expect(countOf(fake.calls, "drawArraysInstanced")).toBe(2);
    layer.dispose();
  });

  it("a moving mark draws once a frame on its own rAF, and its rAF never draws a frame a flush drew", () => {
    const { door, fake } = contextDoor();
    const { c, seams, tick } = harness(door);
    const layer = createAtWorkLayer(seams);
    mounted(layer);
    // arriving (not landed): it draws on over 780 ms
    layer.show(sceneOf(boardOf({ [KEY]: [row("r1", "reading")] }, false)));
    expect(countOf(fake.calls, "drawArraysInstanced")).toBe(1);
    expect(c.frames).toHaveLength(1);
    // the rAF runs in the frame the flush drew (the desk fell asleep after its flush): no second draw, asked again
    for (const fn of c.frames.splice(0, c.frames.length)) fn();
    expect(countOf(fake.calls, "drawArraysInstanced")).toBe(1);
    expect(c.frames).toHaveLength(1);
    for (let i = 0; i < 10; i += 1) tick();
    expect(countOf(fake.calls, "drawArraysInstanced")).toBe(11);
    expect(layer.record().deferred).toBe(0);
    layer.dispose();
  });

  it("at rest draws nothing, asks no frame and sets no timer; hidden, a camera move draws nothing either", () => {
    const { door } = contextDoor();
    const { c, seams, tick } = harness(door);
    const layer = createAtWorkLayer(seams);
    mounted(layer);
    const board = boardOf({ [KEY]: [row("r1", "open")] });
    layer.show(sceneOf(board));
    tick();
    tick();
    const draws = atWorkDraws();
    const asked = c.asked;
    for (let i = 0; i < 20; i += 1) {
      layer.show(sceneOf(board));
      tick();
    }
    expect(atWorkDraws() - draws).toBe(0);
    expect(c.asked).toBe(asked);
    expect(layer.record().moving).toBe(false);
    expect(layer.record().wakeAt).toBeNull();
    expect(c.timers.size).toBe(0);
    layer.setHidden("cover");
    layer.show(sceneOf(board, { frame: { ...FRAME, cx: 300 } }));
    tick();
    expect(atWorkDraws() - draws).toBe(0);
    expect(layer.record().hidden).toBe("cover");
    layer.dispose();
  });

  it("the canvas is display:none with no mark on screen, and shown again when one is", () => {
    const { door, canvas } = contextDoor();
    const { seams, tick } = harness(door);
    const layer = createAtWorkLayer(seams);
    mounted(layer);
    const board = boardOf({ [KEY]: [row("r1", "open")] });
    layer.show(sceneOf(board, { frame: { ...FRAME, cx: -5_000 } }));
    expect(layer.record().onScreen).toBe(0);
    expect(canvas.style.display).toBe("none");
    tick();
    layer.show(sceneOf(board));
    expect(layer.record().onScreen).toBe(1);
    expect(canvas.style.display).toBe("");
    layer.dispose();
  });

  it("makes the rows' storage once a build and writes each draw's rows into it; a lost context is the DOM form at once, a restored one the GL form with its atlas uploaded again", () => {
    const { door, fake, canvas } = contextDoor();
    const { seams, tick } = harness(door);
    const layer = createAtWorkLayer(seams);
    mounted(layer);
    layer.show(sceneOf(boardOf({ [KEY]: [row("r1", "reading")] }, false)));
    for (let i = 0; i < 9; i += 1) tick();
    const drawn = countOf(fake.calls, "drawArraysInstanced");
    expect(drawn).toBe(10);
    expect(countOf(fake.calls, "texStorage2D")).toBe(1);
    expect(countOf(fake.calls, "texSubImage2D")).toBe(drawn);
    // the atlas alone is uploaded whole, once its revision is new to the texture
    expect(countOf(fake.calls, "texImage2D")).toBe(1);
    expect(layer.shape().form).toBe("gl");
    canvas.dispatchEvent(new Event("webglcontextlost", { cancelable: true }));
    expect(layer.shape().form).toBe("dom");
    expect(layer.record().why).toMatch(/lost/);
    tick();
    canvas.dispatchEvent(new Event("webglcontextrestored"));
    expect(layer.shape().form).toBe("gl");
    expect(countOf(fake.calls, "texStorage2D")).toBe(2);
    expect(countOf(fake.calls, "texImage2D")).toBe(2);
    layer.dispose();
  });
});

// ———————————————————————————————————————————————————————————————— the DOM form

describe("the DOM form is still (DESIGN.md §8: without WebGL2, the DOM form)", () => {
  it("an acting mark in the DOM form asks for no frame past its arrival's fade", () => {
    const { door } = contextDoor({ webgl: false });
    const { c, seams, tick } = harness(door);
    const layer = createAtWorkLayer(seams);
    mounted(layer);
    layer.show(sceneOf(boardOf({ [KEY]: [row("r1", "acting")] }, false)));
    expect(layer.shape().form).toBe("dom");
    while (c.now < 1_000 + AT_WORK_MOTION.drawMs / 2 + 40) tick();
    const asked = c.asked;
    for (let i = 0; i < 30; i += 1) tick();
    expect(c.asked).toBe(asked);
    expect(layer.record().moving).toBe(false);
    layer.dispose();
  });

  it("a window that can bake no sticker draws the DOM form, never a sticker of another's cell", () => {
    const { door, fake } = contextDoor({ bake: false });
    const layer = createAtWorkLayer(harness(door).seams);
    mounted(layer);
    layer.show(sceneOf(boardOf({ [KEY]: [row("r1", "open")] })));
    expect(layer.shape().form).toBe("dom");
    expect(countOf(fake.calls, "drawArraysInstanced")).toBe(0);
    layer.dispose();
  });
});

// ———————————————————————————————————————————————————————————————— the focus, the seeds, the tokens

describe("the marks dim with the out-of-focus desk at the hand's own pace (DESIGN.md §6 Something in hand, §8 When not)", () => {
  it("dims over the pickup's 560 ms and returns over the put-back's 440, both on the island curve, asking for frames only while it moves", () => {
    // the hand's own times (ICE's `HOLD`), never the bar's travel
    expect([AT_WORK_FOCUS.inMs, AT_WORK_FOCUS.outMs]).toEqual([HOLD.inMs, HOLD.outMs]);
    expect([HOLD.inMs, HOLD.outMs]).toEqual([560, 440]);
    const { door, fake } = contextDoor();
    const { c, seams, tick } = harness(door);
    const layer = createAtWorkLayer(seams);
    mounted(layer);
    const board = boardOf({ [KEY]: [row("r1", "open")] });
    layer.show(sceneOf(board));
    tick();
    const opacity = (): number => texelOf(last(fake), 1, AT_WORK_ROWS.stroke.hand)[3] ?? Number.NaN;
    const level = (from: number, to: number, p: number): number =>
      from + (to - from) * AT_WORK_EASE.island(p);
    expect(opacity()).toBeCloseTo(1, 4);
    // something else is taken in hand
    layer.show(sceneOf(board, { dimmed: true }));
    const t0 = c.now;
    while (c.now < t0 + AT_WORK_FOCUS.inMs / 2) tick(20);
    const p = (c.now - t0) / AT_WORK_FOCUS.inMs;
    expect(opacity()).toBeCloseTo(level(1, AT_WORK_FOCUS.dimmed, p), 4);
    expect(layer.record().moving).toBe(true);
    while (c.now < t0 + AT_WORK_FOCUS.inMs + 40) tick(20);
    expect(opacity()).toBeCloseTo(AT_WORK_FOCUS.dimmed, 4);
    expect(layer.record().moving).toBe(false);
    // a frame of its own drew nothing since: the put-back's flush is drawn in its own frame
    tick(20);
    // it is put back
    layer.show(sceneOf(board));
    const t1 = c.now;
    while (c.now < t1 + AT_WORK_FOCUS.outMs / 2) tick(20);
    const q = (c.now - t1) / AT_WORK_FOCUS.outMs;
    expect(opacity()).toBeCloseTo(level(AT_WORK_FOCUS.dimmed, 1, q), 4);
    expect(layer.record().moving).toBe(true);
    while (c.now < t1 + AT_WORK_FOCUS.outMs + 40) tick(20);
    expect(opacity()).toBeCloseTo(1, 4);
    expect(layer.record().moving).toBe(false);
    expect(c.frames).toHaveLength(0);
    layer.dispose();
  });

  it("dims a spark's live star on its stage with the mark: its alpha at the dimmed level of its own by 560 + 40 ms", async () => {
    const run = "s1";
    const starId = atWorkIds.seat(KEY, run, "star");
    const { kit, made } = stageKit();
    const { door } = contextDoor();
    const { c, seams, tick } = harness(door, {
      stage: kit,
      sparkSeed: () => 7,
      sparkStatus: () => "reviewing",
    });
    const layer = createAtWorkLayer(seams);
    mounted(layer);
    const still = document.createElement("div");
    layer.bind(starId, still);
    const board = boardOf({ [KEY]: [row(run, "reading", 1, { spark: SPARK })] });
    layer.show(sceneOf(board));
    await settle();
    tick(100);
    const alpha = (): number => made[0]?.placed.get(starId)?.alpha ?? Number.NaN;
    const undimmed = alpha();
    expect(undimmed).toBeGreaterThan(0);
    // something else is taken in hand: the star stays live on its stage, its still aside, and dims with the mark
    layer.show(sceneOf(board, { dimmed: true }));
    const t0 = c.now;
    while (c.now < t0 + AT_WORK_FOCUS.inMs + 40) tick(20);
    expect(made).toHaveLength(1);
    expect(still.style.opacity).toBe("0.000");
    expect(alpha()).toBeCloseTo(AT_WORK_FOCUS.dimmed * undimmed, 4);
    layer.dispose();
  });

  it("dims a spark's still and its chip with the mark at rest: each written at the dimmed level by 560 + 40 ms", () => {
    const run = "s1";
    const starId = atWorkIds.seat(KEY, run, "star");
    const chipId = atWorkIds.chip(KEY, run);
    const { door } = contextDoor();
    const { c, seams, tick } = harness(door, {
      sparkSeed: () => 7,
      sparkStatus: () => "asking",
    });
    const layer = createAtWorkLayer(seams);
    mounted(layer);
    const still = document.createElement("div");
    const chip = document.createElement("div");
    layer.bind(starId, still);
    layer.bind(chipId, chip);
    // landed open, its status first read: its star is its still, and Asking you stands its chip
    const board = boardOf({ [KEY]: [row(run, "open", 1, { spark: SPARK })] });
    layer.show(sceneOf(board));
    tick();
    expect(layer.shape().objects[0]?.chips).toEqual([{ run, word: "needs-you" }]);
    expect(still.style.opacity).toBe("1.000");
    expect(chip.style.opacity).toBe("1.000");
    // something else is taken in hand
    layer.show(sceneOf(board, { dimmed: true }));
    const t0 = c.now;
    while (c.now < t0 + AT_WORK_FOCUS.inMs + 40) tick(20);
    expect(still.style.opacity).toBe(AT_WORK_FOCUS.dimmed.toFixed(3));
    expect(chip.style.opacity).toBe(AT_WORK_FOCUS.dimmed.toFixed(3));
    layer.dispose();
  });

  it('places a chip at the opacity the model gives it: at the object\'s fade of 0.35, written "0.350"', () => {
    const rows = [row("a1", "needs-you")];
    const chipAt = (fade: number) => {
      const marks = stepAtWork(undefined, {
        rows,
        frame: FRAME,
        zoom: 1,
        now: 0,
        reducedMotion: false,
        heldByYou: false,
        inks: INKS,
        sparkStatus: () => null,
        landed: new Set(["a1"]),
        fade,
      }).marks;
      const placed = atWorkPlacementsOf(
        [{ key: KEY, frame: FRAME, marks }],
        "gl",
        () => 120,
        VIEW.width,
      );
      return placed.find((place) => place.id === atWorkIds.chip(KEY, "a1"));
    };
    expect(chipAt(1)?.opacity).toBe("1.000");
    expect(AT_WORK_FOCUS.dimmed).toBe(0.35);
    expect(chipAt(AT_WORK_FOCUS.dimmed)?.opacity).toBe("0.350");
  });
});

describe("the object in hand covers the marks behind it (DESIGN.md §8 When not; the pages room's second live run, 2026-11-24)", () => {
  const HELD = "k-held";
  /** a pane lifted to the middle of the view, large: its silhouette as the hand draws it */
  const HAND: ScreenFrame = { cx: 400, cy: 300, hx: 360, hy: 260, angle: 0, r: 16 };
  /** one object behind the hand (dimmed while anything is in hand) and the held one, whose own marks go grey */
  const coverScene = (board: AtWorkBoard, hand: ScreenFrame | null): AtWorkScene => ({
    ...sceneOf(board),
    placed: [
      { key: KEY, frame: FRAME, heldByYou: false, fade: 1, dimmed: hand !== null, held: false },
      {
        key: HELD,
        frame: hand ?? HAND,
        heldByYou: hand !== null,
        fade: 1,
        dimmed: false,
        held: hand !== null,
      },
    ],
    hand,
  });
  const both = (): AtWorkBoard =>
    boardOf({ [KEY]: [row("r1", "open")], [HELD]: [row("r2", "open")] });

  it("GL: the row of the object behind says it lies under the hand, the held one's not, and the hand's silhouette is set", () => {
    const { door, fake } = contextDoor();
    const { c, seams, tick } = harness(door);
    const layer = createAtWorkLayer(seams);
    mounted(layer);
    const board = both();
    layer.show(coverScene(board, HAND));
    expect(texelOf(last(fake), 0, AT_WORK_ROWS.object.strokes)[3]).toBe(1);
    expect(texelOf(last(fake), 1, AT_WORK_ROWS.object.strokes)[3]).toBe(0);
    expect(fake.uniforms.get("uHandBox")).toEqual([...atWorkHandUniforms(HAND).box]);
    expect(fake.uniforms.get("uHandTurn")).toEqual([...atWorkHandUniforms(HAND).turn]);
    // put down: nothing lies under a hand, and the silhouette is none
    tick();
    layer.show(coverScene(board, null));
    const t0 = c.now;
    while (c.now < t0 + AT_WORK_FOCUS.outMs + 40) tick(20);
    expect(texelOf(last(fake), 0, AT_WORK_ROWS.object.strokes)[3]).toBe(0);
    expect(fake.uniforms.get("uHandBox")).toEqual([...AT_WORK_NO_HAND.box]);
    layer.dispose();
  });

  it("GL: the cover holds through the put-back — the desk's dim eases back, the hand still flies the pane over it", () => {
    const { door, fake } = contextDoor();
    const { seams } = harness(door);
    const layer = createAtWorkLayer(seams);
    mounted(layer);
    // Done pressed: nothing is in hand (no object dimmed), but the hand carries the pane home over the one behind
    layer.show({
      ...sceneOf(both()),
      placed: [
        { key: KEY, frame: FRAME, heldByYou: false, fade: 1, dimmed: false, held: false },
        { key: HELD, frame: HAND, heldByYou: false, fade: 1, dimmed: false, held: true },
      ],
      hand: HAND,
    });
    expect(texelOf(last(fake), 0, AT_WORK_ROWS.object.strokes)[3]).toBe(1);
    expect(texelOf(last(fake), 1, AT_WORK_ROWS.object.strokes)[3]).toBe(0);
    expect(fake.uniforms.get("uHandBox")).toEqual([...atWorkHandUniforms(HAND).box]);
    layer.dispose();
  });

  it("GL: a hand that moves draws again, though no mark moved (the pickup's flight carries the cover)", () => {
    const { door, fake } = contextDoor();
    const { c, seams, tick } = harness(door);
    const layer = createAtWorkLayer(seams);
    mounted(layer);
    const board = both();
    layer.show(coverScene(board, HAND));
    const t0 = c.now;
    while (c.now < t0 + AT_WORK_FOCUS.inMs + 40) tick(20);
    tick();
    const drawn = countOf(fake.calls, "drawArraysInstanced");
    const moved = { ...HAND, cx: HAND.cx + 30 };
    layer.show({ ...coverScene(board, moved), placed: coverScene(board, HAND).placed });
    expect(countOf(fake.calls, "drawArraysInstanced")).toBe(drawn + 1);
    expect(fake.uniforms.get("uHandBox")?.[0]).toBe(moved.cx);
    layer.dispose();
  });

  it("a spark's still and its chip whose centre the hand covers stand at none; where the desk shows they dim, never go", () => {
    const run = "s1";
    const starId = atWorkIds.seat(KEY, run, "star");
    const chipId = atWorkIds.chip(KEY, run);
    const { door } = contextDoor();
    const { c, seams, tick } = harness(door, {
      sparkSeed: () => 7,
      sparkStatus: () => "asking",
    });
    const layer = createAtWorkLayer(seams);
    mounted(layer);
    const still = document.createElement("div");
    const chip = document.createElement("div");
    layer.bind(starId, still);
    layer.bind(chipId, chip);
    const board = boardOf({
      [KEY]: [row(run, "open", 1, { spark: SPARK })],
      [HELD]: [row("r2", "open")],
    });
    layer.show(coverScene(board, HAND));
    const t0 = c.now;
    while (c.now < t0 + AT_WORK_FOCUS.inMs + 40) tick(20);
    expect(still.style.opacity).toBe("0.000");
    expect(chip.style.opacity).toBe("0.000");
    // a small object in hand at the view's corner covers neither: they stand at the dimmed level
    const aside: ScreenFrame = { cx: 60, cy: 60, hx: 40, hy: 30, angle: 0, r: 4 };
    layer.show(coverScene(board, aside));
    tick(20);
    tick(20);
    expect(still.style.opacity).toBe(AT_WORK_FOCUS.dimmed.toFixed(3));
    expect(chip.style.opacity).toBe(AT_WORK_FOCUS.dimmed.toFixed(3));
    layer.dispose();
  });

  it("a spark's live star whose centre the hand covers is placed on its stage at no alpha", async () => {
    const run = "s1";
    const starId = atWorkIds.seat(KEY, run, "star");
    const { kit, made } = stageKit();
    const { door } = contextDoor();
    const { c, seams, tick } = harness(door, {
      stage: kit,
      sparkSeed: () => 7,
      sparkStatus: () => "reviewing",
    });
    const layer = createAtWorkLayer(seams);
    mounted(layer);
    const board = boardOf({
      [KEY]: [row(run, "reading", 1, { spark: SPARK })],
      [HELD]: [row("r2", "open")],
    });
    layer.show(coverScene(board, null));
    await settle();
    tick(100);
    expect(made[0]?.placed.get(starId)?.alpha ?? 0).toBeGreaterThan(0);
    layer.show(coverScene(board, HAND));
    const t0 = c.now;
    while (c.now < t0 + AT_WORK_FOCUS.inMs + 40) tick(20);
    expect(made[0]?.placed.get(starId)?.alpha ?? Number.NaN).toBe(0);
    layer.dispose();
  });

  it("DOM form: a covered object's frame stands at none whole, its seats and chips by their centres; uncovered, at one", () => {
    const marks = stepAtWork(undefined, {
      rows: [row("a1", "needs-you")],
      frame: FRAME,
      zoom: 1,
      now: 0,
      reducedMotion: false,
      heldByYou: false,
      inks: INKS,
      sparkStatus: () => null,
      landed: new Set(["a1"]),
    }).marks;
    const placeOf = (under: boolean, hand: ScreenFrame | null) => {
      const placed = atWorkPlacementsOf(
        [{ key: KEY, frame: FRAME, marks, under }],
        "dom",
        () => 120,
        VIEW.width,
        undefined,
        hand,
      );
      return (id: string) => placed.find((place) => place.id === id)?.opacity;
    };
    const object = atWorkIds.object(KEY);
    const sticker = atWorkIds.seat(KEY, "a1", "sticker");
    const chip = atWorkIds.chip(KEY, "a1");
    const covered = placeOf(true, HAND);
    expect(covered(object)).toBe("0");
    expect(covered(sticker)).toBe("0.000");
    expect(covered(chip)).toBe("0.000");
    const free = placeOf(false, HAND);
    expect(free(object)).toBe("1");
    expect(free(sticker)).toBe("1.000");
    // behind a hand that lies far from it: its frame stays
    const far: ScreenFrame = { cx: 40, cy: 40, hx: 20, hy: 20, angle: 0, r: 0 };
    expect(placeOf(true, far)(object)).toBe("1");
    expect(placeOf(true, far)(sticker)).toBe("1.000");
  });

  it("packs the cover as the object row's strokes texel's w: 1 under the hand, else 0", () => {
    const marks = stepAtWork(undefined, {
      rows: [row("a1", "open")],
      frame: FRAME,
      zoom: 1,
      now: 0,
      reducedMotion: false,
      heldByYou: false,
      inks: INKS,
      sparkStatus: () => null,
      landed: new Set(["a1"]),
    }).marks;
    const cells = {
      mark: () => 2,
      count: () => 3,
      star: () => null,
      crewSeat: () => [0, 0] as const,
      face: () => true,
    };
    const packed = packAtWork(
      [
        { frame: FRAME, marks, under: true },
        { frame: FRAME, marks },
      ],
      cells,
    );
    expect(texelOf(packed.data, 0, AT_WORK_ROWS.object.strokes)[3]).toBe(1);
    expect(texelOf(packed.data, 1, AT_WORK_ROWS.object.strokes)[3]).toBe(0);
  });
});

describe("a crew star drawn before its spark is read gains it on a touch, with no desk step", () => {
  it("draws no star while the seed is unread, and the printed star once the view touches the layer", () => {
    let seed: number | null = null;
    const { door, fake } = contextDoor({ star: PRINTED });
    const layer = createAtWorkLayer(harness(door, { sparkSeed: () => seed }).seams);
    mounted(layer);
    layer.show(sceneOf(boardOf({ [KEY]: [row("c1", "open", 1, { startedBy: SPARK })] })));
    // one object, one stroke: its seat is row 2
    expect(texelOf(last(fake), 2, AT_WORK_ROWS.seat.crew)[0]).toBe(AT_WORK_ROWS.noStar);
    seed = 7;
    layer.touch();
    near(texelOf(last(fake), 2, AT_WORK_ROWS.seat.crew), [PRINTED.cell, 1, 1.5, -2.5]);
    layer.dispose();
  });
});

describe("the tokens are read outside the desk's flush, and again until the root spells them", () => {
  it("reads them at the mount and on a timer, never inside a flush", () => {
    const { door } = contextDoor();
    const { c, seams, tick } = harness(door);
    const layer = createAtWorkLayer(seams);
    mounted(layer);
    const atMount = c.tokenReads;
    expect(atMount).toBeGreaterThan(0);
    const board = boardOf({ [KEY]: [row("r1", "reading")] }, false);
    for (let i = 0; i < 5; i += 1) layer.show(sceneOf(board, { frame: { ...FRAME, cx: 400 + i } }));
    expect(c.tokenReads).toBe(atMount);
    // the scene's theme is read after the flush, on its own timer
    tick();
    expect(c.tokenReads).toBeGreaterThan(atMount);
    layer.dispose();
  });

  it("a root that spells no token yet is the DOM form, read again on a timer until it does; `setTokens` reads at once", () => {
    let spelled = false;
    const { door } = contextDoor();
    const { seams, tick } = harness(door, {
      token: (name) => (spelled ? (TOKENS[name] ?? "") : ""),
    });
    const layer = createAtWorkLayer(seams);
    mounted(layer);
    layer.show(sceneOf(boardOf({ [KEY]: [row("r1", "open")] })));
    expect(layer.shape().form).toBe("dom");
    spelled = true;
    tick(AT_WORK_GL.tokenRetryMs);
    expect(layer.shape().form).toBe("gl");
    // the theme turned: the owner says so, and the tokens are read at once
    spelled = false;
    layer.setTokens();
    expect(layer.shape().form).toBe("dom");
    layer.dispose();
  });
});

// ———————————————————————————————————————————————————————————————— the stage

describe("a spark's live star is drawn on the desk's stage (DESIGN.md §2.10 'the desk is a stage')", () => {
  const STAR_RUN = "s1";
  const starId = atWorkIds.seat(KEY, STAR_RUN, "star");

  it("draws it each frame while its work moves, its still aside; lets the stage go once the ambient is over, and asks no frame after", async () => {
    const { kit, made } = stageKit();
    const { door } = contextDoor();
    const { c, seams, tick } = harness(door, {
      stage: kit,
      sparkSeed: () => 7,
      sparkStatus: () => "reviewing",
    });
    const layer = createAtWorkLayer(seams);
    mounted(layer);
    const still = document.createElement("div");
    layer.bind(starId, still);
    layer.show(sceneOf(boardOf({ [KEY]: [row(STAR_RUN, "reading", 1, { spark: SPARK })] })));
    await settle();
    // the engine is here; the stage is made after the frame that wants it
    expect(made).toHaveLength(0);
    tick(100);
    expect(made).toHaveLength(1);
    expect(layer.record().stageContexts).toBe(1);
    const frames = atWorkStageFrames();
    for (let i = 0; i < 10; i += 1) tick(100);
    expect(atWorkStageFrames() - frames).toBe(10);
    expect(made[0]?.renders).toBeGreaterThanOrEqual(10);
    expect(made[0]?.placed.get(starId)).toMatchObject({ seed: 7, status: "reviewing" });
    expect(still.style.opacity).toBe("0.000");
    // its work stops: open, and nobody touches it — live for the desk's ambient, then a still
    layer.show(sceneOf(boardOf({ [KEY]: [row(STAR_RUN, "open", 2, { spark: SPARK })] })));
    const t0 = c.now;
    while (c.now < t0 + AT_WORK_MOTION.ambientMs - 300) tick(100);
    expect(layer.record().stageContexts).toBe(1);
    while (c.now < t0 + AT_WORK_MOTION.ambientMs + 300) tick(100);
    expect(made[0]?.released).toBe(true);
    expect(layer.record().stageContexts).toBe(0);
    expect(still.style.opacity).toBe("1.000");
    const after = atWorkStageFrames();
    for (let i = 0; i < 10; i += 1) tick(100);
    expect(atWorkStageFrames()).toBe(after);
    expect(c.frames).toHaveLength(0);
    layer.dispose();
  });

  it("its context lost, the star is its still again, and no new stage is made while a star is live", async () => {
    const { kit, made } = stageKit();
    const { door } = contextDoor();
    const { seams, tick } = harness(door, {
      stage: kit,
      sparkSeed: () => 7,
      sparkStatus: () => "reviewing",
    });
    const layer = createAtWorkLayer(seams);
    mounted(layer);
    const still = document.createElement("div");
    layer.bind(starId, still);
    layer.show(sceneOf(boardOf({ [KEY]: [row(STAR_RUN, "reading", 1, { spark: SPARK })] })));
    await settle();
    tick(100);
    expect(still.style.opacity).toBe("0.000");
    made[0]?.canvas.dispatchEvent(new Event("webglcontextlost"));
    expect(made[0]?.released).toBe(true);
    expect(layer.record().stageContexts).toBe(0);
    expect(still.style.opacity).toBe("1.000");
    for (let i = 0; i < 5; i += 1) tick(100);
    await settle();
    expect(made).toHaveLength(1);
    layer.dispose();
  });

  it("a hidden layer lets its stage go", async () => {
    const { kit, made } = stageKit();
    const { door } = contextDoor();
    const { seams, tick } = harness(door, {
      stage: kit,
      sparkSeed: () => 7,
      sparkStatus: () => "reviewing",
    });
    const layer = createAtWorkLayer(seams);
    mounted(layer);
    layer.show(sceneOf(boardOf({ [KEY]: [row(STAR_RUN, "reading", 1, { spark: SPARK })] })));
    await settle();
    tick(100);
    expect(layer.record().stageContexts).toBe(1);
    layer.setHidden("cover");
    expect(made[0]?.released).toBe(true);
    expect(layer.record().stageContexts).toBe(0);
    layer.dispose();
  });

  it("measures no layout in the desk's flush: made after the frame that wants it, sized after a frame whose view moved and on its box's resize", async () => {
    let flushing = false;
    const measured: string[] = [];
    const { kit, made } = stageKit((what) => {
      measured.push(flushing ? `${what} in the flush` : what);
    });
    const observers: ResizeObserverCallback[] = [];
    /** the box's own observer, told by the test */
    class Observer {
      constructor(fn: ResizeObserverCallback) {
        observers.push(fn);
      }
      observe(): void {}
      disconnect(): void {}
    }
    vi.stubGlobal("ResizeObserver", Observer);
    const { door } = contextDoor();
    const { seams, tick } = harness(door, {
      stage: kit,
      sparkSeed: () => 7,
      sparkStatus: () => "reviewing",
    });
    const layer = createAtWorkLayer(seams);
    mounted(layer);
    /** the desk's flush, as the reflector hands it */
    const flush = (scene: AtWorkScene): void => {
      flushing = true;
      try {
        layer.show(scene);
      } finally {
        flushing = false;
      }
    };
    const board = boardOf({ [KEY]: [row(STAR_RUN, "reading", 1, { spark: SPARK })] });
    flush(sceneOf(board));
    await settle();
    tick(100);
    expect(made).toHaveLength(1);
    expect(made[0]?.renders).toBeGreaterThan(0);
    expect(measured).toEqual(["create"]);
    // the view moved in a flush: drawn at the size it has, and sized after
    flush({ ...sceneOf(board), view: { width: 900, height: 700 } });
    tick(100);
    tick(100);
    expect(measured).toEqual(["create", "resize"]);
    // its box's own resize sizes it where the layout is fresh
    const box = { contentRect: { width: 900, height: 700 } } as ResizeObserverEntry;
    observers[0]?.([box], {} as ResizeObserver);
    expect(measured).toEqual(["create", "resize", "resize"]);
    expect(made).toHaveLength(1);
    layer.dispose();
  });
});

// ———————————————————————————————————————————————————————————————— the status

describe("a spark's star wears the status Chat reads (DESIGN.md §2.10, §6 'At rest')", () => {
  const STAR_RUN = "s1";
  const starId = atWorkIds.seat(KEY, STAR_RUN, "star");

  it("wears it on its stage, its props by the switch; a change of it alone, the row unchanged, wakes a resting overlay on a touch and keeps the star live for the ambient", async () => {
    let status: SparkStatus | null = "reviewing";
    const { kit, made } = stageKit();
    const { door } = contextDoor();
    const { c, seams, tick } = harness(door, {
      stage: kit,
      sparkSeed: () => 7,
      sparkStatus: () => status,
    });
    const layer = createAtWorkLayer(seams);
    mounted(layer);
    // open and landed: its work does not move, so its star is its still and the overlay rests
    layer.show(sceneOf(boardOf({ [KEY]: [row(STAR_RUN, "open", 1, { spark: SPARK })] })));
    for (let i = 0; i < 3; i += 1) tick(100);
    await settle();
    expect(made).toHaveLength(0);
    expect(c.frames).toHaveLength(0);
    expect(c.timers.size).toBe(0);
    expect(layer.shape().objects[0]?.seats[0]?.face).toBe("reviewing");
    expect(layer.shape().objects[0]?.chips).toEqual([]);
    // Chat's list publishes a new status; the row is unchanged and nothing else moves: the mount touches the layer
    status = "asking";
    const changed = c.now;
    layer.touch();
    await settle();
    tick(100);
    expect(made).toHaveLength(1);
    expect(made[0]?.placed.get(starId)).toEqual({
      seed: 7,
      status: "asking",
      size: expect.any(Number),
      x: expect.any(Number),
      y: expect.any(Number),
      alpha: expect.any(Number),
      props: AT_WORK_STAR_PROPS,
    });
    expect(layer.shape().objects[0]?.seats[0]?.face).toBe("asking");
    expect(layer.shape().objects[0]?.chips).toEqual([{ run: STAR_RUN, word: "needs-you" }]);
    // live for the desk's ambient after the change, then its still again, and no frame asked
    while (c.now < changed + AT_WORK_MOTION.ambientMs - 300) tick(100);
    expect(layer.record().stageContexts).toBe(1);
    while (c.now < changed + AT_WORK_MOTION.ambientMs + 300) tick(100);
    expect(made[0]?.released).toBe(true);
    expect(layer.record().stageContexts).toBe(0);
    expect(c.frames).toHaveLength(0);
    layer.dispose();
  });

  it("with no entry in Chat's list the star is its still, whatever its work: no stage, no face, no chip", async () => {
    const { kit, made } = stageKit();
    const { door } = contextDoor();
    const { seams, tick } = harness(door, { stage: kit, sparkSeed: () => 7 });
    const layer = createAtWorkLayer(seams);
    mounted(layer);
    const still = document.createElement("div");
    layer.bind(starId, still);
    layer.show(sceneOf(boardOf({ [KEY]: [row(STAR_RUN, "reading", 1, { spark: SPARK })] })));
    await settle();
    for (let i = 0; i < 5; i += 1) tick(100);
    await settle();
    expect(made).toHaveLength(0);
    expect(layer.record().stageContexts).toBe(0);
    expect(still.style.opacity).toBe("1.000");
    expect(layer.shape().objects[0]?.seats[0]?.face).toBeNull();
    expect(layer.shape().objects[0]?.chips).toEqual([]);
    layer.dispose();
  });

  it("a smoke's lent spark is drawn in its lent face; a spark Chat reads keeps its own", async () => {
    let chat: { readonly seed: number; readonly status: SparkStatus } | null = null;
    const { kit, made } = stageKit();
    const { door } = contextDoor();
    const { seams, tick } = harness(door, {
      stage: kit,
      sparkSeed: () => chat?.seed ?? null,
      sparkStatus: () => chat?.status ?? null,
    });
    lendAtWorkSparks(new Map<string, AtWorkLentSpark>([[SPARK, { seed: 9, status: "running" }]]));
    try {
      const layer = createAtWorkLayer(seams);
      mounted(layer);
      layer.show(sceneOf(boardOf({ [KEY]: [row(STAR_RUN, "reading", 1, { spark: SPARK })] })));
      await settle();
      tick(100);
      expect(made[0]?.placed.get(starId)).toMatchObject({ seed: 9, status: "running" });
      chat = { seed: 7, status: "reviewing" };
      layer.touch();
      expect(made[0]?.placed.get(starId)).toMatchObject({ seed: 7, status: "reviewing" });
      layer.dispose();
    } finally {
      lendAtWorkSparks(new Map());
    }
  });

  it("hands the mount a lent spark's seed for its still, and none once the smoke lends none", () => {
    lendAtWorkSparks(new Map<string, AtWorkLentSpark>([[SPARK, { seed: 9, status: "running" }]]));
    try {
      expect(lentAtWorkSeed(SPARK)).toBe(9);
      expect(lentAtWorkSeed("sp-lyra0002")).toBeNull();
    } finally {
      lendAtWorkSparks(new Map());
    }
    expect(lentAtWorkSeed(SPARK)).toBeNull();
  });
});

describe("reduced motion turned at rest is drawn at once (DESIGN.md §6 M6)", () => {
  it("draws on the flip with no flush, and a ring's timer goes with it", () => {
    const { door } = contextDoor();
    const { c, seams, tick } = harness(door);
    const layer = createAtWorkLayer(seams);
    mounted(layer);
    layer.show(sceneOf(boardOf({ [KEY]: [row("r1", "needs-you")] })));
    // the first ring is drawn on frames while it lasts; then the layer sleeps on a timer for the next
    while (c.now < 1_000 + AT_WORK_RING_LIFE_MS + 100) tick(50);
    expect(layer.record().moving).toBe(false);
    expect(layer.record().wakeAt).not.toBeNull();
    const draws = atWorkDraws();
    layer.setReducedMotion(true);
    expect(atWorkDraws()).toBe(draws + 1);
    expect(layer.record().wakeAt).toBeNull();
    expect(c.timers.size).toBe(0);
    layer.dispose();
  });
});

describe("the view's renders are counted on the layer's door", () => {
  it("counts each render its mount says", () => {
    const before = atWorkRenders();
    countAtWorkRender();
    expect(atWorkRenders()).toBe(before + 1);
  });

  it("the layer reads no smoke door of its own: the switches are thrown by the desk door alone", () => {
    const source = readFileSync(
      join(PACKAGE_ROOT, "src/field/desk/at-work/at-work-layer.ts"),
      "utf8",
    );
    expect(source).not.toMatch(/\blocation\b|URLSearchParams/);
  });

  it("only the desk door takes up the smokes' switch and lent sparks, and only the mount reads a lent seed: no other product file names them", () => {
    const layer = "field/desk/at-work/at-work-layer.ts";
    const doors: readonly (readonly [RegExp, ReadonlySet<string>])[] = [
      [
        /\b(?:declineAtWorkGl|atWorkGlDeclined|lendAtWorkSparks)\b/,
        new Set([layer, "field/desk/desk-door.ts"]),
      ],
      [/\blentAtWorkSeed\b/, new Set([layer, "field/desk/at-work/AtWorkOnTheMat.tsx"])],
    ];
    const src = join(PACKAGE_ROOT, "src");
    const files: string[] = [];
    const walk = (dir: string): void => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const path = join(dir, entry.name);
        if (entry.isDirectory()) walk(path);
        else if (/\.tsx?$/.test(entry.name)) files.push(path);
      }
    };
    walk(src);
    for (const [names, allowed] of doors) {
      const naming = files
        .filter((path) => names.test(readFileSync(path, "utf8")))
        .map((path) => relative(src, path).split(sep).join("/"));
      expect(naming, String(names)).toContain(layer);
      expect(
        naming.filter((file) => !allowed.has(file)),
        String(names),
      ).toEqual([]);
    }
  });
});

// ———————————————————————————————————————————————————————————————— the pack

/** The pack's look-ups: a sticker's cell 4, a count's 5, a printed star at 6, worn at (1.5, −2.5); every spark's face
 * dealt. */
const CELLS: AtWorkCells = {
  mark: () => 4,
  count: () => 5,
  star: () => PRINTED,
  crewSeat: () => [1.5, -2.5],
  face: () => true,
};

describe("the pack lays each named texel where the shader reads it (the shader's row table)", () => {
  it("for one object with three strokes and three seats: a spark's star, a crew sticker and a sticker", () => {
    const rows = [
      row("a1", "open"),
      row("c1", "open", 1, { startedBy: "sp-crew0001" }),
      row("s1", "reading", 1, { spark: SPARK }),
    ];
    const frame: ScreenFrame = { cx: 410, cy: 290, hx: 130, hy: 90, angle: 0.2, r: 12 };
    const marks = stepAtWork(undefined, {
      rows,
      frame,
      zoom: 1.5,
      now: 0,
      reducedMotion: false,
      heldByYou: false,
      inks: INKS,
      sparkStatus: () => "reviewing",
      landed: new Set(rows.map((r) => r.run)),
    }).marks;
    expect(marks.strokes).toHaveLength(3);
    expect(marks.seats.map((s) => s.form)).toEqual(["star", "sticker", "sticker"]);
    expect(marks.seats.filter((s) => s.crewSpark !== null)).toHaveLength(1);
    const packed = packAtWork([{ frame, marks }], CELLS);
    const R = AT_WORK_ROWS;
    const at = (r: number, t: number): number[] => texelOf(packed.data, r, t);
    expect(packed.objects).toBe(1);
    expect(packed.firstSeat).toBe(4);
    expect(packed.height).toBe(7);
    expect(packed.instances).toBe(R.pieces + 3);
    near(at(0, R.object.frame), [frame.cx, frame.cy, frame.hx, frame.hy]);
    near(at(0, R.object.turn), [Math.cos(0.2), Math.sin(0.2), frame.r, marks.inkScale]);
    near(at(0, R.object.strokes), [3, 1, marks.clock / 1_000, 0]);
    for (const [k, s] of marks.strokes.entries()) {
      const r = 1 + k;
      near(at(r, R.stroke.motion), [s.drawn, s.gap, s.travel, s.wet]);
      near(at(r, R.stroke.ink), [...s.ink.base.encoded, s.glow]);
      near(at(r, R.stroke.deep), [...s.ink.deep.encoded, s.seam]);
      near(at(r, R.stroke.leanA), [...s.ink.leanA.encoded, s.quiet]);
      near(at(r, R.stroke.leanB), [...s.ink.leanB.encoded, s.close]);
      near(at(r, R.stroke.hand), [s.seed, s.shiver, R.form[s.form], s.opacity]);
      near(at(r, R.stroke.width), [s.hw, 0, 0, 0]);
    }
    for (const [k, s] of marks.seats.entries()) {
      const r = packed.firstSeat + k;
      const cell = s.form === "sticker" ? 4 : s.form === "count" ? 5 : 0;
      near(at(r, R.seat.place), [s.star?.x ?? s.x, s.star?.y ?? s.y, 0, R.seatForm[s.form]]);
      near(at(r, R.seat.ink), [...s.ink.base.encoded, s.seal]);
      near(at(r, R.seat.leanA), [...s.ink.leanA.encoded, s.lift]);
      near(at(r, R.seat.leanB), [...s.ink.leanB.encoded, s.sweep]);
      near(at(r, R.seat.hand), [s.seed, cell, s.star === null ? s.shiver : 0, s.quiet]);
      near(at(r, R.seat.ring), [
        s.ring?.phase ?? 0,
        s.ring?.strength ?? 0,
        s.opacity,
        s.star?.seated ?? 1,
      ]);
      if (s.crewSpark === null) {
        near(at(r, R.seat.crew), [R.noStar, 0, 0, 0]);
      } else {
        near(at(r, R.seat.crew), [PRINTED.cell, s.crew, 1.5, -2.5]);
        near(at(r, R.seat.crewInk), [...PRINTED.tone.c, 0]);
        near(at(r, R.seat.crewLeanA), [...PRINTED.tone.a, 0]);
        near(at(r, R.seat.crewLeanB), [...PRINTED.tone.b, 0]);
      }
    }
    // and the shader reads every one of them by the name it is written under
    const glsl: Readonly<Record<string, number>> = {
      O_FRAME: R.object.frame,
      O_TURN: R.object.turn,
      O_STROKES: R.object.strokes,
      S_MOTION: R.stroke.motion,
      S_INK: R.stroke.ink,
      S_DEEP: R.stroke.deep,
      S_LEAN_A: R.stroke.leanA,
      S_LEAN_B: R.stroke.leanB,
      S_HAND: R.stroke.hand,
      S_WIDTH: R.stroke.width,
      E_PLACE: R.seat.place,
      E_INK: R.seat.ink,
      E_LEAN_A: R.seat.leanA,
      E_LEAN_B: R.seat.leanB,
      E_HAND: R.seat.hand,
      E_RING: R.seat.ring,
      E_CREW: R.seat.crew,
      E_CREW_INK: R.seat.crewInk,
      E_CREW_A: R.seat.crewLeanA,
      E_CREW_B: R.seat.crewLeanB,
    };
    const both = `${AT_WORK_VS}\n${AT_WORK_FS}`;
    for (const [name, texel] of Object.entries(glsl)) {
      expect(both).toContain(`const int ${name} = ${texel};`);
      expect(both).toContain(`, ${name})`);
    }
  });

  it("packs a spark's star seat whose face is not dealt (no seed read) at no opacity, so it throws no shadow under nothing", () => {
    const rows = [row("a1", "open"), row("s1", "reading", 1, { spark: SPARK })];
    const marks = stepAtWork(undefined, {
      rows,
      frame: FRAME,
      zoom: 1,
      now: 0,
      reducedMotion: false,
      heldByYou: false,
      inks: INKS,
      sparkStatus: () => null,
      landed: new Set(rows.map((r) => r.run)),
    }).marks;
    expect(marks.seats.map((s) => s.form)).toEqual(["star", "sticker"]);
    const [star, sticker] = marks.seats;
    expect(star?.opacity).toBeGreaterThan(0);
    // the shadow's level is the third channel of the seat's ring texel (`E_RING`'s `z`, the shader's `op`)
    const opacityOf = (cells: AtWorkCells, k: number): number => {
      const packed = packAtWork([{ frame: FRAME, marks }], cells);
      return texelOf(packed.data, packed.firstSeat + k, AT_WORK_ROWS.seat.ring)[2] ?? Number.NaN;
    };
    const faceless: AtWorkCells = { ...CELLS, face: () => false };
    expect(opacityOf(faceless, 0)).toBe(0);
    // a sticker beside it keeps its own
    expect(opacityOf(faceless, 1)).toBeCloseTo(sticker?.opacity ?? Number.NaN, 4);
    // its face dealt, the star seat packs its own
    expect(opacityOf(CELLS, 0)).toBeCloseTo(star?.opacity ?? Number.NaN, 4);
  });

  it("caps the objects a draw holds, and writes into the layer's one buffer in place", () => {
    const marks = stepAtWork(undefined, {
      rows: [row("r1", "open")],
      frame: FRAME,
      zoom: 1,
      now: 0,
      reducedMotion: false,
      heldByYou: false,
      inks: INKS,
      sparkStatus: () => null,
      landed: new Set(["r1"]),
    }).marks;
    const many = Array.from({ length: AT_WORK_GL.mostObjects + 6 }, () => ({
      frame: FRAME,
      marks,
    }));
    const packed = packAtWork(many, CELLS);
    expect(packed.objects).toBe(AT_WORK_GL.mostObjects);
    expect(packed.instances).toBe(
      AT_WORK_GL.mostObjects * AT_WORK_ROWS.pieces + AT_WORK_GL.mostObjects * marks.seats.length,
    );
    expect(packed.height).toBeLessThanOrEqual(AT_WORK_GL.rows);
    expect(AT_WORK_GL.rows).toBe(
      AT_WORK_GL.mostObjects * (1 + AT_WORK_ROWS.strokes + AT_WORK.seat.most),
    );
    const into = new Float32Array(AT_WORK_ROWS.texels * AT_WORK_GL.rows * 4).fill(9);
    const one = packAtWork([{ frame: FRAME, marks }], CELLS, into);
    expect(one.data).toBe(into);
    // the rows it holds are cleared first (a texel it does not write reads 0); past them it writes nothing
    expect(texelOf(into, 0, 9)).toEqual([0, 0, 0, 0]);
    expect(texelOf(into, one.height, 0)).toEqual([9, 9, 9, 9]);
  });
});

// ———————————————————————————————————————————————————————————————— the mask

/** GLSL's `smoothstep`. */
function smoothstep(a: number, b: number, x: number): number {
  const t = Math.min(Math.max((x - a) / (b - a), 0), 1);
  return t * t * (3 - 2 * t);
}

/** The shader's `sdRoundBox`, ported. */
function sdRoundBox(px: number, py: number, bx: number, by: number, corner: number): number {
  const r = Math.min(corner, Math.min(bx, by));
  const qx = Math.abs(px) - bx + r;
  const qy = Math.abs(py) - by + r;
  return Math.min(Math.max(qx, qy), 0) + Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) - r;
}

/** The shader's `pencilMask`, ported: 1 where the overlay may lie, 0 in the band along the pencil. */
function pencilMask(px: number, py: number, pencil: AtWorkPencil, aaCss: number): number {
  const [bx0, by0, bx, by] = pencil.box;
  if (bx <= 0) return 1;
  const [c, s, corner, travel] = pencil.turn;
  const wx = px - bx0;
  const wy = py - by0;
  const d = sdRoundBox(c * wx + s * wy, -s * wx + c * wy, bx, by, corner);
  const h = 0.5 * AT_WORK_SHADER.pencilBand;
  const outer = travel + h;
  const inBand = smoothstep(-h - aaCss, -h, d) * (1 - smoothstep(outer, outer + aaCss, d));
  return 1 - inBand;
}

describe("the overlay never covers the pencil (DESIGN.md §7)", () => {
  it("the port is the shader's own mask", () => {
    for (const line of [
      "r = min(r, min(b.x, b.y));",
      "vec2 q = abs(p) - b + r;",
      "return min(max(q.x, q.y), 0.0) + length(max(q, 0.0)) - r;",
      "vec2 l = vec2(c.x * w.x + c.y * w.y, -c.y * w.x + c.x * w.y);",
      "float d = sdRoundBox(l, uPencilBox.zw, uPencilTurn.z);",
      "float h = 0.5 * PENCIL_BAND;",
      "float outer = uPencilTurn.w + h;",
      "float inBand = smoothstep(-h - aaCss, -h, d) * (1.0 - smoothstep(outer, outer + aaCss, d));",
    ])
      expect(AT_WORK_FS).toContain(line);
  });

  it("holds no ink on the pencil at any point of its lock-on, where the stroke at its deepest wobble would lie", () => {
    /** the pencil's line, 1.5 px, and the stroke's deepest wobble (DESIGN.md §8 "The stroke": up to 8) */
    const PENCIL_HALF = 0.75;
    const DEEPEST = 8;
    /** at a pixel density of 2 (the shader's `aaCss`) */
    const AA = 0.75;
    const { hw, gap } = AT_WORK.stroke;
    for (const angle of [0, 0.3]) {
      const frame: ScreenFrame = { ...FRAME, angle };
      // mid lock-on the reflector keeps the band the whole arrival wide (`arrive × √2`)
      const pencil = atWorkPencilOf(frame, AT_WORK_PENCIL.arrive * Math.SQRT2);
      const corner = Math.min(frame.r + AT_WORK_PENCIL.gap, AT_WORK_PENCIL.radiusMost);
      const cos = Math.cos(angle);
      const sin = Math.sin(angle);
      let onPencil = 0;
      let inked = 0;
      let underInk = 0;
      for (const e of [0, 0.25, 0.5, 0.75, 1]) {
        // the brackets lock on from `arrive` further out (ICE's `selectionGeometry`: 6 + (1 − e)·8)
        const out = AT_WORK_PENCIL.gap + (1 - e) * AT_WORK_PENCIL.arrive;
        for (let y = -(frame.hy + 20); y <= frame.hy + 20; y += 0.5) {
          for (let x = -(frame.hx + 20); x <= frame.hx + 20; x += 0.5) {
            const line = sdRoundBox(x, y, frame.hx + out, frame.hy + out, corner);
            if (Math.abs(line) > PENCIL_HALF) continue;
            onPencil += 1;
            const px = frame.cx + cos * x - sin * y;
            const py = frame.cy + sin * x + cos * y;
            // sufficient: nothing of the overlay lies on the pencil
            if (pencilMask(px, py, pencil, AA) !== 0) inked += 1;
            // needed: unmasked, the stroke at its deepest wobble in would lie there (zoom 1: an ink px a screen px)
            const ink = sdRoundBox(x, y, frame.hx + gap, frame.hy + gap, frame.r + gap) + DEEPEST;
            if (Math.abs(ink) <= hw) underInk += 1;
          }
        }
      }
      expect(onPencil).toBeGreaterThan(1_000);
      expect(inked).toBe(0);
      expect(underInk).toBeGreaterThan(0);
    }
  });
});
