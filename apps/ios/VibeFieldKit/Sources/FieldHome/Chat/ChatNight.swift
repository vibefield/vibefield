import FieldProduct

// ES-5c (track ES; DESIGN.md §8 "The phone's Chat", Empty: the night; §7 Off; §9) — the night's model, the port of
// field-app's `night-agents.ts`, on the home's agents (E2). Pure. An agent installed at the home that the catalog lets
// be a spark keeps New spark live, one reading with the sheet's (`NewSpark.canBeSpark`). None there, and the night is
// Off: the pill off and the sentence naming the agents that can. While the agents are read, or where they could not be,
// New spark stays live and the sheet says why at its foot, never the night.

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

  /// A catalog with no rows, for the rule where none could be read: the agent slots keep the hello's whole sentences.
  private static let noCatalog = try? AgentCatalogResult(json: .object(["catalog": .array([])]))

  /// `agent.providers` read for the night. Where the home lists no agent that can be a spark, the catalog's own spark
  /// rows are named, so the sentence never stands empty.
  static func agents(_ providers: [AgentProviderSummary], catalog: AgentCatalogResult?) -> Agents {
    let sparks = providers.filter(NewSpark.canBeSpark)
    let here = sparks.filter(\.available).count
    let elsewhere = sparks.filter { !$0.available }.map(\.label)
    if here == 0 && elsewhere.isEmpty {
      let named = (catalog?.catalog ?? []).filter(\.canSpark).map(\.label)
      return .read(here: 0, elsewhere: named, providers: providers)
    }
    return .read(here: here, elsewhere: elsewhere, providers: providers)
  }

  /// Off (§7): the agents were read and none at the home can be a spark, the names of the ones that can; nil while the
  /// night is live.
  static func offNames(_ agents: Agents) -> [String]? {
    if case .read(let here, let elsewhere, _) = agents, here == 0 { return elsewhere }
    return nil
  }

  /// §9's Off sentence, by the home's name (interim, James's eye): "A spark thinks with Claude Code, which isn't on
  /// studio yet."; with two, "Claude Code or Codex, which aren't …"; with more, "Claude Code, Codex or Grok, which aren't …".
  static func offWords(_ names: [String], home: String) -> String {
    let which = names.count == 1 ? "which isn't" : "which aren't"
    return "A spark thinks with \(orWords(names)), \(which) on \(home) yet."
  }

  /// The starters as the home fills them.
  static func starters(
    agents: Agents, runs: ChatStarters.Read<ChatStarters.Run>, catalog: AgentCatalogResult?
  ) -> ChatStarters.Reading {
    guard let known = catalog ?? noCatalog else { return .read(ChatFlowWords.starters) }
    let read: ChatStarters.Read<ChatStarters.Agent>
    switch agents {
    case .reading: read = .out
    case .unread: read = .failed
    case .read(_, _, let providers): read = .rows(ChatStarters.agents(providers, catalog: known))
    }
    return ChatStarters.of(agents: read, runs: runs, catalog: known)
  }

  private static func orWords(_ words: [String]) -> String {
    guard words.count > 1, let last = words.last else { return words.first ?? "" }
    return "\(words.dropLast().joined(separator: ", ")) or \(last)"
  }
}
