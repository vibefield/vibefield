// ES-5c (DESIGN.md §6 "At rest"; ES-D7 A) — the night's rest, the port of `night.tsx`'s `nightRestTarget` and
// `nightRestRate`, with a touch where the Mac has a pointer: live for 20 s after the last touch, easing out over 2 s,
// woken quickly. Still, the night draws no frame. Under reduced motion it rests at once, so it is drawn once.

enum NightRest {
  /// How long after the last touch the night rests, in seconds.
  static let after = 20.0
  /// How long it takes the night to come still, in seconds: its clock eases out over this.
  static let easeOut = 2.0
  /// Below this the night is still: its clock stands, and it draws no frame.
  static let still = 0.01
  /// How quickly a touch wakes it, in seconds: quicker than it rests.
  static let wake = 0.18

  /// The rate the night's clock should run at: 1 while a touch has been made within the rest, 0 after it, and 0 under
  /// reduced motion.
  static func target(sinceTouch: Double, reduced: Bool) -> Double {
    if reduced { return 0 }
    return sinceTouch > after ? 0 : 1
  }

  /// One step of the night's clock rate toward its target: it eases out over `easeOut` (by its end it moves at under 2%
  /// of its pace) and wakes in `wake`; near still, it is still.
  static func rate(_ rate: Double, target: Double, dt: Double) -> Double {
    let tau = target < rate ? easeOut / 4 : wake
    let next = rate + (target - rate) * min(1, dt / tau)
    return target == 0 && next < still ? 0 : next
  }
}
