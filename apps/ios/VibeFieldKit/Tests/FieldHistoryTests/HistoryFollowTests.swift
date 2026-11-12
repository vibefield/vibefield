import CoreGraphics
import Testing

@testable import FieldHistory

/// Item 362a (James, 2026-11-12 18:40:35Z, of the phone's History session view: "it somehow scroll start from top,
/// does not like chat message flow in chat app") — a session's document opens at its end and keeps its end in view,
/// as the desktop's transcript does, and a document a search landed in still opens on the landed row.
///
/// These rows hold the RULE. Where the page stands on a phone is his to see.
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
