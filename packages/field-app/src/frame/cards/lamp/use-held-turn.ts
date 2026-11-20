import {
  type PointerEvent as ReactPointerEvent,
  type RefObject,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { usePrintLight } from "../press/print-light";
import { type Lamp, type LampSpec, lightLamp } from "./lamp";
import {
  frameOf,
  lampOn,
  NO_TURN,
  type Point,
  stepTurn,
  TURN_STILL,
  type Turn,
  type TurnSpring,
  turnAtRest,
  turnToward,
} from "./turn";

/**
 * A card picked up turns toward the pointer, and the lamp lights it as it turns (DESIGN.md §8 "Picking one up"; §6
 * "The hand", the turn; §5 "The lamp, live"; item 596, 2026-11-19). The held layer's own, presentation only: it hears
 * the pointer over the layer, walks the turn on its spring a frame at a time, and each frame writes three numbers on
 * the turn's element (the turn about the card's level and its upright, and how brightly the lamp lights the side that
 * is up, which the stylesheet reads) and has that side's lamp draw. It asks for a frame only while the turn moves or
 * the card is turning over; a card at rest costs nothing. Under reduced motion (M6) the card stands flat on its print.
 */

/** The turn's three numbers, as the stylesheet reads them. */
export const TURN_PROPS = {
  x: "--vf-cards-turn-x",
  y: "--vf-cards-turn-y",
  lamp: "--vf-cards-lamp",
} as const;

/** Flip it's turn, and a frame or two (cards.css: 480ms on the island curve): while it runs, the card's angle about
 * its upright is read from the flip's own element, so the lamp crosses the card as it turns over. */
const FLIP_SETTLE_MS = 560;

export interface HeldTurnProps {
  /** the card is up: it answers the pointer (home and gone, it straightens) */
  readonly up: boolean;
  /** its back is up */
  readonly back: boolean;
  /** M6: no turn, and no lamp */
  readonly reducedMotion: boolean;
  /** the layer's size, as the hand lays it out */
  readonly layer: { readonly width: number; readonly height: number };
  /** the card's middle in the layer */
  readonly middle: Point;
  /** the card wears the print (the agent's dark card does not): a lamp has something to light */
  readonly printed: boolean;
  /** the front's window holds a picture */
  readonly photo: boolean;
  /** device px a design unit, for the lamps' surfaces: the held print's own */
  readonly density: number;
  /** a still's pose: the catalog stands a card at a turn; the product never sets it */
  readonly pose?: Turn | undefined;
}

export interface HeldTurn {
  readonly turnRef: RefObject<HTMLDivElement | null>;
  readonly flipRef: RefObject<HTMLDivElement | null>;
  /** where each side's lamp stands: the layer makes the lamp's own surface inside it, and takes it away with the lamp */
  readonly frontLampRef: RefObject<HTMLElement | null>;
  readonly backLampRef: RefObject<HTMLElement | null>;
  /** the lamps are wanted: the front's while the card is held, the back's once it has been turned over */
  readonly frontLamp: boolean;
  readonly backLamp: boolean;
  /** a lamp is lit over the card: the stock's own still gloss steps aside */
  readonly lit: boolean;
  readonly onPointerMove: (event: ReactPointerEvent<HTMLElement>) => void;
  readonly onPointerLeave: () => void;
}

/** The flip's angle about the card's upright now, radians: read from its element while it turns, else where it
 * stands. */
function flipAngle(el: HTMLElement | null, back: boolean): number {
  const settled = back ? Math.PI : 0;
  if (
    el === null ||
    typeof getComputedStyle !== "function" ||
    typeof DOMMatrixReadOnly !== "function"
  )
    return settled;
  const transform = getComputedStyle(el).transform;
  if (transform === "" || transform === "none") return 0;
  try {
    const m = new DOMMatrixReadOnly(transform);
    return Math.atan2(m.m31, m.m11);
  } catch {
    return settled;
  }
}

/** A lamp lit in `host`, on a surface of its own made here and taken away with it: a lamp let go and lit again (a
 * development twin's second mount) is a new surface, never one whose context has gone. */
function lampIn(host: HTMLElement, spec: LampSpec): { lamp: Lamp | null; away: () => void } {
  const canvas = host.ownerDocument.createElement("canvas");
  host.appendChild(canvas);
  const lamp = lightLamp(canvas, spec);
  if (lamp === null) canvas.remove();
  return {
    lamp,
    away: () => {
      lamp?.release();
      canvas.remove();
    },
  };
}

export function useHeldTurn(props: HeldTurnProps): HeldTurn {
  const { up, back, reducedMotion, layer, middle, printed, photo, density, pose } = props;
  const light = usePrintLight();
  const turnRef = useRef<HTMLDivElement | null>(null);
  const flipRef = useRef<HTMLDivElement | null>(null);
  const frontLampRef = useRef<HTMLElement | null>(null);
  const backLampRef = useRef<HTMLElement | null>(null);
  const lamps = useRef<{ front: Lamp | null; back: Lamp | null }>({ front: null, back: null });
  const spring = useRef<TurnSpring>(TURN_STILL);
  const target = useRef<Turn>(NO_TURN);
  const frameId = useRef(0);
  const last = useRef(0);
  const flipUntil = useRef(0);
  // what a frame reads, as it stands now
  const now = useRef({ back, night: light.night });
  now.current = { back, night: light.night };

  const wanted = printed && light.printed && !reducedMotion;
  const [turned, setTurned] = useState(false);
  useEffect(() => {
    if (back) setTurned(true);
  }, [back]);
  const [lit, setLit] = useState(false);

  /** The turn drawn: its three numbers on the turn's element, and the lamp of the side that is up. */
  const paint = useCallback((turn: Turn, about: number): void => {
    const el = turnRef.current;
    if (el === null) return;
    const front = frameOf(turn, about);
    const frontUp = (front[8] ?? 1) >= 0;
    const side = frontUp ? front : frameOf(turn, about + Math.PI);
    const normal = [side[6] ?? 0, side[7] ?? 0, side[8] ?? 1] as const;
    el.style.setProperty(TURN_PROPS.x, turn.x.toFixed(4));
    el.style.setProperty(TURN_PROPS.y, turn.y.toFixed(4));
    el.style.setProperty(TURN_PROPS.lamp, lampOn(normal, now.current.night).toFixed(4));
    const lamp = frontUp ? lamps.current.front : lamps.current.back;
    // head on and flat, the print is that light already: the lamp draws nothing
    if (turn.x === 0 && turn.y === 0 && Math.abs(Math.sin(about)) < 1e-6) lamp?.clear();
    else lamp?.draw(side);
  }, []);

  const frame = useCallback(
    (at: number): void => {
      frameId.current = 0;
      const dt = last.current === 0 ? 1 / 60 : (at - last.current) / 1000;
      last.current = at;
      const to = target.current;
      spring.current = stepTurn(spring.current, to, dt);
      const flipping = at < flipUntil.current;
      const still = !flipping && turnAtRest(spring.current, to);
      if (still) spring.current = { at: to, speed: NO_TURN };
      const about = flipping
        ? flipAngle(flipRef.current, now.current.back)
        : now.current.back
          ? Math.PI
          : 0;
      paint(spring.current.at, about);
      if (still) last.current = 0;
      else frameId.current = requestAnimationFrame(frame);
    },
    [paint],
  );

  /** Ask for a frame, if none is asked for. */
  const wake = useCallback((): void => {
    if (frameId.current === 0 && typeof requestAnimationFrame === "function")
      frameId.current = requestAnimationFrame(frame);
  }, [frame]);

  useEffect(
    () => () => {
      if (frameId.current !== 0) cancelAnimationFrame(frameId.current);
      frameId.current = 0;
    },
    [],
  );

  // a still's pose stands at once, with no spring; put back, removed or under reduced motion the card straightens
  useLayoutEffect(() => {
    if (pose !== undefined) {
      target.current = pose;
      spring.current = { at: pose, speed: NO_TURN };
      paint(pose, back ? Math.PI : 0);
      return;
    }
    if (!up || reducedMotion) {
      target.current = NO_TURN;
      if (reducedMotion) {
        spring.current = TURN_STILL;
        paint(NO_TURN, back ? Math.PI : 0);
      } else wake();
    }
  }, [pose, up, reducedMotion, back, paint, wake]);

  // turned over: the flip's own turn runs in the stylesheet; the frames follow it while it runs
  const side = useRef(back);
  useEffect(() => {
    if (side.current === back) return;
    side.current = back;
    if (reducedMotion) return;
    flipUntil.current = performance.now() + FLIP_SETTLE_MS;
    wake();
  }, [back, reducedMotion, wake]);

  // the lamps: the front's while the card is held, the back's once it has been turned over; each let go with the card
  useEffect(() => {
    if (!wanted) return;
    const host = frontLampRef.current;
    if (host === null) return;
    const { lamp, away } = lampIn(host, { side: "front", density, night: light.night, photo });
    lamps.current.front = lamp;
    setLit(lamp !== null);
    paint(spring.current.at, now.current.back ? Math.PI : 0);
    return () => {
      away();
      lamps.current.front = null;
      setLit(false);
    };
  }, [wanted, density, light.night, photo, paint]);

  useEffect(() => {
    if (!wanted || !turned) return;
    const host = backLampRef.current;
    if (host === null) return;
    const { lamp, away } = lampIn(host, {
      side: "back",
      density,
      night: light.night,
      photo: false,
    });
    lamps.current.back = lamp;
    paint(spring.current.at, now.current.back ? Math.PI : 0);
    wake();
    return () => {
      away();
      lamps.current.back = null;
    };
  }, [wanted, turned, density, light.night, paint, wake]);

  const onPointerMove = useCallback(
    (event: ReactPointerEvent<HTMLElement>): void => {
      if (!up || reducedMotion || pose !== undefined) return;
      const box = event.currentTarget.getBoundingClientRect();
      if (box.width <= 0 || box.height <= 0) return;
      // the layer may be drawn smaller than it is laid out (a catalog plate): the pointer in the layout's own units
      const pointer = {
        x: ((event.clientX - box.left) / box.width) * layer.width,
        y: ((event.clientY - box.top) / box.height) * layer.height,
      };
      target.current = turnToward(pointer, middle, { x: layer.width / 2, y: layer.height / 2 });
      wake();
    },
    [up, reducedMotion, pose, layer.width, layer.height, middle, wake],
  );

  const onPointerLeave = useCallback((): void => {
    if (pose !== undefined) return;
    target.current = NO_TURN;
    wake();
  }, [pose, wake]);

  return {
    turnRef,
    flipRef,
    frontLampRef,
    backLampRef,
    frontLamp: wanted,
    backLamp: wanted && turned,
    lit,
    onPointerMove,
    onPointerLeave,
  };
}
