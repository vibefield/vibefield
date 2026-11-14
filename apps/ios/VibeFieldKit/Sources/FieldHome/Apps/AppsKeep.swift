import FieldProduct
import Foundation

// MA-3h (Keep), K4 — the phone keeps an app through its home: `artifact.mark {foldKey, kept}`, which the home answers
// and its settings document carries to every desktop (James's short path, 2026-11-13). The long press offers it
// (DESIGN.md §8 "The phone's Apps"); Versions waits for its view, which is undrawn. The shelf learns of a keep from the
// door's next page, read on the home's ping, as it learns everything else: nothing here writes a row.
//
// K4 red: the long press is today's, Open and About alone.

/// One act of the long press on an app's icon.
enum AppsTileAct: Hashable {
  case open, keep, stopKeeping, about

  var word: String {
    switch self {
    case .open: "Open"
    case .keep: "Keep"
    case .stopKeeping: "Stop keeping"
    case .about: "About this app"
    }
  }

  static func of(_ app: IndexAppRow) -> [AppsTileAct] {
    [.open, .about]
  }
}
