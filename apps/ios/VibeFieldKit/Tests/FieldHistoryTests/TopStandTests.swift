import Testing

@testable import FieldHistory

/// Item 348 (DESIGN.md §8 "The phone's Apps": "One pull on every tab", on History and Chat; asked for 2026-11-12:
/// a list still scrolling never starts the pull down; only one scrolled all the way to its top
/// does) — a root list gives the pull only to a finger that came down while it rested at its
/// top. The list's own motion on a phone is to be seen on a device (the answer is in the item's commit).
///
/// No `mutating` call inside an #expect argument: each is its own statement.
@Suite("item 348 — a root list gives the pull only to a finger that came down while it rested at its top")
struct TopStandTests {
  @Test("a list at rest at its top gives the pull, and its own rubber band under that finger does not take it back")
  func atRestAtTheTop() {
    var stand = TopStand()
    #expect(stand.gives)
    stand.touched(inFlight: false)
    stand.place(atTop: true, resting: false)
    #expect(stand.gives)
  }

  @Test("a list scrolled down keeps its touch, even once that touch has dragged it back to its top")
  func scrolledDown() {
    var stand = TopStand()
    stand.place(atTop: false, resting: true)
    #expect(stand.gives == false)
    stand.touched(inFlight: false)
    stand.place(atTop: true, resting: false)
    #expect(stand.gives == false, "the finger came down on a list scrolled down")
    stand.flies()
    stand.rests()
    #expect(stand.gives, "at rest at its top, the next finger may pull")
  }

  @Test("a list let go and still running gives nothing, and caught in flight it keeps the touch, even at its top")
  func inFlight() {
    var stand = TopStand()
    stand.touched(inFlight: false)
    stand.place(atTop: false, resting: false)
    stand.flies()
    #expect(stand.gives == false)
    stand.place(atTop: true, resting: false)
    #expect(stand.gives == false, "its flight has reached the top, and it is still moving")
    stand.touched(inFlight: true)
    stand.place(atTop: true, resting: false)
    #expect(stand.gives == false, "caught in flight, the touch is the list's")
    stand.flies()
    stand.rests()
    #expect(stand.gives)
  }

  @Test("a list that comes to rest scrolled down gives nothing")
  func restsScrolledDown() {
    var stand = TopStand()
    stand.touched(inFlight: false)
    stand.place(atTop: false, resting: false)
    stand.flies()
    stand.rests()
    #expect(stand.gives == false)
  }
}
