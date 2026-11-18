import Foundation

// Item 523 (2026-11-17) — a made app's link out asks the person first, and only after their touch (DESIGN.md §8 "The
// open app"). The phone cannot tell a person's tap from the page's own click, so the ask is tied to the touch, which a
// page cannot make: one touch brings at most one ask, whatever its answer, and with no unspent touch a link out does
// nothing. While one ask stands the page raises no other. Pure: the instants are handed in; `AppsWebPage` notes the
// touches (`AppsTouchWatcher`: when, never where) and asks.

struct AppsLinkOut: Equatable {
  /// How long after the last finger lifts a touch may still bring an ask: about how long WebKit itself carries a tap's
  /// gesture forward (its limit for a timer a tap started), so a page cannot keep a touch for later. Item 523,
  /// 2026-11-17.
  static let touchWindow: Duration = .seconds(1)

  /// Whether a finger is on the page.
  private(set) var down = false
  /// When the last finger lifted; nil while one is down, or before any touch.
  private(set) var liftedAt: ContinuousClock.Instant?
  /// Whether the touch down, or last lifted, has not yet brought an ask.
  private(set) var unspent = false
  /// Whether an ask stands.
  private(set) var asking = false

  /// A touch began on the page: a new touch, unspent.
  mutating func began() {
    down = true
    liftedAt = nil
    unspent = true
  }

  /// The last finger lifted.
  mutating func lifted(at instant: ContinuousClock.Instant) {
    down = false
    liftedAt = instant
  }

  /// A link out: true to ask now, which spends the touch; false to drop it.
  mutating func asks(at now: ContinuousClock.Instant) -> Bool {
    false  // RED: a stub, never an ask; the green asks on an unspent touch.
  }

  /// The ask was answered, by either choice or by the sheet going away.
  mutating func answered() {
    asking = false
  }

  /// The ask's words (DESIGN.md §9 "Apps", item 523).
  // RED: stubs, no words; the green says DESIGN.md's.
  static func title(site: String) -> String { "" }
  static func line(app: String) -> String { "" }
  static let open = ""
  static let cancel = ""
}

/// A link out that asks: where it goes, and its ‹site›.
struct AppsLinkOutAsk: Equatable {
  let url: URL
  let site: String
}
