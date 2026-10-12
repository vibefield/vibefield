import type { GodviewDeckState } from "../frame/deck-door";

// THE TERMINALS' STATE (Godview round 3 — GV-D5, GV-D6; DESIGN.md §8
// "Minimized" and "Called up"). The wrapper around the terminals is away, up or
// maximized; the overlay owns it (L2), the stage draws it, and the frame's
// deck door says it. Two acts move it:
//
//   minimize — the Lip's button: the terminals go fully away. Every session
//              keeps running (a pane is a viewport, never the session).
//   call     — any session brought to the terminals (a body, a row, a column,
//              a lane, a search result, History's acts, ⌘T, the bloom): away,
//              they come back up AS THEY WERE LEFT; showing, nothing moves.
//
// Both are names only. The place the viewer left the edge is the edge's
// (`deck-edge.ts`, the viewer's own memory), and neither act takes or moves
// it — which is what "as they were left" means for the top.

export type DeckAct = "minimize" | "call";

export function deckAfter(state: GodviewDeckState, act: DeckAct): GodviewDeckState {
  if (act === "minimize") return "away";
  return state === "away" ? "up" : state;
}

/** The rise and the fall (DESIGN.md §6 "The terminals rise and fall"): the
 * travels' lengths, which `godview.css` carries as their transitions. A
 * travel's end is a timer — its length and the grace below — never
 * `transitionend`: a transition that never ran (a hidden window, reduced
 * motion) must still end. */
export const DECK_RISE_MS = 480;
export const DECK_FALL_MS = 300;
/** Two frames past a travel's length before its end changes the layout, so a
 * fall's fastest frame (the retract curve ends fast) is drawn, not cut. */
export const DECK_TRAVEL_GRACE_MS = 34;

/** For the run, not the viewer (L3): the window's session storage, so a
 * renderer reload keeps what was left and a launch starts afresh. */
export const DECK_STATE_STORAGE_KEY = "vf-godview-deck-state-v1";

const STATES: readonly GodviewDeckState[] = ["away", "up", "maximized"];

/** What this run left, or up — what a launch opens with, as today. (GV-D5's
 * "monitor alone at launch" is the launch slice's, W7.) */
export function storedDeckState(): GodviewDeckState {
  try {
    const raw = sessionStorage.getItem(DECK_STATE_STORAGE_KEY);
    return STATES.find((state) => state === raw) ?? "up";
  } catch {
    return "up";
  }
}

export function storeDeckState(state: GodviewDeckState): void {
  try {
    if (state === "up") sessionStorage.removeItem(DECK_STATE_STORAGE_KEY);
    else sessionStorage.setItem(DECK_STATE_STORAGE_KEY, state);
  } catch {
    // A storage that refuses costs the reload its memory, never the state.
  }
}
