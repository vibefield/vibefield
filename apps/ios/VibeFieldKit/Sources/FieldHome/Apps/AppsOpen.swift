import CoreGraphics
import FieldProduct
import Foundation

// MA-6e — what opening an app lands on before MA-5 (VF-PM's Q1, 2026-11-09): the honest screen from the row's facts,
// with Open in ‹host› when it has a hosted link, and About. The phone asks `artifact.open` nothing. RED: every answer
// below is a stub.

/// The screen an app zooms to while the phone cannot run it: its state's words and its one act (MA-L10).
struct AppsHonest: Equatable {
  struct Act: Equatable {
    let host: String
    let url: String

    var word: String { "" }
  }

  let title: String
  let detail: String?
  let act: Act?

  /// An app that could open, on a phone that cannot run it yet. Interim, ‹for James› (§9 "About").
  static let cannotRunYet = ""

  static func of(_ app: IndexAppRow, sources: [IndexAppsSource], here: String) -> AppsHonest {
    AppsHonest(title: "", detail: nil, act: nil)
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
    AppsAbout(title: "", madeBy: nil, project: nil, desktop: "", at: 0, noPreview: nil)
  }
}

extension AppsShelfChrome {
  /// How far down the receded tab stands, so that `cardShowing` of it shows at the foot.
  static func cardOffset(screen: CGFloat) -> CGFloat { 0 }
}
