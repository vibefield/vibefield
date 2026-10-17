import GhostteaTerminal
import Testing

@testable import FieldTerminal

/// The seat is told only a settled grid (2026-10-17): a card being dismissed is
/// never a terminal size (the swipe down that left the desktop at 45×5).
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

  /// James's phone, 03:57Z: the swipe down measured 45×16 … 45×1, and the park
  /// released the seat at 45×5.
  @Test func aLeavingCardsGridsAreNeverTold() {
    var settled = SettledGrid()
    _ = settled.measured(grid(17), leaving: false)
    for rows: UInt16 in [16, 12, 5, 1] {
      #expect(settled.measured(grid(rows), leaving: true) == .held(grid(rows), because: "the card is leaving"))
    }
    // A dismissal called off: the card at rest again is the terminal's size.
    #expect(settled.measured(grid(31), leaving: false) == .send(grid(31)))
    #expect(settled.measured(grid(17), leaving: true) == .held(grid(17), because: "the card is leaving"))
  }
}
