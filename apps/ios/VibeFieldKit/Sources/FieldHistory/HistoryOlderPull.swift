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
// It overturns item 362b's rule for the page (`HistoryFollow.asksEarlier`, retired with this item): within a screen
// of its top the page asked for the rows above by itself, and again after each batch for as long as it stood there.
//
// Pure: the view feeds it how far the page stands past its top, whether a finger is on the page, when the page
// comes to rest and what the read did, and draws what it answers (`HistoryOlderMark`, `HistoryOlderLine`,
// HistoryOlderPullView.swift). Every number the pull's motion is made of is here, so a "more" or a "less" is one
// line.

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
  /// The last read brought nothing. The line at the top says so until the batch above is asked for again, or the
  /// document's top moves.
  private(set) var failed = false
  /// A finger is on the page.
  private var held = false
  /// How far the page stands past its top now, and how far it stood when the finger came down.
  private var stands: CGFloat = 0
  private var base: CGFloat = 0
  /// The read that was asked for has begun.
  private var heard = false
  /// The document's top has moved since the read was asked for.
  private var topMoved = false

  // MARK: What the page tells it

  /// How far the page stands past its top: nothing at its top and anywhere down the page. `offset` is the
  /// scroll's own and `topInset` what the navigation bar insets it by, so at rest at its top the two cancel.
  static func depth(offset: CGFloat, topInset: CGFloat) -> CGFloat { max(0, -(offset + topInset)) }

  /// The rows above can be read in: there are rows above, and their desktop answers.
  static func ready(hasEarlier: Bool, awake: Bool) -> Bool { hasEarlier && awake }

  /// A finger came down on the page, or left it. A pull is counted from where the page stands when the finger
  /// comes down. Letting go armed owes the read; letting go short of it lets the mark go back with the page, and
  /// a finger that catches the page on its way back pulls on from where it was.
  mutating func touch(_ down: Bool) {
    guard down != held else { return }
    held = down
    if down {
      if phase == .resting { base = stands }
      if phase == .springing { phase = .pulling }
      return
    }
    switch phase {
    case .armed: phase = .released
    case .pulling: phase = .springing
    case .resting, .springing, .released, .reading: break
    }
  }

  /// The page moved: it stands `depth` past its top (`depth(offset:topInset:)`). Under a finger the travel is
  /// the pull: armed from `arm`, and not armed again once back inside `disarm`. With no finger on it only a pull
  /// that was let go is followed back; a page that runs past its top by itself is no pull. While a read is owed or
  /// running a pull is ignored, and so is one with nothing to read (`ready`).
  mutating func moved(to depth: CGFloat, ready: Bool) {
    stands = depth
    if phase == .released || phase == .reading { return }
    guard ready else {
      phase = .resting
      travel = 0
      return
    }
    let pulled = max(0, depth - base)
    if held {
      travel = pulled
      if phase == .armed {
        if pulled < Self.disarm { phase = pulled > 0 ? .pulling : .resting }
      } else if pulled >= Self.arm {
        phase = .armed
      } else {
        phase = pulled > 0 ? .pulling : .resting
      }
    } else if phase == .springing {
      travel = min(travel, pulled)
      if pulled <= 0 { phase = .resting }
    } else {
      phase = .resting
      travel = 0
    }
  }

  /// The page came to rest. True when the batch above is to be asked for now: a pull was let go armed, and what
  /// the read brings will meet a page at rest. A pull let go armed with nothing left to read (its desktop stopped
  /// answering meanwhile) is said as a read that brought nothing. A page at rest is never pulled, and a page that
  /// only rests at its top asks for nothing.
  mutating func rested(ready: Bool) -> Bool {
    switch phase {
    case .released:
      travel = 0
      guard ready else {
        phase = .resting
        failed = true
        return false
      }
      asked()
      return true
    case .pulling, .armed, .springing:
      phase = .resting
      travel = 0
      return false
    case .resting, .reading:
      return false
    }
  }

  /// A press asked for the batch above: the line at the top, or the button at the side. True when it is to be
  /// asked for now, which is at once unless there is nothing to read or a read is already owed or running.
  mutating func pressed(ready: Bool) -> Bool {
    guard ready, phase != .released, phase != .reading else { return false }
    travel = 0
    asked()
    return true
  }

  private mutating func asked() {
    phase = .reading
    failed = false
    heard = false
    topMoved = false
  }

  // MARK: What the read tells it

  /// The read began. A read found already running when the document comes on screen is taken up here too; it is
  /// not this page's ask, so its end is never said to have brought nothing.
  mutating func began() {
    if phase != .reading { topMoved = true }
    phase = .reading
    travel = 0
    heard = true
  }

  /// The document's top moved: rows landed above, or the record's start was reached. Whatever the last read was
  /// said to bring, the rows above are not the ones it left.
  mutating func landed() {
    topMoved = true
    failed = false
  }

  /// The read ended. One that left the document's top where it was brought nothing, and the line says so.
  mutating func ended() {
    guard phase == .reading else { return }
    phase = .resting
    travel = 0
    base = stands
    failed = !topMoved
  }

  /// `heardWithin` has passed since the ask. If no read began it ends here, as a read that brought nothing
  /// unless the document's top moved meanwhile; a read that began ends by itself (`ended`).
  mutating func unheard() {
    guard phase == .reading, !heard else { return }
    phase = .resting
    travel = 0
    base = stands
    failed = !topMoved
  }

  // MARK: What it answers

  /// A read is owed or running: the line says `Reading earlier…` and the mark turns.
  var reads: Bool { phase == .released || phase == .reading }

  /// The mark as the pull stands.
  var mark: Mark {
    switch phase {
    case .resting:
      return .nothing
    case .pulling, .springing:
      let presence = Self.presence(travel: travel)
      return presence > 0 ? Mark(face: .pulling, presence: presence, fill: Self.fill(travel: travel)) : .nothing
    case .armed:
      return .armed
    case .released, .reading:
      return .reading
    }
  }

  /// How much of the ring is drawn for a travel: none at the top, whole at `arm`.
  static func fill(travel: CGFloat) -> CGFloat { min(1, max(0, travel / arm)) }

  /// How much of the mark is there for a travel: none up to `shows`, whole from `whole`.
  static func presence(travel: CGFloat) -> CGFloat { min(1, max(0, (travel - shows) / (whole - shows))) }

  /// The mark's size for how much of it is there: from `shrunk` to whole.
  static func size(presence: CGFloat) -> CGFloat { shrunk + (1 - shrunk) * presence }

  /// The mark is in the primary ink once letting go will read, and while it reads; before that, the secondary.
  static func strong(_ face: Face) -> Bool { face == .armed || face == .reading }

  /// How far round the turning arc stands at a time in seconds, in degrees: once round in `turn`.
  static func angle(at seconds: Double) -> Double {
    (seconds / turn).truncatingRemainder(dividingBy: 1) * 360
  }

  /// The mark's words; none when there is no mark.
  static func words(_ face: Face) -> String? {
    switch face {
    case .nothing: return nil
    case .pulling: return "Pull down for earlier messages"
    case .armed: return "Release for earlier messages"
    case .reading: return "Reading earlier messages…"
    }
  }

  /// What the rule under the document's head says. The record's start outranks everything; then a read that is
  /// owed or running; then a desktop that does not answer; then the last read's failure.
  static func top(hasEarlier: Bool, awake: Bool, reading: Bool, failed: Bool) -> Top {
    guard hasEarlier else { return .start }
    if reading { return .reading }
    guard awake else { return .asleep }
    return failed ? .failed : .pull
  }

  /// The rule's words. `startDay` is the day the session began (`Sat 12 Sep`); `desktop` is its desktop's name.
  static func line(_ top: Top, startDay: String, desktop: String) -> String {
    switch top {
    case .start: "Session start · \(startDay)"
    case .pull: "Earlier · pull down"
    case .reading: "Reading earlier…"
    case .failed: "Couldn't read earlier · pull again"
    case .asleep: "Earlier · needs \(desktop)"
    }
  }

  /// A press on the rule reads the batch above: where a pull would.
  static func presses(_ top: Top) -> Bool { top == .pull || top == .failed }

  /// What VoiceOver names the rule where it is a button; nil where the rule's own words are its name.
  static func spoken(_ top: Top, desktop: String) -> String? {
    switch top {
    case .start, .reading: return nil
    case .pull: return "Read the earlier messages"
    case .failed: return "Couldn't read the earlier messages. Read them again"
    case .asleep: return "The earlier messages need \(desktop)"
    }
  }
}
