import CoreGraphics

// Item 362a (James, 2026-11-12 18:40:35Z, of the phone's History session view against the desktop's: "it somehow
// scroll start from top, does not like chat message flow in chat app") — WHERE A SESSION'S DOCUMENT STANDS: it opens
// at its end and keeps its end in view, as the desktop's does (rosetta's room, `lib/transcript/tail-scroll.ts`), by
// the phone's Chat's figures (`ChatThreadView.rows`: the foot within 24 pt, a rest off the foot stops the following).
// DESIGN.md §8 "The phone's session document".
//
// Pure: the view feeds it the scroll's geometry and its phases, and writes what it answers.

/// Whether the document keeps its foot in view, and what its pill says.
struct HistoryFollow: Equatable, Sendable {
  /// The foot counts as in view within this many points of the end (Chat's figure).
  static let footSlack: CGFloat = 24

  /// Where the document stands when it opens.
  enum Opening: Equatable, Sendable {
    /// At its end: the newest row above the bar.
    case end
    /// On the row a search landed on, as it always has.
    case landing
  }

  /// The edge a change in the document's height leaves where it is.
  enum Growth: Equatable, Sendable {
    /// The foot stays: while the document follows, and while a page above is read in (the reader's place is kept).
    case foot
    /// The head stays: a row arriving below does not move a reader up the page, and a run opened by hand grows down
    /// from its own line.
    case head
  }

  /// The pill at the foot.
  enum Pill: Equatable, Sendable {
    /// Rows arrived below the screen.
    case arrivals(Int)
    /// Nothing is unread, and the end is more than a screen below.
    case latest
  }

  /// What the scroll's geometry says of the end.
  struct Reach: Equatable, Sendable {
    /// The end is within `footSlack`: a rest here follows.
    var atFoot: Bool
    /// The end is more than a screen below.
    var away: Bool
  }

  /// Item 362b — what the rule at the document's top says.
  enum Head: Equatable, Sendable {
    /// Nothing is above: `Session start · Sat 12 Sep`.
    case start
    /// Rows are above and none is being read: `Earlier`, which a press reads too.
    case earlier
    /// Rows above are being read: `Reading earlier…`.
    case reading
    /// Rows are above and their desktop does not answer: `Earlier · needs studio`.
    case asleep
  }

  let opening: Opening
  /// The document keeps its foot in view.
  private(set) var following: Bool
  /// A finger has moved this page at least once.
  private(set) var touched = false
  /// A page above was asked for and has not settled: what it adds lands above the reader's place.
  private(set) var holding = false

  /// A document opens at its end and follows; one a search landed in opens on the landed row and stays there.
  init(landed: Bool) {
    opening = landed ? .landing : .end
    following = !landed
  }

  /// A finger moved the page: the following stops at once, wherever the page is.
  mutating func dragged() {
    following = false
    touched = true
  }

  /// The page came to rest: at the foot it follows, off it it does not.
  mutating func rested(atFoot: Bool) { following = atFoot }

  /// A search landed on a row, or its stepper walked to one: the page stays there.
  mutating func landed() { following = false }

  /// The pill was pressed: back to the end, following.
  mutating func pressed() { following = true }

  /// A page above was asked for.
  mutating func askedEarlier() { holding = true }

  /// The page above landed and was laid out, or its read ended without one.
  mutating func earlierSettled() { holding = false }

  static func reach(offset: CGFloat, container: CGFloat, content: CGFloat) -> Reach {
    let below = content - (offset + container)
    return Reach(atFoot: below <= footSlack, away: below > container)
  }

  // MARK: Past its end (item 381)

  /// How far below the document's foot the screen's may stand before the page counts as past its end.
  static let pastSlack: CGFloat = 1

  /// The page stands past its end: it has been moved from its top, and the screen's foot is below the document's
  /// own by more than the bar's inset allows. At its end a page rests with the inset under it, which is not past
  /// it; a document shorter than the screen rests at its top, which is not either.
  static func pastEnd(
    offset: CGFloat, container: CGFloat, content: CGFloat, topInset: CGFloat, bottomInset: CGFloat
  ) -> Bool {
    offset + topInset > pastSlack && offset + container > content + bottomInset + pastSlack
  }

  /// A page past its end is put back on its end when it is found there at rest. While a finger holds it there,
  /// or a move is still carrying it, it is left alone: the scroll's own spring brings it back.
  static func putsBack(past: Bool, resting: Bool) -> Bool {
    past && resting
  }

  // MARK: The foot's clearance (items 387 and 389)

  /// The air between the top of what stands over the page's foot and the document's last row: 24 pt over the
  /// 8 pt the bar's own clearance keeps, so the last row rests 32 pt above the bar, or above the slot.
  static let footAir: CGFloat = 24

  /// What the document's end clears above the safe area's line: what stands over the page's foot (`bar`, the
  /// home screen's measure: the bar, and the slot above it when one stands) and the air. It is the height of the
  /// document's last row, the end's own. Over the bar alone it is the 81 pt the page always kept.
  static func clearance(bar: CGFloat) -> CGFloat { max(0, bar) + footAir }

  /// Where the pill's foot stands above the safe area's line: 11 pt above the document's end, so 43 pt above
  /// the top of what stands over the foot. Over the bar alone it is the 92 pt it always was.
  static func pillFoot(bar: CGFloat) -> CGFloat { clearance(bar: bar) + 11 }

  /// How close to the document's foot counts as its end on screen: the end's clearance and a line (39 pt), so
  /// the end is seen when the last row is readable above the glass. Over the bar alone, the 120 pt it was.
  static func endSlack(bar: CGFloat) -> CGFloat { clearance(bar: bar) + 39 }

  /// Arrivals outrank `Latest`; at the end, or a short way off it with nothing unread, there is no pill.
  func pill(arrivals: Int, endOnScreen: Bool, away: Bool) -> Pill? {
    if arrivals > 0, !endOnScreen { return .arrivals(arrivals) }
    if !following, away { return .latest }
    return nil
  }

  /// Which edge a change in height leaves alone.
  var growth: Growth { following || holding ? .foot : .head }

  // MARK: Earlier rows (item 362b)

  /// Within one screen of the document's top (the room's distance: `scrollTop <= clientHeight`).
  static func nearTop(offset: CGFloat, container: CGFloat) -> Bool { offset <= container }

  /// Whether the rows above are asked for now, by themselves: the reader is within a screen of the top, rows are
  /// above (`cursor`), their desktop answers, and none is being read. A cursor a finished read left where it was
  /// (`stalled`) is never asked by itself again, so nothing asks in a loop at the top of a page that will not grow;
  /// a press on `Earlier` still asks. A document a search landed in waits for a finger, so the landing stays put.
  func asksEarlier(nearTop: Bool, cursor: String?, stalled: String?, awake: Bool, reading: Bool) -> Bool {
    guard let cursor, nearTop, awake, !reading else { return false }
    guard opening == .end || touched else { return false }
    return cursor != stalled
  }

  static func head(hasEarlier: Bool, reading: Bool, awake: Bool) -> Head {
    guard hasEarlier else { return .start }
    if reading { return .reading }
    return awake ? .earlier : .asleep
  }

  static func words(_ pill: Pill) -> String {
    switch pill {
    case .arrivals(let count): "\(count) new"
    case .latest: "Latest"
    }
  }

  static func spoken(_ pill: Pill) -> String {
    switch pill {
    case .arrivals(let count): "\(count) new rows, scroll to them"
    case .latest: "Scroll to the latest row"
    }
  }
}
