import FieldProduct
import Foundation

// MA-3h (Keep), K4 — the phone keeps an app through its home: `artifact.mark {foldKey, kept}`, which the home answers
// and its settings document carries to every desktop (James's short path, 2026-11-13). The long press offers it
// (DESIGN.md §8 "The phone's Apps"); Versions waits for its view, which is undrawn. The shelf learns of a keep from the
// door's next page, read on the home's ping, as it learns everything else: nothing here writes a row.

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

  /// §8's order: Open, Keep (or Stop keeping), About this app. Versions joins when its view is drawn.
  static func of(_ app: IndexAppRow) -> [AppsTileAct] {
    [.open, app.kept ? .stopKeeping : .keep, .about]
  }
}

/// What a keep the home did not take says (MA-L10: words, never a code): DESIGN.md §9 "Keep's words", James's
/// pick. Its fourth and fifth lines are the phone's. Its first and third are the desk's, said
/// here too for the same two refusals: James's word, 2026-11-15 10:11:20Z, "go with lean".
enum AppsKeepWords {
  static func failed(_ error: (any Error)?, kept: Bool, title: String) -> String {
    let refusal = error as? FieldProductError
    // a home from before 3h, which has no intent to write (MA-3e's `intent-unbuilt`): the card's first line
    if refusal?.kind == "UNAVAILABLE", refusal?.details?["service"]?.stringValue == MadeAppRefusal.service {
      return "Keeping apps isn't ready yet."
    }
    // a stop that failed: the card's fifth line
    guard kept else { return "Couldn't stop keeping \(title)." }
    // past MADE_APP_LIMITS.INTENTS, which no retry changes until one is stopped: the card's third line
    if refusal?.kind == "RESOURCE_EXHAUSTED" {
      return "You're keeping as many apps as VibeField holds. Stop keeping one to keep \(title)."
    }
    // the card's fourth line
    return "Couldn't keep \(title)."
  }
}
