import FieldProduct
import FieldWeb
import Foundation

// MA-5a (red) — opening an app on the phone, its pure decisions. A stub: no answer is understood.

enum AppOpen {
  static let lateAfter: Duration = .milliseconds(120)
  static let askAgainAfter: Duration = .seconds(1)
  static let maxAsks = 15

  static func openingWords(desktop: String) -> String { "" }

  static func params(_ app: IndexAppRow, sources: [IndexAppsSource]) -> ArtifactOpenParams {
    ArtifactOpenParams(appId: app.appId, device: app.device)
  }

  enum Answer: Equatable {
    case serving(url: URL, policy: WebNavigationPolicy)
    case starting
    case noRoot
  }

  static func answer(_ result: ArtifactOpenResult) -> Answer { .noRoot }

  static func refused(_ error: any Error, desktop: String) -> MadeAppFacts.Why { cantReach(desktop) }

  static func cantReach(_ desktop: String) -> MadeAppFacts.Why {
    MadeAppFacts.Why(title: "Can't reach \(desktop)", detail: nil)
  }

  static func didNotStart(_ desktop: String) -> MadeAppFacts.Why { cantReach(desktop) }

  static let cannotRun = MadeAppFacts.Why(title: AppsHonest.cannotRunYet, detail: nil)

  static func honest(_ why: MadeAppFacts.Why, app: IndexAppRow) -> AppsHonest {
    AppsHonest(title: why.title, detail: why.detail, act: nil)
  }
}
