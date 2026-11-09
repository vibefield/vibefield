// ES-5c (DESIGN.md §6 "At rest"; ES-D7 A) — the night's rest, the port of `night.tsx`'s `nightRestTarget` and
// `nightRestRate`. RED: every answer is a stub.

enum NightRest {
  /// How long after the last touch the night rests, in seconds.
  static let after = 20.0
  /// How long it takes the night to come still, in seconds.
  static let easeOut = 2.0
  /// Below this the night is still: its clock stands, and it draws no frame.
  static let still = 0.01
  /// How quickly a touch wakes it, in seconds: quicker than it rests.
  static let wake = 0.18

  static func target(sinceTouch: Double, reduced: Bool) -> Double { 1 }

  static func rate(_ rate: Double, target: Double, dt: Double) -> Double { rate }
}
