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

/** The hatch, as its sheet holds it. */
export interface SparkHatchHandle {
  /** The face leaves the sky for `target` (a framed face's box), on the island curve, and lands there. Resolves when it
   * has landed, or at once where nothing can fly (no WebGL2, reduced motion, no face yet). */
  fly(target: HTMLElement): Promise<void>;
}

export interface SparkHatchProps {
  /** the face dealt: its seed */
  seed: number;
  /** a new number plays the hatch again: on open, and on each reroll */
  play: number;
  /** the face's box in px: 104, free (§2.10's table) */
  size?: number | undefined;
  className?: string | undefined;
  ref?: Ref<SparkHatchHandle> | undefined;
}

/** Where the star lands, as a fraction of the sky's height (the page's: the middle). */
const LAND_AT = 0.5;
/** How long a flight to a row takes, seconds (the island curve's flow). */
const FLY_S = 0.66;

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

  // the two canvases' engines, for the hatch's life; opened, they play the face dealt (the sheet's open)
  useEffect(() => {
    if (typeof engines !== "object" || !skyCanvas.current || !faceCanvas.current || !root.current)
      return;
    const made = Live.open(engines, root.current, skyCanvas.current, faceCanvas.current, size);
    if (made === null) {
      setEngines("flat");
      return;
    }
    live.current = made;
    made.deal(dealt.current);
    return () => {
      made.close();
      live.current = null;
    };
  }, [engines, size]);

  // on each reroll (and on open, once the engines are up): the star falls and the face is born
  useEffect(() => {
    void play;
    live.current?.deal(seed);
  }, [seed, play]);

  useImperativeHandle(
    ref,
    () => ({ fly: (target) => live.current?.fly(target) ?? Promise.resolve() }),
    [],
  );

  const classes = className ? `vf-spark-hatch ${className}` : "vf-spark-hatch";
  return (
    <div
      ref={root}
      className={classes}
      data-hatch={typeof engines === "object" ? "live" : engines}
      aria-hidden="true"
    >
      {engines === "flat" ? (
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
  #clock = 0;
  #last = 0;
  #hero: Hero | null = null;
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
    private readonly root: HTMLElement,
    private readonly sky: StarSparkEngine,
    private readonly faces: SparkEngine,
    private readonly size: number,
  ) {
    this.#last = performance.now();
    this.#frame = requestAnimationFrame(this.#draw);
  }

  /** Both engines on their canvases, or null where the window has no WebGL2. */
  static open(
    engines: Engines,
    root: HTMLElement,
    skyCanvas: HTMLCanvasElement,
    faceCanvas: HTMLCanvasElement,
    size: number,
  ): Live | null {
    try {
      const sky = new engines.star(skyCanvas, { bloom: true, bloomStr: 0.45, max: 8, night: true });
      const faces = new engines.face.Engine(faceCanvas, { max: 6 });
      return new Live(engines, root, sky, faces, size);
    } catch {
      return null;
    }
  }

  deal(seed: number): void {
    const t = this.#clock;
    const box = this.root.getBoundingClientRect();
    const centre = { x: box.width / 2, y: box.height * LAND_AT };
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
    const from = { x: centre.x - direction.x * distance, y: centre.y - direction.y * distance };
    const flight = clamp(0.42 + distance / 1500, 0.55, 1.05);
    buddy.birth(t + flight, [["hello", 2.4]]);
    this.sky.add({
      x: centre.x,
      y: centre.y,
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
      const sky = this.root.getBoundingClientRect();
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
    this.sky.clear();
    this.faces.clear();
    if (this.#flight !== null) {
      this.#flight.overlay.remove();
      this.#flight.done();
      this.#flight = null;
    }
  }

  readonly #draw = (now: number): void => {
    this.#clock += clamp((now - this.#last) / 1000, 0, 0.05);
    this.#last = now;
    const t = this.#clock;
    this.sky.render(t);
    this.faces.resize();
    this.faces.render(t);
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
