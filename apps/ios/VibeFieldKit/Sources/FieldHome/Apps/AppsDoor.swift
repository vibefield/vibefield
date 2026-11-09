import CoreGraphics
import Foundation

// MA-6d — the door to the phone's Apps as values (DESIGN.md §8 "The phone's Apps": the door MA-D7 A, the cues MA-D8 A):
// the pull, the first peek, what is new and what has been seen, and the drop. RED: every answer below is a stub.

/// The pull down from the top of a root tab.
enum AppsPull {
  enum Stage: Equatable {
    case resting, pulling, armed
  }

  /// Where the pull commits: a light haptic ticks, and letting go opens the shelf.
  static let commit: CGFloat = 0
  /// Past `commit` the tab follows at this share of the finger's travel.
  static let rubber: CGFloat = 0
  /// On Field: the drag begins once it has travelled this far down, more than `startRatio` times as far as across.
  static let startTravel: CGFloat = 0
  static let startRatio: CGFloat = 0
  /// The Recent icons pour out of the island at this size, toward a row this far apart.
  static let pourIcon: CGFloat = 0
  static let pourGap: CGFloat = 0

  static func stage(_ drag: CGFloat) -> Stage { .resting }

  /// How far the tab stands for a finger `drag` down.
  static func offset(_ drag: CGFloat) -> CGFloat { 0 }

  /// The line under the icons; nil at rest.
  static func words(_ drag: CGFloat) -> String? { nil }

  /// Whether the pull crossed the commit going down: the haptic's one tick.
  static func ticks(from old: CGFloat, to new: CGFloat) -> Bool { false }

  static func opens(releasedAt drag: CGFloat) -> Bool { false }

  /// Whether a drag on Field is the door's: it starts below the status bar (above it is the system's), inside the
  /// Stories row's band, outside a circle, and has gone far enough down.
  static func fieldBegins(
    start: CGPoint, translation: CGSize, safeTop: CGFloat, reserve: CGFloat, onCircle: Bool
  ) -> Bool { false }

  /// Where the `index`th of `count` icons lands, from the row's centre.
  static func pourX(index: Int, count: Int) -> CGFloat { 0 }
}

/// The one first peek.
enum AppsPeek {
  static let offset: CGFloat = 0
  static let lasts: Double = 0
  static let words = ""
}

/// What is new and what has been seen, by fold key: the account's, kept on the phone and cleared at sign-out.
struct AppsCues: Equatable, Codable {
  private(set) var known: Set<String> = []
  private(set) var unseen: Set<String> = []
  private(set) var primed = false
  private(set) var peeked = false

  /// Search's dot: an app you have not seen waits.
  var dot: Bool { false }

  /// One reading: the fold keys that are new. The first reading is no news.
  mutating func read(_ foldKeys: [String]) -> [String] { [] }

  /// Shown on the open shelf, or opened. Glimpsed in the sheet's Recent row is not seen (DESIGN.md §8).
  mutating func seen(_ foldKeys: [String]) {}

  /// Whether the first peek is due now; true once per account per phone, when the first app has reached it.
  mutating func takePeek() -> Bool { false }
}

/// The ledger on this phone, one per account.
struct AppsCuesStore {
  let defaults: UserDefaults

  func load(account: String) -> AppsCues { AppsCues() }

  func save(_ cues: AppsCues, account: String) {}

  func clear(account: String) {}
}

/// The capsule that falls out of the island.
struct AppsDrop: Equatable {
  enum Say: Equatable {
    case one(title: String)
    case burst(count: Int)
  }

  let say: Say
  let foldKey: String?
  let until: Date

  static let lasts: TimeInterval = 0
  static let width: CGFloat = 0
  static let height: CGFloat = 0
  static let radius: CGFloat = 0
  static let icon: CGFloat = 0
  static let underIsland: CGFloat = 0
  static let falls: Double = 0
  static let rises: Double = 0

  var head: String { "" }
  var name: String? { nil }
}

/// One drop at a time; a burst within its stand becomes one drop that counts them.
struct AppsDrops: Equatable {
  struct Arrival: Equatable {
    let foldKey: String
    let title: String
  }

  private(set) var showing: AppsDrop?

  /// `blocked`: search open, the account menu open, or an app open. A drop is not shown then.
  mutating func arrive(_ arrivals: [Arrival], at now: Date, blocked: Bool) {}

  mutating func expire(at now: Date) {}

  mutating func dismiss() {}
}

/// Search's dot on its circle.
enum AppsDot {
  static let inset: CGFloat = 0
  static let ring: CGFloat = 0
}
