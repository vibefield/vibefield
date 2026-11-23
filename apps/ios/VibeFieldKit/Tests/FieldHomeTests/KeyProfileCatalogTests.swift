import FieldAgents
import FieldInput
import FieldMesh
import Foundation
import Testing

@testable import FieldHome
@testable import FieldProduct

/// PF-17 — the two tables the keys page's profile is read across, held to each other: the agent catalog names a
/// profile for an agent (`keyProfile`, packages/contracts), and the kit's catalog of keys has it (`ComboCatalog`). A
/// row naming a profile the kit lacks would leave that agent's card on the hand's choice, in silence.
@Suite("the catalog's key profiles")
struct KeyProfileCatalogTests {
  private static func rows() throws -> [AgentCatalogRow] {
    try AgentCatalogResult(json: try HomeFixture.json("agent-catalog.valid")).catalog
  }

  @Test("every profile the catalog names is one the keys page has, and an agent's own")
  func everyNamedProfileExists() throws {
    let profiles = ComboCatalog.profiles(tmuxPrefix: "b")
    let named = try Self.rows().compactMap { row in row.keyProfile.map { (row.id, $0) } }
    #expect(named.count == 5)
    for (agent, profile) in named {
      let pack = profiles.first { $0.id == profile }
      #expect(pack != nil, "\(agent) names \(profile)")
      #expect(pack?.kind == .agent, "\(agent) names \(profile)")
    }
    #expect(Set(named.map(\.1)).count == named.count)
  }

  @Test("the profile rides the fold from the door's row to the field's entry")
  func theFoldCarriesIt() throws {
    let catalog = AgentCatalog(try AgentCatalogResult(json: try HomeFixture.json("agent-catalog.valid")))
    let named = catalog.entries.filter { $0.keyProfile != nil }
    let first = try #require(catalog.entries.first)
    #expect(named.count == 5)
    #expect(first.keyProfile == ComboCatalog.claude.id)
    // A row that names none stays without one: its card keeps the hand's choice.
    #expect(catalog.entries.contains { $0.keyProfile == nil })
  }

  @Test("a card's agent chooses its profile, and a row that names none leaves the hand's choice")
  func aCardFollowsItsAgent() throws {
    let catalog = AgentCatalog(try AgentCatalogResult(json: try HomeFixture.json("agent-catalog.valid")))
    let stored = ComboCatalog.tmux(prefix: "b").id
    for entry in catalog.entries {
      let pack = ComboCatalog.chosen(
        picked: nil, session: entry.keyProfile, stored: stored, tmuxPrefix: "b")
      #expect(pack.id == entry.keyProfile ?? stored, "\(entry.id.rawValue)")
    }
  }
}
