import type { Card } from "./cards-model";

/**
 * Where a card can be played (DESIGN.md §8 "The hand", Where cards go): every
 * place that takes a card registers here while it is on screen — a Godview pane
 * (its text pasted at the prompt), Chat's prompt (a chip in the sentence), the
 * desk (a note or a print, HN-D7) — and the drag asks the registry what is under
 * the pointer. A place answers a card before it is let go (HN-L5: a refusal is
 * said in words, under the pointer), then plays a COPY in (HN-D4: the card
 * stays in the hand).
 */

export type CardTargetKind = "pane" | "prompt" | "desk";

/** What a place says to a carried card. `ring`: where its select ring is drawn
 * when that is not the place's whole box — the one pane of a deck under the
 * point, say; absent, the ring is drawn on `rect()`. */
export type CardAnswer =
  | { readonly ok: true; readonly label: string; readonly ring?: DOMRect }
  | { readonly ok: false; readonly label: string; readonly ring?: DOMRect };

export interface CardPlayed {
  readonly ok: boolean;
  /** the outcome as the status line says it, once: "Pasted into claude·2" */
  readonly note: string;
}

export interface CardTarget {
  readonly id: string;
  readonly kind: CardTargetKind;
  /** Above whom it answers: a pane or the prompt over the desk under them. */
  readonly layer: number;
  /** Its box in window px, read when asked (it moves with its view). */
  rect(): DOMRect | null;
  /** Its element, when it has one. Only what is on top answers (HN-L5): where
   * the element under the pointer is not inside this one — the line, the head
   * or the hand stand over it there — it takes no card. */
  element?(): Element | null;
  /** What it says to this card let go at this window point; null when no part
   * of it that takes a card is there (between two panes of a deck). */
  answer(card: Card, at: { readonly x: number; readonly y: number }): CardAnswer | null;
  /** Play a copy of the card in, let go at this window point. */
  play(card: Card, at: { readonly x: number; readonly y: number }): Promise<CardPlayed>;
}

export const TARGET_LAYER = { desk: 10, pane: 30, prompt: 30 } as const;

export class CardTargets {
  readonly #targets = new Map<string, CardTarget>();

  /** Register a place while it is on screen; the returned call removes it. */
  register(target: CardTarget): () => void {
    this.#targets.set(target.id, target);
    return () => {
      if (this.#targets.get(target.id) === target) this.#targets.delete(target.id);
    };
  }

  /** The topmost place under a window point, or null. Given the element on top
   * there (`document.elementsFromPoint`'s first; null for none), a place with
   * an element answers only when that element lies inside it. */
  at(x: number, y: number, top?: Element | null): CardTarget | null {
    let best: CardTarget | null = null;
    for (const target of this.#targets.values()) {
      const r = target.rect();
      if (r === null || x < r.left || x >= r.right || y < r.top || y >= r.bottom) continue;
      if (top !== undefined && !onTop(target, top)) continue;
      if (best === null || target.layer > best.layer) best = target;
    }
    return best;
  }

  list(): readonly CardTarget[] {
    return [...this.#targets.values()];
  }
}

function onTop(target: CardTarget, top: Element | null): boolean {
  const element = target.element?.() ?? null;
  return element === null || (top !== null && element.contains(top));
}

/** The window's one registry, beside the hand's store. */
export const cardTargets = new CardTargets();
