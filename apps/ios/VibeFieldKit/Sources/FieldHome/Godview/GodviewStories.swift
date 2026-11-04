import CoreGraphics

// PG-4t — THE PHONE'S STORIES ROW, AS NUMBERS (DESIGN.md §8 "The phone's Stories row"): Godview's head carried to
// the Field page. Every number is that point's; the row's view is `GodviewStoriesRow` (kit-only, it reads the chrome
// palette), and this file holds what a host test can pin. No `#if`: Release compiles it.

/// The row's geometry, the stage's reserve under it, and the dissolve over the stage.
enum GodviewStories {
  /// A circle: 44 across, the touch floor (the desktop's 40 is a pointer's).
  static let circle: CGFloat = 44
  /// Between two circles.
  static let gap: CGFloat = 10
  /// The Dynamic Island's foot on every island phone: y 11, 37 tall (the PG-4s page's frame; witnessed at KIT).
  static let islandFoot: CGFloat = 48
  /// The row's top, under the island's foot, or under the safe area's line where that stands higher.
  static let under: CGFloat = 8
  /// The reserve below the row's foot: the desktop's own, "the head's foot at 48, plus 8" (DESIGN.md §8).
  static let reserveGap: CGFloat = 8
  /// The dissolve's ramp, from the row's axis to the reserve: half a circle and the reserve's gap (the desktop's
  /// 28 → 56).
  static let fadeSpan: CGFloat = circle / 2 + reserveGap

  /// The row's top from the screen's top: 8 under the island's foot on an island phone (56), and 8 under the safe
  /// area's top line where that line stands higher — a notch, a status bar, a phone on its side.
  static func top(safeTop: CGFloat) -> CGFloat {
    0  // PG-4t (red): the skeleton
  }

  /// The row's reserve, its foot plus 8, from the screen's top: the stage's top inset (the stage is full-bleed, so
  /// stage space is screen space). 108 on an island phone.
  static func reserve(safeTop: CGFloat) -> CGFloat {
    0  // PG-4t (red): the skeleton
  }

  /// The dissolve over the stage: clear down to `from` (the row's axis), whole from `to` (the reserve).
  static func dissolve(topInset: CGFloat) -> (from: CGFloat, to: CGFloat) {
    (0, 0)  // PG-4t (red): the skeleton
  }

  /// The circles' left edges, `count` of them, the row centred on `width`.
  static func circleMinX(count: Int, width: CGFloat) -> [CGFloat] {
    []  // PG-4t (red): the skeleton
  }
}
