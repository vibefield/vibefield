import Foundation
import Testing

@testable import FieldProduct

/// ES-5a (track ES; DESIGN.md §8 "Chat's list", the jobs; ES-D4 A; ES-Q1) — the phone's starters are the Mac's. The
/// golden is written by field-app's own model (`packages/field-app/test/chat-starters-goldens.test.ts`) and copied here
/// byte for byte (`pnpm check:ios-fixtures`). Its inputs are the rule's own fields, so parity stands on the rule; the
/// rows below hold how the phone's own rows map to those fields.
@Suite("ES-5a — the phone's starters are the Mac's: the chat-starters golden")
struct ChatStartersGoldenTests {
  @Test("every case's starters, word for word, or held while a read is out")
  func everyCase() throws {
    let golden = try Self.golden()
    let cases = try #require(golden["cases"]?.arrayValue)
    #expect(cases.count == 17)
    let catalog = try Self.catalog()
    for one in cases {
      let name = try #require(one["name"]?.stringValue)
      let reading = ChatStarters.of(
        agents: try Self.read(one["agents"], Self.agent), runs: try Self.read(one["runs"], Self.run), catalog: catalog)
      let wanted = try Self.said(one)
      let state = reading.isHeld ? "reading" : "read"
      let said = [state] + reading.starters.map { "\($0.glyph.rawValue): \($0.words)" }
      #expect(said == wanted, "\(name): the phone says \(said), the Mac \(wanted)")
    }
  }

  @Test("a run maps its rule's fields; workedMs is activity?.since ?? statusSince, the remote row's nearest to last evidence")
  func aRemoteRowMaps() throws {
    let row = try AgentRemoteRow(json: try Fixture.json("agent-remote-row.spark"))
    let run = try #require(ChatStarters.run(row))
    let wanted = ChatStarters.Run(
      runtimeRunId: row.runtimeRunId, kind: try #require(row.monitorRow.provider?.id), alive: row.monitorRow.alive,
      spark: row.spark, project: row.monitorRow.project.name, createdMs: row.monitorRow.createdAt,
      workedMs: row.monitorRow.activity?.since ?? row.monitorRow.statusSince)
    #expect(run == wanted)
  }

  @Test("a bare terminal is no agent's run: it has no provider")
  func aBareTerminalIsNoRun() throws {
    let row = try AgentRemoteRow(json: try Fixture.json("agent-remote-row.terminal"))
    #expect(ChatStarters.run(row) == nil)
  }

  @Test("only the home's rows count (E2, the same rule as the phone's profiles)")
  func onlyTheHomesRows() throws {
    let row = try AgentRemoteRow(json: try Fixture.json("agent-remote-row.spark"))
    #expect(ChatStarters.runs([row], home: row.device).map(\.runtimeRunId) == [row.runtimeRunId])
    #expect(ChatStarters.runs([row], home: "another-device").isEmpty)
    #expect(ChatStarters.runs([row], home: nil).isEmpty)
  }

  @Test("an agent's canSpawn is the catalog's; one the catalog does not know cannot be started")
  func agentsJoinTheCatalog() throws {
    let catalog = try Self.catalog()
    let known = try #require(catalog.catalog.first { $0.canSpawn })
    let providers = try [
      AgentProviderSummary(
        json: .object(["id": .string(known.id), "label": .string(known.label), "available": .bool(true)])),
      AgentProviderSummary(
        json: .object(["id": .string("no-such-agent"), "label": .string("Nobody"), "available": .bool(true)])),
    ]
    #expect(
      ChatStarters.agents(providers, catalog: catalog) == [
        ChatStarters.Agent(id: known.id, label: known.label, available: true, canSpawn: true),
        ChatStarters.Agent(id: "no-such-agent", label: "Nobody", available: true, canSpawn: false),
      ])
  }

  @Test("with no run to name, the reviewer still steps aside for the ruled run's agent")
  func theReviewerStepsAside() throws {
    let catalog = try Self.catalog()
    let handle = try #require(catalog.starterAgent(.handle))
    let crew = try #require(catalog.starterAgent(.crew))
    let reading = ChatStarters.of(
      agents: .rows([
        ChatStarters.Agent(id: handle.id, label: handle.label, available: true, canSpawn: true),
        ChatStarters.Agent(id: crew.id, label: crew.label, available: true, canSpawn: true),
      ]),
      runs: .rows([]), catalog: catalog)
    #expect(reading.starters.last?.words == "Have \(crew.label) review my agents' work until it's clean")
  }

  // MARK: - Reading the golden

  static func catalog() throws -> AgentCatalogResult {
    try AgentCatalogResult(json: try Fixture.json("agent-catalog.valid"))
  }

  static func golden() throws -> JSONValue {
    guard
      let url = Bundle.module.url(
        forResource: "chat-starters.golden", withExtension: "json", subdirectory: "Fixtures/chat-starters")
    else { throw Fixture.FixtureError.missing("chat-starters.golden") }
    return try JSONValue.parse(try Data(contentsOf: url))
  }

  static func read<Row: Sendable & Equatable>(
    _ json: JSONValue?, _ row: (JSONValue) throws -> Row
  ) throws -> ChatStarters.Read<Row> {
    let value = try #require(json)
    if value.isNull { return .out }
    if value == .string("failed") { return .failed }
    let rows = try #require(value.arrayValue)
    return .rows(try rows.map(row))
  }

  static func agent(_ json: JSONValue) throws -> ChatStarters.Agent {
    let id = try #require(json["id"]?.stringValue)
    let label = try #require(json["label"]?.stringValue)
    let available = try #require(json["available"]?.boolValue as Bool?)
    let canSpawn = try #require(json["canSpawn"]?.boolValue as Bool?)
    return ChatStarters.Agent(id: id, label: label, available: available, canSpawn: canSpawn)
  }

  static func run(_ json: JSONValue) throws -> ChatStarters.Run {
    let id = try #require(json["runtimeRunId"]?.stringValue)
    let kind = try #require(json["kind"]?.stringValue)
    let alive = try #require(json["alive"]?.boolValue as Bool?)
    let created = try #require(json["createdMs"]?.intValue)
    let worked = try #require(json["workedMs"]?.intValue)
    return ChatStarters.Run(
      runtimeRunId: id, kind: kind, alive: alive, spark: json["spark"]?.stringValue,
      project: json["project"]?.stringValue, createdMs: created, workedMs: worked)
  }

  /// The case's state, then each starter as "glyph: words".
  static func said(_ one: JSONValue) throws -> [String] {
    let state = try #require(one["state"]?.stringValue)
    let starters = try #require(one["starters"]?.arrayValue)
    let words: [String] = try starters.map { starter in
      let glyph = try #require(starter["glyph"]?.stringValue)
      let words = try #require(starter["words"]?.stringValue)
      return "\(glyph): \(words)"
    }
    return [state] + words
  }
}
