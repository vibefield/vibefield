// The surfaces the line opens (One Frame FR-4, "one surface at a time";
// DESIGN.md §8 "The line", §10). ONE owner holds which of them is open —
// FieldView, because the field's recede derives from Objects in the same
// render (a callback up would land it a frame late) — and it holds them as ONE
// value, so opening either folds the other by construction rather than by a
// pair of effects racing each other. FR-4 adds the Me menu and the edges'
// drawers to the union.

export type LineSurface =
  /** Objects — on this build the widget tray's sheet behind the line. */
  | "objects"
  /** @'s list, grown upward from the caret. */
  | "at";

/** What a surface's own close asks of the owner: fold it if it is the one
 * open, and leave the other alone — the tray's Esc must not close @'s list. */
export function foldSurface(current: LineSurface | null, closing: LineSurface): LineSurface | null {
  return current === closing ? null : current;
}
