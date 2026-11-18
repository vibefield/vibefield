import FieldProduct
import FieldWeb
import Foundation

// MA-5b-1 — what the open app's screen draws for each phase of `AppOpenModel` (DESIGN.md §8 "The open app", "Honest
// states"): the icon alone while the answer is not late, "Opening on ‹desktop›…" once it is, the page while it serves,
// and the honest screen for every refusal. Pure, so every face is a unit row; `AppsOpenScreen` draws it.

enum AppsOpenFace: Equatable {
  /// Asked, and nothing for `AppOpen.lateAfter` (MA-L10's late rule): the icon alone, at 92 on paper.
  case icon
  /// The answer is late: the icon over these words.
  case opening(String)
  /// The page to load, and the rule it lives by.
  case page(url: URL, policy: WebNavigationPolicy)
  /// The honest screen, in its state's words.
  case honest(AppsHonest)

  /// The face for `phase`, on the screen of the app keyed `appKey`. A build that opens no app (`opens` false: a Release
  /// build without SP-4d's relay, or a field under `-vf-mock`) keeps `row`, the honest screen as it stood before 5b. A
  /// phase that belongs to another app is not drawn: the icon stands until this app's own answer.
  static func of(_ phase: AppOpenModel.Phase, appKey: String, row: AppsHonest, opens: Bool) -> AppsOpenFace {
    .honest(row)  // RED: a stub, every face the row's own; the green draws the phase.
  }

  /// The honest screen this face shows, if it is one.
  var honest: AppsHonest? {
    if case .honest(let honest) = self { return honest }
    return nil
  }

  /// Whether the page stands.
  var isPage: Bool {
    if case .page = self { return true }
    return false
  }
}

/// Why an open page fell back to the honest screen.
enum AppsPageFall: Equatable {
  /// The mesh gave no way out to read back (R1): no web view was made.
  case noProxy
  /// The app's rule list did not compile: nothing loaded.
  case ruleList
  /// The page failed to load after its one proxy re-read.
  case unreachable
  /// The page's content process ended twice.
  case ended

  /// Its words: the desktop out of reach, or, for a rule list the phone could not make, the app that cannot run here.
  func why(desktop: String) -> MadeAppFacts.Why {
    AppOpen.cannotRun  // RED: a stub; the green says the desktop is out of reach.
  }
}

/// A page's failed loads: the first reads the way out again and loads once more, since iOS may have made the node's
/// loopback listener stale in the background (probe5, L8); the second falls to the honest screen.
struct AppsPageRetry: Equatable {
  private(set) var reread = false

  /// A load failed: true to read the proxy again and load once more, false to fall.
  mutating func failed() -> Bool {
    false  // RED: a stub, never a re-read; the green re-reads once.
  }
}
