import CoreGraphics
import Foundation
import Testing

@testable import FieldHome

/// MA-6d — the door to the phone's Apps (DESIGN.md §8 "The phone's Apps", MA-D7 A and MA-D8 A): the pull, the first
/// peek, what is new and what has been seen, the drop. A real pull's gesture on a device is owed to James (P6).
///
/// No key path, no `try` and no `mutating` call inside an #expect/#require argument: hoisted into a `let` first (T10f's
/// kit trap, and run263's compile error).
@Suite("MA-6d — the door: the pull, the peek, the cues, the drop")
struct AppsDoorTests {
  private static let band = (safeTop: CGFloat(59), reserve: CGFloat(108))

  private static func begins(
    y: CGFloat = 80, down: CGFloat = 40, across: CGFloat = 0, onCircle: Bool = false
  ) -> Bool {
    AppsPull.fieldBegins(
      start: CGPoint(x: 200, y: y), translation: CGSize(width: across, height: down), safeTop: band.safeTop,
      reserve: band.reserve, onCircle: onCircle)
  }

  // MARK: - The pull

  @Test("the pull rests, then pulls, then arms at 132")
  func stages() {
    #expect(AppsPull.stage(0) == .resting)
    #expect(AppsPull.stage(1) == .pulling)
    #expect(AppsPull.stage(131.9) == .pulling)
    #expect(AppsPull.stage(132) == .armed)
    #expect(AppsPull.stage(300) == .armed)
  }

  @Test("the tab follows the finger to 132, then at a third of its travel")
  func follows() {
    #expect(AppsPull.offset(-20) == 0)
    #expect(AppsPull.offset(100) == 100)
    #expect(AppsPull.offset(132) == 132)
    #expect(AppsPull.offset(162) == 142)
  }

  @Test("the line says pull, then release, and nothing at rest")
  func words() {
    #expect(AppsPull.words(0) == nil)
    #expect(AppsPull.words(60) == "Pull down for your apps")
    #expect(AppsPull.words(132) == "Release for your apps")
  }

  @Test("the haptic ticks once going down through 132, and again after coming back")
  func ticks() {
    #expect(AppsPull.ticks(from: 120, to: 133))
    #expect(AppsPull.ticks(from: 133, to: 150) == false)
    #expect(AppsPull.ticks(from: 150, to: 120) == false)
    #expect(AppsPull.ticks(from: 120, to: 132))
  }

  @Test("letting go opens at or past 132 and springs back short of it")
  func opens() {
    #expect(AppsPull.opens(releasedAt: 131.9) == false)
    #expect(AppsPull.opens(releasedAt: 132))
    #expect(AppsPull.opens(releasedAt: 200))
  }

  @Test("on Field the door takes a drag from the Stories band, off a circle, far enough and mostly down")
  func fieldBegins() {
    #expect(Self.begins())
    #expect(Self.begins(y: 40) == false, "the status bar's is the system's")
    #expect(Self.begins(y: 120) == false, "below the band is the swarm's")
    #expect(Self.begins(onCircle: true) == false, "a circle keeps its touch")
    #expect(Self.begins(down: 11) == false, "not yet 12 down")
    #expect(Self.begins(down: 12))
    #expect(Self.begins(down: 40, across: 20) == false, "not more than twice as far down as across")
    #expect(Self.begins(down: 41, across: 20))
  }

  @Test("the four icons land 50 apart about the middle; one lands in it")
  func pour() {
    let xs = (0..<4).map { AppsPull.pourX(index: $0, count: 4) }
    let row: [CGFloat] = [-75, -25, 25, 75]
    #expect(xs == row)
    #expect(AppsPull.pourX(index: 0, count: 1) == 0)
  }

  @Test("the pull's numbers are the record's")
  func pullNumbers() {
    #expect(AppsPull.commit == 132)
    #expect(abs(AppsPull.rubber - 1.0 / 3.0) < 0.0001)
    #expect(AppsPull.startTravel == 12 && AppsPull.startRatio == 2)
    #expect(AppsPull.pourIcon == 36 && AppsPull.pourGap == 50)
  }

  @Test("the first peek slides 136 for 1.8 s and teaches the pull")
  func peekNumbers() {
    #expect(AppsPeek.offset == 136)
    #expect(AppsPeek.lasts == 1.8)
    #expect(AppsPeek.words == "Pull down anytime for your apps")
  }

  // MARK: - The cues

  @Test("the first reading is no news: everything is known, and the dot stays off")
  func firstReading() {
    var cues = AppsCues()
    let news = cues.read(["a", "b"])
    #expect(news.isEmpty)
    let both: Set<String> = ["a", "b"]
    #expect(cues.known == both)
    #expect(cues.primed)
    #expect(cues.dot == false)
  }

  @Test("an app after the first reading is news, and the dot stands")
  func newApp() {
    var cues = AppsCues()
    _ = cues.read(["a"])
    let news = cues.read(["a", "b"])
    #expect(news == ["b"])
    #expect(cues.dot)
    let again = cues.read(["a", "b"])
    #expect(again.isEmpty)
    #expect(cues.dot)
  }

  @Test("seen clears the dot; only what was seen")
  func seenClears() {
    var cues = AppsCues()
    _ = cues.read(["a"])
    _ = cues.read(["a", "b", "c"])
    cues.seen(["b"])
    #expect(cues.dot)
    let waiting: Set<String> = ["c"]
    #expect(cues.unseen == waiting)
    cues.seen(["c"])
    #expect(cues.dot == false)
  }

  @Test("an unseen app that leaves the list stops asking for the dot")
  func leavesList() {
    var cues = AppsCues()
    _ = cues.read(["a"])
    _ = cues.read(["a", "b"])
    #expect(cues.dot)
    _ = cues.read(["a"])
    #expect(cues.dot == false)
  }

  @Test("the first peek is due once, when a first reading holds apps")
  func peekOnce() {
    var cues = AppsCues()
    _ = cues.read(["a"])
    let first = cues.takePeek()
    let again = cues.takePeek()
    #expect(first)
    #expect(again == false)
  }

  @Test("an empty first reading owes no peek; the first app to arrive does")
  func peekOnFirstArrival() {
    var cues = AppsCues()
    _ = cues.read([])
    let early = cues.takePeek()
    #expect(early == false)
    let news = cues.read(["a"])
    #expect(news == ["a"])
    let due = cues.takePeek()
    #expect(due)
  }

  /// A ledger that is not the empty one, without going through `read`: the store's tests stand on the store alone.
  private static func standing() throws -> AppsCues {
    let json = #"{"known":["a","b"],"unseen":["b"],"primed":true,"peeked":true}"#
    return try JSONDecoder().decode(AppsCues.self, from: Data(json.utf8))
  }

  @Test("the ledger is the account's and survives the app")
  func storeRoundTrip() throws {
    let defaults = try #require(UserDefaults(suiteName: "ma6d-\(UUID().uuidString)"))
    let store = AppsCuesStore(defaults: defaults)
    let cues = try Self.standing()
    store.save(cues, account: "me@tailnet")
    #expect(store.load(account: "me@tailnet") == cues)
    #expect(store.load(account: "other@tailnet") == AppsCues())
  }

  @Test("sign-out clears that account's ledger")
  func storeClear() throws {
    let defaults = try #require(UserDefaults(suiteName: "ma6d-\(UUID().uuidString)"))
    let store = AppsCuesStore(defaults: defaults)
    let cues = try Self.standing()
    store.save(cues, account: "me@tailnet")
    #expect(store.load(account: "me@tailnet") == cues)
    store.clear(account: "me@tailnet")
    #expect(store.load(account: "me@tailnet") == AppsCues())
  }

  // MARK: - The drop

  private static let t0 = Date(timeIntervalSince1970: 1_000_000)
  private static func arrival(_ name: String) -> AppsDrops.Arrival { .init(foldKey: "app:\(name)", title: name) }

  @Test("a new app drops: New app over its name, for 4 s")
  func dropOne() throws {
    var drops = AppsDrops()
    drops.arrive([Self.arrival("Notes")], at: Self.t0, blocked: false)
    let drop = try #require(drops.showing)
    #expect(drop.head == "New app")
    #expect(drop.name == "Notes")
    #expect(drop.foldKey == "app:Notes")
    #expect(drop.until == Self.t0.addingTimeInterval(4))
  }

  @Test("a burst inside its stand is one drop that counts them, standing 4 s from the last")
  func dropBurst() throws {
    var drops = AppsDrops()
    drops.arrive([Self.arrival("One")], at: Self.t0, blocked: false)
    let later = Self.t0.addingTimeInterval(2)
    drops.arrive([Self.arrival("Two"), Self.arrival("Three")], at: later, blocked: false)
    let drop = try #require(drops.showing)
    #expect(drop.say == AppsDrop.Say.burst(count: 3))
    #expect(drop.head == "3 new apps")
    #expect(drop.name == nil)
    #expect(drop.foldKey == nil)
    #expect(drop.until == later.addingTimeInterval(4))
  }

  @Test("a drop goes when its stand is over, and a later app drops alone")
  func dropExpires() throws {
    var drops = AppsDrops()
    drops.arrive([Self.arrival("One")], at: Self.t0, blocked: false)
    #expect(drops.showing != nil)
    drops.expire(at: Self.t0.addingTimeInterval(3.9))
    #expect(drops.showing != nil)
    drops.expire(at: Self.t0.addingTimeInterval(4))
    #expect(drops.showing == nil)
    drops.arrive([Self.arrival("Two")], at: Self.t0.addingTimeInterval(5), blocked: false)
    let drop = try #require(drops.showing)
    #expect(drop.say == AppsDrop.Say.one(title: "Two"))
  }

  @Test("no drop while search, the account menu or an app stands; the next app still drops")
  func dropBlocked() {
    var drops = AppsDrops()
    drops.arrive([Self.arrival("Hidden")], at: Self.t0, blocked: true)
    #expect(drops.showing == nil)
    drops.arrive([Self.arrival("Shown")], at: Self.t0.addingTimeInterval(1), blocked: false)
    let shown = drops.showing?.say
    #expect(shown == AppsDrop.Say.one(title: "Shown"))
  }

  @Test("a swipe sends it away")
  func dropDismiss() {
    var drops = AppsDrops()
    drops.arrive([Self.arrival("One")], at: Self.t0, blocked: false)
    #expect(drops.showing != nil)
    drops.dismiss()
    #expect(drops.showing == nil)
  }

  @Test("the drop's and the dot's measures are the record's")
  func dropMeasures() {
    #expect(AppsDrop.lasts == 4)
    #expect(AppsDrop.width == 316 && AppsDrop.height == 60 && AppsDrop.radius == 30)
    #expect(AppsDrop.icon == 40 && AppsDrop.underIsland == 4)
    #expect(AppsDrop.falls == 0.56 && AppsDrop.rises == 0.36)
    #expect(AppsDot.inset == 12 && AppsDot.ring == 2)
  }
}
