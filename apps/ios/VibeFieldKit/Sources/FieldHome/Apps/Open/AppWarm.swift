import FieldProduct
import Foundation

// MA-5a — the warm app (MA §5.7): the last app stays loaded for ten minutes after the person leaves it, and opening
// another one replaces it (`PhoneBudget.webViews`, one). Pure: the instants are handed in.

struct AppWarm: Equatable {
  /// §5.7: ten minutes.
  static let keep: Duration = .seconds(600)
  /// The one web view the phone keeps (`PHONE_BUDGET.WEB_VIEWS`).
  static let views = PhoneBudget.webViews

  /// The warm app, by its key; nil when none is.
  private(set) var appKey: String?
  /// When the person left it; nil while it is open.
  private(set) var leftAt: ContinuousClock.Instant?

  /// An app opened: it is the warm one now, replacing any other.
  mutating func opened(_ key: String) {
    appKey = key
    leftAt = nil
  }

  /// The person left the open app: its ten minutes start.
  mutating func left(at instant: ContinuousClock.Instant) {
    guard appKey != nil, leftAt == nil else { return }
    leftAt = instant
  }

  /// Whether `key` opens at once: it is the warm app, open or left less than ten minutes ago.
  func isWarm(_ key: String, now: ContinuousClock.Instant) -> Bool {
    guard appKey == key else { return false }
    guard let leftAt else { return true }
    return now - leftAt < Self.keep
  }

  /// Lets the warm app go once its ten minutes are over.
  mutating func expire(now: ContinuousClock.Instant) {
    guard let leftAt, now - leftAt >= Self.keep else { return }
    appKey = nil
    self.leftAt = nil
  }
}
