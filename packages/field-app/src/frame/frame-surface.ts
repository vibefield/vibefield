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
// this one value (DESIGN.md §10).

export type FrameSurface =
  /** Objects — on this build the widget tray's sheet behind the line. */
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
  | "artifacts";

/** What a surface's own close asks of the owner: fold it if it is the one
 * open, and leave the others alone — the tray's Esc must not close @'s list. */
export function foldSurface(
  current: FrameSurface | null,
  closing: FrameSurface,
): FrameSurface | null {
  return current === closing ? null : current;
}
