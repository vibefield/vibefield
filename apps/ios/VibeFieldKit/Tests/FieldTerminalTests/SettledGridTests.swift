import GhostteaTerminal
import Testing

@testable import FieldTerminal

/// The seat is told only a settled grid (2026-10-17): the keyboard's motion is
/// held until it stops (James's ruling, "settled size only"), and a card being
/// dismissed is never a terminal size (the swipe down that left the desktop at
/// 45×5).
@Suite struct SettledGridTests {
  private func grid(_ rows: UInt16) -> GhostteaTerminalGridSize {
    GhostteaTerminalGridSize(columns: 45, rows: rows)
  }

  @Test func aGridAtRestIsToldOnce() {
    var settled = SettledGrid()
    #expect(settled.measured(grid(31), leaving: false) == .send(grid(31)))
    #expect(settled.measured(grid(31), leaving: false) == .unchanged)
    #expect(settled.measured(grid(28), leaving: false) == .send(grid(28)))
  }

  /// James's phone, 03:56Z: one toggle measured 31 → 28 → 13, each a resize.
  @Test func theKeyboardsMotionIsHeldAndOnlyWhereItStoppedIsTold() {
    var settled = SettledGrid()
    _ = settled.measured(grid(31), leaving: false)
    settled.keyboardWillMove()
    #expect(settled.measured(grid(28), leaving: false) == .held(grid(28), because: "the keyboard is moving"))
    #expect(settled.measured(grid(13), leaving: false) == .held(grid(13), because: "the keyboard is moving"))
    #expect(settled.keyboardDidMove() == .send(grid(13)))
    // and back down, landing where the seat already is: nothing to tell
    settled.keyboardWillMove()
    _ = settled.measured(grid(17), leaving: false)
    _ = settled.measured(grid(13), leaving: false)
    #expect(settled.keyboardDidMove() == .unchanged)
  }

  @Test func aStopWithNothingHeldTellsNothing() {
    var settled = SettledGrid()
    _ = settled.measured(grid(31), leaving: false)
    settled.keyboardWillMove()
    #expect(settled.keyboardDidMove() == .unchanged)
    #expect(settled.measured(grid(31), leaving: false) == .unchanged)
  }

  /// James's phone, 03:57Z: the swipe down measured 45×16 … 45×1, and the park
  /// released the seat at 45×5.
  @Test func aLeavingCardsGridsAreNeverTold() {
    var settled = SettledGrid()
    _ = settled.measured(grid(17), leaving: false)
    for rows: UInt16 in [16, 12, 5, 1] {
      #expect(settled.measured(grid(rows), leaving: true) == .held(grid(rows), because: "the card is leaving"))
    }
    // A keyboard grid held as the card began to leave goes with it.
    settled.keyboardWillMove()
    _ = settled.measured(grid(13), leaving: false)
    _ = settled.measured(grid(8), leaving: true)
    #expect(settled.keyboardDidMove() == .unchanged)
    // A dismissal called off: the card at rest again is the terminal's size.
    #expect(settled.measured(grid(31), leaving: false) == .send(grid(31)))
  }
}
