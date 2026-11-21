import CoreGraphics
import FieldProduct
import Foundation

// MA-6e — what opening an app lands on before MA-5 (Q1, decided 2026-11-09): the honest screen from the row's facts,
// with Open in ‹host› when it has a hosted link, and About. Since MA-5b-1 the phone asks `artifact.open` in a build
// that compiles the web host (`AppsOpenScreen`); this screen stands for every app that does not open there, and for
// every build that does not.

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

  /// An app that could open, on a phone that cannot run it yet (§9 "About").
  /// Ruled 2026-11-12: kept. Item 273.
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
  /// Item 588 (2026-11-19), §9 "About": while it has no preview, why. Owed: "No preview yet — it's drawn the next
  /// time VibeField is open on ‹desktop›". Failed: "No preview — it couldn't be drawn. It's drawn again the next
  /// time the app opens on ‹desktop›". Otherwise: "No preview yet — it's drawn the first time the app opens". Nil
  /// once it has one.
  let noPreview: String?

  static func of(
    _ app: IndexAppRow, agent: String?, sources: [IndexAppsSource], projects: [String: String], here: String
  ) -> AppsAbout {
    let source = MadeAppFacts.source(of: app, in: sources)
    let inSentence = MadeAppFacts.desktopInSentence(source, here: here)
    return AppsAbout(
      title: app.title,
      madeBy: agent.map { "Made by \($0)" },
      project: app.projectKey.flatMap { projects[$0] },
      // item 588 (2026-11-19): an existing line's capital, found while adding the two new ones: a stand-in word,
      // mid-sentence, is lower-case
      desktop: "on \(inSentence)",
      at: MadeAppFacts.at(app),
      noPreview: app.preview == nil ? noPreviewLine(app.previewState, desktop: inSentence) : nil)
  }

  /// Item 588 (2026-11-19): the line for an app with no preview, by its state, with `desktop` as a sentence names it.
  /// A word not heard says what no state says, so it never promises a drawing.
  static func noPreviewLine(_ state: MadeAppPreviewState?, desktop: String) -> String {
    switch state {
    case .owed: "No preview yet — it's drawn the next time VibeField is open on \(desktop)"
    case .failed: "No preview — it couldn't be drawn. It's drawn again the next time the app opens on \(desktop)"
    case .unknown, nil: "No preview yet — it's drawn the first time the app opens"
    }
  }
}

extension AppsShelfChrome {
  /// How far down the receded tab stands, so that `cardShowing` of it shows at the foot.
  static func cardOffset(screen: CGFloat) -> CGFloat { screen - cardShowing }
}
