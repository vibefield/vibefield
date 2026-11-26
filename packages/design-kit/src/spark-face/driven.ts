import {
  placeSparkBuddy,
  SPARK_FRAME,
  type SparkBuddy,
  type SparkBuddyOptions,
  type SparkEngine,
  type Sparklings,
  type SparkPalette,
  type SparkRgb,
  sparkBuddyOptions,
} from "./engine";
import type { SparkStatus } from "./statuses";

// A DRIVEN STAGE, and the flat star's bake (item 550, 2026-11-18; DESIGN.md §2.10, "the desk is a stage" and
// "printed"). Two doors beside the kit's own, for a caller that keeps its own frame: the desk's at-work overlay, which
// draws a spark's live star in the same frame as the ink it rides, and bakes the star a crew run's sticker wears.
//
// THE STAGE. `createDrivenStage(canvas, engines)` → `DrivenStage | null` (null: no WebGL2 on that canvas). The caller
// places each face (`place(id, face)`: a new id joins as a FREE face through the kit's `sparkBuddyOptions`; a known one
// moves, and feels a new status by the engine's own springs), sizes the canvas and says so (`resize()`), and draws
// (`render(seconds, frozen)`: ONE `engine.render`, nothing more). The stage keeps no loop and watches nothing: it asks
// for no animation frame, observes no element and reads no style — the caller's frame is its only clock, and under
// reduced motion the caller passes `frozen`. `frames()` counts the renders since it was made; `release()` clears the
// engine and lets its WebGL2 context go at once. Placement is the kit's `placeSparkBuddy`: R = size / 2 / 1.26, centred
// on (x, y), the eyes at `sparkFaceScale(size)`. A face keeps the opacity it was placed at (`alpha`) through every
// render: the engine's own update, run by each render that is not frozen, sets a buddy's alpha afresh before it draws,
// so the stage lays the caller's over it after each update. Its props (the question mark, the lock, the dizzy stars,
// the hourglass, the ✕, in the engine's own colours) are on or off as the caller's switch says (`props`, DESIGN.md
// §2.10); a free face draws no badge and no ring, which the engine draws only on a frame, so it needs no ground to cut
// them on. A status that changes while the caller renders frozen is settled into before that render (the engine's
// springs run only in its update, which a frozen render skips), so the still wears its new status.
//
// THE CONTEXT. The stage watches nothing, its context included: the caller hears `webglcontextlost` and
// `webglcontextrestored` on the canvas it handed, and tells a loss from its own `release()`, which loses the context on
// purpose, by `released()`. After a loss the caller drops the stage (its faces are then the still or the flat star,
// never a blank) and makes a new one when the context is restored.
//
// THE BAKE. `bakeFlatStars(engines, seeds, options)` → `readonly (FlatStarBake | null)[]`, one entry per seed in order:
//
//   interface FlatStarBake {
//     readonly size: number;              // a cell's side, texels; each map below is size × size, 4 bytes a texel
//     readonly face: Uint8ClampedArray;   // the star drawn flat (style 0) with its eyes, RGBA as the engine drew it
//                                         //   (premultiplied), row 0 at the top
//     readonly bare: Uint8ClampedArray;   // the same star with no eyes: its alpha is the outline, and where the two
//                                         //   maps differ are the eyes
//     readonly palette: SparkPalette;     // its palette, the engine's data: c[0] its flat body, c[2] and c[4] its
//                                         //   foil's leans
//   }
//
// null for a seed the engine dealt no palette; every entry null where the stage, the engine or the read-back is
// refused, or where the engine sized its canvas other than the bake laid it (a ratio that rounds), so no cell is read
// off its texels. It is synchronous: the caller loads the engine (`loadSparklings`) and lays the canvas out out of
// sight (`options.stage`, since the engine measures the element's box); the bake makes ONE transient context and lets
// it go before it returns. The star sits calm and still (no props, no signals, no motion), its eyes at
// `options.faceScale`, looking at `options.look`.
//
// THE STILL. At rest the caller lets the stage go, and each star is its still: the kit's own `SparkFace`, free, which
// draws through the window's one still canvas, so no context is held for it. A still wears its props or not as the
// stage's face does: `SparkFace` and the still it draws (`drawStill`, `StillFace`, exported beside these doors) take
// one optional `props`; absent, the face, its key and its picture are as they always were.
//
// Neither door is re-exported to plugins (the SDK's `ui.ts`), and nothing else in the kit changes for them: the stage,
// the hatch, the night and the vendored engine stay as they are, and the face and its still gain only that one option.
//
// THE ENGINE'S UNTYPED MEMBERS. `engine.ts` types what a face uses; these doors also set a buddy's alpha, lay theirs
// over its update, set its gaze and its calm pose, and pass the options the vendored engine takes beyond a face's
// (sparks.js `Buddy`). They are typed once here, inside the kit, so no caller casts the vendored engine.

/** One face on a driven stage: its seed and status, its size (CSS px, the kit's measure) and its centre on the canvas,
 * its opacity (0–1, kept through every render), and whether it wears its props (the caller's switch, DESIGN.md
 * §2.10). */
export interface DrivenFace {
  readonly seed: number;
  readonly status: SparkStatus;
  readonly size: number;
  readonly x: number;
  readonly y: number;
  readonly alpha: number;
  readonly props: boolean;
}

/** A stage the caller drives: it places the faces and calls `render` from its own frame. */
export interface DrivenStage {
  /** A new id joins (a free face, `sparkBuddyOptions`); a known one moves to `face`, and feels a new status. */
  place(id: string, face: DrivenFace): void;
  /** The face leaves the stage. */
  drop(id: string): void;
  /** ONE `engine.render` at `seconds` (`frozen`: the faces hold still); it never schedules a frame. */
  render(seconds: number, frozen?: boolean): void;
  /** The caller sized the canvas: the engine measures it again (`engine.resize`). */
  resize(): void;
  /** The renders since it was made. */
  frames(): number;
  /** The faces cleared and the WebGL2 context let go; every call after is nothing. */
  release(): void;
  /** True once `release()` ran: the caller's own release, never a lost context. */
  released(): boolean;
}

/** A canvas the bake lays out out of sight, for the engine to measure, and how to take it away. */
export interface FlatStarBakeStage {
  readonly canvas: HTMLCanvasElement;
  release(): void;
}

/** How a bake draws: its cell and the star in it, the pose, and the surfaces it draws on. */
export interface FlatStarBakeOptions {
  /** a cell's side, texels (device px) */
  readonly cell: number;
  /** the star's radius in its cell, texels */
  readonly radius: number;
  /** the eyes' scale (the kit's `sparkFaceScale` draws small faces' eyes 1.25×) */
  readonly faceScale: number;
  /** where the eyes look, the engine's gaze in the star's radii (x right, y down) */
  readonly look: readonly [number, number];
  /** device px a CSS px, as the engine will size its canvas (the window's ratio under the engine's cap of 2) */
  readonly ratio: number;
  /** a canvas laid out out of sight, `width` × `height` CSS px, or null where there is no document */
  readonly stage: (width: number, height: number) => FlatStarBakeStage | null;
  /** a 2D surface `width` × `height` px to read the engine's pixels back through, or null where there is none */
  readonly surface: (width: number, height: number) => HTMLCanvasElement | null;
}

/** One seed's flat star, as the bake reads it back (above). */
export interface FlatStarBake {
  readonly size: number;
  readonly face: Uint8ClampedArray;
  readonly bare: Uint8ClampedArray;
  readonly palette: SparkPalette;
}

/** The most faces one driven stage moves (as a stage's). */
const DRIVEN_MOST = 64;

/** The bake lays its cells this many a row. */
const BAKE_COLS = 8;

/** The engine's Flat style, the star in one flat colour (DESIGN.md §2.10 "printed"). */
const FLAT = 0;

/** The rest a baked star wears: calm, its eyes open. */
const CALM = "calm";

/** The ground a free face's options carry, never read: the engine cuts a badge's ring only on a frame (sparks.js, the
 * frame's branch), and a free face has none. */
const NO_GROUND: SparkRgb = [0, 0, 0];

/** A buddy's options as the vendored engine takes them: a face's, a cut it may lack, and the pose the bake sets. */
interface VendoredOptions extends Omit<SparkBuddyOptions, "cut"> {
  readonly cut: SparkRgb | null;
  /** false: the star without its eyes */
  readonly face?: boolean;
  readonly props?: boolean;
  readonly signals?: boolean;
  readonly motionScale?: number;
  readonly faceScale?: number;
}

/** A buddy as these doors set it: its opacity, its gaze, its settle into its pose at once, and the step the engine
 * runs on it each render that is not frozen (`update`, which sets its alpha afresh: 1, or its own fade). */
interface VendoredBuddy extends SparkBuddy {
  alpha: number;
  look: [number, number];
  /** whether it draws its props, read by each update */
  propsOn: boolean;
  settle(): unknown;
  update(t: number, dt: number): void;
}

interface Vendored {
  readonly Buddy: new (options: VendoredOptions) => VendoredBuddy;
}

/** The vendored engine's Buddy with the members these doors use typed: the kit's one door onto it. */
const vendored = (engines: Sparklings): Vendored => engines as unknown as Vendored;

/** Lets a canvas's WebGL2 context go (asked only once the engine has made it, so this makes none). */
function letGo(canvas: HTMLCanvasElement): void {
  canvas.getContext("webgl2")?.getExtension("WEBGL_lose_context")?.loseContext();
}

/** A stage over `canvas` that the caller drives, or null where the canvas gives no WebGL2. */
export function createDrivenStage(
  canvas: HTMLCanvasElement,
  engines: Sparklings,
): DrivenStage | null {
  const { Buddy } = vendored(engines);
  /** A face as this stage draws it: the engine's update sets its alpha afresh each render that is not frozen, and the
   * caller's is laid over it after (the engine's own fade, were one set, multiplies with it). */
  class DrivenBuddy extends Buddy {
    /** the opacity the caller placed it at, 0–1 */
    placed = 1;
    override update(t: number, dt: number): void {
      super.update(t, dt);
      this.alpha *= this.placed;
    }
  }
  let engine: SparkEngine;
  try {
    engine = new engines.Engine(canvas, { max: DRIVEN_MOST });
  } catch {
    return null;
  }
  /** each face's buddy, the status it last felt, and whether that status came since the last render */
  const faces = new Map<
    string,
    { readonly buddy: DrivenBuddy; status: SparkStatus; felt: boolean }
  >();
  let frames = 0;
  let released = false;

  const put = (buddy: DrivenBuddy, face: DrivenFace): void => {
    placeSparkBuddy(buddy, face.x, face.y, face.size, false);
    buddy.placed = face.alpha;
    // a frozen render runs no update: the alpha it draws is this one
    buddy.alpha = face.alpha;
    buddy.propsOn = face.props;
  };

  return {
    place(id, face) {
      if (released) return;
      const known = faces.get(id);
      if (known === undefined) {
        if (faces.size >= DRIVEN_MOST) return;
        const free = { seed: face.seed, status: face.status, framed: false };
        // made settled into its status (the engine's constructor settles), so it is not a change to settle again
        const buddy = new DrivenBuddy({
          ...sparkBuddyOptions(engines, free, NO_GROUND),
          props: face.props,
        });
        engine.add(buddy);
        put(buddy, face);
        faces.set(id, { buddy, status: face.status, felt: false });
        return;
      }
      put(known.buddy, face);
      if (known.status !== face.status) {
        known.status = face.status;
        known.felt = true;
        known.buddy.rest = face.status;
        known.buddy.feel(face.status);
      }
    },
    drop(id) {
      const known = faces.get(id);
      if (known === undefined) return;
      faces.delete(id);
      engine.remove(known.buddy);
    },
    render(seconds, frozen = false) {
      if (released) return;
      for (const known of faces.values()) {
        // a frozen render runs no update, so no spring carries a new status: the face takes its pose at once
        if (frozen && known.felt) known.buddy.settle();
        known.felt = false;
      }
      engine.render(seconds, { frozen });
      frames += 1;
    },
    resize() {
      if (!released) engine.resize();
    },
    frames: () => frames,
    release() {
      if (released) return;
      released = true;
      faces.clear();
      engine.clear();
      letGo(canvas);
    },
    released: () => released,
  };
}

/** Each seed's star drawn flat with its eyes and without them, in one engine lifetime (above). */
export function bakeFlatStars(
  engines: Sparklings,
  seeds: readonly number[],
  options: FlatStarBakeOptions,
): readonly (FlatStarBake | null)[] {
  const none = seeds.map((): FlatStarBake | null => null);
  if (seeds.length === 0) return none;
  const { cell, ratio } = options;
  const cells = seeds.length * 2;
  const cols = Math.min(cells, BAKE_COLS);
  const rows = Math.ceil(cells / cols);
  const width = cols * cell;
  const height = rows * cell;
  /** a cell's side, CSS px */
  const across = cell / ratio;
  const stage = options.stage(cols * across, rows * across);
  if (stage === null) return none;
  const { Buddy } = vendored(engines);
  let engine: SparkEngine | null = null;
  try {
    engine = new engines.Engine(stage.canvas, { max: cells, preserve: true });
    // the cells are read at whole texels only where the engine sized its canvas exactly as laid
    if (stage.canvas.width !== width || stage.canvas.height !== height) return none;
    for (const [i, seed] of seeds.entries()) {
      const dna = engines.agentDNA(seed);
      for (const [j, face] of [true, false].entries()) {
        const k = i * 2 + j;
        const x = (k % cols) * across;
        const y = Math.floor(k / cols) * across;
        const buddy = new Buddy({
          seed: dna.seed,
          palette: dna.palette,
          body: dna.body,
          eyes: dna.eyes,
          style: FLAT,
          watch: false,
          mouth: false,
          face,
          emotion: CALM,
          rest: CALM,
          frame: 0,
          frameC: SPARK_FRAME.frameC,
          frameH: SPARK_FRAME.frameH,
          cut: null,
          props: false,
          signals: false,
          motionScale: 0,
          faceScale: options.faceScale,
        });
        buddy.settle();
        buddy.look = [options.look[0], options.look[1]];
        buddy.R = options.radius / ratio;
        buddy.x = x + across / 2;
        buddy.y = y + across / 2;
        buddy.clip = [x, y, x + across, y + across];
        engine.add(buddy);
      }
    }
    engine.render(0, { frozen: true });
    const read = options.surface(width, height)?.getContext("2d", { willReadFrequently: true });
    if (read === null || read === undefined) return none;
    read.drawImage(stage.canvas, 0, 0, width, height, 0, 0, width, height);
    const pixels = read.getImageData(0, 0, width, height).data;
    /** cell `k`'s texels, row by row */
    const cellOf = (k: number): Uint8ClampedArray => {
      const out = new Uint8ClampedArray(cell * cell * 4);
      const left = (k % cols) * cell;
      const top = Math.floor(k / cols) * cell;
      for (let y = 0; y < cell; y += 1) {
        const from = ((top + y) * width + left) * 4;
        out.set(pixels.subarray(from, from + cell * 4), y * cell * 4);
      }
      return out;
    };
    return seeds.map((seed, i): FlatStarBake | null => {
      const palette = engines.PALETTES[engines.agentDNA(seed).palette];
      if (palette === undefined) return null;
      return { size: cell, face: cellOf(i * 2), bare: cellOf(i * 2 + 1), palette };
    });
  } catch {
    return none;
  } finally {
    // one context for the bake, let go at once (the contexts a window may hold are few)
    if (engine !== null) {
      engine.clear();
      letGo(stage.canvas);
    }
    stage.release();
  }
}
