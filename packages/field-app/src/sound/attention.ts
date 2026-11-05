import { SOUND_ATTENTION, type SoundAttention } from "@vibefield/contracts";
import type { LinePane } from "../frame/line-door";

// SD-2 (DESIGN.md §14 rules 3 and 9; SD-D11, SD-D12) — what the window tells main about its agents: which floor
// session you are typing into, and where each shown session sits across the window, −1 (left) … 1 (right). The
// window only reads its deck (the line door's panes, active first, and each pane's box by `[data-pane-id]`); main maps
// sessions to runs and snaps a place to the five baked places. Off screen, it says nothing: the sounds come from the
// centre.

export interface SoundAttentionInput {
  readonly panes: readonly LinePane[];
  readonly rectOf: (paneId: string) => { readonly left: number; readonly width: number } | null;
  readonly windowWidth: number;
  /** The window has the keyboard. */
  readonly hasFocus: boolean;
  /** The deck is on screen. */
  readonly onScreen: boolean;
}

const fits = (id: string): boolean => id.length > 0 && id.length <= SOUND_ATTENTION.MAX_ID;

export function soundAttentionOf(input: SoundAttentionInput): SoundAttention {
  if (!input.onScreen || !(input.windowWidth > 0)) return { focused: null, places: {} };
  const active = input.panes.find((pane) => pane.active);
  const focused =
    input.hasFocus && active !== undefined && fits(active.sessionId) ? active.sessionId : null;
  const places: Record<string, number> = {};
  let count = 0;
  // the panes come active first, so a session shown twice is placed by the pane you were in
  for (const pane of input.panes) {
    if (count >= SOUND_ATTENTION.MAX_PLACES) break;
    if (!fits(pane.sessionId) || pane.sessionId in places) continue;
    const box = input.rectOf(pane.paneId);
    if (box === null) continue;
    const centre = box.left + box.width / 2;
    const place = (centre / input.windowWidth) * 2 - 1;
    if (!Number.isFinite(place)) continue;
    places[pane.sessionId] = Math.max(-1, Math.min(1, place));
    count++;
  }
  return { focused, places };
}
