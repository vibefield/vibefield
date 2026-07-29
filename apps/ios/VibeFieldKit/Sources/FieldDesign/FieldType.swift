import SwiftUI

/// The godview voice: everything monospaced, tiny sizes carried by heavy
/// weights and letterspacing. Sizes are the desktop's CSS pixel values —
/// small enough to read as instrument markings, never as prose.
public enum FieldType {
  public static func mono(_ size: CGFloat, _ weight: Font.Weight = .regular) -> Font {
    .system(size: size, weight: weight, design: .monospaced)
  }

  /// Bubble project name per appearance tier (11 → 14 → 18, heavy).
  public static func project(idle: Bool = false, waiting: Bool = false) -> Font {
    mono(waiting ? 18 : idle ? 11 : 14, .heavy)
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

  /// CSS `ease` for the bubble's size change (300 ms on the desktop).
  public static let bubbleResize: Animation = .timingCurve(0.25, 0.1, 0.25, 1, duration: 0.3)

  /// The context-fill rise (420 ms house curve).
  public static let contextFill: Animation = ease(0.42)

  /// Shadow-pulse periods: working breathes slow, waiting pulses urgent.
  public static let breathePeriod: Double = 3.0
  public static let waitingPeriod: Double = 1.5

  /// Spawn pop keyframes (desktop `animateSpawn`, 720 ms).
  public static let spawnDuration: Double = 0.72

  /// The long-press-to-create hold (520 ms, 8 pt move tolerance).
  public static let longPressDuration: Double = 0.52
  public static let longPressMoveTolerance: CGFloat = 8
}
