import {
  type CSSProperties,
  type ReactElement,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type RefObject,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { CardFace } from "./CardFace";
import { DEAL_SETTLE_MS, dealStart, settle, whenVisible } from "./card-flight";
import {
  CARD_H,
  CARD_LIFT,
  CARD_PEEK,
  CARD_W,
  type Card,
  type CardLayout,
  type CardSlot,
  type CardWindow,
} from "./cards-model";
import type { DealFrom } from "./cards-store";
import { cardName, HAND_WORDS, OUTCOME_WORDS, provenance } from "./cards-words";
import "./cards.css";

/**
 * The fan (track HN; DESIGN.md §8 "The hand", Holding them; §6) — the hand drawn from props: each
 * card at its slot (`layoutCards` at rest, `layoutRaised` raised), lifted by the reach, turned by
 * the fan and straightened as it rises; the card the reach brings forward with its × and, above
 * it, where it came from; the raised hand's keyboard card; a deal flying in from its source's box
 * (or rising from the window's foot); a card leaving past the foot; and the card picked up, at
 * reading size over the window out of focus, with the bar under the head. Controller-free
 * (docs/UI_SYSTEM.md): `Cards.tsx` feeds it from the store and the pointer, the catalog from
 * fixtures. What it keeps is presentation only: which deals have been let fly, and whether the
 * held card has left its place yet.
 *
 * For a reader (R-D 11): the fan is "Your hand"; raised, it is a list whose options are the cards,
 * each named by its name and where it came from, walked by `aria-activedescendant` (the controller
 * gives the root the keyboard); a card picked up is a modal dialog named by the card, its keys
 * going no further than it. Where the keyboard goes is the controller's (`fanRef`, `heldRef`).
 */

/** How far a card rises when a paste was already it (HN-D10). */
export const NUDGE_RISE = 12;
/** A label stands this far above the top of the card it speaks for: its 24 and a gap of 8. */
const LABEL_ABOVE = 32;
/** A leaving card goes this far past the window's foot. */
export const LEAVE_PAST = 24;
/** A reduced-motion deal is a fade at its place: its length and a frame or two. */
const FADE_SETTLE_MS = 160;
/** The held card: reading size, in the reading fit the desk keeps for a held object (DESIGN.md §8
 * "Tools in hand": 116 under the window's top, 100 over its foot). */
export const HELD_SCALE = 2.6;
const HELD_TOP = 116;
const HELD_FOOT = 100;

export interface HeldCard {
  readonly card: Card;
  /** up: at reading size over the scrim · home: back into its place after a 140ms lead · gone:
   * removed, shrinking where it stands */
  readonly phase: "up" | "home" | "gone";
}

export interface LeavingCard {
  readonly card: Card;
  /** where it stood when it left */
  readonly slot: CardSlot;
  /** its place in the hand's order when it left: it leaves from among the others */
  readonly index: number;
}

export interface CardsViewProps {
  /** left → right, oldest → newest */
  readonly cards: readonly Card[];
  /** where each card stands: `layoutCards` at rest, `layoutRaised` raised */
  readonly layout: CardLayout;
  /** each card's reach, 0…1 (`reachLift`) */
  readonly lifts: readonly number[];
  /** the card the reach brings forward, or -1 */
  readonly reached: number;
  readonly raised: boolean;
  /** the raised hand's keyboard card, or -1 */
  readonly focus: number;
  /** the card picked up: drawn by the held layer, its place in the fan kept */
  readonly held: HeldCard | null;
  /** cards dealt and not yet landed, each with the box it leaves from (null: from its place) */
  readonly arriving: ReadonlyMap<string, DealFrom | null>;
  /** the card a drag carries: its place kept, the carried layer draws it */
  readonly carried: string | null;
  /** the card a paste of the same thing lifted (HN-D10) */
  readonly nudged: string | null;
  /** the twin settling back after its lift, on the retract curve */
  readonly settling?: string | null;
  /** cards on their way out past the foot */
  readonly leaving?: readonly LeavingCard[];
  /** the pegboard is out behind the line: the hand steps down out of its way */
  readonly tucked?: boolean;
  /** epoch ms, for the provenance's "2m ago" */
  readonly now: number;
  readonly reducedMotion: boolean;
  /** the window: where the held card's middle is, and where the foot is */
  readonly win: CardWindow;
  readonly onRemove?: (id: string) => void;
  readonly onPress?: (id: string, event: ReactPointerEvent<HTMLElement>) => void;
  readonly onLanded?: (id: string) => void;
  readonly onPutBack?: () => void;
  readonly onRemoveHeld?: () => void;
  /** the fan's root and the held card's layer, for the controller that moves the keyboard into
   * them (the raised hand's list, the held card's Done) and keeps Tab inside the held card's bar */
  readonly fanRef?: RefObject<HTMLDivElement | null>;
  readonly heldRef?: RefObject<HTMLDivElement | null>;
}

type Phase = "rest" | "from" | "deal" | "leaving" | "hidden";

interface Placement {
  readonly phase: Phase;
  readonly x: number;
  readonly y: number;
  /** turn, degrees */
  readonly r: number;
  readonly s: number;
  /** lift, 0…1: its shadow */
  readonly lp: number;
  readonly o: number;
  readonly z: number;
}

/** A card standing straight and still, its own size, unlifted, seen. */
const STILL = { r: 0, s: 1, lp: 0, o: 1 } as const;

interface Row {
  readonly card: Card;
  /** its index in `cards`; -1 for a card leaving */
  readonly index: number;
  readonly leaving: LeavingCard | null;
}

/** The cards in their order, each leaving card at the place it held — so no card's element is
 * moved under it while it travels. PURE. */
function rowsOf(cards: readonly Card[], leaving: readonly LeavingCard[]): Row[] {
  const rows: Row[] = cards.map((card, index) => ({ card, index, leaving: null }));
  for (const gone of leaving) {
    if (rows.some((row) => row.card.id === gone.card.id)) continue;
    const row: Row = { card: gone.card, index: -1, leaving: gone };
    rows.splice(Math.min(gone.index, rows.length), 0, row);
  }
  return rows;
}

const round = (n: number, places: number): number => {
  const k = 10 ** places;
  return Math.round(n * k) / k;
};

/** The held card's middle: centred across the window and in the reading fit, at reading size
 * (smaller only where the window is too short for 2.6). PURE. */
export function heldCentre(win: CardWindow): { x: number; y: number; s: number } {
  const room = win.height - HELD_TOP - HELD_FOOT;
  const s = Math.max(1, Math.min(HELD_SCALE, room / CARD_H, (win.width - 32) / CARD_W));
  return { x: win.width / 2 - CARD_W / 2, y: HELD_TOP + room / 2 - CARD_H / 2, s };
}

interface Label {
  readonly text: string;
  readonly x: number;
  readonly y: number;
}

/** What the fan says above itself, and where: a lifted twin's "Already in your hand", the reached
 * card's provenance, the raised hand's keyboard card's, or the empty hand's words. PURE. */
export function labelOf(props: CardsViewProps): Label | null {
  const { cards, layout, raised, focus, reached, nudged, now, win } = props;
  const over = (index: number, rise: number, text: string): Label | null => {
    const slot = layout.slots[index];
    return slot === undefined ? null : { text, x: slot.x + CARD_W / 2, y: slot.y - rise };
  };
  const twin = nudged === null ? -1 : cards.findIndex((card) => card.id === nudged);
  if (twin >= 0) return over(twin, NUDGE_RISE + LABEL_ABOVE, OUTCOME_WORDS.already);
  const card = cards[raised ? focus : reached];
  if (card !== undefined && !raised && reached >= 0) {
    return over(reached, CARD_LIFT + LABEL_ABOVE, provenance(card, now));
  }
  if (card !== undefined && raised) return over(focus, LABEL_ABOVE, provenance(card, now));
  if (raised && cards.length === 0) {
    const x = (layout.left + layout.right) / 2;
    return { text: HAND_WORDS.empty, x, y: win.height - CARD_PEEK - LABEL_ABOVE };
  }
  return null;
}

/**
 * The deals in flight. Each arriving card is drawn where it leaves from until that start is
 * committed by a forced reflow and the window can be seen; then it is let fly, and it lands on a
 * timer of the flight's length — never only on a transitionend, which a hidden window may not
 * send (M3).
 */
function useFlying(
  arriving: ReadonlyMap<string, DealFrom | null>,
  fan: RefObject<HTMLDivElement | null>,
  settleMs: number,
  onLanded: ((id: string) => void) | undefined,
): ReadonlySet<string> {
  const [flying, setFlying] = useState<ReadonlySet<string>>(() => new Set());
  const seen = useRef(new Set<string>());
  const timers = useRef(new Map<string, number>());
  const alive = useRef(true);
  const landed = useRef(onLanded);
  landed.current = onLanded;

  useEffect(() => {
    alive.current = true;
    const pending = timers.current;
    return () => {
      alive.current = false;
      for (const timer of pending.values()) window.clearTimeout(timer);
      pending.clear();
    };
  }, []);

  useLayoutEffect(() => {
    for (const id of seen.current) if (!arriving.has(id)) seen.current.delete(id);
    const fresh = [...arriving.keys()].filter((id) => !seen.current.has(id));
    if (fresh.length === 0) return;
    for (const id of fresh) seen.current.add(id);
    settle(fan.current);
    void whenVisible(document).then(() => {
      if (!alive.current) return;
      settle(fan.current);
      setFlying((before) => new Set([...before, ...fresh]));
    });
  }, [arriving, fan]);

  useEffect(() => {
    for (const id of flying) {
      if (!arriving.has(id) || timers.current.has(id)) continue;
      const timer = window.setTimeout(() => {
        timers.current.delete(id);
        landed.current?.(id);
      }, settleMs);
      timers.current.set(id, timer);
    }
  }, [arriving, flying, settleMs]);

  return flying;
}

export function CardsView(props: CardsViewProps): ReactElement {
  const { cards, layout, lifts, reached, raised, focus, held, arriving, carried, nudged } = props;
  const { win, reducedMotion } = props;
  const own = useRef<HTMLDivElement | null>(null);
  const fan = props.fanRef ?? own;
  const settleMs = reducedMotion ? FADE_SETTLE_MS : DEAL_SETTLE_MS;
  const flying = useFlying(arriving, fan, settleMs, props.onLanded);
  const ids = useId();
  const optionId = (card: Card): string => `${ids}-card-${card.id}`;

  const place = (row: Row): Placement | null => {
    const { card } = row;
    if (row.leaving !== null) {
      const { slot } = row.leaving;
      // down past the foot, back the way it would have come (M4); a fade where it stood (M6)
      const y = reducedMotion ? slot.y : win.height + LEAVE_PAST;
      const o = reducedMotion ? 0 : 1;
      return { ...STILL, phase: "leaving", x: slot.x, y, r: slot.r, o, z: 5 };
    }
    const slot = layout.slots[row.index];
    if (slot === undefined) return null;
    if (held?.card.id === card.id || carried === card.id) {
      // its place kept and its turn held at 0, so it settles into the fan's tilt once it is home
      return { ...STILL, phase: "hidden", x: slot.x, y: slot.y, z: 10 + row.index };
    }
    if (arriving.has(card.id)) {
      if (flying.has(card.id)) return { ...STILL, phase: "deal", x: slot.x, y: slot.y, z: 150 };
      const from = arriving.get(card.id) ?? null;
      if (reducedMotion) {
        // M6: nothing travels — it fades in where it will stand
        return { ...STILL, phase: "from", x: slot.x, y: slot.y, o: 0, z: 150 };
      }
      if (from === null) {
        // nowhere to leave from (a snapshot of a region off the window): it rises into its place
        // from past the window's foot — as far past as a leaving card goes — on the deal's curves
        return { ...STILL, phase: "from", x: slot.x, y: win.height + LEAVE_PAST, lp: 1, z: 150 };
      }
      const { x, y, scale, turn } = dealStart(from);
      return { phase: "from", x, y, r: turn, s: scale, lp: 1, o: 1, z: 150 };
    }
    const lift = raised ? 0 : Math.max(0, Math.min(1, lifts[row.index] ?? 0));
    const rise = nudged === card.id ? NUDGE_RISE : 0;
    const front = raised && row.index === focus ? 60 : 0;
    return {
      phase: "rest",
      x: slot.x,
      y: slot.y - lift * CARD_LIFT - rise,
      r: slot.r * (1 - lift),
      s: 1,
      lp: raised ? 1 : lift,
      o: 1,
      z: 10 + row.index + Math.round(lift * 50) + front,
    };
  };

  const label = labelOf(props);
  const heldIndex = held === null ? -1 : cards.findIndex((card) => card.id === held.card.id);
  const focused = raised ? cards[focus] : undefined;
  // the fan's name at rest; raised, a list the keyboard walks by its active descendant
  const named = raised
    ? {
        role: "listbox",
        "aria-label": HAND_WORDS.name,
        tabIndex: -1,
        ...(focused === undefined ? {} : { "aria-activedescendant": optionId(focused) }),
      }
    : { "aria-label": HAND_WORDS.name };

  return (
    <>
      <div
        ref={fan}
        className="vf-cards"
        {...named}
        {...(raised ? { "data-raised": "" } : {})}
        {...(props.tucked === true ? { "data-tucked": "" } : {})}
        {...(reducedMotion ? { "data-motion": "reduced" } : {})}
      >
        {rowsOf(cards, props.leaving ?? []).map((row) => {
          const at = place(row);
          if (at === null) return null;
          const { card } = row;
          const slotStyle = { "--vf-cards-x": `${round(at.x, 1)}px`, zIndex: at.z };
          const liftStyle = {
            "--vf-cards-y": `${round(at.y, 1)}px`,
            "--vf-cards-r": `${round(at.r, 2)}deg`,
            "--vf-cards-rd": round(at.r, 2),
            "--vf-cards-s": round(at.s, 3),
            "--vf-cards-lp": round(at.lp, 3),
            "--vf-cards-o": at.o,
          };
          // raised, each card in the hand is one of the list's options (a leaving one is not)
          const option =
            raised && row.index >= 0
              ? {
                  id: optionId(card),
                  role: "option",
                  "aria-label": HAND_WORDS.option(cardName(card), provenance(card, props.now)),
                  "aria-selected": row.index === focus,
                }
              : {};
          return (
            <div
              key={card.id}
              className="vf-cards-slot"
              data-slot={card.id}
              data-phase={at.phase}
              {...option}
              {...(raised && row.index === focus ? { "data-focus": "" } : {})}
              {...(nudged === card.id ? { "data-nudged": "" } : {})}
              {...(props.settling === card.id ? { "data-settling": "" } : {})}
              style={slotStyle as CSSProperties}
              onPointerDown={(event) => {
                if (at.phase === "rest") props.onPress?.(card.id, event);
              }}
            >
              <div className="vf-cards-lift" style={liftStyle as CSSProperties}>
                <CardFace
                  card={card}
                  reached={at.phase === "rest" && !raised && row.index === reached}
                  onRemove={() => props.onRemove?.(card.id)}
                />
              </div>
            </div>
          );
        })}
        {label !== null && (
          <div
            key={label.text}
            className="vf-cards-label"
            style={{ left: `${round(label.x, 1)}px`, top: `${round(label.y, 1)}px` }}
          >
            {label.text}
          </div>
        )}
      </div>
      {held !== null && (
        <HeldLayer
          key={held.card.id}
          held={held}
          slot={layout.slots[heldIndex]}
          win={win}
          now={props.now}
          reducedMotion={reducedMotion}
          onPutBack={props.onPutBack}
          onRemoveHeld={props.onRemoveHeld}
          layerRef={props.heldRef}
        />
      )}
    </>
  );
}

interface HeldLayerProps {
  readonly held: HeldCard;
  /** its place in the fan (undefined once it has left the hand) */
  readonly slot: CardSlot | undefined;
  readonly win: CardWindow;
  readonly now: number;
  readonly reducedMotion: boolean;
  readonly onPutBack: (() => void) | undefined;
  readonly onRemoveHeld: (() => void) | undefined;
  readonly layerRef: RefObject<HTMLDivElement | null> | undefined;
}

/** A key inside the held card's layer reaches the control it was meant for, and goes no further:
 * nothing under the scrim hears it (R-B 1; the desk's keymap listens on the window). */
function keepKeyInside(event: ReactKeyboardEvent<HTMLDivElement>): void {
  event.stopPropagation();
}

/** A card picked up (HN-D5): it leaves its place in the fan for the middle at reading size while
 * the window behind it goes out of focus, and the bar under the head says where it came from. Up,
 * it is a modal dialog named by the card. */
function HeldLayer({
  held,
  slot,
  win,
  now,
  reducedMotion,
  onPutBack,
  onRemoveHeld,
  layerRef,
}: HeldLayerProps): ReactElement {
  const box = useRef<HTMLDivElement | null>(null);
  // Drawn first where it stood in the fan; once that start is committed (a forced reflow, as the
  // deal's), it travels to the middle.
  const [risen, setRisen] = useState(false);
  useLayoutEffect(() => {
    if (risen || held.phase !== "up") return;
    settle(box.current);
    setRisen(true);
  }, [risen, held.phase]);

  const up = held.phase === "up";
  const centre = heldCentre(win);
  let at = { x: centre.x, y: centre.y, s: centre.s, o: 1 };
  if (reducedMotion) {
    // M6: no flight — it fades in at the middle, and out there
    at = { ...at, o: up && risen ? 1 : 0 };
  } else if (up && !risen && slot !== undefined) {
    at = { x: slot.x, y: slot.y - CARD_LIFT, s: 1, o: 1 };
  } else if (held.phase === "home" && slot !== undefined) {
    at = { x: slot.x, y: slot.y, s: 1, o: 1 };
  } else if (!up) {
    // gone, or home with no place left to go to: it shrinks where it stands
    at = { ...at, s: 0 };
  }
  const cardStyle = {
    transform: `translate(${round(at.x, 1)}px, ${round(at.y, 1)}px) scale(${round(at.s, 3)})`,
    "--vf-cards-o": at.o,
  };

  const dialog = up
    ? { role: "dialog", "aria-modal": true, "aria-label": cardName(held.card) }
    : {};

  return (
    <div
      ref={layerRef}
      className="vf-cards-held"
      data-phase={held.phase}
      {...dialog}
      {...(reducedMotion ? { "data-motion": "reduced" } : {})}
      onKeyDown={keepKeyInside}
    >
      <div className="vf-cards-scrim" aria-hidden="true" onClick={onPutBack} />
      <div ref={box} className="vf-cards-heldcard" style={cardStyle as CSSProperties}>
        <CardFace card={held.card} held />
      </div>
      <div className="vf-cards-bar" {...(up ? { "data-on": "" } : {})} inert={!up}>
        <span className="vf-cards-bar-from">{provenance(held.card, now)}</span>
        <span className="vf-cards-bar-rule" aria-hidden="true" />
        <button
          type="button"
          title={HAND_WORDS.removeKey}
          aria-keyshortcuts="Backspace"
          onClick={onRemoveHeld}
        >
          {HAND_WORDS.remove}
        </button>
        <button
          type="button"
          className="vf-cards-bar-done"
          title={HAND_WORDS.doneKey}
          aria-keyshortcuts="Escape"
          onClick={onPutBack}
        >
          {HAND_WORDS.done}
        </button>
      </div>
    </div>
  );
}
