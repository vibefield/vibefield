import CoreGraphics
import Foundation

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
  /// A circle's mark box, centred: the desktop's 22.
  static let markBox: CGFloat = 22
  /// The current view's ring, the circle's own edge, inside its 44.
  static let ring: CGFloat = 2
  /// The name pill: 24 tall, 8 under its circle, corners 12, padded 0 10; its words 12/500.
  static let labelHeight: CGFloat = 24
  static let labelGap: CGFloat = 8
  static let labelCorner: CGFloat = 12
  static let labelPad: CGFloat = 10
  static let labelSize: CGFloat = 12
  /// The name's entrance: 3 down into place.
  static let labelDrop: CGFloat = 3
  /// The fades, §6's plain `ease`: the ring 120 ms, the name 140 ms in and out, the stage 180 ms (90 under reduced
  /// motion, where the ring and the name change at once).
  static let ringFade: Double = 0.12
  static let labelFade: Double = 0.14
  static let stageFade: Double = 0.18
  static let stageFadeReduced: Double = 0.09

  /// The row's top from the screen's top: 8 under the island's foot on an island phone (56), and 8 under the safe
  /// area's top line where that line stands higher — a notch, a status bar, a phone on its side.
  static func top(safeTop: CGFloat) -> CGFloat {
    min(max(safeTop, 0), islandFoot) + under
  }

  /// The row's reserve, its foot plus 8, from the screen's top: the stage's top inset (the stage is full-bleed, so
  /// stage space is screen space). 108 on an island phone.
  static func reserve(safeTop: CGFloat) -> CGFloat {
    top(safeTop: safeTop) + circle + reserveGap
  }

  /// The dissolve over the stage: clear down to `from` (the row's axis), whole from `to` (the reserve).
  static func dissolve(topInset: CGFloat) -> (from: CGFloat, to: CGFloat) {
    (max(0, topInset - fadeSpan), topInset)
  }

  /// The circles' left edges, `count` of them, the row centred on `width`.
  static func circleMinX(count: Int, width: CGFloat) -> [CGFloat] {
    guard count > 0 else { return [] }
    let row = CGFloat(count) * circle + CGFloat(count - 1) * gap
    let first = (width - row) / 2
    return (0..<count).map { first + CGFloat($0) * (circle + gap) }
  }

  /// A view's name as the row says it: its manifest label in sentence case (SWARM is "Swarm"); a label already in
  /// mixed case is kept as written.
  static func name(label: String) -> String {
    guard label == label.uppercased(), let first = label.first else { return label }
    return String(first) + label.dropFirst().lowercased()
  }
}

/// The name said under a tapped circle (DESIGN.md §8 "The phone's Stories row"): one at a time, for 1.4 s from the
/// tap. Pure, so a host row drives it with dates; HS holds it, and a task keyed by `until` drops it at its deadline.
struct GodviewStorySaying: Equatable, Sendable {
  /// How long a name stands from its tap: the views track's note.
  static let stand: TimeInterval = 1.4

  /// The view whose name is said, or nil.
  private(set) var view: GodviewViewChoice?
  /// When it goes; nil with a view is a name held with no deadline (`-vf-godview-say`, DEBUG, for a still).
  private(set) var until: Date?

  init() {}

  /// A name held with no deadline: a still's (`-vf-godview-say=<id>`), which cannot tap.
  static func held(_ view: GodviewViewChoice) -> GodviewStorySaying {
    var saying = GodviewStorySaying()
    saying.view = view
    return saying
  }

  /// A circle tapped at `now`: its name, for 1.4 s from now. Another circle's name goes at once (never two); the
  /// same circle's 1.4 s starts again.
  mutating func say(_ view: GodviewViewChoice, at now: Date) {
    self.view = view
    until = now.addingTimeInterval(Self.stand)
  }

  /// The name standing at `now`, or nil.
  func shown(at now: Date) -> GodviewViewChoice? {
    guard let view else { return nil }
    guard let until else { return view }
    return now < until ? view : nil
  }

  /// The deadline's task: the name goes once its 1.4 s is out; a held name stays.
  mutating func expire(at now: Date) {
    if let until, now >= until { drop() }
  }

  /// The page left, or the scene went to the background: the name goes, held or not.
  mutating func drop() {
    view = nil
    until = nil
  }
}
