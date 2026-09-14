import { type RefObject, useCallback, useLayoutEffect, useRef, useState } from "react";
import { browserZoomHost, DeckZoomController, type DeckZoomState } from "./deck-zoom";

// The zoom GESTURE — the chord that has to be taken away from upstream, and the
// controller's phase projected for whoever draws the affordance.
//
// It used to ship its own affordance too: an overlay chip over the deck naming
// the active pane, put there because ghosttea's `decoratePane` seam spends its
// whole vocabulary on a label and an accent colour, so there was no per-pane
// action slot to put a control in. GT-6 opened one — the record's frame (§07) is
// portalled INTO each pane and carries the fullscreen verb — so at GT-6a the
// chip was retired and this module kept only what a verb cannot own: a window
// listener that outranks the library's, and the phase the frame reads back.
//
// KNOWN GAP, upstream's to close (named at GT-6a): the package draws the
// fullscreen verb only where the frame has a stop-or-resume verb to draw it
// beside (`views/src/deck/PaneFrame.tsx` — `showZoom = model.verb !== undefined
// && verbs.zoom !== undefined`, and `pane-frame.ts:23` gives a shell no verb),
// so a BARE SHELL pane now has no pointer path to zoom and only the chord. The
// record's own spec table says the verbs draw "the ink at 70% for a bare shell",
// so this is the package catching up to §07, not a VibeField decision to undo.

/** The chord ghosttea's own default catalogue binds `toggle_split_zoom` to
 * (`bindings/fixtures/keybinds-macos-default.json:296` — `super+shift+enter`;
 * the linux catalogue binds the control-key spelling). Matched by modifier
 * rather than by name so both spellings land on the same gesture. */
function isZoomChord(event: KeyboardEvent): boolean {
  return event.key === "Enter" && event.shiftKey && (event.metaKey || event.ctrlKey);
}

export interface DeckZoom {
  readonly state: DeckZoomState;
  /** Zoom or restore a pane by ghosttea's own pane id. */
  toggle: (paneId: string) => void;
  /** Drop the zoom without animating (a pane closing under it, the deck going). */
  reset: () => void;
}

/**
 * The deck's zoom, wired to a host element.
 *
 * THE INTERCEPTION, stated plainly because it takes a key away from a library:
 * `GhostteaWorkspace` listens for hotkeys on `window` in the CAPTURE phase
 * (`workspace/Workspace.js:631`) and routes `toggle_split_zoom` to a zoom that
 * remounts the pane — see `deck-zoom.ts` for why that cannot be the mechanism
 * here. There is no prop to turn it off (the workspace destructures seventeen
 * and none of them is a binding set; its catalogue comes from the daemon
 * config), so the chord is claimed instead:
 *
 *   - registered from a LAYOUT effect, which React flushes during commit, while
 *     the workspace registers from a passive effect flushed afterwards — so
 *     this listener is always earlier in `window`'s capture list, whatever
 *     order the components mount in;
 *   - with an EMPTY dependency list and the live state behind a ref, so it is
 *     never removed and re-added — a re-registration would move it to the END
 *     of the list, behind the workspace's;
 *   - and it calls `stopImmediatePropagation`, which is the only thing that
 *     stops a sibling listener on the same target (`stopPropagation` would let
 *     the workspace's own capture listener run and zoom underneath us).
 *
 * If that ordering ever failed the symptom would be loud rather than subtle:
 * upstream's zoom remounts the deck's panes, so a broken interception looks
 * like every pane blinking, not like a slightly different animation.
 */
export function useDeckZoom(
  hostRef: RefObject<HTMLElement | null>,
  activePaneId: string | undefined,
  onState?: (state: DeckZoomState) => void,
): DeckZoom {
  const controller = useRef<DeckZoomController | null>(null);
  const activePane = useRef(activePaneId);
  activePane.current = activePaneId;
  const publish = useRef(onState);
  publish.current = onState;
  // The controller is a mutable object living outside the tree, so the phase it
  // is in has to be mirrored into state for the frame to re-label its verb. The
  // controller stays the source of truth: this is a projection of it, written
  // only from its own notification.
  const [state, setState] = useState<DeckZoomState>({ phase: "idle", paneId: null, commits: 0 });

  if (controller.current === null) {
    controller.current = new DeckZoomController(
      browserZoomHost(() => hostRef.current),
      (next) => {
        setState(next);
        publish.current?.(next);
      },
    );
  }
  const zoom = controller.current;

  const toggle = useCallback((paneId: string) => zoom.toggle(paneId), [zoom]);
  const reset = useCallback(() => zoom.reset(), [zoom]);

  useLayoutEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (!isZoomChord(event)) return;
      // Only while this deck is on screen: the overlay can be closed with the
      // window still focused, and a chord that zoomed an invisible pane would
      // be a resize the user never asked for.
      if (hostRef.current === null || hostRef.current.isConnected !== true) return;
      const paneId = activePane.current;
      if (paneId === undefined) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      zoom.toggle(paneId);
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [hostRef, zoom]);

  // A zoomed pane that goes away takes its zoom with it. The controller still
  // commits the layout off, because the attribute is on the deck's own wrapper
  // and would otherwise outlive the pane it was about.
  useLayoutEffect(() => {
    if (activePaneId === undefined) zoom.reset();
  }, [activePaneId, zoom]);

  useLayoutEffect(() => () => zoom.reset(), [zoom]);

  return { state, toggle, reset };
}
