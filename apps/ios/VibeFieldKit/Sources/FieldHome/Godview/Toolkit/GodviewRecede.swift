import FieldAgents
import FieldSwarm
import Foundation

// PG-4s — RECEDING, transcribed from puppeteer-view-sdk 0.3.2 at the pin `95a70aa7`, `src/toolkit/state-words.ts`
// (`5abe8f75`): the constants :106-110, `everyReceded` :113, `recedeTarget` :123, `approachRecede` :129. On the
// phone a row recedes only under the lens (SE-2, `byLens`); with none, every row's target is 1, and a list's
// opacities read the two constants.

enum GodviewRecede {
  /// `RECEDED_OPACITY`: a receded row's weight while the shown ones are on the stage.
  static let receded = 0.22

  /// SE-2 (SE-P6; DESIGN.md §8 "The phone's profile token") — a row receded by the phone's lens, the desktop's profile
  /// filter's rule (`useMonitorAgents.ts`, `runRecedes`): under a lens, everything but the home's own rows under the
  /// chosen profile, and under a plan (UM-5b) everything but the home's runs on it; with none, nothing.
  static func byLens(isSelf: Bool, profileSet: String?, provider: String? = nil, lens: PlanSessions.Lens) -> Bool {
    PlanSessions.recedes(lens, isSelf: isSelf, profileSet: profileSet, provider: provider)
  }
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

  /// SE-2 (the S2 review's finding 2, its owed half) — the lens on the swarm, as the list, the rain and the timeline
  /// take it: under a lens every body but the home's under the chosen profile recedes, to `receded`, or to
  /// `recededEmpty` while every body does; with none, nothing recedes, and a body receded before comes back. A body
  /// carries the home's profile only on the home's own rows (`FieldBubble.profileSet`), so its profile decides alone.
  /// Each frame's step is `approach`, the toolkit's pace.
  static func swarm(_ bubbles: [FieldBubble], lens: PlanSessions.Lens) -> SwarmRecede {
    let flags = bubbles.map { bubble in
      // a body carries the home's profile on the home's rows alone, and an agent facet only on an agent: a peer's
      // body and a terminal recede under a plan (`FieldBubble.agent`, UM-5b)
      byLens(
        isSelf: bubble.profileSet != nil, profileSet: bubble.profileSet, provider: bubble.agent?.provider.rawValue,
        lens: lens)
    }
    let all = every(flags)
    var targets: [String: Double] = [:]
    for (bubble, recedes) in zip(bubbles, flags) where recedes {
      targets[bubble.id] = target(receded: true, every: all)
    }
    return SwarmRecede(targets: targets, approach: { GodviewRecede.approach($0, toward: $1, deltaMs: $2) })
  }
}
