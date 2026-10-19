import SwiftUI

/// The godview voice: everything monospaced, tiny sizes carried by heavy
/// weights and letterspacing. Sizes are the desktop's CSS pixel values —
/// small enough to read as instrument markings, never as prose.
public enum FieldType {
  public static func mono(_ size: CGFloat, _ weight: Font.Weight = .regular) -> Font {
    .system(size: size, weight: weight, design: .monospaced)
  }

  /// Tracking helper: CSS `em` values against the font size, in points.
  public static func tracking(_ em: CGFloat, of size: CGFloat) -> CGFloat { em * size }
}

/// Motion constants — the same three families the desktop uses.
public enum FieldMotion {
  /// The house curve (`cubic-bezier(0.22, 1, 0.36, 1)`).
  public static func ease(_ duration: Double) -> Animation {
    .timingCurve(0.22, 1, 0.36, 1, duration: duration)
  }

  /// DESIGN.md §6's plain `ease`: CSS's own `ease`, `cubic-bezier(0.25, 0.1,
  /// 0.25, 1)`, for what only fades (opacity, colour, shadow; 120–240ms). It is
  /// not the house curve above, because a fade travels nowhere. Item 42's held
  /// veil is the first on the phone to ask for it by name.
  public static func plainEase(_ duration: Double) -> Animation {
    .timingCurve(0.25, 0.1, 0.25, 1, duration: duration)
  }

  /// §6's island curve, `cubic-bezier(0.25, 1, 0.3, 1)`: what travels — the
  /// morph, a glide, a flow-in. As a curve as well as an animation, because a
  /// text renderer lays it on its own glyphs. Item 42's readout is the first on
  /// the phone to ask for it by name.
  public static let islandCurve = UnitCurve.bezier(
    startControlPoint: UnitPoint(x: 0.25, y: 1), endControlPoint: UnitPoint(x: 0.3, y: 1))

  public static func island(_ duration: Double) -> Animation {
    .timingCurve(islandCurve, duration: duration)
  }

  /// §6's pop, `cubic-bezier(0.34, 1.45, 0.64, 1)`: a spring pop, its overshoot
  /// the arrival. The readout's letters rise on it, each in its turn.
  public static let popCurve = UnitCurve.bezier(
    startControlPoint: UnitPoint(x: 0.34, y: 1.45), endControlPoint: UnitPoint(x: 0.64, y: 1))

  /// The working body's breath (the shadow and the mark, 3 s) — the swarm's
  /// shaders carry it; the dictation key borrows the period.
  public static let breathePeriod: Double = 3.0

  /// The arrival curve (RFC 005: 0 → 1.2 → 0.96 → 1.035 → 1 over 720 ms).
  public static let spawnDuration: Double = 0.72

  /// The long-press-to-create hold (520 ms, 8 pt move tolerance).
  public static let longPressDuration: Double = 0.52
  public static let longPressMoveTolerance: CGFloat = 8
}
