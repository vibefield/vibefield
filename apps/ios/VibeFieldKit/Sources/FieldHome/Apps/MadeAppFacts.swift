import FieldProduct
import Foundation

// MA-6a — what the phone says of one app, the Mac's reading (field-app's `made-apps.ts`), held to it by
// `Tests/FieldHomeTests/Fixtures/made-apps/made-app-facts.golden.json`. RED: every answer below is a stub.

enum MadeAppFacts {
  /// §2.5's tone of a state: serving green, failed red, the rest muted.
  enum Tone: String, Equatable {
    case muted, healthy, error
  }

  /// What the phone says when an app cannot open: its heading and its line.
  struct Why: Equatable {
    let title: String
    let detail: String?
  }

  /// An app's state from its row and its desktop's standing.
  struct State: Equatable {
    let tone: Tone
    let word: String?
    let opens: Bool
    let why: Why?
  }

  static func at(_ row: IndexAppRow) -> Int64 { 0 }

  static func initial(title: String, filename: String) -> String { "" }

  static func source(of row: IndexAppRow, in sources: [IndexAppsSource]) -> IndexAppsSource? { nil }

  static func away(_ source: IndexAppsSource?) -> Bool { false }

  static func imageURL(_ row: IndexAppRow, sources: [IndexAppsSource]) -> String? { nil }

  static func host(_ hostedUrl: String?) -> String? { nil }

  static func desktop(_ source: IndexAppsSource?, here: String) -> String { "" }

  static func agentLabel(_ row: IndexAppRow, catalog: [AgentCatalogRow]) -> String? { nil }

  static func state(_ row: IndexAppRow, source: IndexAppsSource?, desktop: String) -> State {
    State(tone: .muted, word: nil, opens: false, why: nil)
  }
}
