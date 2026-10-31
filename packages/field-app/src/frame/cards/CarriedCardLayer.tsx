import { type CSSProperties, type ReactElement, useEffect } from "react";
import { useReducedMotion } from "../../field/desk/bar/bar-motion";
import { followDeskCardTarget } from "../../field/desk/desk-card-target";
import { CardFace } from "./CardFace";
import {
  CARRIED_LAYER_CLASS,
  type CardBox,
  type CarriedCard,
  playTimings,
  SPRING_LOAD_MS,
  useCarriedCard,
} from "./card-drag";
import { CARD_H, CARD_W } from "./cards-model";
import "./carried.css";

// THE CARRIED CARD (track HN, HN-4; DESIGN.md §8 "The hand", where cards go): the one card a drag
// carries, drawn above the hand at the pointer, and what the places under it say. Controller-free
// (`CarriedCardView`, the catalog's), its controller beside it (`CarriedCardLayer`, which `Cards`
// mounts last). Nothing here takes the pointer: the layer is inert, whatever the card's own
// stylesheet says of the pointer, and the machine passes over it besides — so what is under the
// card is found by `elementsFromPoint`, past it.
//
// One card, two boxes. The outer is the ANCHOR, a point in window px. The inner is the card,
// turned and scaled about that point (transform-origin 0 0) — its turn on `transform`, its size on
// the `scale` property, so each keeps its own time: the lean 90ms (the page's), the duck over the
// line 160ms (§6). While carried, the anchor is the pointer and the card hangs from its grab point
// (M2), lifted to 1.06 and leaning with the pointer's speed. Let go, it shrinks into that point
// (200ms, the retract curve), its place's ring fading as it goes in (120ms). Home, it flies
// straight to its slot (440ms, the island curve): flights carry no turn (the page's law), so the
// hand's `home()` answers the slot at rest untilted, and the fan settles the card into its tilt
// once it is back. The anchor goes to the slot's pivot, the fan's own (the page's
// `transform-origin: 50% 125%`), so a slot that does name a turn is landed on exactly too. Anchor
// and card ease together: one motion, no jump. Reduced motion (M6): no travel — it fades out
// where it is let go while its place rings once, and fades in at its slot.

/** The fan's pivot in a card, card px — the page's `.card { transform-origin: 50% 125% }`. */
const PIVOT_X = CARD_W / 2;
const PIVOT_Y = CARD_H * 1.25;
/** Carried, the card is lifted (the page's `.card.drag`); over the line it ducks small so the
 * view's cell under it shows (HN-D6); let go, it shrinks into the point. */
const LIFT_SCALE = 1.06;
const DUCK_SCALE = 0.55;
const PLAYED_SCALE = 0.12;
/** The label stands this far above the card, and keeps clear of the window's edges. */
const LABEL_GAP = 10;
const LABEL_MIN_TOP = 34;
const LABEL_SIDE_CLEAR = 90;

/** The anchor's transform, and the card's about it: its turn and its hang (`transform`), and its
 * size apart (the `scale` property, applied before them both — a uniform size and a turn are the
 * same in either order). PURE. */
export function carriedTransforms(carried: CarriedCard): {
  readonly anchor: string;
  readonly card: string;
  readonly scale: number;
} {
  const home = carried.phase === "home" ? carried.home : null;
  if (home !== null) {
    const s = home.width / CARD_W;
    return {
      anchor: `translate3d(${home.left + PIVOT_X * s}px, ${home.top + PIVOT_Y * s}px, 0)`,
      card: `rotate(${home.rotate ?? 0}deg) translate(${-PIVOT_X}px, ${-PIVOT_Y}px)`,
      scale: s,
    };
  }
  const lifted = carried.ducked ? DUCK_SCALE : LIFT_SCALE;
  const { grab } = carried;
  return {
    anchor: `translate3d(${carried.x}px, ${carried.y}px, 0)`,
    card: `rotate(${carried.tilt}deg) translate(${-grab.x}px, ${-grab.y}px)`,
    scale: carried.phase === "carry" ? lifted : PLAYED_SCALE,
  };
}

/** What stands over the carried card: the answer above the card, or "Opening Godview" above the
 * cell it opens; its centre and its foot, window px. PURE. */
export function carriedLabel(
  carried: CarriedCard,
  viewport: { readonly width: number },
): { readonly text: string; readonly x: number; readonly y: number } | null {
  const answer = carried.answer;
  if (answer === null || carried.phase !== "carry") return null;
  const clampX = (x: number): number =>
    Math.max(LABEL_SIDE_CLEAR, Math.min(viewport.width - LABEL_SIDE_CLEAR, x));
  if (answer.kind === "cell") {
    const cell = carried.cell;
    return cell === null
      ? null
      : { text: answer.label, x: clampX(cell.left + cell.width / 2), y: cell.top - LABEL_GAP };
  }
  const s = carried.ducked ? DUCK_SCALE : LIFT_SCALE;
  return {
    text: answer.label,
    x: clampX(carried.x + (CARD_W / 2 - carried.grab.x) * s),
    y: Math.max(LABEL_MIN_TOP, carried.y - carried.grab.y * s - LABEL_GAP),
  };
}

const boxStyle = (box: CardBox, out = 0): CSSProperties => ({
  left: box.left - out,
  top: box.top - out,
  width: box.width + out * 2,
  height: box.height + out * 2,
});

export interface CarriedCardViewProps {
  /** the drag's state (`useCarriedCard`), or null: nothing carried, nothing drawn */
  readonly carried: CarriedCard | null;
  /** M6: no travel, fades, halved */
  readonly reducedMotion?: boolean;
  /** the window, for keeping the label inside it */
  readonly viewport: { readonly width: number };
}

export function CarriedCardView({
  carried,
  reducedMotion = false,
  viewport,
}: CarriedCardViewProps): ReactElement | null {
  if (carried === null) return null;
  const { shrinkMs, homeMs } = playTimings(reducedMotion);
  const moves = carriedTransforms(carried);
  const label = carriedLabel(carried, viewport);
  const timings = {
    "--vf-cards-carried-play-ms": `${shrinkMs}ms`,
    "--vf-cards-carried-home-ms": `${homeMs}ms`,
    "--vf-cards-carried-spring-ms": `${SPRING_LOAD_MS}ms`,
  } as CSSProperties;
  return (
    // inert: nothing under it is ever hit-tested, whatever the card's own stylesheet says of the
    // pointer — `elementsFromPoint` finds the place under the card, not the card
    <div className={CARRIED_LAYER_CLASS} aria-hidden="true" inert style={timings}>
      {carried.ring === null ? null : (
        <div
          className="vf-cards-carried-ring"
          data-phase={carried.phase}
          style={boxStyle(carried.ring)}
        />
      )}
      {carried.opening === null || carried.cell === null ? null : (
        <div
          key={`${carried.drag}:${carried.opening.view}`}
          className="vf-cards-carried-opening"
          style={
            {
              ...boxStyle(carried.cell, 3),
              "--vf-cards-carried-opening-from": `${-carried.opening.progress * SPRING_LOAD_MS}ms`,
            } as CSSProperties
          }
        />
      )}
      <div
        key={carried.drag}
        className="vf-cards-carried"
        data-phase={carried.phase}
        {...(carried.phase === "home" && carried.home === null ? { "data-homeless": "true" } : {})}
        style={{ transform: moves.anchor }}
      >
        <div
          className="vf-cards-carried-card"
          style={{ transform: moves.card, scale: `${moves.scale}` }}
        >
          <CardFace card={carried.card} />
        </div>
      </div>
      {label === null ? null : (
        <div className="vf-cards-carried-label" style={{ left: label.x, top: label.y }}>
          {label.text}
        </div>
      )}
    </div>
  );
}

/** The carried card's controller: the one drag's state, drawn. While the hand is here, the desk
 * takes a card on Canvas (`desk-card-target.ts`); Godview's deck registers its panes itself. */
export function CarriedCardLayer(): ReactElement | null {
  const carried = useCarriedCard();
  const reducedMotion = useReducedMotion();
  useEffect(() => followDeskCardTarget(), []);
  return (
    <CarriedCardView
      carried={carried}
      reducedMotion={reducedMotion}
      viewport={{ width: typeof window === "undefined" ? 0 : window.innerWidth }}
    />
  );
}
