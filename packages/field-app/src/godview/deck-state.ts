import { emitGodviewDeckLabMarker, godviewMarkersEnabled } from "../development-console";
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
//   maximize — the Lip's maximize, an edge let go above the fill line or flung
//              up (GV-D11): the terminals take the window, their bar its
//              title bar.
//   restore  — the title bar's restore, a drag or a key out of it: up again.
//
// All are names only. The place the viewer left the edge is the edge's
// (`deck-edge.ts`, the viewer's own memory), and neither act takes or moves
// it — which is what "as they were left" means for the top.

export type DeckAct = "minimize" | "call" | "maximize" | "restore";

export function deckAfter(state: GodviewDeckState, act: DeckAct): GodviewDeckState {
  switch (act) {
    case "minimize":
      return "away";
    case "maximize":
      return "maximized";
    case "restore":
      return state === "maximized" ? "up" : state;
    case "call":
      return state === "away" ? "up" : state;
  }
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

/** What this run left, or away — what a launch opens with (GV-D5, W7: the
 * monitor alone at launch, then as you left it). */
export function storedDeckState(): GodviewDeckState {
  try {
    const raw = sessionStorage.getItem(DECK_STATE_STORAGE_KEY);
    return STATES.find((state) => state === raw) ?? "away";
  } catch {
    return "away";
  }
}

export function storeDeckState(state: GodviewDeckState): void {
  try {
    if (state === "away") sessionStorage.removeItem(DECK_STATE_STORAGE_KEY);
    else sessionStorage.setItem(DECK_STATE_STORAGE_KEY, state);
  } catch {
    // A storage that refuses costs the reload its memory, never the state.
  }
}

// THE LAB'S CALL (W7 — the MV lead's three conditions, 2026-10-12). A launch
// opens on the monitor alone, so a lab that measures the terminals brings them
// up first, as any call does — through this, and only under the Godview
// markers (the smokes and the labs): product code never reads it. It is there
// from the overlay's mount, which is the frame's — before Godview first shows.
// `up()` is safe to call at any time and any number of times (up while up or
// maximized moves nothing), never throws (a throw inside is said on the
// markers, GODVIEW_DECK_LAB) and answers nothing a lab could lean on: a lab
// judges the deck by its marker, GODVIEW_DECK, whose wrapper says
// `raisedBy: "lab"` when this call is what brought the terminals up from away,
// and whose `consent` and `error` say what stands between the call and a pane.

export interface GodviewDeckLab {
  up(): void;
}

declare global {
  interface Window {
    __vfGodviewDeck?: GodviewDeckLab;
  }
}

/** Install the lab's call while the Godview markers are on; the return takes
 * it away again (and only it). Off, nothing is installed. */
export function installGodviewDeckLab(up: () => void): () => void {
  if (typeof window === "undefined" || !godviewMarkersEnabled()) return () => undefined;
  const lab: GodviewDeckLab = {
    up: () => {
      try {
        up();
      } catch (cause) {
        emitGodviewDeckLabMarker({
          up: "threw",
          reason: cause instanceof Error ? cause.message : String(cause),
        });
      }
    },
  };
  window.__vfGodviewDeck = lab;
  return () => {
    if (window.__vfGodviewDeck === lab) delete window.__vfGodviewDeck;
  };
}
