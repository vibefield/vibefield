import GhostteaTerminal

/// The grid a terminal pane tells its seat: only a SETTLED one (2026-10-17).
///
/// The pane's grid moves with every layout pass, and a card being dismissed is
/// not the terminal's size, though the phone sent it to the desktop's PTY while
/// it held the seat. A swipe down with the keyboard up squeezes the pane row by
/// row (45×17 → 45×1); the park that followed released the seat at 45×5, and
/// the desktop and the reopened card's codex were left at five rows. A leaving
/// card's grids are dropped: the seat keeps the grid the card last rested at.
struct SettledGrid {
  enum Report: Equatable {
    /// Tell the seat this grid.
    case send(GhostteaTerminalGridSize)
    /// Held for the reason given, and not told.
    case held(GhostteaTerminalGridSize, because: String)
    /// Nothing the seat has not been told.
    case unchanged
  }

  private var sent: GhostteaTerminalGridSize?

  /// A grid the pane measured; `leaving` while its card is being dismissed.
  mutating func measured(_ grid: GhostteaTerminalGridSize, leaving: Bool) -> Report {
    if leaving { return .held(grid, because: "the card is leaving") }
    return send(grid)
  }

  private mutating func send(_ grid: GhostteaTerminalGridSize) -> Report {
    guard grid != sent else { return .unchanged }
    sent = grid
    return .send(grid)
  }
}
