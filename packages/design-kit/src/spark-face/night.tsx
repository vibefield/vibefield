import { type ReactElement, useEffect, useRef, useState } from "react";
import { loadStarSpark, type StarSpark, type StarSparkEngine } from "./star";

// THE NIGHT (track ES, 2026-11-08; DESIGN.md §2.10 "the night before the first spark", §6 "The night, at rest, under
// the pointer, and through the portal"; ES-D1 A and ES-D7 A, ruled by James on the ES page) — the hatch's night alone,
// at the size of what holds it: James's star engine's own night, with its bloom and no star dealt, on Chat's empty
// panel. It keeps the field's idle, never a loop (M5's ambient): live while the pointer is about, still 20 s after the
// last pointer and easing out over 2 s, woken by the pointer; drawn once under reduced motion; no frame while it is out
// of sight or its view is not the one shown. Without WebGL2 it is its ground, `--vf-spark-night`, which its own box
// wears under the canvas — never a blank.

/** How long after the last pointer the night rests, in seconds. */
export const NIGHT_REST_AFTER_S = 20;
/** How long it takes the night to come still, in seconds: its clock eases out over this. */
export const NIGHT_EASE_OUT_S = 2;
/** Below this the night is still: its clock stands, and it draws no frame. */
const STILL = 0.01;
/** How quickly the pointer wakes it, in seconds: quicker than it rests. */
const WAKE_S = 0.18;

/** The rate the night's clock should run at: 1 while the pointer has been about within the rest, 0 after it, and 0
 * under reduced motion (drawn once). */
export function nightRestTarget(sinceLastPointerS: number, reduced: boolean): 0 | 1 {
  if (reduced) return 0;
  return sinceLastPointerS > NIGHT_REST_AFTER_S ? 0 : 1;
}

/** One step of the night's clock rate toward its target: it eases out over `NIGHT_EASE_OUT_S` (by its end it moves at
 * under 2% of its pace) and wakes in `WAKE_S`; near still, it is still. */
export function nightRestRate(rate: number, target: number, dtS: number): number {
  const tau = target < rate ? NIGHT_EASE_OUT_S / 4 : WAKE_S;
  const next = rate + (target - rate) * Math.min(1, dtS / tau);
  return target === 0 && next < STILL ? 0 : next;
}

export interface SparkNightProps {
  /** its view is the one shown (Chat's `active`): while it is not, the night draws nothing */
  active?: boolean | undefined;
  className?: string | undefined;
}

type NightState = "loading" | "live" | "ground";

const reducedMotion = (): boolean =>
  typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;

export function SparkNight({ active = true, className }: SparkNightProps): ReactElement {
  const box = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const rest = useRef<NightHandle | null>(null);
  // whether its view is shown, for the engine as it opens: it loads after the first render
  const shown = useRef(active);
  const [state, setState] = useState<NightState>("loading");

  // the engine, on the canvas that stands while it loads: drawing, the night is live; where it cannot, the ground
  useEffect(() => {
    let open = true;
    loadStarSpark().then(
      (star) => {
        if (!open || canvas.current === null || box.current === null) return;
        rest.current = openNight(star, canvas.current, box.current, shown.current);
        setState(rest.current === null ? "ground" : "live");
      },
      () => {
        if (open) setState("ground");
      },
    );
    return () => {
      open = false;
      rest.current?.close();
      rest.current = null;
    };
  }, []);

  useEffect(() => {
    shown.current = active;
    rest.current?.show(active);
  }, [active]);

  const classes = className ? `vf-spark-night ${className}` : "vf-spark-night";
  return (
    <div ref={box} className={classes} data-night={state} aria-hidden="true">
      {state === "ground" ? null : <canvas ref={canvas} className="vf-spark-night-sky" />}
    </div>
  );
}

/** What a night draws with: James's star engine (`StarSparkEngine`), or a stand-in. */
export interface NightEngine {
  render(seconds: number): void;
  clear(): void;
}

/** A night's core, standing on its box: shown or not as its view is, closed with it. */
export interface NightHandle {
  show(shown: boolean): void;
  close(): void;
}

/** The night lent to the sheet's window (ES-3b; DESIGN.md §6, the portal: "The window is the night's own canvas,
 * lent"). While it is lent the night is still, so the window's first frame is it, star for star. */
export interface NightLend {
  /** the night's own moment, its clock in seconds: the window draws its first frame at it */
  readonly t: number;
  /** where the night stands in the window (its box's client rect) */
  readonly rect: DOMRectReadOnly;
  /** its edge as it stands: at rest, or leaning as the pointer left it (its computed `clip-path`) */
  readonly clip: string;
  /** the window has drawn: the night steps aside (`data-lent`) */
  give(): void;
  /** the window is open again at its moment `t`: the night takes it back, drawn at once at that moment */
  takeBack(t: number): void;
  /** the window could not draw: the night carries on as it was */
  cancel(): void;
}

/** The night's core over `engine` on `box`, standing for SparkNight (James's star engine) and for a stand-in. */
export function startNight(engine: NightEngine, box: HTMLElement, shown = true): NightHandle {
  return new NightRest(engine, box, shown);
}

/** The night standing now that a window may borrow: shown, in sight, not lent already, and inside `within` when it is
 * named (the sheet's own container: the product's body, a catalog plate); null when there is none (Chat is not the
 * view, it holds a spark, or the window has no WebGL2). Lent, it is still until it is handed back. */
export function lendNight(within?: Node): NightLend | null {
  for (const night of standing) {
    if (within !== undefined && !within.contains(night.box)) continue;
    const lend = night.lend();
    if (lend !== null) return lend;
  }
  return null;
}

/** The engine on its canvas, or null where the window has no WebGL2. */
function openNight(
  star: StarSpark,
  canvas: HTMLCanvasElement,
  box: HTMLElement,
  shown: boolean,
): NightHandle | null {
  let engine: StarSparkEngine;
  try {
    engine = new star(canvas, { bloom: true, bloomStr: 0.45, max: 8, night: true });
  } catch {
    return null;
  }
  return startNight(engine, box, shown);
}

/** Every night standing now, for `lendNight`. */
const standing = new Set<NightRest>();

/** The night's engine and its one clock, drawn by the rest rule: frames only while its clock runs, its box is in sight
 * and its view is shown, and once more whenever it resizes. Lent to a window, it is still and draws nothing until it
 * is handed back. */
class NightRest implements NightHandle {
  #frame = 0;
  #last = 0;
  /** the night's own clock, in seconds: any moment of it (the engine's twinkle and haze read it) */
  #t = 3.1;
  #rate: number;
  #lastPointer: number;
  #inSight = true;
  #shown: boolean;
  #dirty = true;
  #lent = false;
  #closed = false;
  readonly #sight: IntersectionObserver | null;
  readonly #size: ResizeObserver | null;

  constructor(
    private readonly engine: NightEngine,
    readonly box: HTMLElement,
    shown: boolean,
  ) {
    this.#shown = shown;
    this.#rate = reducedMotion() ? 0 : 1;
    this.#lastPointer = performance.now();
    for (const kind of ["pointermove", "pointerdown", "wheel", "keydown"] as const)
      window.addEventListener(kind, this.#wake, { passive: true });
    this.#sight =
      typeof IntersectionObserver === "function"
        ? new IntersectionObserver((records) => {
            this.#inSight = records.some((record) => record.isIntersecting);
            this.#kick();
          })
        : null;
    this.#sight?.observe(box);
    this.#size =
      typeof ResizeObserver === "function"
        ? new ResizeObserver(() => {
            this.#dirty = true;
            this.#kick();
          })
        : null;
    this.#size?.observe(box);
    standing.add(this);
    this.#kick();
  }

  show(shown: boolean): void {
    this.#shown = shown;
    if (shown) this.#wake();
  }

  close(): void {
    this.#closed = true;
    standing.delete(this);
    cancelAnimationFrame(this.#frame);
    this.#frame = 0;
    for (const kind of ["pointermove", "pointerdown", "wheel", "keydown"] as const)
      window.removeEventListener(kind, this.#wake);
    this.#sight?.disconnect();
    this.#size?.disconnect();
    this.engine.clear();
  }

  /** Lend the night to a window, if it can be: shown, in sight, and not lent already. A lend outlived by its night
   * (Chat chose the spark just made, and its night went) does nothing. */
  lend(): NightLend | null {
    if (this.#closed || this.#lent || !this.#shown || !this.#inSight) return null;
    this.#lent = true;
    cancelAnimationFrame(this.#frame);
    this.#frame = 0;
    const box = this.box;
    const clip = typeof getComputedStyle === "function" ? getComputedStyle(box).clipPath : "";
    let open = true;
    const end = (): boolean => {
      if (!open) return false;
      open = false;
      this.#lent = false;
      delete box.dataset.lent;
      return true;
    };
    return {
      t: this.#t,
      rect: box.getBoundingClientRect(),
      clip,
      give: () => {
        if (open && !this.#closed) box.dataset.lent = "true";
      },
      takeBack: (t) => {
        if (!end() || this.#closed) return;
        this.#t = t;
        this.engine.render(t);
        this.#dirty = false;
        this.#wake();
      },
      cancel: () => {
        if (end() && !this.#closed) this.#wake();
      },
    };
  }

  readonly #wake = (): void => {
    this.#lastPointer = performance.now();
    this.#kick();
  };

  #kick(): void {
    if (this.#frame !== 0 || this.#lent || !this.#inSight || !this.#shown) return;
    this.#last = performance.now();
    this.#frame = requestAnimationFrame(this.#draw);
  }

  readonly #draw = (now: number): void => {
    this.#frame = 0;
    if (this.#lent) return;
    const dt = Math.min(0.05, Math.max(0, (now - this.#last) / 1000));
    this.#last = now;
    const target = nightRestTarget((now - this.#lastPointer) / 1000, reducedMotion());
    this.#rate = nightRestRate(this.#rate, target, dt);
    this.#t += dt * this.#rate;
    if (this.#rate > 0 || this.#dirty) {
      this.engine.render(this.#t);
      this.#dirty = false;
    }
    if (this.#rate > 0 && this.#inSight && this.#shown)
      this.#frame = requestAnimationFrame(this.#draw);
  };
}
