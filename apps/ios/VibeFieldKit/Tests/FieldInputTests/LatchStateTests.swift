import FieldTerminal
import Testing

@testable import FieldInput

/// Sticky Ctrl is three phases with one rule each, and the rules are easy to
/// state and easy to get wrong: a locked latch that expires, or a consumed one
/// that stays armed, both look like "Ctrl is broken" from the outside and
/// neither is visible in a screenshot. So the latch is a pure value and every
/// transition is pinned by calling it.
@Suite("the control latch")
struct LatchStateTests {

  @Test("a tap walks off → armed → locked → off")
  func tapCycle() {
    var latch = LatchState()
    #expect(latch.phase == .off)
    latch.tap()
    #expect(latch.phase == .armed)
    latch.tap()
    #expect(latch.phase == .locked)
    latch.tap()
    #expect(latch.phase == .off)
  }

  @Test("an idle latch carries nothing")
  func offCarriesNothing() {
    var latch = LatchState()
    #expect(latch.modifiers == [])
    #expect(latch.consume() == [])
    #expect(latch.phase == .off)
  }

  @Test("armed spends itself on one key")
  func armedIsSingleShot() {
    var latch = LatchState()
    latch.tap()
    #expect(latch.consume() == .control)
    #expect(latch.phase == .off)
    #expect(latch.consume() == [])
  }

  /// The whole point of locking: `Ctrl-X Ctrl-S` is two keys under one latch.
  @Test("locked survives every key it modifies")
  func lockedSurvivesConsume() {
    var latch = LatchState()
    latch.tap()
    latch.tap()
    #expect(latch.phase == .locked)
    #expect(latch.consume() == .control)
    #expect(latch.phase == .locked)
    #expect(latch.consume() == .control)
    #expect(latch.phase == .locked)
  }

  /// Only the arm window has a clock. A lock was deliberate, and a timeout
  /// that released it would drop the second half of a chord the user is
  /// halfway through typing.
  @Test("expiry clears armed and never touches locked")
  func expiryOnlyDisarms() {
    var armed = LatchState()
    armed.tap()
    armed.expire()
    #expect(armed.phase == .off)

    var locked = LatchState()
    locked.tap()
    locked.tap()
    locked.expire()
    #expect(locked.phase == .locked)

    var off = LatchState()
    off.expire()
    #expect(off.phase == .off)
  }

  /// The label is what VoiceOver reads; the fill alone says nothing to a
  /// screen reader, and armed and locked are different promises.
  @Test("each phase names itself for VoiceOver")
  func accessibilityLabels() {
    var latch = LatchState()
    #expect(latch.accessibilityLabel == "Control")
    latch.tap()
    #expect(latch.accessibilityLabel == "Control armed")
    latch.tap()
    #expect(latch.accessibilityLabel == "Control locked")
  }
}
