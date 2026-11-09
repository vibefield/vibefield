import FieldProduct

// ES-5c (track ES; DESIGN.md §8 "The phone's Chat", Empty: the night; §7 Off; §9) — the night's model, the port of
// field-app's `night-agents.ts`. RED: the types and the words stand, and every answer is a stub.

/// Chat's words on the night (§9), the Mac's.
enum ChatNightWords {
  static let headline = "Make your first spark"
  static let sentence = "A spark is an agent VibeField starts to run your other agents."
  static let jobs = "Or give it a first job"
}

enum ChatNight {
  /// What the night knows of the home's agents.
  enum Agents: Equatable {
    case reading
    /// `here`: the agents installed at the home that can be a spark; `elsewhere`: the ones that can and are not there.
    case read(here: Int, elsewhere: [String], providers: [AgentProviderSummary])
    case unread
  }

  static func agents(_ providers: [AgentProviderSummary], catalog: AgentCatalogResult?) -> Agents { .reading }

  static func offNames(_ agents: Agents) -> [String]? { nil }

  static func offWords(_ names: [String], home: String) -> String { "" }

  static func starters(
    agents: Agents, runs: ChatStarters.Read<ChatStarters.Run>, catalog: AgentCatalogResult?
  ) -> ChatStarters.Reading {
    .reading(ChatFlows.starters)
  }
}
