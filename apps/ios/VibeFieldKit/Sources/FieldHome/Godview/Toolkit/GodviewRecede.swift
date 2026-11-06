import Foundation

// PG-4s — RECEDING, transcribed from puppeteer-view-sdk 0.3.2 at the pin `95a70aa7`, `src/toolkit/state-words.ts`
// (`5abe8f75`): the constants :106-110, `everyReceded` :113, `recedeTarget` :123, `approachRecede` :129. On the
// phone nothing is receded (the host joins `receded` false), so every row's target is 1; the family is here for
// parity, and a list's opacities read the two constants.

enum GodviewRecede {
  /// `RECEDED_OPACITY`: a receded row's weight while the shown ones are on the stage.
  static let receded = 0.22

  /// SE-2 (SE-P6) — a row receded by the phone's lens. SE-2f (red): nothing recedes.
  static func byLens(isSelf: Bool, profileSet: String?, lens: String?) -> Bool { false }
  /// `RECEDED_EMPTY_OPACITY`: every row receded.
  static let recededEmpty = 0.07
  /// `RECEDE_MS`: how long a row takes to recede, or to come back.
  static let ms = 240.0

  /// `everyReceded`: every row is receded; false for no rows. A row whose `receded` is not true is not receded.
  static func every(_ receded: some Sequence<Bool>) -> Bool {
    var any = false
    for row in receded {
      if !row { return false }
      any = true
    }
    return any
  }

  /// `recedeTarget`: the weight a row settles at, 1 when it is shown.
  static func target(receded: Bool, every: Bool) -> Double {
    guard receded else { return 1 }
    return every ? recededEmpty : Self.receded
  }

  /// `approachRecede`: one frame's step toward the target, linear, snapping inside one step. A negative delta does
  /// not move; a NaN delta answers NaN, as JavaScript's `Math.max(0, NaN)` does.
  static func approach(_ current: Double, toward target: Double, deltaMs: Double) -> Double {
    // `((1 - RECEDED_OPACITY) * Math.max(0, deltaMs)) / RECEDE_MS`, in JavaScript's order
    let rate = ((1 - receded) * GodviewFormat.jsMax0(deltaMs)) / ms
    if abs(target - current) <= rate { return target }
    return current + GodviewFormat.jsSign(target - current) * rate
  }
}
