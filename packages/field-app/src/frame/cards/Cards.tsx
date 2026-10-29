import type { FrameView, ScreenshotCaptureResult } from "@vibefield/contracts";
import {
  type ReactElement,
  type PointerEvent as ReactPointerEvent,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { useReducedMotion } from "../../field/desk/bar/bar-motion";
import { isCardsChord, listenForProductChord } from "../../field/product-chords";
import { type FieldHost, getHost } from "../../host";
import { noteCapture } from "../capture-state";
import { type FrameSurface, foldSurface } from "../frame-surface";
import { sayOnLine } from "../line-door";
import { useActiveView } from "../view-state";
import { CardsView, type HeldCard, type LeavingCard } from "./CardsView";
import { CarriedCardLayer } from "./CarriedCardLayer";
import { type CardBox, getCarriedCard, startCardDrag, useCarriedCard } from "./card-drag";
import {
  CARD_H,
  CARD_LIFT,
  CARD_W,
  CARDS_LINE_RIGHT,
  type Card,
  type CardLayout,
  type CardWindow,
  inReach,
  layoutCards,
  layoutRaised,
  REACH_BAND,
  reachedIndex,
  reachLift,
  reachX,
} from "./cards-model";
import { listenForOtherApps } from "./cards-outside";
import { dealCapture } from "./cards-sources";
import { type CardStore, cardsStore, useCards } from "./cards-store";
import { captureRefusal } from "./cards-words";
import { isField } from "./caret";

/**
 * The hand's controller (track HN, HN-1; DESIGN.md §8 "The hand", §10): it holds the window's
 * hand (`cards-store.ts`) to the pointer, the keys and the frame's one owner, and draws it through
 * `CardsView`. Mounted once by ChromeLayer, where the clipboard tray stood; the frame's, not a
 * view's, so the hand comes with you when you switch views.
 *
 * - The reach: the pointer in the foot's band lifts the cards near it, the one under it whole,
 *   showing its × and where it came from; above the fan the card it is on holds the reach (its ×
 *   must be reachable). Nothing answers while a card is held, the hand raised, a drag carries,
 *   the pegboard is out, Settings is open over it, or another of the frame's surfaces is open.
 * - A press: moved under 4px it is a click, and picks the card up (HN-D5); farther, a drag, which
 *   the carried layer (`card-drag.ts`) takes over. × removes the card reached, and so does ⌫
 *   while the pointer is on it (HN-D4).
 * - The keys belong to one scope at a time (the contract's rule): a card picked up is a modal —
 *   Esc puts it back, ⌫ removes it, Tab walks its bar, and nothing under the scrim hears a key;
 *   ⇧⌘V raises the hand, whose ← → walk it, Return picks up, ⌫ removes, Esc lowers; at rest ⌫
 *   removes the card the pointer is on. A drag's keys are its own.
 * - The keyboard follows the hand: the raised hand's root takes it, a card picked up hands it to
 *   Done, and it goes back to what had it once the hand lets go.
 * - Raised, or a card picked up, the hand is the frame's open surface (`cards`, HN-L7): another
 *   opening lowers it and puts the card back, and so does the owner's fold on a change of view.
 * - The ONE subscription to the shell's screenshot results (its preload keeps a single handler):
 *   a capture main ran (⌃⌘A, View ▸ Take Screenshot) is dealt from its region as a picture card,
 *   a failure is said on the line's note, and every result tells the line's snapshot whether it
 *   waits (`capture-state.ts`).
 * - What another app hands over comes in while the hand is here (HN-6, `cards-outside.ts`): ⌘V
 *   with no caret deals a card for each thing the paste holds (never while a card is picked up
 *   or Settings is open), and a drag into the window is a card carried until it is let go — a
 *   file named by its path through the shell's file door.
 */

/** A press that moves this far is a drag; less, a click (HN-D5). */
const PRESS_SLOP_PX = 4;
/** Put back: the held layer's 140ms lead and 440ms home, and a frame to spare. */
const HOME_MS = 140 + 440 + 40;
/** Removed while held: it shrinks where it stands (280ms on the retract curve). */
const GONE_MS = 280 + 40;
/** A card leaving past the foot (240ms; a fade under reduced motion), and a frame to spare. */
const LEAVE_MS = 240 + 40;
/** How long a card a paste already was stays risen, saying so (HN-D10); then it settles back on
 * the retract curve in the pop's own 280ms. */
const NUDGE_MS = 1200;
const SETTLE_MS = 280;

export type CardsHost = Pick<
  FieldHost,
  "onScreenshotResult" | "screenshotStillUrl" | "pathForFile"
>;

export interface CardsProps {
  /** The frame's open surface, from its one owner (`frame-surface.ts`). */
  readonly surface: FrameSurface | null;
  readonly onSurfaceChange: (next: FrameSurface | null) => void;
  /** The pegboard is out behind the line: the hand steps down out of its way. */
  readonly tucked?: boolean;
  /** Settings is open over the window — not one of the frame's surfaces, so the owner's fold
   * never says so: the hand at rest under its backdrop answers neither the pointer nor ⌫. */
  readonly settingsOpen?: boolean;
  /** The window's hand; a test hands its own. */
  readonly store?: CardStore;
  /** The shell's doors; a test hands a fixture. */
  readonly host?: CardsHost;
  readonly now?: () => number;
}

interface Pointer {
  readonly x: number;
  readonly y: number;
  /** the card in the fan the pointer is on, if any */
  readonly over: string | null;
}

interface Press {
  readonly id: string;
  readonly pointerId: number;
  readonly x: number;
  readonly y: number;
  /** where on the card it was pressed, card px */
  readonly grab: { readonly x: number; readonly y: number };
}

/** A twin paste's lift (HN-D10): risen under its words, then settling back. */
interface Nudge {
  readonly id: string;
  readonly settling: boolean;
}

const readWindow = (): CardWindow => ({ width: window.innerWidth, height: window.innerHeight });

/** The fan's layout for this many cards: straight up when raised, fanned at rest. PURE. */
function layoutFor(n: number, win: CardWindow, raised: boolean): CardLayout {
  return raised ? layoutRaised(n, win, CARDS_LINE_RIGHT) : layoutCards(n, win, CARDS_LINE_RIGHT);
}

/** The card in the fan a pointer event is on (the held and the carried layers are not the fan). */
function cardUnder(target: EventTarget | null): string | null {
  if (!(target instanceof Element)) return null;
  return target.closest(".vf-cards [data-card]")?.getAttribute("data-card") ?? null;
}

/** The card in the fan under the pointer NOW — cards rise and close up under a still pointer, so a
 * key reads it at its own moment, past whatever stands over the hand (Settings' backdrop, a scrim);
 * a DOM with no layout (a test's) answers with the card the last move was on. */
function cardAt(pointer: Pointer): string | null {
  const hit = document.elementFromPoint(pointer.x, pointer.y);
  return hit === null ? pointer.over : cardUnder(hit);
}

/** Is a key's target inside this element? */
function within(el: Element | null, target: EventTarget | null): boolean {
  return el !== null && target instanceof Node && el.contains(target);
}

/** Whose a key is, chosen once (the contract's one scope rule): the card picked up's, the raised
 * hand's, or the hand's at rest. PURE. */
function scopeOf(held: HeldCard | null, raised: boolean): "held" | "raised" | "rest" {
  if (held?.phase === "up") return "held";
  return raised ? "raised" : "rest";
}

const deletes = (event: KeyboardEvent): boolean =>
  event.key === "Backspace" || event.key === "Delete";
const modified = (event: KeyboardEvent): boolean => event.metaKey || event.ctrlKey || event.altKey;

/** A card's own object URL goes with it (a picture pasted or dropped in; HN-D9 keeps nothing). */
function release(card: Card): void {
  if (card.kind === "pict" && card.src.startsWith("blob:")) URL.revokeObjectURL(card.src);
}

/** Claim a key for the hand: no pane, no desk and no later listener acts on it. */
function claim(event: KeyboardEvent): void {
  event.preventDefault();
  event.stopPropagation();
}

export function Cards({
  surface,
  onSurfaceChange,
  tucked = false,
  settingsOpen = false,
  store = cardsStore,
  host: hostProp,
  now = () => Date.now(),
}: CardsProps): ReactElement {
  const host = hostProp ?? getHost();
  const state = useCards(store);
  const view = useActiveView();
  const reducedMotion = useReducedMotion();
  const carriedId = useCarriedCard()?.card.id ?? null;
  const [win, setWin] = useState<CardWindow>(readWindow);
  const [pointer, setPointer] = useState<Pointer | null>(null);
  const [focus, setFocus] = useState(-1);
  const [returning, setReturning] = useState<HeldCard | null>(null);
  const [nudge, setNudge] = useState<Nudge | null>(null);
  const [leaving, setLeaving] = useState<readonly LeavingCard[]>([]);
  const [carriedAway, setCarriedAway] = useState<readonly Card[]>([]);
  const press = useRef<Press | null>(null);
  const fanEl = useRef<HTMLDivElement | null>(null);
  const heldEl = useRef<HTMLDivElement | null>(null);
  /** what had the keyboard before the hand took it, to be given it back */
  const giveBack = useRef<HTMLElement | null>(null);
  /** the key the hand last acted on, until it is let go: its repeats are the hand's too */
  const took = useRef<string | null>(null);

  const open = surface === "cards";
  const raised = open && state.raised;
  const heldCard = open ? state.cards.find((card) => card.id === state.held) : undefined;
  const upId = heldCard?.id ?? null;
  const layout = layoutFor(state.cards.length, win, raised);
  const focusIndex = raised ? Math.min(focus, state.cards.length - 1) : -1;

  // What left the hand, or its middle, since the last render — read from the SAME render it left
  // in, so its element travels rather than vanishes (React's "information from previous renders"):
  // - the card picked up and let go flies home to its place (put back, folded under another
  //   surface, the hand raised, a deal seen), or — once it has left the hand, removed or pushed
  //   off by the thirteenth (HN-D8) — shrinks where it stands, its layer never dropped first;
  // - a card a drag carries is the carried layer's until its carry ends: no twin slides off;
  // - any other card that left — × or ⌫, or pushed off — leaves past the foot from where it stood.
  const [drawn, setDrawn] = useState({ cards: state.cards, up: upId });
  if (drawn.cards !== state.cards || drawn.up !== upId) {
    const kept = new Set(state.cards.map((card) => card.id));
    let back = upId !== null && returning?.card.id === upId ? null : returning;
    const was = drawn.cards.find((card) => card.id === drawn.up);
    if (was !== undefined && was.id !== upId) back = { card: was, phase: "home" };
    if (back?.phase === "home" && !kept.has(back.card.id)) {
      back = { card: back.card, phase: "gone" };
    }
    const before = layoutFor(drawn.cards.length, win, raised);
    const gone: LeavingCard[] = [];
    const away: Card[] = [];
    for (const [index, card] of drawn.cards.entries()) {
      if (kept.has(card.id) || card.id === back?.card.id) continue;
      if (card.id === carriedId) {
        away.push(card);
        continue;
      }
      const slot = before.slots[index];
      if (slot !== undefined) gone.push({ card, slot, index });
    }
    setDrawn({ cards: state.cards, up: upId });
    if (back !== returning) setReturning(back);
    if (gone.length > 0) setLeaving([...leaving, ...gone]);
    if (away.length > 0) setCarriedAway([...carriedAway, ...away]);
  }

  const up: HeldCard | null = heldCard === undefined ? null : { card: heldCard, phase: "up" };
  const held = up ?? returning;

  // The reach (§8 "The hand", Holding them): only the hand at rest answers the pointer — never
  // under Settings' backdrop, which stands over it (R-B 2).
  const reachable =
    surface === null && carriedId === null && !tucked && !settingsOpen && held === null;
  const at = reachable && inReach(layout, win, pointer) ? pointer : null;
  const over = at === null ? -1 : state.cards.findIndex((card) => card.id === at.over);
  const lifts = reachLift(layout.slots, at === null ? null : reachX(layout, win, at, over));
  const top = reachedIndex(lifts);
  const reached = top >= 0 && !state.arriving.has(state.cards[top]?.id ?? "") ? top : -1;

  // The latest of what the window's listeners read, so they subscribe once.
  const latest = {
    state,
    raised,
    focusIndex,
    reached,
    at,
    held,
    lifts,
    surface,
    onSurfaceChange,
    win,
    settingsOpen,
  };
  const live = useRef(latest);
  live.current = latest;
  const viewNow = useRef<FrameView>(view);
  viewNow.current = view;

  const fold = useCallback(() => {
    const { surface: current, onSurfaceChange: change } = live.current;
    change(foldSurface(current, "cards"));
  }, []);

  const pickUp = useCallback(
    (id: string) => {
      store.pickUp(id);
      live.current.onSurfaceChange("cards");
    },
    [store],
  );

  /** Esc, Done or the scrim: the card goes back to its place — a 140ms lead, then 440ms home, as
   * the render after this one draws it. */
  const putBack = useCallback(() => {
    if (store.snapshot().held === null) return;
    store.pickUp(null);
    fold();
  }, [fold, store]);

  /** Remove, or ⌫, on the card picked up: it leaves the hand and shrinks where it stands, its
   * picture going with it once it has gone. */
  const removeHeld = useCallback(() => {
    const id = store.snapshot().held;
    if (id === null) return;
    store.remove(id);
    fold();
  }, [fold, store]);

  /** ⇧⌘V: the whole hand up and straight, the newest in the keyboard's hand — a card held goes
   * back first (the store lets go of it as it raises); or down again. */
  const raise = useCallback(
    (on: boolean) => {
      if (!on) {
        store.raise(false);
        fold();
        return;
      }
      store.raise(true);
      setFocus(store.snapshot().cards.length - 1);
      live.current.onSurfaceChange("cards");
    },
    [fold, store],
  );

  const remove = useCallback((id: string) => store.remove(id), [store]);
  const landed = useCallback((id: string) => store.landed(id), [store]);

  /** Where a carried card springs back to: its place at rest (or raised), straight — flights carry
   * no rotation, and the fan turns it into its tilt once it is home. Read when asked: the hand may
   * have changed while it was carried. */
  const home = useCallback(
    (id: string): CardBox | null => {
      const snapshot = store.snapshot();
      const index = snapshot.cards.findIndex((card) => card.id === id);
      const isUp = snapshot.raised && live.current.surface === "cards";
      const slot = layoutFor(snapshot.cards.length, readWindow(), isUp).slots[index];
      if (slot === undefined) return null;
      return { left: slot.x, top: slot.y, width: CARD_W, height: CARD_H };
    },
    [store],
  );

  const onPress = useCallback((id: string, event: ReactPointerEvent<HTMLElement>) => {
    const cur = live.current;
    if (event.button !== 0 || cur.held !== null) return;
    const index = cur.state.cards.findIndex((card) => card.id === id);
    const slot = layoutFor(cur.state.cards.length, cur.win, cur.raised).slots[index];
    if (slot === undefined) return;
    // the grab point on the card as it is drawn now: lifted by the reach, or raised
    const lifted = cur.raised ? 0 : (cur.lifts[index] ?? 0) * CARD_LIFT;
    event.preventDefault();
    press.current = {
      id,
      pointerId: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      grab: { x: event.clientX - slot.x, y: event.clientY - (slot.y - lifted) },
    };
  }, []);

  // The window's size: the fan is laid out across it.
  useEffect(() => {
    const onResize = (): void => setWin(readWindow());
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  // The pointer: the reach in the foot's band, and a press becoming a click or a drag.
  useEffect(() => {
    const onMove = (event: PointerEvent): void => {
      const pressed = press.current;
      if (pressed !== null && event.pointerId === pressed.pointerId) {
        const moved = Math.hypot(event.clientX - pressed.x, event.clientY - pressed.y);
        if (moved < PRESS_SLOP_PX) return;
        press.current = null;
        const card = store.snapshot().cards.find((candidate) => candidate.id === pressed.id);
        if (card === undefined) return;
        startCardDrag({
          card,
          source: "hand",
          pointerId: event.pointerId,
          at: { x: event.clientX, y: event.clientY },
          grab: pressed.grab,
          home: () => home(pressed.id),
        });
        return;
      }
      if (event.clientY <= live.current.win.height - REACH_BAND) {
        setPointer(null);
        return;
      }
      setPointer({ x: event.clientX, y: event.clientY, over: cardUnder(event.target) });
    };
    const onUp = (event: PointerEvent): void => {
      const pressed = press.current;
      if (pressed === null || event.pointerId !== pressed.pointerId) return;
      press.current = null;
      pickUp(pressed.id);
    };
    const onCancel = (event: PointerEvent): void => {
      if (press.current?.pointerId === event.pointerId) press.current = null;
    };
    const onOut = (event: PointerEvent): void => {
      if (event.relatedTarget === null) setPointer(null);
    };
    const onBlur = (): void => {
      press.current = null;
      setPointer(null);
    };
    window.addEventListener("pointermove", onMove, { passive: true });
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onCancel);
    window.addEventListener("pointerout", onOut);
    window.addEventListener("blur", onBlur);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onCancel);
      window.removeEventListener("pointerout", onOut);
      window.removeEventListener("blur", onBlur);
    };
  }, [home, pickUp, store]);

  // ⇧⌘V — a product chord (GT-D21): the window's capture phase, so a focused pane never runs
  // Ghostty's paste_from_selection for it.
  useEffect(
    () =>
      listenForProductChord(isCardsChord, (event) => {
        if (!event.repeat) raise(!live.current.raised);
      }),
    [raise],
  );

  // The hand's keys, on the window's capture phase — heard before a pane or the desk. ONE scope
  // owns each key, chosen once (the contract's rule):
  // - none while a drag carries a card: its keys are its own (Esc sends it home);
  // - a card picked up is a modal: Esc puts it back, ⌫ removes it, Tab walks its bar's two buttons
  //   and never out, and nothing under the scrim hears any other key — the bar's own buttons do,
  //   and so do the product chords, the window's other capture listeners;
  // - the raised hand takes ← → Return ⌫ Esc from wherever the keyboard is (it is the open
  //   surface);
  // - at rest ⌫ removes the card the pointer is ON — never one it is merely near — unless a
  //   field's caret has the keyboard.
  // A key the hand acted on keeps its repeats until it is let go, and they do nothing: holding ⌫
  // removes one card, and never reaches the desk once that card has gone.
  useEffect(() => {
    /** A key the hand acts on: claimed, and acted on once (a repeat is only claimed). */
    const act = (event: KeyboardEvent, run: () => void): void => {
      claim(event);
      if (event.repeat) return;
      took.current = event.key;
      run();
    };
    /** Tab in the held card's bar: Remove ↔ Done, never out under the scrim. */
    const walkBar = (back: boolean): void => {
      const buttons = heldEl.current?.querySelectorAll<HTMLElement>(".vf-cards-bar button");
      const bar: HTMLElement[] = buttons === undefined ? [] : Array.from(buttons);
      if (bar.length === 0) return;
      let from = bar.findIndex((button) => button === document.activeElement);
      // from outside the bar, Tab comes in at its first button and ⇧Tab at its last
      if (from < 0) from = back ? 0 : -1;
      bar[(from + (back ? -1 : 1) + bar.length) % bar.length]?.focus({ preventScroll: true });
    };
    const onKey = (event: KeyboardEvent): void => {
      if (event.repeat && event.key === took.current) {
        claim(event);
        return;
      }
      if (getCarriedCard() !== null) return;
      const cur = live.current;
      switch (scopeOf(cur.held, cur.raised)) {
        case "held":
          if (event.key === "Escape") {
            act(event, putBack);
          } else if (deletes(event)) {
            act(event, removeHeld);
          } else if (event.key === "Tab") {
            claim(event);
            walkBar(event.shiftKey);
          } else if (!within(heldEl.current, event.target)) {
            event.stopPropagation();
          }
          return;
        case "raised": {
          if (modified(event)) return;
          const card = cur.state.cards[cur.focusIndex];
          if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
            claim(event);
            const next = cur.focusIndex + (event.key === "ArrowLeft" ? -1 : 1);
            setFocus(Math.max(0, Math.min(cur.state.cards.length - 1, next)));
          } else if (event.key === "Enter") {
            act(event, () => {
              if (card !== undefined) pickUp(card.id);
            });
          } else if (deletes(event)) {
            act(event, () => {
              if (card !== undefined) remove(card.id);
            });
          } else if (event.key === "Escape") {
            act(event, () => raise(false));
          }
          return;
        }
        case "rest": {
          if (!deletes(event) || modified(event) || event.repeat) return;
          if (isField(event.target)) return;
          const card = cur.state.cards[cur.reached];
          if (card === undefined || cur.at === null || cardAt(cur.at) !== card.id) return;
          act(event, () => remove(card.id));
          return;
        }
      }
    };
    const onKeyUp = (event: KeyboardEvent): void => {
      if (event.key === took.current) took.current = null;
    };
    const onBlur = (): void => {
      took.current = null;
    };
    window.addEventListener("keydown", onKey, true);
    window.addEventListener("keyup", onKeyUp, true);
    window.addEventListener("blur", onBlur);
    return () => {
      window.removeEventListener("keydown", onKey, true);
      window.removeEventListener("keyup", onKeyUp, true);
      window.removeEventListener("blur", onBlur);
    };
  }, [pickUp, putBack, raise, remove, removeHeld]);

  // The keyboard follows the hand: the raised hand's root takes it (its list walked by its active
  // descendant), a card picked up hands it to Done — and once the hand lets go it goes back to
  // what had it, unless the person has moved it elsewhere since.
  const heldUp = held?.phase === "up";
  useEffect(() => {
    const ours = (el: Element): boolean => within(fanEl.current, el) || within(heldEl.current, el);
    const active = document.activeElement;
    let to: HTMLElement | null = null;
    if (heldUp) to = heldEl.current?.querySelector<HTMLElement>(".vf-cards-bar-done") ?? null;
    else if (raised) to = fanEl.current;
    if (to !== null) {
      if (active instanceof HTMLElement && active !== document.body && !ours(active)) {
        giveBack.current = active;
      }
      to.focus({ preventScroll: true });
      return;
    }
    const back = giveBack.current;
    giveBack.current = null;
    if (!(active instanceof HTMLElement) || (active !== document.body && !ours(active))) return;
    if (back?.isConnected === true) back.focus({ preventScroll: true });
    else if (active !== document.body) active.blur();
  }, [heldUp, raised]);

  // The frame's one owner folded the hand — another surface opened, or the view changed: it
  // lowers, and a card in hand goes back to its place (HN-L7; the render that saw the fold has
  // already sent it home).
  const wasOpen = useRef(open);
  useEffect(() => {
    const was = wasOpen.current;
    wasOpen.current = open;
    if (!was || open) return;
    store.pickUp(null);
    store.raise(false);
  }, [open, store]);

  // The hand holds the frame's surface only while it is raised or a card is in hand: a card in
  // hand pushed off by the thirteenth leaves nothing open, and the owner hears so.
  useEffect(() => {
    if (open && !state.raised && state.held === null) fold();
  }, [fold, open, state.held, state.raised]);

  // A new card dealt: a card in hand goes back first (the deal is seen), and the raised hand's
  // keyboard moves to it.
  const dealt = useRef(new Set(state.arriving.keys()));
  useEffect(() => {
    const fresh = [...state.arriving.keys()].some((id) => !dealt.current.has(id));
    dealt.current = new Set(state.arriving.keys());
    if (!fresh) return;
    if (live.current.held?.phase === "up") putBack();
    if (live.current.raised) setFocus(live.current.state.cards.length - 1);
  }, [putBack, state.arriving]);

  // The held card's way back ends on a timer of its flight, never on a transitionend (M3): home in
  // its place, or shrunk away — and a card that has left the hand takes its picture with it.
  useEffect(() => {
    if (returning === null) return;
    const { card, phase } = returning;
    const timer = window.setTimeout(() => setReturning(null), phase === "home" ? HOME_MS : GONE_MS);
    return () => {
      window.clearTimeout(timer);
      if (phase === "gone") release(card);
    };
  }, [returning]);

  // Leaving cards are gone once they are past the foot, and their pictures with them.
  useEffect(() => {
    if (leaving.length === 0) return;
    const timer = window.setTimeout(() => {
      for (const gone of leaving) release(gone.card);
      setLeaving([]);
    }, LEAVE_MS);
    return () => window.clearTimeout(timer);
  }, [leaving]);

  // A card pushed off while a drag carried it keeps its picture until the carry has ended: the
  // carried layer is still drawing it, home or fading.
  useEffect(() => {
    if (carriedAway.length === 0 || carriedAway.some((card) => card.id === carriedId)) return;
    for (const card of carriedAway) release(card);
    setCarriedAway([]);
  }, [carriedAway, carriedId]);

  // A paste of what is already the newest card lifts it and says so (HN-D10), then settles it.
  useEffect(() => {
    if (state.nudged === null) return;
    const { id } = state.nudged;
    setNudge({ id, settling: false });
    const settle = window.setTimeout(() => setNudge({ id, settling: true }), NUDGE_MS);
    const done = window.setTimeout(() => setNudge(null), NUDGE_MS + SETTLE_MS);
    return () => {
      window.clearTimeout(settle);
      window.clearTimeout(done);
    };
  }, [state.nudged]);

  // The ONE subscription to the shell's screenshot results (its preload keeps a single handler;
  // this was the clipboard tray's): a capture main ran is dealt from its region as a picture
  // card, and a failure is said on the line's note. A cancel says nothing — it was asked for.
  // Every result tells the line's snapshot whether it waits (no helper, Screen Recording off).
  useEffect(() => {
    const subscribe = host.onScreenshotResult;
    if (subscribe === undefined) return;
    return subscribe((result: ScreenshotCaptureResult) => {
      noteCapture(result);
      if (result.status === "ok") {
        dealCapture(result, host, viewNow.current, { store });
      } else if (result.status === "error") {
        sayOnLine(captureRefusal(result));
      }
    });
  }, [host, store]);

  // What another app hands over comes in as cards only when it is brought (HN-6, HN-L1): ⌘V with
  // no caret, a drag into the window — a file named by its path through the shell's file door.
  // Settings' sheet over the window, read at each paste, keeps a paste's cards from landing unseen.
  useEffect(
    () => listenForOtherApps({ store, host, settingsOpen: () => live.current.settingsOpen }),
    [host, store],
  );

  return (
    <>
      <CardsView
        cards={state.cards}
        layout={layout}
        lifts={lifts}
        reached={reached}
        raised={raised}
        focus={focusIndex}
        held={held}
        arriving={state.arriving}
        carried={carriedId}
        nudged={nudge !== null && !nudge.settling ? nudge.id : null}
        settling={nudge?.settling === true ? nudge.id : null}
        leaving={leaving}
        tucked={tucked}
        now={now()}
        reducedMotion={reducedMotion}
        win={win}
        onRemove={remove}
        onPress={onPress}
        onLanded={landed}
        onPutBack={putBack}
        onRemoveHeld={removeHeld}
        fanRef={fanEl}
        heldRef={heldEl}
      />
      <CarriedCardLayer />
    </>
  );
}
