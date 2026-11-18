import FieldProduct
import FieldWeb
import Foundation

// MA-5a — opening an app on the phone, its pure decisions (MA §5.5, §5.7, §5.8; DESIGN.md §8 "The phone's Apps"):
// what the phone asks `artifact.open`, what an answer means, and the words for each way it cannot open. Pure, so
// every row is a unit row; `AppOpenModel` runs it over the home's door. The words are DESIGN.md §8's and MadeAppFacts'
// own; the two refusals §8 has no words for say "This app can't run here yet" (ruled kept, item 273) until §8 does.

enum AppOpen {
  /// §8: "Opening on ‹desktop›…", late: nothing for 120 ms, then a fade.
  static let lateAfter: Duration = .milliseconds(120)
  /// `starting`: the serve is on its way up and the caller asks again (MA-1a's fixture). A second apart, fifteen asks
  /// at most; then the phone stops and says it cannot reach the desktop. ‹to pick: the bound, and its words›.
  static let askAgainAfter: Duration = .seconds(1)
  static let maxAsks = 15

  static func openingWords(desktop: String) -> String { "Opening on \(desktop)…" }

  /// What the phone asks: the app on the desktop that serves it, `device` only when that desktop is not the home
  /// (the home forwards the call whole).
  static func params(_ app: IndexAppRow, sources: [IndexAppsSource]) -> ArtifactOpenParams {
    let isSelf = MadeAppFacts.source(of: app, in: sources)?.isSelf ?? false
    return ArtifactOpenParams(appId: app.appId, device: isSelf ? nil : app.device)
  }

  /// What one answer means.
  enum Answer: Equatable {
    /// The URL to load, and the rule its page lives by.
    case serving(url: URL, policy: WebNavigationPolicy)
    /// On its way up: ask again.
    case starting
    /// Serving, with no root the phone can pin (absent, or not a root claim): nothing to load.
    case noRoot
  }

  static func answer(_ result: ArtifactOpenResult) -> Answer {
    switch result.state {
    case .starting:
      return .starting
    case .serving:
      guard let raw = result.url, let origin = WebOrigin(claim: raw), let url = URL(string: raw) else { return .noRoot }
      return .serving(url: url, policy: WebNavigationPolicy(origin: origin, reach: result.reach ?? []))
    }
  }

  /// The words for a refused or failed `artifact.open`: an apps refusal by its state, anything else as the desktop
  /// out of reach (§8: "Can't reach ‹desktop›" with its reason; ‹to pick: the reason›).
  static func refused(_ error: any Error, desktop: String) -> MadeAppFacts.Why {
    guard let door = error as? FieldProductError, let refusal = MadeAppRefusal(details: door.details) else {
      return cantReach(desktop)
    }
    switch refusal.state {
    case .notKept: return MadeAppFacts.Why(title: "This page wasn't kept", detail: nil)
    case .tooLarge: return MadeAppFacts.Why(title: "Too large to keep", detail: nil)
    case .unsupported: return MadeAppFacts.Why(title: "This page can't be kept", detail: nil)
    case .exportUnbuilt: return MadeAppFacts.Why(title: "\(desktop) can't write this app out yet", detail: nil)
    case .reading: return MadeAppFacts.Why(title: "\(desktop) is still reading its history", detail: nil)
    case .exportFailed, .notLinked: return cannotRun
    }
  }

  /// MadeAppFacts' own words for a desktop that is not answering.
  static func cantReach(_ desktop: String) -> MadeAppFacts.Why {
    MadeAppFacts.Why(title: "Can't reach \(desktop)", detail: "It isn't answering.")
  }

  /// Still starting after `maxAsks`: §8's "Can't reach ‹desktop›" with its reason. ‹to pick: the reason›.
  static func didNotStart(_ desktop: String) -> MadeAppFacts.Why {
    MadeAppFacts.Why(title: "Can't reach \(desktop)", detail: "It didn't start this app.")
  }

  static let cannotRun = MadeAppFacts.Why(title: AppsHonest.cannotRunYet, detail: nil)

  /// The honest screen for a reason, with "Open in ‹host›" when the app has a hosted link (as `AppsHonest.of`).
  static func honest(_ why: MadeAppFacts.Why, app: IndexAppRow) -> AppsHonest {
    var act: AppsHonest.Act?
    if let host = MadeAppFacts.host(app.hostedUrl), let url = app.hostedUrl {
      act = AppsHonest.Act(host: host, url: url)
    }
    return AppsHonest(title: why.title, detail: why.detail, act: act)
  }
}
