import GhostteaTerminal
import Testing

@testable import FieldTerminal

/// The seat is told only a settled grid (2026-10-17): a grid at rest when its
/// run loop turn ends; the keyboard's motion held until it stops (James's
/// ruling, "settled size only"); and a card being dismissed never (the swipe
/// down that left the desktop at 45×5).
@Suite struct SettledGridTests {
  private func grid(_ rows: UInt16) -> GhostteaTerminalGridSize {
    GhostteaTerminalGridSize(columns: 45, rows: rows)
  }

  @Test func aGridAtRestIsToldOnceWhenItsTurnEnds() {
    var settled = SettledGrid()
    #expect(settled.measured(grid(31), leaving: false) == .unchanged)
    #expect(settled.turnEnded() == .send(grid(31)))
    #expect(settled.turnEnded() == .unchanged)
    _ = settled.measured(grid(31), leaving: false)
    #expect(settled.turnEnded() == .unchanged, "the seat already has it")
    // Two passes in one turn: only where the turn ended is told.
    _ = settled.measured(grid(28), leaving: false)
    _ = settled.measured(grid(25), leaving: false)
    #expect(settled.turnEnded() == .send(grid(25)))
  }

  /// James's phone, 03:56Z: one toggle measured 31 → 28 → 13, each a resize.
  @Test func theKeyboardsMotionIsHeldAndOnlyWhereItStoppedIsTold() {
    var settled = SettledGrid()
    _ = settled.measured(grid(31), leaving: false)
    _ = settled.turnEnded()
    #expect(settled.keyboardWillMove() == .unchanged)
    #expect(settled.measured(grid(28), leaving: false) == .held(grid(28), because: "the keyboard is moving"))
    #expect(settled.measured(grid(13), leaving: false) == .held(grid(13), because: "the keyboard is moving"))
    #expect(settled.turnEnded() == .unchanged)
    #expect(settled.keyboardDidMove() == .send(grid(13)))
    // and back down, landing where the seat already is: nothing to tell
    _ = settled.keyboardWillMove()
    _ = settled.measured(grid(17), leaving: false)
    _ = settled.measured(grid(13), leaving: false)
    #expect(settled.keyboardDidMove() == .unchanged)
  }

  /// James's phone, 05:22Z: the layout the keyboard's frame triggered measured
  /// 45×10 BEFORE this value heard the will-notification. In the same turn, the
  /// notification still makes it the keyboard's motion.
  @Test func aGridMeasuredBeforeTheWillInItsTurnIsTheKeyboards() {
    var settled = SettledGrid()
    _ = settled.measured(grid(25), leaving: false)
    _ = settled.turnEnded()
    #expect(settled.measured(grid(10), leaving: false) == .unchanged)
    #expect(settled.keyboardWillMove() == .held(grid(10), because: "the keyboard is moving"))
    #expect(settled.turnEnded() == .unchanged, "never told mid-motion")
    #expect(settled.keyboardDidMove() == .send(grid(10)))
  }

  @Test func aStopWithNothingHeldTellsNothing() {
    var settled = SettledGrid()
    _ = settled.measured(grid(31), leaving: false)
    _ = settled.turnEnded()
    _ = settled.keyboardWillMove()
    #expect(settled.keyboardDidMove() == .unchanged)
    _ = settled.measured(grid(31), leaving: false)
    #expect(settled.turnEnded() == .unchanged)
  }

  /// James's phone, 03:57Z: the swipe down measured 45×16 … 45×1, and the park
  /// released the seat at 45×5.
  @Test func aLeavingCardsGridsAreNeverTold() {
    var settled = SettledGrid()
    _ = settled.measured(grid(17), leaving: false)
    _ = settled.turnEnded()
    for rows: UInt16 in [16, 12, 5, 1] {
      #expect(settled.measured(grid(rows), leaving: true) == .held(grid(rows), because: "the card is leaving"))
    }
    #expect(settled.turnEnded() == .unchanged)
    // A grid waiting for its turn, or held for the keyboard, goes with the card.
    _ = settled.measured(grid(15), leaving: false)
    _ = settled.measured(grid(8), leaving: true)
    #expect(settled.turnEnded() == .unchanged)
    _ = settled.keyboardWillMove()
    _ = settled.measured(grid(13), leaving: false)
    _ = settled.measured(grid(8), leaving: true)
    #expect(settled.keyboardDidMove() == .unchanged)
    // A dismissal called off: the card at rest again is the terminal's size.
    _ = settled.measured(grid(31), leaving: false)
    #expect(settled.turnEnded() == .send(grid(31)))
  }
}
