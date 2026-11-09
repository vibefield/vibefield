import CoreGraphics
import FieldProduct
import Foundation

// MA-6e — what opening an app lands on before MA-5 (VF-PM's Q1, 2026-11-09): the honest screen from the row's facts,
// with Open in ‹host› when it has a hosted link, and About. The phone asks `artifact.open` nothing.

/// The screen an app zooms to while the phone cannot run it: its state's words and its one act (MA-L10).
struct AppsHonest: Equatable {
  struct Act: Equatable {
    let host: String
    let url: String

    var word: String { "Open in \(host)" }
  }

  let title: String
  let detail: String?
  let act: Act?

  /// An app that could open, on a phone that cannot run it yet. Interim, ‹for James› (§9 "About").
  static let cannotRunYet = "This app can't run here yet"

  static func of(_ app: IndexAppRow, sources: [IndexAppsSource], here: String) -> AppsHonest {
    let source = MadeAppFacts.source(of: app, in: sources)
    let desktop = MadeAppFacts.desktop(source, here: here)
    let why = MadeAppFacts.state(app, source: source, desktop: desktop).why
    var act: Act?
    if let host = MadeAppFacts.host(app.hostedUrl), let url = app.hostedUrl { act = Act(host: host, url: url) }
    return AppsHonest(title: why?.title ?? cannotRunYet, detail: why?.detail, act: act)
  }
}

/// About this app (§9).
struct AppsAbout: Equatable {
  let title: String
  /// "Made by ‹agent›"; nil when the catalog has no label for it.
  let madeBy: String?
  let project: String?
  /// "on ‹desktop›".
  let desktop: String
  let at: Int64
  /// "No preview yet — it's drawn the first time the app opens"; nil once it has one.
  let noPreview: String?

  static func of(
    _ app: IndexAppRow, agent: String?, sources: [IndexAppsSource], projects: [String: String], here: String
  ) -> AppsAbout {
    let desktop = MadeAppFacts.desktop(MadeAppFacts.source(of: app, in: sources), here: here)
    return AppsAbout(
      title: app.title,
      madeBy: agent.map { "Made by \($0)" },
      project: app.projectKey.flatMap { projects[$0] },
      desktop: "on \(desktop)",
      at: MadeAppFacts.at(app),
      noPreview: app.preview == nil ? "No preview yet — it's drawn the first time the app opens" : nil)
  }
}

extension AppsShelfChrome {
  /// How far down the receded tab stands, so that `cardShowing` of it shows at the foot.
  static func cardOffset(screen: CGFloat) -> CGFloat { screen - cardShowing }
}
