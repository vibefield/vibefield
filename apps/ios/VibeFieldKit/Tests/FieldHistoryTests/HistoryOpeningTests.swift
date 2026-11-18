import CoreGraphics
import Testing

@testable import FieldHistory

/// Item 417 (asked for 2026-11-14: a message view's first load adopts the desktop's latest design, the one with
/// our logo mark) — while a session's document is first read, its page is the hold the desktop
/// stands a conversation's wait in: the mark at the centre, the room's line under it.
///
/// These rows hold the hold's RULE: when a page waits, what it says, how long it is late, how long it stands once
/// it has shown, and the figures of its fades and its box. The figures are the desktop's (DESIGN.md §6 "History's
/// holds"; rosetta's room, `hold.css` and `use-standing-hold.ts`). How the mark looks on the page is to be seen
/// on a device.
@Suite("item 417 — a session's first reading is the hold: the mark, the room's line, late, standing out its floor")
struct HistoryOpeningTests {
  private typealias After = HistoryOpening.After
  private typealias Wait = HistoryOpening.Wait

  @Test("a session whose desktop answers and whose document is not held yet waits")
  func theWait() {
    #expect(HistoryOpening.wait(held: false, awake: true, landed: false) == Wait.loading)
  }

  @Test("a session a search landed in waits for its message")
  func theLanding() {
    #expect(HistoryOpening.wait(held: false, awake: true, landed: true) == Wait.finding)
  }

  @Test("a session whose document is held has no hold, and neither has one whose desktop does not answer")
  func noWait() {
    #expect(HistoryOpening.wait(held: true, awake: true, landed: false) == nil)
    #expect(HistoryOpening.wait(held: true, awake: true, landed: true) == nil)
    #expect(HistoryOpening.wait(held: true, awake: false, landed: false) == nil)
    // its desktop does not answer: the page's own note says so, and that is no wait
    #expect(HistoryOpening.wait(held: false, awake: false, landed: false) == nil)
    #expect(HistoryOpening.wait(held: false, awake: false, landed: true) == nil)
  }

  @Test("the hold says the room's words, and names no machinery")
  func theWords() {
    #expect(HistoryOpening.line(.loading) == "Loading messages…")
    #expect(HistoryOpening.line(.finding) == "Finding message…")
  }

  @Test("it is late: nothing for 120 ms, so a session read sooner shows no hold")
  func late() {
    #expect(HistoryOpening.late == Duration.milliseconds(120))
  }

  @Test("a hold that never began to show is gone at once")
  func neverShown() {
    #expect(HistoryOpening.after(shownFor: nil) == After.gone)
  }

  @Test("a hold that has begun to show stands out its floor of 800 ms")
  func theFloor() {
    #expect(HistoryOpening.floor == Duration.milliseconds(800))
    #expect(HistoryOpening.after(shownFor: Duration.zero) == After.stands(Duration.milliseconds(800)))
    // a session read 300 ms after it was opened: the hold had shown for 180
    #expect(
      HistoryOpening.after(shownFor: Duration.milliseconds(180)) == After.stands(Duration.milliseconds(620)))
    #expect(HistoryOpening.after(shownFor: Duration.milliseconds(799)) == After.stands(Duration.milliseconds(1)))
  }

  @Test("past its floor it leaves at once")
  func pastTheFloor() {
    #expect(HistoryOpening.after(shownFor: Duration.milliseconds(800)) == After.leaves)
    #expect(HistoryOpening.after(shownFor: Duration.seconds(12)) == After.leaves)
  }

  @Test("the mark comes in over 400 ms and the line over 180; the hold leaves over 280")
  func theFades() {
    #expect(HistoryOpening.markIn(reduceMotion: false) == 0.4)
    #expect(HistoryOpening.wordsIn(reduceMotion: false) == 0.18)
    #expect(HistoryOpening.leave(reduceMotion: false) == 0.28)
  }

  @Test("under Reduce Motion the fades are short: 160 for the mark, 120 for the line and 120 for the leave")
  func reducedMotion() {
    #expect(HistoryOpening.markIn(reduceMotion: true) == 0.16)
    #expect(HistoryOpening.wordsIn(reduceMotion: true) == 0.12)
    #expect(HistoryOpening.leave(reduceMotion: true) == 0.12)
  }

  @Test("the floor is the mark's coming in and a beat to read the line")
  func theFloorOutlastsTheMark() {
    #expect(HistoryOpening.floor > Duration.seconds(HistoryOpening.markIn(reduceMotion: false)))
    #expect(HistoryOpening.floor > Duration.zero)
  }

  @Test("the line stands 26 pt under the mark's box, the desktop's 99 by 44")
  func theBox() {
    #expect(HistoryOpening.markBox == CGSize(width: 99, height: 44))
    #expect(HistoryOpening.wordsUnder == 26)
  }
}
