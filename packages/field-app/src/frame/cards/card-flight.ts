import { CARD_H, CARD_W } from "./cards-model";
import type { DealFrom } from "./cards-store";

/**
 * The deal (track HN; DESIGN.md §8 "The hand", Where cards come from; §6): a copy leaves its
 * source as the card it will be — centred on the source's box and scaled to it — and arcs into its
 * place in the hand in 560ms, a small toss on the way: across on the island curve, up on the arc's
 * own curve (cards.css), and it leaves turned and the pop brings it in straight. A card with no box
 * to leave from rises into its place from the window's foot (CardsView). One element per card and
 * CSS transitions (M3: a stalled compositor still ends in the end state), landed by a timer of the
 * flight's length.
 *
 * What the clipboard tray's fly-in learned on its first live capture (2026-09-23) moved here with
 * the deal: a snapshot's result lands while the tool's overlay has just left the screen and the
 * window may not be visible yet — so a flight WAITS for the document to be visible (with a bound)
 * rather than running unseen; and its start is committed by a forced reflow, never on an
 * animation frame, because a window that is occluded or has not painted yet fires no frames.
 */

export const DEAL_MS = 560;
/** The flight's worst case: its length and a little more, and the card is home regardless. */
export const DEAL_SETTLE_MS = 640;
/** How long a deal waits for the window to become visible before flying anyway. */
export const DEAL_VISIBILITY_WAIT_MS = 1500;
/** It leaves its source turned this far, and lands straight. */
export const DEAL_TOSS_DEG = -7;

export interface DealStart {
  /** the card's left and top edges, window px, before its scale */
  readonly x: number;
  readonly y: number;
  readonly scale: number;
  /** degrees */
  readonly turn: number;
}

/** Where a dealt card starts: centred on its source's box and scaled to it — never under 0.6 or
 * over 1.3 of its own size — turned for the toss. PURE. */
export function dealStart(from: DealFrom): DealStart {
  const fit = Math.min(from.width / CARD_W, from.height / CARD_H);
  return {
    x: from.left + from.width / 2 - CARD_W / 2,
    y: from.top + from.height / 2 - CARD_H / 2,
    scale: Math.max(0.6, Math.min(1.3, fit)),
    turn: DEAL_TOSS_DEG,
  };
}

/** Resolves once the document is visible, or after `maxWaitMs` regardless. */
export function whenVisible(doc: Document, maxWaitMs = DEAL_VISIBILITY_WAIT_MS): Promise<void> {
  if (doc.visibilityState !== "hidden") return Promise.resolve();
  const view = doc.defaultView;
  return new Promise<void>((resolve) => {
    let done = false;
    const finish = (): void => {
      if (done) return;
      done = true;
      doc.removeEventListener("visibilitychange", onChange);
      resolve();
    };
    const onChange = (): void => {
      if (doc.visibilityState !== "hidden") finish();
    };
    doc.addEventListener("visibilitychange", onChange);
    view?.setTimeout(finish, maxWaitMs);
  });
}

/** Force the element's current style to be computed and committed, so a change made after it is
 * a transition from it — no animation frame needed, and none may come. */
export function settle(el: Element | null): void {
  if (el === null) return;
  void el.getBoundingClientRect();
  if (el instanceof HTMLElement) void el.offsetWidth;
}
