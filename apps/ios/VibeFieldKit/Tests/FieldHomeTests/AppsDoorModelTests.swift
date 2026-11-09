import CoreGraphics
import FieldProduct
import Foundation
import Testing

@testable import FieldHome

/// MA-6d — the door's standing state: the account's ledger on the phone, what a reading says, the first peek, the pull's
/// one tick. The gesture itself on a device is owed to James (P6).
///
/// No key path and no `try` inside an #expect/#require argument: hoisted into a `let` first (T10f's kit trap).
@MainActor
@Suite("MA-6d — the door's model: the account's ledger, a reading's news, the peek, the pull")
struct AppsDoorModelTests {
  @MainActor final class Felt {
    var ticks = 0
  }

  private static let me = "me@tailnet"
  private static let t0 = Date(timeIntervalSince1970: 1_000_000)

  private static func store() throws -> AppsCuesStore {
    let defaults = try #require(UserDefaults(suiteName: "ma6d-\(UUID().uuidString)"))
    return AppsCuesStore(defaults: defaults)
  }

  /// A ledger that is not the empty one, without going through the model.
  private static func standing() throws -> AppsCues {
    let json = #"{"known":["app:a","app:b"],"unseen":["app:b"],"primed":true,"peeked":true}"#
    return try JSONDecoder().decode(AppsCues.self, from: Data(json.utf8))
  }

  private static func reading(_ names: [String], phase: AppsFeed.Phase = .live) throws -> AppsFeed.Reading {
    let page = try IndexAppsResult(json: AppsWire.page(names))
    var reading = AppsFeed.Reading()
    reading.phase = phase
    reading.apps = page.rows
    reading.sources = page.sources
    return reading
  }

  private static func model(_ store: AppsCuesStore?) -> AppsDoorModel {
    let model = AppsDoorModel(store: store)
    model.clock = { Self.t0 }
    return model
  }

  private func land(
    _ model: AppsDoorModel, _ names: [String], blocked: Bool = false, calm: Bool = false
  ) throws {
    model.land(try Self.reading(names), account: Self.me, blocked: blocked, calm: calm)
  }

  // MARK: - The account

  @Test("an account's ledger is read from the phone")
  func adoptLoads() throws {
    let store = try Self.store()
    let cues = try Self.standing()
    store.save(cues, account: Self.me)
    let model = Self.model(store)
    model.adopt(account: Self.me)
    #expect(model.cues == cues)
  }

  @Test("another account reads its own ledger and leaves no drop behind")
  func accountSwitch() throws {
    let store = try Self.store()
    let model = Self.model(store)
    try land(model, ["a"])
    try land(model, ["a", "b"])
    #expect(model.drops.showing != nil)
    model.adopt(account: "other@tailnet")
    #expect(model.cues == AppsCues())
    #expect(model.drops.showing == nil)
    model.adopt(account: Self.me)
    #expect(model.cues.dot)
  }

  @Test("sign-out takes this account's ledger off the phone")
  func signedOutClears() throws {
    let store = try Self.store()
    store.save(try Self.standing(), account: Self.me)
    let model = Self.model(store)
    model.adopt(account: Self.me)
    model.signedOut()
    #expect(store.load(account: Self.me) == AppsCues())
    #expect(model.cues == AppsCues())
  }

  @Test("no account reads nothing")
  func noAccount() throws {
    let model = Self.model(try Self.store())
    model.land(try Self.reading(["a"]), account: nil, blocked: false, calm: false)
    #expect(model.cues.primed == false)
    try land(model, ["a"])
    #expect(model.cues.primed)
  }

  @Test("under the mock there is no store, and the ledger still works")
  func noStore() throws {
    let model = Self.model(nil)
    try land(model, ["a"])
    try land(model, ["a", "b"])
    #expect(model.cues.dot)
  }

  // MARK: - A reading

  @Test("only a live reading is read")
  func liveOnly() throws {
    let model = Self.model(try Self.store())
    let held = try Self.reading(["a"], phase: .waiting)
    model.land(held, account: Self.me, blocked: false, calm: false)
    #expect(model.cues.primed == false)
    let reading = try Self.reading(["a"], phase: .reading(device: "desk"))
    model.land(reading, account: Self.me, blocked: false, calm: false)
    #expect(model.cues.primed == false)
    try land(model, ["a"])
    #expect(model.cues.primed)
  }

  @Test("the first reading is no news: no drop")
  func firstNoDrop() throws {
    let model = Self.model(try Self.store())
    try land(model, ["a", "b"])
    #expect(model.cues.primed)
    #expect(model.drops.showing == nil)
    #expect(model.cues.dot == false)
  }

  @Test("a new app drops, says its title and is on the phone")
  func newAppDrops() throws {
    let store = try Self.store()
    let model = Self.model(store)
    try land(model, ["a"])
    try land(model, ["a", "b"])
    let drop = try #require(model.drops.showing)
    #expect(drop.say == AppsDrop.Say.one(title: "b"))
    #expect(drop.foldKey == "app:b")
    #expect(drop.until == Self.t0.addingTimeInterval(AppsDrop.lasts))
    #expect(model.cues.dot)
    #expect(store.load(account: Self.me) == model.cues)
  }

  @Test("blocked, no drop stands; the dot still does")
  func blockedKeepsDot() throws {
    let model = Self.model(try Self.store())
    try land(model, ["a"])
    try land(model, ["a", "b"], blocked: true)
    #expect(model.drops.showing == nil)
    #expect(model.cues.dot)
  }

  @Test("seen clears the dot and is on the phone")
  func seenPersists() throws {
    let store = try Self.store()
    let model = Self.model(store)
    try land(model, ["a"])
    try land(model, ["a", "b"])
    #expect(model.cues.dot)
    model.seen(["app:b"])
    #expect(model.cues.dot == false)
    #expect(store.load(account: Self.me) == model.cues)
  }

  @Test("the drop goes at its time, by the clock")
  func expires() throws {
    let model = Self.model(try Self.store())
    try land(model, ["a"])
    try land(model, ["a", "b"])
    #expect(model.drops.showing != nil)
    model.clock = { Self.t0.addingTimeInterval(AppsDrop.lasts) }
    model.expire()
    #expect(model.drops.showing == nil)
  }

  @Test("a swipe sends the drop away")
  func dismisses() throws {
    let model = Self.model(try Self.store())
    try land(model, ["a"])
    try land(model, ["a", "b"])
    #expect(model.drops.showing != nil)
    model.dismissDrop()
    #expect(model.drops.showing == nil)
  }

  // MARK: - The peek

  @Test("the first peek stands once, when nothing is in its way")
  func peekCalm() throws {
    let store = try Self.store()
    let model = Self.model(store)
    try land(model, ["a"], calm: true)
    #expect(model.peeking)
    model.peekDone()
    #expect(model.peeking == false)
    try land(model, ["a"], calm: true)
    #expect(model.peeking == false)
    let kept = store.load(account: Self.me)
    #expect(kept.peeked)
  }

  @Test("a peek due behind a sheet waits for the sheet to go")
  func peekWaits() throws {
    let model = Self.model(try Self.store())
    try land(model, ["a"], calm: false)
    #expect(model.peeking == false)
    #expect(model.cues.peeked == false)
    model.tryPeek(calm: true)
    #expect(model.peeking)
  }

  // MARK: - The pull

  @Test("the pull ticks once through the commit, and again after coming back")
  func ticksOnce() {
    let model = Self.model(nil)
    let felt = Felt()
    model.haptic = { felt.ticks += 1 }
    model.moved(to: 120)
    #expect(felt.ticks == 0)
    #expect(model.drag == 120)
    model.moved(to: 133)
    #expect(felt.ticks == 1)
    model.moved(to: 150)
    #expect(felt.ticks == 1)
    model.moved(to: 120)
    model.moved(to: 140)
    #expect(felt.ticks == 2)
  }

  @Test("letting go at the commit opens; short of it does not; the pull is at rest either way")
  func released() {
    let model = Self.model(nil)
    model.moved(to: 132)
    let opens = model.released()
    #expect(opens)
    #expect(model.drag == 0)
    model.moved(to: 100)
    let short = model.released()
    #expect(short == false)
    #expect(model.drag == 0)
  }

  // MARK: - The geometry

  @Test("a drag on Field is decided once it has gone 12 either way")
  func decides() {
    #expect(AppsPull.fieldDecides(CGSize(width: 1, height: 11)) == false)
    #expect(AppsPull.fieldDecides(CGSize(width: 0, height: 12)))
    #expect(AppsPull.fieldDecides(CGSize(width: 13, height: 8)))
    #expect(AppsPull.fieldDecides(CGSize(width: -13, height: 8)))
  }

  @Test("a touch on a Stories circle is the circle's, and between them it is not")
  func onCircle() throws {
    let lefts = GodviewStories.circleMinX(count: 3, width: 402)
    let first = try #require(lefts.first)
    let top = GodviewStories.top(safeTop: 59)
    let side = GodviewStories.circle
    let on = CGPoint(x: first + side / 2, y: top + side / 2)
    let between = CGPoint(x: first + side + GodviewStories.gap / 2, y: top + side / 2)
    let under = CGPoint(x: first + side / 2, y: top + side + 1)
    #expect(AppsPull.onCircle(start: on, count: 3, width: 402, safeTop: 59))
    #expect(AppsPull.onCircle(start: between, count: 3, width: 402, safeTop: 59) == false)
    #expect(AppsPull.onCircle(start: under, count: 3, width: 402, safeTop: 59) == false)
  }

  @Test("the drop stands 4 under the island's foot, or under a higher safe line")
  func dropTop() {
    #expect(AppsDrop.top(safeTop: 59) == 52)
    #expect(AppsDrop.top(safeTop: 20) == 24)
    #expect(AppsDrop.top(safeTop: 0) == 4)
  }
}
