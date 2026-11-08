import {
  type ReactElement,
  type Ref,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from "react";
import {
  loadSparklings,
  placeSparkBuddy,
  SPARK_FRAME,
  type SparkBuddy,
  type SparkEngine,
  type Sparklings,
  sparkBuddyOptions,
} from "./engine";
import { SparkFace } from "./SparkFace";
import { loadStarSpark, type StarSpark, type StarSparkEngine, starPaletteOf } from "./star";
import { surfaceBehind } from "./surface";

// THE HATCH (DESIGN.md §2.10 "The hatch"; §8 "The New spark sheet"; NS-D3 A, "on open, and on each reroll"). The
// sheet's sky: a star falls at an angle, lands and bursts, and the face is born where it hit, free. Two canvases, one
// over the other: the sky (James's star engine, its own night with bloom) and the face (the face engine, one buddy
// born at the impact). A new `play` deals it again; the face before leaves first. Without WebGL2 it is the flat star on
// the night's ground, never a blank. With reduced motion no star falls and the face is simply born. `fly` carries the
// face out of the sky to a framed slot (a row in Chat) across the window, and then the face is that slot's.
// ES-3b (§6, the portal): opened from Chat's empty night the hatch's sky is LENT (`sky`) — the sheet's window, the
// night's own canvas, panel-sized at the panel's place, and a face canvas at the hatch's own place over it. It draws on
// them from the night's own moment, so its first frame is that night, and says so (`onDrawn`); its star lands at the
// hatch's place's centre in the sky canvas's own pixels (`skyPointOf`).

/** The hatch, as its sheet holds it. */
export interface SparkHatchHandle {
  /** The face leaves the sky for `target` (a framed face's box), on the island curve, and lands there. Resolves when it
   * has landed, or at once where nothing can fly (no WebGL2, reduced motion, no face yet). */
  fly(target: HTMLElement): Promise<void>;
  /** ES-3b — the hatch's own clock now, in seconds: the moment its lent sky is handed back to the night at; null while
   * nothing draws */
  now(): number | null;
  /** ES-3b — the face shrinks back into the night (the face engine's leave, `FACE_LEAVE_S` on the hatch's own clock):
   * Cancel through the portal. ES-3e: resolves once it has run, or at once where no face stands or nothing draws */
  leave(): Promise<void>;
}

/** ES-3b — a sky lent to the hatch: the sheet's window, the night's own canvas, panel-sized at the panel's place, and a
 * face canvas at the hatch's own place over it. The hatch draws on them from the night's moment `t`. */
export interface SparkHatchSky {
  readonly canvas: HTMLCanvasElement;
  readonly face: HTMLCanvasElement;
  readonly t: number;
  /** the first frame is drawn: the night may step aside */
  readonly onDrawn?: (() => void) | undefined;
  /** the engines could not open on it (no WebGL2): the sheet rises as it always has */
  readonly onFailed?: (() => void) | undefined;
}

export interface SparkHatchProps {
  /** the face dealt: its seed */
  seed: number;
  /** a new number plays the hatch again: on open, and on each reroll */
  play: number;
  /** the face's box in px: 104, free (§2.10's table) */
  size?: number | undefined;
  className?: string | undefined;
  /** ES-3b — the sky lent to it (the sheet's window); absent, its own two canvases in its own place */
  sky?: SparkHatchSky | undefined;
  ref?: Ref<SparkHatchHandle> | undefined;
}

/** Where the star lands, as a fraction of the sky's height (the page's: the middle). */
const LAND_AT = 0.5;
/** How long a flight to a row takes, seconds (the island curve's flow). */
const FLY_S = 0.66;
/** How long the face engine's own leave takes (its `leave(at)`: it fades and shrinks), seconds on the hatch's clock. */
const FACE_LEAVE_S = 0.45;

/** A place on the window, as a client rect gives it. */
interface PlaceRect {
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
}

/** Where a star lands on a sky canvas: the face's place's centre (its middle across, `LAND_AT` down), in the sky
 * canvas's own CSS pixels — the face's own place where the sky is the hatch's own, and the window's spot over the
 * hatch's place where the sky is lent (ES-3b). */
export function skyPointOf(
  face: PlaceRect,
  sky: PlaceRect,
): { readonly x: number; readonly y: number } {
  return {
    x: face.left - sky.left + face.width / 2,
    y: face.top - sky.top + face.height * LAND_AT,
  };
}

interface Engines {
  readonly face: Sparklings;
  readonly star: StarSpark;
}

const clamp = (value: number, low: number, high: number): number =>
  Math.max(low, Math.min(high, value));
/** The island curve, `cubic-bezier(0.25, 1, 0.3, 1)`, near enough for a flight's position (an ease-out). */
const islandish = (u: number): number => 1 - (1 - u) ** 3;
const reducedMotion = (): boolean =>
  typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;

export function SparkHatch({
  seed,
  play,
  size = 104,
  className,
  sky,
  ref,
}: SparkHatchProps): ReactElement {
  const root = useRef<HTMLDivElement>(null);
  const skyCanvas = useRef<HTMLCanvasElement>(null);
  const faceCanvas = useRef<HTMLCanvasElement>(null);
  const [engines, setEngines] = useState<Engines | "loading" | "flat">("loading");
  const live = useRef<Live | null>(null);
  // the face dealt now, for the engines that open after it was dealt
  const dealt = useRef(seed);
  dealt.current = seed;

  useEffect(() => {
    let open = true;
    Promise.all([loadSparklings(), loadStarSpark()]).then(
      ([face, star]) => {
        if (open) setEngines({ face, star });
      },
      () => {
        if (open) setEngines("flat");
      },
    );
    return () => {
      open = false;
    };
  }, []);

  // the two canvases' engines, for the hatch's life (its own, or the lent sky's); opened, they play the face dealt. A
  // lent sky they cannot draw on is said at once, so the sheet rises as it always has
  useEffect(() => {
    if (engines === "flat" && sky !== undefined) {
      sky.onFailed?.();
      return;
    }
    if (typeof engines !== "object") return;
    const skyAt = sky?.canvas ?? skyCanvas.current;
    const faceAt = sky?.face ?? faceCanvas.current;
    if (!skyAt || !faceAt) return;
    const made = Live.open(engines, skyAt, faceAt, size, sky?.t ?? 0, sky?.onDrawn);
    if (made === null) {
      if (sky === undefined) setEngines("flat");
      else sky.onFailed?.();
      return;
    }
    live.current = made;
    made.deal(dealt.current);
    return () => {
      made.close();
      live.current = null;
    };
  }, [engines, size, sky]);

  // on each reroll (and on open, once the engines are up): the star falls and the face is born
  useEffect(() => {
    void play;
    live.current?.deal(seed);
  }, [seed, play]);

  useImperativeHandle(
    ref,
    () => ({
      fly: (target) => live.current?.fly(target) ?? Promise.resolve(),
      now: () => live.current?.now() ?? null,
      leave: () => live.current?.leave() ?? Promise.resolve(),
    }),
    [],
  );

  const classes = className ? `vf-spark-hatch ${className}` : "vf-spark-hatch";
  return (
    <div
      ref={root}
      className={classes}
      data-hatch={typeof engines === "object" ? "live" : engines}
      {...(sky === undefined ? {} : { "data-sky": "lent" })}
      aria-hidden="true"
    >
      {sky !== undefined ? null : engines === "flat" ? (
        <span className="vf-spark-hatch-still">
          <SparkFace seed={seed} status="hello" size={size} framed={false} />
        </span>
      ) : (
        <>
          <canvas ref={skyCanvas} className="vf-spark-hatch-sky" />
          <canvas ref={faceCanvas} className="vf-spark-hatch-face" />
        </>
      )}
    </div>
  );
}

interface Hero {
  readonly buddy: SparkBuddy & {
    birth(at: number, seq: [string, number][]): unknown;
    leave(at: number): unknown;
  };
  readonly seed: number;
}

/** The hatch's two engines and its one clock: drawn every frame while the hatch is mounted. */
class Live {
  #frame = 0;
  #clock: number;
  #last = 0;
  #drawn = false;
  #hero: Hero | null = null;
  /** faces leaving, each said done once this clock has run past its end (ES-3e) */
  #leaving: { readonly until: number; readonly done: () => void }[] = [];
  #flight: {
    readonly overlay: HTMLCanvasElement;
    readonly engine: SparkEngine;
    readonly buddy: SparkBuddy;
    readonly from: { readonly x: number; readonly y: number; readonly R: number };
    readonly target: HTMLElement;
    readonly t0: number;
    readonly done: () => void;
    framed: boolean;
  } | null = null;

  private constructor(
    private readonly engines: Engines,
    private readonly skyCanvas: HTMLCanvasElement,
    private readonly faceCanvas: HTMLCanvasElement,
    private readonly sky: StarSparkEngine,
    private readonly faces: SparkEngine,
    private readonly size: number,
    clock: number,
    private readonly onDrawn: (() => void) | undefined,
  ) {
    this.#clock = clock;
    this.#last = performance.now();
    this.#frame = requestAnimationFrame(this.#draw);
  }

  /** Both engines on their canvases, or null where the window has no WebGL2. `clock`: its first moment (a lent sky's,
   * the night's own); `onDrawn`: said once its first frame is drawn. */
  static open(
    engines: Engines,
    skyCanvas: HTMLCanvasElement,
    faceCanvas: HTMLCanvasElement,
    size: number,
    clock: number,
    onDrawn?: () => void,
  ): Live | null {
    try {
      const sky = new engines.star(skyCanvas, { bloom: true, bloomStr: 0.45, max: 8, night: true });
      const faces = new engines.face.Engine(faceCanvas, { max: 6 });
      return new Live(engines, skyCanvas, faceCanvas, sky, faces, size, clock, onDrawn);
    } catch {
      return null;
    }
  }

  now(): number {
    return this.#clock;
  }

  /** The face shrinks back into the night (the face engine's leave); resolves once the leave has run on this clock. */
  leave(): Promise<void> {
    if (this.#hero === null) return Promise.resolve();
    this.#hero.buddy.leave(this.#clock);
    this.#hero = null;
    const until = this.#clock + FACE_LEAVE_S;
    return new Promise((done) => {
      this.#leaving.push({ until, done });
    });
  }

  deal(seed: number): void {
    const t = this.#clock;
    const face = this.faceCanvas.getBoundingClientRect();
    const centre = { x: face.width / 2, y: face.height * LAND_AT };
    // the star's landing, in the sky canvas's own pixels: the face's centre where the sky is the hatch's own, the
    // window's spot over the hatch's place where it is lent
    const landing = skyPointOf(face, this.skyCanvas.getBoundingClientRect());
    if (this.#hero !== null) this.#hero.buddy.leave(t);
    const options = sparkBuddyOptions(
      this.engines.face,
      { seed, status: "ready", framed: false },
      [0, 0, 0],
    );
    const buddy = this.faces.add(
      new this.engines.face.Buddy({ ...options, watch: true }),
    ) as Hero["buddy"];
    placeSparkBuddy(buddy, centre.x, centre.y, this.size, false);
    this.#hero = { buddy, seed };
    if (reducedMotion()) {
      buddy.birth(t, [["hello", 2.4]]);
      return;
    }
    // the star falls at an angle, from above the sky, and lands where the face is born
    const angle = (Math.random() < 0.5 ? -1 : 1) * (0.3 + Math.random() * 0.2);
    const direction = { x: Math.sin(angle), y: Math.cos(angle) };
    const distance = (centre.y + buddy.R * 3 + 30) / direction.y;
    const from = { x: landing.x - direction.x * distance, y: landing.y - direction.y * distance };
    const flight = clamp(0.42 + distance / 1500, 0.55, 1.05);
    buddy.birth(t + flight, [["hello", 2.4]]);
    this.sky.add({
      x: landing.x,
      y: landing.y,
      R: buddy.R * 0.9,
      seed: 1 + Math.floor(Math.random() * 999_998),
      palette: starPaletteOf(this.engines.face.agentDNA(seed).palette),
      mask: this.engines.star.LAYERS.BURST ?? 0,
      burstMode: 2,
      from,
      tStart: t,
      tImpact: t + flight,
      tDeath: t + flight + 3.4,
    });
  }

  fly(target: HTMLElement): Promise<void> {
    const hero = this.#hero;
    if (hero === null || reducedMotion()) return Promise.resolve();
    return new Promise((done) => {
      // one canvas over the whole window, under nothing it would hide, for the flight alone
      const overlay = document.createElement("canvas");
      overlay.className = "vf-spark-hatch-flight";
      overlay.setAttribute("aria-hidden", "true");
      document.body.append(overlay);
      let engine: SparkEngine;
      try {
        engine = new this.engines.face.Engine(overlay, { max: 2 });
      } catch {
        overlay.remove();
        done();
        return;
      }
      const sky = this.faceCanvas.getBoundingClientRect();
      const from = { x: sky.left + hero.buddy.x, y: sky.top + hero.buddy.y, R: hero.buddy.R };
      const options = sparkBuddyOptions(
        this.engines.face,
        { seed: hero.seed, status: "ready", framed: false },
        surfaceBehind(target),
      );
      const buddy = engine.add(new this.engines.face.Buddy(options));
      this.faces.remove(hero.buddy);
      this.#hero = null;
      this.#flight = { overlay, engine, buddy, from, target, t0: this.#clock, done, framed: false };
    });
  }

  close(): void {
    cancelAnimationFrame(this.#frame);
    this.#frame = 0;
    // nothing more is drawn: every face leaving is gone with it
    for (const leaving of this.#leaving.splice(0)) leaving.done();
    this.sky.clear();
    this.faces.clear();
    if (this.#flight !== null) {
      this.#flight.overlay.remove();
      this.#flight.done();
      this.#flight = null;
    }
  }

  readonly #draw = (now: number): void => {
    // the first frame is drawn at its first moment exactly (a lent sky's is the night's own: star for star)
    if (this.#drawn) this.#clock += clamp((now - this.#last) / 1000, 0, 0.05);
    this.#last = now;
    const t = this.#clock;
    this.sky.render(t);
    this.faces.resize();
    this.faces.render(t);
    if (!this.#drawn) {
      this.#drawn = true;
      this.onDrawn?.();
    }
    if (this.#leaving.length > 0) {
      const left = this.#leaving.filter((leaving) => t >= leaving.until);
      this.#leaving = this.#leaving.filter((leaving) => t < leaving.until);
      for (const leaving of left) leaving.done();
    }
    const flight = this.#flight;
    if (flight !== null) {
      flight.engine.resize();
      const box = flight.target.getBoundingClientRect();
      const R1 = box.width / 2 / SPARK_FRAME.frameH;
      const to = {
        x: box.left + box.width / 2,
        y: box.top + box.height / 2 + SPARK_FRAME.frameC[1] * R1,
      };
      const u = clamp((t - flight.t0) / FLY_S, 0, 1);
      const e = islandish(u);
      const lift =
        Math.sin(Math.PI * e) *
        Math.min(90, Math.hypot(to.x - flight.from.x, to.y - flight.from.y) * 0.18);
      flight.buddy.x = flight.from.x + (to.x - flight.from.x) * e;
      flight.buddy.y = flight.from.y + (to.y - flight.from.y) * e - lift;
      flight.buddy.R = flight.from.R + (R1 - flight.from.R) * e;
      // halfway, small and moving fast, it puts on the disc it wears in its row
      if (!flight.framed && u > 0.45) {
        flight.framed = true;
        Object.assign(flight.buddy, {
          frame: 1,
          frameC: SPARK_FRAME.frameC,
          frameH: SPARK_FRAME.frameH,
          faceScale: 1.12,
        });
      }
      flight.engine.render(t);
      if (u >= 1) {
        flight.overlay.remove();
        this.#flight = null;
        flight.done();
      }
    }
    this.#frame = requestAnimationFrame(this.#draw);
  };
}
