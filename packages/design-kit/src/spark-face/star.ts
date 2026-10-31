// The hatch's falling star (DESIGN.md §2.10 "The hatch") — James's Star Spark engine, vendored byte for byte as
// ./vendor/star-spark.js with its first user, the New spark sheet (SP-1c). Like the face's engine it is an IIFE that
// sets one global, so the kit never imports it statically: the first hatch to mount loads it. This module is its typed
// door; only what the hatch uses is typed.

/** One star, as `add` takes it: where it lands, how big, and when it falls, lands and dies (seconds, its clock). */
export interface StarSparkStar {
  readonly x: number;
  readonly y: number;
  readonly R: number;
  readonly seed: number;
  /** one of the engine's twelve palettes */
  readonly palette: number;
  /** the engine's layer bits: the hatch draws its burst */
  readonly mask: number;
  readonly burstMode: number;
  readonly from: { readonly x: number; readonly y: number };
  readonly tStart: number;
  readonly tImpact: number;
  readonly tDeath: number;
}

export interface StarSparkEngine {
  add(star: StarSparkStar): object;
  clear(): void;
  resize(): void;
  render(seconds: number): void;
}

export interface StarSpark {
  new (
    canvas: HTMLCanvasElement,
    options?: {
      readonly bloom?: boolean;
      readonly bloomStr?: number;
      readonly max?: number;
      readonly night?: boolean;
    },
  ): StarSparkEngine;
  readonly LAYERS: Readonly<Record<string, number>>;
}

let loading: Promise<StarSpark> | undefined;

/** The star engine, loaded once. A load that fails is tried again by the next hatch that mounts. */
export function loadStarSpark(): Promise<StarSpark> {
  loading ??= import("./vendor/star-spark.js").then(
    () => {
      const engine = (window as unknown as { SparkEngine?: StarSpark }).SparkEngine;
      if (!engine) throw new Error("the star engine loaded but set no window.SparkEngine");
      return engine;
    },
    (error: unknown) => {
      loading = undefined;
      throw error;
    },
  );
  return loading;
}

/** The star's palette for a face's: the face set's thirteenth and fourteenth palettes have no star of their own, so
 * they borrow the nearest of the twelve (the page's mapping, `sparks/src/faces.js`). */
export function starPaletteOf(facePalette: number): number {
  return facePalette < 12 ? facePalette : facePalette === 12 ? 7 : 10;
}
