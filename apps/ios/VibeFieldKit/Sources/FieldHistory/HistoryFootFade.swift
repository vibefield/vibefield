import CoreGraphics

// Item 391 (James, 2026-11-13 23:28:32Z, session qa-01, of a session's document on his phone, the area over its foot
// marked: "[Image #17] make the messages start fade, blur and dim at the marked area like how it looks at the top
// edge area") — THE BAND OVER A SESSION'S DOCUMENT'S FOOT. At the head the system softens what scrolls under its own
// navigation bar. The bar at the foot and the slot above it are the home screen's overlay, so the system gives the
// foot nothing, and the document draws its own band there. DESIGN.md §8 "The phone's session document", "Its foot
// fades as its head does".
//
// Pure: the band's height and its two ramps.

/// The band over the foot of a session's document: how tall it stands, and how it deepens down its height.
enum HistoryFootFade {
  /// One stop of a ramp down the band: how strong the effect is (0 none, 1 whole) at a point down the band (0 its
  /// top, 1 the screen's bottom edge).
  struct Stop: Equatable, Sendable {
    let strength: Double
    let at: Double
  }

  /// How far above the top of what stands over the foot the band begins. It is under the 32 pt the document's last
  /// row rests above that top at its end (items 387 and 389), so the newest row stands whole above the band.
  static let lead: CGFloat = 24
  /// Where down the band the blur is whole.
  static let blurWholeAt: Double = 0.5
  /// How much of the page's paper stands over the rows at the screen's bottom edge. Never the whole of it: the
  /// rows are dimmed toward the page, not painted out.
  static let dimAtEdge: Double = 0.9

  /// The band's height, from the screen's bottom edge, where the top of what stands over the foot (the bar, or the
  /// slot above it) is `over` points above that edge.
  ///
  /// A stub (item 391's red): no band, as the page was.
  static func height(over: CGFloat) -> CGFloat { 0 }

  /// The blur down the band.
  ///
  /// A stub (item 391's red): none.
  static let blur: [Stop] = []

  /// The dim down the band.
  ///
  /// A stub (item 391's red): none.
  static let dim: [Stop] = []
}
