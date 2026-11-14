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

  /// Item 386 — how a press on the pill goes to the end.
  enum Going: Equatable, Sendable {
    /// With no move to watch, as the document opens on its end.
    case atOnce
    /// On the pill's ease (450 ms).
    case eased
  }

  /// What the scroll's geometry says of the end.
  struct Reach: Equatable, Sendable {
    /// The end is within `footSlack`: a rest here follows.
    var atFoot: Bool
    /// The end is more than a screen below.
    var away: Bool
  }

  // RETIRED 2026-11-14 (item 418): `Head` and `head(hasEarlier:reading:awake:)`, item 362b's "what the rule at the
  // document's top says". The rule is the pull's now and says more (`HistoryOlderPull.Top`): `Earlier · pull down`
  // where this said `Earlier`, and a read that brought nothing.

  let opening: Opening
  /// The document keeps its foot in view.
  private(set) var following: Bool
  /// A page above was asked for and has not settled: what it adds lands above the reader's place.
  private(set) var holding = false
  /// Item 386 — the pill was pressed and the page is on its way to its end: only a finger stops it.
  private(set) var returning = false

  /// A document opens at its end and follows; one a search landed in opens on the landed row and stays there.
  init(landed: Bool) {
    opening = landed ? .landing : .end
    following = !landed
  }

  /// A finger moved the page: the following stops at once, wherever the page is.
  mutating func dragged() {
    following = false
    returning = false
  }

  /// The page came to rest: at the foot it follows, off it it does not.
  ///
  /// Item 386 — except the rest of a press's own move. Over rows not yet laid out that move can come to rest
  /// short of the end, and the page is still on its way there: while it follows, each change in the document's
  /// height puts the foot back. So such a rest is not the reader's, and it stops nothing. Arriving ends the return.
  mutating func rested(atFoot: Bool) {
    if returning {
      if atFoot { returning = false }
      return
    }
    following = atFoot
  }

  /// A search landed on a row, or its stepper walked to one: the page stays there.
  mutating func landed() {
    following = false
    returning = false
  }

  /// The pill was pressed: back to the end, following, until the page arrives or a finger takes it.
  mutating func pressed() {
    following = true
    returning = true
  }

  /// Item 396 — the button at the document's side was pressed: the page goes up to a message, which is the
  /// reader's own move up the page. The following stops and a return ends, as for a finger.
  ///
  /// *Corrected 2026-11-14 (item 418):* this went on "and the page counts as moved by hand, so at its top the rows
  /// above are read in, in a document a search landed in too. A landing does not fit: it leaves a landed document
  /// waiting for a finger." That was `touched`, which only `asksEarlier` read; both are retired (below). At the
  /// first message read the press asks for the batch above itself (`HistoryOlderPull.pressed`).
  mutating func jumped() {
    following = false
    returning = false
  }

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

  /// Item 386 — how a press on the pill goes to the end: at once when the end is more than a screen below
  /// (`Reach.away`), which `Latest` always is, and on the ease when it is nearer. Far off, the rows between are
  /// not laid out, and an eased move aims at an estimate of the end; going at once is how the document opens on
  /// its end.
  static func going(away: Bool) -> Going { away ? .atOnce : .eased }

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

  // MARK: Near the top (item 362b)

  /// Within one screen of the document's top (the room's distance: `scrollTop <= clientHeight`). The button at the
  /// side eases to a top that near (item 396); since item 418 nothing is read in for standing there.
  static func nearTop(offset: CGFloat, container: CGFloat) -> Bool { offset <= container }

  // RETIRED 2026-11-14 (item 418; James, 08:13:38Z, session qa-01: "it seems still trying to load everything …
  // you pull down for load more"): `asksEarlier(nearTop:cursor:stalled:awake:reading:)`, item 362b's "whether the
  // rows above are asked for now, by themselves", and with it `touched` ("a finger has moved this page at least
  // once"), which nothing else read. Within a screen of the top it asked, and again after each batch for as long as
  // the page stood there; a session whose first batch was under two screens tall was asked for at once. The rows
  // above are asked for by a pull at the top or by a press, and by nothing else (`HistoryOlderPull`). What a page
  // asked for above still does to the reader's place is `askedEarlier` and `earlierSettled`, above, unchanged.

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
