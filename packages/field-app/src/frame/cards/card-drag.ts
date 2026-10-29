import { FrameView, frameViewBuilt } from "@vibefield/contracts";
import { useSyncExternalStore } from "react";
import { getRendererLogger } from "../../logging";
import { sayOnLine } from "../line-door";
import { VIEW_CELL_SELECTOR } from "../ViewsTrack";
import { getActiveView, requestView } from "../view-state";
import { type CardAnswer, type CardPlayed, type CardTarget, cardTargets } from "./card-targets";
import type { Card } from "./cards-model";
import { TARGET_WORDS } from "./cards-words";
import { isField } from "./caret";

/**
 * THE ONE DRAG MACHINE (track HN, HN-4; DESIGN.md §8 "The hand", where cards go). A card
 * carried out of the hand — or, from B2, in from another app — is one state here, which the
 * carried layer draws (`useCarriedCard`) and the fan reads to keep the card's slot empty while
 * it is away. Every move asks what is under the pointer. A view's cell on the line opens its view
 * once the card has been held over it for SPRING_LOAD_MS (HN-D6). Anywhere else the topmost place
 * in the registry answers (`card-targets.ts`; HN-L5: a refusal in words, under the pointer). Let
 * go on a place that took it, and a COPY plays in: the card shrinks into the point, the outcome
 * is said once on the line, and the card springs back to its slot (HN-D4, HN-L2: never spent).
 * Let go anywhere else, or press Esc, or let the window lose focus, and it flies straight home.
 * A card from another app (B2, HN-6) waits — its kind alone — until the drop says what it holds:
 * filled then, it plays straight into a pane or the prompt, and anywhere else it is the hand's —
 * but over a field no place answers for it says nothing, since that field takes the drop (HN-L3).
 * A hand drag holds its pointer for the carry — captured on the hand, the cursor grabbing (§7) —
 * so nothing under the card hears a move or an up it never saw pressed. Otherwise there is no DOM
 * here: the layer draws the card, and the clock is the tests' to fake.
 */

/** A box in window px — a card's slot, or a place's. */
export interface CardBox {
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
  /** a turn to land in, degrees, about the fan's pivot; the hand's slots name none — a flight
   * carries no turn, and the fan settles a card into its tilt once it is back */
  readonly rotate?: number;
}

export interface CardDragStart {
  readonly card: Card;
  readonly source: "hand" | "outside";
  /** null: an HTML5 drag from another app (B2) — moved by moveCardDrag */
  readonly pointerId: number | null;
  /** the pointer, window px */
  readonly at: { readonly x: number; readonly y: number };
  /** the grab point inside the card, card px */
  readonly grab: { readonly x: number; readonly y: number };
  /** where it springs back to (null: no home yet) */
  readonly home: () => CardBox | null;
}

export interface CarriedCard {
  readonly card: Card;
  readonly source: "hand" | "outside";
  readonly x: number;
  readonly y: number;
  readonly grab: { readonly x: number; readonly y: number };
  readonly answer: {
    readonly kind: "pane" | "prompt" | "desk" | "cell" | "hand";
    readonly ok: boolean;
    readonly label: string;
  } | null;
  /** spring-loading (HN-D6): the view under the card, and how far its clock has run */
  readonly opening: { readonly view: FrameView; readonly progress: number } | null;
  readonly phase: "carry" | "play" | "home";
  /** Each drag's own number: a new drag's motion starts fresh. */
  readonly drag: number;
  /** Degrees the card leans with the pointer's speed (±10, the page's); 0 once it is let go. */
  readonly tilt: number;
  /** Over the line it ducks small, so the cell it is held over shows (HN-D6). */
  readonly ducked: boolean;
  /** Where the select ring is drawn: the place that takes it (a pane, the desk's stage) — kept
   * through the play, while it fades (§6). */
  readonly ring: CardBox | null;
  /** The cell opening under it: where "Opening Godview" and its ring stand. */
  readonly cell: CardBox | null;
  /** Once it turns home: its slot as `home()` answered, or null — it fades where it is. */
  readonly home: CardBox | null;
}

/** What became of a card let go (`endCardDrag`): a place took it and a copy `played`, its outcome
 * said; it went `home`, nothing played; or — a card from another app let go where nothing takes it
 * straight — it is for the `hand`: its carry is over, and its source deals it from where it was
 * let go (DESIGN.md §8 "The hand", brought in). `none`: nothing was being carried. */
export type CardLetGo = "played" | "home" | "hand" | "none";

/** HN-D6 — how long a card is held over a view's cell before that view opens under it. */
export const SPRING_LOAD_MS = 520;
/** The play (M4): the card shrinks into the point it is let go on, then flies home on the island
 * curve. Under reduced motion both halve, and fade (M6). */
export const PLAY_SHRINK_MS = 200;
export const PLAY_HOME_MS = 440;
/** A flight ends on a timer of its length and two frames, never on a `transitionend` a hidden
 * window may not send (DESIGN.md §6, the terminals' rise and fall). */
const TWO_FRAMES_MS = 34;
/** The lean (the page's): the pointer's smoothed speed, px/ms, times this, ±10° at most. */
const TILT_PER_SPEED = 16;
const TILT_MAX = 10;
/** The carried card's own layer (CarriedCardLayer.tsx). It is inert, so a browser never finds it
 * under a point; it is passed over here all the same — the card is never what it is held over. */
export const CARRIED_LAYER_CLASS = "vf-cards-carried-layer";
/** The hand's own element (CardsView.tsx), which holds a hand drag's pointer while it carries. */
const HAND_SELECTOR = ".vf-cards";
/** On the document while a hand drag carries its card: the grabbing cursor (carried.css). */
const CARRYING_ATTRIBUTE = "data-vf-cards-carrying";

/** The motion's lengths, by the person's setting (M6: halved under reduced motion). */
export function playTimings(reduced = reducedMotion()): {
  readonly shrinkMs: number;
  readonly homeMs: number;
} {
  return reduced
    ? { shrinkMs: PLAY_SHRINK_MS / 2, homeMs: PLAY_HOME_MS / 2 }
    : { shrinkMs: PLAY_SHRINK_MS, homeMs: PLAY_HOME_MS };
}

interface Spring {
  readonly view: FrameView;
  readonly box: CardBox;
  readonly since: number;
  /** its view was asked for: once per hover */
  done: boolean;
  timer: ReturnType<typeof setTimeout> | null;
}

interface LiveDrag {
  readonly start: CardDragStart;
  readonly drag: number;
  /** the card carried: the start's, or — from another app — the one its drop filled (B2) */
  card: Card;
  phase: CarriedCard["phase"];
  x: number;
  y: number;
  lastX: number;
  lastT: number;
  /** the pointer's smoothed speed across, px/ms */
  speed: number;
  ducked: boolean;
  target: CardTarget | null;
  answer: CarriedCard["answer"];
  ring: CardBox | null;
  spring: Spring | null;
  home: CardBox | null;
  timer: ReturnType<typeof setTimeout> | null;
  detach: () => void;
}

let live: LiveDrag | null = null;
let carried: CarriedCard | null = null;
let drags = 0;
const listeners = new Set<() => void>();

const log = () => getRendererLogger().child({ component: "cards" });

function reducedMotion(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

const wait = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

const boxOf = (rect: DOMRect | null): CardBox | null =>
  rect === null ? null : { left: rect.left, top: rect.top, width: rect.width, height: rect.height };

function publish(next: CarriedCard | null): void {
  carried = next;
  for (const fn of [...listeners]) fn();
}

function snapshot(drag: LiveDrag): CarriedCard {
  const carrying = drag.phase === "carry";
  const spring = carrying && drag.spring !== null && !drag.spring.done ? drag.spring : null;
  return {
    card: drag.card,
    source: drag.start.source,
    x: drag.x,
    y: drag.y,
    grab: drag.start.grab,
    answer: carrying ? drag.answer : null,
    opening:
      spring === null
        ? null
        : {
            view: spring.view,
            progress: Math.min(1, Math.max(0, (Date.now() - spring.since) / SPRING_LOAD_MS)),
          },
    phase: drag.phase,
    drag: drag.drag,
    tilt: carrying ? Math.max(-TILT_MAX, Math.min(TILT_MAX, drag.speed * TILT_PER_SPEED)) : 0,
    ducked: carrying && drag.ducked,
    // the place's ring stays through the play and fades as the card goes in (§6; under M6 it is
    // the play's one sign: the place rings once)
    ring: drag.phase === "home" ? null : drag.ring,
    cell: spring?.box ?? null,
    home: drag.home,
  };
}

/** What is under a point, topmost first, past the carried card; null in a DOM with no layout (a
 * test's), where the places answer by their boxes alone. */
function elementsAt(x: number, y: number): readonly Element[] | null {
  if (typeof document === "undefined" || typeof document.elementsFromPoint !== "function") {
    return null;
  }
  const stack = document.elementsFromPoint(x, y);
  return stack.filter((element) => element.closest(`.${CARRIED_LAYER_CLASS}`) === null);
}

/** The element on top at a point, past the carried card — what the places and the cells answer
 * by; null for nothing, undefined in a DOM with no layout. */
function topAt(x: number, y: number): Element | null | undefined {
  const stack = elementsAt(x, y);
  return stack === null ? undefined : (stack[0] ?? null);
}

/** Over the line (its box read from the DOM, never a constant): the card ducks small there. */
function overLine(x: number, y: number): boolean {
  const line = typeof document === "undefined" ? null : document.querySelector(".vf-line");
  if (line === null) return false;
  const r = line.getBoundingClientRect();
  return r.width > 0 && x >= r.left && x <= r.right && y >= r.top && y <= r.bottom;
}

/** The view's cell on top at the pointer — not one that waits ("not built yet"). */
function viewCellAt(top: Element | null): { view: FrameView; box: CardBox } | null {
  const cell = top?.closest<HTMLElement>(VIEW_CELL_SELECTOR) ?? null;
  if (cell === null || cell.getAttribute("aria-disabled") === "true") return null;
  const view = FrameView.safeParse(cell.dataset.view);
  const box = boxOf(cell.getBoundingClientRect());
  return view.success && box !== null ? { view: view.data, box } : null;
}

function stopSpring(drag: LiveDrag): void {
  const timer = drag.spring?.timer;
  if (timer != null) clearTimeout(timer);
  drag.spring = null;
}

/** HN-D6 — over a view's cell its clock runs: held SPRING_LOAD_MS, that view opens under the
 * card, once per hover; leaving the cell resets it. The cell of the view already open, or of
 * one not built, opens nothing. */
function springAt(drag: LiveDrag, cell: { view: FrameView; box: CardBox } | null): void {
  if (drag.spring !== null && cell !== null && drag.spring.view === cell.view) return;
  stopSpring(drag);
  if (cell === null || cell.view === getActiveView() || !frameViewBuilt(cell.view)) return;
  const spring: Spring = {
    view: cell.view,
    box: cell.box,
    since: Date.now(),
    done: false,
    timer: null,
  };
  spring.timer = setTimeout(() => {
    spring.timer = null;
    spring.done = true;
    if (live !== drag || drag.spring !== spring) return;
    void requestView(spring.view);
    drag.answer = null;
    publish(snapshot(drag));
  }, SPRING_LOAD_MS);
  drag.spring = spring;
}

function answerOf(
  target: CardTarget,
  card: Card,
  at: { readonly x: number; readonly y: number },
): CardAnswer | null {
  try {
    return target.answer(card, at);
  } catch (cause) {
    log().error("renderer.cards.answer_failed", "A place could not answer a card", cause, {
      target: target.id,
    });
    return null;
  }
}

/** The place a card from this source plays into at a point, and what it says: the topmost place
 * there that answers it — except that from another app only a live input takes a card straight
 * (a pane, the prompt); anywhere else, the desk included, it settles into the hand (DESIGN.md §8
 * "The hand", from another app). Null for none. The hit test and the drop's field ask this one. */
function placeFor(
  source: CardDragStart["source"],
  card: Card,
  at: { readonly x: number; readonly y: number },
  top: Element | null | undefined,
): { readonly target: CardTarget; readonly said: CardAnswer } | null {
  const target = cardTargets.at(at.x, at.y, top);
  if (target === null || (source === "outside" && target.kind === "desk")) return null;
  const said = answerOf(target, card, at);
  return said === null ? null : { target, said };
}

/** What is under the pointer now: the line's cell, or the place on top and what it says. */
function hitTest(drag: LiveDrag): void {
  const { x, y } = drag;
  const top = topAt(x, y);
  drag.ducked = overLine(x, y);
  const cell = viewCellAt(top ?? null);
  springAt(drag, cell);
  if (cell !== null) {
    const spring = drag.spring;
    drag.target = null;
    drag.ring = null;
    drag.answer =
      spring === null || spring.done
        ? null
        : { kind: "cell", ok: true, label: TARGET_WORDS.opening(spring.view) };
    return;
  }
  const place = placeFor(drag.start.source, drag.card, { x, y }, top);
  if (place !== null) {
    const { target, said } = place;
    drag.target = target;
    drag.answer = { kind: target.kind, ok: said.ok, label: said.label };
    drag.ring = said.ok ? boxOf(said.ring ?? target.rect()) : null;
    return;
  }
  drag.target = null;
  drag.ring = null;
  // …but a field no place takes it at — the desk's own note included — takes a drop itself
  // (HN-L3): over it the card says nothing, since letting go there will not put it in the hand
  drag.answer =
    drag.start.source === "outside" && !isField(top)
      ? { kind: "hand", ok: true, label: TARGET_WORDS.hand }
      : null;
}

/** Whether a card from another app let go at this window point is a field's (HN-L3): a field on
 * top there — read as the drag reads what is under the pointer — that no place takes the card at,
 * by the drag's own rule (`placeFor`). A pane's own text area and Chat's prompt outrank the field;
 * the desk, which takes no card from another app, does not. */
export function fieldTakesDrop(x: number, y: number, card: Card): boolean {
  const top = topAt(x, y);
  return isField(top) && placeFor("outside", card, { x, y }, top) === null;
}

function moveTo(drag: LiveDrag, x: number, y: number): void {
  if (drag.phase !== "carry") return;
  const now = Date.now();
  const speed = (x - drag.lastX) / Math.max(8, now - drag.lastT);
  drag.speed = drag.speed * 0.72 + speed * 0.28;
  drag.lastX = x;
  drag.lastT = now;
  drag.x = x;
  drag.y = y;
  hitTest(drag);
  publish(snapshot(drag));
}

function homeOf(start: CardDragStart): CardBox | null {
  try {
    return start.home();
  } catch (cause) {
    log().error("renderer.cards.home_failed", "A carried card's slot could not be read", cause);
    return null;
  }
}

/** Gone: the layer draws nothing, the fan shows the slot again. */
function finish(drag: LiveDrag): void {
  drag.detach();
  stopSpring(drag);
  if (drag.timer !== null) clearTimeout(drag.timer);
  drag.timer = null;
  if (live !== drag) return;
  live = null;
  publish(null);
}

/** HN-D4 — never spent: it flies back to its slot (M4), and is gone once it has landed. */
function turnHome(drag: LiveDrag): void {
  drag.detach();
  stopSpring(drag);
  drag.phase = "home";
  drag.target = null;
  drag.answer = null;
  drag.ring = null;
  drag.home = homeOf(drag.start);
  publish(snapshot(drag));
  drag.timer = setTimeout(() => finish(drag), playTimings().homeMs + TWO_FRAMES_MS);
}

async function playOf(
  target: CardTarget,
  card: Card,
  at: { readonly x: number; readonly y: number },
): Promise<CardPlayed> {
  try {
    return await target.play(card, at);
  } catch (cause) {
    log().error("renderer.cards.play_failed", "A place threw while a card played", cause, {
      target: target.id,
    });
    return { ok: false, note: "" };
  }
}

/** Capture a hand drag's pointer on the hand's element, so the moves and the up come to the
 * carry and never to what lies under the card — a live page, the desk. Null where it cannot be:
 * no hand mounted, or the pointer is not down (its up raced the drag's start), and the window
 * hears it all the same. */
function capturePointer(pointerId: number): Element | null {
  const hand = document.querySelector(HAND_SELECTOR);
  if (hand === null) return null;
  try {
    hand.setPointerCapture(pointerId);
    return hand;
  } catch {
    return null;
  }
}

/** A hand drag hears its own pointer on the window, captured on the hand and grabbing; every drag
 * hears Esc and the window's blur. The undo lets all of it go. */
function listen(drag: LiveDrag): () => void {
  if (typeof window === "undefined") return () => undefined;
  const pointerId = drag.start.pointerId;
  const holder = pointerId === null ? null : capturePointer(pointerId);
  if (pointerId !== null) document.documentElement.setAttribute(CARRYING_ATTRIBUTE, "");
  const ours = (event: PointerEvent): boolean =>
    pointerId !== null && event.pointerId === pointerId;
  const onMove = (event: PointerEvent): void => {
    if (ours(event)) moveTo(drag, event.clientX, event.clientY);
  };
  const onUp = (event: PointerEvent): void => {
    if (ours(event)) void endCardDrag(event.clientX, event.clientY);
  };
  const onCancel = (event: PointerEvent): void => {
    if (ours(event)) cancelCardDrag();
  };
  // Esc is the carried card's while it is carried: no element under it hears it (this is the
  // window's capture phase, ahead of them all), and the hand — whose keys listen there too, and
  // earlier — stands aside while a card is carried (Cards.tsx)
  const onKey = (event: KeyboardEvent): void => {
    if (event.key !== "Escape") return;
    event.preventDefault();
    event.stopImmediatePropagation();
    cancelCardDrag();
  };
  const onBlur = (): void => cancelCardDrag();
  window.addEventListener("pointermove", onMove);
  window.addEventListener("pointerup", onUp);
  window.addEventListener("pointercancel", onCancel);
  window.addEventListener("keydown", onKey, true);
  window.addEventListener("blur", onBlur);
  let attached = true;
  return () => {
    if (!attached) return;
    attached = false;
    window.removeEventListener("pointermove", onMove);
    window.removeEventListener("pointerup", onUp);
    window.removeEventListener("pointercancel", onCancel);
    window.removeEventListener("keydown", onKey, true);
    window.removeEventListener("blur", onBlur);
    if (pointerId === null) return;
    document.documentElement.removeAttribute(CARRYING_ATTRIBUTE);
    if (holder?.hasPointerCapture(pointerId) === true) holder.releasePointerCapture(pointerId);
  };
}

/** Carry a card. A hand drag (`pointerId` set) hears that pointer on the window from here until
 * it is let go; an outside drag is moved by `moveCardDrag`. A drag already under way ends first. */
export function startCardDrag(start: CardDragStart): void {
  if (live !== null) finish(live);
  drags += 1;
  const drag: LiveDrag = {
    start,
    drag: drags,
    card: start.card,
    phase: "carry",
    x: start.at.x,
    y: start.at.y,
    lastX: start.at.x,
    lastT: Date.now(),
    speed: 0,
    ducked: false,
    target: null,
    answer: null,
    ring: null,
    spring: null,
    home: null,
    timer: null,
    detach: () => undefined,
  };
  live = drag;
  drag.detach = listen(drag);
  hitTest(drag);
  publish(snapshot(drag));
}

/** An outside drag's `dragover` (B2): the card follows the system's pointer. */
export function moveCardDrag(x: number, y: number): void {
  if (live !== null) moveTo(live, x, y);
}

/** Let go at this window point. A place that took the card plays a copy in, its outcome said
 * once on the line, and the card springs back; a refusal, or nothing under it, sends it straight
 * home. A card from another app (B2) is `filled` here — the drop says what it holds, so the filled
 * card takes the waiting one's place and the place under it is asked again — and anywhere but a
 * place that takes it straight it is the hand's; a place that refuses what it turned out to hold
 * says so on the line, since under the pointer it answered only the waiting card. Resolves once
 * the outcome is said. */
export async function endCardDrag(x: number, y: number, filled?: Card): Promise<CardLetGo> {
  const drag = live;
  if (drag === null || drag.phase !== "carry") return "none";
  if (filled !== undefined) drag.card = filled;
  moveTo(drag, x, y);
  const { target, answer } = drag;
  if (target === null || answer === null || !answer.ok) {
    if (drag.start.source === "hand") {
      turnHome(drag);
      return "home";
    }
    if (target !== null && answer !== null) sayOnLine(answer.label);
    finish(drag);
    return "hand";
  }
  drag.detach();
  stopSpring(drag);
  drag.phase = "play";
  publish(snapshot(drag));
  const played = playOf(target, drag.card, { x: drag.x, y: drag.y });
  await wait(playTimings().shrinkMs);
  if (live === drag) turnHome(drag);
  const outcome = await played;
  if (outcome.note !== "") sayOnLine(outcome.note);
  return "played";
}

/** Esc, a lost pointer, the window's blur: home at once, nothing played. */
export function cancelCardDrag(): void {
  if (live !== null && live.phase === "carry") turnHome(live);
}

export function subscribeCarriedCard(fn: () => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

export function getCarriedCard(): CarriedCard | null {
  return carried;
}

/** The card carried now, or null — the carried layer draws it; the fan hides its slot. */
export function useCarriedCard(): CarriedCard | null {
  return useSyncExternalStore(subscribeCarriedCard, getCarriedCard, getCarriedCard);
}

/** Test seam: drop any drag under way, its listeners and timers, and every subscriber. */
export function resetCardDragForTest(): void {
  if (live !== null) finish(live);
  live = null;
  carried = null;
  listeners.clear();
}
