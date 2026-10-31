import { getGodviewLineDoor, type LineViewDoor, sayOnLine } from "../line-door";
import { type CardPlayed, type CardTarget, type CardTargets, cardTargets } from "./card-targets";
import { textCardOf } from "./cards-model";
import { dealCard } from "./cards-sources";
import { type CardStore, cardsStore } from "./cards-store";

// THE HAND'S LAB DOOR (`window.__vfCards`; R-T 2). The CANVAS_READY bargain
// (development-console.ts), struck as the desk's door strikes it
// (`window.__vfDesk`, desk-door.ts) and installed as that one is — on every
// mount, no switch: a headless smoke has no hands to carry a card with, so the
// hand lends one narrow surface that holds no authority the renderer's own code
// lacks. Deal a text card as any source deals one (`dealCard`); play the newest
// through the place a drop finds at a pane's centre — the registry the drag
// asks, hit-tested as the drag hit-tests, so the deck's own `paneCardTarget`
// answers and pastes (the road ⌘V takes, Return never pressed) — and say its
// outcome on the line as a drop's is; empty the hand. smoke:godview's 11h plays
// a shell line into the active pane through it; smoke:canvas empties the hand
// after its Copy rows.

/** What a play through the lab came to, as plain data a harness carries across
 * `executeJavaScript` (a place's ring, a DOMRect, would not cross). */
export interface CardsLabPlay {
  /** Where the card was let go — the pane's centre, window px; null with no pane to aim at. */
  readonly at: { readonly x: number; readonly y: number } | null;
  /** The place on top there, by its kind; null with none. */
  readonly target: CardTarget["kind"] | null;
  /** What that place said to the card before it was let go. */
  readonly answer: { readonly ok: boolean; readonly label: string } | null;
  /** The play's outcome, said on the line; null when nothing was played. */
  readonly played: CardPlayed | null;
  /** Why nothing was played, in the harness's words; null when it was. */
  readonly refused: string | null;
}

export interface CardsLab {
  /** Deal `text` into the hand as a text card, as a paste from another app
   * deals one (no box: it rises into its place); answers the newest card's id. */
  deal(text: string): string | null;
  /** Play the newest card onto the deck's pane showing floor session
   * `sessionId` — the active pane when two show it — let go at its centre. */
  playInto(sessionId: string): Promise<CardsLabPlay>;
  /** Empty the hand: nothing held, the hand lowered, every card removed (each
   * leaves as a removed card leaves); answers how many there were. */
  clear(): number;
}

/** What the lab works through (undefined: the window's own). */
export interface CardsLabSeams {
  readonly store?: CardStore;
  readonly targets?: CardTargets;
  /** The deck's door — its panes, by session (undefined: the one the deck published). */
  readonly door?: () => LineViewDoor | null;
}

declare global {
  interface Window {
    __vfCards?: CardsLab;
  }
}

const NOTHING_PLAYED = { at: null, target: null, answer: null, played: null } as const;

/** The pane's box as the deck lays it out, by the deck's own mark (`[data-pane-id]`,
 * the one `line-panes.ts` pastes through); null when it is not in the document. */
function paneBox(paneId: string): DOMRect | null {
  if (typeof document === "undefined") return null;
  const id =
    typeof CSS !== "undefined" && typeof CSS.escape === "function" ? CSS.escape(paneId) : paneId;
  return document.querySelector(`[data-pane-id="${id}"]`)?.getBoundingClientRect() ?? null;
}

/** The element on top at a point, as the drag reads it (`card-drag.ts`): the first
 * of `elementsFromPoint`, or undefined in a DOM with no layout (a test's). */
function topAt(x: number, y: number): Element | null | undefined {
  return typeof document !== "undefined" && typeof document.elementsFromPoint === "function"
    ? (document.elementsFromPoint(x, y)[0] ?? null)
    : undefined;
}

/** An element as a refusal names it: its tag and its first class. */
function named(element: Element | null | undefined): string {
  if (element === null || element === undefined) return "nothing";
  const tag = element.tagName.toLowerCase();
  const first = element.classList[0];
  return first === undefined ? tag : `${tag}.${first}`;
}

/** The lab over a hand, the places that take its cards, and the deck's door. */
export function cardsLab(seams: CardsLabSeams = {}): CardsLab {
  const store = seams.store ?? cardsStore;
  const targets = seams.targets ?? cardTargets;
  const doorOf = seams.door ?? getGodviewLineDoor;
  return {
    deal: (text) => {
      const card = textCardOf(text, {
        id: store.nextId("text"),
        origin: { view: "outside", how: "paste" },
        at: store.now(),
      });
      dealCard(card, null, store);
      return store.newest()?.id ?? null;
    },
    playInto: async (sessionId) => {
      const card = store.newest();
      if (card === undefined) return { ...NOTHING_PLAYED, refused: "the hand holds no card" };
      const panes = doorOf()?.panes ?? [];
      const pane =
        panes.find((p) => p.sessionId === sessionId && p.active) ??
        panes.find((p) => p.sessionId === sessionId);
      const box = pane === undefined ? null : paneBox(pane.paneId);
      if (box === null || box.width === 0 || box.height === 0) {
        return { ...NOTHING_PLAYED, refused: `the deck shows no pane of session ${sessionId}` };
      }
      const at = { x: box.left + box.width / 2, y: box.top + box.height / 2 };
      const top = topAt(at.x, at.y);
      const target = targets.at(at.x, at.y, top);
      if (target === null) {
        const refused = `no place takes a card there — ${named(top)} is on top`;
        return { ...NOTHING_PLAYED, at, refused };
      }
      const said = target.answer(card, at);
      const answer = said === null ? null : { ok: said.ok, label: said.label };
      if (said === null || !said.ok) {
        const refused = said?.label ?? "the place said nothing to the card";
        return { at, target: target.kind, answer, played: null, refused };
      }
      const played = await target.play(card, at);
      if (played.note !== "") sayOnLine(played.note);
      return {
        at,
        target: target.kind,
        answer,
        played: { ok: played.ok, note: played.note },
        refused: null,
      };
    },
    clear: () => {
      const { cards } = store.snapshot();
      store.pickUp(null);
      store.raise(false);
      for (const card of cards) store.remove(card.id);
      return cards.length;
    },
  };
}

/** Install `window.__vfCards` for one line; the returned undo removes it if it
 * is still this one's. */
export function installCardsLab(seams: CardsLabSeams = {}): () => void {
  if (typeof window === "undefined") return () => undefined;
  const lab = cardsLab(seams);
  window.__vfCards = lab;
  return () => {
    if (window.__vfCards === lab) delete window.__vfCards;
  };
}
