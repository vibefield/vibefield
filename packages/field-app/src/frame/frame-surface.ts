// The surfaces the frame opens (One Frame FR-4, "one surface at a time";
// DESIGN.md §8 "The line" and "The head", §10). ONE owner holds which of them
// is open — FieldView, because the field's recede derives from Objects and the
// fields explorer in the same render (a callback up would land it a frame
// late) — and it holds them as ONE value, so opening any one folds the rest by
// construction rather than by effects racing each other.
//
// FR-2 built it as the LINE's owner (Objects and @'s list); FR-3 renamed it
// the FRAME's when the head's three surfaces joined; FR-4 added the corner's
// Me menu and the two edges' drawers, so every surface the frame opens is in
// this one value (DESIGN.md §10). The Peek (2026-10-08, GV-D8) is in it too —
// search, the frame's popup — so the palette, a drawer, the Me menu, Settings
// and a change of view fold it, and opening it folds them; it replaced the
// search interim's `history-search`, the room's own sheet, which left with it.
// DK-11: the selection bar's grown menu joins them — the canon's ninth
// (DESIGN.md §10 "The mat's places", R5), the tenth value beside the Peek's.
// HN (Cards in Hand, 2026-10-29): @'s list left with the line's draft (LN-D3)
// and the left drawer with the clipboard tray; the hand raised, or a card
// picked up, is `cards` (HN-L7).

export type FrameSurface =
  /** Objects — the desk's pegboard behind the line (DK-13): the board out is this surface; the tray's `open` is
   * the truth and this follows it (`field/desk/pegboard/Pegboard.tsx`). */
  | "objects"
  /** The fields explorer, grown from the head's name pill. */
  | "fields"
  /** The zoom's menu, grown from the head's readout. */
  | "zoom"
  /** The palette (⌘K), under the head. */
  | "palette"
  /** The Me menu, above the line, over your face in the corner. */
  | "me"
  /** The hand raised (⇧⌘V), or a card picked up (HN-D5) — the frame's cards
   * (DESIGN.md §8 "The hand"; HN-L7). */
  | "cards"
  /** The right edge's drawer: Artifacts (the Artifact Hub). */
  | "artifacts"
  /** Search — the Peek: the frame's popup over the scrim, opened by its
   * button or ⌘F (`Peek.tsx`; DESIGN.md §8 "Search — the Peek"). */
  | "search"
  /** The selection bar grown into its menu, by More or a right-click (DK-11;
   * DESIGN.md §10 "The mat's places": the one owner's ninth, R5) — the bar
   * over the desk's selection, never the frame's own. */
  | "selection";

/** What a surface's own close asks of the owner: fold it if it is the one
 * open, and leave the others alone — the board's Esc must not close the palette. */
export function foldSurface(
  current: FrameSurface | null,
  closing: FrameSurface,
): FrameSurface | null {
  return current === closing ? null : current;
}
