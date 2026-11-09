import FieldProduct
import Foundation
import Testing

@testable import FieldHome

/// MA-6a — what the phone says of one app is what the Mac says. The golden is written by field-app's own reading
/// (`packages/field-app/test/made-app-goldens.test.ts`) and copied here byte for byte (`pnpm check:ios-fixtures`): an
/// app and the sources of its answer, in; its time, initial, standing, image address, hosted host, agent label, desktop
/// and state, out. The agent's label comes from the kit's own copy of the contracts' catalog.
///
/// No key path and no `try` inside an #expect/#require argument: hoisted into a `let` first (T10f's kit trap).
@Suite("MA-6a — one app's facts are the Mac's: the made-app-facts golden")
struct MadeAppFactsGoldenTests {
  @Test("every case's facts, field by field")
  func rowFacts() throws {
    let golden = try Self.golden()
    let here = try #require(golden["here"]?.stringValue)
    let cases = try #require(golden["cases"]?.arrayValue)
    #expect(cases.count == 30)
    let catalog = try AgentCatalogResult(json: try HomeFixture.json("agent-catalog.valid")).catalog
    for each in cases {
      let name = each["name"]?.stringValue ?? "?"
      let row = try IndexAppRow(json: try #require(each["app"]))
      let list = try #require(each["sources"]?.arrayValue)
      let sources = try list.map(IndexAppsSource.init(json:))
      let facts = try #require(each["facts"])
      let source = MadeAppFacts.source(of: row, in: sources)
      let desktop = MadeAppFacts.desktop(source, here: here)
      #expect(MadeAppFacts.at(row) == facts["at"]?.intValue, "\(name): at")
      #expect(
        MadeAppFacts.initial(title: row.title, filename: row.filename) == facts["initial"]?.stringValue,
        "\(name): initial")
      #expect(MadeAppFacts.away(source) == facts["away"]?.boolValue, "\(name): away")
      #expect(MadeAppFacts.imageURL(row, sources: sources) == facts["imageUrl"]?.stringValue, "\(name): imageUrl")
      #expect(MadeAppFacts.host(row.hostedUrl) == facts["host"]?.stringValue, "\(name): host")
      #expect(MadeAppFacts.agentLabel(row, catalog: catalog) == facts["agentLabel"]?.stringValue, "\(name): agentLabel")
      #expect(desktop == facts["desktop"]?.stringValue, "\(name): desktop")
      let state = MadeAppFacts.state(row, source: source, desktop: desktop)
      let said = try #require(facts["state"])
      #expect(state.tone.rawValue == said["tone"]?.stringValue, "\(name): tone")
      #expect(state.word == said["word"]?.stringValue, "\(name): word")
      #expect(state.opens == said["opens"]?.boolValue, "\(name): opens")
      #expect(state.why?.title == said["why"]?["title"]?.stringValue, "\(name): why.title")
      #expect(state.why?.detail == said["why"]?["detail"]?.stringValue, "\(name): why.detail")
    }
  }

  @Test("the golden covers every availability and every standing a source can have")
  func coverage() throws {
    let golden = try Self.golden()
    let cases = try #require(golden["cases"]?.arrayValue)
    let availabilities = Set(cases.compactMap { $0["app"]?["availability"]?.stringValue })
    let every = Set(MadeAppAvailability.allCases.map(\.rawValue))
    #expect(availabilities == every)
    let states = Set(cases.flatMap { $0["sources"]?.arrayValue ?? [] }.compactMap { $0["state"]?.stringValue })
    let standings: Set<String> = ["live", "stale", "asleep", "incompatible"]
    #expect(states == standings)
    let noSource = cases.contains { $0["sources"]?.arrayValue?.isEmpty == true }
    #expect(noSource)
  }

  static func golden() throws -> JSONValue {
    guard
      let url = Bundle.module.url(
        forResource: "made-app-facts.golden", withExtension: "json", subdirectory: "Fixtures/made-apps")
    else { throw HomeFixture.MissingFixture(name: "made-apps/made-app-facts.golden") }
    return try JSONValue.parse(try Data(contentsOf: url))
  }
}
