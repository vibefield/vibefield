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
// this one value (DESIGN.md §10). Until the Peek lands, History's search — the
// room's own sheet (the search interim, 2026-10-04; DESIGN.md §8 "History") —
// is in it too, so the palette, a drawer, the Me menu, Settings and a change
// of view fold the sheet, and opening it folds them. DK-11: the selection
// bar's grown menu joins them — the canon's ninth (DESIGN.md §10 "The mat's
// places", R5), the tenth value beside History's interim sheet.

export type FrameSurface =
  /** Objects — the desk's pegboard behind the line (DK-13): the board out is this surface; the tray's `open` is
   * the truth and this follows it (`field/desk/pegboard/Pegboard.tsx`). */
  | "objects"
  /** @'s list, grown upward from the caret. */
  | "at"
  /** The fields explorer, grown from the head's name pill. */
  | "fields"
  /** The zoom's menu, grown from the head's readout. */
  | "zoom"
  /** The palette (⌘K), under the head. */
  | "palette"
  /** The Me menu, above the line, over your face in the corner. */
  | "me"
  /** The left edge's drawer: the clipboard. */
  | "clipboard"
  /** The right edge's drawer: Artifacts (the Artifact Hub). */
  | "artifacts"
  /** History's search until the Peek lands: the room's own sheet, grown from
   * its strip's launcher (`history/search.ts`). Dated; it leaves with the
   * interim. */
  | "history-search"
  /** The selection bar grown into its menu, by More or a right-click (DK-11;
   * DESIGN.md §10 "The mat's places": the one owner's ninth, R5) — the bar
   * over the desk's selection, never the frame's own. */
  | "selection";

/** What a surface's own close asks of the owner: fold it if it is the one
 * open, and leave the others alone — the tray's Esc must not close @'s list. */
export function foldSurface(
  current: FrameSurface | null,
  closing: FrameSurface,
): FrameSurface | null {
  return current === closing ? null : current;
}
