import CoreGraphics
import Testing

@testable import FieldHistory

/// Item 362a (asked for 2026-11-12, of the phone's History session view: that it flow as a chat app's messages
/// do, not start at the top) — a session's document opens at its end and keeps its end in view,
/// as the desktop's transcript does, and a document a search landed in still opens on the landed row.
///
/// These rows hold the RULE. Where the page stands on a phone is to be seen on a device.
@Suite("item 362a — a session's document opens at its end and follows")
struct HistoryFollowTests {
  @Test("a document opens at its end, following")
  func opensAtItsEnd() {
    let follow = HistoryFollow(landed: false)
    #expect(follow.opening == .end)
    #expect(follow.following)
    #expect(follow.growth == .foot, "rows that land while it follows leave the foot in view")
  }

  @Test("a document a search landed in opens on the landed row and does not follow")
  func aLandingStaysOnItsRow() {
    let follow = HistoryFollow(landed: true)
    #expect(follow.opening == .landing)
    #expect(follow.following == false)
    #expect(follow.growth == .head, "a row arriving below does not move the landed row")
    // nothing unread and the end a screen away: the way back is offered, never taken
    #expect(follow.pill(arrivals: 0, endOnScreen: false, away: true) == .latest)
  }

  @Test("the stepper walking to another hit stops a document that had been following")
  func aLaterLandingStopsTheFollowing() {
    var follow = HistoryFollow(landed: false)
    follow.landed()
    #expect(follow.following == false)
    #expect(follow.opening == .end, "where it opened is not rewritten")
  }

  @Test("a drag stops the following at once; a rest at the foot resumes it, a rest off the foot does not")
  func aDragAndARest() {
    var follow = HistoryFollow(landed: false)
    follow.dragged()
    #expect(follow.following == false)
    follow.rested(atFoot: false)
    #expect(follow.following == false)
    follow.dragged()
    follow.rested(atFoot: true)
    #expect(follow.following)
  }

  @Test("the foot is in view within 24 points of the end; away is more than a screen from it")
  func theReach() {
    // a 600-point screen over 3,000 points of document
    #expect(HistoryFollow.footSlack == 24)
    #expect(HistoryFollow.reach(offset: 2_400, container: 600, content: 3_000) == .init(atFoot: true, away: false))
    #expect(HistoryFollow.reach(offset: 2_376, container: 600, content: 3_000).atFoot)
    #expect(HistoryFollow.reach(offset: 2_375, container: 600, content: 3_000).atFoot == false)
    #expect(HistoryFollow.reach(offset: 1_800, container: 600, content: 3_000).away == false, "exactly a screen")
    #expect(HistoryFollow.reach(offset: 1_799, container: 600, content: 3_000).away)
    // a document shorter than its screen is at its foot
    #expect(HistoryFollow.reach(offset: 0, container: 600, content: 200) == .init(atFoot: true, away: false))
  }

  @Test("the pill: arrivals while the end is off screen, Latest a screen or more up with nothing unread, else none")
  func thePill() {
    var follow = HistoryFollow(landed: false)
    #expect(follow.pill(arrivals: 0, endOnScreen: true, away: false) == nil)
    follow.dragged()
    follow.rested(atFoot: false)
    #expect(follow.pill(arrivals: 0, endOnScreen: false, away: false) == nil, "a short way up the page")
    #expect(follow.pill(arrivals: 0, endOnScreen: false, away: true) == .latest)
    #expect(follow.pill(arrivals: 3, endOnScreen: false, away: true) == .arrivals(3), "arrivals outrank Latest")
    #expect(follow.pill(arrivals: 3, endOnScreen: true, away: false) == nil, "rows in view are read")
    #expect(HistoryFollow.words(.arrivals(3)) == "3 new")
    #expect(HistoryFollow.words(.latest) == "Latest")
    #expect(HistoryFollow.spoken(.arrivals(3)) == "3 new rows, scroll to them")
    #expect(HistoryFollow.spoken(.latest) == "Scroll to the latest row")
  }

  @Test("a press on the pill follows again")
  func thePillsPress() {
    var follow = HistoryFollow(landed: true)
    follow.pressed()
    #expect(follow.following)
    #expect(follow.pill(arrivals: 0, endOnScreen: false, away: true) == nil, "on its way to the end")
  }

  // Item 386 (asked for 2026-11-13, of a session's document on a phone: the Latest button works, where it did not) —
  // the two rows below. The cause is a reading of the code, not yet shown on a device: the press eased to the end
  // whatever the distance, an eased move over rows not yet laid out aims at an estimate of the end and rests short
  // of it, and that rest stopped the following, so the pill came back over a page that had not arrived.
  @Test("a press goes to the end at once when it is more than a screen below, and on the ease when nearer")
  func howAPressGoes() {
    #expect(HistoryFollow.going(away: true) == .atOnce, "`Latest` is always more than a screen from the end")
    #expect(HistoryFollow.going(away: false) == .eased, "arrivals a short way below")
  }

  @Test("the rest of a press's own move, short of the end, does not stop the following; a finger does")
  func aPressIsNotStoppedByItsOwnRest() {
    var follow = HistoryFollow(landed: true)
    follow.pressed()
    follow.rested(atFoot: false)
    #expect(follow.following, "still on its way: each change in the document's height puts the foot back")
    #expect(follow.pill(arrivals: 0, endOnScreen: false, away: true) == nil)
    follow.rested(atFoot: true)
    #expect(follow.following, "arrived")
    // arrived, a rest off the foot is the reader's own again, and stops the following as it always did
    follow.rested(atFoot: false)
    #expect(follow.following == false)
    // on its way, a finger takes the page at once
    follow.pressed()
    follow.dragged()
    follow.rested(atFoot: false)
    #expect(follow.following == false)
    #expect(follow.pill(arrivals: 0, endOnScreen: false, away: true) == .latest)
    // and a landing ends a return as it ends the following
    follow.pressed()
    follow.landed()
    follow.rested(atFoot: true)
    #expect(follow.following, "a rest at the foot follows, as any rest there does")
    follow.pressed()
    follow.landed()
    follow.rested(atFoot: false)
    #expect(follow.following == false)
  }

  @Test("off the foot a change in height leaves the head; a page asked for above holds the foot until it settles")
  func theGrowth() {
    var follow = HistoryFollow(landed: false)
    follow.dragged()
    follow.rested(atFoot: false)
    #expect(follow.growth == .head, "a row arriving below, a run opened by hand")
    follow.askedEarlier()
    #expect(follow.holding)
    #expect(follow.growth == .foot, "what the page adds lands above the reader's place")
    follow.earlierSettled()
    #expect(follow.holding == false)
    #expect(follow.growth == .head)
  }
}

/// Items 387 and 389 (asked for 2026-11-13, of a session's document on a phone: nothing stacked or overlapping
/// there, and enough safe, empty space left under the last message, where it
/// looked bad) — the document's end and its pill clear whatever stands over the page's foot: the bar, and the slot
/// above it when a session has an act or a search has landed. The page cleared the bar alone.
///
/// The measure is what stands over the foot above the safe area's line (`RootHead.bar`): 57 for the bar on a phone
/// with a home indicator, 115 with the slot (48 tall, 10 above the bar), whose top is then 107 above that line.
@Suite("items 387 and 389 — the document's end clears whatever stands over its foot")
struct HistoryFootTests {
  @Test("over the bar alone the end, the pill and the end's slack stand where they did")
  func theBarAlone() {
    #expect(HistoryFollow.clearance(bar: 57) == 81)
    #expect(HistoryFollow.pillFoot(bar: 57) == 92)
    #expect(HistoryFollow.endSlack(bar: 57) == 120)
  }

  @Test("with the slot above the bar the last row rests 32 above the slot's top, and the pill's foot 43")
  func theSlot() {
    #expect(HistoryFollow.clearance(bar: 115) == 139)
    #expect(HistoryFollow.pillFoot(bar: 115) == 150)
    #expect(HistoryFollow.endSlack(bar: 115) == 178)
    #expect(HistoryFollow.clearance(bar: 115) - 107 == 32)
    #expect(HistoryFollow.pillFoot(bar: 115) - 107 == 43)
  }

  @Test("with nothing over the foot the end keeps its air alone, and a measure below nothing counts as nothing")
  func nothingOverTheFoot() {
    #expect(HistoryFollow.footAir == 24)
    #expect(HistoryFollow.clearance(bar: 0) == 24)
    #expect(HistoryFollow.clearance(bar: -8) == 24)
    #expect(HistoryFollow.pillFoot(bar: 0) == 35)
  }
}

/// Item 381 (asked for 2026-11-13: a long session shows at once, where it was blank until scrolled) —
/// a page found at rest with the screen's foot below the document's own is put back on its end; a page a finger
/// holds there is left alone. That the blank open is a page past its end is a reading of the code, not yet shown
/// on a device.
///
/// A screen of 800 over a document of 2,000, under a bar of 100 and over an inset of 34: at its end the page rests
/// at 2,000 + 34 - 800 = 1,234.
@Suite("item 381 — a page at rest past its end is put back")
struct HistoryPastEndTests {
  private func past(_ offset: CGFloat, content: CGFloat = 2_000) -> Bool {
    HistoryFollow.pastEnd(offset: offset, container: 800, content: content, topInset: 100, bottomInset: 34)
  }

  @Test("the screen's foot below the document's own, beyond the bar's inset, is past its end")
  func pastItsEnd() {
    #expect(past(1_236))
    #expect(past(3_000))
  }

  @Test("at its end, with the bar's inset under it, a page is not past its end; nor up the page; nor a point over")
  func atItsEnd() {
    #expect(!past(1_234))
    #expect(!past(600))
    #expect(!past(1_235))
  }

  @Test("a document shorter than the screen, at its top, is not past its end")
  func aShortDocument() {
    #expect(!past(-100, content: 300))
  }

  @Test("it is put back at rest, and never while a finger or a move holds it")
  func onlyAtRest() {
    #expect(HistoryFollow.putsBack(past: true, resting: true))
    #expect(!HistoryFollow.putsBack(past: true, resting: false))
    #expect(!HistoryFollow.putsBack(past: false, resting: true))
  }

  @Test("the slack is a point")
  func theSlack() {
    #expect(HistoryFollow.pastSlack == 1)
  }
}
