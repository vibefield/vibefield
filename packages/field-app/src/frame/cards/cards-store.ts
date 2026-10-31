import { useSyncExternalStore } from "react";
import { addCard, type Card } from "./cards-model";

/**
 * The hand's store (track HN; DESIGN.md §8 "The hand") — the window's one, as
 * the clipboard tray's was (it replaced the clipboard tray's store, HN-1):
 * the cards in their order, oldest at the left; whether the hand is raised
 * (⇧⌘V); the card picked up, if one is (HN-D5); the cards still on their way in
 * and where each left from; and the card a twin paste lifted (HN-D10). Session
 * only (HN-D9): nothing here is written anywhere, and closing the window empties
 * it.
 */

/** Where a dealt card leaves from, in window px — its source's box. */
export interface DealFrom {
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
}

export interface CardsState {
  readonly cards: readonly Card[];
  readonly raised: boolean;
  /** the card picked up and held at reading size */
  readonly held: string | null;
  /** cards dealt but not yet landed, by id: the view flies each from its box */
  readonly arriving: ReadonlyMap<string, DealFrom | null>;
  /** the card a paste of the same thing lifted (HN-D10), and when */
  readonly nudged: { readonly id: string; readonly at: number } | null;
}

const EMPTY: CardsState = {
  cards: [],
  raised: false,
  held: null,
  arriving: new Map(),
  nudged: null,
};

export class CardStore {
  #state: CardsState = EMPTY;
  #seq = 0;
  readonly #listeners = new Set<() => void>();

  constructor(readonly now: () => number = () => Date.now()) {}

  snapshot(): CardsState {
    return this.#state;
  }

  subscribe(listener: () => void): () => void {
    this.#listeners.add(listener);
    return () => {
      this.#listeners.delete(listener);
    };
  }

  /** A fresh card id, unique in this window. */
  nextId(kind: Card["kind"]): string {
    this.#seq += 1;
    return `card-${kind}-${this.#seq}`;
  }

  /** Deal a card into the hand (HN-D2): it lands at the right end, the oldest
   * past twelve falls off the left (HN-D8). `from` is its source's box, for the
   * flight; null deals it from where it will stand (reduced motion, no box). */
  deal(card: Card, from: DealFrom | null = null): void {
    const cards = addCard(this.#state.cards, card);
    if (cards === this.#state.cards) return;
    const kept = new Set(cards.map((c) => c.id));
    const arriving = new Map([...this.#state.arriving].filter(([id]) => kept.has(id)));
    arriving.set(card.id, from);
    this.#set({
      cards,
      arriving,
      held: this.#state.held !== null && kept.has(this.#state.held) ? this.#state.held : null,
    });
  }

  /** The view says a dealt card has landed. */
  landed(id: string): void {
    if (!this.#state.arriving.has(id)) return;
    const arriving = new Map(this.#state.arriving);
    arriving.delete(id);
    this.#set({ arriving });
  }

  /** A card's face filled in place — a drag from another app, once let go. */
  replace(id: string, card: Card): void {
    const i = this.#state.cards.findIndex((c) => c.id === id);
    if (i < 0) return;
    const cards = this.#state.cards.slice();
    cards[i] = card;
    this.#set({ cards });
  }

  /** × or ⌫ (HN-D4: the one way a card leaves). */
  remove(id: string): void {
    const cards = this.#state.cards.filter((c) => c.id !== id);
    if (cards.length === this.#state.cards.length) return;
    const arriving = new Map(this.#state.arriving);
    arriving.delete(id);
    this.#set({
      cards,
      arriving,
      held: this.#state.held === id ? null : this.#state.held,
      nudged: this.#state.nudged?.id === id ? null : this.#state.nudged,
    });
  }

  /** HN-D10: the paste was already this card — it lifts instead of a twin. */
  nudge(id: string): void {
    if (!this.#state.cards.some((c) => c.id === id)) return;
    this.#set({ nudged: { id, at: this.now() } });
  }

  raise(on: boolean): void {
    if (this.#state.raised === on) return;
    this.#set({ raised: on, held: on ? null : this.#state.held });
  }

  /** Pick a card up (HN-D5), or put it back with null. */
  pickUp(id: string | null): void {
    if (id !== null && !this.#state.cards.some((c) => c.id === id)) return;
    if (this.#state.held === id) return;
    this.#set({ held: id, raised: id === null ? this.#state.raised : false });
  }

  newest(): Card | undefined {
    return this.#state.cards.at(-1);
  }

  #set(patch: Partial<CardsState>): void {
    this.#state = { ...this.#state, ...patch };
    for (const listener of this.#listeners) listener();
  }
}

/** One hand per window — it is the frame's, not a plugin's. */
export const cardsStore = new CardStore();

export function useCards(store: CardStore): CardsState {
  return useSyncExternalStore(
    (onChange) => store.subscribe(onChange),
    () => store.snapshot(),
    () => store.snapshot(),
  );
}
