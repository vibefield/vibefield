// A spark's face engine (DESIGN.md §2.10) — James's Agent Sparks (Sparklings v2), vendored byte
// for byte as ./vendor/sparks.js. It is an IIFE that sets one global, so the kit never imports it
// statically (docs/UI_SYSTEM.md: every module in the kit stays pure at import): the first face to
// mount loads it, and every face after reads the same engine. This module is its typed door; only
// what the face uses is typed.

/** One of the engine's palettes: the face's own colours, carried as the engine's data. */
export interface SparkPalette {
  readonly name: string;
  /** flat body, glow centre, glow mid, glow rim, aura, frost tint, prop ink, blush */
  readonly c: readonly string[];
  /** the glow backdrop, top then bottom: a framed face's disc */
  readonly deep: readonly string[];
}

/** One point of a star, in the star's radii: its angle, its length, its half-width, its bend. */
export type SparkPoint = readonly [angle: number, length: number, halfWidth: number, bend: number];

export interface SparkBody {
  readonly n: number;
  readonly core: number;
  readonly k: number;
  readonly tip: number;
  readonly pts: readonly SparkPoint[];
}

export interface SparkEyes {
  readonly gap: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

/** A face's DNA: `agentDNA(seed)` — its points, its eyes, and one of the first twelve palettes. */
export interface SparkDna {
  readonly seed: number;
  readonly palette: number;
  readonly body: Readonly<Record<string, number>>;
  readonly eyes: Readonly<Record<string, number>>;
}

export type SparkRgb = readonly [number, number, number];

export interface SparkBuddyOptions {
  readonly seed: number;
  readonly palette: number;
  readonly body: Readonly<Record<string, number>>;
  readonly eyes: Readonly<Record<string, number>>;
  /** 2, the glow */
  readonly style: number;
  readonly watch: boolean;
  /** false: the mouthless set (James, 2026-10-29) */
  readonly mouth: boolean;
  readonly emotion: string;
  readonly rest: string;
  /** 1 on its disc, 0 free */
  readonly frame: number;
  readonly frameC: readonly [number, number];
  readonly frameH: number;
  readonly cut: SparkRgb;
}

export interface SparkBuddy {
  x: number;
  y: number;
  R: number;
  faceScale: number;
  rest: string;
  cut: SparkRgb | null;
  clip: readonly [number, number, number, number] | null;
  hidden: boolean;
  readonly frameC: readonly [number, number];
  readonly frameH: number;
  feel(status: string): SparkBuddy;
}

export interface SparkEngine {
  add(buddy: SparkBuddy): SparkBuddy;
  remove(buddy: SparkBuddy): void;
  clear(): void;
  resize(): void;
  render(seconds: number, options?: { readonly frozen?: boolean }): void;
}

export interface Sparklings {
  readonly Engine: new (
    canvas: HTMLCanvasElement,
    options?: { readonly max?: number; readonly preserve?: boolean },
  ) => SparkEngine;
  readonly Buddy: new (options: SparkBuddyOptions) => SparkBuddy;
  readonly PALETTES: readonly SparkPalette[];
  readonly STATUSES: readonly { readonly id: string; readonly name: string }[];
  /** the motions by name — reduced motion sets them aside (below) */
  readonly MOTION: Record<string, (...args: number[]) => object>;
  agentDNA(seed: number): SparkDna;
  makeBody(seed: number, traits?: Readonly<Record<string, number>>): SparkBody;
  makeEyes(seed: number, traits?: Readonly<Record<string, number>>): SparkEyes;
}

/** The disc a framed face sits on: 1.26 of the star's radius, the star 6% of it below the centre. */
export const SPARK_FRAME = Object.freeze({ frameC: [0, 0.06] as const, frameH: 1.26 });

/** At 32 px and below a face's eyes are drawn 1.25× larger, and up to 48 px 1.12×, so they read. */
export function sparkFaceScale(size: number): number {
  return size <= 32 ? 1.25 : size <= 48 ? 1.12 : 1;
}

let loading: Promise<Sparklings> | undefined;

/** The engine, loaded once. A load that fails is tried again by the next face that mounts. */
export function loadSparklings(): Promise<Sparklings> {
  loading ??= import("./vendor/sparks.js").then(
    () => {
      const engine = (window as unknown as { Sparklings?: Sparklings }).Sparklings;
      if (!engine) throw new Error("the spark engine loaded but set no window.Sparklings");
      holdReducedMotion(engine);
      return engine;
    },
    (error: unknown) => {
      loading = undefined;
      throw error;
    },
  );
  return loading;
}

// Reduced motion keeps the faces, their blinks and their status changes, and drops the hops and the
// shakes (M6) — the engine's own switch, as its page sets it: while the preference holds, every
// motion is still; when it lifts, each is the engine's again.
function holdReducedMotion(engine: Sparklings): void {
  const query =
    typeof matchMedia === "function" ? matchMedia("(prefers-reduced-motion: reduce)") : null;
  if (!query) return;
  const motions = { ...engine.MOTION };
  const still = (): object => ({});
  const apply = (): void => {
    for (const [name, motion] of Object.entries(motions))
      engine.MOTION[name] = query.matches ? still : motion;
  };
  apply();
  query.addEventListener("change", apply);
}

/** A buddy's options for a face: the glow, mouthless, its DNA, at rest in its status. */
export function sparkBuddyOptions(
  engine: Sparklings,
  face: { readonly seed: number; readonly status: string; readonly framed: boolean },
  cut: SparkRgb,
): SparkBuddyOptions {
  const dna = engine.agentDNA(face.seed);
  return {
    seed: dna.seed,
    palette: dna.palette,
    body: dna.body,
    eyes: dna.eyes,
    style: 2,
    watch: false,
    mouth: false,
    emotion: face.status,
    rest: face.status,
    frame: face.framed ? 1 : 0,
    frameC: SPARK_FRAME.frameC,
    frameH: SPARK_FRAME.frameH,
    cut,
  };
}

/** Places a buddy on a face's box: centred, the star 6% below the disc's centre when framed. */
export function placeSparkBuddy(
  buddy: SparkBuddy,
  centreX: number,
  centreY: number,
  size: number,
  framed: boolean,
): void {
  const R = size / 2 / SPARK_FRAME.frameH;
  buddy.R = R;
  buddy.x = centreX - (framed ? SPARK_FRAME.frameC[0] * R : 0);
  buddy.y = centreY + (framed ? SPARK_FRAME.frameC[1] * R : 0);
  buddy.faceScale = sparkFaceScale(size);
}
