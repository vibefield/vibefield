import { GHOSTTEA_PANE_SELECTOR } from "@vibefield/puppeteer-views";
import { type CardTarget, TARGET_LAYER } from "../frame/cards/card-targets";
import { nothingToGive, paneTextOf, stillOf } from "../frame/cards/card-text";
import { OUTCOME_WORDS, TARGET_WORDS } from "../frame/cards/cards-words";
import {
  claimingRefusals,
  getGodviewLineDoor,
  inputRefusalNote,
  type LineViewDoor,
} from "../frame/line-door";
import { type FieldHost, stillKept } from "../host";
import { hearTerminalInputRefusals, type RoutedInputRefusal } from "../terminal/pool";

// GODVIEW'S PANES TAKE A CARD (HN-4; DESIGN.md §8 "The hand", where cards go). ONE place over the
// deck's own element, registered by the deck while it is on screen. The pane is found at the point
// the card is held over — a deck's panes come, go and zoom, so there is never a place per pane —
// and the card plays through the deck's door (`pasteInto`), the road ⌘V takes: bracketed when the
// program asked for it, Return never pressed, the D6 refusal said once, in the play's own outcome.

/** A card spring-loaded into Godview lands while the pane's routed input may still be reopening
 * after the change of view: this long it waits for it, then says the pane is not taking input. */
export const PANE_INPUT_WAIT_MS = 1_500;

export interface PaneCardTargetDeps {
  /** The deck's own element, the zoom host its panes lie in. */
  readonly root: () => HTMLElement | null;
  /** The deck's door (undefined: the one the deck published). */
  readonly door?: () => LineViewDoor | null;
  /** D6 — where a paste the terminal refused is heard (undefined: the window's terminal pool). */
  readonly inputRefusals?: (hear: (refusal: RoutedInputRefusal) => void) => () => void;
  /** The shell's still door, asked whether a snapshot's still is kept (undefined: the window's
   * host). */
  readonly host?: Pick<FieldHost, "screenshotStillKept">;
}

/** The pane under a window point: the deck's panes as ghosttea lays them out (their chrome is
 * portalled inside them), passing over a zoomed pane's siblings, which keep their boxes hidden
 * (deck-zoom.css). */
export function paneAt(
  root: ParentNode,
  at: { readonly x: number; readonly y: number },
): { readonly paneId: string; readonly element: HTMLElement } | null {
  for (const element of root.querySelectorAll<HTMLElement>(GHOSTTEA_PANE_SELECTOR)) {
    const paneId = element.dataset.paneId;
    if (paneId === undefined || getComputedStyle(element).visibility === "hidden") continue;
    const r = element.getBoundingClientRect();
    if (at.x >= r.left && at.x < r.right && at.y >= r.top && at.y < r.bottom) {
      return { paneId, element };
    }
  }
  return null;
}

/** The deck's panes as a place a card plays into. */
export function paneCardTarget(deps: PaneCardTargetDeps): CardTarget {
  const doorOf = (): LineViewDoor | null =>
    deps.door === undefined ? getGodviewLineDoor() : deps.door();
  /** The pane under the point, as the door names it. */
  const paneUnder = (at: { readonly x: number; readonly y: number }) => {
    const root = deps.root();
    const hit = root === null ? null : paneAt(root, at);
    const pane = hit === null ? undefined : doorOf()?.panes.find((p) => p.paneId === hit.paneId);
    return hit === null || pane === undefined ? null : { pane, element: hit.element };
  };
  return {
    id: "godview-panes",
    kind: "pane",
    layer: TARGET_LAYER.pane,
    rect: () => {
      const root = deps.root();
      // away, under the last run's curtain or under another view's cover, the deck is inert
      return root === null || root.closest("[inert]") !== null
        ? null
        : root.getBoundingClientRect();
    },
    element: deps.root,
    answer: (card, at) => {
      const under = paneUnder(at);
      if (under === null) return null;
      const ring = under.element.getBoundingClientRect();
      // a card from another app says what it holds only once it is let go (B2)
      return card.waiting !== true && paneTextOf(card) === null
        ? { ok: false, label: nothingToGive(card), ring }
        : { ok: true, label: TARGET_WORDS.pane(under.pane.name), ring };
    },
    play: async (card, at) => {
      const door = doorOf();
      const under = paneUnder(at);
      if (door === null || under === null) return { ok: false, note: OUTCOME_WORDS.paneGone };
      const { pane } = under;
      const text = paneTextOf(card);
      if (text === null) return { ok: false, note: nothingToGive(card) };
      // a snapshot's path names its still only while main keeps it (`stillOf`): a pane is never
      // handed a path to nothing
      const still = stillOf(card);
      if (still !== null && !(await stillKept(still, deps.host))) {
        return { ok: false, note: OUTCOME_WORDS.pasteGone };
      }
      if (!(await door.whenInputOpen(pane.paneId, PANE_INPUT_WAIT_MS))) {
        return { ok: false, note: OUTCOME_WORDS.notTaking(pane.name) };
      }
      // D6 — a paste too large for the pane's terminal is refused INSIDE the call, so whatever is
      // refused while it runs is this paste's, whichever session the pane shows by now (it may
      // have changed while the card waited): heard here, it is this play's outcome, and the line's
      // hearer leaves it to it (said once, HN-L5)
      const heard: { refusal: RoutedInputRefusal | null } = { refusal: null };
      const stop = (deps.inputRefusals ?? hearTerminalInputRefusals)((refusal) => {
        heard.refusal = refusal;
      });
      let took = false;
      try {
        took = claimingRefusals(() => door.pasteInto(pane.paneId, text));
      } finally {
        stop();
      }
      if (heard.refusal !== null) {
        return { ok: false, note: inputRefusalNote(heard.refusal, pane.name), stand: "read" };
      }
      return took
        ? { ok: true, note: OUTCOME_WORDS.pasted(pane.name) }
        : { ok: false, note: OUTCOME_WORDS.notTaking(pane.name) };
    },
  };
}
