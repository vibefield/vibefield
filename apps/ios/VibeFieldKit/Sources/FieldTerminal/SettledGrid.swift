import GhostteaTerminal

/// The grid a terminal pane tells its seat: only a SETTLED one (2026-10-17).
///
/// The pane's grid moves with every layout pass, and two kinds of pass are not
/// the terminal's size, though the phone sent both to the desktop's PTY while it
/// held the seat:
/// - The keyboard's own motion. One toggle measured 31 → 28 → 13 rows on James's
///   phone and codex redrew at each; his ruling (item 24): "settled size only".
///   Grids measured between UIKit's keyboard will- and did-notification are
///   held, and the newest goes out once the keyboard has stopped.
/// - A card being dismissed. A swipe down with the keyboard up squeezes the pane
///   row by row (45×17 → 45×1); the park that followed released the seat at
///   45×5, and the desktop and the reopened card's codex were left at five rows.
///   A leaving card's grids are dropped: the seat keeps the grid the card last
///   rested at.
struct SettledGrid {
  enum Report: Equatable {
    /// Tell the seat this grid.
    case send(GhostteaTerminalGridSize)
    /// Held for the reason given, and not told.
    case held(GhostteaTerminalGridSize, because: String)
    /// Nothing the seat has not been told.
    case unchanged
  }

  private var keyboardMoving = false
  private var held: GhostteaTerminalGridSize?
  private var sent: GhostteaTerminalGridSize?

  /// A grid the pane measured; `leaving` while its card is being dismissed.
  mutating func measured(_ grid: GhostteaTerminalGridSize, leaving: Bool) -> Report {
    if leaving {
      held = nil
      return .held(grid, because: "the card is leaving")
    }
    if keyboardMoving {
      held = grid
      return .held(grid, because: "the keyboard is moving")
    }
    return send(grid)
  }

  /// UIKit's keyboard will-notification: what is measured from here is the
  /// keyboard's motion, until its did-notification.
  mutating func keyboardWillMove() {
    keyboardMoving = true
  }

  /// UIKit's keyboard did-notification: the newest grid held meanwhile, when
  /// it is news to the seat.
  mutating func keyboardDidMove() -> Report {
    keyboardMoving = false
    guard let grid = held else { return .unchanged }
    held = nil
    return send(grid)
  }

  private mutating func send(_ grid: GhostteaTerminalGridSize) -> Report {
    guard grid != sent else { return .unchanged }
    sent = grid
    return .send(grid)
  }
}
