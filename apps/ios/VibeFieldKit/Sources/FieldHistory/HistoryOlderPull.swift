import CoreGraphics

// Item 418 (James, 2026-11-14 08:13:38Z, session qa-01: "i feel message progressive load is not there, because it
// seems still trying to load everything, what i want is when you scroll to the top of the current loaded batch, there
// should be a clear pull down action like real world chat apps, you pull down for load more, there will be visual
// indicator when you pull down, there will be loading indicator when you release, all these motions should designs
// intuitively and nicely with clear feedbacks") — THE PULL AT A SESSION DOCUMENT'S TOP. A session opens on its
// latest batch and reads nothing above it by itself; the rows above are read in by a pull down at the document's top,
// one batch for each pull. DESIGN.md §8 "The phone's session document", "The rows above are read in when you pull
// down at the top".
//
// A STUB AT THIS COMMIT (418, red). The numbers and the names are the text's. The rule is not written: what stands
// in its place answers as item 362b's rule does (`HistoryFollow.asksEarlier`, which the page still runs on): a page
// at rest with rows above asks for them by itself, there is no pull and no mark, and the line at the top says
// 362b's words. The rows in HistoryOlderPullTests.swift fail on it.

/// The pull at a session document's top that reads the batch above in: where the pull stands, what its mark and the
/// line at the top say, and every number its motion is made of.
struct HistoryOlderPull: Equatable, Sendable {
  // MARK: The numbers

  /// How far past its top the page is pulled before letting go reads the batch above, in points of the page's own
  /// travel. The system's rubber band lets the page travel about half as far as the finger, so this is about 125 pt
  /// under the finger on a phone 852 pt tall (a reading of the usual account of that band, not measured): near the
  /// 132 pt of the finger's the Apps door opens at, and the 120 px the room's own pull takes.
  static let arm: CGFloat = 64
  /// An armed pull stays armed until the page is back inside this: 12 pt under `arm`, so a finger resting at the
  /// line does not arm, and tick, twice.
  static let disarm: CGFloat = 52
  /// The mark is not drawn for this much travel: the small overshoot of an ordinary scroll shows nothing.
  static let shows: CGFloat = 10
  /// By this much travel the mark is whole. From `shows` to here its opacity and its size rise with the travel.
  static let whole: CGFloat = 40
  /// The share of its size the mark grows from, about its top, as it comes in. Under Reduce Motion it does not grow.
  static let shrunk: CGFloat = 0.86
  /// The mark is a glass pill as tall as the pill at the document's foot…
  static let pill: CGFloat = 36
  /// …with its top this far under the navigation bar's foot, so at `arm` the gap the pull has opened holds it with
  /// 20 pt to spare.
  static let inset: CGFloat = 8
  /// The ring in the mark: how wide it is, how thick its line, and the size of the arrow inside it.
  static let ring: CGFloat = 18
  static let stroke: CGFloat = 2
  static let arrow: CGFloat = 9
  /// The mark's words (medium), the room between the ring and them, and the room at the pill's two ends.
  static let type: CGFloat = 13
  static let gap: CGFloat = 7
  static let padding: CGFloat = 14
  /// While a batch is read the ring is an arc this much of a circle, and turns once in this many seconds.
  static let arc: CGFloat = 0.7
  static let turn: Double = 0.9
  /// The mark's own changes (armed and back, the turn to reading, its leaving), in seconds on the plain ease.
  static let fade: Double = 0.2
  /// How long an ask may stand with no read begun before it is said to have brought nothing. The reader says a read
  /// has begun in the turn it is asked, so only an ask nothing took up (a document with no reader behind it) waits
  /// this long.
  static let heardWithin = Duration.milliseconds(500)

  // MARK: Where the pull stands

  /// Where the pull stands.
  enum Phase: Equatable, Sendable {
    /// Nothing is pulled and nothing is read.
    case resting
    /// A finger holds the page past its top, short of `arm`: letting go springs back.
    case pulling
    /// A finger holds the page past `arm`: letting go reads the batch above.
    case armed
    /// The finger let go short of `arm`: the mark goes back with the page.
    case springing
    /// The finger let go armed: the read is owed, and is asked for when the page comes to rest.
    case released
    /// The batch above is being read.
    case reading
  }

  /// Which face the mark wears. A change of face eases; within a face the mark follows the finger.
  enum Face: Equatable, Sendable {
    /// No mark.
    case nothing
    /// `Pull down for earlier messages`, the ring filling.
    case pulling
    /// `Release for earlier messages`, the ring closed and its arrow up.
    case armed
    /// `Reading earlier messages…`, the ring an arc that turns.
    case reading
  }

  /// What the mark over the document's top draws.
  struct Mark: Equatable, Sendable {
    var face: Face
    /// How much of the mark is there, 0…1: its opacity, and its size from `shrunk` to whole.
    var presence: CGFloat
    /// How much of its ring is drawn, 0…1.
    var fill: CGFloat

    static let nothing = Mark(face: .nothing, presence: 0, fill: 0)
    static let armed = Mark(face: .armed, presence: 1, fill: 1)
    static let reading = Mark(face: .reading, presence: 1, fill: HistoryOlderPull.arc)
  }

  /// What the rule under the document's head says of the rows above.
  enum Top: Equatable, Sendable {
    /// Nothing is above: `Session start · Sat 12 Sep`.
    case start
    /// Rows are above and their desktop answers: `Earlier · pull down`.
    case pull
    /// A batch is owed or being read: `Reading earlier…`.
    case reading
    /// The last read brought nothing: `Couldn't read earlier · pull again`.
    case failed
    /// Rows are above and their desktop does not answer: `Earlier · needs studio`.
    case asleep
  }

  private(set) var phase: Phase = .resting
  /// How far the page has travelled past where it stood when the finger came down, in points.
  private(set) var travel: CGFloat = 0
  /// The last read brought nothing.
  private(set) var failed = false

  // MARK: What the page tells it (stubs)

  /// STUB: no page is ever past its top.
  static func depth(offset: CGFloat, topInset: CGFloat) -> CGFloat { 0 }

  /// The rows above can be read in: there are rows above, and their desktop answers.
  static func ready(hasEarlier: Bool, awake: Bool) -> Bool { hasEarlier && awake }

  /// STUB: a finger is not heard.
  mutating func touch(_ down: Bool) {}

  /// STUB: the page's travel is not heard.
  mutating func moved(to depth: CGFloat, ready: Bool) {}

  /// STUB, and 362b's rule: a page at rest with rows above asks for them by itself.
  mutating func rested(ready: Bool) -> Bool { ready }

  /// STUB: a press asks whenever there is something to read, as `Earlier` did.
  mutating func pressed(ready: Bool) -> Bool { ready }

  // MARK: What the read tells it (stubs)

  /// STUB: nothing is kept of a read.
  mutating func began() {}

  /// STUB.
  mutating func landed() {}

  /// STUB.
  mutating func ended() {}

  /// STUB.
  mutating func unheard() {}

  // MARK: What it answers (stubs)

  /// STUB: no read is ever owed.
  var reads: Bool { false }

  /// STUB: there is no mark.
  var mark: Mark { .nothing }

  /// STUB.
  static func fill(travel: CGFloat) -> CGFloat { 0 }

  /// STUB.
  static func presence(travel: CGFloat) -> CGFloat { 0 }

  /// STUB.
  static func size(presence: CGFloat) -> CGFloat { 1 }

  /// STUB.
  static func strong(_ face: Face) -> Bool { false }

  /// STUB.
  static func angle(at seconds: Double) -> Double { 0 }

  /// STUB: the mark has no words.
  static func words(_ face: Face) -> String? { nil }

  /// STUB, and 362b's rule (`HistoryFollow.head`): a read's failure is never said.
  static func top(hasEarlier: Bool, awake: Bool, reading: Bool, failed: Bool) -> Top {
    guard hasEarlier else { return .start }
    if reading { return .reading }
    return awake ? .pull : .asleep
  }

  /// STUB: 362b's words.
  static func line(_ top: Top, startDay: String, desktop: String) -> String {
    switch top {
    case .start: "Session start · \(startDay)"
    case .pull, .failed: "Earlier"
    case .reading: "Reading earlier…"
    case .asleep: "Earlier · needs \(desktop)"
    }
  }

  /// STUB: `Earlier` took a press.
  static func presses(_ top: Top) -> Bool { top == .pull }

  /// STUB: 362b's spoken name, whatever the rule says.
  static func spoken(_ top: Top, desktop: String) -> String? { "Read the earlier rows" }
}
