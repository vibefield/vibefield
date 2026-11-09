import CoreGraphics
import FieldProduct
import Foundation
import Observation

// MA-6d — the door's one standing state, between the values in AppsDoor.swift and HomeScreen's views: the account's
// ledger, the drop, the pull's depth and the first peek. RED: every answer below is a stub.

@MainActor
@Observable
final class AppsDoorModel {
  private(set) var cues = AppsCues()
  private(set) var drops = AppsDrops()
  /// How far the pull stands; 0 at rest.
  private(set) var drag: CGFloat = 0
  private(set) var peeking = false

  /// nil under `-vf-mock`, whose account is a value: nothing of it reaches the disk.
  private let store: AppsCuesStore?
  @ObservationIgnored private var account: String?
  @ObservationIgnored var clock: @MainActor () -> Date = { Date() }
  @ObservationIgnored var haptic: @MainActor () -> Void = {}

  init(store: AppsCuesStore?) {
    self.store = store
  }

  /// The account the ledger is read for; the same account again changes nothing.
  func adopt(account: String?) {}

  /// One reading of the feed. Only a live reading is news; `blocked` keeps the drop away, `calm` is no sheet standing.
  func land(_ reading: AppsFeed.Reading, account: String?, blocked: Bool, calm: Bool) {}

  /// The first peek, when it is due and nothing stands in its way.
  func tryPeek(calm: Bool) {}

  func peekDone() {}

  func moved(to drag: CGFloat) {}

  /// Lets go: whether the shelf opens. The pull is back at rest either way.
  func released() -> Bool { false }

  func seen(_ foldKeys: [String]) {}

  func expire() {}

  func dismissDrop() {}

  /// Sign-out: this account's ledger goes from the phone.
  func signedOut() {}
}

extension AppsPull {
  /// Whether a drag on Field has gone far enough, either way, for `fieldBegins` to say yes or no, once.
  static func fieldDecides(_ translation: CGSize) -> Bool { false }

  /// Whether a touch is on one of the Stories row's circles.
  static func onCircle(start: CGPoint, count: Int, width: CGFloat, safeTop: CGFloat) -> Bool { false }
}

extension AppsDrop {
  /// Its top from the screen's: 4 under the island's foot, 52 on the page's frame (DESIGN.md §8).
  static func top(safeTop: CGFloat) -> CGFloat { 0 }
}
