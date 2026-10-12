// WHERE A SESSION WITH NO PANE OPENS (GV-D4, James 2026-10-02; DESIGN.md §8,
// the deck: "A session with no pane").
//
// One rule for every door that brings a session into the terminals — a body, a
// list row, a rain column, a timeline lane, a spend row, a search result,
// History's Resume and Jump to, the Peek's Open, a peer's attach — and for a
// new terminal (the line's ⌘T, the swarm's bloom):
//
//   · already in a pane: that pane is focused, and nothing is mounted twice;
//   · fewer than three panes showing: it opens BESIDE the focused pane;
//   · three or more: it takes the focused pane's place (the session it
//     displaces keeps running — a pane is a viewport, never the session).
//
// Pure, so it is tested alone (`test/godview-deck-placement.test.ts`). The
// deck (`GodviewDeck.tsx`) reads the workspace's panes at call time, asks this,
// and does the answer with ghosttea's own verbs: its split of the active pane
// for `beside` (the one ⌘D makes: to the right, the row equalized), its mount
// for `replace`, its activation for `focus`. The ruled drawing's code is
// `draft/one-frame/src/kit/gv3.js` `placeSession`; where the two differ — the
// drawing pushes onto a flat row, ghosttea splits the focused pane — the
// ruling's own words decide: beside the FOCUSED pane.
//
// The cap is this rule's alone (the lead's L4): ⌘D still splits without
// limit, and past three panes a session with no pane replaces the focused one.
//
// One pane is EMPTY (N16 (a), the lead's rule, 2026-10-12): the last pane ⌘W
// emptied — a fresh, unused shell with the launcher over it. While it is the
// focused pane, the next session, or a new terminal, takes its place.

/** How many panes a session with no pane is opened beside: with this many
 * showing, the next takes the focused pane's place. */
export const DECK_PLACEMENT_PANES = 3;

/** A pane the deck shows, as far as the rule reads it. */
export interface DeckPaneShown {
  readonly id: string;
  /** The floor session the pane shows (two panes may mirror one). */
  readonly sessionId: string;
}

export interface DeckShape {
  /** Every pane in the deck's layout, in its order. A pane behind a fullscreen
   * one is still a pane: the cap counts the layout, not what a zoom covers. */
  readonly panes: readonly DeckPaneShown[];
  readonly focusedPaneId: string | undefined;
  /** The pane ⌘W on the last pane emptied (N16 (a)), while it still is. */
  readonly emptyPaneId?: string | undefined;
}

export type DeckPlacement =
  /** Already shown: this pane is focused where it is. */
  | { readonly kind: "focus"; readonly paneId: string }
  /** A new pane beside this one — the focused pane. */
  | { readonly kind: "beside"; readonly paneId: string }
  /** This pane — the focused one — shows it instead of what it showed. */
  | { readonly kind: "replace"; readonly paneId: string }
  /** No pane to place by: the deck has none, or none of them is focused. */
  | { readonly kind: "none" };

/** How a placed session came to its pane — the rule's own three answers, as an
 * outcome carries them. */
export type DeckPlaced = Exclude<DeckPlacement["kind"], "none">;

/** Where `sessionId` opens in a deck of this shape. Without a `sessionId` the
 * question is a new terminal's, which no pane can show yet. */
export function deckPlacement(shape: DeckShape, sessionId?: string): DeckPlacement {
  const focused = shape.panes.find((pane) => pane.id === shape.focusedPaneId);
  if (sessionId !== undefined) {
    // never mounted twice: where the person is if that pane shows it, else the
    // first pane that does (the one ghosttea's own activation picks)
    const showing =
      focused?.sessionId === sessionId
        ? focused
        : shape.panes.find((pane) => pane.sessionId === sessionId);
    if (showing !== undefined) return { kind: "focus", paneId: showing.id };
  }
  if (focused === undefined) return { kind: "none" };
  if (focused.id === shape.emptyPaneId) return { kind: "replace", paneId: focused.id };
  return shape.panes.length < DECK_PLACEMENT_PANES
    ? { kind: "beside", paneId: focused.id }
    : { kind: "replace", paneId: focused.id };
}
