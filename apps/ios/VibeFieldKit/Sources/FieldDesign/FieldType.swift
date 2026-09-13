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

  /// The working body's breath (the shadow and the mark, 3 s) — the swarm's
  /// shaders carry it; the dictation key borrows the period.
  public static let breathePeriod: Double = 3.0

  /// The arrival curve (RFC 005: 0 → 1.2 → 0.96 → 1.035 → 1 over 720 ms).
  public static let spawnDuration: Double = 0.72

  /// The long-press-to-create hold (520 ms, 8 pt move tolerance).
  public static let longPressDuration: Double = 0.52
  public static let longPressMoveTolerance: CGFloat = 8
}
