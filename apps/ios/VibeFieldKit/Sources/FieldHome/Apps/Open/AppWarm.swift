import FieldProduct
import Foundation

// MA-5a (red) — the warm app. A stub: nothing is ever warm.

struct AppWarm: Equatable {
  static let keep: Duration = .seconds(0)
  static let views = 0

  private(set) var appKey: String?
  private(set) var leftAt: ContinuousClock.Instant?

  mutating func opened(_ key: String) {}

  mutating func left(at instant: ContinuousClock.Instant) {}

  func isWarm(_ key: String, now: ContinuousClock.Instant) -> Bool { false }

  mutating func expire(now: ContinuousClock.Instant) {}
}
