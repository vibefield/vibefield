// WHERE A SESSION OPENS IN THE TERMINALS (GV-D4, RE-RULED 2026-10-18 23:33Z by
// James; DESIGN.md §8, the deck: "A session with no pane").
//
// Every pane is an observer, and what the person opens goes into the one they
// selected: "when i select a pane, and then click on any bubble, it should
// actually attach the clicked bubble to this terminal pane, because the
// meaning behind this action is that each pane is an window/observer, and it
// can monitor any of the sessions user want to observe". "Everywhere": one
// rule for every door that brings a session into the terminals — a body, a
// list row, a rain column, a timeline lane, a spend row, a search result,
// History's Resume and Jump to, the Peek's Open, a peer's attach — and for a
// new terminal (the line's ⌘T, the swarm's bloom):
//
//   · the focused pane already shows it: nothing moves (`focus`);
//   · else the focused pane shows it (`replace`), whatever the pane count —
//     and even when another pane shows it already ("Mirror it"): two panes on
//     one session, its PTY sized by the pane that holds the geometry seat
//     (DS-4). The session the focused pane showed keeps running — a pane is a
//     viewport, never the session;
//   · no focused pane: nowhere to place (`none`).
//
// It returns to GT-D17 (James 2026-08-05: "clicking a remote bubble attaches
// the CURRENT ACTIVE pane") and to the original Godview, whose select is "Show
// this agent in the active pane" (puppeteer `view-sdk/src/view.ts`) and whose
// panes mirror a session (`apps/godview` pane-attachments.ts). From 2026-10-11
// to this re-ruling GV-D4's 10-02 answer opened a session BESIDE the focused
// pane, up to three, and never mounted one twice — the never-twice came from
// the drawing's code, never from a ruling. ⌘D still splits without limit: it
// is the one deliberate way to more panes. The pane ⌘W emptied (N16 (a)) is a
// pane like any other here: focused, the rule replaces it.
//
// Pure, so it is tested alone (`test/godview-deck-placement.test.ts`). The
// deck (`GodviewDeck.tsx`) reads the workspace's panes at call time, asks this,
// and does the answer with ghosttea's own verb: its mount into the active pane
// (`mountSession`, which keeps one session in as many panes as show it).

/** A pane the deck shows, as far as the rule reads it. */
export interface DeckPaneShown {
  readonly id: string;
  /** The floor session the pane shows (two panes may mirror one). */
  readonly sessionId: string;
}

export interface DeckShape {
  /** Every pane in the deck's layout, in its order. */
  readonly panes: readonly DeckPaneShown[];
  readonly focusedPaneId: string | undefined;
}

export type DeckPlacement =
  /** The focused pane already shows it: nothing moves. */
  | { readonly kind: "focus"; readonly paneId: string }
  /** This pane — the focused one — shows it instead of what it showed: a
   * mirror when another pane shows it too. */
  | { readonly kind: "replace"; readonly paneId: string }
  /** No pane to place by: the deck has none, or none of them is focused. */
  | { readonly kind: "none" };

/** How a placed session came to its pane — the rule's own two answers, as an
 * outcome carries them. */
export type DeckPlaced = Exclude<DeckPlacement["kind"], "none">;

/** Where `sessionId` opens in a deck of this shape. Without a `sessionId` the
 * question is a new terminal's, which no pane can show yet. */
export function deckPlacement(shape: DeckShape, sessionId?: string): DeckPlacement {
  const focused = shape.panes.find((pane) => pane.id === shape.focusedPaneId);
  if (focused === undefined) return { kind: "none" };
  return sessionId !== undefined && focused.sessionId === sessionId
    ? { kind: "focus", paneId: focused.id }
    : { kind: "replace", paneId: focused.id };
}
