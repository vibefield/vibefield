import {
  createContext,
  type ReactElement,
  type ReactNode,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import {
  loadSparklings,
  placeSparkBuddy,
  type SparkBuddy,
  type SparkEngine,
  type Sparklings,
  sparkBuddyOptions,
} from "./engine";
import type { SparkStatus } from "./statuses";
import { surfaceBehind } from "./surface";

// The stage (DESIGN.md §2.10, amended for SP-1a): live faces move on ONE layer per stage, never one
// over the window, which would draw a face over a menu or sheet that covers it. A composition that
// shows live faces — Chat's list, a thread's head, the New spark sheet — wraps them in a stage: one
// transparent canvas over it and under whatever covers it. Each face is clipped to the scrollport
// it sits in and dropped while out of sight, and the layer draws only while one of its faces is on
// screen. The stage is not the scroller: put the scroller inside it, so the layer stays over the
// stage while the faces scroll under it.

/** The most faces one stage moves; a face past them is a still. */
const STAGE_MAX = 64;

export interface LiveFace {
  readonly seed: number;
  readonly status: SparkStatus;
  readonly size: number;
  readonly framed: boolean;
}

export interface LiveFaceHandle {
  /** a new status: the face moves to it by the engine's own springs */
  feel(status: SparkStatus): void;
  leave(): void;
}

/** A stage's layer, for the faces inside it. */
export interface SparkStageLayer {
  join(element: HTMLElement, face: LiveFace): LiveFaceHandle | null;
}

/** undefined: no stage; "waiting": its engine is loading; "still": it cannot move faces. */
export type SparkStageState = SparkStageLayer | "waiting" | "still" | undefined;

const StageContext = createContext<SparkStageState>(undefined);

export function useSparkStage(): SparkStageState {
  return useContext(StageContext);
}

interface Mover {
  readonly buddy: SparkBuddy;
  readonly face: LiveFace;
  readonly port: Element;
  visible: boolean;
}

/** The nearest ancestor that scrolls or clips, up to the stage: a face is cut where it is. */
function scrollportOf(element: HTMLElement, stage: HTMLElement): Element {
  for (let at = element.parentElement; at && at !== stage; at = at.parentElement) {
    const { overflowX, overflowY } = getComputedStyle(at);
    if (overflowX !== "visible" || overflowY !== "visible") return at;
  }
  return stage;
}

class StageLayer implements SparkStageLayer {
  readonly #movers = new Map<HTMLElement, Mover>();
  readonly #seen: IntersectionObserver;
  readonly #sized: ResizeObserver;
  #frame = 0;

  private constructor(
    private readonly engines: Sparklings,
    private readonly engine: SparkEngine,
    private readonly stage: HTMLElement,
    private readonly canvas: HTMLCanvasElement,
  ) {
    this.#seen = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        const mover = this.#movers.get(entry.target as HTMLElement);
        if (mover) mover.visible = entry.isIntersecting;
      }
      this.#wake();
    });
    this.#sized = new ResizeObserver(() => this.engine.resize());
    this.#sized.observe(stage);
  }

  /** The stage's layer, or null where the window has no WebGL2. */
  static open(
    engines: Sparklings,
    stage: HTMLElement,
    canvas: HTMLCanvasElement,
  ): StageLayer | null {
    try {
      return new StageLayer(engines, new engines.Engine(canvas, { max: STAGE_MAX }), stage, canvas);
    } catch {
      return null;
    }
  }

  join(element: HTMLElement, face: LiveFace): LiveFaceHandle | null {
    if (this.#movers.size >= STAGE_MAX || this.#movers.has(element)) return null;
    const buddy = this.engine.add(
      new this.engines.Buddy(sparkBuddyOptions(this.engines, face, surfaceBehind(element))),
    );
    buddy.hidden = true;
    const mover: Mover = { buddy, face, port: scrollportOf(element, this.stage), visible: false };
    this.#movers.set(element, mover);
    this.#seen.observe(element);
    return {
      feel: (status) => {
        buddy.rest = status;
        buddy.feel(status);
        this.#wake();
      },
      leave: () => {
        this.#seen.unobserve(element);
        this.#movers.delete(element);
        this.engine.remove(buddy);
        this.#wake();
      },
    };
  }

  close(): void {
    cancelAnimationFrame(this.#frame);
    this.#frame = 0;
    this.#seen.disconnect();
    this.#sized.disconnect();
    this.#movers.clear();
    this.engine.clear();
  }

  #wake(): void {
    if (this.#frame === 0) this.#frame = requestAnimationFrame(this.#draw);
  }

  readonly #draw = (now: number): void => {
    this.#frame = 0;
    const origin = this.canvas.getBoundingClientRect();
    let onScreen = 0;
    for (const [element, mover] of this.#movers) {
      mover.buddy.hidden = !mover.visible;
      if (!mover.visible) continue;
      onScreen += 1;
      const box = element.getBoundingClientRect();
      const port = mover.port.getBoundingClientRect();
      placeSparkBuddy(
        mover.buddy,
        box.left - origin.left + box.width / 2,
        box.top - origin.top + box.height / 2,
        mover.face.size,
        mover.face.framed,
      );
      mover.buddy.clip = [
        port.left - origin.left,
        port.top - origin.top,
        port.right - origin.left,
        port.bottom - origin.top,
      ];
      // a selected row, a theme that turned: the cut ring takes the ground where the face is now
      mover.buddy.cut = surfaceBehind(element);
    }
    this.engine.render(now / 1000);
    if (onScreen > 0) this.#frame = requestAnimationFrame(this.#draw);
  };
}

export interface SparkStageProps {
  children: ReactNode;
  className?: string | undefined;
}

export function SparkStage({ children, className }: SparkStageProps): ReactElement {
  const stage = useRef<HTMLDivElement>(null);
  const layer = useRef<HTMLCanvasElement>(null);
  const [state, setState] = useState<SparkStageState>("waiting");
  useEffect(() => {
    let open = true;
    let made: StageLayer | null = null;
    loadSparklings().then(
      (engines) => {
        if (!open || !stage.current || !layer.current) return;
        made = StageLayer.open(engines, stage.current, layer.current);
        setState(made ?? "still");
      },
      () => {
        if (open) setState("still");
      },
    );
    return () => {
      open = false;
      made?.close();
    };
  }, []);
  return (
    <div ref={stage} className={className ? `vf-spark-stage ${className}` : "vf-spark-stage"}>
      <StageContext.Provider value={state}>{children}</StageContext.Provider>
      <canvas ref={layer} className="vf-spark-stage-layer" />
    </div>
  );
}
