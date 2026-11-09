import CoreGraphics
import Foundation

// MA-6d — the door to the phone's Apps as values (DESIGN.md §8 "The phone's Apps": the door MA-D7 A, the cues MA-D8 A):
// the pull, the first peek, what is new and what has been seen, and the drop.

/// The pull down from the top of a root tab.
enum AppsPull {
  enum Stage: Equatable {
    case resting, pulling, armed
  }

  /// Where the pull commits: a light haptic ticks, and letting go opens the shelf.
  static let commit: CGFloat = 132
  /// Past `commit` the tab follows at this share of the finger's travel: a linear factor, not a curve.
  static let rubber: CGFloat = 1.0 / 3.0
  /// On Field: the drag begins once it has travelled this far down, more than `startRatio` times as far as across.
  static let startTravel: CGFloat = 12
  static let startRatio: CGFloat = 2
  /// The Recent icons pour out of the island at this size, toward a row this far apart.
  static let pourIcon: CGFloat = 36
  static let pourGap: CGFloat = 50

  static func stage(_ drag: CGFloat) -> Stage {
    if drag <= 0 { return .resting }
    return drag < commit ? .pulling : .armed
  }

  /// How far the tab stands for a finger `drag` down.
  static func offset(_ drag: CGFloat) -> CGFloat {
    if drag <= 0 { return 0 }
    return drag <= commit ? drag : commit + (drag - commit) * rubber
  }

  /// The line under the icons; nil at rest.
  static func words(_ drag: CGFloat) -> String? {
    switch stage(drag) {
    case .resting: nil
    case .pulling: "Pull down for your apps"
    case .armed: "Release for your apps"
    }
  }

  /// Whether the pull crossed the commit going down: the haptic's one tick.
  static func ticks(from old: CGFloat, to new: CGFloat) -> Bool { old < commit && new >= commit }

  static func opens(releasedAt drag: CGFloat) -> Bool { drag >= commit }

  /// Whether a drag on Field is the door's: it starts below the status bar (above it is the system's), inside the
  /// Stories row's band, outside a circle, and has gone far enough down.
  static func fieldBegins(
    start: CGPoint, translation: CGSize, safeTop: CGFloat, reserve: CGFloat, onCircle: Bool
  ) -> Bool {
    guard start.y >= safeTop, start.y <= reserve, !onCircle else { return false }
    return translation.height >= startTravel && translation.height > startRatio * abs(translation.width)
  }

  /// Where the `index`th of `count` icons lands, from the row's centre.
  static func pourX(index: Int, count: Int) -> CGFloat {
    (CGFloat(index) - CGFloat(count - 1) / 2) * pourGap
  }
}

/// The one first peek.
enum AppsPeek {
  static let offset: CGFloat = 136
  static let lasts: Double = 1.8
  static let words = "Pull down anytime for your apps"
}

/// What is new and what has been seen, by fold key: the account's, kept on the phone and cleared at sign-out.
struct AppsCues: Equatable, Codable {
  /// Every app this account's phone has read. An app that leaves and comes back is not news.
  private(set) var known: Set<String> = []
  private(set) var unseen: Set<String> = []
  private(set) var primed = false
  private(set) var peeked = false
  /// What this account opened on this phone, newest first. Absent from a ledger written before MA-6e.
  private var openedKeys: [String]?

  /// Apps that arrived as news and have not been opened on this phone. RED: a stub.
  var unopened: Set<String> { [] }

  /// How many opens head Recent, at most (§8: "the four Recent icons").
  static let openedCap = 4

  /// Newest first.
  var opened: [String] { openedKeys ?? [] }

  /// Search's dot: an app you have not seen waits.
  var dot: Bool { !unseen.isEmpty }

  /// One reading: the fold keys that are new. The first reading is no news.
  mutating func read(_ foldKeys: [String]) -> [String] {
    let current = Set(foldKeys)
    guard primed else {
      primed = true
      known = current
      return []
    }
    var said = Set<String>()
    let news = foldKeys.filter { !known.contains($0) && said.insert($0).inserted }
    known.formUnion(current)
    unseen.formUnion(news)
    unseen.formIntersection(current)
    return news
  }

  /// Shown on the open shelf, or opened. Glimpsed in the sheet's Recent row is not seen (DESIGN.md §8).
  mutating func seen(_ foldKeys: [String]) {
    unseen.subtract(foldKeys)
  }

  /// An app opened on this phone. It heads the ledger, once, and an open is also a seeing.
  mutating func open(_ foldKey: String) {
    let others = opened.filter { $0 != foldKey }
    openedKeys = Array(([foldKey] + others).prefix(Self.openedCap))
    unseen.remove(foldKey)
  }

  /// Whether the first peek is due now; true once per account per phone, when the first app has reached it.
  mutating func takePeek() -> Bool {
    guard !peeked, !known.isEmpty else { return false }
    peeked = true
    return true
  }
}

/// The ledger on this phone, one per account.
struct AppsCuesStore {
  let defaults: UserDefaults

  private static func key(_ account: String) -> String { "vibefield.apps.cues.\(account)" }

  func load(account: String) -> AppsCues {
    guard let data = defaults.data(forKey: Self.key(account)),
      let cues = try? JSONDecoder().decode(AppsCues.self, from: data)
    else { return AppsCues() }
    return cues
  }

  func save(_ cues: AppsCues, account: String) {
    guard let data = try? JSONEncoder().encode(cues) else { return }
    defaults.set(data, forKey: Self.key(account))
  }

  func clear(account: String) {
    defaults.removeObject(forKey: Self.key(account))
  }
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

  static let lasts: TimeInterval = 4
  static let width: CGFloat = 316
  static let height: CGFloat = 60
  static let radius: CGFloat = 30
  static let icon: CGFloat = 40
  /// Its top under the island's foot. Whether that is each phone's own island is James's, open (DESIGN.md §8).
  static let underIsland: CGFloat = 4
  /// §6's island curve: out of the island, and back into it.
  static let falls: Double = 0.56
  static let rises: Double = 0.36

  var head: String {
    switch say {
    case .one: "New app"
    // interim words, ‹for James›
    case .burst(let count): "\(count) new apps"
    }
  }

  var name: String? {
    switch say {
    case .one(let title): title
    case .burst: nil
    }
  }

  fileprivate var count: Int {
    switch say {
    case .one: 1
    case .burst(let count): count
    }
  }
}

/// One drop at a time; a burst within its stand becomes one drop that counts them.
struct AppsDrops: Equatable {
  struct Arrival: Equatable {
    let foldKey: String
    let title: String
  }

  private(set) var showing: AppsDrop?

  /// `blocked`: search open, the account menu open, or an app open. A drop is not shown then.
  mutating func arrive(_ arrivals: [Arrival], at now: Date, blocked: Bool) {
    guard !blocked, let first = arrivals.first else { return }
    expire(at: now)
    let until = now.addingTimeInterval(AppsDrop.lasts)
    let standing = showing?.count ?? 0
    if standing == 0, arrivals.count == 1 {
      showing = AppsDrop(say: .one(title: first.title), foldKey: first.foldKey, until: until)
    } else {
      showing = AppsDrop(say: .burst(count: standing + arrivals.count), foldKey: nil, until: until)
    }
  }

  mutating func expire(at now: Date) {
    if let showing, showing.until <= now { self.showing = nil }
  }

  mutating func dismiss() {
    showing = nil
  }
}

/// Search's dot on its circle.
enum AppsDot {
  /// Its top right stands this far in from the circle's.
  static let inset: CGFloat = 12
  /// Ringed in the bar's glass.
  static let ring: CGFloat = 2
}
