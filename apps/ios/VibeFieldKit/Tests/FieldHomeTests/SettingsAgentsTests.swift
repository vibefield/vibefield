import FieldProduct
import FieldSettings
import Foundation
import Testing

@testable import FieldHome
@testable import FieldMesh

/// IOS-10c — the home desktop's agents on its Settings page (agents, a read-only glance: James on the page Settings
/// in a Pocket, 2026-11-11; VF-PM's (a), the home's page alone; DESIGN.md §8 "The phone's Settings", amended that
/// day): every agent the home's catalog offers, in its order, with the profiles that hold a sign-in for it, from the
/// meters' own reading. No other desktop's page gets a section, and none is ever empty.
@Suite("the home's page lists the home's agents and their sign-ins; no other page has the section")
struct SettingsAgentsTests {
  private func row(_ id: String, _ label: String, status: String = "supported", mark: String? = nil) throws
    -> AgentCatalogRow
  {
    var fields: [String: JSONValue] = ["id": .string(id), "label": .string(label), "status": .string(status)]
    if let mark { fields["mark"] = .string(mark) }
    return try AgentCatalogRow(json: .object(fields))
  }

  /// A profile and its personas: (agent, signed in as the agent last said, or nil before a verify; its pane open).
  private func profile(_ id: String, _ label: String, _ personas: [(String, Bool?, Bool)], draft: Bool = false) throws
    -> AgentProfileSet
  {
    let rows: [JSONValue] = personas.map { provider, loggedIn, signingIn in
      var persona: [String: JSONValue] = ["profileId": .string(id), "provider": .string(provider)]
      if let loggedIn { persona["identity"] = .object(["loggedIn": .bool(loggedIn)]) }
      if signingIn { persona["signingIn"] = .object([:]) }
      return .object(persona)
    }
    return try AgentProfileSet(
      json: .object(["id": .string(id), "label": .string(label), "draft": .bool(draft), "personas": .array(rows)]))
  }

  private func reading() throws -> MetersReading {
    var reading = MetersReading()
    reading.connected = true
    reading.home = "dev-1"
    reading.catalog = [
      try row("claude", "Claude Code"), try row("codex", "Codex", status: "preview", mark: "openai"),
      try row("old", "Old", status: "deprecated"),
    ]
    reading.sets = [
      try profile("work", "Work", [("claude", true, false)]),
      try profile("personal", "Personal", [("claude", false, false), ("codex", nil, true)]),
      try profile("draft", "Draft", [("codex", true, false)], draft: true),
    ]
    return reading
  }

  @Test("every agent the home offers, in its order, its mark key, and the profiles that hold a sign-in for it")
  func fromTheHomesReading() throws {
    let agents = try #require(FieldHomeModel.settingsAgents(try reading()))
    #expect(agents.map(\.id) == ["claude", "codex"], "a deprecated row offers nothing new")
    #expect(agents.map(\.name) == ["Claude Code", "Codex"])
    #expect(agents.map(\.mark) == ["claude", "openai"], "the catalog's mark key, else its id")
    #expect(
      agents[0].profiles == [
        .init(label: "Work", signIn: .signedIn), .init(label: "Personal", signIn: .notSignedIn),
      ])
    #expect(agents[1].profiles == [.init(label: "Personal", signIn: .signingIn)], "a draft profile is not one yet")
  }

  @Test("no section until the home answers, and none for a home that offers nothing")
  func neverEmpty() throws {
    var cold = try reading()
    cold.connected = false
    #expect(FieldHomeModel.settingsAgents(cold) == nil)
    var bare = try reading()
    bare.catalog = []
    #expect(FieldHomeModel.settingsAgents(bare) == nil)
    var none = try reading()
    none.catalog = [try row("old", "Old", status: "deprecated")]
    #expect(FieldHomeModel.settingsAgents(none) == nil)
  }

  @Test("a profile's sign-in: signed in, else signing in, else not read before any verify, else not signed in")
  func signIn() throws {
    func said(_ personas: [(String, Bool?, Bool)]) throws -> SettingsAgent.SignIn {
      FieldHomeModel.signIn(try profile("p", "P", personas).personas)
    }
    #expect(try said([("a", true, false), ("a", false, false)]) == .signedIn)
    #expect(try said([("a", false, true)]) == .signingIn)
    #expect(try said([("a", nil, false)]) == .notRead)
    #expect(try said([("a", false, false)]) == .notSignedIn)
  }

  @Test("only the home's row carries agents: every other desktop's page has no section")
  func homeOnly() throws {
    let agents = try #require(FieldHomeModel.settingsAgents(try reading()))
    func desktop(_ id: String, _ name: String) -> FieldDesktop {
      FieldDesktop(
        deviceId: id, name: name, platform: "darwin", state: .ready, feed: .door, publishesTerminalDoors: true,
        fieldRefusal: nil, board: nil)
    }
    let account = FieldHomeModel.settingsAccount(
      meshState: .up, rememberedLogin: nil, login: "me@example.com", domain: nil, name: "James", face: nil,
      seed: "me@example.com", home: "dev-1", homeAnswered: true,
      desktops: [desktop("dev-1", "studio"), desktop("dev-3", "box")],
      asleep: [.init(deviceId: "dev-2", name: "mini", platform: "darwin", lastSeen: Date(timeIntervalSince1970: 0))],
      isHearing: true,
      machineName: nil, adminConsole: nil, homeAgents: agents)
    #expect(account.desktops.map(\.id) == ["dev-1", "dev-3", "dev-2"])
    #expect(account.desktops[0].agents == agents)
    #expect(account.desktops[1].agents == nil)
    #expect(account.desktops[2].agents == nil)
  }
}
