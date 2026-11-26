// @vitest-environment happy-dom
/**
 * Item 550 (2026-11-18) — THE KIT'S DRIVEN SPARK STAGE AND ITS TYPED BAKE (DESIGN.md §2.10, "the desk is a stage" and
 * "printed"). Two doors in the kit's `./spark-face` for a caller that keeps its own frame — the desk's at-work overlay:
 *   THE STAGE draws only when its caller says (one `engine.render` a call, zero with no call), asks for no animation
 *     frame, observes nothing and reads no style; it places a FREE face through the kit's own `placeSparkBuddy` and
 *     `sparkBuddyOptions` (R = size / 2 / 1.26, centred where it is told, its eyes at the kit's scale), moves a known
 *     face and feels a new status once; a face keeps the alpha it was placed at through every render, though the
 *     engine's own update sets a buddy's afresh (a premise pinned in the real engine, not only the stand-in); its
 *     props are on or off as the caller's switch says; a status changed while the caller renders frozen is settled
 *     into before that render; it is no stage where the canvas gives no WebGL2; its release clears the engine, lets
 *     the context go, and is told from a loss by `released()`.
 *   THE STILL, the kit's own `drawStill`, names its props as a face does, keyed apart; one that names none keeps its
 *     key.
 *   THE BAKE draws each seed flat (style 0) with its eyes and without, calm and still, looking where it is told, in ONE
 *     transient context let go before it returns, and hands back each cell's texels and the seed's palette — typed, so
 *     the overlay never casts the vendored engine. It refuses a canvas the engine sized otherwise.
 * Neither is a plugin's door: the SDK's `ui.ts` re-exports none of it, and the kit's entry adds the one export. Over a
 * stand-in engine whose renders are counted; `spark-face-goldens.test.ts` runs unchanged beside it. Red first: the
 * kit's commit makes these names exist.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  bakeFlatStars,
  createDrivenStage,
  type DrivenFace,
  drawStill,
  type FlatStarBakeOptions,
  loadSparklings,
  SPARK_FRAME,
  type Sparklings,
  type SparkPalette,
  sparkFaceScale,
} from "@vibefield/design-kit/spark-face";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const PACKAGE_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const KIT = join(PACKAGE_ROOT, "../design-kit/src/spark-face");

/** A stand-in for the vendored Buddy: what it was made with, and what was set on it. Its `update`, which the engine
 * runs on it each render that is not frozen, sets its alpha to 1, as the vendored Buddy's does before it draws. */
class FakeBuddy {
  static made: FakeBuddy[] = [];
  x = 0;
  y = 0;
  R = 40;
  faceScale = 1;
  rest: string;
  cut: unknown;
  clip: unknown = null;
  hidden = false;
  alpha = 1;
  look: [number, number] = [0, 0];
  readonly felt: string[] = [];
  readonly updated: number[] = [];
  settled = 0;
  /** as the vendored Buddy's: its own `props`, else on for a free face and off on a frame */
  propsOn: boolean;
  constructor(readonly options: Readonly<Record<string, unknown>>) {
    this.rest = String(options.rest);
    this.cut = options.cut ?? null;
    this.propsOn = typeof options.props === "boolean" ? options.props : options.frame === 0;
    FakeBuddy.made.push(this);
  }
  feel(status: string): FakeBuddy {
    this.felt.push(status);
    return this;
  }
  settle(): FakeBuddy {
    this.settled += 1;
    this.look = [0, 0];
    return this;
  }
  update(seconds: number): void {
    this.updated.push(seconds);
    this.alpha = 1;
  }
}

/** A stand-in for the vendored Engine: its renders counted, and the canvas sized as the test says. */
class FakeEngine {
  static made: FakeEngine[] = [];
  static refuse = false;
  static sized: { readonly width: number; readonly height: number } | null = null;
  readonly buddies: FakeBuddy[] = [];
  readonly renders: { readonly seconds: number; readonly frozen: boolean }[] = [];
  /** the engine's own ground for a badge's ring (a marker value, no colour of the product's) */
  readonly cut = [0.25, 0.5, 0.75] as const;
  resized = 0;
  cleared = 0;
  constructor(
    readonly canvas: HTMLCanvasElement,
    readonly options: { readonly max?: number; readonly preserve?: boolean } = {},
  ) {
    if (FakeEngine.refuse) throw new Error("WebGL2 is not available");
    if (FakeEngine.sized !== null) {
      canvas.width = FakeEngine.sized.width;
      canvas.height = FakeEngine.sized.height;
    }
    FakeEngine.made.push(this);
  }
  add(buddy: FakeBuddy): FakeBuddy {
    this.buddies.push(buddy);
    return buddy;
  }
  remove(buddy: FakeBuddy): void {
    const at = this.buddies.indexOf(buddy);
    if (at >= 0) this.buddies.splice(at, 1);
  }
  clear(): void {
    this.buddies.length = 0;
    this.cleared += 1;
  }
  resize(): void {
    this.resized += 1;
  }
  /** as the vendored engine's: each buddy's update runs first unless frozen, then it draws */
  render(seconds: number, options: { readonly frozen?: boolean } = {}): void {
    if (options.frozen !== true) for (const one of this.buddies) one.update(seconds);
    this.renders.push({ seconds, frozen: options.frozen === true });
  }
}

/** A palette as the engine carries it: data, never read as colour here. */
const PALETTE: SparkPalette = {
  name: "stand-in",
  c: ["c0", "c1", "c2", "c3", "c4"],
  deep: ["d0", "d1"],
};
/** The seed the stand-in deals no palette. */
const NO_PALETTE = 13;

const ENGINES = {
  Engine: FakeEngine,
  Buddy: FakeBuddy,
  PALETTES: [PALETTE],
  STATUSES: [],
  MOTION: {},
  agentDNA: (seed: number) => ({
    seed,
    palette: seed === NO_PALETTE ? 7 : 0,
    body: { n: 5 },
    eyes: { gap: 0.4 },
  }),
  makeBody: () => ({ n: 5, core: 0.4, k: 0.2, tip: 0.1, pts: [] }),
  makeEyes: () => ({ gap: 0.4, y: 0.1, w: 0.1, h: 0.2 }),
} as unknown as Sparklings;

const engine = (index = 0): FakeEngine => {
  const made = FakeEngine.made[index];
  if (made === undefined) throw new Error(`no engine ${index}`);
  return made;
};
const buddy = (index = 0, of = engine()): FakeBuddy => {
  const one = of.buddies[index];
  if (one === undefined) throw new Error(`no buddy ${index}`);
  return one;
};

/** A canvas whose WebGL2 context can be let go, counted. */
function glCanvas(): { readonly canvas: HTMLCanvasElement; readonly lost: () => number } {
  const canvas = document.createElement("canvas");
  let lost = 0;
  const loseContext = (): void => {
    lost += 1;
  };
  const gl = {
    getExtension: (name: string) => (name === "WEBGL_lose_context" ? { loseContext } : null),
  };
  Object.defineProperty(canvas, "getContext", {
    value: (kind: string) => (kind === "webgl2" ? gl : null),
  });
  return { canvas, lost: () => lost };
}

/** A face as the overlay places one, its props on (the default of the caller's switch). */
const FACE: DrivenFace = {
  seed: 7,
  status: "reviewing",
  size: 34,
  x: 100,
  y: 60,
  alpha: 0.5,
  props: true,
};

beforeEach(() => {
  FakeEngine.made = [];
  FakeBuddy.made = [];
  FakeEngine.refuse = false;
  FakeEngine.sized = null;
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('the driven stage (DESIGN.md §2.10, "the desk is a stage")', () => {
  it("draws only when its caller says: zero renders with no call, then one engine render a call", () => {
    const { canvas } = glCanvas();
    const stage = createDrivenStage(canvas, ENGINES);
    if (stage === null) throw new Error("no stage");
    stage.place("a", FACE);
    expect(engine().renders).toEqual([]);
    expect(stage.frames()).toBe(0);
    stage.render(1.5);
    expect(engine().renders).toEqual([{ seconds: 1.5, frozen: false }]);
    // reduced motion: the caller says frozen, and the faces hold still
    stage.render(2, true);
    expect(engine().renders).toEqual([
      { seconds: 1.5, frozen: false },
      { seconds: 2, frozen: true },
    ]);
    expect(stage.frames()).toBe(2);
  });

  it("asks for no animation frame, observes no element and reads no style", () => {
    const raf = vi.spyOn(window, "requestAnimationFrame");
    const style = vi.spyOn(window, "getComputedStyle");
    const sized = vi.fn();
    const seen = vi.fn();
    vi.stubGlobal("ResizeObserver", sized);
    vi.stubGlobal("IntersectionObserver", seen);
    const { canvas } = glCanvas();
    const stage = createDrivenStage(canvas, ENGINES);
    stage?.place("a", FACE);
    stage?.place("a", { ...FACE, x: 140, status: "asking" });
    stage?.render(1);
    stage?.resize();
    stage?.drop("a");
    stage?.release();
    expect(raf).not.toHaveBeenCalled();
    expect(style).not.toHaveBeenCalled();
    expect(sized).not.toHaveBeenCalled();
    expect(seen).not.toHaveBeenCalled();
    // nor does its source name them
    const source = readFileSync(join(KIT, "driven.ts"), "utf8");
    for (const name of [
      "requestAnimationFrame",
      "IntersectionObserver",
      "ResizeObserver",
      "getComputedStyle",
    ])
      expect(source, name).not.toContain(name);
  });

  it("places a FREE face through the kit's own door: R = size / 2 / 1.26, centred where it is told, its eyes at the kit's scale", () => {
    const { canvas } = glCanvas();
    const stage = createDrivenStage(canvas, ENGINES);
    stage?.place("a", FACE);
    const face = buddy();
    expect(SPARK_FRAME.frameH).toBe(1.26);
    expect(face.R).toBeCloseTo(34 / 2 / 1.26, 12);
    expect([face.x, face.y]).toEqual([100, 60]);
    expect(face.faceScale).toBe(sparkFaceScale(34));
    expect(face.alpha).toBe(0.5);
    // the kit's own options for a face: its DNA, the glow, mouthless, free, at rest in its status
    expect(face.options).toMatchObject({
      seed: 7,
      palette: 0,
      style: 2,
      mouth: false,
      frame: 0,
      emotion: "reviewing",
      rest: "reviewing",
      props: true,
    });
  });

  it("wears its props as the caller's switch says, made and moved; a free face names no ground of the caller's", () => {
    const { canvas } = glCanvas();
    const stage = createDrivenStage(canvas, ENGINES);
    stage?.place("a", { ...FACE, props: false });
    expect(buddy().options.props).toBe(false);
    expect(buddy().propsOn).toBe(false);
    // the switch turned: the next placing says so
    stage?.place("a", FACE);
    expect(buddy().propsOn).toBe(true);
    // free: the engine cuts a badge's ring only on a frame, so the ground in its options is never read
    expect(buddy().options.frame).toBe(0);
    // and a face cannot be placed without saying whether it wears its props
    // @ts-expect-error `props` is required: the caller's switch decides, never the engine's default
    const unnamed: DrivenFace = { seed: 7, status: "reviewing", size: 34, x: 100, y: 60, alpha: 1 };
    expect("props" in unnamed).toBe(false);
  });

  it("settles a status changed while the caller renders frozen into its pose before that render, and only then", () => {
    const { canvas } = glCanvas();
    const stage = createDrivenStage(canvas, ENGINES);
    if (stage === null) throw new Error("no stage");
    stage.place("a", FACE);
    stage.render(1, true);
    // made settled by the engine itself: no change to settle yet
    expect(buddy().settled).toBe(0);
    stage.place("a", { ...FACE, status: "asking" });
    stage.render(2, true);
    expect(buddy().felt).toEqual(["asking"]);
    expect(buddy().settled).toBe(1);
    // nothing new: the next frozen render settles nothing
    stage.render(3, true);
    expect(buddy().settled).toBe(1);
    // a render that runs the update leaves the springs to carry the change
    stage.place("a", { ...FACE, status: "failed" });
    stage.render(4);
    expect(buddy().settled).toBe(1);
    // and a change an update carried is not settled by a frozen render after it
    stage.render(5, true);
    expect(buddy().settled).toBe(1);
  });

  it("keeps the alpha it was placed at through every render, though the engine's update sets a buddy's afresh", () => {
    const { canvas } = glCanvas();
    const stage = createDrivenStage(canvas, ENGINES);
    if (stage === null) throw new Error("no stage");
    stage.place("a", { ...FACE, alpha: 0.35 });
    stage.render(1);
    // the stand-in's update set it to 1 first, as the vendored engine's does
    expect(buddy().updated).toEqual([1]);
    expect(buddy().alpha).toBe(0.35);
    stage.render(1.016);
    expect(buddy().alpha).toBe(0.35);
    // moved to a new alpha: it holds through the next render
    stage.place("a", { ...FACE, alpha: 0.8 });
    stage.render(1.032);
    expect(buddy().alpha).toBe(0.8);
    // a frozen render runs no update, and draws the alpha placed
    stage.place("a", { ...FACE, alpha: 0.35 });
    stage.render(2, true);
    expect(buddy().updated).toEqual([1, 1.016, 1.032]);
    expect(buddy().alpha).toBe(0.35);
  });

  it("rests on the real engine: the vendored Buddy's own update sets its alpha to 1 before it draws", async () => {
    // the premise the kept alpha answers, pinned in the engine itself, so a vendored bump that moves it goes red
    const real = await loadSparklings();
    const dna = real.agentDNA(7);
    const one = new real.Buddy({
      seed: dna.seed,
      palette: dna.palette,
      body: dna.body,
      eyes: dna.eyes,
      style: 2,
      watch: false,
      mouth: false,
      emotion: "ready",
      rest: "ready",
      frame: 0,
      frameC: SPARK_FRAME.frameC,
      frameH: SPARK_FRAME.frameH,
      cut: [0, 0, 0],
    }) as unknown as { alpha: number; update(seconds: number, step: number): void };
    one.alpha = 0.35;
    one.update(1, 1 / 60);
    expect(one.alpha).toBe(1);
    // and `update` is the Buddy's method, on its prototype, never an instance's own field: the stage's subclass
    // overrides it only so, and a field would shadow the override while the row above stayed green
    const step = Object.getOwnPropertyDescriptor(real.Buddy.prototype, "update");
    expect(typeof step?.value).toBe("function");
    expect(Object.hasOwn(one, "update")).toBe(false);
  });

  it("moves a known face where it is told, and feels a new status once", () => {
    const { canvas } = glCanvas();
    const stage = createDrivenStage(canvas, ENGINES);
    stage?.place("a", FACE);
    stage?.place("a", { ...FACE, x: 120, y: 64, size: 48, alpha: 1 });
    expect(engine().buddies).toHaveLength(1);
    expect([buddy().x, buddy().y, buddy().alpha]).toEqual([120, 64, 1]);
    expect(buddy().R).toBeCloseTo(48 / 2 / 1.26, 12);
    expect(buddy().felt).toEqual([]);
    stage?.place("a", { ...FACE, status: "asking" });
    stage?.place("a", { ...FACE, status: "asking" });
    expect(buddy().felt).toEqual(["asking"]);
    expect(buddy().rest).toBe("asking");
  });

  it("drops a face from the engine", () => {
    const { canvas } = glCanvas();
    const stage = createDrivenStage(canvas, ENGINES);
    stage?.place("a", FACE);
    stage?.place("b", FACE);
    stage?.drop("a");
    expect(engine().buddies).toHaveLength(1);
    stage?.drop("nobody");
    expect(engine().buddies).toHaveLength(1);
  });

  it("measures the canvas again on the caller's word, never by itself", () => {
    const { canvas } = glCanvas();
    const stage = createDrivenStage(canvas, ENGINES);
    stage?.place("a", FACE);
    stage?.render(1);
    expect(engine().resized).toBe(0);
    stage?.resize();
    expect(engine().resized).toBe(1);
  });

  it("lets its context go on release, and draws nothing after", () => {
    const { canvas, lost } = glCanvas();
    const stage = createDrivenStage(canvas, ENGINES);
    if (stage === null) throw new Error("no stage");
    stage.place("a", FACE);
    stage.render(1);
    // a context the browser loses is not this: the caller tells the two apart by `released()`
    expect(stage.released()).toBe(false);
    stage.release();
    expect(stage.released()).toBe(true);
    expect(lost()).toBe(1);
    expect(engine().cleared).toBe(1);
    stage.render(2);
    stage.place("b", FACE);
    stage.resize();
    stage.release();
    expect(engine().renders).toHaveLength(1);
    expect(stage.frames()).toBe(1);
    expect(engine().buddies).toHaveLength(0);
    expect(engine().resized).toBe(0);
    expect(lost()).toBe(1);
  });

  it("is no stage where the canvas gives no WebGL2: the face is then the flat star", () => {
    FakeEngine.refuse = true;
    const { canvas, lost } = glCanvas();
    expect(createDrivenStage(canvas, ENGINES)).toBeNull();
    expect(lost()).toBe(0);
  });
});

describe("the kit's still, beside the stage (DESIGN.md §2.10)", () => {
  it("names its props as a face does, keyed apart; a still that names none keeps the key and the picture it had", () => {
    vi.spyOn(HTMLCanvasElement.prototype, "toDataURL").mockReturnValue(
      "data:image/png;base64,AA==",
    );
    const still = { seed: 7, status: "asking", size: 34, framed: false, cut: [0, 0, 0] } as const;
    expect(drawStill(ENGINES, { ...still, props: false })).toBe("data:image/png;base64,AA==");
    drawStill(ENGINES, { ...still, props: true });
    drawStill(ENGINES, still);
    // three keys, three drawings: off, on, and the one it always had
    expect(FakeBuddy.made.map((one) => one.options.props)).toEqual([false, true, undefined]);
    expect(FakeBuddy.made.map((one) => one.propsOn)).toEqual([false, true, true]);
    // kept: the same still again draws nothing new
    drawStill(ENGINES, { ...still, props: false });
    drawStill(ENGINES, still);
    expect(FakeBuddy.made).toHaveLength(3);
  });
});

describe('the flat star\'s bake (DESIGN.md §2.10, "printed")', () => {
  const CELL = 4;
  /** Two seeds: four cells in one row, 16 × 4 texels; each texel's red says which cell it is. */
  const WIDTH = 4 * CELL;
  const pixels = new Uint8ClampedArray(WIDTH * CELL * 4);
  for (let y = 0; y < CELL; y += 1)
    for (let x = 0; x < WIDTH; x += 1) {
      const at = (y * WIDTH + x) * 4;
      pixels[at] = Math.floor(x / CELL);
      pixels[at + 1] = y;
      pixels[at + 3] = 255;
    }

  function bakeWith(over: Partial<FlatStarBakeOptions> = {}) {
    const gl = glCanvas();
    let released = 0;
    const drawn: unknown[][] = [];
    const surface = {
      getContext: (kind: string) =>
        kind === "2d"
          ? {
              drawImage: (...args: unknown[]) => drawn.push(args),
              getImageData: () => ({ data: pixels }),
            }
          : null,
    } as unknown as HTMLCanvasElement;
    const options: FlatStarBakeOptions = {
      cell: CELL,
      radius: 1.5,
      faceScale: 1.25,
      look: [-0.55, -0.4],
      ratio: 1,
      stage: () => ({
        canvas: gl.canvas,
        release: () => {
          released += 1;
        },
      }),
      surface: () => surface,
      ...over,
    };
    return { options, lost: gl.lost, released: () => released, drawn, canvas: gl.canvas };
  }

  it("draws each seed flat with its eyes and without, calm and still, looking where it is told — in one context let go before it returns", () => {
    FakeEngine.sized = { width: WIDTH, height: CELL };
    const bake = bakeWith();
    const baked = bakeFlatStars(ENGINES, [1, 2], bake.options);
    // one engine, two cells a seed, its canvas preserved for the read-back, drawn once and frozen
    expect(FakeEngine.made).toHaveLength(1);
    expect(engine().options).toEqual({ max: 4, preserve: true });
    expect(engine().renders).toEqual([{ seconds: 0, frozen: true }]);
    expect(bake.drawn).toHaveLength(1);
    // the engine cleared and its context let go before the bake returned, the stage taken away
    expect(engine().buddies).toHaveLength(0);
    expect(engine().cleared).toBe(1);
    expect(bake.lost()).toBe(1);
    expect(bake.released()).toBe(1);
    // each seed: its two cells' texels, its palette
    expect(baked).toHaveLength(2);
    const [first, second] = baked;
    expect(first?.size).toBe(CELL);
    expect(first?.palette).toBe(PALETTE);
    expect(first?.face).toHaveLength(CELL * CELL * 4);
    expect(first?.face[0]).toBe(0);
    expect(first?.bare[0]).toBe(1);
    expect(second?.face[0]).toBe(2);
    expect(second?.bare[0]).toBe(3);
    // row by row: the last row of cell 3 is its own
    expect(second?.bare[(CELL - 1) * CELL * 4 + 1]).toBe(CELL - 1);
  });

  it("poses every star as told: flat, calm, eyes on or off, the gaze set after its settle, its radius and its cell", () => {
    FakeEngine.sized = { width: WIDTH, height: CELL };
    const bake = bakeWith();
    const added: FakeBuddy[] = [];
    const add = FakeEngine.prototype.add;
    vi.spyOn(FakeEngine.prototype, "add").mockImplementation(function (this: FakeEngine, b) {
      added.push(b);
      return add.call(this, b);
    });
    bakeFlatStars(ENGINES, [1, 2], bake.options);
    expect(added.map((b) => b.options.face)).toEqual([true, false, true, false]);
    for (const [k, b] of added.entries()) {
      expect(b.options).toMatchObject({
        style: 0,
        emotion: "calm",
        rest: "calm",
        frame: 0,
        cut: null,
        props: false,
        signals: false,
        motionScale: 0,
        faceScale: 1.25,
        watch: false,
        mouth: false,
      });
      expect(b.settled).toBe(1);
      expect(b.look).toEqual([-0.55, -0.4]);
      expect(b.R).toBe(1.5);
      expect([b.x, b.y]).toEqual([k * CELL + CELL / 2, CELL / 2]);
      expect(b.clip).toEqual([k * CELL, 0, (k + 1) * CELL, CELL]);
    }
  });

  it("refuses a canvas the engine sized otherwise — no cell read off its texels — and still lets its context go", () => {
    FakeEngine.sized = { width: WIDTH - 1, height: CELL };
    const bake = bakeWith();
    expect(bakeFlatStars(ENGINES, [1, 2], bake.options)).toEqual([null, null]);
    expect(bake.drawn).toHaveLength(0);
    expect(bake.lost()).toBe(1);
    expect(bake.released()).toBe(1);
  });

  it("is null for a seed the engine dealt no palette, and nothing at all with no stage, no surface or no engine", () => {
    FakeEngine.sized = { width: WIDTH, height: CELL };
    const bake = bakeWith();
    const baked = bakeFlatStars(ENGINES, [1, NO_PALETTE], bake.options);
    expect(baked[0]).not.toBeNull();
    expect(baked[1]).toBeNull();
    // no stage: no engine is made
    FakeEngine.made = [];
    expect(bakeFlatStars(ENGINES, [1], bakeWith({ stage: () => null }).options)).toEqual([null]);
    expect(FakeEngine.made).toHaveLength(0);
    // no surface: the context is let go all the same
    FakeEngine.sized = { width: 2 * CELL, height: CELL };
    const bare = bakeWith({ surface: () => null });
    expect(bakeFlatStars(ENGINES, [1], bare.options)).toEqual([null]);
    expect(bare.lost()).toBe(1);
    // no WebGL2: no context to let go, the stage taken away
    FakeEngine.refuse = true;
    const refused = bakeWith();
    expect(bakeFlatStars(ENGINES, [1], refused.options)).toEqual([null]);
    expect(refused.lost()).toBe(0);
    expect(refused.released()).toBe(1);
    expect(bakeFlatStars(ENGINES, [], refused.options)).toEqual([]);
  });
});

describe("the doors' place in the kit", () => {
  it("is no plugin's door: the SDK's ui.ts re-exports none of it; the kit's entry adds the doors and the still", () => {
    const ui = readFileSync(join(PACKAGE_ROOT, "../plugin-sdk/src/ui.ts"), "utf8");
    expect(ui).not.toMatch(/spark-face|Driven|bakeFlatStars|drawStill|StillFace/);
    const entry = readFileSync(join(KIT, "index.ts"), "utf8");
    expect(entry.match(/from "\.\/driven"/g) ?? []).toHaveLength(1);
    // and the still, so its props are held by a row: the one line, its two names beside TH-3's two (FREE_FACE_ROOM and
    // stillKey, 2026-11-19, on main after this row was written)
    expect(entry).toContain(
      'export { drawStill, FREE_FACE_ROOM, type StillFace, stillKey } from "./stills";',
    );
    // nothing else in the kit leans on the doors: the stage, the hatch and the night stay as they are, and the face and
    // its still gain only their optional `props`
    const kept = ["stage.tsx", "SparkFace.tsx", "hatch.tsx", "night.tsx", "stills.ts", "engine.ts"];
    for (const file of kept) {
      expect(readFileSync(join(KIT, file), "utf8"), file).not.toContain("./driven");
    }
  });
});
