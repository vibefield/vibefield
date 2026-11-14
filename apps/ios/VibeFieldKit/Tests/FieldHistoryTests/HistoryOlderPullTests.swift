import CoreGraphics
import Testing

@testable import FieldHistory

/// Item 418 (James, 2026-11-14 08:13:38Z, session qa-01: "i feel message progressive load is not there, because it
/// seems still trying to load everything, what i want is when you scroll to the top of the current loaded batch, there
/// should be a clear pull down action like real world chat apps, you pull down for load more, there will be visual
/// indicator when you pull down, there will be loading indicator when you release, all these motions should designs
/// intuitively and nicely with clear feedbacks") — the rows above a session's document are read in by a pull down
/// at its top, one batch for each pull, and never by themselves. It overturns item 362b's rule, by which a page
/// within a screen of its top asked for the rows above by itself.
///
/// These rows hold the RULE: what the page tells the pull (how far it stands past its top, whether a finger is on
/// it, when it comes to rest, what the read did) and what the pull answers (whether the batch above is asked for,
/// what the mark draws, what the line says). That a finger on a phone moves the page as the rule is fed, how the
/// mark looks over the gap, and where the rows land are his to see.
///
/// Every mutating call is taken into a `let` first, so no macro has to expand one.
@Suite("item 418 — the rows above a session's document are read in by a pull at its top, never by themselves")
struct HistoryOlderPullTests {
  /// A pull under a finger, from a page at rest at its top to `depth` past it.
  private func pulled(to depth: CGFloat) -> HistoryOlderPull {
    var pull = HistoryOlderPull()
    pull.touch(true)
    pull.moved(to: depth, ready: true)
    return pull
  }

  // MARK: Nothing by itself

  @Test("a page that opens, stands at its top or comes to rest there asks for nothing, with rows above or not")
  func nothingByItself() {
    var pull = HistoryOlderPull()
    let opened = pull.rested(ready: true)
    #expect(opened == false, "362b: a page at rest near its top asked for the rows above by itself")
    // scrolled to the top by a finger that never pulls past it, and let go there
    pull.touch(true)
    pull.moved(to: 0, ready: true)
    pull.touch(false)
    let atTop = pull.rested(ready: true)
    #expect(atTop == false)
    // and again, however long it rests there
    let later = pull.rested(ready: true)
    #expect(later == false)
    #expect(pull.mark == .nothing)
    #expect(pull.reads == false)
    #expect(pull.phase == .resting)
  }

  @Test("a page that runs past its top with no finger on it is no pull: no mark, and nothing asked when it rests")
  func aBounceIsNoPull() {
    var pull = HistoryOlderPull()
    // a flick's bounce, well past the arm
    pull.moved(to: 90, ready: true)
    #expect(pull.mark == .nothing)
    #expect(pull.phase == .resting)
    pull.moved(to: 0, ready: true)
    let rests = pull.rested(ready: true)
    #expect(rests == false)
  }

  // MARK: Under the finger

  @Test("under a finger the mark comes in between 10 and 40 points of travel, and its ring fills to 64")
  func theRingFills() {
    #expect(pulled(to: 10).mark == .nothing, "the first 10 points show nothing")
    #expect(pulled(to: 10).phase == .pulling)
    #expect(pulled(to: 25).mark == HistoryOlderPull.Mark(face: .pulling, presence: 0.5, fill: 0.390625))
    #expect(pulled(to: 40).mark == HistoryOlderPull.Mark(face: .pulling, presence: 1, fill: 0.625))
    #expect(pulled(to: 48).mark == HistoryOlderPull.Mark(face: .pulling, presence: 1, fill: 0.75))
    #expect(pulled(to: 48).travel == 48)
    // the pieces
    #expect(HistoryOlderPull.fill(travel: 0) == 0)
    #expect(HistoryOlderPull.fill(travel: 32) == 0.5)
    #expect(HistoryOlderPull.fill(travel: 64) == 1)
    #expect(HistoryOlderPull.fill(travel: 200) == 1)
    #expect(HistoryOlderPull.presence(travel: 4) == 0)
    #expect(HistoryOlderPull.presence(travel: 25) == 0.5)
    #expect(HistoryOlderPull.presence(travel: 90) == 1)
  }

  @Test("at 64 points the pull is armed; it is not armed again until the page is back inside 52")
  func armed() {
    var pull = pulled(to: 63)
    #expect(pull.phase == .pulling)
    pull.moved(to: 64, ready: true)
    #expect(pull.phase == .armed)
    #expect(pull.mark == .armed)
    #expect(pull.mark.fill == 1, "the ring is closed")
    // the finger eases back, still past 52: armed still, so a finger resting at the line does not tick twice
    pull.moved(to: 52, ready: true)
    #expect(pull.phase == .armed)
    pull.moved(to: 51, ready: true)
    #expect(pull.phase == .pulling)
    #expect(pull.mark.face == .pulling)
    // between 52 and 64 on the way down it is not yet armed
    pull.moved(to: 60, ready: true)
    #expect(pull.phase == .pulling)
    pull.moved(to: 70, ready: true)
    #expect(pull.phase == .armed)
  }

  @Test("the pull is counted from where the page stood when the finger came down")
  func countedFromTheFingersComingDown() {
    var pull = HistoryOlderPull()
    // the finger catches a page that is 30 past its top on a bounce
    pull.moved(to: 30, ready: true)
    pull.touch(true)
    pull.moved(to: 80, ready: true)
    #expect(pull.travel == 50)
    #expect(pull.phase == .pulling)
    pull.moved(to: 94, ready: true)
    #expect(pull.phase == .armed)
  }

  // MARK: Let go

  @Test("let go short of the arm, the mark goes back with the page and nothing is asked")
  func letGoShort() {
    var pull = pulled(to: 48)
    pull.touch(false)
    #expect(pull.phase == .springing)
    #expect(pull.reads == false)
    // the page springs back, and the mark with it
    pull.moved(to: 25, ready: true)
    #expect(pull.mark == HistoryOlderPull.Mark(face: .pulling, presence: 0.5, fill: 0.390625))
    pull.moved(to: 0, ready: true)
    #expect(pull.mark == .nothing)
    #expect(pull.phase == .resting)
    let rests = pull.rested(ready: true)
    #expect(rests == false)
  }

  @Test("a finger that catches the page on its way back pulls on from where it was")
  func caughtOnItsWayBack() {
    var pull = pulled(to: 48)
    pull.touch(false)
    pull.moved(to: 30, ready: true)
    pull.touch(true)
    #expect(pull.phase == .pulling)
    pull.moved(to: 66, ready: true)
    #expect(pull.travel == 66, "counted from the page's top, as the pull it continues was")
    #expect(pull.phase == .armed)
  }

  @Test("let go armed, the read is owed at once and asked for once, when the page has come to rest")
  func letGoArmed() {
    var pull = pulled(to: 70)
    pull.touch(false)
    #expect(pull.phase == .released)
    #expect(pull.reads, "the line says Reading earlier… from the release")
    #expect(pull.mark == .reading, "and the mark turns from the release")
    // the page springs back under the mark, which stays whole
    pull.moved(to: 20, ready: true)
    #expect(pull.mark == .reading)
    pull.moved(to: 0, ready: true)
    let asks = pull.rested(ready: true)
    #expect(asks, "the batch above is asked for when the page is at rest")
    #expect(pull.phase == .reading)
    let again = pull.rested(ready: true)
    #expect(again == false, "asked for once")
  }

  @Test("a pull while a batch is owed or being read is ignored, not queued")
  func ignoredWhileReading() {
    var pull = pulled(to: 70)
    pull.touch(false)
    // pulled again before the page has come to rest
    pull.touch(true)
    pull.moved(to: 90, ready: true)
    pull.touch(false)
    #expect(pull.phase == .released)
    let asks = pull.rested(ready: true)
    #expect(asks)
    pull.began()
    // and again while the batch is read
    pull.touch(true)
    pull.moved(to: 90, ready: true)
    #expect(pull.mark == .reading)
    pull.touch(false)
    let again = pull.rested(ready: true)
    #expect(again == false)
    let pressed = pull.pressed(ready: true)
    #expect(pressed == false, "a press while one is read asks for nothing either")
    #expect(pull.phase == .reading)
  }

  @Test("let go armed with nothing left to read, nothing is asked and the line says the read brought nothing")
  func letGoArmedWithNothingToRead() {
    var pull = pulled(to: 70)
    pull.touch(false)
    // its desktop stopped answering before the page came to rest
    let asks = pull.rested(ready: false)
    #expect(asks == false)
    #expect(pull.phase == .resting)
    #expect(pull.failed)
    #expect(pull.mark == .nothing)
  }

  // MARK: Nothing to read

  @Test("with nothing above, or a desktop that does not answer, a pull does nothing")
  func nothingToRead() {
    #expect(HistoryOlderPull.ready(hasEarlier: true, awake: true))
    #expect(HistoryOlderPull.ready(hasEarlier: false, awake: true) == false)
    #expect(HistoryOlderPull.ready(hasEarlier: true, awake: false) == false)
    var pull = HistoryOlderPull()
    pull.touch(true)
    pull.moved(to: 90, ready: false)
    #expect(pull.mark == .nothing)
    #expect(pull.phase == .resting)
    pull.touch(false)
    let rests = pull.rested(ready: false)
    #expect(rests == false)
    let pressed = pull.pressed(ready: false)
    #expect(pressed == false)
    #expect(pull.failed == false, "nothing was asked, so nothing failed")
  }

  // MARK: The read

  @Test("a read that moved the document's top ends the mark and says no failure")
  func aReadThatBroughtRows() {
    var pull = pulled(to: 70)
    pull.touch(false)
    let asks = pull.rested(ready: true)
    #expect(asks)
    pull.began()
    #expect(pull.mark == .reading)
    pull.landed()
    #expect(pull.mark == .reading, "a batch of several pages lands page by page: the mark turns until its end")
    pull.ended()
    #expect(pull.phase == .resting)
    #expect(pull.mark == .nothing)
    #expect(pull.reads == false)
    #expect(pull.failed == false)
  }

  @Test("a read that left the document's top where it was brought nothing: the line says so until the next ask")
  func aReadThatBroughtNothing() {
    var pull = pulled(to: 70)
    pull.touch(false)
    pull.moved(to: 0, ready: true)
    let asks = pull.rested(ready: true)
    #expect(asks)
    pull.began()
    pull.ended()
    #expect(pull.phase == .resting)
    #expect(pull.mark == .nothing)
    #expect(pull.failed)
    // nothing asks again by itself
    let rests = pull.rested(ready: true)
    #expect(rests == false)
    #expect(pull.failed)
    // a pull does
    pull.touch(true)
    pull.moved(to: 70, ready: true)
    #expect(pull.phase == .armed)
    pull.touch(false)
    let again = pull.rested(ready: true)
    #expect(again)
    #expect(pull.failed == false, "asked again, the failure is no longer said")
  }

  @Test("the document's top moving clears a failure, whichever of the two is heard first")
  func theTopMoving() {
    var pull = HistoryOlderPull()
    let asks = pull.pressed(ready: true)
    #expect(asks)
    pull.began()
    // the read's end is heard before the rows it brought
    pull.ended()
    #expect(pull.failed)
    pull.landed()
    #expect(pull.failed == false)
  }

  @Test("an ask no read took up ends as a read that brought nothing; one that began ends by itself")
  func anAskNothingTookUp() {
    #expect(HistoryOlderPull.heardWithin == .milliseconds(500))
    var pull = HistoryOlderPull()
    let asks = pull.pressed(ready: true)
    #expect(asks)
    pull.unheard()
    #expect(pull.phase == .resting)
    #expect(pull.failed)
    // a read that began is left to end by itself
    var heard = HistoryOlderPull()
    let asked = heard.pressed(ready: true)
    #expect(asked)
    heard.began()
    heard.unheard()
    #expect(heard.phase == .reading)
    #expect(heard.failed == false)
    // an ask whose rows landed before anything said it had begun brought them
    var quick = HistoryOlderPull()
    let third = quick.pressed(ready: true)
    #expect(third)
    quick.landed()
    quick.unheard()
    #expect(quick.phase == .resting)
    #expect(quick.failed == false)
  }

  @Test("a read found running when the document comes on screen is taken up: the mark turns until it ends")
  func aReadFoundRunning() {
    var pull = HistoryOlderPull()
    pull.began()
    #expect(pull.phase == .reading)
    #expect(pull.reads)
    #expect(pull.mark == .reading)
    pull.ended()
    #expect(pull.phase == .resting)
    #expect(pull.mark == .nothing)
    #expect(pull.failed == false, "a read this page did not ask for is not said to have brought nothing")
  }

  // MARK: A press

  @Test("a press asks for the batch above at once, with no pull and no wait for the page to rest")
  func aPress() {
    var pull = HistoryOlderPull()
    let asks = pull.pressed(ready: true)
    #expect(asks)
    #expect(pull.phase == .reading)
    #expect(pull.mark == .reading)
    #expect(pull.reads)
    let again = pull.pressed(ready: true)
    #expect(again == false, "one read at a time")
    // a press in the middle of a pull takes it over
    var midPull = pulled(to: 30)
    let taken = midPull.pressed(ready: true)
    #expect(taken)
    #expect(midPull.mark == .reading)
  }
}

/// Item 418 — what the pull says: the mark's words over the gap, and the rule under the document's head.
@Suite("item 418 — the pull's words: the mark over the top, and the line under the head")
struct HistoryOlderWordsTests {
  @Test("the mark says what the finger is to do, in the Apps door's grammar, and then what is being done")
  func theMarksWords() {
    #expect(HistoryOlderPull.words(.nothing) == nil)
    #expect(HistoryOlderPull.words(.pulling) == "Pull down for earlier messages")
    #expect(HistoryOlderPull.words(.armed) == "Release for earlier messages")
    #expect(HistoryOlderPull.words(.reading) == "Reading earlier messages…")
  }

  @Test("the line says where the rows above stand: the start, a read, a sleeping desktop, a failure, else the pull")
  func theLine() {
    typealias Pull = HistoryOlderPull
    #expect(Pull.top(hasEarlier: false, awake: true, reading: false, failed: false) == .start)
    #expect(Pull.top(hasEarlier: false, awake: false, reading: true, failed: true) == .start, "the start outranks all")
    #expect(Pull.top(hasEarlier: true, awake: true, reading: false, failed: false) == .pull)
    #expect(Pull.top(hasEarlier: true, awake: true, reading: true, failed: true) == .reading)
    #expect(Pull.top(hasEarlier: true, awake: false, reading: true, failed: false) == .reading)
    #expect(Pull.top(hasEarlier: true, awake: false, reading: false, failed: true) == .asleep)
    #expect(Pull.top(hasEarlier: true, awake: true, reading: false, failed: true) == .failed)
  }

  @Test("the line's words, and which of them take a press")
  func theLinesWords() {
    func line(_ top: HistoryOlderPull.Top) -> String {
      HistoryOlderPull.line(top, startDay: "Sat 12 Sep", desktop: "studio")
    }
    #expect(line(.start) == "Session start · Sat 12 Sep")
    #expect(line(.pull) == "Earlier · pull down")
    #expect(line(.reading) == "Reading earlier…")
    #expect(line(.failed) == "Couldn't read earlier · pull again")
    #expect(line(.asleep) == "Earlier · needs studio")
    // a press reads where a pull would
    #expect(HistoryOlderPull.presses(.pull))
    #expect(HistoryOlderPull.presses(.failed))
    #expect(HistoryOlderPull.presses(.start) == false)
    #expect(HistoryOlderPull.presses(.reading) == false)
    #expect(HistoryOlderPull.presses(.asleep) == false)
  }

  @Test("VoiceOver names the line by what a press on it does, and by its own words where it does nothing")
  func theLinesSpokenName() {
    #expect(HistoryOlderPull.spoken(.pull, desktop: "studio") == "Read the earlier messages")
    let failed = HistoryOlderPull.spoken(.failed, desktop: "studio")
    #expect(failed == "Couldn't read the earlier messages. Read them again")
    #expect(HistoryOlderPull.spoken(.asleep, desktop: "studio") == "The earlier messages need studio")
    #expect(HistoryOlderPull.spoken(.start, desktop: "studio") == nil)
    #expect(HistoryOlderPull.spoken(.reading, desktop: "studio") == nil)
  }
}

/// Item 418 — the numbers the pull's motion is made of, each named where a "more" or a "less" would change it.
@Suite("item 418 — the pull's measures")
struct HistoryOlderMeasuresTests {
  @Test("how far the page stands past its top: nothing at its top or down the page, the overshoot above it")
  func theDepth() {
    // under a navigation bar that insets the scroll by 100, a page at rest at its top stands at -100
    #expect(HistoryOlderPull.depth(offset: -100, topInset: 100) == 0)
    #expect(HistoryOlderPull.depth(offset: -164, topInset: 100) == 64)
    #expect(HistoryOlderPull.depth(offset: 400, topInset: 100) == 0)
    #expect(HistoryOlderPull.depth(offset: -30, topInset: 0) == 30)
  }

  @Test("the arm is 64 points of the page's travel and the disarm 52; the mark shows from 10 and is whole by 40")
  func theTravel() {
    #expect(HistoryOlderPull.arm == 64)
    #expect(HistoryOlderPull.disarm == 52)
    #expect(HistoryOlderPull.shows == 10)
    #expect(HistoryOlderPull.whole == 40)
    #expect(HistoryOlderPull.disarm < HistoryOlderPull.arm)
    #expect(HistoryOlderPull.whole < HistoryOlderPull.disarm, "the mark is whole before it can be armed")
  }

  @Test("the mark: a 36 pt pill 8 under the bar's foot, clear of the document at the arm; its ring, its words")
  func theMark() {
    #expect(HistoryOlderPull.pill == 36)
    #expect(HistoryOlderPull.pill == HistoryBefore.pill, "as tall as the pill at the foot")
    #expect(HistoryOlderPull.inset == 8)
    let foot = HistoryOlderPull.inset + HistoryOlderPull.pill
    #expect(foot < HistoryOlderPull.arm, "at the arm the gap the pull opened holds the whole mark")
    #expect(HistoryOlderPull.ring == 18)
    #expect(HistoryOlderPull.stroke == 2)
    #expect(HistoryOlderPull.arrow == 9)
    #expect(HistoryOlderPull.type == 13)
    #expect(HistoryOlderPull.gap == 7)
    #expect(HistoryOlderPull.padding == 14)
  }

  @Test("the mark grows from 0.86 of its size to whole, and goes to the primary ink once letting go will read")
  func theMarksArrival() {
    #expect(HistoryOlderPull.shrunk == 0.86)
    #expect(HistoryOlderPull.size(presence: 0) == 0.86)
    #expect(HistoryOlderPull.size(presence: 1) == 1)
    let half: CGFloat = 0.93
    #expect(abs(HistoryOlderPull.size(presence: 0.5) - half) < 0.000_001)
    #expect(HistoryOlderPull.strong(.pulling) == false)
    #expect(HistoryOlderPull.strong(.armed))
    #expect(HistoryOlderPull.strong(.reading))
    #expect(HistoryOlderPull.strong(.nothing) == false)
  }

  @Test("while it reads the ring is an arc of seven tenths that turns once in 0.9 s; the mark's changes take 200 ms")
  func theTurn() {
    #expect(HistoryOlderPull.arc == 0.7)
    #expect(HistoryOlderPull.Mark.reading.fill == 0.7)
    #expect(HistoryOlderPull.turn == 0.9)
    #expect(HistoryOlderPull.fade == 0.2)
    #expect(HistoryOlderPull.angle(at: 0) == 0)
    #expect(HistoryOlderPull.angle(at: 0.45) == 180)
    let round = HistoryOlderPull.angle(at: 1.35)
    #expect(abs(round - 180) < 0.000_001, "a turn and a half is half a turn round")
  }
}
