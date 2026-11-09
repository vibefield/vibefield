import CoreGraphics
import FieldProduct
import Foundation
import Observation

// MA-6d — the door's one standing state, between the values in AppsDoor.swift and HomeScreen's views: the account's
// ledger, the drop, the pull's depth and the first peek.

@MainActor
@Observable
final class AppsDoorModel {
  private(set) var cues = AppsCues()
  private(set) var drops = AppsDrops()
  /// How far the pull stands; 0 at rest.
  private(set) var drag: CGFloat = 0
  private(set) var peeking = false
  /// Whether the shelf stands.
  private(set) var shelfOpen = false
  /// The project whose folder stands open in place.
  private(set) var folder: String?
  /// The app zoomed to, by fold key.
  private(set) var zoomKey: String?

  /// nil under `-vf-mock`, whose account is a value: nothing of it reaches the disk.
  private let store: AppsCuesStore?
  @ObservationIgnored private var account: String?
  @ObservationIgnored var clock: @MainActor () -> Date = { Date() }
  @ObservationIgnored var haptic: @MainActor () -> Void = {}

  init(store: AppsCuesStore?) {
    self.store = store
  }

  /// The account the ledger is read for; the same account again changes nothing.
  func adopt(account: String?) {
    guard account != self.account else { return }
    self.account = account
    cues = account.flatMap { store?.load(account: $0) } ?? AppsCues()
    drops = AppsDrops()
    peeking = false
    shelfOpen = false
    folder = nil
    zoomKey = nil
  }

  /// One reading of the feed. Only a live reading is news; `blocked` keeps the drop away, `calm` is no sheet standing.
  func land(_ reading: AppsFeed.Reading, account: String?, blocked: Bool, calm: Bool) {
    adopt(account: account)
    guard self.account != nil, reading.phase == .live else { return }
    let before = cues
    let news = cues.read(reading.apps.map(\.foldKey))
    let arrivals = news.compactMap { key in
      reading.apps.first { $0.foldKey == key }.map { AppsDrops.Arrival(foldKey: key, title: $0.title) }
    }
    if shelfOpen { cues.seen(reading.apps.map(\.foldKey)) }
    drops.arrive(arrivals, at: clock(), blocked: blocked)
    if cues != before { save() }
    tryPeek(calm: calm)
  }

  /// The first peek, when it is due and nothing stands in its way.
  func tryPeek(calm: Bool) {
    guard calm, account != nil, cues.takePeek() else { return }
    save()
    peeking = true
  }

  func peekDone() {
    peeking = false
  }

  func moved(to drag: CGFloat) {
    let next = max(0, drag)
    if AppsPull.ticks(from: self.drag, to: next) { haptic() }
    self.drag = next
  }

  /// Lets go: whether the shelf opens. The pull is back at rest either way.
  func released() -> Bool {
    let opens = AppsPull.opens(releasedAt: drag)
    drag = 0
    return opens
  }

  func seen(_ foldKeys: [String]) {
    let before = cues
    cues.seen(foldKeys)
    if cues != before { save() }
  }

  /// An app opened on this phone: the account's ledger, on the phone.
  func opened(_ foldKey: String) {
    let before = cues
    cues.open(foldKey)
    if cues != before { save() }
  }

  /// The shelf opens, and has shown what it holds (§8: an app is seen once it has shown on the open shelf).
  func openShelf(showing foldKeys: [String]) {
    shelfOpen = true
    seen(foldKeys)
  }

  func closeShelf() {
    shelfOpen = false
    folder = nil
  }

  func openFolder(_ key: String) {
    folder = key
  }

  func closeFolder() {
    folder = nil
  }

  /// An app zooms open: that is an open, for the ledger and for the dot.
  func zoom(_ foldKey: String) {
    zoomKey = foldKey
    opened(foldKey)
  }

  func unzoom() {
    zoomKey = nil
  }

  func expire() {
    drops.expire(at: clock())
  }

  func dismissDrop() {
    drops.dismiss()
  }

  /// Sign-out: this account's ledger goes from the phone.
  func signedOut() {
    if let account { store?.clear(account: account) }
    account = nil
    cues = AppsCues()
    drops = AppsDrops()
    peeking = false
    shelfOpen = false
    folder = nil
    zoomKey = nil
  }

  private func save() {
    guard let account else { return }
    store?.save(cues, account: account)
  }
}

extension AppsPull {
  /// Whether a drag on Field has gone far enough, either way, for `fieldBegins` to say yes or no, once.
  static func fieldDecides(_ translation: CGSize) -> Bool {
    translation.height >= startTravel || abs(translation.width) >= startTravel
  }

  /// Whether a touch is on one of the Stories row's circles.
  static func onCircle(start: CGPoint, count: Int, width: CGFloat, safeTop: CGFloat) -> Bool {
    let top = GodviewStories.top(safeTop: safeTop)
    guard start.y >= top, start.y <= top + GodviewStories.circle else { return false }
    return GodviewStories.circleMinX(count: count, width: width).contains {
      start.x >= $0 && start.x <= $0 + GodviewStories.circle
    }
  }
}

extension AppsDrop {
  /// Its top from the screen's: 4 under the island's foot, 52 on the page's frame (DESIGN.md §8).
  static func top(safeTop: CGFloat) -> CGFloat {
    min(max(safeTop, 0), GodviewStories.islandFoot) + underIsland
  }
}
