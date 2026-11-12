import CoreGraphics

// Item 362a (red) — the names `HistoryFollowTests` calls, answering nothing yet: a document that opens on a landing
// and never follows, a foot that is never in view, no pill and no words. The rule is the next commit's.

struct HistoryFollow: Equatable, Sendable {
  static let footSlack: CGFloat = 0

  enum Opening: Equatable, Sendable {
    case end
    case landing
  }

  enum Growth: Equatable, Sendable {
    case foot
    case head
  }

  enum Pill: Equatable, Sendable {
    case arrivals(Int)
    case latest
  }

  struct Reach: Equatable, Sendable {
    var atFoot: Bool
    var away: Bool
  }

  let opening: Opening = .landing
  private(set) var following = false
  private(set) var holding = false

  init(landed: Bool) {}

  mutating func dragged() {}
  mutating func rested(atFoot: Bool) {}
  mutating func landed() {}
  mutating func pressed() {}
  mutating func askedEarlier() {}
  mutating func earlierSettled() {}

  static func reach(offset: CGFloat, container: CGFloat, content: CGFloat) -> Reach {
    Reach(atFoot: false, away: false)
  }

  func pill(arrivals: Int, endOnScreen: Bool, away: Bool) -> Pill? { nil }

  var growth: Growth { .head }

  static func words(_ pill: Pill) -> String { "" }
  static func spoken(_ pill: Pill) -> String { "" }
}
