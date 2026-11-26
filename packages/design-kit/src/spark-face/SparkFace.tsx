import {
  type CSSProperties,
  createContext,
  type ReactElement,
  type ReactNode,
  useContext,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { loadSparklings, type Sparklings, type SparkRgb } from "./engine";
import { flatStarFigure } from "./picture";
import { type LiveFaceHandle, useSparkStage } from "./stage";
import type { SparkStatus } from "./statuses";
import { drawStill, FREE_FACE_ROOM } from "./stills";
import { surfaceBehind, useThemeTurns } from "./surface";
import "./spark-face.css";

// A spark's face (DESIGN.md §2.10; the compose plane, version 2) — the ONE drawing of a spark, for
// every surface that shows one: Chat's list, a thread, @'s menu, the New spark sheet. It wears one
// face from James's star set, dealt once and kept by its seed (S-1); its colour is its palette's and
// stays inside the face (S-2). The face expresses and the word certifies (S-3): this draws the face,
// and the composition sets the status's word beside it, or hands it here as the accessible name.
//
// A face that is not moving is a still, drawn once and kept; a live face moves on its stage's layer
// (./stage.tsx). Without WebGL2 a face is the flat star — never a blank.

/** "flat": the faces inside draw as the flat star — the face's one adapter, for the catalog's flat
 * specimen and the tests. The product never sets it. */
export type SparkFaceRendering = "auto" | "flat";

const RenderingContext = createContext<SparkFaceRendering>("auto");

export function SparkFaceRenderer({
  renderer,
  children,
}: {
  renderer: SparkFaceRendering;
  children: ReactNode;
}): ReactElement {
  return <RenderingContext.Provider value={renderer}>{children}</RenderingContext.Provider>;
}

let loaded: Sparklings | undefined;

/** The engine once it is here: null while it loads, "failed" when it cannot. */
function useSparklings(): Sparklings | "failed" | null {
  const [engines, setEngines] = useState<Sparklings | "failed" | null>(() => loaded ?? null);
  useEffect(() => {
    if (engines !== null) return;
    let mounted = true;
    loadSparklings().then(
      (found) => {
        loaded = found;
        if (mounted) setEngines(found);
      },
      () => {
        if (mounted) setEngines("failed");
      },
    );
    return () => {
      mounted = false;
    };
  }, [engines]);
  return engines;
}

const sameRgb = (a: SparkRgb | null, b: SparkRgb): boolean =>
  a !== null && a[0] === b[0] && a[1] === b[1] && a[2] === b[2];

export interface SparkFaceProps {
  /** its seed (`SparkFace.seed` on the spark's record) */
  seed: number;
  status: SparkStatus;
  /** its box in px (DESIGN.md §2.10's table of surfaces) */
  size: number;
  /** on its disc — the default — or free */
  framed?: boolean | undefined;
  /** moves (blinks, gaze, its status's motion) inside a SparkStage; elsewhere it is a still */
  live?: boolean | undefined;
  /** the accessible name where no words sit beside it; without it the face is decorative */
  label?: string | undefined;
  /** whether its STILL wears its props; absent, the engine's own way (free with them, on its disc without). A live
   * face on a SparkStage is the stage's, which this does not reach. The desk's at-work star, always a still here, sets
   * it by its switch (item 550, 2026-11-18; DESIGN.md §2.10) */
  props?: boolean | undefined;
  className?: string | undefined;
}

export function SparkFace({
  seed,
  status,
  size,
  framed = true,
  live = false,
  label,
  props,
  className,
}: SparkFaceProps): ReactElement {
  const box = useRef<HTMLSpanElement>(null);
  const rendering = useContext(RenderingContext);
  const stage = useSparkStage();
  const engines = useSparklings();
  useThemeTurns();

  // the ground behind the face, read where it sits after every render: a selected row, a turned theme
  const [cut, setCut] = useState<SparkRgb | null>(null);
  useLayoutEffect(() => {
    const ground = surfaceBehind(box.current);
    setCut((held) => (sameRgb(held, ground) ? held : ground));
  });

  // live on a stage that moves faces: the layer draws it, and this box only holds its place
  const [moving, setMoving] = useState(false);
  const handle = useRef<LiveFaceHandle | null>(null);
  // a new status moves the face it has, by the engine's springs; a new seed, size or frame is a new face
  const statusNow = useRef(status);
  useLayoutEffect(() => {
    statusNow.current = status;
    handle.current?.feel(status);
  }, [status]);
  const joins = live && rendering === "auto" && typeof stage === "object";
  useLayoutEffect(() => {
    if (!joins || typeof stage !== "object" || !box.current) return;
    const joined = stage.join(box.current, { seed, status: statusNow.current, size, framed });
    handle.current = joined;
    setMoving(joined !== null);
    return () => {
      joined?.leave();
      handle.current = null;
      setMoving(false);
    };
  }, [joins, stage, seed, size, framed]);

  // a still: drawn once and kept, or null where the window has no WebGL2 (the flat star)
  const [picture, setPicture] = useState<string | null | undefined>(undefined);
  const stills =
    rendering === "auto" &&
    !moving &&
    !(live && stage === "waiting") &&
    typeof engines === "object";
  useLayoutEffect(() => {
    if (!stills || engines === null || cut === null) return;
    setPicture(drawStill(engines, { seed, status, size, framed, cut, props }));
  }, [stills, engines, seed, status, size, framed, cut, props]);

  const flat =
    typeof engines === "object" &&
    engines !== null &&
    (rendering === "flat" || (stills && picture === null));
  const drawn = moving ? "stage" : flat ? "flat" : stills && picture ? "still" : "waiting";

  return (
    <span
      ref={box}
      className={className ? `vf-spark-face ${className}` : "vf-spark-face"}
      data-framed={framed ? "true" : "false"}
      data-drawn={drawn}
      style={
        {
          "--vf-spark-face-size": `${size}px`,
          "--vf-spark-face-room": FREE_FACE_ROOM,
        } as CSSProperties
      }
      {...(label ? { role: "img", "aria-label": label } : { "aria-hidden": true })}
    >
      {drawn === "still" && picture ? (
        <img className="vf-spark-face-picture" src={picture} alt="" draggable={false} />
      ) : null}
      {drawn === "flat" && typeof engines === "object" && engines !== null ? (
        <FlatStarView engines={engines} seed={seed} size={size} framed={framed} />
      ) : null}
    </span>
  );
}

function FlatStarView({
  engines,
  seed,
  size,
  framed,
}: {
  engines: Sparklings;
  seed: number;
  size: number;
  framed: boolean;
}): ReactElement | null {
  // an id an SVG url() takes as it is
  const id = `vf-spark-${useId().replace(/[^\w-]/gu, "")}`;
  // one drawing for the face here and for its picture (`picture.ts`)
  const figure = flatStarFigure(engines, { seed, size, framed });
  if (!figure) return null;
  const [glowCentre, glowMid, glowRim] = figure.glow;
  const [discTop, discBottom] = figure.deep;
  const { x, y, side } = figure.box;
  return (
    <svg
      className="vf-spark-face-flat"
      viewBox={`${x} ${y} ${side} ${side}`}
      aria-hidden="true"
      focusable="false"
    >
      <defs>
        <radialGradient id={`${id}-body`}>
          <stop offset="0" stopColor={glowCentre} />
          <stop offset="0.55" stopColor={glowMid} />
          <stop offset="1" stopColor={glowRim} />
        </radialGradient>
        <linearGradient id={`${id}-disc`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor={discTop} />
          <stop offset="1" stopColor={discBottom} />
        </linearGradient>
      </defs>
      {figure.disc ? (
        <circle
          className="vf-spark-face-disc"
          cx="0"
          cy={figure.disc.cy}
          r={figure.disc.r}
          fill={`url(#${id}-disc)`}
        />
      ) : null}
      <path className="vf-spark-face-star" d={figure.outline} fill={`url(#${id}-body)`} />
      {figure.eyes.map((eye) => (
        <rect
          key={eye.x}
          className="vf-spark-face-eye"
          x={eye.x}
          y={eye.y}
          width={eye.width}
          height={eye.height}
          rx={eye.width / 2}
          fill={glowRim}
        />
      ))}
    </svg>
  );
}
