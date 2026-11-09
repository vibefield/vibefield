import FieldProduct
import Testing

@testable import FieldHome

/// ES-5c (track ES; DESIGN.md §8 "The phone's Chat", Empty: the night; §7 Off; §9) — the night's model: whether New spark
/// is live, the names Off says, and what fills the starters. One reading with the sheet's (`NewSpark.canBeSpark`).
@Suite("ES-5c — the night's model")
struct ChatNightTests {
  static func provider(_ id: String, _ label: String, available: Bool, spark: Bool) throws -> AgentProviderSummary {
    try AgentProviderSummary(
      json: .object([
        "id": .string(id), "label": .string(label), "available": .bool(available),
        "offers": .object(["spark": .bool(spark)]),
      ]))
  }

  static func row(_ id: String, _ label: String, starter: String?, spark: Bool) -> JSONValue {
    var fields: [String: JSONValue] = [
      "id": .string(id), "label": .string(label), "status": .string("supported"),
      "offers": .object(["spawn": .bool(true), "spark": .bool(spark)]),
      "seams": .object(["puppeteer": .object(["provider": .string(id)])]),
    ]
    if let starter { fields["starter"] = .string(starter) }
    return .object(fields)
  }

  static func catalog() throws -> AgentCatalogResult {
    try AgentCatalogResult(
      json: .object([
        "catalog": .array([
          row("run-agent", "Runner", starter: "handle", spark: true),
          row("review-agent", "Reviewer", starter: "reviewer", spark: true),
          row("crew-agent", "Crew", starter: "crew", spark: false),
        ])
      ]))
  }

  @Test("an agent installed at the home that can be a spark keeps New spark live")
  func oneHereIsLive() throws {
    let catalog = try Self.catalog()
    let providers = [try Self.provider("run-agent", "Runner", available: true, spark: true)]
    #expect(ChatNight.offNames(ChatNight.agents(providers, catalog: catalog)) == nil)
  }

  @Test("none here: Off names the ones that can")
  func offNamesThoseElsewhere() throws {
    let catalog = try Self.catalog()
    let providers = [try Self.provider("run-agent", "Runner", available: false, spark: true)]
    #expect(ChatNight.offNames(ChatNight.agents(providers, catalog: catalog)) == ["Runner"])
  }

  @Test("the home lists none that can: the catalog's own spark rows are named, so the sentence never stands empty")
  func offFallsBackToTheCatalog() throws {
    let catalog = try Self.catalog()
    #expect(ChatNight.offNames(ChatNight.agents([], catalog: catalog)) == ["Runner", "Reviewer"])
  }

  @Test("while the agents are read, or where they cannot be, New spark stays live")
  func readingAndUnreadAreLive() {
    #expect(ChatNight.offNames(.reading) == nil)
    #expect(ChatNight.offNames(.unread) == nil)
  }

  @Test("Off's sentence names the home: one agent")
  func offWordsOne() {
    #expect(
      ChatNight.offWords(["Claude Code"], home: "studio")
        == "A spark thinks with Claude Code, which isn't on studio yet.")
  }

  @Test("Off's sentence names the home: two agents")
  func offWordsTwo() {
    #expect(
      ChatNight.offWords(["Claude Code", "Codex"], home: "studio")
        == "A spark thinks with Claude Code or Codex, which aren't on studio yet.")
  }

  @Test("Off's sentence names the home: three agents")
  func offWordsThree() {
    #expect(
      ChatNight.offWords(["Claude Code", "Codex", "Grok"], home: "studio")
        == "A spark thinks with Claude Code, Codex or Grok, which aren't on studio yet.")
  }

  @Test("the starters hold while the agents are read")
  func startersHold() throws {
    let reading = ChatNight.starters(agents: .reading, runs: .rows([]), catalog: try Self.catalog())
    #expect(reading.isHeld)
  }

  @Test("agents that could not be read leave the agent slots ruled, and an empty board reads bare")
  func startersUnread() throws {
    let reading = ChatNight.starters(agents: .unread, runs: .rows([]), catalog: try Self.catalog())
    #expect(
      reading.starters.map(\.words) == [
        "Spawn 4 Crew agents to research a topic each", "Keep track of my agents",
        "Have Reviewer review my agents' work until it's clean",
      ])
  }

  @Test("the agents as read fill the starters")
  func startersFilled() throws {
    let catalog = try Self.catalog()
    let providers = [try Self.provider("run-agent", "Runner", available: true, spark: true)]
    let reading = ChatNight.starters(
      agents: ChatNight.agents(providers, catalog: catalog), runs: .rows([]), catalog: catalog)
    #expect(reading.starters.first?.words == "Spawn 4 Runner agents to research a topic each")
  }

  @Test("no catalog: the whole ruled sentences stand for the agent slots, and the board's still read bare")
  func startersWithoutACatalog() {
    let reading = ChatNight.starters(agents: .unread, runs: .rows([]), catalog: nil)
    #expect(
      reading.starters.map(\.words) == [
        ChatFlows.starters[0].words, "Keep track of my agents", ChatFlows.starters[2].words,
      ])
  }

  @Test("the night stands only with no spark, once the home has answered and every desktop has")
  func theNightStands() {
    #expect(ChatPage.nightStands(sparks: 0, heard: true, away: 0))
    #expect(!ChatPage.nightStands(sparks: 1, heard: true, away: 0))
    #expect(!ChatPage.nightStands(sparks: 0, heard: false, away: 0))
    #expect(!ChatPage.nightStands(sparks: 0, heard: true, away: 1))
  }

  @Test("the night's words are the Mac's")
  func words() {
    #expect(ChatNightWords.headline == "Make your first spark")
    #expect(ChatNightWords.sentence == "A spark is an agent VibeField starts to run your other agents.")
    #expect(ChatNightWords.jobs == "Or give it a first job")
  }
}
