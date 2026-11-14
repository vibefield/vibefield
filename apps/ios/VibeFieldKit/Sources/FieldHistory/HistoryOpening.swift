import CoreGraphics

// Item 417 (James, 2026-11-14 08:13:38Z, session qa-01: "message view initial loading should adopt latest desktop
// design that uses our logo mark") — A SESSION'S FIRST READING IS THE HOLD. While a session's document is first
// read from its desktop, its page is the hold the desktop's History stands a conversation's wait in: the mark at the
// centre of the page's place and the room's line under it. DESIGN.md §8 "The phone's session document", "Its first
// reading is the hold"; the motion is §6's "History's holds".
//
// The rule is pure: when a page waits, what the hold says, how long it is late, how long it stands, and every
// figure of its fades and its box.
//
// STUB (the red): it answers what the page does today. There is no hold: no page waits, nothing is said, nothing
// is late and nothing stands. Nothing reads it yet.

/// The hold a session's first reading stands in.
enum HistoryOpening {
  /// What a session's page waits on.
  enum Wait: Equatable, Sendable {
    /// Its document is being read.
    case loading
    /// Its document is being read for the message a search landed on.
    case finding
  }

  /// What a hold does once its wait is over.
  enum After: Equatable, Sendable {
    /// It never began to show: nothing stands, and nothing leaves.
    case gone
    /// It stands on for what is left of its floor, and then leaves.
    case stands(Duration)
    /// It leaves now.
    case leaves
  }

  /// Nothing shows for this long: a session read sooner shows no hold at all.
  static let late: Duration = .zero
  /// A hold that has begun to show stands at least this long.
  static let floor: Duration = .zero

  /// The mark's box.
  static let markBox = CGSize.zero
  /// The line's distance under the mark's box.
  static let wordsUnder: CGFloat = 0

  /// What the page of a session waits on: whether its document is `held`, whether its desktop is `awake`, and
  /// whether a search `landed` in it.
  static func wait(held: Bool, awake: Bool, landed: Bool) -> Wait? {
    nil
  }

  /// The hold's line.
  static func line(_ wait: Wait) -> String {
    ""
  }

  /// What a hold does once its wait is over, having shown for `shownFor`; nil never began to show.
  static func after(shownFor: Duration?) -> After {
    .gone
  }

  /// The mark's fade in, in seconds.
  static func markIn(reduceMotion: Bool) -> Double {
    0
  }

  /// The line's fade in, in seconds.
  static func wordsIn(reduceMotion: Bool) -> Double {
    0
  }

  /// The hold's fade out, in seconds.
  static func leave(reduceMotion: Bool) -> Double {
    0
  }
}
